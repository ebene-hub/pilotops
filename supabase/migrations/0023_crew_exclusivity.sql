-- 0023_crew_exclusivity.sql
-- Stop the same person being committed to two LIVE missions at once. The Pilot
-- Ops UI already hides busy crew, but this is the race-proof backstop: enforced
-- in the database so two pilots can't book the same co-pilot / observer / GIS
-- analyst in the same instant, and a pilot who is crew on a live flight can't
-- also be PIC of another.
--
-- A "commitment" = being the pilot_id of a live flight, OR having a flight_crew
-- row on a live flight. Idempotent (create-or-replace + drop-if-exists).

-- Is this profile already on a different LIVE flight? Returns that flight's id.
create or replace function profile_on_live_flight(p_profile uuid, p_exclude_flight uuid)
returns uuid
language sql
stable
as $$
  select f.id
    from flights f
   where f.status = 'live'
     and f.id is distinct from p_exclude_flight
     and (
       f.pilot_id = p_profile
       or exists (select 1 from flight_crew c where c.flight_id = f.id and c.profile_id = p_profile)
     )
   limit 1;
$$;

-- Block adding crew who are already on another live flight. Emergency flights
-- bypass the rule (an urgent launch must never be blocked by a booking clash).
create or replace function check_crew_not_double_booked()
returns trigger
language plpgsql
as $$
declare v_busy uuid;
begin
  if exists (select 1 from flights where id = new.flight_id and status = 'live' and coalesce(emergency, false) = false) then
    v_busy := profile_on_live_flight(new.profile_id, new.flight_id);
    if v_busy is not null then
      raise exception 'CREW_BUSY: % is already committed to live flight %', new.profile_id, v_busy;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_crew_double_book on flight_crew;
create trigger trg_crew_double_book
  before insert on flight_crew
  for each row execute function check_crew_not_double_booked();

-- Block a flight going live with a pilot who is already on another live flight
-- (as PIC or as crew). Only fires on the transition to 'live', so the frequent
-- position/stream_status updates on a live flight aren't re-checked.
create or replace function check_pilot_not_double_booked()
returns trigger
language plpgsql
as $$
declare v_busy uuid;
begin
  if new.status = 'live' and new.pilot_id is not null
     and coalesce(new.emergency, false) = false
     and (tg_op = 'INSERT' or old.status is distinct from 'live') then
    v_busy := profile_on_live_flight(new.pilot_id, new.id);
    if v_busy is not null then
      raise exception 'PILOT_BUSY: pilot % is already committed to live flight %', new.pilot_id, v_busy;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pilot_double_book on flights;
create trigger trg_pilot_double_book
  before insert or update on flights
  for each row execute function check_pilot_not_double_booked();
