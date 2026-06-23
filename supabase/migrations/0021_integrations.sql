-- 0021_integrations.sql
-- Real outgoing integrations: register Slack / Microsoft Teams incoming-webhook
-- URLs (or a generic webhook) per org; Pilot Ops POSTs to them when an incident
-- is logged. Uses pg_net for fire-and-forget HTTP from the database.

create extension if not exists pg_net;

create table if not exists integrations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  kind text not null,                 -- slack | teams | webhook
  label text,
  url text not null,
  active boolean default true,
  created_at timestamptz default now()
);

alter table integrations enable row level security;

-- org_id auto-stamped on insert (reuse the multitenancy trigger fn).
drop trigger if exists trg_org_id on integrations;
create trigger trg_org_id before insert on integrations for each row execute function set_org_id();

drop policy if exists integ_read on integrations;
create policy integ_read   on integrations for select to authenticated using (org_id = auth_org());
drop policy if exists integ_write on integrations;
create policy integ_write  on integrations for insert to authenticated with check (org_id = auth_org() and auth_is_admin());
drop policy if exists integ_update on integrations;
create policy integ_update on integrations for update to authenticated using (org_id = auth_org() and auth_is_admin());
drop policy if exists integ_del on integrations;
create policy integ_del    on integrations for delete to authenticated using (org_id = auth_org() and auth_is_admin());

-- When an incident is logged, POST to each active webhook for that org.
create or replace function notify_integrations()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare r record; msg text;
begin
  msg := format('Incident %s [%s] — %s%s',
    coalesce(new.code, left(new.id::text, 8)),
    upper(coalesce(new.severity, 'n/a')),
    coalesce(new.description, new.type, 'incident'),
    case when new.place is not null then ' @ ' || new.place else '' end);
  for r in select kind, url from integrations where org_id = new.org_id and active loop
    begin
      if r.kind = 'webhook' then
        perform net.http_post(r.url, to_jsonb(new));
      else  -- slack / teams incoming webhooks both accept { "text": ... }
        perform net.http_post(r.url, jsonb_build_object('text', msg));
      end if;
    exception when others then null;  -- a webhook failure must never block the insert
    end;
  end loop;
  return new;
end; $$;

drop trigger if exists trg_notify_integrations on incidents;
create trigger trg_notify_integrations after insert on incidents
  for each row execute function notify_integrations();
