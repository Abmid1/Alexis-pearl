-- ══════════════════════════════════════════════════════════════════════
-- BILT AFRICA — Migration 001: multi-company foundation + public agency site
--
-- Additive and idempotent: safe to run on a database that already holds data.
-- Every existing row is attached to one default company ("Alexis Pearl"), so the
-- current workspace keeps working exactly as before.
--
-- Run in Supabase → SQL Editor AFTER schema.sql (fresh install) or directly on
-- an existing database. Rollback: 001_multi_company_public_site.down.sql
-- ══════════════════════════════════════════════════════════════════════

begin;

create extension if not exists btree_gist;   -- needed for the no-double-booking constraint

-- ── 1. Companies (tenants) ─────────────────────────────────────────────
create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$'),
  name text not null,
  custom_domain text unique,                       -- future: www.abcproperties.com
  public_enabled boolean not null default true,    -- switch the customer site on/off
  -- branding + public profile (everything here is safe to show publicly)
  logo_url text,
  brand_color text default '#4038B8' check (brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  tagline text,
  about text,
  contact_phone text,
  contact_email text,
  whatsapp text,
  address text,
  office_hours text,
  socials jsonb not null default '{}',             -- {instagram, facebook, tiktok, x, linkedin, website}
  services jsonb not null default '["buy","rent"]',-- buy | rent | sell | land | management | valuation
  -- viewing schedule used to offer bookable slots (company-local time, Africa/Accra = UTC)
  viewing_hours jsonb not null default '{"days":[1,2,3,4,5,6],"start":"09:00","end":"16:00","slot_minutes":45,"min_notice_hours":24,"max_days_ahead":21,"cancel_cutoff_hours":2}',
  -- private operational settings (never returned by public endpoints)
  settings jsonb not null default '{"commission_rate":5,"rr_cursor":0}',
  whatsapp_phone_number_id text unique,            -- routes inbound WhatsApp to the right company
  created_at timestamptz default now()
);

insert into companies (slug, name, tagline, contact_phone, contact_email, address, office_hours, about)
values ('alexis-pearl', 'Alexis Pearl', 'Homes and land across Greater Accra',
        '+233244000001', 'hello@alexispearl.com', 'East Legon, Accra', 'Mon–Sat, 8:30am–5pm',
        'Alexis Pearl helps families and investors buy, rent and build in Greater Accra.')
on conflict (slug) do nothing;

-- carry existing global settings into the default company
update companies c set settings = c.settings
  || jsonb_build_object('commission_rate', coalesce((select (value #>> '{}')::numeric from settings where key = 'commission_rate'), 5))
  || jsonb_build_object('rr_cursor',       coalesce((select (value #>> '{}')::int     from settings where key = 'rr_cursor'), 0))
where c.slug = 'alexis-pearl';

-- ── 2. company_id on every company-owned table, backfilled to the default ─
do $$
declare
  t text;
  default_company uuid := (select id from companies where slug = 'alexis-pearl');
begin
  foreach t in array array['users','clients','leads','properties','units','deals','payment_plans',
                           'payments','invoices','expenses','conversations','campaigns','documents',
                           'leases','tickets','report_runs','outbox','audit_log']
  loop
    execute format('alter table %I add column if not exists company_id uuid references companies(id)', t);
    execute format('update %I set company_id = %L where company_id is null', t, default_company);
    execute format('create index if not exists %I on %I (company_id)', t || '_company_idx', t);
  end loop;
end $$;

-- Business records must always belong to a company. (audit_log/outbox/users stay
-- nullable: system events and platform-level accounts may have no company.)
alter table clients        alter column company_id set not null;
alter table leads          alter column company_id set not null;
alter table properties     alter column company_id set not null;
alter table units          alter column company_id set not null;
alter table deals          alter column company_id set not null;
alter table payment_plans  alter column company_id set not null;
alter table payments       alter column company_id set not null;
alter table invoices       alter column company_id set not null;
alter table expenses       alter column company_id set not null;
alter table conversations  alter column company_id set not null;
alter table campaigns      alter column company_id set not null;
alter table documents      alter column company_id set not null;
alter table leases         alter column company_id set not null;
alter table tickets        alter column company_id set not null;
alter table report_runs    alter column company_id set not null;

-- invoice numbers restart per company (INV-2026-0001 exists in every company)
alter table invoices drop constraint if exists invoices_number_key;
create unique index if not exists invoices_company_number_key on invoices (company_id, number);

-- ── 3. Public listing fields on properties ─────────────────────────────
alter table properties add column if not exists property_type text
  check (property_type in ('apartment','house','townhouse','duplex','compound_house','chamber_and_hall','single_room','self_contained','land','commercial','office','warehouse'));
alter table properties add column if not exists city text;              -- Accra, Tema, Kumasi…
alter table properties add column if not exists neighbourhood text;     -- East Legon, Osu, Spintex…
alter table properties add column if not exists region text;            -- Greater Accra, Ashanti…
alter table properties add column if not exists bedrooms int check (bedrooms between 0 and 50);
alter table properties add column if not exists bathrooms int check (bathrooms between 0 and 50);
alter table properties add column if not exists size_sqm numeric check (size_sqm > 0);
alter table properties add column if not exists furnishing text check (furnishing in ('furnished','semi_furnished','unfurnished'));
alter table properties add column if not exists amenities text[] not null default '{}';
alter table properties add column if not exists rent_period text check (rent_period in ('month','year'));
alter table properties add column if not exists advance_months int check (advance_months between 0 and 60); -- Ghana: rent advance
alter table properties add column if not exists public_fees text;       -- agency/legal fees text approved for display
alter table properties add column if not exists availability text not null default 'available'
  check (availability in ('available','reserved','under_offer','unavailable','rented','sold'));
alter table properties add column if not exists availability_confirmed_at timestamptz;
alter table properties add column if not exists show_exact_location boolean not null default false; -- lat/lng public?
alter table properties add column if not exists featured boolean not null default false;
alter table properties add column if not exists published_at timestamptz;
alter table properties add column if not exists archived_at timestamptz;
alter table properties add column if not exists updated_at timestamptz default now();

-- existing published listings get a publish timestamp so "recently published" works
update properties set published_at = coalesce(published_at, created_at) where listing_status = 'published';

-- public search path: company + published + not archived
create index if not exists properties_public_idx on properties (company_id, listing_status, availability, published_at desc) where archived_at is null;

-- KB documents: only documents explicitly marked public may feed the customer assistant
alter table documents add column if not exists is_public boolean not null default false;

-- ── 4. Enquiries (every website/assistant enquiry, linked into the CRM) ───
create table if not exists enquiries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  reference text unique not null,                       -- shown to the customer, e.g. BA-7K3M9QX2
  property_id uuid references properties(id),
  lead_id uuid references leads(id),
  conversation_id uuid references conversations(id),
  kind text not null default 'enquiry' check (kind in ('enquiry','viewing')),
  source text not null default 'website' check (source in ('website','property_page','assistant')),
  name text not null,
  phone text,
  email text,
  message text,
  contact_consent boolean not null default false,       -- may we send updates by WhatsApp/email?
  idempotency_key text,                                 -- stops double submissions on retry
  status text not null default 'new' check (status in ('new','in_progress','closed')),
  created_at timestamptz default now()
);
create unique index if not exists enquiries_idem_key on enquiries (company_id, idempotency_key) where idempotency_key is not null;
create index if not exists enquiries_company_idx on enquiries (company_id, created_at desc);

-- ── 5. Viewings (internal scheduling; no external calendar assumed) ───────
create table if not exists viewings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  reference text unique not null,
  property_id uuid not null references properties(id),
  lead_id uuid references leads(id),
  enquiry_id uuid references enquiries(id),
  agent_id uuid references users(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'requested'
    check (status in ('requested','confirmed','declined','cancelled','completed','no_show')),
  contact_name text not null,
  contact_phone text,
  contact_email text,
  customer_note text,            -- visible to staff; written by the customer
  staff_note text,               -- INTERNAL, never returned publicly
  decline_reason text,           -- customer-facing
  outcome text,                  -- INTERNAL attendance/outcome note
  cancelled_by text check (cancelled_by in ('customer','staff')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  check (ends_at > starts_at)
);
create index if not exists viewings_company_idx on viewings (company_id, starts_at);

-- No double booking: two CONFIRMED viewings may not overlap for the same
-- property, nor for the same agent. Enforced by Postgres itself, atomically.
do $$ begin
  alter table viewings add constraint viewings_no_property_overlap
    exclude using gist (property_id with =, tstzrange(starts_at, ends_at) with &&) where (status = 'confirmed');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table viewings add constraint viewings_no_agent_overlap
    exclude using gist (agent_id with =, tstzrange(starts_at, ends_at) with &&) where (status = 'confirmed' and agent_id is not null);
exception when duplicate_object then null; end $$;

-- outbox dedupe key: the same event never sends twice
alter table outbox add column if not exists dedupe_key text;
create unique index if not exists outbox_dedupe_key on outbox (dedupe_key) where dedupe_key is not null;

-- ── 6. Row Level Security ON for every table ───────────────────────────
-- The backend uses the service key (bypasses RLS). Turning RLS on with no
-- policies means the public anon key can no longer read any table directly.
do $$
declare t text;
begin
  foreach t in array array['companies','users','clients','leads','properties','units','deals',
                           'commission_splits','payment_plans','installments','payments','invoices',
                           'expenses','conversations','messages','campaigns','documents','leases',
                           'tickets','report_runs','outbox','audit_log','settings','enquiries','viewings']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

commit;
