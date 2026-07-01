-- 0026_org_email_settings.sql
-- Per-organization email delivery config. Each org can point Pilot Ops at its own
-- SMTP server (or its own Resend key). Secrets (SMTP password / API key) are
-- write-only: the admin console can set them and see WHETHER they're set, but can
-- never read them back. Only the stream-gateway (service_role) reads them to send;
-- if an org has no active config, the gateway falls back to the server's global
-- .env settings.

create table if not exists org_email_settings (
  org_id        uuid primary key references organizations(id) on delete cascade,
  provider      text not null default 'smtp',   -- 'smtp' | 'resend'
  from_name     text,
  from_email    text,
  smtp_host     text,
  smtp_port     int,
  smtp_secure   boolean default true,           -- true = TLS/465, false = STARTTLS/587
  smtp_username text,
  smtp_password text,                            -- SECRET — never returned to the client
  resend_api_key text,                           -- SECRET
  active        boolean not null default false,
  updated_at    timestamptz default now()
);

-- RLS on, and NO grants to authenticated → the client can't read the table at all
-- (protects the secrets). All client access goes through the definer RPCs below;
-- the gateway uses the service_role key, which bypasses RLS.
alter table org_email_settings enable row level security;

-- Admin reads the NON-secret config + booleans telling whether secrets are set.
create or replace function get_org_email_settings()
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare r org_email_settings;
begin
  if not auth_is_admin() then raise exception 'admin only'; end if;
  select * into r from org_email_settings where org_id = auth_org();
  if not found then return jsonb_build_object('exists', false); end if;
  return jsonb_build_object(
    'exists', true, 'provider', r.provider, 'from_name', r.from_name, 'from_email', r.from_email,
    'smtp_host', r.smtp_host, 'smtp_port', r.smtp_port, 'smtp_secure', r.smtp_secure,
    'smtp_username', r.smtp_username, 'active', r.active,
    'has_smtp_password', r.smtp_password is not null and r.smtp_password <> '',
    'has_resend_key', r.resend_api_key is not null and r.resend_api_key <> '');
end; $$;
grant execute on function get_org_email_settings() to authenticated;

-- Admin writes the config. Secret fields left blank/absent keep their prior value
-- (so an admin editing other fields need not re-enter the password every time).
create or replace function set_org_email_settings(p jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_org uuid := auth_org();
begin
  if not auth_is_admin() then raise exception 'admin only'; end if;
  insert into org_email_settings(
      org_id, provider, from_name, from_email, smtp_host, smtp_port, smtp_secure,
      smtp_username, smtp_password, resend_api_key, active, updated_at)
  values (
      v_org, coalesce(p->>'provider','smtp'), p->>'from_name', p->>'from_email',
      p->>'smtp_host', nullif(p->>'smtp_port','')::int, coalesce((p->>'smtp_secure')::boolean, true),
      p->>'smtp_username', nullif(p->>'smtp_password',''), nullif(p->>'resend_api_key',''),
      coalesce((p->>'active')::boolean, false), now())
  on conflict (org_id) do update set
      provider      = coalesce(p->>'provider', org_email_settings.provider),
      from_name     = p->>'from_name',
      from_email    = p->>'from_email',
      smtp_host     = p->>'smtp_host',
      smtp_port     = nullif(p->>'smtp_port','')::int,
      smtp_secure   = coalesce((p->>'smtp_secure')::boolean, true),
      smtp_username = p->>'smtp_username',
      smtp_password = coalesce(nullif(p->>'smtp_password',''), org_email_settings.smtp_password),
      resend_api_key = coalesce(nullif(p->>'resend_api_key',''), org_email_settings.resend_api_key),
      active        = coalesce((p->>'active')::boolean, false),
      updated_at    = now();
end; $$;
grant execute on function set_org_email_settings(jsonb) to authenticated;
