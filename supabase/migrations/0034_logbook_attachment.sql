-- 0034_logbook_attachment.sql
-- Let a pilot attach a raw flight-controller log (e.g. ArduPilot .bin) to a
-- logbook entry — for flights flown from another controller that Pilot Ops never
-- auto-logged. The file itself lives in the existing private `media` storage
-- bucket (0004); the logbook row just points at it. No new bucket/RLS needed:
-- the media bucket already allows authenticated upload/read, and logbook_entries
-- already enforces per-pilot writes (0003) + org isolation (0008/0033).

alter table logbook_entries
  add column if not exists log_path text,   -- storage object path in the `media` bucket
  add column if not exists log_name text,   -- original filename (e.g. 2026-07-09_14-02-11.bin)
  add column if not exists log_size bigint; -- bytes, for display
