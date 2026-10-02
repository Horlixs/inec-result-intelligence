create table if not exists public.review_edits (
  id uuid primary key default gen_random_uuid(),
  result_sheet_id uuid not null references public.result_sheets(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('save','approve','reject')),
  previous_state jsonb not null default '{}'::jsonb,
  next_state jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now()
);

alter table public.review_edits enable row level security;

drop policy if exists "admins can read review edits" on public.review_edits;
create policy "admins can read review edits"
  on public.review_edits for select to authenticated
  using (public.is_admin());

create or replace function public.save_result_review(
  p_result_sheet_id uuid,
  p_polling_unit_id uuid,
  p_entries jsonb,
  p_action text default 'save',
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sheet public.result_sheets%rowtype;
  v_extraction public.extractions%rowtype;
  v_pu public.polling_units%rowtype;
  v_previous jsonb;
  v_next jsonb;
  v_entry jsonb;
  v_entry_id uuid;
  v_label text;
  v_votes integer;
  v_candidate_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;

  if p_action not in ('save', 'approve', 'reject') then
    raise exception 'Invalid review action';
  end if;

  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'Candidate entries must be an array';
  end if;

  select * into v_sheet
  from public.result_sheets
  where id = p_result_sheet_id
  for update;

  if not found then
    raise exception 'Result sheet not found';
  end if;

  if p_polling_unit_id is null then
    raise exception 'A polling unit must be selected';
  end if;

  select * into v_pu
  from public.polling_units
  where id = p_polling_unit_id;

  if not found then
    raise exception 'Polling unit not found';
  end if;

  if p_action = 'approve' and jsonb_array_length(p_entries) = 0 then
    raise exception 'At least one candidate or result label is required before approval';
  end if;

  for v_entry in select value from jsonb_array_elements(p_entries) loop
    v_label := nullif(trim(v_entry->>'label'), '');
    if v_label is null then
      raise exception 'Every candidate/result label must be filled in';
    end if;

    if v_entry ? 'votes' and v_entry->>'votes' is not null and trim(v_entry->>'votes') <> '' then
      begin
        v_votes := (v_entry->>'votes')::integer;
      exception when invalid_text_representation then
        raise exception 'Votes must be whole numbers';
      end;

      if v_votes < 0 then
        raise exception 'Votes cannot be negative';
      end if;
    else
      v_votes := null;
    end if;

    if v_entry ? 'candidate_id' and nullif(trim(v_entry->>'candidate_id'), '') is not null then
      begin
        v_candidate_id := (v_entry->>'candidate_id')::uuid;
      exception when invalid_text_representation then
        raise exception 'Invalid candidate reference';
      end;

      if not exists (
        select 1
        from public.candidates c
        where c.id = v_candidate_id
          and c.election_id = v_sheet.election_id
      ) then
        raise exception 'Selected candidate does not belong to this election';
      end if;
    end if;
  end loop;

  select jsonb_build_object(
    'polling_unit_id', v_sheet.polling_unit_id,
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', re.id,
        'candidate_id', re.candidate_id,
        'label', re.label,
        'votes', re.votes,
        'raw_label', re.raw_label,
        'raw_value', re.raw_value
      ) order by re.created_at, re.id)
      from public.result_entries re
      where re.extraction_id = ex.id
    ), '[]'::jsonb)
  ) into v_previous
  from public.extractions ex
  where ex.result_sheet_id = p_result_sheet_id
  order by ex.created_at desc
  limit 1;

  select * into v_extraction
  from public.extractions
  where result_sheet_id = p_result_sheet_id
  order by created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'No extraction exists for this result sheet';
  end if;

  for v_entry in
    select value from jsonb_array_elements(p_entries)
  loop
    v_entry_id := null;
    if nullif(trim(v_entry->>'id'), '') is not null then
      begin
        v_entry_id := (v_entry->>'id')::uuid;
      exception when invalid_text_representation then
        raise exception 'Invalid result entry id';
      end;
    end if;

    v_label := nullif(trim(v_entry->>'label'), '');
    if v_entry ? 'votes' and v_entry->>'votes' is not null and trim(v_entry->>'votes') <> '' then
      v_votes := (v_entry->>'votes')::integer;
    else
      v_votes := null;
    end if;

    v_candidate_id := null;
    if nullif(trim(v_entry->>'candidate_id'), '') is not null then
      v_candidate_id := (v_entry->>'candidate_id')::uuid;
    end if;

    if v_entry_id is not null then
      update public.result_entries
      set
        candidate_id = v_candidate_id,
        label = v_label,
        votes = v_votes,
        raw_label = coalesce(nullif(trim(v_entry->>'raw_label'), ''), raw_label),
        raw_value = case when v_votes is null then null else v_votes::text end
      where id = v_entry_id
        and extraction_id = v_extraction.id;

      if not found then
        raise exception 'Result entry does not belong to this extraction';
      end if;
    else
      insert into public.result_entries (
        extraction_id, candidate_id, label, votes, raw_label, raw_value
      )
      values (
        v_extraction.id,
        v_candidate_id,
        v_label,
        v_votes,
        v_label,
        case when v_votes is null then null else v_votes::text end
      );
    end if;
  end loop;

  delete from public.result_entries re
  where re.extraction_id = v_extraction.id
    and not exists (
      select 1
      from jsonb_array_elements(p_entries) item
      where nullif(trim(item->>'id'), '') is not null
        and (item->>'id')::uuid = re.id
    );

  select jsonb_build_object(
    'polling_unit_id', p_polling_unit_id,
    'polling_unit_name', v_pu.name,
    'polling_unit_code', v_pu.pu_code,
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', re.id,
        'candidate_id', re.candidate_id,
        'label', re.label,
        'votes', re.votes,
        'raw_label', re.raw_label,
        'raw_value', re.raw_value
      ) order by re.created_at, re.id)
      from public.result_entries re
      where re.extraction_id = v_extraction.id
    ), '[]'::jsonb)
  ) into v_next;

  update public.extractions
  set
    status = case when p_action = 'approve' then 'verified' when p_action = 'reject' then 'pending_review' else 'pending_review' end,
    raw_output = raw_output || jsonb_build_object(
      'pollingUnitName', v_pu.name,
      'pollingUnitCode', v_pu.pu_code,
      'candidates', coalesce(v_next->'entries', '[]'::jsonb)
    )
  where id = v_extraction.id;

  update public.result_sheets
  set
    polling_unit_id = p_polling_unit_id,
    status = case when p_action = 'approve' then 'verified' when p_action = 'reject' then 'pending_review' else 'pending_review' end,
    reviewed_at = now(),
    reviewed_by = auth.uid(),
    review_note = nullif(trim(coalesce(p_note, '')), ''),
    last_error = null
  where id = p_result_sheet_id;

  insert into public.validation_checks (
    extraction_id, check_name, passed, severity, details
  )
  values (
    v_extraction.id,
    'manual_review',
    p_action = 'approve',
    'info',
    jsonb_build_object(
      'action', p_action,
      'reviewer_id', auth.uid(),
      'polling_unit_id', p_polling_unit_id,
      'entry_count', jsonb_array_length(p_entries),
      'note', nullif(trim(coalesce(p_note, '')), '')
    )
  );

  insert into public.review_edits (
    result_sheet_id, reviewer_id, action, previous_state, next_state, note
  )
  values (
    p_result_sheet_id, auth.uid(), p_action,
    coalesce(v_previous, '{}'::jsonb),
    coalesce(v_next, '{}'::jsonb),
    nullif(trim(coalesce(p_note, '')), '')
  );

  return true;
end;
$$;

revoke all on function public.save_result_review(uuid,uuid,jsonb,text,text) from public;
grant execute on function public.save_result_review(uuid,uuid,jsonb,text,text) to authenticated;
