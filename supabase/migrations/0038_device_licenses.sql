-- 0038_device_licenses.sql
-- Per-device (controller/PC) licensing. Layered on top of the per-org license from
-- 0035 (organizations.license_status/…): a super admin issues license KEYS to an org,
-- each key carries a max_activations count (set 1 for one-key-one-device, or N for a
-- shared fleet key). A controller ACTIVATES against a key on first run; the activation
-- binds a client-generated device_token (+ browser fingerprint) so the app can't just be
-- copied onto another laptop and used — every entry re-checks the binding server-side.
--
-- Strength note: this is a browser deterrent (localStorage token + fingerprint), NOT a
-- hardware lock. The same model upgrades to a real hardware ID later via a native wrapper.
--
-- Isolation model (must not weaken org_isolate RLS):
--   * platform_* key-management fns are SECURITY DEFINER gated on auth_is_platform_admin().
--   * member-facing device_status/activate_device are SECURITY DEFINER scoped to the
--     caller's own org via auth_org() (0008) — a tenant can never touch another's keys.
-- Both table sets have RLS enabled with NO grants to authenticated (definer fns only).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists license_keys (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  key             text not null unique,
  label           text,
  max_activations int  not null default 1 check (max_activations >= 1),
  status          text not null default 'active' check (status in ('active','revoked')),
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now()
);
create index if not exists license_keys_org_idx on license_keys(org_id);

create table if not exists device_activations (
  id             uuid primary key default gen_random_uuid(),
  license_key_id uuid not null references license_keys(id) on delete cascade,
  org_id         uuid not null references organizations(id) on delete cascade,
  device_token   uuid not null,
  fingerprint    text,
  device_label   text,
  activated_by   uuid references profiles(id),
  status         text not null default 'active' check (status in ('active','released')),
  last_seen_at   timestamptz,
  created_at     timestamptz not null default now(),
  unique (license_key_id, device_token)
);
create index if not exists device_activations_org_idx on device_activations(org_id);
create index if not exists device_activations_token_idx on device_activations(device_token);

-- RLS on, no policies/grants → only the SECURITY DEFINER functions below can read/write.
alter table license_keys        enable row level security;
alter table device_activations  enable row level security;

-- ---------------------------------------------------------------------------
-- Member-facing RPCs (scoped to the caller's own org via auth_org())
-- ---------------------------------------------------------------------------

-- Is THIS device (device_token) allowed to run the app for the caller's org?
-- Grandfather: an org with no active keys yet is unrestricted (returns activated:true),
-- so rollout doesn't lock out orgs before the super admin issues them a key.
create or replace function device_status(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_org uuid; v_has_keys boolean; v_act device_activations;
begin
  v_org := auth_org();
  if v_org is null then return jsonb_build_object('activated', false, 'reason', 'no_org'); end if;

  select exists(select 1 from license_keys where org_id = v_org and status = 'active') into v_has_keys;
  if not v_has_keys then
    return jsonb_build_object('activated', true, 'reason', 'unlicensed_org');
  end if;

  select a.* into v_act
  from device_activations a
  join license_keys k on k.id = a.license_key_id
  where a.device_token = p_token and a.org_id = v_org
    and a.status = 'active' and k.status = 'active'
  limit 1;

  if not found then
    return jsonb_build_object('activated', false, 'reason', 'not_bound');
  end if;

  update device_activations set last_seen_at = now() where id = v_act.id;
  return jsonb_build_object('activated', true, 'device_label', v_act.device_label);
end; $$;
grant execute on function device_status(uuid) to authenticated;

-- Bind this controller to a license key (first run / "Activate this controller").
create or replace function activate_device(p_key text, p_token uuid, p_fingerprint text, p_label text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_org uuid; v_key license_keys; v_used int; v_existing device_activations;
begin
  v_org := auth_org();
  if v_org is null then return jsonb_build_object('ok', false, 'reason', 'no_org'); end if;

  select * into v_key from license_keys
  where key = trim(p_key) and org_id = v_org and status = 'active';
  if not found then return jsonb_build_object('ok', false, 'reason', 'invalid_key'); end if;

  -- Cache-clear resilience: same physical controller (fingerprint) re-activating on the
  -- same key just rebinds its token instead of consuming another slot.
  if p_fingerprint is not null and p_fingerprint <> '' then
    select * into v_existing from device_activations
    where license_key_id = v_key.id and status = 'active' and fingerprint = p_fingerprint
    limit 1;
    if found then
      update device_activations
        set device_token = p_token, device_label = coalesce(nullif(p_label,''), device_label),
            activated_by = auth.uid(), last_seen_at = now()
        where id = v_existing.id;
      return jsonb_build_object('ok', true, 'rebound', true);
    end if;
  end if;

  select count(*) into v_used from device_activations
  where license_key_id = v_key.id and status = 'active';
  if v_used >= v_key.max_activations then
    return jsonb_build_object('ok', false, 'reason', 'no_slots');
  end if;

  insert into device_activations(license_key_id, org_id, device_token, fingerprint, device_label, activated_by, last_seen_at)
  values (v_key.id, v_org, p_token, nullif(p_fingerprint,''), nullif(p_label,''), auth.uid(), now())
  on conflict (license_key_id, device_token) do update
    set status = 'active', device_label = coalesce(nullif(p_label,''), device_activations.device_label),
        fingerprint = nullif(p_fingerprint,''), last_seen_at = now();
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function activate_device(text, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Platform-admin RPCs (cross-tenant; gated on auth_is_platform_admin() — 0036 pattern)
-- ---------------------------------------------------------------------------

create or replace function platform_list_license_keys(p_org uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare result jsonb;
begin
  if not auth_is_platform_admin() then raise exception 'platform admin only'; end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into result
  from (
    select
      k.id, k.key, k.label, k.max_activations, k.status, k.created_at,
      (select count(*) from device_activations a where a.license_key_id = k.id and a.status = 'active') as used,
      coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', a.id, 'device_label', a.device_label,
                 'fingerprint', left(coalesce(a.fingerprint,''), 10),
                 'last_seen_at', a.last_seen_at, 'status', a.status, 'created_at', a.created_at)
                 order by a.created_at)
        from device_activations a where a.license_key_id = k.id and a.status = 'active'
      ), '[]'::jsonb) as devices
    from license_keys k
    where k.org_id = p_org
  ) t;
  return result;
end; $$;
grant execute on function platform_list_license_keys(uuid) to authenticated;

-- Create a key; returns the generated key string (PLOPS-XXXX-XXXX-XXXX, Crockford base32).
create or replace function platform_create_license_key(p_org uuid, p_label text, p_max int)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_key text; v_alpha text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; v_raw text; i int;
begin
  if not auth_is_platform_admin() then raise exception 'platform admin only'; end if;
  if coalesce(p_max, 0) < 1 then raise exception 'max activations must be >= 1'; end if;

  loop
    v_raw := '';
    for i in 1..12 loop
      v_raw := v_raw || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1);
    end loop;
    v_key := 'PLOPS-' || substr(v_raw,1,4) || '-' || substr(v_raw,5,4) || '-' || substr(v_raw,9,4);
    exit when not exists(select 1 from license_keys where key = v_key);
  end loop;

  insert into license_keys(org_id, key, label, max_activations, status, created_by)
  values (p_org, v_key, nullif(trim(p_label),''), greatest(p_max,1), 'active', auth.uid());
  return v_key;
end; $$;
grant execute on function platform_create_license_key(uuid, text, int) to authenticated;

create or replace function platform_revoke_license_key(p_key_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not auth_is_platform_admin() then raise exception 'platform admin only'; end if;
  update license_keys set status = 'revoked' where id = p_key_id;
  if not found then raise exception 'license key not found'; end if;
end; $$;
grant execute on function platform_revoke_license_key(uuid) to authenticated;

create or replace function platform_release_device(p_activation_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not auth_is_platform_admin() then raise exception 'platform admin only'; end if;
  update device_activations set status = 'released' where id = p_activation_id;
  if not found then raise exception 'activation not found'; end if;
end; $$;
grant execute on function platform_release_device(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Extend platform_list_orgs() with a device_count rollup (active activations per org).
-- ---------------------------------------------------------------------------
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
      (select count(*) from device_activations a where a.org_id = o.id and a.status = 'active') as device_count,
      exists (select 1 from org_email_settings e where e.org_id = o.id and e.active)   as email_active,
      (select p.email from profiles p where p.org_id = o.id and p.is_admin order by p.created_at limit 1) as primary_admin_email
    from organizations o
  ) t;
  return result;
end; $$;
grant execute on function platform_list_orgs() to authenticated;
