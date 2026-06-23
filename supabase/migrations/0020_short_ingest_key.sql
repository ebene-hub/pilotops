-- 0020_short_ingest_key.sql
-- Make the per-flight ingest key short + human-readable (8 chars, Crockford-ish
-- alphabet with no ambiguous 0/O/1/I/L) so it's easy to type into an encoder /
-- ground station. ~40 bits, scoped to a live flight + checked server-side.
-- Self-contained: works whether or not 0019 was applied.

alter table flights add column if not exists ingest_key text;

create or replace function gen_ingest_key()
returns text language sql volatile as $$
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1),
    ''
  )
  from generate_series(1, 8);
$$;

-- Regenerate every flight's key into the short format and use it as the default.
alter table flights alter column ingest_key drop default;
update flights set ingest_key = gen_ingest_key();
alter table flights alter column ingest_key set default gen_ingest_key();
