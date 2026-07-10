-- 0039_device_token_text.sql
-- Widen the device token from uuid → text so it can hold a native hardware ID as well as
-- a browser UUID. The GGIS UAV Companion (Android) binds to a controller using
-- Settings.Secure.ANDROID_ID (a 16-char hex string, NOT a uuid); the web app uses a
-- localStorage UUID. Both now share the same device_activations table / license keys (0038).
--
-- device_status / activate_device are recreated with p_token as text. Changing a function
-- argument type creates a NEW overload, so the old uuid-signature functions are dropped
-- first (otherwise both would coexist). Bodies are otherwise identical to 0038.
-- Idempotent: the column type change is a no-op if already text.

-- ---------------------------------------------------------------------------
-- 1. Column: uuid → text (safe cast; existing UUID values stringify unchanged).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'device_activations' and column_name = 'device_token' and data_type = 'uuid'
  ) then
    alter table device_activations alter column device_token type text using device_token::text;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Drop the old uuid-signature functions, then recreate with p_token text.
-- ---------------------------------------------------------------------------
drop function if exists device_status(uuid);
drop function if exists activate_device(text, uuid, text, text);

create or replace function device_status(p_token text)
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
grant execute on function device_status(text) to authenticated;

create or replace function activate_device(p_key text, p_token text, p_fingerprint text, p_label text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_org uuid; v_key license_keys; v_used int; v_existing device_activations;
begin
  v_org := auth_org();
  if v_org is null then return jsonb_build_object('ok', false, 'reason', 'no_org'); end if;

  select * into v_key from license_keys
  where key = trim(p_key) and org_id = v_org and status = 'active';
  if not found then return jsonb_build_object('ok', false, 'reason', 'invalid_key'); end if;

  -- Cache-clear / reinstall resilience: same physical device (fingerprint) re-activating on
  -- the same key just rebinds its token instead of consuming another slot.
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
grant execute on function activate_device(text, text, text, text) to authenticated;
