-- Fix multi-tenant isolation that isn't active on the live database.
--
-- Observed: flight stations registered in one organization's admin console were
-- visible to another organization. `stations` is supposed to be org-isolated
-- (0008 defines an org_id column, an auto-stamp trigger, and a RESTRICTIVE
-- org_isolate policy for it) — but the restrictive policy isn't active on the
-- live DB, so only the permissive `stations_read USING (true)` applies and every
-- org sees every row. The same is likely true for the other per-org tables that
-- share that 0008 loop, so we re-assert the whole set idempotently.
--
-- NOTE on data: a row with a NULL org_id can't match `org_id = auth_org()`, so
-- once the restrictive policy is active such rows become invisible to everyone
-- (no longer leaking, but hidden). Step 1 best-effort backfills NULL station
-- org_ids from any flight that used the station; stations never used by a flight
-- stay NULL and must be reassigned by an admin (query in the accompanying notes).

-- 1. Best-effort backfill: infer a null station's org from a flight that used it.
update stations s
   set org_id = f.org_id
  from flights f
 where f.station_id = s.id
   and s.org_id is null
   and f.org_id is not null;

-- 2. Re-attach the auto-stamp trigger + restrictive org_isolate policy to every
--    per-org table (matches 0008; safe/no-op where already present).
do $$
declare t text;
begin
  foreach t in array array[
    'member_roles','stations','aircraft','batteries','maintenance',
    'flights','flight_crew','preflight_checks','incidents','media','reports',
    'logbook_entries','currencies','chat_messages','stakeholders',
    'notification_rules','notifications','invites','audit_log','auth_attempts',
    'emergency_reviews'
  ] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop trigger if exists trg_org_id on %I;', t);
    execute format('create trigger trg_org_id before insert on %I for each row execute function set_org_id();', t);
    execute format('drop policy if exists org_isolate on %I;', t);
    execute format('create policy org_isolate on %I as restrictive to authenticated using (org_id = auth_org()) with check (org_id = auth_org());', t);
  end loop;
end $$;
