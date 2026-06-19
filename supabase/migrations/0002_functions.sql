-- Pilot Ops — security-definer functions & triggers
-- These run as the table owner, so security-sensitive logic (code hashing,
-- lockout, invite acceptance) lives here rather than in the client.

-- Auto-create a profile row when an auth user is created (sign-up / invite). --
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
    coalesce((new.raw_user_meta_data->>'is_admin')::boolean, false),
    new.raw_user_meta_data->>'admin_role'
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function handle_new_user();

-- Is the current user an admin? (used by RLS policies) -----------------------
create or replace function auth_is_admin()
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

-- Set a pilot's 6-digit code (hashed). Admin or the user themselves. ---------
create or replace function set_pilot_code(p_profile uuid, p_code text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not (auth_is_admin() or auth.uid() = p_profile) then
    raise exception 'not authorized';
  end if;
  if p_code !~ '^[0-9]{6}$' then
    raise exception 'code must be 6 digits';
  end if;
  update profiles set pilot_code_hash = crypt(p_code, gen_salt('bf')) where id = p_profile;
end; $$;

-- Verify a pilot code before launch. Server-side lockout (3 fails / 15 min). -
create or replace function verify_pilot_code(p_pilot uuid, p_code text, p_context text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_hash text;
  v_recent int;
  v_ok boolean;
  v_max int := 3;
  v_window interval := interval '15 minutes';
  v_last_fail timestamptz;
begin
  select count(*) into v_recent from auth_attempts
    where profile_id = p_pilot and ok = false and ts > now() - v_window;

  if v_recent >= v_max then
    select max(ts) into v_last_fail from auth_attempts
      where profile_id = p_pilot and ok = false and ts > now() - v_window;
    return jsonb_build_object('ok', false, 'locked', true,
      'locked_until', (v_last_fail + v_window), 'attempts_remaining', 0);
  end if;

  select pilot_code_hash into v_hash from profiles where id = p_pilot;
  v_ok := v_hash is not null and v_hash = crypt(p_code, v_hash);
  insert into auth_attempts(profile_id, ok, context) values (p_pilot, v_ok, p_context);

  if v_ok then
    return jsonb_build_object('ok', true, 'attempts_remaining', v_max);
  end if;
  return jsonb_build_object('ok', false, 'locked', (v_recent + 1) >= v_max,
    'attempts_remaining', greatest(0, v_max - (v_recent + 1)));
end; $$;

-- Count a pilot's emergency launches in the last 30 days (rate-limit guard). -
create or replace function emergency_count_30d(p_pilot uuid)
returns int language sql stable security definer set search_path = public, extensions as $$
  select count(*)::int from flights
   where pilot_id = p_pilot and emergency = true and created_at > now() - interval '30 days';
$$;

-- Invite flow (anon-safe lookup; authenticated acceptance) -------------------
create or replace function get_invite(p_token text)
returns jsonb language sql security definer set search_path = public, extensions as $$
  select case when i.id is null then null else jsonb_build_object(
    'token', i.token, 'email', i.email, 'roles', i.roles,
    'invited_by_name', i.invited_by_name, 'status', i.status,
    'message', i.message, 'expires_at', i.expires_at
  ) end
  from invites i where i.token = p_token;
$$;

create or replace function mark_invite_opened(p_token text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  update invites set status = 'opened', opened_at = now()
  where token = p_token and status = 'pending';
end; $$;

create or replace function accept_invite(p_token text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v invites;
begin
  select * into v from invites where token = p_token;
  if v.id is null then raise exception 'invalid invite'; end if;
  if v.status = 'accepted' then raise exception 'already accepted'; end if;
  if v.status = 'revoked'  then raise exception 'revoked'; end if;
  if v.expires_at < now()  then raise exception 'expired'; end if;

  update invites set status = 'accepted', accepted_at = now() where id = v.id;
  insert into member_roles(profile_id, role_id)
    select auth.uid(), r.id from roles r
     where r.name in (select jsonb_array_elements_text(v.roles))
  on conflict do nothing;
end; $$;

grant execute on function verify_pilot_code(uuid, text, text) to authenticated;
grant execute on function set_pilot_code(uuid, text)          to authenticated;
grant execute on function emergency_count_30d(uuid)           to authenticated;
grant execute on function get_invite(text)                    to anon, authenticated;
grant execute on function mark_invite_opened(text)            to anon, authenticated;
grant execute on function accept_invite(text)                 to authenticated;
