-- 0024_pilot_lockout.sql
-- Pilot launch-code lockout: notify admins when a pilot locks themselves out with
-- too many wrong codes, and give admins an override to clear the lockout.
-- The lockout itself is unchanged (3 failed codes in 15 min, enforced from the
-- auth_attempts table by verify_pilot_code).

-- 1. verify_pilot_code: on the attempt that TRIPS the lockout (once), drop an
--    org-scoped notification so admins see it in the console bell. Otherwise
--    identical to 0010.
create or replace function verify_pilot_code(p_pilot uuid, p_code text, p_context text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_hash text;
  v_recent int;
  v_ok boolean;
  v_max int := 3;
  v_window interval := interval '15 minutes';
  v_last_fail timestamptz;
  v_kyc text;
  v_name text;
begin
  select kyc_status, full_name into v_kyc, v_name from profiles where id = p_pilot;
  if v_kyc is distinct from 'verified' then
    return jsonb_build_object('ok', false, 'kyc', false,
      'reason', 'Your account is pending KYC verification by an admin — you can''t start missions yet.');
  end if;

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

  -- This failure trips the lock → notify admins, exactly once (on the locking try).
  if (v_recent + 1) >= v_max then
    insert into notifications(type, payload)
      values ('lockout', jsonb_build_object(
        'pilot_id', p_pilot, 'pilot', coalesce(v_name, 'A pilot'), 'context', p_context));
  end if;

  return jsonb_build_object('ok', false, 'locked', (v_recent + 1) >= v_max,
    'attempts_remaining', greatest(0, v_max - (v_recent + 1)));
end; $$;

-- 2. Currently-locked pilots in the admin's org (>=3 failed codes in the last
--    15 min). Admin-only.
create or replace function admin_pilot_lockouts()
returns table(profile_id uuid, full_name text, fails int, last_fail timestamptz, locked_until timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not auth_is_admin() then raise exception 'admin only'; end if;
  return query
    select a.profile_id, p.full_name, count(*)::int as fails,
           max(a.ts) as last_fail, (max(a.ts) + interval '15 minutes') as locked_until
      from auth_attempts a
      join profiles p on p.id = a.profile_id
     where a.ok = false
       and a.ts > now() - interval '15 minutes'
       and p.org_id = auth_org()
     group by a.profile_id, p.full_name
    having count(*) >= 3;
end; $$;
grant execute on function admin_pilot_lockouts() to authenticated;

-- 3. Admin override: forgive a pilot's recent failed attempts so they can retry
--    immediately. Admin-only, scoped to the admin's org, audit-logged.
create or replace function admin_clear_pilot_lockout(p_pilot uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not auth_is_admin() then raise exception 'admin only'; end if;
  if not exists (select 1 from profiles where id = p_pilot and org_id = auth_org()) then
    raise exception 'not in your organization';
  end if;
  delete from auth_attempts
   where profile_id = p_pilot and ok = false and ts > now() - interval '15 minutes';
  insert into audit_log(actor_id, actor_name, kind, context, detail)
    values (auth.uid(), (select full_name from profiles where id = auth.uid()),
            'lockout_override', p_pilot::text,
            jsonb_build_object('pilot', (select full_name from profiles where id = p_pilot)));
end; $$;
grant execute on function admin_clear_pilot_lockout(uuid) to authenticated;
