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
