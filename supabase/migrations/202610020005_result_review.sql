alter table public.result_sheets
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid,
  add column if not exists review_note text;

create or replace function public.review_result_sheet(
  p_result_sheet_id uuid,
  p_action text,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;

  if p_action not in ('approve', 'reject') then
    raise exception 'Invalid review action';
  end if;

  update public.result_sheets
  set
    status = case when p_action = 'approve' then 'verified' else 'pending_review' end,
    reviewed_at = now(),
    reviewed_by = auth.uid(),
    review_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_result_sheet_id;

  if not found then
    raise exception 'Result sheet not found';
  end if;

  if p_action = 'reject' then
    update public.extractions
    set status = 'pending_review'
    where result_sheet_id = p_result_sheet_id
      and status <> 'verified';
  end if;

  return true;
end;
$$;

revoke all on function public.review_result_sheet(uuid,text,text) from public;
grant execute on function public.review_result_sheet(uuid,text,text) to authenticated;
