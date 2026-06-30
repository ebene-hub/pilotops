-- 0025_notifications_realtime.sql
-- Real-time in-app notification delivery: add `notifications` to the realtime
-- publication so the console/app bell updates live (no refresh). RLS still scopes
-- each authenticated subscriber to their own org's rows. Idempotent.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table notifications;
  end if;
end $$;
