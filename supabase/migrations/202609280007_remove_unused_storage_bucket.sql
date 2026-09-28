do $$
begin
  if not exists (
    select 1 from storage.objects where bucket_id = 'result-evidence'
  ) then
    delete from storage.buckets where id = 'result-evidence';
  end if;
end $$;

comment on table public.result_sheets is
  'Remote-only evidence architecture: source documents are fetched transiently from the canonical URL for hashing/extraction; document bytes are not retained in Supabase Storage.';
