-- 0022_webhooks_flights.sql
-- Fire outgoing webhooks on flight start (->live) and end (->completed), in
-- addition to incidents. Shared dispatch helper keeps payloads consistent.

-- Shared: POST text (Slack/Teams) or a JSON payload (generic) to each active hook.
create or replace function dispatch_webhooks(p_org uuid, p_text text, p_payload jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare r record;
begin
  for r in select kind, url from integrations where org_id = p_org and active loop
    begin
      if r.kind = 'webhook' then perform net.http_post(r.url, p_payload);
      else perform net.http_post(r.url, jsonb_build_object('text', p_text));
      end if;
    exception when others then null;  -- a webhook failure must never block the write
    end;
  end loop;
end; $$;

-- Re-point the incident trigger fn at the shared helper.
create or replace function notify_integrations()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare msg text;
begin
  msg := format('Incident %s [%s] — %s%s',
    coalesce(new.code, left(new.id::text, 8)),
    upper(coalesce(new.severity, 'n/a')),
    coalesce(new.description, new.type, 'incident'),
    case when new.place is not null then ' @ ' || new.place else '' end);
  perform dispatch_webhooks(new.org_id, msg, jsonb_build_object('event', 'incident', 'incident', to_jsonb(new)));
  return new;
end; $$;

-- Flight start / end notifier. Fires only on a status change into live/completed
-- (so the frequent position updates during a mission don't spam webhooks).
create or replace function notify_integrations_flight()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare v_pilot text; v_code text; v_event text; msg text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'live' then return new; end if;
    v_event := 'started';
  else
    if new.status is not distinct from old.status then return new; end if;
    if new.status = 'live' then v_event := 'started';
    elsif new.status = 'completed' then v_event := 'ended';
    else return new; end if;
  end if;

  select full_name into v_pilot from profiles where id = new.pilot_id;
  v_code := coalesce(new.code, left(new.id::text, 8));
  if v_event = 'started' then
    msg := format('Mission %s started%s%s', v_code,
      case when new.area is not null then ' — ' || new.area else '' end,
      case when v_pilot is not null then ' · pilot ' || v_pilot else '' end);
  else
    msg := format('Mission %s ended%s', v_code,
      case when new.area is not null then ' — ' || new.area else '' end);
  end if;

  perform dispatch_webhooks(new.org_id, msg, jsonb_build_object('event', 'flight_' || v_event, 'flight', to_jsonb(new)));
  return new;
end; $$;

drop trigger if exists trg_notify_flight on flights;
create trigger trg_notify_flight after insert or update on flights
  for each row execute function notify_integrations_flight();
