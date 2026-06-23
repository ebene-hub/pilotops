-- 0016_permanent_watch.sql
-- Permanent per-organization public watch link. Instead of a per-flight share
-- link that changes every mission, an org has a stable `watch_key`; the public
-- page (watch.html?org=<key>) resolves whichever mission is currently live and
-- follows it automatically.

alter table organizations add column if not exists watch_key text;
update organizations set watch_key = encode(extensions.gen_random_bytes(9), 'hex') where watch_key is null;
alter table organizations alter column watch_key set default encode(extensions.gen_random_bytes(9), 'hex');
create unique index if not exists organizations_watch_key_idx on organizations (watch_key);

-- Anon resolver: given an org watch_key, return the org's current live mission
-- (newest), including the flight's own share_key so the page can authorize the
-- WebRTC read + chat exactly like a per-flight link. Returns ok:false when idle.
create or replace function get_active_public_stream(p_watch_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_org uuid;
  r record;
begin
  select id into v_org from organizations where watch_key = p_watch_key;
  if v_org is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  select f.id, f.share_key, f.code, f.area, f.status, f.stream_status,
         p.full_name as pilot
    into r
    from flights f
    left join profiles p on p.id = f.pilot_id
   where f.org_id = v_org and f.status = 'live'
   order by f.started_at desc nulls last, f.created_at desc
   limit 1;

  if r.id is null then
    return jsonb_build_object('ok', false, 'reason', 'idle');
  end if;

  return jsonb_build_object(
    'ok', true,
    'flight', r.id,
    'key', r.share_key,
    'code', r.code,
    'area', r.area,
    'pilot', r.pilot,
    'status', r.status,
    'stream', r.stream_status
  );
end;
$$;

grant execute on function get_active_public_stream(text) to anon, authenticated;
