-- Coverage and processing metrics for trustworthy result interpretation.
-- These views deliberately separate geography coverage from processing coverage.

create or replace view public.election_pipeline_coverage
with (security_invoker = true)
as
with stats as (
  select distinct on (election_id)
    election_id,
    polling_units_expected,
    result_sheets_expected,
    result_sheets_uploaded,
    candidates_count,
    parties_count
  from public.election_statistics
  order by election_id, updated_at desc nulls last, id desc
),
pu as (
  select
    rs.election_id,
    count(distinct rs.polling_unit_id) filter (where rs.polling_unit_id is not null) as discovered_pus,
    count(distinct rs.polling_unit_id) filter (where rs.status = 'verified' and rs.polling_unit_id is not null) as verified_pus,
    count(distinct rs.polling_unit_id) filter (where rs.status in ('processing','pending_review') and rs.polling_unit_id is not null) as in_review_pus,
    count(distinct rs.polling_unit_id) filter (where rs.status = 'failed' and rs.polling_unit_id is not null) as failed_pus,
    count(*) as discovered_sheets,
    count(*) filter (where rs.status = 'verified') as verified_sheets,
    count(*) filter (where rs.status = 'discovered') as discovered_unprocessed_sheets,
    count(*) filter (where rs.status in ('processing','pending_review')) as in_review_sheets,
    count(*) filter (where rs.status = 'failed') as failed_sheets
  from public.result_sheets rs
  group by rs.election_id
),
entries as (
  select
    rs.election_id,
    count(distinct re.id) as verified_entries,
    count(distinct re.candidate_id) filter (where re.candidate_id is not null) as linked_candidates,
    coalesce(sum(re.votes) filter (where re.votes is not null), 0) as verified_vote_values
  from public.result_sheets rs
  join public.extractions ex on ex.result_sheet_id = rs.id and ex.status = 'verified'
  join public.result_entries re on re.extraction_id = ex.id
  group by rs.election_id
),
geo as (
  select
    e.id as election_id,
    count(distinct s.id) as states_with_results,
    count(distinct l.id) as lgas_with_results,
    count(distinct w.id) as wards_with_results,
    count(distinct pu.id) as pus_with_records
  from public.elections e
  left join public.result_sheets rs on rs.election_id = e.id
  left join public.polling_units pu on pu.id = rs.polling_unit_id
  left join public.wards w on w.id = pu.ward_id
  left join public.lgas l on l.id = w.lga_id
  left join public.states s on s.id = l.state_id
  group by e.id
)
select
  e.id as election_id,
  e.name,
  e.election_type,
  e.election_date,
  coalesce(stats.polling_units_expected, pu.discovered_pus, 0) as total_pus_expected,
  coalesce(stats.result_sheets_expected, 0) as result_sheets_expected,
  coalesce(stats.result_sheets_uploaded, 0) as official_uploaded_sheets,
  coalesce(pu.discovered_pus, 0) as discovered_pus,
  coalesce(pu.verified_pus, 0) as verified_pus,
  coalesce(pu.in_review_pus, 0) as in_review_pus,
  coalesce(pu.failed_pus, 0) as failed_pus,
  coalesce(pu.discovered_sheets, 0) as discovered_sheets,
  coalesce(pu.verified_sheets, 0) as verified_sheets,
  coalesce(pu.discovered_unprocessed_sheets, 0) as unprocessed_sheets,
  coalesce(pu.in_review_sheets, 0) as in_review_sheets,
  coalesce(pu.failed_sheets, 0) as failed_sheets,
  coalesce(entries.verified_entries, 0) as verified_entries,
  coalesce(entries.linked_candidates, 0) as linked_candidates,
  coalesce(entries.verified_vote_values, 0) as verified_vote_values,
  coalesce(geo.states_with_results, 0) as states_with_results,
  coalesce(geo.lgas_with_results, 0) as lgas_with_results,
  coalesce(geo.wards_with_results, 0) as wards_with_results,
  coalesce(geo.pus_with_records, 0) as pus_with_records,
  case when coalesce(stats.polling_units_expected, pu.discovered_pus, 0) > 0
    then round(100.0 * coalesce(pu.verified_pus, 0) / coalesce(stats.polling_units_expected, pu.discovered_pus, 1), 2)
    else 0 end as pu_verification_percent,
  case when coalesce(stats.result_sheets_expected, 0) > 0
    then round(100.0 * coalesce(pu.verified_sheets, 0) / stats.result_sheets_expected, 2)
    else 0 end as sheet_verification_percent
from public.elections e
left join stats on stats.election_id = e.id
left join pu on pu.election_id = e.id
left join entries on entries.election_id = e.id
left join geo on geo.election_id = e.id;

grant select on public.election_pipeline_coverage to anon, authenticated;

create or replace view public.geography_tree_counts
with (security_invoker = true)
as
select
  'state'::text as level,
  s.id as id,
  null::uuid as parent_id,
  s.name,
  count(distinct l.id) as lga_count,
  count(distinct w.id) as ward_count,
  count(distinct pu.id) as polling_unit_count
from public.states s
left join public.lgas l on l.state_id = s.id
left join public.wards w on w.lga_id = l.id
left join public.polling_units pu on pu.ward_id = w.id
group by s.id, s.name
union all
select
  'lga', l.id, l.state_id, l.name,
  0, count(distinct w.id), count(distinct pu.id)
from public.lgas l
left join public.wards w on w.lga_id = l.id
left join public.polling_units pu on pu.ward_id = w.id
group by l.id, l.state_id, l.name
union all
select
  'ward', w.id, w.lga_id, w.name,
  0, 0, count(distinct pu.id)
from public.wards w
left join public.polling_units pu on pu.ward_id = w.id
group by w.id, w.lga_id, w.name;

grant select on public.geography_tree_counts to anon, authenticated;

comment on view public.election_pipeline_coverage is
  'Election-level processing coverage. Result totals must be interpreted against expected PU/sheet coverage, not as complete totals unless coverage is complete.';

comment on view public.geography_tree_counts is
  'Canonical geography counts independent of result processing. Used to show total LGAs, wards and polling units at each tree level.';
