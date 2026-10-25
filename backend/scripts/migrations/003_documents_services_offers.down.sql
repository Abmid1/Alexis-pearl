-- Rollback for 003. WARNING: deletes document requests, service/landlord submissions,
-- offers and transaction milestones. Files in the storage bucket are NOT deleted —
-- clear the 'application-documents' bucket's document-requests folders first if needed.
begin;
drop table if exists document_request_files, document_requests, service_requests, offers, transactions cascade;
alter table companies drop column if exists document_catalogue;
update enquiries set kind = 'enquiry' where kind = 'service';
alter table enquiries drop constraint if exists enquiries_kind_check;
alter table enquiries add constraint enquiries_kind_check check (kind in ('enquiry','viewing','application'));
commit;
