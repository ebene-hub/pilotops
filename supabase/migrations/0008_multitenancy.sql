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
