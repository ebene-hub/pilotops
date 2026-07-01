# Deploying the Pilot Ops frontend (static build)

This is for a **web team hosting the pre-built frontend** on a domain/subdomain
(e.g. `pilotops.geoinfotech.ng`). The backend (Supabase Cloud) and the live-video
stream server (EC2) are already running and are **not** part of this handover —
their URLs are baked into the build, so the app works the same on any domain.

> If you can instead add the subdomain as a **custom domain on the existing Vercel
> project**, do that — Vercel rebuilds and serves it with its own env, and you can
> skip everything below. This document is only for **self-hosting the static build**.

---

## What you're deploying

A **static site** — plain HTML/CSS/JS. No Node server, no build step on your side
(it's already built). You get a `dist/` folder (or `pilotops-dist-*.zip`) with six
entry pages and an `assets/` folder.

## 1. Serve the files as-is

Upload the contents of `dist/` to the web root of the subdomain and serve them as
static files. All six pages must be reachable at their own paths:

| Path | Page |
|------|------|
| `/` (`index.html`) | Pilot Ops dashboard |
| `/login.html`       | Pilot Ops sign-in |
| `/admin.html`       | Admin console |
| `/admin-login.html` | Admin sign-in |
| `/admin-signup.html`| Admin/org sign-up |
| `/watch.html`       | Public live watch page |

## 2. Do NOT add an SPA catch-all rewrite

Some hosts default to "rewrite every path to `index.html`" (single-page-app mode).
**Turn that off.** Each `.html` above is a real file and must be served at its own
path. A catch-all rewrite breaks `/admin.html`, `/watch.html`, etc.

- Query strings must pass through unchanged, e.g. `/watch.html?org=<key>` and
  `/login.html#type=recovery&access_token=…` (used by password reset).
- A 404 fallback to `/index.html` is fine, but do **not** rewrite the named
  `.html` routes.

Nginx example:

```nginx
server {
    listen 443 ssl;
    server_name pilotops.example.com;
    root /var/www/pilotops;          # the uploaded dist/ contents
    index index.html;

    # Serve real files; only fall back to index.html when nothing matches.
    location / {
        try_files $uri $uri/ /index.html;
    }
    # (ssl_certificate / ssl_certificate_key config here)
}
```

Apache: just drop the files in the docroot; no `.htaccess` rewrite needed. If one
exists that forces everything to `index.html`, remove it.

## 3. HTTPS is required

The app calls Supabase and the stream server over HTTPS, and the browser blocks
mixed content, so the site **must** be served over HTTPS. Use whatever certificate
your host provides (Let's Encrypt, etc.).

## 4. Nothing to configure in the build

The Supabase and stream-server URLs, plus the **public** Supabase key, are already
compiled in. There is **no `.env` on the static host** and nothing to edit. If a
backend URL ever changes, we rebuild and hand you a new `dist/`.

---

## Owner checklist (do this once the new domain is live)

These are done by the Pilot Ops account owner in the Supabase dashboard — **not**
the web team — but sign-in/password-reset will fail until they're set:

- **Supabase → Authentication → URL Configuration**
  - **Site URL:** `https://<new-domain>`
  - **Redirect URLs:** add `https://<new-domain>/login.html` and
    `https://<new-domain>/admin-login.html`

Everything else adapts automatically:

- **Watch / share links** use the current origin, so they become the new domain.
- **Streaming** points at the EC2 stream host (unchanged), and the stream
  gateway's CORS reflects the request origin, so the new domain is accepted.
- **Email** (mission notices, summaries) is sent server-side and is
  domain-independent.
