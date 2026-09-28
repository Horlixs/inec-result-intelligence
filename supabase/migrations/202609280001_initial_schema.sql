create extension if not exists pgcrypto;

create table if not exists public.elections (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  name text not null,
  election_type text,
  election_date date,
  source_url text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.states (id uuid primary key default gen_random_uuid(), name text not null unique, code text);
create table if not exists public.lgas (id uuid primary key default gen_random_uuid(), state_id uuid not null references public.states(id) on delete cascade, name text not null, unique(state_id,name));
create table if not exists public.wards (id uuid primary key default gen_random_uuid(), lga_id uuid not null references public.lgas(id) on delete cascade, name text not null, external_id text, unique(lga_id,name));
create table if not exists public.polling_units (id uuid primary key default gen_random_uuid(), ward_id uuid not null references public.wards(id) on delete cascade, name text not null, pu_code text, external_id text, unique(ward_id,name));
create table if not exists public.parties (id uuid primary key default gen_random_uuid(), abbreviation text not null unique, name text);
create table if not exists public.candidates (id uuid primary key default gen_random_uuid(), election_id uuid not null references public.elections(id) on delete cascade, party_id uuid references public.parties(id), name text not null, ballot_order integer, unique(election_id,name,party_id));
create table if not exists public.result_sheets (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete cascade,
  polling_unit_id uuid references public.polling_units(id),
  source_url text not null,
  source_external_id text,
  source_hash text,
  storage_path text,
  mime_type text,
  captured_at timestamptz,
  discovered_at timestamptz not null default now(),
  status text not null default 'discovered',
  unique(election_id,source_url)
);
create table if not exists public.extractions (
  id uuid primary key default gen_random_uuid(),
  result_sheet_id uuid not null references public.result_sheets(id) on delete cascade,
  engine text not null,
  engine_version text,
  raw_output jsonb not null,
  confidence numeric(5,4),
  status text not null default 'pending_review',
  created_at timestamptz not null default now()
);
create table if not exists public.result_entries (
  id uuid primary key default gen_random_uuid(),
  extraction_id uuid not null references public.extractions(id) on delete cascade,
  candidate_id uuid references public.candidates(id),
  label text not null,
  votes integer,
  raw_label text,
  raw_value text,
  created_at timestamptz not null default now()
);
create table if not exists public.validation_checks (
  id uuid primary key default gen_random_uuid(),
  extraction_id uuid not null references public.extractions(id) on delete cascade,
  check_name text not null,
  passed boolean not null,
  severity text not null default 'info',
  details jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.corrections (
  id uuid primary key default gen_random_uuid(),
  result_entry_id uuid not null references public.result_entries(id) on delete cascade,
  previous_value integer,
  corrected_value integer,
  reason text not null,
  corrected_by text,
  created_at timestamptz not null default now()
);
create index if not exists idx_result_sheets_election_status on public.result_sheets(election_id,status);
create index if not exists idx_result_sheets_hash on public.result_sheets(source_hash);
create index if not exists idx_extractions_status on public.extractions(status);
create index if not exists idx_result_entries_extraction on public.result_entries(extraction_id);

alter table public.elections enable row level security;
alter table public.states enable row level security;
alter table public.lgas enable row level security;
alter table public.wards enable row level security;
alter table public.polling_units enable row level security;
alter table public.parties enable row level security;
alter table public.candidates enable row level security;
alter table public.result_sheets enable row level security;
alter table public.extractions enable row level security;
alter table public.result_entries enable row level security;
alter table public.validation_checks enable row level security;
alter table public.corrections enable row level security;

create policy "public read elections" on public.elections for select using (true);
create policy "public read geography" on public.states for select using (true);
create policy "public read lgas" on public.lgas for select using (true);
create policy "public read wards" on public.wards for select using (true);
create policy "public read polling units" on public.polling_units for select using (true);
create policy "public read parties" on public.parties for select using (true);
create policy "public read candidates" on public.candidates for select using (true);
create policy "public read result sheets" on public.result_sheets for select using (true);
create policy "public read extractions" on public.extractions for select using (true);
create policy "public read result entries" on public.result_entries for select using (true);
create policy "public read validation checks" on public.validation_checks for select using (true);

create or replace function public.election_ids_for_geography(
  election_ids uuid[],
  p_state_id uuid,
  p_lga_id uuid default null,
  p_ward_id uuid default null,
  p_polling_unit_id uuid default null
)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select distinct rs.election_id
  from public.result_sheets rs
  join public.polling_units pu on pu.id = rs.polling_unit_id
  join public.wards w on w.id = pu.ward_id
  join public.lgas l on l.id = w.lga_id
  where rs.election_id = any(election_ids)
    and l.state_id = p_state_id
    and (p_lga_id is null or l.id = p_lga_id)
    and (p_ward_id is null or w.id = p_ward_id)
    and (p_polling_unit_id is null or pu.id = p_polling_unit_id);
$$;

grant execute on function public.election_ids_for_geography(uuid[],uuid,uuid,uuid,uuid) to anon, authenticated;
