-- 0018_relax_create.sql
-- Let any signed-in org member log an incident and create a report draft for
-- themselves. Creation was gated behind incident.create / report.create, which
-- only a couple of roles had — so most accounts got "could not create" / could
-- not log. Org isolation still applies via the restrictive org_isolate policy,
-- and reporter_id/author_id must be the caller (no impersonation).

drop policy if exists inc_insert on incidents;
create policy inc_insert on incidents for insert to authenticated
  with check (reporter_id = auth.uid());

drop policy if exists rep_write on reports;
create policy rep_write on reports for insert to authenticated
  with check (author_id = auth.uid());
