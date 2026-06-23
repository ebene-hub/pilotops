-- 0019_ingest_key.sql
-- Direct ingest API: a per-flight PUBLISH credential so any RTMP/SRT encoder or
-- drone ground station (non-DJI / no Android controller) can stream into a
-- mission without the companion app. Distinct from share_key (which is a public
-- READ key for watch links) — ingest_key must never be exposed to viewers; it is
-- only read by org members via the authenticated flights table (RLS-protected)
-- and checked server-side by the stream gateway.

alter table flights add column if not exists ingest_key text;
update flights set ingest_key = encode(extensions.gen_random_bytes(12), 'hex') where ingest_key is null;
alter table flights alter column ingest_key set default encode(extensions.gen_random_bytes(12), 'hex');
