# Deploying Pilot Ops (self-hosted, Docker)

> **Prefer managed hosting (no Docker for the app)?** See **[DEPLOY-CLOUD.md](DEPLOY-CLOUD.md)**
> — Supabase Cloud + a static host (Vercel/Netlify). This guide is the all-in-one
> self-hosted path.


Pilot Ops is a static Vite/React frontend backed by **self-hosted Supabase**
(Postgres + Auth + REST + Realtime + Storage). This guide brings up the whole
stack on one Linux server behind HTTPS.

```
Browser ──HTTPS──> Caddy ┬─ /auth,/rest,/realtime,/storage  ─> Supabase (kong:8000)
                         └─ everything else                  ─> web (nginx, built SPA)
```

## Prerequisites
- A Linux host with Docker + Docker Compose v2 and a domain name pointing at it
  (for automatic TLS). `localhost` works for local testing.
- `psql` available on the host (or use `docker compose exec db psql`).

## Local development (fastest — Supabase CLI)

For dev/testing on one machine, the Supabase CLI runs the whole backend and
auto-applies `supabase/migrations/*.sql` + `supabase/seed.sql`:

```bash
npx supabase start                      # boots Postgres+Auth+REST+Realtime+Storage
npx supabase status -o env              # prints API_URL, ANON_KEY, SERVICE_ROLE_KEY
# put API_URL + ANON_KEY in .env as VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<service key> \
  BOOTSTRAP_ADMIN_EMAIL=director@local.test BOOTSTRAP_ADMIN_PASSWORD=admin12345 \
  node scripts/bootstrap-admin.mjs
npm run dev                             # http://localhost:5173
```
Sign in at `/admin-login.html` as the bootstrap admin, register aircraft, invite a
pilot, accept the link, then fly. (`smoke-e2e.mjs` exercises this against the CLI
stack.) Stop with `npx supabase stop`.

> This exact path was used to validate the app end-to-end: real GoTrue login,
> store loading real data, pilot-code RPC, RLS (hash hidden, impersonation
> blocked), and writes (flights/incidents/chat/media) — all verified working.

## Production (self-hosted)

## 1. Backend — official Supabase self-hosting stack

```bash
git clone --depth 1 https://github.com/supabase/supabase
cp -r supabase/docker ~/supabase-stack && cd ~/supabase-stack
cp .env.example .env
```

Edit `~/supabase-stack/.env` and set strong values for at least:
`POSTGRES_PASSWORD`, `JWT_SECRET` (32+ chars), `ANON_KEY`, `SERVICE_ROLE_KEY`
(generate the two keys from `JWT_SECRET` — see the Supabase self-hosting docs),
`SITE_URL=https://YOUR_DOMAIN`, `API_EXTERNAL_URL=https://YOUR_DOMAIN`, and
**`GOTRUE_MAILER_AUTOCONFIRM=true`** (no SMTP in v1, so accounts must auto-confirm
for the invite/registration flow to log users in immediately).

Start it:
```bash
docker compose up -d
docker network ls   # note the network name, e.g. "supabase_default"
```

## 2. Apply the Pilot Ops schema

From this repo, with the DB reachable (host port or via the container):
```bash
DATABASE_URL="postgresql://postgres:YOUR_POSTGRES_PASSWORD@localhost:5432/postgres" \
  bash supabase/apply.sh
```
This runs `supabase/migrations/*.sql` (tables, RLS, RPCs, storage bucket) then
`supabase/seed.sql` (roles, sectors, form-field config — **config only, no dummy
people/flights**).

## 3. Create the first admin

Pilot Ops is **multi-tenant** — each organization is fully isolated (its own
admins, pilots, fleet, flights, incidents, media, stakeholders, invites, audit).

**Option A — self-service (no CLI):** open `https://YOUR_DOMAIN/admin-signup.html`,
enter an **organization name** + admin details. This creates a new organization
and makes you its first admin via `create_org_and_claim()`. Admin status and the
org assignment are granted server-side — client metadata can never grant admin.
Members you invite from the console join *your* org automatically.

**Option B — script (set `BOOTSTRAP_ORG_NAME`):**

```bash
SUPABASE_URL="https://YOUR_DOMAIN" \
SUPABASE_SERVICE_ROLE_KEY="<your service role key>" \
BOOTSTRAP_ADMIN_EMAIL="director@yourorg.com" \
BOOTSTRAP_ADMIN_PASSWORD="<strong password>" \
BOOTSTRAP_ADMIN_NAME="Operations Director" \
  node scripts/bootstrap-admin.mjs
```
(Needs `npm ci` once for `@supabase/supabase-js`.) This is the only account that
exists before invites — everyone else is invited from the Admin console.

## 4. Frontend — build & serve

In this repo create `.env`:
```
VITE_SUPABASE_URL=https://YOUR_DOMAIN
VITE_SUPABASE_ANON_KEY=<your anon key>
```
Then bring up web + Caddy on the same network as the Supabase stack:
```bash
DOMAIN=YOUR_DOMAIN \
SUPABASE_NETWORK=supabase_default \
VITE_SUPABASE_URL=https://YOUR_DOMAIN \
VITE_SUPABASE_ANON_KEY=<your anon key> \
  docker compose up -d --build
```
Caddy obtains a certificate and serves the app at `https://YOUR_DOMAIN`. The
browser talks to Supabase on the same origin (Caddy proxies the `/auth`,`/rest`,
`/realtime`,`/storage` paths to `kong`).

## 5. First run
1. Open `https://YOUR_DOMAIN/admin-login.html`, sign in as the bootstrap admin.
   (Optionally enroll TOTP 2FA — once enrolled it is required on each sign-in.)
2. Register aircraft + batteries (Admin → Aircraft registry).
3. Invite pilots (Admin → Members & invites) → copy the generated link.
4. Each invitee opens the link → registers → gets a one-time 6-digit pilot code.
5. Pilots open `https://YOUR_DOMAIN/`, grant location, and start missions.

## Live video — GGIS UAV Companion

The **GGIS UAV Companion** Android app (in `android/`) mirrors the drone
controller's screen and casts it into the matching flight's **Live stream**. The
server side is two extra containers in this repo's `docker-compose.yml`:

- **`mediamtx`** — ingests the cast (RTMP/SRT) and redistributes it to the
  browser as low-latency **WebRTC** (+ HLS), recording each session.
- **`stream-gateway`** — authorises every publish/read against Supabase (the
  Android app passes the pilot's access token; the path is the flight uuid) and
  attaches each finished recording to the flight's media.

### Bring it up
1. Apply the streaming migration (adds `flights.stream_status`, grants the
   gateway's `service_role` access): re-run `bash supabase/apply.sh`.
2. Ensure `.env` has `SUPABASE_SERVICE_ROLE_KEY` set (the gateway needs it) and,
   for the browser, the same-origin defaults `VITE_STREAM_URL=/stream` /
   `VITE_STREAM_HLS_URL=/hls` (already wired through Caddy).
3. `docker compose up -d --build` (brings up `mediamtx` + `stream-gateway` too).
4. **Open the firewall** for: `1935/tcp` (RTMP ingest) **or** `8890/udp` (SRT),
   and `8189/udp` (WebRTC media). `443` already serves the WHEP/HLS signalling
   via Caddy (`/stream`, `/hls`).

### Smoke-test without the app
Push any clip as a flight's cast and watch it appear in that flight's Live stream
(`<flightId>` = the flight's uuid; `<jwt>` = a pilot's Supabase access token):
```bash
ffmpeg -re -i sample.mp4 -c:v libx264 -tune zerolatency -c:a aac \
  -f flv "rtmp://YOUR_DOMAIN:1935/<flightId>?token=<jwt>"
```
A wrong/expired token, or a flight that isn't `live`, is rejected by the gateway
(401 in `docker compose logs stream-gateway`). On stop, a `video` row + Storage
object are attached to the flight.

### The app
Build + sideload `android/` onto the controllers — see `android/README.md`. Point
it at this deployment with `STREAM_HOST=YOUR_DOMAIN` (+ `SUPABASE_URL`,
`SUPABASE_ANON_KEY`). Pilots sign in, start a mission in Pilot Ops, then tap
**Start casting**.

## Updating
- Frontend: `docker compose up -d --build web`.
- Schema: add a new `supabase/migrations/00NN_*.sql` and re-run `apply.sh`
  (migrations are idempotent — `if not exists` / `create or replace`).

## Backups
The data lives in the Supabase stack's Postgres volume. Back it up with
`docker compose exec db pg_dump -U postgres postgres > backup.sql` and the
Storage volume for uploaded media. Restore with `psql < backup.sql`.

## Notes / v1 limitations
- **Email** (invites/notifications) is **stub-and-logged** to the `notifications`
  table — wire a provider (Resend/SendGrid/SMTP via GoTrue) to actually send.
- **Live video** is real when a controller casts via the GGIS UAV Companion app
  (see above); until a controller connects, the view shows a simulated placeholder.
- Some admin analytics aggregate from the same real tables; a few secondary
  edit flows (member role management, report authoring) persist partially and
  are the natural next wiring pass.
