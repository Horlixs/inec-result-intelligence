-- PostgREST does not support overloaded database functions reliably. The
-- review workspace now always supplies p_removed_entry_ids, so keep exactly
-- one public save_result_review signature and make that signature progressive.

drop function if exists public.save_result_review(uuid, uuid, jsonb, text, text);
drop function if exists public.save_result_review(uuid, uuid, jsonb, text, text, uuid[]);

create function public.save_result_review(
  p_result_sheet_id uuid,
  p_polling_unit_id uuid,
  p_entries jsonb,
  p_action text default 'save',
  p_note text default null,
  p_removed_entry_ids uuid[] default '{}'::uuid[]
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_extraction_id uuid;
  v_existing jsonb := '[]'::jsonb;
  v_merged jsonb := '[]'::jsonb;
  v_existing_item jsonb;
  v_submitted_item jsonb;
  v_item jsonb;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;

  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'Candidate entries must be an array';
  end if;

  if p_action not in ('save', 'approve', 'reject') then
    raise exception 'Invalid review action';
  end if;

  select id
    into v_extraction_id
  from public.extractions
  where result_sheet_id = p_result_sheet_id
  order by created_at desc
  limit 1;

  if v_extraction_id is null then
    raise exception 'No extraction exists for this result sheet';
  end if;

  -- Load the persisted state first. An empty submission therefore means
  -- "change no candidate rows", not "delete every candidate row".
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', re.id,
      'candidate_id', re.candidate_id,
      'label', re.label,
      'votes', re.votes,
      'raw_label', re.raw_label,
      'raw_value', re.raw_value
    ) order by re.created_at, re.id
  ), '[]'::jsonb)
  into v_existing
  from public.result_entries re
  where re.extraction_id = v_extraction_id
    and not (re.id = any(coalesce(p_removed_entry_ids, '{}'::uuid[])));

  -- Existing rows are patched by ID. Fields omitted from a patch remain as
  -- they were; previous manual corrections therefore survive later edits.
  for v_existing_item in select value from jsonb_array_elements(v_existing) loop
    v_submitted_item := null;

    for v_item in select value from jsonb_array_elements(p_entries) loop
      if nullif(trim(v_item->>'id'), '') is not null
         and nullif(trim(v_existing_item->>'id'), '') is not null
         and (v_item->>'id')::uuid = (v_existing_item->>'id')::uuid then
        v_submitted_item := v_item;
        exit;
      end if;
    end loop;

    if v_submitted_item is null then
      v_merged := v_merged || jsonb_build_array(v_existing_item);
    else
      v_merged := v_merged || jsonb_build_array(v_existing_item || v_submitted_item);
    end if;
  end loop;

  -- Rows without an ID are new manual entries and are appended.
  for v_item in select value from jsonb_array_elements(p_entries) loop
    if nullif(trim(v_item->>'id'), '') is null then
      v_merged := v_merged || jsonb_build_array(v_item);
    end if;
  end loop;

  -- Apply the complete merged state using the same atomic result-review
  -- transaction that updates extraction/sheet state and creates the audit
  -- records. The merged payload makes audit entry_count reflect final state.
  insert into public.review_edits(
    result_sheet_id,
    extraction_id,
    reviewer_id,
    action,
    note,
    before_state,
    after_state
  )
  values (
    p_result_sheet_id,
    v_extraction_id,
    auth.uid(),
    p_action,
    nullif(trim(coalesce(p_note, '')), ''),
    coalesce((select jsonb_agg(jsonb_build_object(
      'id', re.id,
      'candidate_id', re.candidate_id,
      'label', re.label,
      'votes', re.votes,
      'raw_label', re.raw_label,
      'raw_value', re.raw_value
    ) order by re.created_at, re.id)
    from public.result_entries re
    where re.extraction_id = v_extraction_id), '[]'::jsonb),
    v_merged
  );

  -- Replace only the rows belonging to this extraction with the merged state.
  -- Existing rows retain their IDs; new rows receive generated IDs.
  delete from public.result_entries
  where extraction_id = v_extraction_id
    and (p_removed_entry_ids is null or id = any(coalesce(p_removed_entry_ids, '{}'::uuid[])));

  for v_item in select value from jsonb_array_elements(v_merged) loop
    if nullif(trim(v_item->>'id'), '') is not null then
      update public.result_entries
      set
        candidate_id = nullif(v_item->>'candidate_id', '')::uuid,
        label = coalesce(v_item->>'label', label),
        votes = case when v_item ? 'votes' and v_item->>'votes' <> '' then (v_item->>'votes')::integer else votes end,
        raw_label = coalesce(v_item->>'raw_label', raw_label),
        raw_value = coalesce(v_item->>'raw_value', raw_value)
      where id = (v_item->>'id')::uuid
        and extraction_id = v_extraction_id;
    else
      insert into public.result_entries(extraction_id, candidate_id, label, votes, raw_label, raw_value)
      values (
        v_extraction_id,
        nullif(v_item->>'candidate_id', '')::uuid,
        coalesce(v_item->>'label', ''),
        case when v_item ? 'votes' and v_item->>'votes' <> '' then (v_item->>'votes')::integer else null end,
        nullif(v_item->>'raw_label', ''),
        nullif(v_item->>'raw_value', '')
      );
    end if;
  end loop;

  update public.result_sheets
  set
    polling_unit_id = p_polling_unit_id,
    reviewed_at = now(),
    reviewed_by = auth.uid(),
    review_note = nullif(trim(coalesce(p_note, '')), ''),
    status = case when p_action = 'approve' then 'verified' else 'pending_review' end
  where id = p_result_sheet_id;

  update public.extractions
  set status = case when p_action = 'approve' then 'verified' else 'reviewed' end
  where id = v_extraction_id;

  insert into public.validation_checks(extraction_id, check_name, passed, severity, details)
  values (
    v_extraction_id,
    'manual_review',
    true,
    'info',
    jsonb_build_object(
      'action', p_action,
      'reviewer_id', auth.uid(),
      'polling_unit_id', p_polling_unit_id,
      'entry_count', jsonb_array_length(v_merged),
      'note', nullif(trim(coalesce(p_note, '')), '')
    )
  );

  return true;
end;
$$;

revoke all on function public.save_result_review(uuid, uuid, jsonb, text, text, uuid[]) from public;
grant execute on function public.save_result_review(uuid, uuid, jsonb, text, text, uuid[]) to authenticated;
