-- Make geography keys directly inferable by PostgREST/Supabase upserts.
-- The previous migration created partial unique indexes, which PostgreSQL
-- cannot infer for ON CONFLICT (column list) without the same predicate.

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

drop index if exists public.idx_states_code_unique;
drop index if exists public.idx_lgas_state_code_unique;
drop index if exists public.idx_wards_lga_code_unique;
drop index if exists public.idx_polling_units_ward_pu_code_unique;

create unique index idx_states_code_unique
  on public.states(code);

create unique index idx_lgas_state_code_unique
  on public.lgas(state_id, code);

create unique index idx_wards_lga_code_unique
  on public.wards(lga_id, code);

create unique index idx_polling_units_ward_pu_code_unique
  on public.polling_units(ward_id, pu_code);
