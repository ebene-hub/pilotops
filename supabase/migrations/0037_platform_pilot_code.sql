-- 0037_platform_pilot_code.sql
-- Platform-gated launch-code setter. The existing set_pilot_code (0005) gates on
-- auth_is_admin() OR self — a platform super-admin (no tenant org) can't use it.
-- This variant lets a platform admin (re)set ANY member's 6-digit launch code, and
-- also lets the service-role gateway set it (auth.uid() is null in that context),
-- which the /platform/create-demo-pilot endpoint relies on.
--
-- The code stays hashed (bcrypt) and unreadable; it can be reset+revealed once,
-- never read back — same rule as the tenant flow.

create or replace function platform_set_pilot_code(p_profile uuid, p_code text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  -- Allow: a signed-in platform admin, OR the service role (no auth.uid()).
  if auth.uid() is not null and not auth_is_platform_admin() then
    raise exception 'platform admin only';
  end if;
  if p_code !~ '^[0-9]{6}$' then raise exception 'code must be 6 digits'; end if;
  update profiles set pilot_code_hash = crypt(p_code, gen_salt('bf')), pilot_code_set = true where id = p_profile;
  if not found then raise exception 'profile not found'; end if;
end; $$;
-- authenticated → platform admins (checked in-body); service_role → the gateway.
grant execute on function platform_set_pilot_code(uuid, text) to authenticated, service_role;
