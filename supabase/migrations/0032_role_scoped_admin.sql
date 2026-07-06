-- Role-scoped admin access: let specific non-admin roles reach the admin pages
-- their permission grants (Maintenance Tech → Aircraft registry, Safety Officer →
-- Emergency reviews / Incident log / Audit log). The nav + login gate are handled
-- client-side; this migration closes the one server-side (RLS) gap.
--
-- Everything else the scoped roles need is already gated correctly:
--   • aircraft SELECT       → aircraft_read (using true)                  [0003]
--   • emergency_reviews READ → emr_read (using true)                       [0003]
--   • emergency_reviews WRITE→ emr_update (auth_has_perm('emergency.review'))[0006]
--   • incidents READ         → inc_read (using true)                       [0003]
--   • audit_log READ         → audit_read (auth_has_perm('audit.read'))    [0006]
--
-- The only missing piece: aircraft WRITE was admin-only (aircraft_admin, gated on
-- auth_is_admin). Add a permissive policy so fleet.manage holders can manage the
-- registry too. Permissive policies OR together, so admins still pass; the
-- org-isolation restrictive policy (0008) still applies on top.
drop policy if exists aircraft_fleet_manage on aircraft;
create policy aircraft_fleet_manage on aircraft
  for all to authenticated
  using (auth_has_perm('fleet.manage'))
  with check (auth_has_perm('fleet.manage'));
