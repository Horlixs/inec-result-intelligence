-- Stable RPC for the public result explorer. This avoids coupling the UI to
-- PostgREST's cached view column metadata while preserving the same verified
-- result source and canonical candidate/party identity.
create or replace function public.get_result_totals(
  p_election_id uuid,
  p_state_id uuid default null,
  p_lga_id uuid default null,
  p_ward_id uuid default null,
  p_polling_unit_id uuid default null
)
returns table (
  label text,
  candidate_id uuid,
  candidate_name text,
  party_id uuid,
  party_abbreviation text,
  party_name text,
  total_votes bigint,
  polling_units_with_entry bigint,
  verified_result_sheets bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    r.label,
    r.candidate_id,
    r.candidate_name,
    r.party_id,
    r.party_abbreviation,
    r.party_name,
    sum(r.votes)::bigint as total_votes,
    count(distinct r.polling_unit_id)::bigint as polling_units_with_entry,
    count(distinct r.result_sheet_id)::bigint as verified_result_sheets
  from public.polling_unit_candidate_results r
  where r.election_id = p_election_id
    and (p_state_id is null or r.state_id = p_state_id)
    and (p_lga_id is null or r.lga_id = p_lga_id)
    and (p_ward_id is null or r.ward_id = p_ward_id)
    and (p_polling_unit_id is null or r.polling_unit_id = p_polling_unit_id)
  group by
    r.label,
    r.candidate_id,
    r.candidate_name,
    r.party_id,
    r.party_abbreviation,
    r.party_name
  order by sum(r.votes) desc nulls last, r.label asc;
$$;

grant execute on function public.get_result_totals(uuid, uuid, uuid, uuid, uuid) to anon, authenticated;
notify pgrst, 'reload schema';
