// One-time bootstrap: create the first admin account. This is the only way in
// before invites exist. Run once after the stack is up:
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//   BOOTSTRAP_ADMIN_EMAIL=... BOOTSTRAP_ADMIN_PASSWORD=... \
//   node scripts/bootstrap-admin.mjs
//
// (these are read from the environment / .env by docker compose run)
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
const name = process.env.BOOTSTRAP_ADMIN_NAME || "Operations Director";

if (!url || !key || !email || !password) {
  console.error("Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

const { data, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: name, initials, is_admin: true, admin_role: "Ops Director" },
});

if (error) {
  if (/registered|already|exists/i.test(error.message)) {
    console.log("Admin already exists — nothing to do.");
    process.exit(0);
  }
  console.error("Failed to create admin:", error.message);
  process.exit(1);
}

// Create the org, grant admin (the trigger no longer trusts client metadata),
// and assign the Director role. Service role bypasses RLS.
const userId = data.user.id;
const orgName = process.env.BOOTSTRAP_ORG_NAME || "My Organization";
const { data: org } = await admin.from("organizations").insert({ name: orgName }).select().single();
const orgId = org?.id;
await admin.from("profiles").update({ is_admin: true, admin_role: "Ops Director", org_id: orgId }).eq("id", userId);
const { data: role } = await admin.from("roles").select("id").eq("name", "Director").single();
if (role) {
  await admin.from("member_roles").upsert({ profile_id: userId, role_id: role.id, org_id: orgId });
}

console.log("✓ Created admin:", email, "· org:", orgName);
console.log("  Sign in at /admin-login.html — you'll be prompted to set up 2FA (TOTP) on first sign-in.");
