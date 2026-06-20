-- Pilot Ops — live video streaming (GGIS UAV Companion).
-- A flight's live cast is addressed by its uuid (the MediaMTX path). These
-- columns let Pilot Ops know when a controller feed is live; the stream-gateway
-- (MediaMTX external-auth + record hooks) flips them server-side.

alter table flights
  add column if not exists stream_status     text not null default 'offline',  -- offline | live
  add column if not exists stream_started_at  timestamptz;

-- flights is already in the supabase_realtime publication (0001), so the
-- stream_status flip reaches subscribed Pilot Ops clients with no extra wiring.

-- The stream-gateway connects as service_role (server-side, bypasses RLS) to
-- validate publish/read auth and attach recordings. Grant exactly what it needs.
grant select, update on flights     to service_role;
grant select          on profiles   to service_role;
grant select          on flight_crew to service_role;
grant select, insert  on media      to service_role;
