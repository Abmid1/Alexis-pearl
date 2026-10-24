-- Rollback for 001_multi_company_public_site.sql
-- WARNING: drops enquiries, viewings and companies, and removes company_id columns.
-- Any data created by the public website will be lost. Back up first.
begin;

drop table if exists viewings, enquiries cascade;

drop index if exists outbox_dedupe_key;
alter table outbox drop column if exists dedupe_key;
alter table documents drop column if exists is_public;

alter table properties
  drop column if exists property_type, drop column if exists city, drop column if exists neighbourhood,
  drop column if exists region, drop column if exists bedrooms, drop column if exists bathrooms,
  drop column if exists size_sqm, drop column if exists furnishing, drop column if exists amenities,
  drop column if exists rent_period, drop column if exists advance_months, drop column if exists public_fees,
  drop column if exists availability, drop column if exists availability_confirmed_at,
  drop column if exists show_exact_location, drop column if exists featured,
  drop column if exists published_at, drop column if exists archived_at, drop column if exists updated_at;

drop index if exists invoices_company_number_key;

do $$
declare t text;
begin
  foreach t in array array['users','clients','leads','properties','units','deals','payment_plans',
                           'payments','invoices','expenses','conversations','campaigns','documents',
                           'leases','tickets','report_runs','outbox','audit_log']
  loop
    execute format('alter table %I drop column if exists company_id', t);
  end loop;
end $$;

-- restores global uniqueness; fails if two companies created the same number
alter table invoices add constraint invoices_number_key unique (number);

drop table if exists companies cascade;
commit;
