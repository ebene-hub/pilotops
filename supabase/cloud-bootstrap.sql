-- Pilot Ops — combined cloud bootstrap (migrations 0001-0012 + seed).
-- Generated; paste into the Supabase SQL Editor and Run once.
-- Source of truth remains the individual files in supabase/migrations/.


-- ============================================================
-- 0001_schema.sql
-- ============================================================
-- Pilot Ops — core schema
-- Postgres / Supabase. Runs once on DB init (and via supabase CLI migrations).

create extension if not exists pgcrypto;

-- updated_at helper ----------------------------------------------------------
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- PROFILES (one per auth.users) ----------------------------------------------
create table if not exists profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text not null default '',
  email         text,
  initials      text,
  color         text default '#2563eb',
  license       text,
  status        text not null default 'active',   -- active|standby|off-duty|suspended
  is_admin      boolean not null default false,
  admin_role    text,                              -- e.g. 'Ops Director' (when is_admin)
  pilot_code_hash text,                            -- bcrypt of the 6-digit code
  flight_hours  numeric default 0,
  last_active   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_profiles_updated before update on profiles
  for each row execute function set_updated_at();

-- ROLES & assignment ---------------------------------------------------------
create table if not exists roles (
  id          uuid primary key default gen_random_uuid(),
  name        text unique not null,
  description text,
  permissions jsonb not null default '[]',
  created_at  timestamptz not null default now()
);
create table if not exists member_roles (
  profile_id uuid references profiles(id) on delete cascade,
  role_id    uuid references roles(id)    on delete cascade,
  primary key (profile_id, role_id)
);

-- CONFIG (admin-editable) ----------------------------------------------------
create table if not exists stations (
  id     uuid primary key default gen_random_uuid(),
  code   text, name text not null, coords text,
  lat    double precision, lng double precision,
  created_at timestamptz default now()
);
create table if not exists sectors (
  id    text primary key,                 -- 'generic','pipeline',...
  label text not null, units jsonb,
  incident_types jsonb default '[]', sample_places jsonb default '[]',
  active boolean default false
);
create table if not exists coverage_areas (
  id uuid primary key default gen_random_uuid(), name text not null, sort int default 0
);
create table if not exists purposes (
  id uuid primary key default gen_random_uuid(), name text not null, sort int default 0
);
create table if not exists form_field_config (
  key text primary key, type text not null default 'text', options jsonb default '[]'
);

-- FLEET ----------------------------------------------------------------------
create table if not exists aircraft (
  id uuid primary key default gen_random_uuid(),
  code text, model text, serial text, payload text,
  home_station  uuid references stations(id) on delete set null,
  primary_pilot uuid references profiles(id) on delete set null,
  status text default 'ready', in_service date, next_service date,
  flight_hours numeric default 0, notes text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create trigger trg_aircraft_updated before update on aircraft
  for each row execute function set_updated_at();

create table if not exists batteries (
  id uuid primary key default gen_random_uuid(),
  code text, aircraft_id uuid references aircraft(id) on delete set null,
  capacity_mah int, cycle_rating int, cycles int default 0,
  health int default 100, charge int default 100, status text default 'charged',
  last_updated_by uuid references profiles(id) on delete set null,
  last_updated_at timestamptz, notes text,
  created_at timestamptz default now()
);
create table if not exists maintenance (
  id uuid primary key default gen_random_uuid(),
  aircraft_id uuid references aircraft(id) on delete cascade,
  type text, due date, status text default 'scheduled', notes text,
  created_at timestamptz default now()
);

-- FLIGHTS --------------------------------------------------------------------
create table if not exists flights (
  id uuid primary key default gen_random_uuid(),
  code text,                                  -- FL-#### display id
  pilot_id    uuid references profiles(id) on delete set null,
  aircraft_id uuid references aircraft(id) on delete set null,
  station_id  uuid references stations(id) on delete set null,
  area text, coverage_km numeric, purpose text, altitude numeric,
  scheduled_at timestamptz, started_at timestamptz, ended_at timestamptz,
  status text default 'scheduled',            -- scheduled|live|completed|flagged
  emergency boolean default false, emergency_type text, justification text,
  launch_lat double precision, launch_lng double precision,
  cur_lat double precision, cur_lng double precision,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create trigger trg_flights_updated before update on flights
  for each row execute function set_updated_at();

create table if not exists flight_crew (
  flight_id  uuid references flights(id) on delete cascade,
  profile_id uuid references profiles(id) on delete cascade,
  role text,
  primary key (flight_id, profile_id, role)
);
create table if not exists preflight_checks (
  flight_id uuid primary key references flights(id) on delete cascade,
  state jsonb not null default '{}', signoff boolean default false,
  signed_by uuid references profiles(id) on delete set null, signed_at timestamptz
);

-- INCIDENTS / MEDIA / REPORTS / LOGBOOK / CURRENCIES -------------------------
create table if not exists incidents (
  id uuid primary key default gen_random_uuid(),
  code text, flight_id uuid references flights(id) on delete set null,
  type text, severity text, place text,
  lat double precision, lng double precision,
  reporter_id uuid references profiles(id) on delete set null,
  status text default 'open', description text, visualize jsonb default '{}',
  created_at timestamptz default now()
);
create table if not exists media (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null, name text, type text, size bigint, duration text,
  pilot_id uuid references profiles(id) on delete set null,
  flight_id uuid references flights(id) on delete set null,
  area text, tags jsonb default '[]', starred boolean default false, exif jsonb,
  created_at timestamptz default now()
);
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  code text, title text, author_id uuid references profiles(id) on delete set null,
  type text, status text default 'draft', period text,
  flights int default 0, incidents int default 0,
  created_at timestamptz default now()
);
create table if not exists logbook_entries (
  id uuid primary key default gen_random_uuid(),
  pilot_id uuid references profiles(id) on delete cascade,
  flight_id uuid references flights(id) on delete set null,
  date date, aircraft_type text, conditions text, duration_min int,
  night boolean default false, bvlos boolean default false, notes text,
  created_at timestamptz default now()
);
create table if not exists currencies (
  id uuid primary key default gen_random_uuid(),
  pilot_id uuid references profiles(id) on delete cascade,
  type text, expires_at date, status text,
  created_at timestamptz default now()
);

-- CHAT / STAKEHOLDERS / NOTIFICATIONS ---------------------------------------
create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  flight_id uuid references flights(id) on delete cascade,
  sender_id uuid references profiles(id) on delete set null,
  sender_name text, sender_role text, text text not null,
  created_at timestamptz default now()
);
create table if not exists stakeholders (
  id uuid primary key default gen_random_uuid(),
  name text, email text, role text, notify jsonb default '[]', avatar text,
  created_at timestamptz default now()
);
create table if not exists notification_rules (
  id uuid primary key default gen_random_uuid(),
  event text, audience text, delivery_window text, channels jsonb default '[]',
  created_at timestamptz default now()
);
create table if not exists notifications (        -- stub-and-log sink (no SMTP yet)
  id uuid primary key default gen_random_uuid(),
  type text, payload jsonb, recipients jsonb default '[]',
  sent boolean default false, created_at timestamptz default now()
);

-- INVITES --------------------------------------------------------------------
create table if not exists invites (
  id uuid primary key default gen_random_uuid(),
  token text unique not null, email text not null, roles jsonb default '[]',
  invited_by uuid references profiles(id) on delete set null, invited_by_name text,
  status text default 'pending', message text,
  expires_at timestamptz, opened_at timestamptz, accepted_at timestamptz,
  created_at timestamptz default now()
);

-- AUDIT / AUTH ATTEMPTS / EMERGENCY REVIEWS ---------------------------------
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz default now(), actor_id uuid references profiles(id) on delete set null,
  actor_name text, kind text, context text, detail jsonb
);
create table if not exists auth_attempts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete cascade,
  ok boolean, context text, ts timestamptz default now()
);
create table if not exists emergency_reviews (
  id uuid primary key default gen_random_uuid(),
  flight_id uuid references flights(id) on delete cascade,
  status text default 'pending',
  reviewed_by uuid references profiles(id) on delete set null,
  reviewed_at timestamptz, notes text,
  created_at timestamptz default now()
);

-- Helpful indexes
create index if not exists idx_flights_status on flights(status);
create index if not exists idx_flights_pilot  on flights(pilot_id);
create index if not exists idx_incidents_created on incidents(created_at desc);
create index if not exists idx_media_created   on media(created_at desc);
create index if not exists idx_chat_flight     on chat_messages(flight_id, created_at);
create index if not exists idx_auth_attempts   on auth_attempts(profile_id, ts desc);

-- Realtime: stream these tables to subscribed clients
alter publication supabase_realtime add table flights;
alter publication supabase_realtime add table incidents;
alter publication supabase_realtime add table chat_messages;
alter publication supabase_realtime add table batteries;

-- ============================================================
-- 0002_functions.sql
-- ============================================================
-- Pilot Ops — security-definer functions & triggers
-- These run as the table owner, so security-sensitive logic (code hashing,
-- lockout, invite acceptance) lives here rather than in the client.

-- Auto-create a profile row when an auth user is created (sign-up / invite). --
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.profiles (id, email, full_name, initials, is_admin, admin_role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'initials',
             upper(left(coalesce(new.raw_user_meta_data->>'full_name', 'U'), 1))),
    coalesce((new.raw_user_meta_data->>'is_admin')::boolean, false),
    new.raw_user_meta_data->>'admin_role'
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function handle_new_user();

-- Is the current user an admin? (used by RLS policies) -----------------------
create or replace function auth_is_admin()
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

-- Set a pilot's 6-digit code (hashed). Admin or the user themselves. ---------
create or replace function set_pilot_code(p_profile uuid, p_code text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not (auth_is_admin() or auth.uid() = p_profile) then
    raise exception 'not authorized';
  end if;
  if p_code !~ '^[0-9]{6}$' then
    raise exception 'code must be 6 digits';
  end if;
  update profiles set pilot_code_hash = crypt(p_code, gen_salt('bf')) where id = p_profile;
end; $$;

-- Verify a pilot code before launch. Server-side lockout (3 fails / 15 min). -
create or replace function verify_pilot_code(p_pilot uuid, p_code text, p_context text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_hash text;
  v_recent int;
  v_ok boolean;
  v_max int := 3;
  v_window interval := interval '15 minutes';
  v_last_fail timestamptz;
begin
  select count(*) into v_recent from auth_attempts
    where profile_id = p_pilot and ok = false and ts > now() - v_window;

  if v_recent >= v_max then
    select max(ts) into v_last_fail from auth_attempts
      where profile_id = p_pilot and ok = false and ts > now() - v_window;
    return jsonb_build_object('ok', false, 'locked', true,
      'locked_until', (v_last_fail + v_window), 'attempts_remaining', 0);
  end if;

  select pilot_code_hash into v_hash from profiles where id = p_pilot;
  v_ok := v_hash is not null and v_hash = crypt(p_code, v_hash);
  insert into auth_attempts(profile_id, ok, context) values (p_pilot, v_ok, p_context);

  if v_ok then
    return jsonb_build_object('ok', true, 'attempts_remaining', v_max);
  end if;
  return jsonb_build_object('ok', false, 'locked', (v_recent + 1) >= v_max,
    'attempts_remaining', greatest(0, v_max - (v_recent + 1)));
end; $$;

-- Count a pilot's emergency launches in the last 30 days (rate-limit guard). -
create or replace function emergency_count_30d(p_pilot uuid)
returns int language sql stable security definer set search_path = public, extensions as $$
  select count(*)::int from flights
   where pilot_id = p_pilot and emergency = true and created_at > now() - interval '30 days';
$$;

-- Invite flow (anon-safe lookup; authenticated acceptance) -------------------
create or replace function get_invite(p_token text)
returns jsonb language sql security definer set search_path = public, extensions as $$
  select case when i.id is null then null else jsonb_build_object(
    'token', i.token, 'email', i.email, 'roles', i.roles,
    'invited_by_name', i.invited_by_name, 'status', i.status,
    'message', i.message, 'expires_at', i.expires_at
  ) end
  from invites i where i.token = p_token;
$$;

create or replace function mark_invite_opened(p_token text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  update invites set status = 'opened', opened_at = now()
  where token = p_token and status = 'pending';
end; $$;

create or replace function accept_invite(p_token text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v invites;
begin
  select * into v from invites where token = p_token;
  if v.id is null then raise exception 'invalid invite'; end if;
  if v.status = 'accepted' then raise exception 'already accepted'; end if;
  if v.status = 'revoked'  then raise exception 'revoked'; end if;
  if v.expires_at < now()  then raise exception 'expired'; end if;

  update invites set status = 'accepted', accepted_at = now() where id = v.id;
  insert into member_roles(profile_id, role_id)
    select auth.uid(), r.id from roles r
     where r.name in (select jsonb_array_elements_text(v.roles))
  on conflict do nothing;
end; $$;

grant execute on function verify_pilot_code(uuid, text, text) to authenticated;
grant execute on function set_pilot_code(uuid, text)          to authenticated;
grant execute on function emergency_count_30d(uuid)           to authenticated;
grant execute on function get_invite(text)                    to anon, authenticated;
grant execute on function mark_invite_opened(text)            to anon, authenticated;
grant execute on function accept_invite(text)                 to authenticated;

-- ============================================================
-- 0003_rls.sql
-- ============================================================
-- Pilot Ops — grants & row-level security
-- Model: authenticated users can read shared operational data; writes are
-- scoped to the owner or to admins. The pilot code hash is never client-readable
-- or client-writable (only the security-definer RPCs touch it).

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Protect the pilot code hash: drop blanket select/update on profiles, then
-- re-grant only the safe columns. is_admin/admin_role are NOT client-writable
-- (changed via set_member_admin RPC), preventing privilege escalation.
revoke select, update on profiles from authenticated;
grant select (id, full_name, email, initials, color, license, status, is_admin,
              admin_role, flight_hours, last_active, created_at, updated_at)
  on profiles to authenticated;
grant update (full_name, email, initials, color, license, status, flight_hours, last_active)
  on profiles to authenticated;

create or replace function set_member_admin(p_profile uuid, p_is_admin boolean, p_admin_role text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not auth_is_admin() then raise exception 'not authorized'; end if;
  update profiles set is_admin = p_is_admin, admin_role = p_admin_role where id = p_profile;
end; $$;
grant execute on function set_member_admin(uuid, boolean, text) to authenticated;

-- Reference/config tables: everyone reads, only admins write -----------------
do $$
declare t text;
begin
  foreach t in array array[
    'roles','member_roles','stations','sectors','coverage_areas','purposes',
    'form_field_config','aircraft','maintenance','notification_rules',
    'stakeholders','currencies'
  ] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists %I on %I;', t||'_read', t);
    execute format('create policy %I on %I for select to authenticated using (true);', t||'_read', t);
    execute format('drop policy if exists %I on %I;', t||'_admin', t);
    execute format('create policy %I on %I for all to authenticated using (auth_is_admin()) with check (auth_is_admin());', t||'_admin', t);
  end loop;
end $$;

-- profiles -------------------------------------------------------------------
alter table profiles enable row level security;
drop policy if exists profiles_read on profiles;
create policy profiles_read   on profiles for select to authenticated using (true);
drop policy if exists profiles_self on profiles;
create policy profiles_self   on profiles for update to authenticated using (auth.uid() = id);
drop policy if exists profiles_admin on profiles;
create policy profiles_admin  on profiles for all    to authenticated using (auth_is_admin()) with check (auth_is_admin());

-- flights (collaborative ops): read+create+update by any authenticated, admin delete
alter table flights enable row level security;
drop policy if exists flights_read on flights;
create policy flights_read   on flights for select to authenticated using (true);
drop policy if exists flights_write on flights;
create policy flights_write  on flights for insert to authenticated with check (true);
drop policy if exists flights_update on flights;
create policy flights_update on flights for update to authenticated using (true);
drop policy if exists flights_del on flights;
create policy flights_del     on flights for delete to authenticated using (auth_is_admin());

alter table flight_crew enable row level security;
drop policy if exists crew_all on flight_crew;
create policy crew_all on flight_crew for all to authenticated using (true) with check (true);
alter table preflight_checks enable row level security;
drop policy if exists pf_all on preflight_checks;
create policy pf_all on preflight_checks for all to authenticated using (true) with check (true);

-- incidents ------------------------------------------------------------------
alter table incidents enable row level security;
drop policy if exists inc_read on incidents;
create policy inc_read   on incidents for select to authenticated using (true);
drop policy if exists inc_insert on incidents;
create policy inc_insert on incidents for insert to authenticated with check (reporter_id = auth.uid() or auth_is_admin());
drop policy if exists inc_update on incidents;
create policy inc_update on incidents for update to authenticated using (reporter_id = auth.uid() or auth_is_admin());
drop policy if exists inc_del on incidents;
create policy inc_del    on incidents for delete to authenticated using (auth_is_admin());

-- media ----------------------------------------------------------------------
alter table media enable row level security;
drop policy if exists media_read on media;
create policy media_read   on media for select to authenticated using (true);
drop policy if exists media_insert on media;
create policy media_insert on media for insert to authenticated with check (pilot_id = auth.uid() or auth_is_admin());
drop policy if exists media_update on media;
create policy media_update on media for update to authenticated using (pilot_id = auth.uid() or auth_is_admin());
drop policy if exists media_del on media;
create policy media_del    on media for delete to authenticated using (pilot_id = auth.uid() or auth_is_admin());

-- batteries: read all; status updates by any authenticated; insert/delete admin
alter table batteries enable row level security;
drop policy if exists bat_read on batteries;
create policy bat_read   on batteries for select to authenticated using (true);
drop policy if exists bat_update on batteries;
create policy bat_update on batteries for update to authenticated using (true);
drop policy if exists bat_insert on batteries;
create policy bat_insert on batteries for insert to authenticated with check (auth_is_admin());
drop policy if exists bat_del on batteries;
create policy bat_del    on batteries for delete to authenticated using (auth_is_admin());

-- chat -----------------------------------------------------------------------
alter table chat_messages enable row level security;
drop policy if exists chat_read on chat_messages;
create policy chat_read   on chat_messages for select to authenticated using (true);
drop policy if exists chat_insert on chat_messages;
create policy chat_insert on chat_messages for insert to authenticated with check (sender_id = auth.uid());

-- logbook --------------------------------------------------------------------
alter table logbook_entries enable row level security;
drop policy if exists log_read on logbook_entries;
create policy log_read   on logbook_entries for select to authenticated using (true);
drop policy if exists log_write on logbook_entries;
create policy log_write  on logbook_entries for insert to authenticated with check (pilot_id = auth.uid() or auth_is_admin());
drop policy if exists log_update on logbook_entries;
create policy log_update on logbook_entries for update to authenticated using (pilot_id = auth.uid() or auth_is_admin());

-- reports --------------------------------------------------------------------
alter table reports enable row level security;
drop policy if exists rep_read on reports;
create policy rep_read   on reports for select to authenticated using (true);
drop policy if exists rep_write on reports;
create policy rep_write  on reports for insert to authenticated with check (author_id = auth.uid() or auth_is_admin());
drop policy if exists rep_update on reports;
create policy rep_update on reports for update to authenticated using (author_id = auth.uid() or auth_is_admin());
drop policy if exists rep_del on reports;
create policy rep_del    on reports for delete to authenticated using (auth_is_admin());

-- notifications & audit: write by anyone authenticated, read by admins -------
alter table notifications enable row level security;
drop policy if exists notif_insert on notifications;
create policy notif_insert on notifications for insert to authenticated with check (true);
drop policy if exists notif_read on notifications;
create policy notif_read   on notifications for select to authenticated using (auth_is_admin());

alter table audit_log enable row level security;
drop policy if exists audit_insert on audit_log;
create policy audit_insert on audit_log for insert to authenticated with check (true);
drop policy if exists audit_read on audit_log;
create policy audit_read   on audit_log for select to authenticated using (auth_is_admin());

-- emergency reviews: read all; create on launch; admin sign-off --------------
alter table emergency_reviews enable row level security;
drop policy if exists emr_read on emergency_reviews;
create policy emr_read   on emergency_reviews for select to authenticated using (true);
drop policy if exists emr_insert on emergency_reviews;
create policy emr_insert on emergency_reviews for insert to authenticated with check (true);
drop policy if exists emr_update on emergency_reviews;
create policy emr_update on emergency_reviews for update to authenticated using (auth_is_admin());

-- invites: admin-only direct access (public flow uses get/accept RPCs) -------
alter table invites enable row level security;
drop policy if exists inv_admin on invites;
create policy inv_admin on invites for all to authenticated using (auth_is_admin()) with check (auth_is_admin());

-- auth_attempts: writes only via the definer RPCs; admins may read for audit --
alter table auth_attempts enable row level security;
drop policy if exists aa_admin_read on auth_attempts;
create policy aa_admin_read on auth_attempts for select to authenticated using (auth_is_admin());

-- ============================================================
-- 0004_storage.sql
-- ============================================================
-- Pilot Ops — media storage bucket (private; access via signed URLs / RLS)
insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

-- storage.objects already has RLS enabled in Supabase; scope to the bucket.
-- (On Supabase Cloud, if creating these via SQL is blocked by object ownership,
--  add the same bucket-scoped policies from the Storage dashboard instead.)
drop policy if exists "media read"   on storage.objects;
drop policy if exists "media insert" on storage.objects;
drop policy if exists "media update" on storage.objects;
drop policy if exists "media delete" on storage.objects;
create policy "media read"   on storage.objects for select to authenticated using (bucket_id = 'media');
create policy "media insert" on storage.objects for insert to authenticated with check (bucket_id = 'media');
create policy "media update" on storage.objects for update to authenticated using (bucket_id = 'media');
create policy "media delete" on storage.objects for delete to authenticated using (bucket_id = 'media');

-- ============================================================
-- 0005_member_ids.sql
-- ============================================================
-- Pilot Ops — human-readable member IDs + a flag for "pilot code is set".
-- The 6-digit code itself stays hashed and unreadable; admins can see THAT a
-- code exists and reset it (revealed once), but never read the existing one.

create sequence if not exists member_short_seq start 1;

alter table profiles add column if not exists short_id text;
update profiles set short_id = 'PT-' || lpad(nextval('member_short_seq')::text, 4, '0')
  where short_id is null;
alter table profiles alter column short_id set default ('PT-' || lpad(nextval('member_short_seq')::text, 4, '0'));

alter table profiles add column if not exists pilot_code_set boolean not null default false;

-- expose the two new (safe) columns to authenticated clients
grant select (short_id, pilot_code_set) on profiles to authenticated;

-- set_pilot_code also records that a code now exists
create or replace function set_pilot_code(p_profile uuid, p_code text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not (auth_is_admin() or auth.uid() = p_profile) then raise exception 'not authorized'; end if;
  if p_code !~ '^[0-9]{6}$' then raise exception 'code must be 6 digits'; end if;
  update profiles set pilot_code_hash = crypt(p_code, gen_salt('bf')), pilot_code_set = true where id = p_profile;
end; $$;

-- Admin helper: replace a member's roles in one call (delete + insert).
create or replace function set_member_roles(p_profile uuid, p_roles text[])
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not auth_is_admin() then raise exception 'not authorized'; end if;
  delete from member_roles where profile_id = p_profile;
  insert into member_roles(profile_id, role_id)
    select p_profile, r.id from roles r where r.name = any(p_roles)
  on conflict do nothing;
end; $$;
grant execute on function set_member_roles(uuid, text[]) to authenticated;

-- ============================================================
-- 0006_permissions.sql
-- ============================================================
-- Pilot Ops — real per-permission enforcement.
-- A member's effective permissions = the union of their roles' `permissions`
-- arrays (plus everything if they have "*" or are an admin). RLS write policies
-- below are gated on specific permissions, so unchecking a permission on a role
-- actually stops those members from performing the action.

create or replace function auth_has_perm(p text)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false)
      or exists (
        select 1 from member_roles mr join roles r on r.id = mr.role_id
        where mr.profile_id = auth.uid()
          and (r.permissions ? p or r.permissions ? '*')
      );
$$;
grant execute on function auth_has_perm(text) to authenticated;

-- Canonical permission vocabulary on the seeded roles (idempotent).
update roles set permissions = '["flight.create","incident.create","media.upload"]'               where name = 'Pilot';
update roles set permissions = '["incident.create","media.upload"]'                                 where name = 'Co-pilot';
update roles set permissions = '["media.upload","incident.create"]'                                 where name = 'GIS Analyst';
update roles set permissions = '["flight.create","incident.create","report.create","media.upload"]' where name = 'Mission Commander';
update roles set permissions = '["emergency.review","audit.read","incident.create"]'                where name = 'Safety Officer';
update roles set permissions = '[]'                                                                 where name = 'Observer';
update roles set permissions = '["battery.update","fleet.manage"]'                                  where name = 'Maintenance Tech';
update roles set permissions = '["flight.create","incident.create"]'                                where name = 'Dispatcher';
update roles set permissions = '["*"]'                                                              where name = 'Director';
update roles set permissions = '[]'                                                                 where name = 'Stakeholder';

-- ---- Permission-gated write policies (replace the broad ones) --------------
drop policy if exists flights_write on flights;
create policy flights_write on flights for insert to authenticated
  with check (auth_has_perm('flight.create'));

drop policy if exists inc_insert on incidents;
create policy inc_insert on incidents for insert to authenticated
  with check (reporter_id = auth.uid() and auth_has_perm('incident.create'));

drop policy if exists media_insert on media;
create policy media_insert on media for insert to authenticated
  with check (pilot_id = auth.uid() and auth_has_perm('media.upload'));

drop policy if exists bat_update on batteries;
create policy bat_update on batteries for update to authenticated
  using (auth_has_perm('battery.update'));

drop policy if exists rep_write on reports;
create policy rep_write on reports for insert to authenticated
  with check (author_id = auth.uid() and auth_has_perm('report.create'));

drop policy if exists emr_update on emergency_reviews;
create policy emr_update on emergency_reviews for update to authenticated
  using (auth_has_perm('emergency.review'));

drop policy if exists audit_read on audit_log;
create policy audit_read on audit_log for select to authenticated
  using (auth_has_perm('audit.read'));

-- ============================================================
-- 0007_admin_signup.sql
-- ============================================================
-- Pilot Ops — secure admin sign-up (first-run bootstrap).
--
-- SECURITY: the profile-creation trigger must NOT trust client-supplied
-- is_admin/admin_role (a client could otherwise sign up as admin by passing
-- {is_admin:true} metadata). Admin status is granted ONLY by:
--   • claim_first_admin()  — the very first account, when no admin exists yet
--   • set_member_admin()   — an existing admin promoting someone
--   • the service-role bootstrap script (direct DB update)

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.profiles (id, email, full_name, initials, is_admin, admin_role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'initials',
             upper(left(coalesce(new.raw_user_meta_data->>'full_name', 'U'), 1))),
    false,   -- never trust the client for admin status
    null
  )
  on conflict (id) do nothing;
  return new;
end; $$;

-- Anyone may check whether an admin already exists (drives the sign-up UI).
create or replace function admin_exists()
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from profiles where is_admin);
$$;
grant execute on function admin_exists() to anon, authenticated;

-- The first authenticated user may claim admin — only while none exists.
create or replace function claim_first_admin()
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare cnt int;
begin
  perform pg_advisory_xact_lock(990001);          -- serialize the first-admin race
  select count(*) into cnt from profiles where is_admin;
  if cnt = 0 then
    update profiles set is_admin = true, admin_role = 'Ops Director' where id = auth.uid();
    insert into member_roles(profile_id, role_id)
      select auth.uid(), id from roles where name = 'Director'
    on conflict do nothing;
    return true;
  end if;
  return false;
end; $$;
grant execute on function claim_first_admin() to authenticated;

-- ============================================================
-- 0008_multitenancy.sql
-- ============================================================
-- Pilot Ops — multi-tenant (isolated organizations).
--
-- Each org has its own people, fleet, flights, incidents, media, stakeholders,
-- invites, and audit trail. Shared catalogs (roles, sectors, form-field config,
-- coverage areas, purposes) stay global. Isolation is enforced with a single
-- RESTRICTIVE policy per table (AND-ed with the existing permission policies)
-- plus a BEFORE INSERT trigger that stamps org_id automatically — so the
-- existing policies and the frontend inserts don't need rewriting.

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

-- Per-org (isolated) tables.
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','member_roles','stations','aircraft','batteries','maintenance',
    'flights','flight_crew','preflight_checks','incidents','media','reports',
    'logbook_entries','currencies','chat_messages','stakeholders',
    'notification_rules','notifications','invites','audit_log','auth_attempts',
    'emergency_reviews'
  ] loop
    execute format('alter table %I add column if not exists org_id uuid references organizations(id) on delete cascade;', t);
  end loop;
end $$;

-- Default organization + backfill all existing rows into it.
do $$
declare def uuid; t text;
begin
  if not exists (select 1 from organizations) then
    insert into organizations(id, name) values ('00000000-0000-0000-0000-000000000001', 'Default Organization');
  end if;
  select id into def from organizations order by created_at limit 1;
  foreach t in array array[
    'profiles','member_roles','stations','aircraft','batteries','maintenance',
    'flights','flight_crew','preflight_checks','incidents','media','reports',
    'logbook_entries','currencies','chat_messages','stakeholders',
    'notification_rules','notifications','invites','audit_log','auth_attempts',
    'emergency_reviews'
  ] loop
    execute format('update %I set org_id = %L where org_id is null;', t, def);
  end loop;
end $$;

-- Current user's org.
create or replace function auth_org()
returns uuid language sql stable security definer set search_path = public, extensions as $$
  select org_id from profiles where id = auth.uid();
$$;
grant execute on function auth_org() to authenticated;

-- Auto-stamp org_id on insert (so existing inserts/policies need no changes).
create or replace function set_org_id()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.org_id is null then new.org_id := auth_org(); end if;
  return new;
end; $$;

-- Attach the trigger + a restrictive org-isolation policy to every per-org table
-- (profiles handled specially below so users can always read their own row).
do $$
declare t text;
begin
  foreach t in array array[
    'member_roles','stations','aircraft','batteries','maintenance',
    'flights','flight_crew','preflight_checks','incidents','media','reports',
    'logbook_entries','currencies','chat_messages','stakeholders',
    'notification_rules','notifications','invites','audit_log','auth_attempts',
    'emergency_reviews'
  ] loop
    execute format('drop trigger if exists trg_org_id on %I;', t);
    execute format('create trigger trg_org_id before insert on %I for each row execute function set_org_id();', t);
    execute format('drop policy if exists org_isolate on %I;', t);
    execute format('create policy org_isolate on %I as restrictive to authenticated using (org_id = auth_org()) with check (org_id = auth_org());', t);
  end loop;
end $$;

-- profiles: always allow reading/updating your OWN row (org may be null right
-- after sign-up), plus everyone in your org.
drop policy if exists org_isolate on profiles;
create policy org_isolate on profiles as restrictive to authenticated
  using (org_id = auth_org() or id = auth.uid())
  with check (org_id = auth_org() or id = auth.uid());

-- organizations: read your own org.
alter table organizations enable row level security;
drop policy if exists org_read on organizations;
create policy org_read on organizations for select to authenticated using (id = auth_org());

-- New profiles start with no org (assigned by claim/accept below); never admin.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.profiles (id, email, full_name, initials, is_admin, admin_role)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'initials', upper(left(coalesce(new.raw_user_meta_data->>'full_name', 'U'), 1))),
    false, null
  )
  on conflict (id) do nothing;
  return new;
end; $$;

-- Create a NEW organization and make the caller its admin. This replaces the
-- single global first-admin claim — every admin sign-up creates its own org.
create or replace function create_org_and_claim(p_name text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare new_org uuid;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'organization name required'; end if;
  if (select org_id from profiles where id = auth.uid()) is not null then
    raise exception 'you already belong to an organization';
  end if;
  insert into organizations(name) values (trim(p_name)) returning id into new_org;
  update profiles set org_id = new_org, is_admin = true, admin_role = 'Ops Director' where id = auth.uid();
  insert into member_roles(profile_id, role_id, org_id)
    select auth.uid(), id, new_org from roles where name = 'Director'
  on conflict do nothing;
  return new_org;
end; $$;
grant execute on function create_org_and_claim(text) to authenticated;

-- Invite acceptance now also places the member into the inviter's org.
create or replace function accept_invite(p_token text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v invites;
begin
  select * into v from invites where token = p_token;
  if v.id is null then raise exception 'invalid invite'; end if;
  if v.status = 'accepted' then raise exception 'already accepted'; end if;
  if v.status = 'revoked'  then raise exception 'revoked'; end if;
  if v.expires_at < now()  then raise exception 'expired'; end if;

  update invites set status = 'accepted', accepted_at = now() where id = v.id;
  update profiles set org_id = v.org_id where id = auth.uid();
  insert into member_roles(profile_id, role_id, org_id)
    select auth.uid(), r.id, v.org_id from roles r
     where r.name in (select jsonb_array_elements_text(v.roles))
  on conflict do nothing;
end; $$;

-- ============================================================
-- 0009_per_org_config.sql
-- ============================================================
-- Pilot Ops — make config (roles, sectors, form fields, coverage areas,
-- purposes) per-organization so each org owns and edits its own.

-- 1. Add org_id to the config tables.
do $$
declare t text;
begin
  foreach t in array array['roles','sectors','coverage_areas','purposes','form_field_config'] loop
    execute format('alter table %I add column if not exists org_id uuid references organizations(id) on delete cascade;', t);
  end loop;
end $$;

-- 2. Backfill existing (global) config into the Default Organization.
do $$
declare def uuid; t text;
begin
  select id into def from organizations order by created_at limit 1;
  if def is not null then
    foreach t in array array['roles','sectors','coverage_areas','purposes','form_field_config'] loop
      execute format('update %I set org_id = %L where org_id is null;', t, def);
    end loop;
  end if;
end $$;

-- 3. Rework keys so names/slugs are unique PER ORG (not globally).
alter table roles drop constraint if exists roles_name_key;
alter table roles add constraint roles_org_name_key unique (org_id, name);

alter table sectors drop constraint if exists sectors_pkey;
alter table sectors add primary key (org_id, id);

alter table form_field_config drop constraint if exists form_field_config_pkey;
alter table form_field_config add primary key (org_id, key);

-- 4. Per-org default config seeder (idempotent per org).
create or replace function seed_org_config(p_org uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from roles where org_id = p_org) then
    insert into roles (org_id, name, description, permissions) values
      (p_org,'Pilot',            'Flies missions; logs flights and incidents.',          '["flight.create","incident.create","media.upload"]'),
      (p_org,'Co-pilot',         'Assists the pilot in command.',                        '["incident.create","media.upload"]'),
      (p_org,'GIS Analyst',      'Analyses captured imagery and maps (no Pilot Ops login).', '["media.upload","incident.create"]'),
      (p_org,'Mission Commander','Owns a mission; assigns crew.',                        '["flight.create","incident.create","report.create","media.upload"]'),
      (p_org,'Safety Officer',   'Reviews emergencies and compliance.',                  '["emergency.review","audit.read","incident.create"]'),
      (p_org,'Observer',         'Read-only situational awareness.',                     '[]'),
      (p_org,'Maintenance Tech', 'Maintains aircraft and batteries.',                    '["battery.update","fleet.manage"]'),
      (p_org,'Dispatcher',       'Coordinates flights and notifications.',               '["flight.create","incident.create"]'),
      (p_org,'Director',         'Full administrative control.',                         '["*"]'),
      (p_org,'Stakeholder',      'External recipient of notifications only.',            '[]');
  end if;
  if not exists (select 1 from sectors where org_id = p_org) then
    insert into sectors (org_id, id, label, units, incident_types, sample_places, active) values
      (p_org,'generic','Multi-sector','{"area":"km²","asset":"asset"}','["Anomaly","Breach","Wildlife","Equipment","Personnel"]','[]', true),
      (p_org,'pipeline','Pipeline monitoring','{"area":"km","asset":"valve"}','["Leak","Encroachment","Corrosion","Vandalism","Vegetation"]','[]', false),
      (p_org,'utility','Power line inspection','{"area":"km","asset":"tower"}','["Hot spot","Tree fall","Insulator damage","Conductor sag","Tower lean"]','[]', false),
      (p_org,'agriculture','Precision agriculture','{"area":"ha","asset":"field"}','["Pest","Disease","Drought stress","Nutrient deficiency","Lodging"]','[]', false);
  end if;
  if not exists (select 1 from form_field_config where org_id = p_org) then
    insert into form_field_config (org_id, key, type, options) values
      (p_org,'coverageArea','text','[]'),
      (p_org,'purpose','dropdown','["Routine inspection","Incident follow-up","Scheduled survey","Emergency response","Training"]'),
      (p_org,'flightStation','dropdown','[]'),
      (p_org,'uav','dropdown','[]');
  end if;
  if not exists (select 1 from purposes where org_id = p_org) then
    insert into purposes (org_id, name, sort) values
      (p_org,'Routine inspection',1),(p_org,'Incident follow-up',2),(p_org,'Scheduled survey',3),
      (p_org,'Emergency response',4),(p_org,'Training',5);
  end if;
end; $$;
grant execute on function seed_org_config(uuid) to authenticated;

-- 5. Seed config for any org that doesn't have it yet (e.g. orgs created before
--    config became per-org), then re-point member_roles to same-org roles.
do $$
declare o uuid;
begin
  for o in select id from organizations loop
    perform seed_org_config(o);
  end loop;
end $$;

update member_roles mr
set role_id = (
  select r2.id from roles r2 join profiles p on p.id = mr.profile_id
  where r2.org_id = p.org_id and r2.name = (select name from roles where id = mr.role_id) limit 1
)
where exists (
  select 1 from roles r join profiles p on p.id = mr.profile_id
  where r.id = mr.role_id and r.org_id is distinct from p.org_id
);

-- 6. Org-isolation: auto-stamp org_id + restrictive policy on the config tables.
do $$
declare t text;
begin
  foreach t in array array['roles','sectors','coverage_areas','purposes','form_field_config'] loop
    execute format('drop trigger if exists trg_org_id on %I;', t);
    execute format('create trigger trg_org_id before insert on %I for each row execute function set_org_id();', t);
    execute format('drop policy if exists org_isolate on %I;', t);
    execute format('create policy org_isolate on %I as restrictive to authenticated using (org_id = auth_org()) with check (org_id = auth_org());', t);
  end loop;
end $$;

-- 7. New orgs seed their own config; invites assign roles within the org.
create or replace function create_org_and_claim(p_name text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare new_org uuid;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'organization name required'; end if;
  if (select org_id from profiles where id = auth.uid()) is not null then
    raise exception 'you already belong to an organization';
  end if;
  insert into organizations(name) values (trim(p_name)) returning id into new_org;
  update profiles set org_id = new_org, is_admin = true, admin_role = 'Ops Director' where id = auth.uid();
  perform seed_org_config(new_org);
  insert into member_roles(profile_id, role_id, org_id)
    select auth.uid(), id, new_org from roles where name = 'Director' and org_id = new_org
  on conflict do nothing;
  return new_org;
end; $$;

create or replace function accept_invite(p_token text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v invites;
begin
  select * into v from invites where token = p_token;
  if v.id is null then raise exception 'invalid invite'; end if;
  if v.status = 'accepted' then raise exception 'already accepted'; end if;
  if v.status = 'revoked'  then raise exception 'revoked'; end if;
  if v.expires_at < now()  then raise exception 'expired'; end if;

  update invites set status = 'accepted', accepted_at = now() where id = v.id;
  update profiles set org_id = v.org_id where id = auth.uid();
  insert into member_roles(profile_id, role_id, org_id)
    select auth.uid(), r.id, v.org_id from roles r
     where r.org_id = v.org_id and r.name in (select jsonb_array_elements_text(v.roles))
  on conflict do nothing;
end; $$;

-- 8. Let any member read their org's notifications (drives the bell). Org
--    isolation is still enforced by the restrictive org_isolate policy.
drop policy if exists notif_read on notifications;
create policy notif_read on notifications for select to authenticated using (true);

-- ============================================================
-- 0010_kyc.sql
-- ============================================================
-- Pilot Ops — member KYC at registration + admin verification.
-- Two-tier: operating crew (Pilot/Co-pilot) provide phone + license + DOB/gov-ID;
-- other members provide phone + job title only. New members start 'pending' and
-- an admin must verify them before they can start missions.

alter table profiles
  add column if not exists phone           text,
  add column if not exists dob             date,
  add column if not exists gov_id          text,
  add column if not exists license_class   text,
  add column if not exists license_expiry  date,
  add column if not exists job_title       text,
  add column if not exists kyc_status      text not null default 'pending',
  add column if not exists kyc_submitted_at timestamptz;

-- Grandfather pre-KYC members (don't lock out current members/admins). Guarded
-- so re-running this migration never re-verifies someone who has since submitted
-- KYC and is awaiting review: those rows have kyc_submitted_at set.
update profiles set kyc_status = 'verified'
 where kyc_status = 'pending' and kyc_submitted_at is null;

-- A member may write their own KYC *data*, but NOT their verification status.
-- authenticated has column-level UPDATE on profiles, so kyc_status is simply
-- never granted — it can only be changed by the admin definer RPC below.
grant select (phone, dob, gov_id, license_class, license_expiry, job_title, kyc_status, kyc_submitted_at) on profiles to authenticated;
grant update (phone, dob, gov_id, license_class, license_expiry, job_title) on profiles to authenticated;

-- Admin-only verification (scoped to the admin's org).
create or replace function set_kyc_status(p_profile uuid, p_status text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not auth_is_admin() then raise exception 'admin only'; end if;
  if p_status not in ('pending','verified','rejected') then raise exception 'invalid status'; end if;
  update profiles set kyc_status = p_status where id = p_profile and org_id = auth_org();
end; $$;
grant execute on function set_kyc_status(uuid, text) to authenticated;

-- A founding admin (self-service org creation) is auto-verified.
create or replace function create_org_and_claim(p_name text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare new_org uuid;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'organization name required'; end if;
  if (select org_id from profiles where id = auth.uid()) is not null then
    raise exception 'you already belong to an organization';
  end if;
  insert into organizations(name) values (trim(p_name)) returning id into new_org;
  update profiles set org_id = new_org, is_admin = true, admin_role = 'Ops Director', kyc_status = 'verified' where id = auth.uid();
  perform seed_org_config(new_org);
  insert into member_roles(profile_id, role_id, org_id)
    select auth.uid(), id, new_org from roles where name = 'Director' and org_id = new_org
  on conflict do nothing;
  return new_org;
end; $$;

-- Mission-start gate: the pilot-in-command must be KYC-verified. This is the
-- server-side choke point (called when a mission is started); an unverified
-- pilot is blocked here without consuming a code attempt.
create or replace function verify_pilot_code(p_pilot uuid, p_code text, p_context text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_hash text;
  v_recent int;
  v_ok boolean;
  v_max int := 3;
  v_window interval := interval '15 minutes';
  v_last_fail timestamptz;
  v_kyc text;
begin
  select kyc_status into v_kyc from profiles where id = p_pilot;
  if v_kyc is distinct from 'verified' then
    return jsonb_build_object('ok', false, 'kyc', false,
      'reason', 'Your account is pending KYC verification by an admin — you can''t start missions yet.');
  end if;

  select count(*) into v_recent from auth_attempts
    where profile_id = p_pilot and ok = false and ts > now() - v_window;

  if v_recent >= v_max then
    select max(ts) into v_last_fail from auth_attempts
      where profile_id = p_pilot and ok = false and ts > now() - v_window;
    return jsonb_build_object('ok', false, 'locked', true,
      'locked_until', (v_last_fail + v_window), 'attempts_remaining', 0);
  end if;

  select pilot_code_hash into v_hash from profiles where id = p_pilot;
  v_ok := v_hash is not null and v_hash = crypt(p_code, v_hash);
  insert into auth_attempts(profile_id, ok, context) values (p_pilot, v_ok, p_context);

  if v_ok then
    return jsonb_build_object('ok', true, 'attempts_remaining', v_max);
  end if;
  return jsonb_build_object('ok', false, 'locked', (v_recent + 1) >= v_max,
    'attempts_remaining', greatest(0, v_max - (v_recent + 1)));
end; $$;

-- ============================================================
-- 0011_streaming.sql
-- ============================================================
-- Pilot Ops — live video streaming (GGIS UAV Companion).
-- A flight's live cast is addressed by its uuid (the MediaMTX path). These
-- columns let Pilot Ops know when a controller feed is live; the stream-gateway
-- (MediaMTX external-auth + record hooks) flips them server-side.

alter table flights
  add column if not exists stream_status     text not null default 'offline',  -- offline | live
  add column if not exists stream_started_at  timestamptz;

-- flights is already in the supabase_realtime publication (0001), so the
-- stream_status flip reaches subscribed Pilot Ops clients with no extra wiring.

-- The stream-gateway connects as service_role (server-side, bypasses RLS) to
-- validate publish/read auth and attach recordings. Grant exactly what it needs.
grant select, update on flights     to service_role;
grant select          on profiles   to service_role;
grant select          on flight_crew to service_role;
grant select, insert  on media      to service_role;

-- ============================================================
-- 0012_pairing.sql
-- ============================================================
-- Pilot Ops — controller pairing. When a mission starts, Pilot Ops shows a short
-- code; the pilot (or a co-pilot / shared controller) enters it in the GGIS UAV
-- Companion app to bind that controller to the flight before casting.

alter table flights add column if not exists pair_code text;
create index if not exists idx_flights_pair_code on flights(pair_code) where pair_code is not null;

-- Called by Pilot Ops right after a mission starts: mint (or reuse) a 6-digit
-- code unique among currently-live flights, and return it to display.
create or replace function start_pairing(p_flight uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_org uuid; v_pilot uuid; v_code text; v_admin boolean;
begin
  select org_id, pilot_id, pair_code into v_org, v_pilot, v_code from flights where id = p_flight;
  if v_org is null then raise exception 'unknown flight'; end if;
  if v_org <> auth_org() then raise exception 'forbidden'; end if;

  select is_admin into v_admin from profiles where id = auth.uid();
  if not ((v_pilot = auth.uid())
          or exists (select 1 from flight_crew where flight_id = p_flight and profile_id = auth.uid())
          or coalesce(v_admin, false)) then
    raise exception 'forbidden';
  end if;

  if v_code is not null then return v_code; end if;
  loop
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (select 1 from flights where pair_code = v_code and status = 'live');
  end loop;
  update flights set pair_code = v_code where id = p_flight;
  return v_code;
end; $$;
grant execute on function start_pairing(uuid) to authenticated;

-- Called by the companion app: exchange a code for the flight, and bind the
-- caller as a 'caster' on the flight so the stream-gateway authorises their
-- publish (its crew check then passes — no gateway change needed).
create or replace function resolve_pair_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_flight uuid; v_label text;
begin
  select id, coalesce(code, area, id::text) into v_flight, v_label
    from flights
   where pair_code = p_code and status = 'live' and org_id = auth_org()
   limit 1;
  if v_flight is null then return jsonb_build_object('ok', false); end if;

  insert into flight_crew(flight_id, profile_id, role)
    values (v_flight, auth.uid(), 'caster')
  on conflict do nothing;

  return jsonb_build_object('ok', true, 'flight_id', v_flight, 'label', v_label);
end; $$;
grant execute on function resolve_pair_code(text) to authenticated;

-- ============================================================
-- 0023_crew_exclusivity.sql
-- ============================================================
-- Stop the same person being committed to two LIVE missions at once (race-proof
-- backstop for the UI's busy-crew hiding). A "commitment" = being the pilot_id of
-- a live flight, or a flight_crew row on one. Emergency flights bypass.

create or replace function profile_on_live_flight(p_profile uuid, p_exclude_flight uuid)
returns uuid
language sql
stable
as $$
  select f.id
    from flights f
   where f.status = 'live'
     and f.id is distinct from p_exclude_flight
     and (
       f.pilot_id = p_profile
       or exists (select 1 from flight_crew c where c.flight_id = f.id and c.profile_id = p_profile)
     )
   limit 1;
$$;

create or replace function check_crew_not_double_booked()
returns trigger
language plpgsql
as $$
declare v_busy uuid;
begin
  if exists (select 1 from flights where id = new.flight_id and status = 'live' and coalesce(emergency, false) = false) then
    v_busy := profile_on_live_flight(new.profile_id, new.flight_id);
    if v_busy is not null then
      raise exception 'CREW_BUSY: % is already committed to live flight %', new.profile_id, v_busy;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_crew_double_book on flight_crew;
create trigger trg_crew_double_book
  before insert on flight_crew
  for each row execute function check_crew_not_double_booked();

create or replace function check_pilot_not_double_booked()
returns trigger
language plpgsql
as $$
declare v_busy uuid;
begin
  if new.status = 'live' and new.pilot_id is not null
     and coalesce(new.emergency, false) = false
     and (tg_op = 'INSERT' or old.status is distinct from 'live') then
    v_busy := profile_on_live_flight(new.pilot_id, new.id);
    if v_busy is not null then
      raise exception 'PILOT_BUSY: pilot % is already committed to live flight %', new.pilot_id, v_busy;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pilot_double_book on flights;
create trigger trg_pilot_double_book
  before insert or update on flights
  for each row execute function check_pilot_not_double_booked();

-- ============================================================
-- 0024_pilot_lockout.sql
-- ============================================================
-- Notify admins when a pilot locks themselves out (3 wrong launch codes in
-- 15 min) and let an admin override the lockout.
create or replace function verify_pilot_code(p_pilot uuid, p_code text, p_context text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_hash text; v_recent int; v_ok boolean; v_max int := 3;
  v_window interval := interval '15 minutes'; v_last_fail timestamptz; v_kyc text; v_name text;
begin
  select kyc_status, full_name into v_kyc, v_name from profiles where id = p_pilot;
  if v_kyc is distinct from 'verified' then
    return jsonb_build_object('ok', false, 'kyc', false,
      'reason', 'Your account is pending KYC verification by an admin — you can''t start missions yet.');
  end if;
  select count(*) into v_recent from auth_attempts
    where profile_id = p_pilot and ok = false and ts > now() - v_window;
  if v_recent >= v_max then
    select max(ts) into v_last_fail from auth_attempts
      where profile_id = p_pilot and ok = false and ts > now() - v_window;
    return jsonb_build_object('ok', false, 'locked', true,
      'locked_until', (v_last_fail + v_window), 'attempts_remaining', 0);
  end if;
  select pilot_code_hash into v_hash from profiles where id = p_pilot;
  v_ok := v_hash is not null and v_hash = crypt(p_code, v_hash);
  insert into auth_attempts(profile_id, ok, context) values (p_pilot, v_ok, p_context);
  if v_ok then return jsonb_build_object('ok', true, 'attempts_remaining', v_max); end if;
  if (v_recent + 1) >= v_max then
    insert into notifications(type, payload)
      values ('lockout', jsonb_build_object(
        'pilot_id', p_pilot, 'pilot', coalesce(v_name, 'A pilot'), 'context', p_context));
  end if;
  return jsonb_build_object('ok', false, 'locked', (v_recent + 1) >= v_max,
    'attempts_remaining', greatest(0, v_max - (v_recent + 1)));
end; $$;

create or replace function admin_pilot_lockouts()
returns table(profile_id uuid, full_name text, fails int, last_fail timestamptz, locked_until timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not auth_is_admin() then raise exception 'admin only'; end if;
  return query
    select a.profile_id, p.full_name, count(*)::int as fails,
           max(a.ts) as last_fail, (max(a.ts) + interval '15 minutes') as locked_until
      from auth_attempts a join profiles p on p.id = a.profile_id
     where a.ok = false and a.ts > now() - interval '15 minutes' and p.org_id = auth_org()
     group by a.profile_id, p.full_name having count(*) >= 3;
end; $$;
grant execute on function admin_pilot_lockouts() to authenticated;

create or replace function admin_clear_pilot_lockout(p_pilot uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not auth_is_admin() then raise exception 'admin only'; end if;
  if not exists (select 1 from profiles where id = p_pilot and org_id = auth_org()) then
    raise exception 'not in your organization';
  end if;
  delete from auth_attempts where profile_id = p_pilot and ok = false and ts > now() - interval '15 minutes';
  insert into audit_log(actor_id, actor_name, kind, context, detail)
    values (auth.uid(), (select full_name from profiles where id = auth.uid()),
            'lockout_override', p_pilot::text,
            jsonb_build_object('pilot', (select full_name from profiles where id = p_pilot)));
end; $$;
grant execute on function admin_clear_pilot_lockout(uuid) to authenticated;

-- ============================================================
-- seed.sql
-- ============================================================
-- Pilot Ops — seed CONFIG defaults only (no dummy people, flights, or fleet).
-- Config (roles, sectors, form fields, purposes) is per-organization; this seeds
-- it for the Default Organization. New orgs seed their own via create_org_and_claim.
-- Operational data is created by real users through the app.

select seed_org_config(id) from organizations order by created_at limit 1;
