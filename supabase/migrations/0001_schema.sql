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
