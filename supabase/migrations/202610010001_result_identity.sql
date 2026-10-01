create or replace view public.verified_result_entries_enriched
with (security_invoker = true)
as
with ranked as (
  select
    e.id as extraction_id,
    e.result_sheet_id,
    e.created_at,
    row_number() over (
      partition by e.result_sheet_id
      order by e.created_at desc, e.id desc
    ) as row_number
  from public.extractions e
  where e.status = 'verified'
)
select
  r.extraction_id,
  r.result_sheet_id,
  rs.election_id,
  rs.polling_unit_id,
  re.id as result_entry_id,
  re.candidate_id,
  re.label,
  re.votes,
  c.name as candidate_name,
  c.ballot_order,
  p.id as party_id,
  p.abbreviation as party_abbreviation,
  p.name as party_name,
  r.created_at as extraction_created_at
from ranked r
join public.result_sheets rs on rs.id = r.result_sheet_id
join public.result_entries re on re.extraction_id = r.extraction_id
left join public.candidates c on c.id = re.candidate_id
left join public.parties p on p.id = c.party_id
where r.row_number = 1;

grant select on public.verified_result_entries_enriched to anon, authenticated;

comment on view public.verified_result_entries_enriched is
  'Verified result entries enriched with canonical candidate and political-party metadata when those identities have been synchronized.';
