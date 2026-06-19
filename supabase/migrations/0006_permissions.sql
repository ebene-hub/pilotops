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
