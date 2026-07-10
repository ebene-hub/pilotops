# Pilot Ops — Project Handoff

_Last updated: 2026-07-06_

This document is the single-page orientation for anyone taking over, operating, or
reviewing **Pilot Ops** — the GGIS UAV operations platform. It covers what the system
is, how it's deployed, everything built to date, how to operate it, and what's still
open. Deep procedural docs are linked where they exist; this file is the map.

---

## 1. What Pilot Ops is

A multi-tenant web platform for running drone (UAV) flight operations end to end:

- **Organizations** sign up, each fully isolated (own pilots, fleet, flights, media, config).
- **Admins** manage the team, fleet, KYC verification, incidents, and org settings.
- **Pilots** run pre-flight checks, start/stop missions, and fly.
- **Live video** from the drone controller's screen is cast into the matching flight's
  livestream in near-real-time (sub-second), recorded, and attached to the flight.
- **Stakeholders** get mission start/end notices, a public "watch live" link, and a
  post-flight summary email (with PDF).

Companion pieces:
- **GGIS UAV Companion** — native Android app installed on the drone controller that
  mirrors the controller screen and casts it into Pilot Ops.
- **Watch page** — public, per-org keyed page for viewing a live flight without an account.

---

## 2. Architecture at a glance

```
                          ┌───────────────────────────── Supabase Cloud ─────────────────────────────┐
  Browser (SPA)  ───────► │  Auth (GoTrue) · Postgres + RLS · REST (PostgREST) · Realtime · Storage    │
  pilothub.ggis.africa    │  project ref: zfpuulhgcubndcywfjxy                                          │
  pilotops.vercel.app     └───────────────▲──────────────────────────────────▲──────────────────────────┘
                                          │ service-role (server only)        │ Send Email Hook (signed)
                                          │                                   │
  Controller (Android) ──RTMP/SRT──►  ┌───┴──────────── EC2 stream server ────┴───┐
  GGIS UAV Companion                  │  pilotops-stream.duckdns.org               │
                                      │  Caddy (TLS) → MediaMTX (video) +          │
  Browser ◄──WHEP/HLS via Caddy───────│  stream-gateway (Node: auth, recordings,   │
                                      │  invite/auth/summary emails)               │
                                      └────────────────────────────────────────────┘
```

**Frontend:** Vite multi-page app (React + `window.*` global-module pattern). Pages:
`index` (dashboard), `login`, `admin-login`, `admin-signup`, `watch`. Built to a static
`dist/`.

**Backend data:** Supabase Cloud. Multi-tenancy is enforced by `org_id` columns +
restrictive Row-Level-Security (`org_isolate`) policies. New API-key system in use:
`sb_publishable_…` for the frontend (respects RLS), `sb_secret_…` server-side (bypasses
RLS). Legacy anon/service_role JWTs are disabled.

**Streaming/email server:** a single EC2 host running Docker Compose — Caddy (auto-TLS),
MediaMTX (ingest RTMP/SRT → redistribute WebRTC/WHEP + HLS, record fmp4), and
`stream-gateway` (Node/Express ESM). The gateway holds the service-role key and is the
only component that sends email and writes recordings.

---

## 3. Deployments — where everything runs

| Piece | Location | How it updates |
|---|---|---|
| **Staging frontend** | `pilotops.vercel.app` | **Auto-deploys** on every `git push` to `main`. Use this to test. |
| **Production frontend** | `pilothub.ggis.africa` | **Static build**, hosted by the web team on cPanel. **Frozen** until you hand them a fresh `dist/`. Does NOT auto-update. |
| **Backend** | Supabase Cloud, ref `zfpuulhgcubndcywfjxy` | Migrations applied by hand (SQL editor / CLI). Shared by both frontends. |
| **Stream + email server** | EC2 `pilotops-stream.duckdns.org` | `git pull` + `docker compose up -d --build` over SSH. |
| **Android app** | GGIS UAV Companion (sideloaded APK) | Built locally, signed, sideloaded onto controllers. |

> **Key operational fact:** both frontends share the **same** Supabase + EC2 backend.
> A backend or gateway change is live for both instantly. A frontend change is live on
> vercel immediately but only reaches pilothub after a `dist` handoff. When something
> "works on vercel but not on pilothub," it's almost always this gap.

---

## 4. What's been built (chronological feature history)

The project has **95 commits**. Grouped by theme:

**Foundation**
- Full-stack Vite/React SPA + self-hosted Supabase schema, functions, RLS, storage.
- Flight Hub (active/inactive states, nav badges), multi-screen view, expand/remove tiles.
- Secure admin sign-up (first-run bootstrap) that closes the `is_admin` privilege hole.
- Start-mission flow: pilot-in-command = signed-in user, selectable co-pilot.
- Post-flight summary: recipient management, send, PDF attachment.

**Multi-tenancy & org config**
- Isolated organizations (`org_id` + RLS everywhere).
- Per-org roles/sectors config; working notification bell + settings menu.
- Per-org branding (org name + "powered by GGIS").

**KYC & onboarding**
- Role-aware KYC captured at registration; admin verification gate.
- KYC restricted to crew; member-detail view in the Team roster.
- **Confirmation email** after new-org registration (via Send Email Hook — see §6).
- **Invite links emailed** to the invited member's address.
- **KYC gate**: members cannot use any feature until an admin verifies them.

**Live video (GGIS UAV Companion)**
- MediaMTX + stream-gateway; controller screen → RTMP/SRT → WHEP/HLS in the browser.
- `LiveVideoFeed` web player replaces the old simulated feed; HLS fallback.
- Controller pairing on Start mission (companion code entry).
- Android app built, signed, APK produced; release signing config.
- Controller location shown on the map.
- Per-player and per-watch-tile **Data saver** (snapshot) toggle; auto-pause when hidden.

**Email system**
- Real mission start/end notices + post-flight summary (Resend, then per-org SMTP).
- Per-org email config (SMTP or Resend) with a global fallback.
- Mismatched-cert SMTP tolerance (shared hosting presents `*.web-hosting.com`).
- Configurable per-org "Watch live" link in notices.
- Summary fixes: pilot name, draft handling, attachments.

**Ops, notifications, safety**
- Resilient watch-page polling + real-time in-app notifications (unread dot, mark-all-read, clear).
- Pilot lockout with admin notify + override; instant summary.
- Incidents, emergency reviews, integrations, webhooks.
- **Org deletion with a 48h grace period** + auto-purge.

**Deployment tooling & docs**
- Managed path: Supabase Cloud + static host.
- `cloud-bootstrap.sql` one-shot Supabase Cloud setup.
- `scripts/build-dist.sh` — safe one-command frontend handoff (aborts if a secret key
  leaks into the bundle, verifies project/stream host, zips as `pilotops-dist-<date>.zip`).
- Docs: `DEPLOY.md`, `DEPLOY-CLOUD.md`, `DEPLOY-STATIC.md`, `TRANSFER-GUIDE.md`.

---

## 5. Database migrations

Applied in order under `supabase/migrations/`. Highlights:

| # | What |
|---|---|
| 0001–0004 | Base schema, functions, RLS, storage |
| 0005–0007 | Member IDs, permissions, admin signup |
| 0008–0009 | **Multi-tenancy**, per-org config |
| 0010 | **KYC** (`profiles.kyc_status`: pending/verified/rejected) |
| 0011–0020 | Streaming, pairing, public watch, public chat, auto-logbook, permanent/active watch keys, ingest keys |
| 0021–0025 | Integrations, webhooks, crew exclusivity, pilot lockout, notifications realtime |
| 0026–0028 | Per-org email settings, SMTP cert flag, email live-url |
| 0029 | Org deletion (48h grace) |
| 0030 | **profiles SELECT grant** — restores table-level grant after legacy keys were disabled (fixed the "not an admin" login bug) |
| 0031 | **finalize_my_invite()** — email-keyed, idempotent invite acceptance (assigns org + roles, marks accepted). Robust against a lost invite token; run on the member's first sign-in/app entry |
| 0032 | **aircraft write policy** — permissive RLS so `fleet.manage` holders (Maintenance Tech) can manage the aircraft registry, not just admins (see §7) |
| 0033 | **org isolation fix** — re-asserts the `trg_org_id` trigger + restrictive `org_isolate` policy across all per-org tables (a fresh DB or a partial apply can leave the restrictive policy inactive → cross-org leakage, e.g. stations). Idempotent; safe to re-run |
| 0034 | **logbook attachment** — `log_path/log_name/log_size` on `logbook_entries` so a pilot can attach a raw `.bin` flight log to a manual entry (file lives in the `media` bucket) |
| 0035 | **platform super-admin** — `platform_admins` table + `auth_is_platform_admin()`, license columns on `organizations` (`license_status`/`license_expires_at`/`seat_limit`), `org_is_licensed()` (see §7.5) |
| 0036 | **platform RPCs** — cross-tenant `platform_list_orgs`, `platform_org_members`, `platform_set_license`, `platform_rename_org`, `platform_get/set_org_email_settings` (all gated on `auth_is_platform_admin()`) |
| 0037 | **platform_set_pilot_code** — platform-admin/service-role launch-code setter so the platform console can (re)set any member's code and issue codes for demo pilots (see §7.5) |

> **Pending live-DB migrations checklist.** These aren't obvious from the app code
> (the policies/functions live only in the migration files). On any DB — especially a
> fresh Supabase project — confirm **0033** (org isolation), **0034** (logbook attach),
> **0035 + 0036 + 0037** (platform) have been applied. `cloud-bootstrap.sql` bundles the base
> schema; the later migrations (0026+) must be applied after if not included.

---

## 6. Onboarding & email — how the current flow works

**Registration → confirmation email**
1. `admin-signup.js` calls `supabase.auth.signUp` with `pending_org_name` stashed in
   user metadata and `emailRedirectTo = <origin>/admin-login.html`.
2. Supabase fires the **Send Email Hook** (Standard Webhooks spec) → POSTs the signed
   payload to the gateway (`/auth-email-hook` or `/email-hook`).
3. The gateway verifies the HMAC signature, builds the verify link from the **Supabase
   project URL** (`${SUPABASE_URL}/auth/v1/verify?token=…&type=…&redirect_to=…`), and
   sends a branded email through the cert-tolerant transport.
4. If no session comes back (confirm-email on), the signup page shows a **"Confirm your
   email"** screen (`showConfirm()`).
5. User clicks the link → verified → redirected to admin sign-in. On first sign-in the
   org is created from `pending_org_name` (deferred org creation in `admin-login.js`).

Why the hook (not Supabase's built-in SMTP): the shared host's cert mismatch
(`*.web-hosting.com`) can't be tolerated by Supabase's built-in SMTP; the gateway's
nodemailer transport can (`smtp_allow_invalid_cert`).

**Invited-member registration → confirmation → launch code** (`login.js`)
1. `members-invites.jsx` POSTs to the gateway `/send-invite`, which emails the invite
   link through the inviting admin's org transport. Revoked invites drop off Pending.
2. The member opens the link, fills name + KYC + password, and registers. Because
   email confirmation is on, `signUp` returns no session — so the KYC, a generated
   pilot code, and the invite token are **stashed in `user_metadata`** and a
   **"Confirm your email"** screen is shown. (Same Send Email Hook as above.)
3. If the email is **already registered**, `signUp` is a silent no-op (enumeration-safe:
   empty `identities`); the flow detects this and tells them to **sign in instead**.
4. Member confirms → returns to `/login.html` → signs in. On first sign-in, the
   **finalizer** runs: `finalize_my_invite()` (accepts the invite by email → org + roles),
   saves the stashed KYC, sets the pilot code, and **reveals the launch code**.
5. The finalizer **also runs on first app entry** (`main.jsx`) as the guaranteed
   chokepoint, and the launch code is shown again on the KYC-pending gate so a gated
   member can still save it.

Why email-keyed (`finalize_my_invite`, migration 0031): the old token-based
acceptance broke when the stashed token was lost (e.g. a duplicate `signUp`), leaving
the invite permanently "pending". Accepting by the signed-in user's email is robust and
idempotent. Note: `supabase.rpc()` **resolves with `{error}` — it does not throw** — so
RPC errors must be checked, not wrapped in try/catch.

**KYC gate** — `main.jsx` blocks non-admins whose `kyc_status !== 'verified'` with a
"pending verification" screen (which also shows their launch code). Founders are
auto-verified via `create_org_and_claim`. An admin verifies members in the Team roster
(`set_kyc_status`).

**Deliverability caveat (now blocking):** emails **send** but land in Gmail spam without
SPF/DKIM/DMARC for `pilothub.ggis.africa`. Since invited members **must** click the
confirmation link to finish, this blocks real onboarding until fixed in
cPanel → Email Deliverability.

**Auth redirect config (required):** Supabase → Authentication → URL Configuration must
list **both** `https://pilotops.vercel.app/**` and `https://pilothub.ggis.africa/**` under
Redirect URLs. Otherwise GoTrue ignores the requested `redirect_to` and sends the confirm
link to the Site URL. Confirm links always return to the origin the member **registered**
on — don't mix sites within one test.

---

## 7. Roles & access model

There are **two areas** on the same domain, each with its own auth storage key
(`src/api/supabase.js`) so a person can be signed into both independently:

- **Operational Pilot Ops app** (`/`, sign in at `/login.html`) — pilots **and all
  other operational roles** work here.
- **Admin console** (`/admin*.html`, sign in at `/admin-login.html`) — admins, **plus
  specific non-admin roles scoped to just their pages** (see below).

**Who can enter the operational app:** anyone holding an operational role
(`PILOT_OPS_ROLES` in `main.jsx`: Pilot, Co-pilot, Mission Commander, Safety Officer,
Observer, Maintenance Tech, Dispatcher, Director). The **KYC gate** still applies to
non-admins.

**Permissions** are the union of a member's roles' `permissions` arrays (`0006`),
enforced **server-side by RLS** via `auth_has_perm(...)` — so unchecking a permission
actually blocks the action, not just the button. Canonical vocabulary:
`flight.create, incident.create, media.upload, report.create, battery.update,
fleet.manage, emergency.review, audit.read`, and `*` (admin/Director).

**Role-scoped admin access** — some tools live in the admin console but are needed by
non-admin roles. Rather than duplicate them, those roles get into the console with a
**nav filtered to only their pages** (`ADMIN_PAGE_PERM` in `admin-app.jsx` is the single
source of truth; the login gate and `admin-main.jsx` mirror it via `ADMIN_SURFACED_PERMS`):

| Role | Permission | Admin pages they see |
|---|---|---|
| Maintenance Tech | `fleet.manage` | Aircraft registry (+ batteries) |
| Safety Officer | `emergency.review`, `audit.read` | Emergency reviews, Incident log, Audit log |
| Admin / Director | `*` | Everything |

Enforcement is layered: **login gate** (`admin-login.js` — must hold a surfaced
permission), **nav filter + hash guard** (`admin-app.jsx` — can't reach admin-only pages
by URL), **scoped permissions** (`admin-main.jsx` loads real perms, not `*`), and
**RLS** (writes gated server-side; migration 0032 added the aircraft-write policy for
`fleet.manage`). A role with no surfaced permission (e.g. a plain Pilot) is refused at
the console login with *"This account doesn't have admin-console access."*

To change what a role can do or see: edit its permissions in **Admin → Roles &
permissions** (`set` via the roles table). To add a new scoped admin page, add an entry
to `ADMIN_PAGE_PERM` and (if it needs a new write) an RLS policy gated on that permission.

---

## 7.5 Platform super-admin (Geoinfotech)

A separate console for the **platform operator** (Geoinfotech) to manage every org
that registers — above and outside any single tenant. It deliberately crosses the
`org_isolate` boundary, but **safely**: the tenant RLS is never weakened.

**Where it lives**
- `/platform-login.html` → `src/platform-login.js` — dedicated sign-in, gated on
  `auth_is_platform_admin()`. Non-platform accounts are rejected even with valid creds.
- `/platform.html` → `src/platform-main.jsx` → `src/platform-app.jsx` — the console:
  Organizations table (license, seats, members, flights, email-configured), **Create
  organization**, and a per-org **Manage** drawer (License / Email delivery / Members).
- Uses its own auth storage key `po-auth-platform` (`src/api/supabase.js`), independent
  of tenant admin/pilot sessions.

**How cross-tenant access is done (security)**
- Data: SECURITY DEFINER RPCs (`platform_*`, migration 0036) that each gate on
  `auth_is_platform_admin()` as their first statement (definer fns run as `postgres`,
  bypassing RLS). Same pattern as `org_email_settings`. A missing gate = data exposure,
  so review each fn's first line if editing.
- Account creation (needs the Auth Admin API, can't be SQL): gateway endpoints
  `POST /platform/create-org` and `POST /platform/register-pilot` — gated on
  `platform_admins` membership, using the service-role key. They create an email-confirmed
  account with no password and email a **recovery ("set password") link** (and also return
  it so the operator can copy it if email isn't configured). Provisioning emails use the
  **global** gateway transport (`SMTP_*`/`RESEND_API_KEY`).

**License model (0035):** `organizations.license_status` (active/suspended/expired),
`license_expires_at` (date, null = none), `seat_limit` (int, null = ∞). Seat cap is
enforced when registering a member. **Login enforcement:** suspended or expired orgs are
blocked at every entry gate — `admin-login.js`, `admin-main.jsx` (admin) and `main.jsx`
(pilot; `login.js` redirects into it) — with a "contact your provider" message. (Gate-level
for v1; deeper RLS-level enforcement is a future hardening step.)

**Bootstrap the first super-admin (run once):**
```sql
-- 1. Create the dedicated Geoinfotech account (Supabase dashboard → Auth → Add user,
--    or one-off generateLink). It should have NO tenant org_id.
-- 2. Mark it a platform admin:
insert into platform_admins (profile_id)
values ('<that-users-profile-uuid>')
on conflict do nothing;
```
Then sign in at `/platform-login.html`.

---

## 8. Operating the system

**Push a frontend change**
```bash
git push origin main          # → vercel.app rebuilds automatically
bash scripts/build-dist.sh    # → pilotops-dist-<date>.zip for pilothub
# hand the zip + DEPLOY-STATIC.md to the web team
```

**Deploy a gateway / stream-server change**
```bash
ssh -i ssh-keypair.pem ubuntu@pilotops-stream.duckdns.org
cd ~/pilotops && git pull --ff-only
cd deploy/stream-server && sudo docker compose up -d --build stream-gateway
sudo docker compose logs --tail=50 stream-gateway
```
> SSH port 22 is IP-restricted; your IP rotates, so you may need to re-whitelist it in
> the EC2 security group each session. See the `stream-server-ops` memory note.

**Apply a DB migration** — run the SQL in the Supabase dashboard SQL editor against ref
`zfpuulhgcubndcywfjxy`, or via the Supabase CLI.

**Build/sign the Android app** — see `android/README.md`. Release keystore location,
alias, and build command are in the `android-release-signing` memory note.

---

## 9. Secrets & security (where they live — never in git)

The repo is **public**. The following must never be committed and are gitignored
(`*.pem`, `*.key`, `*.jks`, `*.keystore`, `*.apk`):

- `ssh-keypair.pem` — EC2 SSH key.
- Android release keystore `android/app/ggis-release.jks` (alias `ggis`).
- `SUPABASE_SERVICE_ROLE_KEY` / `sb_secret_…` — server-side only, on the EC2 `.env`.
- `SEND_EMAIL_HOOK_SECRET` (`v1,whsec_…`) — on the EC2 `.env`; matches the secret
  generated in Supabase's Send Email Hook config.
- Per-org SMTP/Resend secrets — stored in `org_email_settings` (write-only RPCs).

**Rules:** service_role / `sb_secret_` keys must **never** be a `VITE_` frontend variable
(only publishable/anon may be baked into the bundle — `build-dist.sh` enforces this).
Git commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## 10. Open items / next steps

| Item | Status |
|---|---|
| Full onboarding flow (confirmation email, invited-member confirm + launch code, robust invite acceptance, KYC gate) | **Shipped & verified end-to-end on vercel.** Migration 0031 applied; Auth Redirect URLs configured for both domains. |
| Role-scoped admin access (Maintenance Tech → Aircraft registry; Safety Officer → Emergency reviews / Incidents / Audit) — see §7 | **Shipped.** Requires **migration 0032** applied to the live DB (aircraft-write policy). |
| Hand fresh `dist` to web team for pilothub | **`pilotops-dist-20260706.zip` ready** (carries everything above + duplicate-email guard). Give with `DEPLOY-STATIC.md`. Backend is shared, so no separate DB step for pilothub. |
| **SPF/DKIM/DMARC for `pilothub.ggis.africa`** | **Blocking for real onboarding** — invited members must click the confirm email, which currently lands in spam. cPanel → Email Deliverability. |
| Admin invite list is not realtime | Minor — the admin must refresh to see an accepted invite move to Active. Could add a realtime subscription if desired. |
| Move production to a **company Supabase account** | Decided yes; guide written (`TRANSFER-GUIDE.md`). Not yet executed. |
| Supabase Branching | Deferred until on the Pro plan. |
| Recording storage backend | Undecided — see `video-storage-pending` memory note (<45MB → gallery, >45MB purged after 7 days). |

---

## 11. File reference (where to look)

- **Frontend entry / gate:** `src/main.jsx` (KYC gate + invite finalizer on app entry),
  `src/login.js` (invited-member registration, confirm screen, launch-code reveal,
  duplicate-email guard), `src/admin-signup.js`, `src/admin-login.js` (deferred org
  creation + role-scoped console gate).
- **Admin console:** `src/admin-main.jsx` (auth gate + scoped permission loading),
  `src/admin-app.jsx` (`ADMIN_PAGE_PERM`, nav filter, hash guard) — see §7.
- **Views:** `src/views/*.jsx` — e.g. `members-invites.jsx`, `live-video.jsx`,
  `admin-email-settings.jsx`, `admin-danger.jsx` (org deletion).
- **Gateway:** `services/stream-gateway/index.mjs` — auth, recordings, and all
  outbound email (`/send-invite`, `/auth-email-hook`, `/send-summary`, `/send-test-email`).
- **Infra:** `docker-compose.yml`, `deploy/stream-server/`, `docker/Caddyfile`,
  `docker/mediamtx.yml`.
- **DB:** `supabase/migrations/`, `cloud-bootstrap.sql`.
- **Android:** `android/` (`README.md` for build/sideload).
- **Docs:** `DEPLOY.md`, `DEPLOY-CLOUD.md`, `DEPLOY-STATIC.md`, `TRANSFER-GUIDE.md`.
- **Tooling:** `scripts/build-dist.sh`.
