-- Repair geography columns that were added to the source migration after
-- that migration had already been applied to the remote database.

alter table public.states
  add column if not exists code text;

alter table public.lgas
  add column if not exists code text;

alter table public.wards
  add column if not exists code text;

alter table public.polling_units
  add column if not exists state_code text;

alter table public.polling_units
  add column if not exists lga_code text;

alter table public.polling_units
  add column if not exists ward_code text;

-- Ensure the geography codes used by the INEC sync are valid upsert conflict targets.

create unique index if not exists idx_states_code_unique
  on public.states(code)
  where code is not null;

create unique index if not exists idx_lgas_state_code_unique
  on public.lgas(state_id, code)
  where code is not null;

create unique index if not exists idx_wards_lga_code_unique
  on public.wards(lga_id, code)
  where code is not null;

create unique index if not exists idx_polling_units_ward_pu_code_unique
  on public.polling_units(ward_id, pu_code)
  where pu_code is not null;
