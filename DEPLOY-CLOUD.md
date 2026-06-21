# Deploying Pilot Ops — managed (Supabase Cloud + static host)

This is the low-ops path: **no Docker for the app**. The backend runs on
**Supabase Cloud** and the frontend is a static bundle on **Vercel / Netlify /
Cloudflare Pages**. Only the optional **live video** needs a small VPS (Lovable,
Vercel, Netlify, and Supabase can't run the MediaMTX media server).

```
Browser ── Vercel/Netlify (static dist/) ──► Supabase Cloud (Auth + DB + Storage + Realtime)
                                   live video └► small VPS: MediaMTX + stream-gateway (optional)
```

Everything we built reuses as-is — the SQL migrations are standard Supabase.

---

## Part 1 — Backend on Supabase Cloud

1. **Create a project** at https://supabase.com (note the project ref, e.g.
   `abcdxyz`). Save the **database password**.

2. **Apply the schema.** Easiest with the Supabase CLI from this repo:
   ```bash
   npx supabase link --project-ref YOUR_REF      # paste the DB password
   npx supabase db push                          # runs supabase/migrations/* in order
   ```
   Then run the config seed (the migrations create the Default org; this seeds its
   roles/sectors/etc.):
   ```bash
   npx supabase db execute --file supabase/seed.sql
   ```
   *Alternative (no CLI):* open the project's **SQL Editor** and paste each
   `supabase/migrations/00NN_*.sql` in numeric order, then `supabase/seed.sql`.

   > These rely on `pgcrypto` living in the **`extensions`** schema — the Supabase
   > default, so nothing extra to do. If the storage-policy statements in
   > `0004_storage.sql` fail with an ownership error, skip them and instead create
   > a **private bucket named `media`** in the Storage dashboard with the same
   > four authenticated, `bucket_id = 'media'` policies.

3. **Auth → turn off email confirmation.** Dashboard → **Authentication →
   Sign In / Providers → Email** → disable **"Confirm email"** (the invite /
   registration flow signs users in immediately; there's no SMTP in v1). Add your
   site URL under **Authentication → URL Configuration → Site URL** once you have
   the frontend URL (Part 2).

4. **Realtime** is already enabled for the right tables by `0001` — no action.

5. **Grab your keys:** Dashboard → **Project Settings → API**:
   - `Project URL` → `VITE_SUPABASE_URL`
   - `anon public` key → `VITE_SUPABASE_ANON_KEY`
   - `service_role` key → only for the optional live-video gateway / bootstrap
     script. **Never put it in the frontend.**

## Part 2 — Frontend on a static host

The repo already includes `vercel.json` and `netlify.toml` (build `npm run build`,
publish `dist/`; existing `.html` entry points are served directly, unknown paths
fall back to the SPA).

**Vercel:** New Project → import this GitHub repo → it auto-detects Vite. Add
**Environment Variables**:
```
VITE_SUPABASE_URL=https://YOUR_REF.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
```
Deploy. (Netlify/Cloudflare Pages: same build command + publish dir + env vars.)

Then set the Supabase **Site URL** (Part 1.3) to the deployed URL.

## Part 3 — Create the first admin

Open `https://YOUR_SITE/admin-signup.html`, enter an **organization name** + admin
details. This creates your org and makes you its first admin (server-side via
`create_org_and_claim`). Everyone else is invited from the Admin console. From
there: register aircraft, invite pilots, fly.

---

## Part 4 — Live video (optional, needs a small VPS)

The controller-casting feature (GGIS UAV Companion → Live stream) needs the
**MediaMTX** media server + the **stream-gateway**, which can't run on Supabase or
a static host. Put them on any cheap VPS (1 vCPU is plenty):

1. Copy `docker/mediamtx.yml` and `services/stream-gateway/` to the VPS (or clone
   the repo) and run those two services (see the compose definitions in
   `docker-compose.yml`). Set the gateway's env to your **cloud** project:
   ```
   SUPABASE_URL=https://YOUR_REF.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service_role key>
   ```
   Point MediaMTX's `MTX_WEBRTCADDITIONALHOSTS` at the VPS's public host, and open
   ports `1935/tcp` (RTMP), `8189/udp` (WebRTC), and serve the WHEP/HLS HTTP
   (`8889`/`8888`) behind TLS (a small Caddy in front, like the main `Caddyfile`).
2. Rebuild the frontend with the stream URLs pointing at the VPS:
   ```
   VITE_STREAM_URL=https://stream.YOUR_DOMAIN/stream
   VITE_STREAM_HLS_URL=https://stream.YOUR_DOMAIN/hls
   ```
3. Build the Android app (`android/`) with `STREAM_HOST=stream.YOUR_DOMAIN` and the
   same `SUPABASE_URL`/`SUPABASE_ANON_KEY` (see `android/README.md`).

Until this is set up, the Live stream view just shows the simulated placeholder —
the rest of the app works fully on the managed stack.

## Notes / limits
- **Email** (invites/notifications) is stub-and-logged to the `notifications`
  table in v1; wire SMTP in Supabase Auth + a provider to actually send.
- Costs: Supabase free tier + a static host free tier cover a pilot deployment;
  the live-video VPS is the only paid piece (and only if you need casting).
