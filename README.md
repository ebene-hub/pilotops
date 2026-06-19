# Pilot Ops — Logging & Operations Dashboard

A UAV pilot logging and operations platform: a **Vite + React** multi-page
frontend backed by **self-hosted Supabase** (Postgres + Auth + Storage +
Realtime). Real authentication, real data, real device geolocation — no dummy
data. Deployable with Docker.

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
chat, incident logging at current location, media upload to Storage, fleet/battery
registry + status updates.

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

The full Pilot Ops operator app and all 10 of its views:

| Group       | View                     |
|-------------|--------------------------|
| Operations  | Flight Hub               |
| Operations  | Start mission (embedded pre-flight checklist + 6-digit pilot-code auth) |
| Operations  | Live stream              |
| Operations  | Multi-screen ops         |
| Operations  | Post-flight summary (editable, attach media from gallery) |
| Fleet       | Aircraft and Batteries   |
| Storage     | Media gallery            |
| Logging     | Pilot logbook            |
| Logging     | Log incident             |
| Logging     | Flight log archive       |

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
src/
  main.jsx            # mounts Pilot Ops; imports modules in prototype load order + auth gate
  admin-main.jsx      # mounts the Admin console + admin auth gate
  app.jsx             # Pilot Ops shell: sidebar, topbar, routing, tweaks wiring
  admin-app.jsx       # Admin shell: sidebar nav, hash routing, all admin tabs
  shared.jsx          # icons, charts, modal, toast, map canvas, KPI tile
  tweaks-panel.jsx    # appearance tweaks (theme/accent/density/basemap)
  data.js             # sample data (pilots, flights, incidents, roster, sectors)
  styles.css          # design tokens, layout, components, responsive + dark mode
  views/*.jsx         # one file per screen (pilot + admin views)
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
- **v1 limitations** (documented in DEPLOY.md): live **video** is a simulated feed
  (telemetry/chat/position are real); **email** for invites/notifications is
  stub-and-logged to the `notifications` table (no SMTP yet). A few secondary admin
  flows (member role management, report authoring, some dashboard aggregates) persist
  partially and are the next wiring pass.
- **Smoke tests** (puppeteer-core via Edge): `smoke-auth-gate.mjs` checks the real
  session gate + login render with no backend; `smoke-map.mjs` checks Leaflet tiles.
  The earlier `smoke-test/-auth/-interactions.mjs` predate the backend and assume a
  live Supabase + seeded session to run.
