-- 0015_auto_logbook.sql
-- Auto-populate the pilot logbook from completed flights.
-- When a flight transitions to 'completed', record a logbook entry for its pilot
-- (duration from started/ended, night inferred from launch hour). Idempotent: one
-- entry per flight. Also backfills already-completed flights that have no entry.

create or replace function log_flight_on_complete()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_minutes int;
  v_night   boolean;
  v_model   text;
begin
  if new.status = 'completed'
     and (old.status is distinct from 'completed')
     and new.pilot_id is not null
     and not exists (select 1 from logbook_entries where flight_id = new.id)
  then
    v_minutes := case
      when new.started_at is not null and new.ended_at is not null
        then greatest(0, round(extract(epoch from (new.ended_at - new.started_at)) / 60))::int
      else 0 end;

    v_night := case
      when new.started_at is not null
        then (extract(hour from new.started_at) < 6 or extract(hour from new.started_at) >= 18)
      else false end;

    select model into v_model from aircraft where id = new.aircraft_id;

    insert into logbook_entries
      (pilot_id, flight_id, date, aircraft_type, conditions, duration_min, night, bvlos, notes, org_id)
    values
      (new.pilot_id, new.id,
       coalesce(new.ended_at, new.started_at, now())::date,
       coalesce(v_model, 'UAV'), 'Auto', v_minutes, v_night, false, new.area, new.org_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_flight_complete on flights;
create trigger trg_log_flight_complete
  after update on flights
  for each row
  execute function log_flight_on_complete();

-- Backfill existing completed flights that have no logbook entry yet.
insert into logbook_entries
  (pilot_id, flight_id, date, aircraft_type, conditions, duration_min, night, bvlos, notes, org_id)
select
  f.pilot_id, f.id,
  coalesce(f.ended_at, f.started_at, f.created_at)::date,
  coalesce(a.model, 'UAV'), 'Auto',
  case
    when f.started_at is not null and f.ended_at is not null
      then greatest(0, round(extract(epoch from (f.ended_at - f.started_at)) / 60))::int
    else 0 end,
  case
    when f.started_at is not null
      then (extract(hour from f.started_at) < 6 or extract(hour from f.started_at) >= 18)
    else false end,
  false, f.area, f.org_id
from flights f
left join aircraft a on a.id = f.aircraft_id
where f.status = 'completed'
  and f.pilot_id is not null
  and not exists (select 1 from logbook_entries le where le.flight_id = f.id);
