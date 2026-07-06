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

// Shown to a member whose KYC isn't verified yet — no app features until an admin
// verifies them (Admin console → Members → Verify KYC).
// Runs on an invited member's first app entry: accepts the invite (org + roles),
// saves the KYC they entered at registration, and sets the stashed pilot code.
// Idempotent and keyed by email server-side, so it's safe to call every load and
// works even if the login-page finalizer already ran (or never did).
async function finalizeInviteOnEntry(u) {
  const { error } = await supabase.rpc("finalize_my_invite");
  if (error) { console.warn("finalize_my_invite:", error.message); return; }
  const md = u.user_metadata || {};
  if (md.pending_kyc) {
    const k = md.pending_kyc;
    await supabase.from("profiles").update({
      phone: k.phone || null, job_title: k.job_title || null,
      dob: k.dob || null, gov_id: k.gov_id || null,
      license: k.license || null, license_class: k.license_class || null,
      license_expiry: k.license_expiry || null,
    }).eq("id", u.id);
  }
  if (md.pending_pilot_code) {
    await supabase.rpc("set_pilot_code", { p_profile: u.id, p_code: md.pending_pilot_code });
  }
  // Clear the one-shot invite/KYC stash (keep pending_pilot_code for the gate screen).
  if (md.pending_invite_token || md.pending_kyc) {
    await supabase.auth.updateUser({ data: { pending_invite_token: null, pending_kyc: null } });
  }
}

function pendingKyc(status, code) {
  const rejected = status === "rejected";
  const root = document.getElementById("root");
  const codeBlock = (!rejected && code)
    ? `<div style="margin:0 0 22px">
         <div style="font-size:11.5px;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:9px">Your pilot launch code</div>
         <div style="display:flex;gap:8px;justify-content:center">${String(code).split("").map((ch) => `<div style="width:38px;height:46px;border-radius:9px;background:var(--surface-2);border:1px solid var(--border);display:grid;place-items:center;font-size:20px;font-weight:700">${ch}</div>`).join("")}</div>
         <div style="font-size:11.5px;color:var(--text-3);margin-top:9px">Save this now — you'll need it to start missions once you're verified.</div>
       </div>`
    : "";
  if (root) root.innerHTML =
    `<div style="height:100vh;display:grid;place-items:center;font-family:var(--font-sans);padding:24px">
       <div style="max-width:440px;text-align:center">
         <div style="width:52px;height:52px;border-radius:50%;background:color-mix(in oklab,var(--${rejected ? "danger" : "warning"}) 14%,transparent);color:var(--${rejected ? "danger" : "warning"});display:grid;place-items:center;margin:0 auto 16px">
           <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 100 20 10 10 0 000-20z"/><path d="M12 8v4M12 16h.01"/></svg>
         </div>
         <h1 style="font-size:20px;margin:0 0 8px">${rejected ? "Account verification declined" : "Account pending verification"}</h1>
         <p style="font-size:13.5px;color:var(--text-2);line-height:1.6;margin:0 0 20px">
           ${rejected
             ? "Your account verification was declined by an administrator. Please contact your organization's admin to resolve this."
             : "Your account has been created, but an administrator must verify your details (KYC) before you can use Pilot Ops. You'll be able to sign in and start working once you're verified — please check back shortly or contact your admin."}
         </p>
         ${codeBlock}
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

  // Invited members: on first sign-in, finalize onboarding here too (not just on
  // the login page) — the app is the one chokepoint every member passes through.
  // This accepts the invite (→ org + roles), saves KYC, and sets the pilot code.
  await finalizeInviteOnEntry(u);

  // Access control: only operational roles may use Pilot Ops.
  const [{ data: roleRows }, { data: prof }] = await Promise.all([
    supabase.from("member_roles").select("roles(name)").eq("profile_id", u.id),
    supabase.from("profiles").select("is_admin, kyc_status").eq("id", u.id).single(),
  ]);
  const roles = (roleRows || []).map((r) => r.roles?.name).filter(Boolean);
  const hasAccess = prof?.is_admin || roles.some((r) => PILOT_OPS_ROLES.has(r));
  if (!hasAccess) { noAccess(roles); return; }
  // KYC gate: a non-admin whose account hasn't been verified by an admin can't
  // use any feature yet. Admins (incl. the founding admin, auto-verified) pass.
  // Still show the member their pilot launch code so they can save it meanwhile.
  if (!prof?.is_admin && prof?.kyc_status !== "verified") { pendingKyc(prof?.kyc_status, u.user_metadata?.pending_pilot_code); return; }
  // Verified and entering the app → the launch code no longer needs to linger.
  if (u.user_metadata?.pending_pilot_code) { supabase.auth.updateUser({ data: { pending_pilot_code: null } }); }
  // Surface the user's real role(s) for the sidebar + role-based UI gating.
  window.__poUser.role = roles[0] || (prof?.is_admin ? "Admin" : "Member");
  window.__poUser.roles = roles;

  // Org identity + permanent watch key (org_read RLS returns only our org).
  // Awaited so the org name is available when the shell first renders.
  try {
    const { data: org } = await supabase.from("organizations").select("id, name, watch_key").maybeSingle();
    if (org) { window.__poUser.orgId = org.id; window.__poUser.orgName = org.name; window.__poUser.orgWatchKey = org.watch_key; }
  } catch {}

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
