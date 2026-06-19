import React from "react";
import { supabase } from "../api/supabase.js";
// Pilot Ops — Members & Invites store (DB-backed).
// Members come from `profiles` (+ member_roles); invites are real rows in the
// `invites` table that the /login.html registration flow reads via RPC.
// The store (src/store.jsx) populates window.__poMembers / window.__poInvites
// at bootstrap; these helpers read those caches and write through to Supabase.

function ivLoadMembers() { return window.__poMembers || []; }

// Member edits (suspend/remove/roles) update the cache immediately; status
// changes are persisted to profiles best-effort.
function ivSaveMembers(arr) {
  window.__poMembers = arr;
  (arr || []).forEach((m) => {
    if (m.id && m._dirtyStatus) {
      supabase.from("profiles").update({ status: m.status }).eq("id", m.id);
      delete m._dirtyStatus;
    }
  });
}

function ivLoadInvites() { return window.__poInvites || []; }

// Write-through: upsert each invite into the DB so the link actually resolves.
function ivSaveInvites(arr) {
  window.__poInvites = arr;
  const rows = (arr || []).map((i) => ({
    token: i.token, email: i.email, roles: i.roles || [],
    invited_by: window.__poUser?.id || null, invited_by_name: i.invitedByName || null,
    status: i.status || "pending", message: i.message || null,
    expires_at: i.expiresAt ? new Date(i.expiresAt).toISOString() : null,
    opened_at: i.openedAt ? new Date(i.openedAt).toISOString() : null,
    accepted_at: i.acceptedAt ? new Date(i.acceptedAt).toISOString() : null,
  }));
  if (rows.length) supabase.from("invites").upsert(rows, { onConflict: "token" }).then(({ error }) => {
    if (error) console.warn("[invites] save failed:", error.message);
  });
}

function ivGenToken() {
  return "inv_" + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8);
}
function ivGenPilotCode() { return String(Math.floor(100000 + Math.random() * 900000)); }

function ivLinkFor(token) {
  return location.origin + "/login.html?invite=" + token;
}

// Legacy lookups — registration now uses the get_invite/accept_invite RPCs, so
// these operate on the cache only (kept for any callers that remain).
function ivFindInvite(token) { return ivLoadInvites().find((i) => i.token === token) || null; }
function ivMarkOpened(token) { supabase.rpc("mark_invite_opened", { p_token: token }); }
function ivAcceptInvite() { return null; }

Object.assign(window, {
  ivLoadMembers, ivSaveMembers,
  ivLoadInvites, ivSaveInvites,
  ivGenToken, ivGenPilotCode, ivLinkFor,
  ivFindInvite, ivMarkOpened, ivAcceptInvite,
});
