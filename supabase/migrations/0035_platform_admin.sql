-- 0035_platform_admin.sql
-- Platform (super-admin) layer: lets the platform operator (Geoinfotech) manage
-- ALL organizations that register — separate from, and above, each tenant's own
-- admin. This migration adds only the identity + license *data model* + helpers;
-- the cross-tenant operations live in 0036 (definer RPCs) and the stream-gateway.
--
-- SECURITY MODEL: we do NOT weaken the per-org `org_isolate` RLS (0008/0033).
-- Platform reach comes entirely from SECURITY DEFINER functions that gate on
-- auth_is_platform_admin() and run as the function owner (bypassing RLS). Nothing
-- here grants a tenant any new visibility.

-- Who is a platform super-admin. Deliberately a separate table (not a profiles
-- flag) so it's off the tenant RLS surface entirely. RLS on, NO grants to
-- authenticated → the client cannot read/modify it; only definer fns (and the
-- service_role gateway) touch it. Bootstrap the first row via SQL (see HANDOFF).
create table if not exists platform_admins (
  profile_id uuid primary key references profiles(id) on delete cascade,
  created_at timestamptz default now()
);
alter table platform_admins enable row level security;

-- Is the current caller a platform super-admin? Mirrors auth_org() (0008).
create or replace function auth_is_platform_admin()
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from platform_admins where profile_id = auth.uid());
$$;
grant execute on function auth_is_platform_admin() to authenticated;

-- Per-org license: status + expiry + seat cap. `organizations` already carries
-- operational columns (e.g. delete_after), so these fit alongside.
alter table organizations
  add column if not exists license_status text not null default 'active', -- active | suspended | expired
  add column if not exists license_expires_at date,                        -- null = no expiry
  add column if not exists seat_limit int;                                 -- null = unlimited

-- Effective access for an org: active status AND not past its expiry date.
-- SECURITY DEFINER so login gates can check any org id without RLS friction.
create or replace function org_is_licensed(p_org uuid)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from organizations o
     where o.id = p_org
       and o.license_status = 'active'
       and (o.license_expires_at is null or o.license_expires_at >= current_date)
  );
$$;
grant execute on function org_is_licensed(uuid) to authenticated;

-- Note: the existing `org_read` policy (0008) — select where id = auth_org() —
-- already returns these new columns for a tenant's OWN org, so client login gates
-- can read their own license_status/expiry directly (no extra policy needed).
