-- 0030_profiles_grant.sql
-- Restore the table-level SELECT grant on `profiles` for the app roles.
--
-- profiles is the only table with column-level grants (0010 added them for the
-- KYC fields). If the project's default role privileges get reset — which can
-- happen during the API-key migration / disabling legacy keys — the broad table
-- grant is lost while the column grants remain. The result: `authenticated` can
-- only read the KYC columns, so reading is_admin/org_id fails with
-- "permission denied for table profiles", and admin login reports "not an admin
-- account". Re-granting table SELECT fixes it (RLS still controls row access).

grant select on public.profiles to authenticated, anon;

-- Keep the KYC self-service column update grant intact (idempotent — matches 0010).
grant update (phone, dob, gov_id, license_class, license_expiry, job_title) on public.profiles to authenticated;
