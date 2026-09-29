-- IReV hierarchy identity and source-enumeration metadata.
-- These fields let the collector use IReV's API hierarchy without replacing
-- our canonical INEC geography UUIDs.

alter table public.elections
  add column if not exists irev_state_id integer;

alter table public.lgas
  add column if not exists irev_lga_id integer;

alter table public.wards
  add column if not exists irev_ward_id integer,
  add column if not exists irev_ward_oid text;

alter table public.polling_units
  add column if not exists irev_pu_id integer;

create index if not exists idx_elections_irev_state_id
  on public.elections(irev_state_id);

create index if not exists idx_lgas_irev_id
  on public.lgas(state_id, irev_lga_id);

create unique index if not exists idx_wards_irev_oid_unique
  on public.wards(irev_ward_oid)
  where irev_ward_oid is not null;

create index if not exists idx_polling_units_irev_id
  on public.polling_units(irev_pu_id)
  where irev_pu_id is not null;

comment on column public.elections.irev_state_id is
  'Numeric state identifier used by the IReV API; not the canonical Supabase states.id UUID.';

comment on column public.wards.irev_ward_oid is
  'IReV ward object id required by /elections/{id}/pus?ward=.';

comment on column public.result_sheets.source_external_id is
  'IReV document/result identifier when available; source_url remains the canonical evidence locator.';
