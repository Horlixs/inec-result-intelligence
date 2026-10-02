-- Progressive manual review updates.
-- The UI may submit only changed rows; this wrapper merges those changes into the
-- current extraction and lets the existing atomic review function persist the merged state.
-- Explicitly removed IDs are excluded from the merged payload.

create or replace function public.save_result_review(
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
  v_existing jsonb;
  v_submitted jsonb;
  v_merged jsonb;
  v_item jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'Candidate entries must be an array';
  end if;

  select id into v_extraction_id
  from public.extractions
  where result_sheet_id = p_result_sheet_id
  order by created_at desc
  limit 1;

  if v_extraction_id is null then raise exception 'No extraction exists for this result sheet'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', re.id,
    'candidate_id', re.candidate_id,
    'label', re.label,
    'votes', re.votes,
    'raw_label', re.raw_label,
    'raw_value', re.raw_value
  ) order by re.created_at, re.id), '[]'::jsonb)
  into v_existing
  from public.result_entries re
  where re.extraction_id = v_extraction_id
    and not (re.id = any(coalesce(p_removed_entry_ids, '{}'::uuid[])));

  -- Merge by result-entry ID. Existing fields remain untouched when a submitted
  -- change does not provide a replacement value. New rows are appended.
  select coalesce(jsonb_agg(
    case
      when submitted.item is not null then existing.item || submitted.item
      else existing.item
    end
    order by existing.ord
  ), '[]'::jsonb)
  into v_merged
  from jsonb_array_elements(v_existing) with ordinality as existing(item, ord)
  left join lateral (
    select item
    from jsonb_array_elements(p_entries) submitted(item)
    where nullif(trim(submitted.item->>'id'), '') is not null
      and (submitted.item->>'id')::uuid = (existing.item->>'id')::uuid
    limit 1
  ) submitted on true;

  for v_item in select item from jsonb_array_elements(p_entries) loop
    if nullif(trim(v_item->>'id'), '') is null then
      v_merged := v_merged || jsonb_build_array(v_item);
    end if;
  end loop;

  return public.save_result_review(
    p_result_sheet_id,
    p_polling_unit_id,
    v_merged,
    p_action,
    p_note
  );
end;
$$;

revoke all on function public.save_result_review(uuid,uuid,jsonb,text,text,uuid[]) from public;
grant execute on function public.save_result_review(uuid,uuid,jsonb,text,text,uuid[]) to authenticated;
