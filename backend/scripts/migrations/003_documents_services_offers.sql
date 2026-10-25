-- ══════════════════════════════════════════════════════════════════════
-- BILT AFRICA — Migration 003: document requests, landlord & service requests,
-- offers, and transaction milestones.
--
-- Additive and idempotent. Run AFTER 002. Rollback: 003_documents_services_offers.down.sql
-- ══════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Document catalogue (per agency, fully editable) ─────────────────
-- Each entry: {key, label, category, description, turnaround_days, fee, enabled}
-- Fees are in GHS. 0 = free. Nothing here is a legal promise; staff fulfil manually.
alter table companies add column if not exists document_catalogue jsonb not null default '[
  {"key":"payment_statement","label":"Payment statement","category":"financial","description":"Detailed payment history and outstanding balance.","turnaround_days":3,"fee":0,"enabled":true},
  {"key":"clearance_certificate","label":"Clearance certificate","category":"financial","description":"Confirms all payments on your property are cleared.","turnaround_days":7,"fee":0,"enabled":true},
  {"key":"allocation_letter","label":"Allocation letter","category":"legal","description":"Official letter allocating the property to you.","turnaround_days":7,"fee":0,"enabled":true},
  {"key":"possession_letter","label":"Possession letter","category":"legal","description":"Confirms handover of possession of your property.","turnaround_days":14,"fee":0,"enabled":true},
  {"key":"duplicate_allocation","label":"Duplicate allocation letter","category":"legal","description":"Replacement if the original allocation letter is lost.","turnaround_days":14,"fee":0,"enabled":true},
  {"key":"transfer_consent","label":"Consent to transfer","category":"legal","description":"Written consent to transfer or resell the property.","turnaround_days":21,"fee":0,"enabled":true},
  {"key":"construction_permission","label":"Permission to build","category":"construction","description":"Agency permission to start construction or renovation.","turnaround_days":21,"fee":0,"enabled":true},
  {"key":"booking_cancellation","label":"Booking cancellation","category":"financial","description":"Request to cancel a booking and begin any refund process.","turnaround_days":30,"fee":0,"enabled":true}
]';

create table if not exists document_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  reference text unique not null,
  client_id uuid not null references clients(id),
  property_id uuid references properties(id),
  doc_key text not null,
  doc_label text not null,                      -- snapshot: the catalogue may change later
  category text,
  fee numeric not null default 0,
  turnaround_days int,
  customer_note text,
  status text not null default 'requested'
    check (status in ('requested','in_progress','ready','declined','cancelled')),
  customer_message text,                        -- staff → customer
  staff_note text,                              -- INTERNAL
  idempotency_key text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create unique index if not exists document_requests_idem on document_requests (company_id, idempotency_key) where idempotency_key is not null;
create index if not exists document_requests_company_idx on document_requests (company_id, created_at desc);

-- Files issued by staff for a document request (same private bucket as applications).
create table if not exists document_request_files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  request_id uuid not null references document_requests(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 8388608),
  label text,
  uploaded_by text not null check (uploaded_by in ('customer','staff')),
  created_at timestamptz default now()
);

-- ── 2. Landlord & service requests (list a property, valuation, management…) ─
alter table enquiries drop constraint if exists enquiries_kind_check;
alter table enquiries add constraint enquiries_kind_check check (kind in ('enquiry','viewing','application','service'));

create table if not exists service_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  reference text unique not null,
  kind text not null check (kind in ('list_property','valuation','management','relocation')),
  client_id uuid references clients(id),        -- set when a signed-in customer submits
  lead_id uuid references leads(id),
  enquiry_id uuid references enquiries(id),
  name text not null,
  phone text,
  email text,
  details jsonb not null default '{}',          -- validated per kind in lib/services.js
  status text not null default 'new' check (status in ('new','in_progress','closed')),
  customer_message text,
  staff_note text,                              -- INTERNAL
  converted_property_id uuid references properties(id),  -- draft listing created from a submission
  idempotency_key text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create unique index if not exists service_requests_idem on service_requests (company_id, idempotency_key) where idempotency_key is not null;
create index if not exists service_requests_company_idx on service_requests (company_id, created_at desc);

-- ── 3. Offers (recorded by the agency; acceptance is an indication of intent) ─
create table if not exists offers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  reference text unique not null,
  client_id uuid not null references clients(id),
  property_id uuid not null references properties(id),
  application_id uuid references applications(id),
  deal_id uuid references deals(id),
  amount numeric not null check (amount >= 0),
  currency text not null default 'GHS',
  terms text,                                   -- shown to the customer
  status text not null default 'draft'
    check (status in ('draft','sent','accepted','declined','withdrawn','expired')),
  expires_at timestamptz,
  responded_at timestamptz,
  customer_response_note text,
  staff_note text,                              -- INTERNAL
  created_by uuid references users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists offers_company_idx on offers (company_id, created_at desc);

-- ── 4. Transactions + milestones (customer-visible progress) ───────────
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  reference text unique not null,
  client_id uuid not null references clients(id),
  property_id uuid references properties(id),
  deal_id uuid references deals(id),            -- links to the existing CRM deal, never duplicates it
  kind text not null check (kind in ('sale','rental')),
  status text not null default 'active' check (status in ('active','completed','cancelled')),
  milestones jsonb not null default '[]',       -- [{key,label,state,note,completed_at}]
  customer_message text,
  staff_note text,                              -- INTERNAL
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists transactions_company_idx on transactions (company_id, created_at desc);

-- ── 5. RLS on for the new tables (backend uses the service key) ───────
alter table document_requests enable row level security;
alter table document_request_files enable row level security;
alter table service_requests enable row level security;
alter table offers enable row level security;
alter table transactions enable row level security;

commit;
