import React from "react";
import { createRoot } from "react-dom/client";

import { supabase, currentProfile } from "./api/supabase.js";
import "./styles.css";

// Shared UI primitives (Icon, Modal, ToastProvider, useToast, KpiTile…) register
// themselves on window. The platform console uses its own RPCs, not the tenant
// store — so we don't import data.js / the view modules / bootstrap().
import "./shared.jsx";
import "./platform-app.jsx";

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
  splash("Verifying platform access…");
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.replace("/platform-login.html"); return; }

  // Gate: must be a platform super-admin.
  const { data: isPlatform, error } = await supabase.rpc("auth_is_platform_admin");
  if (error || isPlatform !== true) { await supabase.auth.signOut(); window.location.replace("/platform-login.html"); return; }

  const profile = await currentProfile();
  window.__poPlatformUser = {
    id: profile?.id, email: profile?.email, name: profile?.full_name || "Platform operator",
    initials: profile?.initials || "PO",
  };

  const { PlatformApp, ToastProvider } = window;
  createRoot(document.getElementById("root")).render(
    <ToastProvider>
      <PlatformApp />
    </ToastProvider>
  );

  supabase.auth.onAuthStateChange((_evt, s) => { if (!s) window.location.replace("/platform-login.html"); });
}

start();
