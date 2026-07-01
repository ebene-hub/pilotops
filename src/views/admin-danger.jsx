import React from "react";
import { supabase } from "../api/supabase.js";
// Pilot Ops Admin — Danger zone: schedule / cancel permanent deletion of the org.
// Deletion has a 48-hour grace period; the stream gateway purges the org for good
// once that window elapses. Cancellable any time before then.
const { useState: dzUseState, useEffect: dzUseEffect } = React;

function fmtLeft(deleteAfter) {
  const ms = new Date(deleteAfter).getTime() - Date.now();
  if (ms <= 0) return "any moment now";
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

function AdminDangerView() {
  const orgName = window.__poAdminUser?.orgName || "this organization";
  const [status, setStatus] = dzUseState(null);   // { scheduled, delete_after }
  const [loading, setLoading] = dzUseState(true);
  const [confirmOpen, setConfirmOpen] = dzUseState(false);
  const [typed, setTyped] = dzUseState("");
  const [busy, setBusy] = dzUseState(false);
  const toast = useToast();

  async function load() {
    const { data } = await supabase.rpc("org_deletion_status");
    setStatus(data || { scheduled: false });
    setLoading(false);
  }
  dzUseEffect(() => { load(); }, []);

  async function requestDeletion() {
    if (typed.trim() !== orgName) { toast({ kind: "warn", title: "Name doesn't match", msg: "Type the organization name exactly to confirm." }); return; }
    setBusy(true);
    const { error } = await supabase.rpc("request_org_deletion");
    setBusy(false); setConfirmOpen(false); setTyped("");
    if (error) { toast({ kind: "warn", title: "Couldn't schedule deletion", msg: error.message }); return; }
    toast({ kind: "success", title: "Deletion scheduled", msg: "Your organization will be permanently deleted in 48 hours. You can cancel any time before then." });
    load();
  }

  async function cancelDeletion() {
    setBusy(true);
    const { error } = await supabase.rpc("cancel_org_deletion");
    setBusy(false);
    if (error) { toast({ kind: "warn", title: "Couldn't cancel", msg: error.message }); return; }
    toast({ kind: "success", title: "Deletion cancelled", msg: "Your organization is no longer scheduled for deletion." });
    load();
  }

  if (loading) return <div className="card"><div className="muted" style={{ padding: 28, textAlign: "center", fontSize: 13 }}>Loading…</div></div>;

  const scheduled = !!status?.scheduled;

  return (
    <div style={{ maxWidth: 680 }}>
      <div className="card" style={{ border: "1px solid var(--danger)" }}>
        <div className="card-head" style={{ borderBottom: "1px solid color-mix(in oklab, var(--danger) 30%, transparent)" }}>
          <div className="card-title" style={{ color: "var(--danger)" }}><Icon name="warn" size={15}/> Delete organization</div>
        </div>
        <div className="card-body">
          {scheduled ? (
            <>
              <div style={{ padding: 14, borderRadius: 10, background: "color-mix(in oklab, var(--danger) 10%, transparent)", border: "1px solid var(--danger)", marginBottom: 16 }}>
                <div style={{ fontWeight: 600, color: "var(--danger)", fontSize: 14 }}>Scheduled for permanent deletion</div>
                <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 6, lineHeight: 1.5 }}>
                  <strong>{orgName}</strong> and <strong>all its data</strong> (flights, media, incidents, members, settings) will be
                  erased <strong>{new Date(status.delete_after).toLocaleString()}</strong> — in about <strong>{fmtLeft(status.delete_after)}</strong>.
                  This cannot be undone once it happens.
                </div>
              </div>
              <button className="btn btn-primary" onClick={cancelDeletion} disabled={busy}><Icon name="check" size={13}/> {busy ? "Cancelling…" : "Cancel deletion — keep my organization"}</button>
            </>
          ) : (
            <>
              <div className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
                Permanently delete <strong>{orgName}</strong> and everything in it — all flights, media, incidents,
                logbook, members, stakeholders, and settings. You get a <strong>48-hour grace period</strong>: the
                organization keeps working and you can cancel any time before it's erased. After 48 hours it's
                <strong> gone forever</strong> and cannot be recovered.
              </div>
              <button className="btn btn-danger" onClick={() => setConfirmOpen(true)}><Icon name="trash" size={13}/> Delete this organization…</button>
            </>
          )}
        </div>
      </div>

      {confirmOpen && (
        <Modal open onClose={() => { setConfirmOpen(false); setTyped(""); }} icon="warn" size="md"
          title="Delete organization?"
          subtitle="This schedules permanent deletion in 48 hours."
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => { setConfirmOpen(false); setTyped(""); }}>Cancel</button>
              <button className="btn btn-danger" onClick={requestDeletion} disabled={busy || typed.trim() !== orgName}>
                <Icon name="trash" size={13}/> {busy ? "Scheduling…" : "Schedule deletion"}
              </button>
            </>
          }>
          <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6, marginBottom: 14 }}>
            After 48 hours, <strong>{orgName}</strong> and all of its data are permanently deleted and cannot be
            recovered. To confirm, type the organization name below.
          </div>
          <label className="field-label">Organization name</label>
          <input className="input" value={typed} onChange={e => setTyped(e.target.value)} placeholder={orgName} autoFocus/>
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { AdminDangerView });
