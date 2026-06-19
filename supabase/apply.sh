#!/usr/bin/env bash
# Apply Pilot Ops schema migrations + seed to a running Postgres (Supabase).
#
#   DATABASE_URL="postgresql://postgres:PASSWORD@localhost:5432/postgres" \
#     bash supabase/apply.sh
#
# (For the official self-hosted stack the DB is reachable on the host at the
#  POSTGRES_PORT you configured, or via `docker compose exec db psql`.)
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL to your Postgres connection string}"

here="$(cd "$(dirname "$0")" && pwd)"
for f in "$here"/migrations/*.sql; do
  echo ">> applying $(basename "$f")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done

echo ">> seeding config defaults"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$here/seed.sql"

echo "✓ schema applied"
