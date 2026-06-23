-- Pilot Ops — public watch links. A per-flight share_key lets anyone with the
-- link view the livestream + chat without signing in (read-only).

alter table flights add column if not exists share_key text;
update flights set share_key = encode(extensions.gen_random_bytes(9), 'hex') where share_key is null;
alter table flights alter column share_key set default encode(extensions.gen_random_bytes(9), 'hex');

-- Public viewer resolves the flight by id + key (no auth). Used by watch.html and
-- by the stream-gateway to authorise tokenless WebRTC reads.
create or replace function get_public_stream(p_flight uuid, p_key text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_code text; v_area text; v_status text; v_pilot text;
begin
  select f.id, f.code, f.area, f.status, p.full_name
    into v_id, v_code, v_area, v_status, v_pilot
    from flights f left join profiles p on p.id = f.pilot_id
   where f.id = p_flight and f.share_key = p_key;
  if v_id is null then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'code', v_code, 'area', v_area, 'status', v_status, 'pilot', v_pilot);
end; $$;
grant execute on function get_public_stream(uuid, text) to anon, authenticated;

-- Read-only mission chat for a public viewer (last 100, chronological).
create or replace function get_public_chat(p_flight uuid, p_key text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from flights where id = p_flight and share_key = p_key) then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true, 'messages', coalesce((
    select jsonb_agg(jsonb_build_object('from', sender_name, 'role', sender_role, 'text', text, 'at', created_at) order by created_at)
    from (select sender_name, sender_role, text, created_at from chat_messages where flight_id = p_flight order by created_at desc limit 100) t
  ), '[]'::jsonb));
end; $$;
grant execute on function get_public_chat(uuid, text) to anon, authenticated;
