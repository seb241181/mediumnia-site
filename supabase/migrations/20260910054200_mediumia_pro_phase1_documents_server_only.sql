-- MediumIA Pro Phase 1: document storage mutations are server-authorized only.
-- Metadata/chunk writes were already service-role only after Phase 0.
-- File uploads now use a signed one-path upload token issued by the authenticated
-- `agent-documents` Edge Function; raw Storage access is not exposed to clients.

-- Preserve the bucket as private and keep its existing size/type restrictions.
update storage.buckets
set public = false
where id = 'agent-documents';

-- Remove the prototype browser Storage policies. Signed upload tokens do not
-- require these policies, and delete/finalize operations run on the server.
drop policy if exists "Users can upload own stored agent documents" on storage.objects;
drop policy if exists "Users can read own stored agent documents" on storage.objects;
drop policy if exists "Users can update own stored agent documents" on storage.objects;
drop policy if exists "Users can delete own stored agent documents" on storage.objects;
