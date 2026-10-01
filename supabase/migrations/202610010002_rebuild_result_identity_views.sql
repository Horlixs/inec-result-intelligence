-- Rebuild the result views because CREATE OR REPLACE VIEW cannot change an
-- existing view's column names/order. The identity-aware projection adds
-- candidate/party columns to the original label-only views.

drop view if exists public.election_party_totals;
drop view if exists public.geographic_candidate_totals;
drop view if exists public.election_candidate_totals;
drop view if exists public.polling_unit_candidate_results;
drop view if exists public.verified_result_entries_current;

create view public.verified_result_entries_current
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
  c.name as candidate_name,
  c.party_id,
  p.abbreviation as party_abbreviation,
  p.name as party_name,
  re.label,
  re.votes,
  r.created_at as extraction_created_at
from ranked r
join public.result_sheets rs on rs.id = r.result_sheet_id
join public.result_entries re on re.extraction_id = r.extraction_id
left join public.candidates c on c.id = re.candidate_id
left join public.parties p on p.id = c.party_id
where r.row_number = 1;

create view public.polling_unit_candidate_results
with (security_invoker = true)
as
select
  vre.election_id,
  vre.polling_unit_id,
  pu.ward_id,
  w.lga_id,
  l.state_id,
  vre.result_entry_id,
  vre.candidate_id,
  vre.candidate_name,
  vre.party_id,
  vre.party_abbreviation,
  vre.party_name,
  vre.label,
  vre.votes,
  vre.result_sheet_id,
  vre.extraction_id
from public.verified_result_entries_current vre
left join public.polling_units pu on pu.id = vre.polling_unit_id
left join public.wards w on w.id = pu.ward_id
left join public.lgas l on l.id = w.lga_id;

create view public.election_candidate_totals
with (security_invoker = true)
as
select
  election_id,
  candidate_id,
  candidate_name,
  party_id,
  party_abbreviation,
  party_name,
  label,
  sum(votes) as total_votes,
  count(*) filter (where votes is not null) as reported_polling_units,
  count(distinct polling_unit_id) as polling_units_with_entry,
  count(distinct result_sheet_id) as verified_result_sheets
from public.polling_unit_candidate_results
group by election_id, candidate_id, candidate_name, party_id, party_abbreviation, party_name, label;

create view public.geographic_candidate_totals
with (security_invoker = true)
as
select
  election_id,
  state_id,
  lga_id,
  ward_id,
  candidate_id,
  candidate_name,
  party_id,
  party_abbreviation,
  party_name,
  label,
  sum(votes) as total_votes,
  count(*) filter (where votes is not null) as reported_polling_units,
  count(distinct polling_unit_id) as polling_units_with_entry,
  count(distinct result_sheet_id) as verified_result_sheets
from public.polling_unit_candidate_results
group by election_id, state_id, lga_id, ward_id, candidate_id, candidate_name, party_id, party_abbreviation, party_name, label;

create view public.election_party_totals
with (security_invoker = true)
as
select
  election_id,
  party_id,
  party_abbreviation,
  party_name,
  sum(votes) as total_votes,
  count(distinct polling_unit_id) as polling_units_with_entry,
  count(distinct result_sheet_id) as verified_result_sheets
from public.polling_unit_candidate_results
where party_id is not null
group by election_id, party_id, party_abbreviation, party_name;

grant select on public.verified_result_entries_current to anon, authenticated;
grant select on public.polling_unit_candidate_results to anon, authenticated;
grant select on public.election_candidate_totals to anon, authenticated;
grant select on public.geographic_candidate_totals to anon, authenticated;
grant select on public.election_party_totals to anon, authenticated;

notify pgrst, 'reload schema';
