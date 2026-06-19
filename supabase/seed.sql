-- Pilot Ops — seed CONFIG defaults only (no dummy people, flights, or fleet).
-- Config (roles, sectors, form fields, purposes) is per-organization; this seeds
-- it for the Default Organization. New orgs seed their own via create_org_and_claim.
-- Operational data is created by real users through the app.

select seed_org_config(id) from organizations order by created_at limit 1;
