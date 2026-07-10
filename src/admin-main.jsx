import React from "react";
import { createRoot } from "react-dom/client";

import { supabase, currentProfile } from "./api/supabase.js";
import { bootstrap } from "./store.jsx";

import "./styles.css";

// Module load order MUST match the original "Admin.html" <script> order.
// fleet.jsx is loaded before admin-aircraft (seeds AIRCRAFT/BATTERIES), and
// admin.jsx provides TeamRosterTab + FormFieldsTab used by the admin shell.
import "./tweaks-panel.jsx";
import "./data.js";
import "./shared.jsx";

import "./views/fleet.jsx";
import "./views/admin.jsx";
import "./views/admin-aircraft.jsx";
import "./views/admin-pilot-dashboard.jsx";
import "./views/admin-emergency-reviews.jsx";
import "./views/admin-incidents.jsx";
import "./views/admin-lockouts.jsx";
import "./views/admin-email-settings.jsx";
import "./views/admin-danger.jsx";
import "./views/invites-store.jsx";
import "./views/members-invites.jsx";

import "./admin-app.jsx";

// ---------------------------------------------------------------------------
// Real auth gate — admin only. Require a Supabase session whose profile has
// is_admin; otherwise bounce to the admin login. Then bootstrap and mount.
// ---------------------------------------------------------------------------
function splash(msg) {
  const root = document.getElementById("root");
  if (root) root.innerHTML =
    `<div style="height:100vh;display:grid;place-items:center;font-family:var(--font-sans);color:var(--text-3)">
       <div style="text-align:center">
         <div style="width:34px;height:34px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite;margin:0 auto 14px"></div>
         ${msg || "Loading…"}
       </div>
     </div><style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;
}

// Permissions that unlock at least one admin page (mirror of ADMIN_SURFACED_PERMS
// in admin-app.jsx). A non-admin holding any of these may use the console, but
// the nav is filtered to only the pages they're entitled to.
const ADMIN_SURFACED_PERMS = ["fleet.manage", "emergency.review", "audit.read"];

async function start() {
  splash("Verifying admin access…");
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.replace("/admin-login.html"); return; }

  const profile = await currentProfile();
  if (!profile) { window.location.replace("/admin-login.html"); return; }

  // License gate: a suspended/expired org can't use the console. Sign out + show
  // a message rather than bouncing to login (an existing session would loop).
  // org_read RLS returns only the caller's own org row.
  {
    const { data: org } = await supabase.from("organizations").select("license_status, license_expires_at").maybeSingle();
    const expired = org?.license_expires_at && new Date(org.license_expires_at) < new Date(new Date().toDateString());
    if (org && (org.license_status !== "active" || expired)) {
      await supabase.auth.signOut();
      splash("Your organization's access is suspended or expired. Contact your provider to restore it.");
      return;
    }
  }

  // Effective console permissions: full admins get everything; other roles get
  // the union of their roles' permissions, so the nav shows only their pages.
  let permSet = new Set(["*"]);
  let roleName = profile.admin_role || "Admin";
  if (!profile.is_admin) {
    const { data: roleRows } = await supabase.from("member_roles").select("roles(name, permissions)").eq("profile_id", profile.id);
    permSet = new Set();
    (roleRows || []).forEach((r) => (r.roles?.permissions || []).forEach((p) => permSet.add(p)));
    roleName = (roleRows || []).map((r) => r.roles?.name).filter(Boolean)[0] || "Member";
  }
  window.__poPerms = permSet;
  window.hasPerm = (p) => permSet.has("*") || permSet.has(p);

  // Gate: admins always; other roles only if they hold an admin-surfaced permission.
  const canConsole = profile.is_admin || ADMIN_SURFACED_PERMS.some((p) => window.hasPerm(p));
  if (!canConsole) { window.location.replace("/admin-login.html"); return; }

  window.__poAdminUser = {
    id: profile.id, email: profile.email, name: profile.full_name,
    role: roleName, initials: profile.initials, isAdmin: !!profile.is_admin,
  };

  // Org identity for the console header.
  try {
    const { data: org } = await supabase.from("organizations").select("id, name, watch_key").maybeSingle();
    if (org) { window.__poAdminUser.orgId = org.id; window.__poAdminUser.orgName = org.name; window.__poAdminUser.orgWatchKey = org.watch_key; }
  } catch {}

  splash("Loading console data…");
  await bootstrap();

  // NOTE: window.__poPerms / window.hasPerm were set above from the user's real
  // permissions (all "*" for admins, scoped for other roles) — do not override.

  const { AdminApp, ToastProvider } = window;
  createRoot(document.getElementById("root")).render(
    <ToastProvider>
      <AdminApp />
    </ToastProvider>
  );

  supabase.auth.onAuthStateChange((_evt, s) => { if (!s) window.location.replace("/admin-login.html"); });
}

start();
