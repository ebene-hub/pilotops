-- Pilot Ops — secure admin sign-up (first-run bootstrap).
--
-- SECURITY: the profile-creation trigger must NOT trust client-supplied
-- is_admin/admin_role (a client could otherwise sign up as admin by passing
-- {is_admin:true} metadata). Admin status is granted ONLY by:
--   • claim_first_admin()  — the very first account, when no admin exists yet
--   • set_member_admin()   — an existing admin promoting someone
--   • the service-role bootstrap script (direct DB update)

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.profiles (id, email, full_name, initials, is_admin, admin_role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'initials',
             upper(left(coalesce(new.raw_user_meta_data->>'full_name', 'U'), 1))),
    false,   -- never trust the client for admin status
    null
  )
  on conflict (id) do nothing;
  return new;
end; $$;

-- Anyone may check whether an admin already exists (drives the sign-up UI).
create or replace function admin_exists()
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from profiles where is_admin);
$$;
grant execute on function admin_exists() to anon, authenticated;

-- The first authenticated user may claim admin — only while none exists.
create or replace function claim_first_admin()
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare cnt int;
begin
  perform pg_advisory_xact_lock(990001);          -- serialize the first-admin race
  select count(*) into cnt from profiles where is_admin;
  if cnt = 0 then
    update profiles set is_admin = true, admin_role = 'Ops Director' where id = auth.uid();
    insert into member_roles(profile_id, role_id)
      select auth.uid(), id from roles where name = 'Director'
    on conflict do nothing;
    return true;
  end if;
  return false;
end; $$;
grant execute on function claim_first_admin() to authenticated;
