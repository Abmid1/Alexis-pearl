-- Rollback for 002. WARNING: deletes applications, uploaded-document records,
-- saved homes and sign-in codes. Files in the storage bucket are NOT deleted by
-- this script — empty the 'application-documents' bucket in Supabase first if needed.
begin;
drop table if exists application_documents, applications, saved_properties, customer_otps cascade;
drop index if exists payments_provider_ref;
alter table payments drop column if exists provider_reference, drop column if exists provider;
alter table companies drop column if exists application_form;
update enquiries set kind = 'enquiry' where kind = 'application';
update enquiries set source = 'website' where source = 'portal';
alter table enquiries drop constraint if exists enquiries_kind_check;
alter table enquiries add constraint enquiries_kind_check check (kind in ('enquiry','viewing'));
alter table enquiries drop constraint if exists enquiries_source_check;
alter table enquiries add constraint enquiries_source_check check (source in ('website','property_page','assistant'));
drop index if exists clients_company_verified_phone;
drop index if exists clients_company_verified_email;
alter table clients drop column if exists verified_phone, drop column if exists verified_email,
  drop column if exists notification_prefs, drop column if exists last_login_at;
commit;
