-- Pilot Ops — controller pairing. When a mission starts, Pilot Ops shows a short
-- code; the pilot (or a co-pilot / shared controller) enters it in the GGIS UAV
-- Companion app to bind that controller to the flight before casting.

alter table flights add column if not exists pair_code text;
create index if not exists idx_flights_pair_code on flights(pair_code) where pair_code is not null;

-- Called by Pilot Ops right after a mission starts: mint (or reuse) a 6-digit
-- code unique among currently-live flights, and return it to display.
create or replace function start_pairing(p_flight uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_org uuid; v_pilot uuid; v_code text; v_admin boolean;
begin
  select org_id, pilot_id, pair_code into v_org, v_pilot, v_code from flights where id = p_flight;
  if v_org is null then raise exception 'unknown flight'; end if;
  if v_org <> auth_org() then raise exception 'forbidden'; end if;

  select is_admin into v_admin from profiles where id = auth.uid();
  if not ((v_pilot = auth.uid())
          or exists (select 1 from flight_crew where flight_id = p_flight and profile_id = auth.uid())
          or coalesce(v_admin, false)) then
    raise exception 'forbidden';
  end if;

  if v_code is not null then return v_code; end if;
  loop
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (select 1 from flights where pair_code = v_code and status = 'live');
  end loop;
  update flights set pair_code = v_code where id = p_flight;
  return v_code;
end; $$;
grant execute on function start_pairing(uuid) to authenticated;

-- Called by the companion app: exchange a code for the flight, and bind the
-- caller as a 'caster' on the flight so the stream-gateway authorises their
-- publish (its crew check then passes — no gateway change needed).
create or replace function resolve_pair_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_flight uuid; v_label text;
begin
  select id, coalesce(code, area, id::text) into v_flight, v_label
    from flights
   where pair_code = p_code and status = 'live' and org_id = auth_org()
   limit 1;
  if v_flight is null then return jsonb_build_object('ok', false); end if;

  insert into flight_crew(flight_id, profile_id, role)
    values (v_flight, auth.uid(), 'caster')
  on conflict do nothing;

  return jsonb_build_object('ok', true, 'flight_id', v_flight, 'label', v_label);
end; $$;
grant execute on function resolve_pair_code(text) to authenticated;
