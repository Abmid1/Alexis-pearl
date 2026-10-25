-- ══════════════════════════════════════════════════════════════════════
-- BILT AFRICA — Migration 002: customer accounts, saved homes, applications,
-- private documents, verified payments.
--
-- Additive and idempotent. Run AFTER 001. Rollback: 002_customer_portal_applications.down.sql
-- ══════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Customer identity (reuses the existing clients table) ───────────
-- A customer signs in to ONE agency with a one-time code sent to their phone or
-- email. Only contacts proven by a code are stored in verified_* and used to
-- find their enquiries — editable display fields never grant access.
alter table clients add column if not exists verified_phone text;
alter table clients add column if not exists verified_email text;
alter table clients add column if not exists notification_prefs jsonb not null default '{"whatsapp": true, "email": true}';
alter table clients add column if not exists last_login_at timestamptz;
create unique index if not exists clients_company_verified_phone on clients (company_id, verified_phone) where verified_phone is not null;
create unique index if not exists clients_company_verified_email on clients (company_id, verified_email) where verified_email is not null;

create table if not exists customer_otps (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  destination text not null,               -- normalised phone (+233…) or lower-case email
  channel text not null check (channel in ('whatsapp','email')),
  code_hash text not null,                 -- sha256(secret + code); the code itself is never stored
  attempts int not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists customer_otps_lookup on customer_otps (company_id, destination, created_at desc);

-- ── 2. Saved homes (synced across the customer's devices) ──────────────
create table if not exists saved_properties (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  client_id uuid not null references clients(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  created_at timestamptz default now(),
  unique (client_id, property_id)
);

-- ── 3. Applications (rental / purchase) with configurable questions ────
-- The agency defines its own questions; nothing legal is assumed.
alter table companies add column if not exists application_form jsonb not null default '[
  {"key":"move_in","label":"When would you like to move in?","type":"date","required":false},
  {"key":"occupants","label":"How many people will live in the property?","type":"number","required":false},
  {"key":"occupation","label":"Occupation or source of income","type":"text","required":false},
  {"key":"notes","label":"Anything else the agency should know?","type":"textarea","required":false}
]';

alter table enquiries drop constraint if exists enquiries_kind_check;
alter table enquiries add constraint enquiries_kind_check check (kind in ('enquiry','viewing','application'));
alter table enquiries drop constraint if exists enquiries_source_check;
alter table enquiries add constraint enquiries_source_check check (source in ('website','property_page','assistant','portal'));

create table if not exists applications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  reference text unique not null,
  client_id uuid not null references clients(id),
  property_id uuid not null references properties(id),
  lead_id uuid references leads(id),
  enquiry_id uuid references enquiries(id),   -- links to the inbox conversation
  kind text not null check (kind in ('rental','purchase')),
  status text not null default 'submitted'
    check (status in ('submitted','under_review','info_requested','approved','declined','withdrawn')),
  answers jsonb not null default '{}',
  requested_documents jsonb not null default '[]',   -- [{label}] asked for by staff
  customer_message text,                       -- shown to the customer
  staff_note text,                             -- INTERNAL
  idempotency_key text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create unique index if not exists applications_idem on applications (company_id, idempotency_key) where idempotency_key is not null;
create index if not exists applications_company_idx on applications (company_id, created_at desc);
-- one open application per customer per property
create unique index if not exists applications_one_open on applications (client_id, property_id)
  where status in ('submitted','under_review','info_requested');

create table if not exists application_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  application_id uuid not null references applications(id) on delete cascade,
  storage_path text not null unique,           -- path inside the PRIVATE bucket; never a public URL
  file_name text not null,
  mime_type text not null,
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 8388608),
  label text,
  uploaded_by text not null check (uploaded_by in ('customer','staff')),
  created_at timestamptz default now()
);

-- Private storage bucket. Files are only reachable through short-lived signed
-- URLs the backend creates after checking who is asking.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('application-documents', 'application-documents', false, 8388608,
        array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false;

-- ── 4. Verified payments (Paystack) ────────────────────────────────────
alter table payments add column if not exists provider text;
alter table payments add column if not exists provider_reference text;
create unique index if not exists payments_provider_ref on payments (provider, provider_reference) where provider_reference is not null;

-- ── 5. RLS on for the new tables (backend uses the service key) ───────
alter table customer_otps enable row level security;
alter table saved_properties enable row level security;
alter table applications enable row level security;
alter table application_documents enable row level security;

commit;
