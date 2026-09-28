-- Supabase protects storage metadata tables from direct SQL deletes.
-- The result-evidence bucket is intentionally unused by the remote-only
-- evidence architecture. Leave bucket lifecycle to the Storage API/dashboard.

comment on table public.result_sheets is
  'Remote-only evidence architecture: source documents are fetched transiently from the canonical URL for hashing/extraction; document bytes are not retained in Supabase Storage.';
