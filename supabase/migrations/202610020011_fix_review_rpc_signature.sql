-- PostgREST does not support overloaded functions reliably. Keep one
-- save_result_review signature and make that signature progressive.

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
  v_sheet public.result_sheets%rowtype;
  v_extraction public.extractions%rowtype;
  v_pu public.polling_units%rowtype;
  v_previous jsonb;
  v_next jsonb;
  v_existing jsonb := '[]'::jsonb;
  v_merged jsonb := '[]'::jsonb;
  v_existing_item jsonb;
  v_submitted_item jsonb;
  v_item jsonb;
  v_label text;
  v_votes integer;
  v_candidate_id uuid;
  v_entry_id uuid;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_action not in ('save','approve','reject') then raise exception 'Invalid review action'; end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then raise exception 'Candidate entries must be an array'; end if;

  select * into v_sheet from public.result_sheets where id=p_result_sheet_id for update;
  if not found then raise exception 'Result sheet not found'; end if;
  if p_polling_unit_id is null then raise exception 'A polling unit must be selected'; end if;

  select * into v_pu from public.polling_units where id=p_polling_unit_id;
  if not found then raise exception 'Polling unit not found'; end if;

  select * into v_extraction from public.extractions
  where result_sheet_id=p_result_sheet_id order by created_at desc limit 1 for update;
  if not found then raise exception 'No extraction exists for this result sheet'; end if;

  select jsonb_build_object(
    'polling_unit_id',v_sheet.polling_unit_id,
    'entries',coalesce((select jsonb_agg(jsonb_build_object(
      'id',re.id,'candidate_id',re.candidate_id,'label',re.label,'votes',re.votes,
      'raw_label',re.raw_label,'raw_value',re.raw_value
    ) order by re.created_at,re.id) from public.result_entries re where re.extraction_id=v_extraction.id),'[]'::jsonb)
  ) into v_previous;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',re.id,'candidate_id',re.candidate_id,'label',re.label,'votes',re.votes,
    'raw_label',re.raw_label,'raw_value',re.raw_value
  ) order by re.created_at,re.id),'[]'::jsonb)
  into v_existing
  from public.result_entries re
  where re.extraction_id=v_extraction.id
    and not (re.id=any(coalesce(p_removed_entry_ids,'{}'::uuid[])));

  -- Merge submitted patches into persisted rows. An empty submission preserves
  -- all existing rows; omitted fields remain untouched.
  for v_existing_item in select value from jsonb_array_elements(v_existing) loop
    v_submitted_item := null;
    for v_item in select value from jsonb_array_elements(p_entries) loop
      if nullif(trim(v_item->>'id'),'') is not null
         and nullif(trim(v_existing_item->>'id'),'') is not null
         and (v_item->>'id')::uuid=(v_existing_item->>'id')::uuid then
        v_submitted_item:=v_item; exit;
      end if;
    end loop;
    if v_submitted_item is null then
      v_merged:=v_merged||jsonb_build_array(v_existing_item);
    else
      v_merged:=v_merged||jsonb_build_array(v_existing_item||v_submitted_item);
    end if;
  end loop;

  -- New manual rows have no persisted ID and are appended.
  for v_item in select value from jsonb_array_elements(p_entries) loop
    if nullif(trim(v_item->>'id'),'') is null then
      v_merged:=v_merged||jsonb_build_array(v_item);
    end if;
  end loop;

  if p_action='approve' and jsonb_array_length(v_merged)=0 then
    raise exception 'At least one candidate or result label is required before approval';
  end if;

  -- Validate the complete resulting state before modifying persisted rows.
  for v_item in select value from jsonb_array_elements(v_merged) loop
    v_label:=nullif(trim(v_item->>'label'),'');
    if v_label is null then raise exception 'Every candidate/result label must be filled in'; end if;
    if nullif(trim(v_item->>'votes'),'') is not null then
      begin v_votes:=(v_item->>'votes')::integer;
      exception when invalid_text_representation then raise exception 'Votes must be whole numbers'; end;
      if v_votes<0 then raise exception 'Votes cannot be negative'; end if;
    end if;
    if nullif(trim(v_item->>'candidate_id'),'') is not null then
      begin v_candidate_id:=(v_item->>'candidate_id')::uuid;
      exception when invalid_text_representation then raise exception 'Invalid candidate reference'; end;
      if not exists (select 1 from public.candidates c where c.id=v_candidate_id and c.election_id=v_sheet.election_id) then
        raise exception 'Selected candidate does not belong to this election';
      end if;
    end if;
  end loop;

  -- Update existing rows and append new rows. Explicitly removed rows are not
  -- included in v_merged and therefore remain deleted.
  for v_item in select value from jsonb_array_elements(v_merged) loop
    v_entry_id:=null;
    if nullif(trim(v_item->>'id'),'') is not null then
      begin v_entry_id:=(v_item->>'id')::uuid;
      exception when invalid_text_representation then raise exception 'Invalid result entry id'; end;
    end if;

    if v_entry_id is not null then
      update public.result_entries
      set candidate_id=case when v_item ? 'candidate_id' then nullif(v_item->>'candidate_id','')::uuid else candidate_id end,
          label=case when v_item ? 'label' then nullif(trim(v_item->>'label'),'') else label end,
          votes=case when v_item ? 'votes' and nullif(trim(v_item->>'votes'),'') is not null then (v_item->>'votes')::integer when v_item ? 'votes' then null else votes end,
          raw_label=case when v_item ? 'raw_label' then nullif(trim(v_item->>'raw_label'),'') else raw_label end,
          raw_value=case when v_item ? 'votes' then nullif(v_item->>'votes','') else raw_value end
      where id=v_entry_id and extraction_id=v_extraction.id;
      if not found then raise exception 'Result entry does not belong to this extraction'; end if;
    else
      insert into public.result_entries(extraction_id,candidate_id,label,votes,raw_label,raw_value)
      values(v_extraction.id,nullif(v_item->>'candidate_id','')::uuid,
        nullif(trim(v_item->>'label'),''),
        case when nullif(trim(v_item->>'votes'),'') is not null then (v_item->>'votes')::integer else null end,
        nullif(trim(v_item->>'raw_label'),''),nullif(v_item->>'votes',''));
    end if;
  end loop;

  select jsonb_build_object(
    'polling_unit_id',p_polling_unit_id,'polling_unit_name',v_pu.name,'polling_unit_code',v_pu.pu_code,
    'entries',coalesce((select jsonb_agg(jsonb_build_object(
      'id',re.id,'candidate_id',re.candidate_id,'label',re.label,'votes',re.votes,
      'raw_label',re.raw_label,'raw_value',re.raw_value
    ) order by re.created_at,re.id) from public.result_entries re where re.extraction_id=v_extraction.id),'[]'::jsonb)
  ) into v_next;

  update public.extractions
  set status=case when p_action='approve' then 'verified' else 'pending_review' end,
      raw_output=coalesce(raw_output,'{}'::jsonb)||jsonb_build_object(
        'pollingUnitName',v_pu.name,'pollingUnitCode',v_pu.pu_code,'candidates',coalesce(v_next->'entries','[]'::jsonb))
  where id=v_extraction.id;

  update public.result_sheets
  set polling_unit_id=p_polling_unit_id,status=case when p_action='approve' then 'verified' else 'pending_review' end,
      reviewed_at=now(),reviewed_by=auth.uid(),review_note=nullif(trim(coalesce(p_note,'')),''),last_error=null
  where id=p_result_sheet_id;

  insert into public.validation_checks(extraction_id,check_name,passed,severity,details)
  values(v_extraction.id,'manual_review',true,'info',jsonb_build_object(
    'action',p_action,'reviewer_id',auth.uid(),'polling_unit_id',p_polling_unit_id,
    'entry_count',jsonb_array_length(v_next->'entries'),'note',nullif(trim(coalesce(p_note,'')),'')
  ));

  insert into public.review_edits(result_sheet_id,reviewer_id,action,previous_state,next_state,note)
  values(p_result_sheet_id,auth.uid(),p_action,coalesce(v_previous,'{}'::jsonb),coalesce(v_next,'{}'::jsonb),nullif(trim(coalesce(p_note,'')),''));

  return true;
end;
$$;

revoke all on function public.save_result_review(uuid,uuid,jsonb,text,text,uuid[]) from public;
grant execute on function public.save_result_review(uuid,uuid,jsonb,text,text,uuid[]) to authenticated;
