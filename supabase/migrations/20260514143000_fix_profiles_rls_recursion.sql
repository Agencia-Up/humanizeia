-- Fix recursive profiles RLS policy.
-- The old policy queried public.profiles from inside a profiles policy, which
-- makes Postgres re-enter the same RLS policy and fail with infinite recursion.

create or replace function public.is_current_user_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select p.is_superadmin
      from public.profiles p
      where p.id = auth.uid()
      limit 1
    ),
    false
  );
$$;

revoke all on function public.is_current_user_superadmin() from public;
grant execute on function public.is_current_user_superadmin() to authenticated;

drop policy if exists "SuperAdmins or owner can view profiles" on public.profiles;

create policy "SuperAdmins or owner can view profiles"
on public.profiles
for select
using (
  public.is_current_user_superadmin()
  or auth.uid() = id
);
