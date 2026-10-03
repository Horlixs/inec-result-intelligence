-- Use a distinct RPC name so PostgREST never has to resolve overloaded
-- save_result_review signatures. The progressive path always merges the
-- submitted patch with the persisted extraction before calling the existing
-- atomic 5-argument review transaction.

create or replace function public.save_result_review_progressive(
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
  v_item jsonb;
  v_existing_item jsonb;
  v_submitted_item jsonb;
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

  -- Start with every persisted row. A submitted row patches only the fields it
  -- actually supplies, so an omitted field cannot erase an earlier correction.
  for v_existing_item in
    select value
    from jsonb_array_elements(v_existing)
  loop
    v_submitted_item := null;

    for v_item in
      select value
      from jsonb_array_elements(p_entries)
    loop
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

  -- New rows have no persisted id, so append them without disturbing existing
  -- OCR/manual rows.
  for v_item in
    select value
    from jsonb_array_elements(p_entries)
  loop
    if nullif(trim(v_item->>'id'), '') is null then
      v_merged := v_merged || jsonb_build_array(v_item);
    end if;
  end loop;

  -- The underlying atomic function receives the complete merged state. This
  -- also makes its audit entry_count reflect the resulting state, not merely
  -- the number of fields/rows submitted in the latest patch.
  return public.save_result_review(
    p_result_sheet_id,
    p_polling_unit_id,
    v_merged,
    p_action,
    p_note
  );
end;
$$;

revoke all on function public.save_result_review_progressive(uuid,uuid,jsonb,text,text,uuid[]) from public;
grant execute on function public.save_result_review_progressive(uuid,uuid,jsonb,text,text,uuid[]) to authenticated;
