-- 0028_email_live_url.sql
-- A per-org public live-stream link (e.g. the GGIS dashboard page that embeds the
-- watch page). The mission-start email renders a "Watch live" button from it.
-- Configurable in the admin console so it can be changed per organization without
-- a code change.

alter table org_email_settings add column if not exists live_url text;

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
    'smtp_username', r.smtp_username, 'smtp_allow_invalid_cert', r.smtp_allow_invalid_cert,
    'live_url', r.live_url, 'active', r.active,
    'has_smtp_password', r.smtp_password is not null and r.smtp_password <> '',
    'has_resend_key', r.resend_api_key is not null and r.resend_api_key <> '');
end; $$;
grant execute on function get_org_email_settings() to authenticated;

create or replace function set_org_email_settings(p jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_org uuid := auth_org();
begin
  if not auth_is_admin() then raise exception 'admin only'; end if;
  insert into org_email_settings(
      org_id, provider, from_name, from_email, smtp_host, smtp_port, smtp_secure,
      smtp_username, smtp_password, resend_api_key, smtp_allow_invalid_cert, live_url, active, updated_at)
  values (
      v_org, coalesce(p->>'provider','smtp'), p->>'from_name', p->>'from_email',
      p->>'smtp_host', nullif(p->>'smtp_port','')::int, coalesce((p->>'smtp_secure')::boolean, true),
      p->>'smtp_username', nullif(p->>'smtp_password',''), nullif(p->>'resend_api_key',''),
      coalesce((p->>'smtp_allow_invalid_cert')::boolean, false), nullif(p->>'live_url',''),
      coalesce((p->>'active')::boolean, false), now())
  on conflict (org_id) do update set
      provider      = coalesce(p->>'provider', org_email_settings.provider),
      from_name     = p->>'from_name', from_email = p->>'from_email',
      smtp_host     = p->>'smtp_host', smtp_port = nullif(p->>'smtp_port','')::int,
      smtp_secure   = coalesce((p->>'smtp_secure')::boolean, true), smtp_username = p->>'smtp_username',
      smtp_password = coalesce(nullif(p->>'smtp_password',''), org_email_settings.smtp_password),
      resend_api_key = coalesce(nullif(p->>'resend_api_key',''), org_email_settings.resend_api_key),
      smtp_allow_invalid_cert = coalesce((p->>'smtp_allow_invalid_cert')::boolean, false),
      live_url      = nullif(p->>'live_url',''),
      active        = coalesce((p->>'active')::boolean, false), updated_at = now();
end; $$;
grant execute on function set_org_email_settings(jsonb) to authenticated;
