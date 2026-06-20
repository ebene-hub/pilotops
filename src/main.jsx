import React from "react";
import { createRoot } from "react-dom/client";

import { supabase } from "./api/supabase.js";
import { bootstrap } from "./store.jsx";

// Global stylesheet (design tokens, layout, components, responsive + dark mode).
import "./styles.css";

// ---------------------------------------------------------------------------
// Module load order MUST match the original prototype's <script> order in
// "Pilot Ops.html". Each module registers its components/data on `window`
// (via `Object.assign(window, …)`), and later modules reference those globals
// by bare name. Cross-references happen inside component render functions, so
// by the time we mount below, every symbol is registered.
// ---------------------------------------------------------------------------
import "./tweaks-panel.jsx";
import "./data.js";
import "./shared.jsx";

import "./views/flight-hub.jsx";
import "./views/pilot-auth.jsx";
import "./views/emergency-launch.jsx";
import "./views/preflight.jsx";
import "./views/notify-composer.jsx";
import "./views/live-stream.jsx";
import "./views/live-video.jsx";
import "./views/multi-screen.jsx";
import "./views/summary-email.jsx";
import "./views/fleet.jsx";
import "./views/logbook.jsx";
import "./views/media-gallery.jsx";
import "./views/incident-report.jsx";
import "./views/reports-archive.jsx";
import "./views/admin.jsx";
import "./views/command-palette.jsx";

import "./app.jsx";

// ---------------------------------------------------------------------------
// Real auth gate + data bootstrap. Require a Supabase session, load the signed-in
// profile, fetch all real data into the global store, then mount. No session →
// redirect to /login.html.
// ---------------------------------------------------------------------------
function splash(msg) {
  const root = document.getElementById("root");
  if (root) root.innerHTML =
    `<div style="height:100vh;display:grid;place-items:center;font-family:var(--font-sans);color:var(--text-3)">
       <div style="text-align:center">
         <div style="width:34px;height:34px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite;margin:0 auto 14px"></div>
         ${msg || "Loading…"}
       </div>
     </div>
     <style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;
}

// Roles that grant access to the operational Pilot Ops app. Data-only roles
// (GIS Analyst, Stakeholder, External) are intentionally excluded — they can be
// invited and registered, but cannot sign in here.
const PILOT_OPS_ROLES = new Set([
  "Pilot", "Co-pilot", "Mission Commander", "Safety Officer",
  "Observer", "Maintenance Tech", "Dispatcher", "Director",
]);

function noAccess(roles) {
  const root = document.getElementById("root");
  if (root) root.innerHTML =
    `<div style="height:100vh;display:grid;place-items:center;font-family:var(--font-sans);padding:24px">
       <div style="max-width:420px;text-align:center">
         <div style="width:52px;height:52px;border-radius:50%;background:color-mix(in oklab,var(--warning) 14%,transparent);color:var(--warning);display:grid;place-items:center;margin:0 auto 16px">
           <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>
         </div>
         <h1 style="font-size:20px;margin:0 0 8px">No Pilot Ops access</h1>
         <p style="font-size:13.5px;color:var(--text-2);line-height:1.6;margin:0 0 20px">
           Your account${roles.length ? " (" + roles.join(", ") + ")" : ""} doesn't have access to the Pilot Ops
           operations app. GIS Analysts and data-only members can't sign in here — contact your admin if this is unexpected.
         </p>
         <button id="po-signout" class="btn btn-primary" style="height:40px">Sign out</button>
       </div>
     </div>`;
  document.getElementById("po-signout")?.addEventListener("click", async () => {
    try { await supabase.auth.signOut(); } catch {}
    window.location.replace("/login.html");
  });
}

async function start() {
  splash("Signing you in…");
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.replace("/login.html"); return; }

  const u = session.user;
  window.__poUser = {
    id: u.id, pilotId: u.id, email: u.email,
    name: u.user_metadata?.full_name || u.email,
    initials: u.user_metadata?.initials || (u.email || "U").slice(0, 2).toUpperCase(),
  };

  // Access control: only operational roles may use Pilot Ops.
  const [{ data: roleRows }, { data: prof }] = await Promise.all([
    supabase.from("member_roles").select("roles(name)").eq("profile_id", u.id),
    supabase.from("profiles").select("is_admin").eq("id", u.id).single(),
  ]);
  const roles = (roleRows || []).map((r) => r.roles?.name).filter(Boolean);
  const hasAccess = prof?.is_admin || roles.some((r) => PILOT_OPS_ROLES.has(r));
  if (!hasAccess) { noAccess(roles); return; }

  splash("Loading operations data…");
  await bootstrap();

  // Effective permissions = union of the user's roles' permissions (+ "*"/admin).
  // Views gate actions with window.hasPerm(); RLS enforces the same server-side.
  const permSet = new Set();
  if (prof?.is_admin) permSet.add("*");
  (window.ALL_ROLES || []).forEach((r) => { if (roles.includes(r.name)) (r.permissions || []).forEach((p) => permSet.add(p)); });
  window.__poPerms = permSet;
  window.hasPerm = (p) => permSet.has("*") || permSet.has(p);

  const { App, ToastProvider } = window;
  createRoot(document.getElementById("root")).render(
    <ToastProvider>
      <App />
    </ToastProvider>
  );

  // Keep the session honest: if the user signs out elsewhere, bounce to login.
  supabase.auth.onAuthStateChange((_evt, s) => { if (!s) window.location.replace("/login.html"); });
}

start();
