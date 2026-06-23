-- Pilot Ops — let public watch-link viewers post to the mission chat (read-only
-- before this). The message is stamped with the flight's org_id explicitly so the
-- crew's org-scoped RLS still shows it.

create or replace function post_public_chat(p_flight uuid, p_key text, p_name text, p_text text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_org uuid;
begin
  select org_id into v_org from flights where id = p_flight and share_key = p_key;
  if v_org is null then return jsonb_build_object('ok', false); end if;
  if coalesce(trim(p_text), '') = '' then return jsonb_build_object('ok', false); end if;

  insert into chat_messages (flight_id, sender_id, sender_name, sender_role, text, org_id)
  values (
    p_flight, null,
    left(coalesce(nullif(trim(p_name), ''), 'Guest'), 40),
    'guest',
    left(p_text, 1000),
    v_org
  );
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function post_public_chat(uuid, text, text, text) to anon, authenticated;
