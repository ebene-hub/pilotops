# Transfer the production Supabase project to a company account

Goal: move the Pilot Ops **production** Supabase project (ref `zfpuulhgcubndcywfjxy`)
from your personal account to a **company-owned** Supabase account, for true
company ownership + billing — without breaking anything.

## The important reassurance first

A Supabase **project transfer** moves the project between organizations. The
**project ref, URL, API keys, database, storage, and all settings stay identical.**
So **nothing needs reconfiguring and nothing breaks**:

- ✅ EC2 stream gateway (`SUPABASE_URL` + service_role key) — unchanged
- ✅ Vercel + `pilothub.ggis.africa` (publishable key) — unchanged
- ✅ Android APK (baked-in URL + key) — unchanged, **no rebuild**

Only *who owns and pays for* the project changes. Expect ~1–2 min downtime at most.

---

## Accounts (to keep it clear)

- **Account A** = your current personal account (owns the project today).
- **Account B** = the new company account (will own it).

---

## Step 1 — Create the company account (Account B)

1. Sign up at <https://supabase.com> with the **company email** (e.g. a shared
   `admin@ggis.africa`).
2. It comes with a default organization → rename it to the company name under
   **Organization → Settings → General**.
3. Keep it on **Free** (production is Free; a Free org allows up to 2 projects, so
   there's room). Only go Pro if/when you need it.

## Step 2 — Link your personal account into the company org

This is what allows the transfer (the person initiating must be a **member of the
target org**).

1. Logged in as **Account B (company)** → **Organization → Team / Members → Invite**.
2. Invite **Account A's email** (your personal login) with role **Owner**.
   - ⚠️ Must be **Owner** (or Administrator) — see the warning below.
3. Log in as **Account A** → accept the invite (email link, or in the dashboard).

Account A is now an Owner of both its own org **and** the company org.

## Step 3 — Transfer the project

1. Still logged in as **Account A**, open the **production project**
   (`zfpuulhgcubndcywfjxy`).
2. **Settings → General → Transfer project**.
3. In the target-org dropdown, select the **company organization** → confirm.
4. Done — the project now lives under the company account, same URL/keys/data.

---

## ⚠️ Get these right

1. **Add Account A as Owner (not read-only) in the company org (Step 2).**
   After the transfer, your rights come from your role in the *target* org. As
   read-only you'd lose the ability to run migrations, manage keys, configure
   email, etc. **Owner** keeps your full control; the company still owns billing.

2. **Clear the blockers first** (project → Settings): no active **GitHub
   integration**, no **log drains** configured. (You have neither today, but
   confirm under Settings → Integrations.)

3. **Target org capacity:** a Free org allows **2 projects**. The new company org
   is empty, so there's room. If it's ever full, remove/upgrade first.

4. **Plans must be compatible:** production is Free → a Free company org is fine.
   Moving a paid project to a Free org can drop paid features. Same-region only —
   a transfer can't change the project's region.

---

## After the transfer — verify

1. Open **`pilothub.ggis.africa`** → sign in → dashboard loads → start a mission →
   pair + cast. Since the URL/keys are unchanged, it all just works.
2. Optional: confirm the stream gateway still authorizes casts (the gateway uses
   the same service_role key, which didn't change) — see `deploy/stream-server`
   and the ops notes.

## Rollback

If anything looks off, you can transfer the project **back** to your personal org
the same way (Settings → General → Transfer project). Keys/URL stay identical, so
a round-trip is safe.

---

### One-line summary

Create a company Supabase account → invite your personal email into its org as
**Owner** → from your personal account, **Settings → General → Transfer project**
into the company org. Same keys/URL, nothing to reconfigure.

Sources: Supabase docs — [Project Transfers](https://supabase.com/docs/guides/platform/project-transfer),
[Access Control](https://supabase.com/docs/guides/platform/access-control).
