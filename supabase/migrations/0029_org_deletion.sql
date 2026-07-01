-- 0029_org_deletion.sql
-- Self-service organization deletion with a 48-hour grace period. An admin can
-- request deletion (schedules delete_after = now + 48h) and cancel any time
-- before then. The stream-gateway sweeps expired orgs and deletes them for good
-- (data cascades via org_id FKs; member auth accounts + storage cleaned by the
-- sweeper). During the window the org keeps working and shows a warning banner.

alter table organizations
  add column if not exists deletion_requested_at timestamptz,
  add column if not exists delete_after           timestamptz,
  add column if not exists deletion_requested_by   uuid;

-- Admin requests deletion → schedules it 48h out. Returns the delete_after time.
create or replace function request_org_deletion()
returns timestamptz language plpgsql security definer set search_path = public, extensions as $$
declare v_after timestamptz := now() + interval '48 hours';
begin
  if not auth_is_admin() then raise exception 'admin only'; end if;
  update organizations
     set deletion_requested_at = now(), delete_after = v_after, deletion_requested_by = auth.uid()
   where id = auth_org();
  insert into audit_log(actor_id, actor_name, kind, context, detail)
    values (auth.uid(), (select full_name from profiles where id = auth.uid()),
            'org_deletion_requested', auth_org()::text, jsonb_build_object('delete_after', v_after));
  return v_after;
end; $$;
grant execute on function request_org_deletion() to authenticated;

-- Admin cancels a pending deletion.
create or replace function cancel_org_deletion()
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not auth_is_admin() then raise exception 'admin only'; end if;
  update organizations
     set deletion_requested_at = null, delete_after = null, deletion_requested_by = null
   where id = auth_org();
  insert into audit_log(actor_id, actor_name, kind, context, detail)
    values (auth.uid(), (select full_name from profiles where id = auth.uid()),
            'org_deletion_cancelled', auth_org()::text, '{}'::jsonb);
end; $$;
grant execute on function cancel_org_deletion() to authenticated;

-- Any member can read whether their org is scheduled (drives the warning banner).
create or replace function org_deletion_status()
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare r organizations;
begin
  select * into r from organizations where id = auth_org();
  if not found then return jsonb_build_object('scheduled', false); end if;
  return jsonb_build_object('scheduled', r.delete_after is not null,
    'delete_after', r.delete_after, 'requested_at', r.deletion_requested_at, 'name', r.name);
end; $$;
grant execute on function org_deletion_status() to authenticated;
