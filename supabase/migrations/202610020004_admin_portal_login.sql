create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

drop policy if exists "admins can read own admin record" on public.admin_users;
create policy "admins can read own admin record"
  on public.admin_users for select to authenticated
  using (user_id = auth.uid());

create or replace function public.can_bootstrap_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.admin_users);
$$;

create or replace function public.bootstrap_first_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.admin_users) then
    return false;
  end if;
  if auth.uid() is null then
    return false;
  end if;
  insert into public.admin_users (user_id) values (auth.uid())
  on conflict do nothing;
  return exists (select 1 from public.admin_users where user_id = auth.uid());
end;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

revoke all on function public.can_bootstrap_admin() from public;
revoke all on function public.bootstrap_first_admin() from public;
revoke all on function public.is_admin() from public;
grant execute on function public.can_bootstrap_admin() to anon, authenticated;
grant execute on function public.bootstrap_first_admin() to authenticated;
grant execute on function public.is_admin() to authenticated;
