# Pilot Ops — Logging & Operations Dashboard

A UAV pilot logging and operations platform: a **Vite + React** multi-page
frontend backed by **Supabase** (Postgres + Auth + Storage + Realtime), a
**real low-latency live-video pipeline** (MediaMTX + a Node stream gateway), and a
native **Android companion app** that casts the drone controller's screen into the
matching mission. Real authentication, real data, real device geolocation, real
video — no dummy data. Deployable with Docker.

## Run it

The frontend needs a Supabase backend. For a full local/production stack (DB,
auth, storage, TLS) see **[DEPLOY.md](DEPLOY.md)**.

```bash
npm install
# Set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env (point at your Supabase)
npm run dev      # dev server at http://localhost:5173
npm run build    # production bundle into dist/
```

### Architecture
- `src/api/supabase.js` — Supabase client. `src/api/geo.js` — geolocation.
- `src/store.jsx` — on sign-in, loads all real data from Supabase and maps it into
  the global shapes the views read, then mounts (no dummy data; empty until used).
- `src/main.jsx` / `src/admin-main.jsx` — session gates (redirect to login if no
  session; admin requires `is_admin`).
- `src/login.js` / `src/admin-login.js` — real password auth, admin TOTP 2FA, and
  the invite-accept + one-time pilot-code flow.
- `supabase/` — schema migrations, RLS, security-definer RPCs (pilot-code verify
  with server-side lockout, invite accept, emergency rate-limit), and config seed.
- `Dockerfile`, `docker-compose.yml`, `docker/`, `scripts/bootstrap-admin.mjs` —
  deployment.

**Real flows:** sign-in/invite registration, start mission (creates a flight +
captures launch GPS), pilot-code identity check (server RPC), emergency launch
(server rate-limit + review queue), live position tracking + realtime mission
chat, **live video casting** from the controller, **per-mission recording**,
incident logging at current location (persisted + admin-reviewable + CSV export),
auto-logbook from completed flights, media upload to Storage, fleet/battery
registry + status updates, and **outgoing webhooks** (Slack/Teams/generic) fired
on incidents and mission start/end.

## Live video

Live missions stream real video from the drone controller's screen to the
operator dashboard and a public watch page, with sub-second (WebRTC) latency.

```
[Controller / Android]  GGIS UAV Companion
   MediaProjection screen capture → H.264/AAC (RootEncoder)
        │  RTMP/SRT push, path = <flightId>, auth = Supabase JWT / pair grant / ingest key
        ▼
[Server / EC2 + Docker]  MediaMTX  ──external auth──▶  stream-gateway (Node, service_role)
   • redistributes  ──WebRTC/WHEP──▶  Pilot Ops + public watch page  (+ HLS fallback)
   • per-mission recording (toggle) ──on close──▶ gateway uploads to Supabase Storage
        ▲                                              + inserts a media row
   Caddy fronts /stream (WHEP/HLS) + /record (toggle)
```

- **GGIS UAV Companion** (`android/`) — Kotlin app for the controller. Pair to a
  mission by code or pick the pilot's active mission, then it **auto-starts casting**;
  "End flight" stops the cast and signs the controller out. The capture is
  drone-agnostic (MediaProjection), so it works on DJI/Autel smart controllers or any
  Android phone/tablet on the RC.
- **Stream gateway** (`services/stream-gateway/`) — Node ESM service holding the
  Supabase `service_role` key. Authorizes every publish/read (by JWT, pair grant, or
  per-flight ingest key), flips `flights.stream_status` live/offline, exposes the
  per-mission `/record` toggle, reconciles dropped streams, and uploads finished
  recordings (size-capped, with retention cleanup).
- **Public watch page** (`watch.html` / `src/watch.js`) — no-login, Teams-style
  multi-screen gallery. An org's **permanent watch link** auto-follows whatever
  missions are live (per-tile maximize + focused read-only/guest chat).
- **Direct drone ingest API** — for non-DJI craft with no Android controller, each
  flight exposes a short **ingest key** so any encoder/ground station (OBS, etc.) can
  push `rtmp://<host>:1935/<flightId>?key=<key>` or the SRT equivalent. Surfaced in
  the dashboard (Live stream → Direct ingest) and Admin console (System → API &
  integrations).

See **[DEPLOY.md](DEPLOY.md)** "Live video" and **[android/README.md](android/README.md)**.

## Pages

This is a multi-page app — four entry documents matching the original prototype:

| Path                | Page                          | Tech                |
|---------------------|-------------------------------|---------------------|
| `/`                 | Pilot Ops dashboard           | React (`src/main.jsx`)        |
| `/login.html`       | Pilot Ops sign-in + invites   | vanilla HTML/JS     |
| `/admin.html`       | Admin console                 | React (`src/admin-main.jsx`)  |
| `/admin-login.html` | Admin sign-in (password + 2FA)| vanilla HTML/JS     |

**Auth gates** (real Supabase sessions): `/` redirects to `/login.html` without a
session; `/admin.html` redirects to `/admin-login.html` unless the signed-in
profile has `is_admin`.

**Accounts** are real. The first admin is created with `scripts/bootstrap-admin.mjs`
(see DEPLOY.md); everyone else is invited from the Admin console and registers via
their invite link. Pilot codes are generated once on registration (shown once) and
stored hashed — verified server-side before each launch.

## What's included

The full Pilot Ops operator app and its views:

| Group       | View                     |
|-------------|--------------------------|
| Operations  | Flight Hub               |
| Operations  | Start mission (embedded pre-flight checklist + 6-digit pilot-code auth) |
| Operations  | Live stream (real WHEP video, per-mission record toggle, share + direct-ingest) |
| Operations  | Multi-screen ops         |
| Operations  | Post-flight summary (editable, attach media from gallery) |
| Fleet       | Aircraft and Batteries   |
| Storage     | Media gallery            |
| Logging     | Pilot logbook (auto-filled from flights, per-pilot filter, readable flight codes) |
| Logging     | Log incident (live persist, media upload, click/typed map pin, save draft) |
| Logging     | Flight log archive (live KPIs, per-author chart, filter + CSV export, new report) |

The **Admin console** (`/admin.html`) adds, among others, an **Incident log**
(live, status workflow open → escalated → resolved → closed, CSV export) and
**System → API & integrations** (direct-ingest docs + real outgoing webhook
manager backed by the `integrations` table).

Plus: emergency-launch flow with abuse guards, Cmd-K command palette, light/dark/
high-contrast themes, accent + density + basemap tweaks panel, and full responsive
layout (off-canvas drawer under 900px).

### Maps

The operations maps (Flight Hub, Live stream, Incident report) use **real tile
basemaps via [Leaflet](https://leafletjs.com/)** — switchable in-map and from the
tweaks panel:

| Preset        | Source                                   |
|---------------|------------------------------------------|
| Streets       | OpenStreetMap                            |
| Satellite     | Esri World Imagery (ArcGIS Online)       |
| Topographic   | Esri World Topo Map                      |
| Dark          | CARTO Dark Matter                        |
| Light (carto) | CARTO Positron                           |

Pins are placed at real coordinates: active flights and stations carry `lat`/`lng`
(see `data.js`); the `MapCanvas` component (`shared.jsx`) also accepts the legacy
`x`/`y` percentage format and maps it onto the operations-area bounding box. Drone
positions animate with a pulse; the map fits its view to the visible pins.

## Project structure

```
index.html            # Pilot Ops entry document (no-flash theme init, Geist fonts)
admin.html            # Admin console entry document
login.html            # Pilot Ops sign-in (vanilla)
admin-login.html      # Admin sign-in with 2FA (vanilla)
watch.html            # Public, no-login live watch page (Teams-style gallery)
src/
  main.jsx            # mounts Pilot Ops; imports modules in prototype load order + auth gate
  admin-main.jsx      # mounts the Admin console + admin auth gate
  app.jsx             # Pilot Ops shell: sidebar, topbar, routing, tweaks wiring
  admin-app.jsx       # Admin shell: sidebar nav, hash routing, all admin tabs
  shared.jsx          # icons, charts, modal, toast, map canvas, KPI tile
  tweaks-panel.jsx    # appearance tweaks (theme/accent/density/basemap)
  store.jsx           # on sign-in, loads + maps all real Supabase data into the global shapes
  data.js             # shared constants + empty/default shapes the store fills
  watch.js            # public watch-page logic (WHEP tiles + guest chat)
  styles.css          # design tokens, layout, components, responsive + dark mode
  views/*.jsx         # one file per screen (pilot + admin views), incl. live-video.jsx
supabase/migrations/  # schema, RLS, RPCs — 0001…0022 (streaming, pairing, public watch,
                      #   auto-logbook, integrations/webhooks, ingest keys)
services/
  stream-gateway/     # Node ESM media-auth + recording-upload service (service_role)
docker/               # mediamtx.yml, Caddyfile, compose overrides for the stream stack
deploy/stream-server/ # EC2 stream-server Caddyfile + ops notes
android/              # GGIS UAV Companion (Kotlin) — controller screen-cast app
```

### How the modules talk to each other

The original prototype loaded each file as a separate `<script>` sharing one global
scope, passing components and data between files via `window`. That contract is
preserved: every module registers its public symbols with `Object.assign(window, …)`
and references others by bare global name. `src/main.jsx` (and `src/admin-main.jsx`)
import the modules in the **exact same order** as the original `Pilot Ops.html` /
`Admin.html` so those globals resolve, then mount `<ToastProvider><App/></ToastProvider>`.

The Pilot Ops dashboard and the Admin console share `data.js`, `shared.jsx`,
`tweaks-panel.jsx`, `fleet.jsx`, and `admin.jsx` (Team roster + Form fields tabs).

## Notes / follow-ups

- **Real backend.** All data is in Postgres (Supabase) with row-level security;
  the only `localStorage` usage left is the theme/tweaks UI preference. Lists start
  empty and fill as real users create flights, incidents, media, etc.
- **Live video is real** — WebRTC (WHEP) from MediaMTX, cast by the GGIS UAV
  Companion or pushed by any encoder via the direct-ingest key; recordings (when the
  per-mission toggle is on) upload to Storage and attach to the flight. The pipeline
  runs on an AWS EC2 box (MediaMTX + stream-gateway + Caddy); see DEPLOY.md and
  `deploy/stream-server/` for bring-up and redeploy.
- **Remaining v1 limitations** (documented in DEPLOY.md): **email** for
  invites/notifications is stub-and-logged to the `notifications` table (no SMTP yet);
  the long-term **video storage backend** is not yet finalized (small clips go to the
  gallery, large ones are purged after 7 days pending an S3-class decision), and
  auto-recording is off by default in favor of the manual per-mission toggle.
- **Smoke tests** (puppeteer-core via Edge): `smoke-auth-gate.mjs` checks the real
  session gate + login render with no backend; `smoke-map.mjs` checks Leaflet tiles.
  The earlier `smoke-test/-auth/-interactions.mjs` predate the backend and assume a
  live Supabase + seeded session to run.
