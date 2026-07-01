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

async function start() {
  splash("Verifying admin access…");
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.replace("/admin-login.html"); return; }

  const profile = await currentProfile();
  if (!profile || !profile.is_admin) { window.location.replace("/admin-login.html"); return; }

  window.__poAdminUser = {
    id: profile.id, email: profile.email, name: profile.full_name,
    role: profile.admin_role || "Admin", initials: profile.initials, isAdmin: true,
  };

  // Org identity for the console header.
  try {
    const { data: org } = await supabase.from("organizations").select("id, name, watch_key").maybeSingle();
    if (org) { window.__poAdminUser.orgId = org.id; window.__poAdminUser.orgName = org.name; window.__poAdminUser.orgWatchKey = org.watch_key; }
  } catch {}

  splash("Loading console data…");
  await bootstrap();

  // Admins have full permissions in the console.
  window.__poPerms = new Set(["*"]);
  window.hasPerm = () => true;

  const { AdminApp, ToastProvider } = window;
  createRoot(document.getElementById("root")).render(
    <ToastProvider>
      <AdminApp />
    </ToastProvider>
  );

  supabase.auth.onAuthStateChange((_evt, s) => { if (!s) window.location.replace("/admin-login.html"); });
}

start();
