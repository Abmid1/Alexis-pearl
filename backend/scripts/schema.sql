-- ══════════════════════════════════════════════════════════════════════
-- ALEXIS PEARL CRM — Single source of truth schema
-- Run this in Supabase SQL Editor. Idempotent: drops + recreates.
-- ══════════════════════════════════════════════════════════════════════

drop table if exists audit_log, outbox, report_runs, tickets, leases,
  documents, campaigns, messages, conversations, expenses, invoices,
  payments, installments, payment_plans, commission_splits, deals,
  units, properties, leads, clients, users, settings cascade;

-- ── People ──────────────────────────────────────────────────────────
create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique not null,
  phone text,
  password_hash text not null,
  role text not null check (role in ('owner','admin','agent','marketing','client')),
  active boolean default true,
  created_at timestamptz default now()
);

create table clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),          -- portal login (nullable until invited)
  name text not null,
  phone text,
  email text,
  created_at timestamptz default now()
);

-- ── Sales chain: lead → deal → commission → plan → money ────────────
create table leads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  name text not null,
  phone text,
  email text,
  source text not null default 'Walk-in',     -- WhatsApp/Referral/Call-in/Walk-in/TikTok/Instagram/X/Website
  campaign_id uuid,                            -- fk added after campaigns
  stage text not null default 'new' check (stage in ('new','contacted','viewing','closing','won','lost')),
  owner_id uuid references users(id),          -- exactly one owner
  interest text,                               -- what they want
  budget numeric default 0,
  notes text,
  next_follow_up timestamptz,                  -- red when past due
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table properties (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  location text,
  lat numeric, lng numeric,
  price numeric default 0,
  ptype text default 'sale' check (ptype in ('sale','rent','land','development')),
  description text,
  images jsonb default '[]',
  listing_status text default 'draft' check (listing_status in ('draft','pending_approval','published','rejected')),
  managed boolean default false,               -- activates 1j
  created_at timestamptz default now()
);

create table units (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete cascade,
  name text not null,
  client_id uuid references clients(id),
  completion_pct int default 0,
  handover_date date,
  created_at timestamptz default now()
);

create table deals (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id),
  client_id uuid references clients(id),
  property_id uuid references properties(id),
  agent_id uuid references users(id),
  title text not null,
  sale_price numeric not null default 0,
  commission_rate numeric not null default 5,          -- percent
  commission_amount numeric generated always as (sale_price * commission_rate / 100) stored,
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','changes_requested','closed')),
  change_note text,
  approved_by uuid references users(id),
  created_at timestamptz default now()
);

create table commission_splits (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references deals(id) on delete cascade,
  user_id uuid references users(id),
  pct numeric not null,
  amount numeric default 0
);

create table payment_plans (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references deals(id),
  client_id uuid references clients(id),
  unit_id uuid references units(id),
  total numeric not null,
  installment_count int not null,
  start_date date not null,
  frequency text default 'monthly',
  status text default 'active' check (status in ('active','completed','defaulted')),
  created_at timestamptz default now()
);

create table installments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid references payment_plans(id) on delete cascade,
  seq int not null,
  due_date date not null,
  amount numeric not null,
  status text default 'pending' check (status in ('pending','paid','overdue')),
  paid_at timestamptz,
  reminder_sent boolean default false
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid references payment_plans(id),
  installment_id uuid references installments(id),
  invoice_id uuid,                              -- fk added after invoices
  lease_id uuid,                                -- fk added after leases
  client_id uuid references clients(id),
  amount numeric not null,
  method text not null check (method in ('in-app','bank','momo','cash','card')),
  receipt_url text,
  recorded_by uuid references users(id),        -- null = client paid in-app
  status text default 'approved' check (status in ('pending_approval','approved','rejected')),
  created_at timestamptz default now()
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  number text unique not null,
  client_id uuid references clients(id),
  deal_id uuid references deals(id),
  amount numeric not null,
  due_date date,
  status text default 'pending' check (status in ('paid','pending','overdue')),
  items jsonb default '[]',
  created_at timestamptz default now()
);
alter table payments add constraint payments_invoice_fk foreign key (invoice_id) references invoices(id);

create table expenses (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid references users(id) not null,   -- no expense without a submitter
  amount numeric not null,
  category text not null,
  note text,
  receipt_url text,
  status text default 'pending' check (status in ('pending','approved','rejected')),
  reject_reason text,
  decided_by uuid references users(id),
  created_at timestamptz default now()
);

-- ── Communication ───────────────────────────────────────────────────
create table conversations (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id),
  client_id uuid references clients(id),
  channel text not null check (channel in ('whatsapp','sms','email','webchat','instagram','tiktok','x','call')),
  contact_name text,
  contact_addr text,                            -- phone / email / handle
  assigned_to uuid references users(id),        -- null = unassigned (flagged)
  ai_mode text default 'auto' check (ai_mode in ('auto','suggest')),
  unread boolean default false,
  last_message_at timestamptz default now(),
  created_at timestamptz default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  body text not null,
  sender_type text not null check (sender_type in ('contact','agent','ai')),
  sender_id uuid references users(id),
  is_draft boolean default false,               -- AI suggestion awaiting agent review
  kb_source text,                               -- cited KB doc title if AI used one
  created_at timestamptz default now()
);

-- ── Marketing ───────────────────────────────────────────────────────
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  platform text not null,                       -- TikTok/Instagram/X/Facebook/Website
  name text not null,
  spend numeric default 0,
  started_on date,
  active boolean default true,
  created_at timestamptz default now()
);
alter table leads add constraint leads_campaign_fk foreign key (campaign_id) references campaigns(id);

-- ── Knowledge base + document vault ─────────────────────────────────
create table documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null,                       -- contract/brochure/policy/faq/sop/training/lease/id/property
  content_text text,                            -- searchable body (KB brain)
  file_url text,
  client_id uuid references clients(id),        -- client-vault docs
  property_id uuid references properties(id),
  uploaded_by uuid references users(id),
  created_at timestamptz default now()
);

-- ── Property management (1j — dormant until first managed property) ─
create table leases (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id),
  unit_id uuid references units(id),
  client_id uuid references clients(id),
  rent_amount numeric not null,
  start_date date not null,
  end_date date not null,
  status text default 'active' check (status in ('active','expiring','ended')),
  created_at timestamptz default now()
);
alter table payments add constraint payments_lease_fk foreign key (lease_id) references leases(id);

create table tickets (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id),
  unit_id uuid references units(id),
  client_id uuid references clients(id),
  title text not null,
  description text,
  status text default 'open' check (status in ('open','in_progress','resolved')),
  owner_id uuid references users(id),           -- every ticket has an owner
  created_at timestamptz default now()
);

-- ── System ──────────────────────────────────────────────────────────
create table report_runs (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  payload jsonb not null,
  sent_to jsonb default '[]',
  created_at timestamptz default now()
);

create table outbox (                            -- integration seam: everything "sent" lands here
  id uuid primary key default gen_random_uuid(),
  channel text not null,                        -- whatsapp/sms/email
  to_addr text not null,
  body text not null,
  ref text,                                     -- reminder/report/campaign/reply/portal
  status text default 'simulated' check (status in ('queued','sent','simulated','failed')),
  created_at timestamptz default now()
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  user_name text,
  action text not null,                         -- created/updated/approved/rejected/deleted/sent
  entity text not null,
  entity_id uuid,
  detail jsonb default '{}',
  created_at timestamptz default now()
);

create table settings (
  key text primary key,
  value jsonb not null
);

insert into settings (key, value) values
  ('phases',            '{"phase1": true, "phase2": true, "phase3": true}'),
  ('commission_rate',   '5'),
  ('report_recipients', '[]'),
  ('rr_cursor',         '0');

-- ── Indexes ─────────────────────────────────────────────────────────
create index on leads (stage);
create index on leads (owner_id);
create index on leads (next_follow_up);
create index on messages (conversation_id, created_at);
create index on installments (plan_id, seq);
create index on audit_log (created_at desc);
