-- 0036_platform_rpcs.sql
-- Cross-tenant operations for the platform super-admin console. EVERY function
-- here is SECURITY DEFINER (runs as owner → bypasses RLS) and MUST gate on
-- auth_is_platform_admin() as its first statement. A missing gate = cross-tenant
-- data exposure, so the check is duplicated verbatim in each function on purpose.
--
-- Account creation (auth.users) is NOT here — it needs the Auth Admin API and
-- lives in the stream-gateway (/platform/create-org, /platform/register-pilot).

-- List every organization with license + rollup counts for the console table.
create or replace function platform_list_orgs()
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare result jsonb;
begin
  if not auth_is_platform_admin() then raise exception 'platform admin only'; end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into result
  from (
    select
      o.id, o.name, o.created_at, o.license_status, o.license_expires_at, o.seat_limit,
      (select count(*) from profiles p where p.org_id = o.id)                          as member_count,
      (select count(*) from profiles p where p.org_id = o.id and p.is_admin)           as admin_count,
      (select count(*) from flights f where f.org_id = o.id)                           as flight_count,
      (select count(*) from flights f where f.org_id = o.id and f.status = 'live')      as live_count,
      exists (select 1 from org_email_settings e where e.org_id = o.id and e.active)   as email_active,
      (select p.email from profiles p where p.org_id = o.id and p.is_admin order by p.created_at limit 1) as primary_admin_email
    from organizations o
  ) t;
  return result;
end; $$;
grant execute on function platform_list_orgs() to authenticated;

-- Members of one org (for the manage drawer), with their role names.
create or replace function platform_org_members(p_org uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare result jsonb;
begin
  if not auth_is_platform_admin() then raise exception 'platform admin only'; end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at), '[]'::jsonb) into result
  from (
    select
      p.id, p.full_name, p.email, p.is_admin, p.kyc_status, p.created_at,
      coalesce((
        select jsonb_agg(r.name order by r.name)
        from member_roles mr join roles r on r.id = mr.role_id
        where mr.profile_id = p.id and mr.org_id = p_org
      ), '[]'::jsonb) as roles
    from profiles p
    where p.org_id = p_org
  ) t;
  return result;
end; $$;
grant execute on function platform_org_members(uuid) to authenticated;

-- Set an org's license (status + expiry + seat cap).
create or replace function platform_set_license(p_org uuid, p_status text, p_expires date, p_seats int)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not auth_is_platform_admin() then raise exception 'platform admin only'; end if;
  if p_status is not null and p_status not in ('active','suspended','expired') then
    raise exception 'invalid status %', p_status;
  end if;
  update organizations set
    license_status     = coalesce(p_status, license_status),
    license_expires_at = p_expires,
    seat_limit         = p_seats
  where id = p_org;
  if not found then raise exception 'organization not found'; end if;
end; $$;
grant execute on function platform_set_license(uuid, text, date, int) to authenticated;

-- Rename an org.
create or replace function platform_rename_org(p_org uuid, p_name text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not auth_is_platform_admin() then raise exception 'platform admin only'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name required'; end if;
  update organizations set name = trim(p_name) where id = p_org;
  if not found then raise exception 'organization not found'; end if;
end; $$;
grant execute on function platform_rename_org(uuid, text) to authenticated;

-- Read one org's email settings (non-secret config + booleans for whether a
-- secret is set). Parameterized platform-admin clone of get_org_email_settings
-- (0026/0027) — identical jsonb shape so the console reuses the same form.
create or replace function platform_get_org_email_settings(p_org uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare r org_email_settings;
begin
  if not auth_is_platform_admin() then raise exception 'platform admin only'; end if;
  select * into r from org_email_settings where org_id = p_org;
  if not found then return jsonb_build_object('exists', false); end if;
  return jsonb_build_object(
    'exists', true, 'provider', r.provider, 'from_name', r.from_name, 'from_email', r.from_email,
    'smtp_host', r.smtp_host, 'smtp_port', r.smtp_port, 'smtp_secure', r.smtp_secure,
    'smtp_username', r.smtp_username, 'smtp_allow_invalid_cert', r.smtp_allow_invalid_cert,
    'active', r.active,
    'has_smtp_password', r.smtp_password is not null and r.smtp_password <> '',
    'has_resend_key', r.resend_api_key is not null and r.resend_api_key <> '');
end; $$;
grant execute on function platform_get_org_email_settings(uuid) to authenticated;

-- Write one org's email settings. Secret fields left blank keep their prior value
-- (same rule as set_org_email_settings). Platform-admin clone taking p_org.
create or replace function platform_set_org_email_settings(p_org uuid, p jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not auth_is_platform_admin() then raise exception 'platform admin only'; end if;
  insert into org_email_settings(
      org_id, provider, from_name, from_email, smtp_host, smtp_port, smtp_secure,
      smtp_username, smtp_password, resend_api_key, smtp_allow_invalid_cert, active, updated_at)
  values (
      p_org, coalesce(p->>'provider','smtp'), p->>'from_name', p->>'from_email',
      p->>'smtp_host', nullif(p->>'smtp_port','')::int, coalesce((p->>'smtp_secure')::boolean, true),
      p->>'smtp_username', nullif(p->>'smtp_password',''), nullif(p->>'resend_api_key',''),
      coalesce((p->>'smtp_allow_invalid_cert')::boolean, false),
      coalesce((p->>'active')::boolean, false), now())
  on conflict (org_id) do update set
      provider      = coalesce(p->>'provider', org_email_settings.provider),
      from_name     = p->>'from_name', from_email = p->>'from_email',
      smtp_host     = p->>'smtp_host', smtp_port = nullif(p->>'smtp_port','')::int,
      smtp_secure   = coalesce((p->>'smtp_secure')::boolean, true), smtp_username = p->>'smtp_username',
      smtp_password = coalesce(nullif(p->>'smtp_password',''), org_email_settings.smtp_password),
      resend_api_key = coalesce(nullif(p->>'resend_api_key',''), org_email_settings.resend_api_key),
      smtp_allow_invalid_cert = coalesce((p->>'smtp_allow_invalid_cert')::boolean, false),
      active        = coalesce((p->>'active')::boolean, false), updated_at = now();
end; $$;
grant execute on function platform_set_org_email_settings(uuid, jsonb) to authenticated;
