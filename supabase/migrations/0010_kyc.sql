-- Pilot Ops — member KYC at registration + admin verification.
-- Two-tier: operating crew (Pilot/Co-pilot) provide phone + license + DOB/gov-ID;
-- other members provide phone + job title only. New members start 'pending' and
-- an admin must verify them before they can start missions.

alter table profiles
  add column if not exists phone           text,
  add column if not exists dob             date,
  add column if not exists gov_id          text,
  add column if not exists license_class   text,
  add column if not exists license_expiry  date,
  add column if not exists job_title       text,
  add column if not exists kyc_status      text not null default 'pending',
  add column if not exists kyc_submitted_at timestamptz;

-- Grandfather pre-KYC members (don't lock out current members/admins). Guarded
-- so re-running this migration never re-verifies someone who has since submitted
-- KYC and is awaiting review: those rows have kyc_submitted_at set.
update profiles set kyc_status = 'verified'
 where kyc_status = 'pending' and kyc_submitted_at is null;

-- A member may write their own KYC *data*, but NOT their verification status.
-- authenticated has column-level UPDATE on profiles, so kyc_status is simply
-- never granted — it can only be changed by the admin definer RPC below.
grant select (phone, dob, gov_id, license_class, license_expiry, job_title, kyc_status, kyc_submitted_at) on profiles to authenticated;
grant update (phone, dob, gov_id, license_class, license_expiry, job_title) on profiles to authenticated;

-- Admin-only verification (scoped to the admin's org).
create or replace function set_kyc_status(p_profile uuid, p_status text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not auth_is_admin() then raise exception 'admin only'; end if;
  if p_status not in ('pending','verified','rejected') then raise exception 'invalid status'; end if;
  update profiles set kyc_status = p_status where id = p_profile and org_id = auth_org();
end; $$;
grant execute on function set_kyc_status(uuid, text) to authenticated;

-- A founding admin (self-service org creation) is auto-verified.
create or replace function create_org_and_claim(p_name text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare new_org uuid;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'organization name required'; end if;
  if (select org_id from profiles where id = auth.uid()) is not null then
    raise exception 'you already belong to an organization';
  end if;
  insert into organizations(name) values (trim(p_name)) returning id into new_org;
  update profiles set org_id = new_org, is_admin = true, admin_role = 'Ops Director', kyc_status = 'verified' where id = auth.uid();
  perform seed_org_config(new_org);
  insert into member_roles(profile_id, role_id, org_id)
    select auth.uid(), id, new_org from roles where name = 'Director' and org_id = new_org
  on conflict do nothing;
  return new_org;
end; $$;

-- Mission-start gate: the pilot-in-command must be KYC-verified. This is the
-- server-side choke point (called when a mission is started); an unverified
-- pilot is blocked here without consuming a code attempt.
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
begin
  select kyc_status into v_kyc from profiles where id = p_pilot;
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
  return jsonb_build_object('ok', false, 'locked', (v_recent + 1) >= v_max,
    'attempts_remaining', greatest(0, v_max - (v_recent + 1)));
end; $$;
