import React from "react";
import { supabase } from "../api/supabase.js";
// Pilot Ops Admin — Pilot lockouts
// Pilots are locked out for 15 min after 3 wrong launch codes. Admins see who is
// locked and can override (clear) the lockout immediately.
const { useState: alUseState, useEffect: alUseEffect } = React;

function fmtMinsLeft(lockedUntil) {
  const ms = new Date(lockedUntil).getTime() - Date.now();
  if (ms <= 0) return "expiring";
  const m = Math.ceil(ms / 60000);
  return `${m} min${m === 1 ? "" : "s"} left`;
}

function AdminLockoutsView() {
  const [rows, setRows] = alUseState([]);
  const [loading, setLoading] = alUseState(true);
  const [busy, setBusy] = alUseState("");
  const toast = useToast();

  async function load() {
    const { data, error } = await supabase.rpc("admin_pilot_lockouts");
    setRows(error ? [] : (data || []));
    setLoading(false);
  }
  alUseEffect(() => {
    load();
    const t = setInterval(load, 30000); // keep it fresh (lockouts auto-expire)
    return () => clearInterval(t);
  }, []);

  async function unlock(r) {
    setBusy(r.profile_id);
    const { error } = await supabase.rpc("admin_clear_pilot_lockout", { p_pilot: r.profile_id });
    setBusy("");
    if (error) { toast({ kind: "warn", title: "Couldn't override", msg: error.message }); return; }
    toast({ kind: "success", title: "Lockout cleared", msg: `${r.full_name || "Pilot"} can enter their code again now.` });
    load();
  }

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">Locked-out pilots</div>
        <div className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{rows.length} currently locked</div>
        <button className="btn btn-sm btn-ghost" style={{ marginLeft: "auto" }} onClick={load}><Icon name="refresh" size={12}/> Refresh</button>
      </div>

      {loading ? (
        <div className="muted" style={{ padding: 28, textAlign: "center", fontSize: 13 }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 36, textAlign: "center", color: "var(--text-3)" }}>
          <Icon name="shield" size={28} stroke="var(--text-4)"/>
          <div style={{ marginTop: 10, fontSize: 13.5, fontWeight: 500, color: "var(--text-2)" }}>No pilots are locked out</div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>A pilot who enters the wrong launch code 3 times is locked for 15 minutes and appears here.</div>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Pilot</th>
                <th>Failed attempts</th>
                <th>Last attempt</th>
                <th>Unlocks in</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.profile_id}>
                  <td style={{ fontWeight: 600, fontSize: 13 }}>{r.full_name || "—"}</td>
                  <td><span className="badge" style={{ background: "color-mix(in oklab, var(--danger) 12%, transparent)", color: "var(--danger)", borderColor: "color-mix(in oklab, var(--danger) 30%, transparent)" }}>{r.fails} fails</span></td>
                  <td className="mono" style={{ fontSize: 12, color: "var(--text-2)" }}>{r.last_fail ? new Date(r.last_fail).toLocaleString() : "—"}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{fmtMinsLeft(r.locked_until)}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn btn-sm btn-primary" disabled={busy === r.profile_id} onClick={() => unlock(r)}>
                      <Icon name="shield" size={12}/> {busy === r.profile_id ? "Overriding…" : "Override lockout"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { AdminLockoutsView });
