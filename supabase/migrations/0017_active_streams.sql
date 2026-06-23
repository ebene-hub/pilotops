-- 0017_active_streams.sql
-- Multi-mission public watch: return ALL currently-live missions for an org (not
-- just the newest), so the permanent watch link can show a multi-screen gallery
-- when several operations run at once. Same shape as get_active_public_stream,
-- but an array under `streams`.

create or replace function get_active_public_streams(p_watch_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_org uuid;
  v_streams jsonb;
begin
  select id into v_org from organizations where watch_key = p_watch_key;
  if v_org is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'flight', f.id, 'key', f.share_key, 'code', f.code, 'area', f.area,
        'pilot', p.full_name, 'status', f.status, 'stream', f.stream_status
      )
      order by f.started_at desc nulls last, f.created_at desc
    ),
    '[]'::jsonb
  )
  into v_streams
  from flights f
  left join profiles p on p.id = f.pilot_id
  where f.org_id = v_org and f.status = 'live';

  return jsonb_build_object('ok', true, 'streams', v_streams);
end;
$$;

grant execute on function get_active_public_streams(text) to anon, authenticated;
