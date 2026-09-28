create table if not exists public.election_sources (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete cascade,
  source_type text not null,
  title text not null,
  url text not null,
  document_date date,
  published_at timestamptz,
  retrieved_at timestamptz not null default now(),
  content_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(election_id, url)
);

create table if not exists public.election_timeline (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete cascade,
  activity_key text not null,
  activity_name text not null,
  description text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text not null default 'Africa/Lagos',
  status text not null default 'scheduled',
  source_id uuid references public.election_sources(id) on delete set null,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.candidate_records (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete cascade,
  candidate_id uuid references public.candidates(id) on delete set null,
  full_name text not null,
  party_id uuid references public.parties(id) on delete set null,
  position text,
  constituency text,
  ballot_order integer,
  status text not null default 'published',
  photo_url text,
  particulars jsonb not null default '{}'::jsonb,
  source_id uuid references public.election_sources(id) on delete set null,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.candidate_changes (
  id uuid primary key default gen_random_uuid(),
  candidate_record_id uuid not null references public.candidate_records(id) on delete cascade,
  change_type text not null,
  previous_data jsonb,
  new_data jsonb not null,
  source_id uuid references public.election_sources(id) on delete set null,
  detected_at timestamptz not null default now()
);

create table if not exists public.election_updates (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete cascade,
  update_type text not null,
  title text not null,
  summary text,
  published_at timestamptz,
  source_id uuid references public.election_sources(id) on delete set null,
  content_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(election_id, content_hash)
);

create table if not exists public.election_statistics (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete cascade,
  registered_voters integer,
  collected_pvcs integer,
  polling_units_expected integer,
  result_sheets_expected integer,
  result_sheets_uploaded integer,
  candidates_count integer,
  parties_count integer,
  updated_at timestamptz not null default now(),
  source_id uuid references public.election_sources(id) on delete set null,
  unique(election_id)
);

create table if not exists public.election_operating_rules (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete cascade,
  rule_key text not null,
  rule_name text not null,
  value jsonb not null,
  source_id uuid references public.election_sources(id) on delete set null,
  effective_from timestamptz,
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  unique(election_id, rule_key, effective_from)
);

create index if not exists idx_election_sources_election on public.election_sources(election_id);
create index if not exists idx_election_timeline_election on public.election_timeline(election_id, starts_at);
create index if not exists idx_candidate_records_election on public.candidate_records(election_id, status);
create index if not exists idx_candidate_changes_record on public.candidate_changes(candidate_record_id, detected_at);
create index if not exists idx_election_updates_election on public.election_updates(election_id, published_at);
create index if not exists idx_election_sources_hash on public.election_sources(content_hash);

alter table public.election_sources enable row level security;
alter table public.election_timeline enable row level security;
alter table public.candidate_records enable row level security;
alter table public.candidate_changes enable row level security;
alter table public.election_updates enable row level security;
alter table public.election_statistics enable row level security;
alter table public.election_operating_rules enable row level security;

create policy "public read election sources" on public.election_sources for select using (true);
create policy "public read election timeline" on public.election_timeline for select using (true);
create policy "public read candidate records" on public.candidate_records for select using (true);
create policy "public read candidate changes" on public.candidate_changes for select using (true);
create policy "public read election updates" on public.election_updates for select using (true);
create policy "public read election statistics" on public.election_statistics for select using (true);
create policy "public read election operating rules" on public.election_operating_rules for select using (true);
