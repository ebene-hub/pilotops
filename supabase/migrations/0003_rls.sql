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
