import React from "react";
import { supabase } from "./api/supabase.js";
// Pilot Ops — Platform (super-admin) console. Geoinfotech manages every org:
// list/create orgs, set licenses, manage per-org SMTP, and register members.
// All data comes from platform_* RPCs (gated on auth_is_platform_admin) and the
// stream-gateway's /platform/* endpoints (account creation via the Admin API).
const { useState: pUseState, useEffect: pUseEffect, useCallback: pUseCallback } = React;

const gatewayBaseOf = () => {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  try { return new URL(import.meta.env.VITE_STREAM_URL || origin, origin).origin; } catch { return origin; }
};
const tokenNow = async () => (await supabase.auth.getSession()).data?.session?.access_token || "";
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : "—");
const genCode = () => String(Math.floor(100000 + Math.random() * 900000));

async function callGateway(path, body) {
  const r = await fetch(`${gatewayBaseOf()}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: await tokenNow(), ...body }),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok && j.ok, status: r.status, j };
}

// Show secrets (set-password link, temp password, launch code) once, with copy.
function RevealModal({ title, subtitle, rows, onClose }) {
  const toast = useToast();
  return (
    <Modal open onClose={onClose} title={title} subtitle={subtitle || "Copy these now — for security they won't be shown again."} icon="check"
           footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.filter((r) => r.value).map((r) => (
          <div key={r.label}>
            <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 4 }}>{r.label}</div>
            <div className="row" style={{ gap: 8, alignItems: "center", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}>
              <span className="mono" style={{ fontSize: 12.5, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.value}</span>
              <button className="btn btn-sm" onClick={() => { navigator.clipboard?.writeText(r.value); toast({ kind: "success", title: "Copied", msg: r.label }); }}><Icon name="link" size={12}/> Copy</button>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

const LICENSE_TONE = { active: "var(--success)", suspended: "var(--danger)", expired: "var(--warning)" };
function LicenseBadge({ status, expires }) {
  const expired = expires && new Date(expires) < new Date(new Date().toDateString());
  const eff = status === "active" && expired ? "expired" : status;
  const tone = LICENSE_TONE[eff] || "var(--text-3)";
  return <span className="badge" style={{ background: `color-mix(in oklab, ${tone} 14%, transparent)`, color: tone, textTransform: "capitalize" }}>{eff}</span>;
}

// ---------------------------------------------------------------------------
function PlatformApp() {
  const [orgs, setOrgs] = pUseState([]);
  const [loading, setLoading] = pUseState(true);
  const [createOpen, setCreateOpen] = pUseState(false);
  const [manage, setManage] = pUseState(null); // org being managed
  const toast = useToast();
  const me = window.__poPlatformUser || {};

  const load = pUseCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("platform_list_orgs");
    setLoading(false);
    if (error) { toast({ kind: "warn", title: "Couldn't load organizations", msg: error.message }); return; }
    setOrgs(Array.isArray(data) ? data : []);
  }, [toast]);
  pUseEffect(() => { load(); }, [load]);

  const totalMembers = orgs.reduce((s, o) => s + Number(o.member_count || 0), 0);
  const totalLive = orgs.reduce((s, o) => s + Number(o.live_count || 0), 0);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      {/* Top bar */}
      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 24px", borderBottom: "1px solid var(--border)", background: "var(--surface)", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: "linear-gradient(135deg,#1e293b,#0f172a)", border: "1px solid color-mix(in oklab,#7c3aed 40%,transparent)", display: "grid", placeItems: "center", color: "#fff", fontWeight: 700, fontFamily: "var(--font-mono)", fontSize: 12 }}>PO</div>
        <div style={{ fontWeight: 600, fontSize: 15 }}>Pilot Ops <span className="badge" style={{ background: "color-mix(in oklab,#7c3aed 16%,transparent)", color: "#a78bfa", marginLeft: 4 }}>PLATFORM</span></div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
          <span className="muted" style={{ fontSize: 12.5 }}>{me.email}</span>
          <button className="btn btn-sm" onClick={async () => { await supabase.auth.signOut(); location.href = "/platform-login.html"; }}><Icon name="logout" size={13}/> Sign out</button>
        </div>
      </header>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px" }}>
        <div className="page-head" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 18 }}>
          <div>
            <h1 className="page-title" style={{ margin: 0 }}>Organizations</h1>
            <div className="page-sub muted" style={{ fontSize: 13, marginTop: 4 }}>{orgs.length} organizations · {totalMembers} members · {totalLive} live now</div>
          </div>
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}><Icon name="plus" size={14}/> Create organization</button>
        </div>

        <div className="card">
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Organization</th><th>License</th><th>Expires</th>
                  <th style={{ textAlign: "right" }}>Seats</th>
                  <th style={{ textAlign: "right" }}>Members</th>
                  <th style={{ textAlign: "right" }}>Flights</th>
                  <th>Email</th><th>Created</th><th></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="9" style={{ textAlign: "center", padding: 28 }} className="muted">Loading…</td></tr>
                ) : orgs.length === 0 ? (
                  <tr><td colSpan="9" style={{ textAlign: "center", padding: 28 }} className="muted">No organizations yet.</td></tr>
                ) : orgs.map((o) => (
                  <tr key={o.id} className="clickable" onClick={() => setManage(o)}>
                    <td style={{ fontWeight: 600 }}>{o.name}
                      {o.live_count > 0 && <span className="badge" style={{ background: "var(--danger)", color: "#fff", marginLeft: 8, fontSize: 10 }}>{o.live_count} LIVE</span>}
                      <div className="muted" style={{ fontSize: 11 }}>{o.primary_admin_email || "no admin"}</div>
                    </td>
                    <td><LicenseBadge status={o.license_status} expires={o.license_expires_at}/></td>
                    <td className="mono" style={{ fontSize: 12 }}>{fmtDate(o.license_expires_at)}</td>
                    <td className="mono tabular" style={{ textAlign: "right" }}>{o.member_count}{o.seat_limit != null ? ` / ${o.seat_limit}` : ""}</td>
                    <td className="mono tabular" style={{ textAlign: "right" }}>{o.member_count}</td>
                    <td className="mono tabular" style={{ textAlign: "right" }}>{o.flight_count}</td>
                    <td>{o.email_active ? <span style={{ color: "var(--success)" }}><Icon name="check" size={13}/></span> : <span className="muted">—</span>}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{fmtDate(o.created_at)}</td>
                    <td style={{ textAlign: "right" }}><button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); setManage(o); }}>Manage</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {createOpen && <CreateOrgModal onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); load(); }}/>}
      {manage && <ManageDrawer org={manage} onClose={() => setManage(null)} onChanged={load}/>}
    </div>
  );
}

// ---- Create organization ---------------------------------------------------
function CreateOrgModal({ onClose, onCreated }) {
  const [f, setF] = pUseState({ orgName: "", adminName: "", adminEmail: "", licenseStatus: "active", expires: "", seats: "" });
  const [busy, setBusy] = pUseState(false);
  const [result, setResult] = pUseState(null); // { link, emailed }
  const toast = useToast();
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  async function submit() {
    if (!f.orgName.trim()) return toast({ kind: "warn", title: "Name required", msg: "Enter an organization name." });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.adminEmail.trim())) return toast({ kind: "warn", title: "Admin email required", msg: "Enter a valid admin email." });
    setBusy(true);
    try {
      const r = await fetch(`${gatewayBaseOf()}/platform/create-org`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: await tokenNow(), orgName: f.orgName.trim(), adminName: f.adminName.trim(),
          adminEmail: f.adminEmail.trim().toLowerCase(), licenseStatus: f.licenseStatus,
          expires: f.expires || null, seats: f.seats || null,
          redirectTo: location.origin + "/admin-login.html",
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) { toast({ kind: "warn", title: "Create failed", msg: j.reason || `Error ${r.status}` }); setBusy(false); return; }
      setResult({ link: j.link, emailed: j.emailed });
      toast({ kind: "success", title: "Organization created", msg: j.emailed ? "Set-password link emailed to the admin." : "Created — copy the set-password link below." });
    } catch (e) { toast({ kind: "warn", title: "Gateway unreachable", msg: e.message }); }
    setBusy(false);
  }

  return (
    <Modal open onClose={onClose} title="Create organization" subtitle="Provisions the org, its first admin, and a license" icon="plus"
           footer={result ? <button className="btn btn-primary" onClick={onCreated}>Done</button> : <>
             <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
             <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? <><span className="loading-spin"/> Creating…</> : <><Icon name="check" size={14}/> Create</>}</button>
           </>}>
      {result ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="muted" style={{ fontSize: 13 }}>{result.emailed ? "A set-password link was emailed to the new admin." : "Email delivery isn't configured — share this set-password link with the admin manually:"}</div>
          <div className="row" style={{ gap: 8, alignItems: "center", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 11px" }}>
            <span className="mono" style={{ fontSize: 11.5, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{result.link}</span>
            <button className="btn btn-sm" onClick={() => { navigator.clipboard?.writeText(result.link); toast({ kind: "success", title: "Copied", msg: "Set-password link copied." }); }}><Icon name="link" size={12}/> Copy</button>
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="field" style={{ gridColumn: "span 2" }}><label className="field-label">Organization name</label><input className="input" value={f.orgName} onChange={(e) => set("orgName", e.target.value)} placeholder="Acme UAV Services"/></div>
          <div className="field"><label className="field-label">Admin name</label><input className="input" value={f.adminName} onChange={(e) => set("adminName", e.target.value)} placeholder="Jane Doe"/></div>
          <div className="field"><label className="field-label">Admin email</label><input className="input mono" value={f.adminEmail} onChange={(e) => set("adminEmail", e.target.value)} placeholder="admin@acme.com"/></div>
          <div className="field"><label className="field-label">License status</label>
            <select className="select" value={f.licenseStatus} onChange={(e) => set("licenseStatus", e.target.value)}><option value="active">Active</option><option value="suspended">Suspended</option><option value="expired">Expired</option></select>
          </div>
          <div className="field"><label className="field-label">Expires <span className="muted">(optional)</span></label><input className="input" type="date" value={f.expires} onChange={(e) => set("expires", e.target.value)}/></div>
          <div className="field"><label className="field-label">Seat cap <span className="muted">(blank = ∞)</span></label><input className="input" type="number" min="1" value={f.seats} onChange={(e) => set("seats", e.target.value)} placeholder="e.g. 25"/></div>
        </div>
      )}
    </Modal>
  );
}

// ---- Manage one org (License / Email / Members) ----------------------------
function ManageDrawer({ org, onClose, onChanged }) {
  const [tab, setTab] = pUseState("license");
  return (
    <Modal open onClose={onClose} title={org.name} subtitle="Manage organization" icon="settings" size="lg"
           footer={<button className="btn" onClick={onClose}>Close</button>}>
      <div className="row" style={{ gap: 6, marginBottom: 16, borderBottom: "1px solid var(--border)", paddingBottom: 10 }}>
        {[["license", "License"], ["email", "Email delivery"], ["members", "Members"], ["danger", "Danger"]].map(([v, l]) => (
          <button key={v} className={"btn btn-sm " + (tab === v ? "btn-primary" : "")} onClick={() => setTab(v)}>{l}</button>
        ))}
      </div>
      {tab === "license" && <LicenseTab org={org} onChanged={onChanged}/>}
      {tab === "email" && <EmailTab org={org}/>}
      {tab === "members" && <MembersTab org={org}/>}
      {tab === "danger" && <DangerTab org={org} onClose={onClose} onChanged={onChanged}/>}
    </Modal>
  );
}

function DangerTab({ org, onClose, onChanged }) {
  const [confirm, setConfirm] = pUseState("");
  const [busy, setBusy] = pUseState(false);
  const toast = useToast();
  async function del() {
    setBusy(true);
    const { ok, j, status } = await callGateway("/platform/delete-org", { orgId: org.id });
    setBusy(false);
    if (!ok) { toast({ kind: "warn", title: "Delete failed", msg: j.reason || `Error ${status}` }); return; }
    toast({ kind: "success", title: "Organization deleted", msg: `${org.name} and all its data were removed.` });
    onChanged && onChanged(); onClose && onClose();
  }
  return (
    <div style={{ maxWidth: 520 }}>
      <div style={{ border: "1px solid color-mix(in oklab,var(--danger) 40%,transparent)", borderRadius: 10, padding: 16 }}>
        <div style={{ fontWeight: 600, color: "var(--danger)", marginBottom: 6 }}>Delete this organization</div>
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 12 }}>Permanently removes <strong>{org.name}</strong> — every member account, flight, incident, media file, and setting. This cannot be undone.</div>
        <label className="field-label">Type the organization name to confirm</label>
        <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={org.name}/>
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <button className="btn btn-danger" disabled={busy || confirm.trim() !== org.name} onClick={del}><Icon name="trash" size={13}/> {busy ? "Deleting…" : "Delete organization"}</button>
        </div>
      </div>
    </div>
  );
}

function LicenseTab({ org, onChanged }) {
  const [status, setStatus] = pUseState(org.license_status || "active");
  const [expires, setExpires] = pUseState(org.license_expires_at || "");
  const [seats, setSeats] = pUseState(org.seat_limit ?? "");
  const [busy, setBusy] = pUseState(false);
  const toast = useToast();

  async function save() {
    setBusy(true);
    const { error } = await supabase.rpc("platform_set_license", {
      p_org: org.id, p_status: status, p_expires: expires || null, p_seats: seats === "" ? null : Number(seats),
    });
    setBusy(false);
    if (error) { toast({ kind: "warn", title: "Save failed", msg: error.message }); return; }
    toast({ kind: "success", title: "License updated", msg: `${org.name} is now ${status}.` });
    onChanged && onChanged();
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 520 }}>
      <div className="field"><label className="field-label">Status</label>
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}><option value="active">Active</option><option value="suspended">Suspended</option><option value="expired">Expired</option></select>
      </div>
      <div className="field"><label className="field-label">Expires</label><input className="input" type="date" value={expires || ""} onChange={(e) => setExpires(e.target.value)}/></div>
      <div className="field"><label className="field-label">Seat cap <span className="muted">(blank = ∞)</span></label><input className="input" type="number" min="1" value={seats} onChange={(e) => setSeats(e.target.value)} placeholder="unlimited"/></div>
      <div style={{ gridColumn: "span 2", display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
        <button className="btn btn-primary" onClick={save} disabled={busy}><Icon name="check" size={13}/> {busy ? "Saving…" : "Save license"}</button>
      </div>
      <div className="muted" style={{ gridColumn: "span 2", fontSize: 12, lineHeight: 1.5 }}>Suspended or expired organizations are blocked from signing in (admins and pilots) with a message to contact their provider.</div>
    </div>
  );
}

function EmailTab({ org }) {
  const [s, setS] = pUseState(null);
  const [provider, setProvider] = pUseState("smtp");
  const [f, setF] = pUseState({ from_name: "", from_email: "", smtp_host: "", smtp_port: 587, smtp_secure: false, smtp_username: "", smtp_password: "", smtp_allow_invalid_cert: false, resend_api_key: "", active: false });
  const [busy, setBusy] = pUseState(false);
  const [testTo, setTestTo] = pUseState("");
  const [testing, setTesting] = pUseState(false);
  const toast = useToast();
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  pUseEffect(() => {
    let cancel = false;
    supabase.rpc("platform_get_org_email_settings", { p_org: org.id }).then(({ data }) => {
      if (cancel || !data?.exists) { setS({ exists: false }); return; }
      setS(data); setProvider(data.provider || "smtp");
      setF({ from_name: data.from_name || "", from_email: data.from_email || "", smtp_host: data.smtp_host || "", smtp_port: data.smtp_port || 587, smtp_secure: !!data.smtp_secure, smtp_username: data.smtp_username || "", smtp_password: "", smtp_allow_invalid_cert: !!data.smtp_allow_invalid_cert, resend_api_key: "", active: !!data.active });
    });
    return () => { cancel = true; };
  }, [org.id]);

  async function save() {
    if (!f.from_email.trim()) return toast({ kind: "warn", title: "From address required", msg: "Enter the address emails are sent from." });
    setBusy(true);
    const payload = { provider, from_name: f.from_name.trim(), from_email: f.from_email.trim(), active: f.active, smtp_host: f.smtp_host.trim(), smtp_port: String(f.smtp_port || ""), smtp_secure: f.smtp_secure, smtp_username: f.smtp_username.trim(), smtp_allow_invalid_cert: f.smtp_allow_invalid_cert, smtp_password: f.smtp_password, resend_api_key: f.resend_api_key };
    const { error } = await supabase.rpc("platform_set_org_email_settings", { p_org: org.id, p: payload });
    setBusy(false);
    if (error) { toast({ kind: "warn", title: "Couldn't save", msg: error.message }); return; }
    setF((p) => ({ ...p, smtp_password: "", resend_api_key: "" }));
    toast({ kind: "success", title: "Email settings saved", msg: f.active ? "Delivery is on for this org." : "Saved (delivery off)." });
  }

  async function sendTest() {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(testTo.trim())) return toast({ kind: "warn", title: "Enter a test email", msg: "Add a recipient." });
    setTesting(true);
    try {
      const r = await fetch(`${gatewayBaseOf()}/send-test-email`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: await tokenNow(), to: testTo.trim(), orgId: org.id }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) toast({ kind: "success", title: "Test sent", msg: `Check ${testTo.trim()} (and spam).` });
      else toast({ kind: "warn", title: "Test failed", msg: j.reason || `Error ${r.status}. Save settings first, and enable delivery.` });
    } catch (e) { toast({ kind: "warn", title: "Gateway unreachable", msg: e.message }); }
    setTesting(false);
  }

  if (!s) return <div className="muted" style={{ padding: 20, textAlign: "center" }}>Loading…</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 620 }}>
      <div className="row" style={{ gap: 8 }}>
        {[["smtp", "SMTP server"], ["resend", "Resend API"]].map(([v, l]) => (
          <button key={v} className={"btn btn-sm " + (provider === v ? "btn-primary" : "")} onClick={() => setProvider(v)}>{l}</button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="field"><label className="field-label">From name</label><input className="input" value={f.from_name} onChange={(e) => set("from_name", e.target.value)} placeholder="Pilot Ops"/></div>
        <div className="field"><label className="field-label">From email</label><input className="input" value={f.from_email} onChange={(e) => set("from_email", e.target.value)} placeholder="ops@org.com"/></div>
        {provider === "smtp" ? <>
          <div className="field"><label className="field-label">SMTP host</label><input className="input mono" value={f.smtp_host} onChange={(e) => set("smtp_host", e.target.value)} placeholder="smtp.provider.com"/></div>
          <div className="field"><label className="field-label">Port</label>
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <input className="input mono" type="number" value={f.smtp_port} onChange={(e) => set("smtp_port", +e.target.value)} style={{ width: 90 }}/>
              <label style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6, color: "var(--text-2)" }}><input type="checkbox" checked={f.smtp_secure} onChange={(e) => set("smtp_secure", e.target.checked)}/> TLS (465)</label>
            </div>
          </div>
          <div className="field"><label className="field-label">Username</label><input className="input mono" value={f.smtp_username} onChange={(e) => set("smtp_username", e.target.value)} placeholder="full email address"/></div>
          <div className="field"><label className="field-label">Password {s.has_smtp_password && <span className="muted">· saved</span>}</label><input className="input mono" type="password" value={f.smtp_password} onChange={(e) => set("smtp_password", e.target.value)} placeholder={s.has_smtp_password ? "•••• (blank = keep)" : "SMTP password"}/></div>
          <label style={{ gridColumn: "span 2", display: "flex", gap: 8, fontSize: 12.5, color: "var(--text-2)" }}><input type="checkbox" checked={f.smtp_allow_invalid_cert} onChange={(e) => set("smtp_allow_invalid_cert", e.target.checked)}/> Allow mismatched/self-signed TLS certificate</label>
        </> : (
          <div className="field" style={{ gridColumn: "span 2" }}><label className="field-label">Resend API key {s.has_resend_key && <span className="muted">· saved</span>}</label><input className="input mono" type="password" value={f.resend_api_key} onChange={(e) => set("resend_api_key", e.target.value)} placeholder={s.has_resend_key ? "re_•••• (blank = keep)" : "re_..."}/></div>
        )}
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}><input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)}/> Enable email delivery for this organization</label>
      <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn btn-primary" onClick={save} disabled={busy}><Icon name="check" size={13}/> {busy ? "Saving…" : "Save settings"}</button></div>
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <label className="field-label">Send a test</label>
        <div className="row" style={{ gap: 8 }}>
          <input className="input" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" style={{ flex: 1 }}/>
          <button className="btn" onClick={sendTest} disabled={testing}><Icon name="send" size={13}/> {testing ? "Sending…" : "Send test"}</button>
        </div>
      </div>
    </div>
  );
}

function MembersTab({ org }) {
  const [members, setMembers] = pUseState(null);
  const [roles, setRoles] = pUseState([]);
  const [f, setF] = pUseState({ name: "", email: "", roles: [], withCode: false });
  const [busy, setBusy] = pUseState(false);
  const [actingId, setActingId] = pUseState(null);
  const [reveal, setReveal] = pUseState(null);
  const toast = useToast();

  const loadMembers = pUseCallback(() => {
    supabase.rpc("platform_org_members", { p_org: org.id }).then(({ data }) => setMembers(Array.isArray(data) ? data : []));
  }, [org.id]);
  pUseEffect(() => { loadMembers(); supabase.from("roles").select("name").order("name").then(({ data }) => setRoles((data || []).map((r) => r.name))); }, [loadMembers]);

  const toggleRole = (r) => setF((p) => ({ ...p, roles: p.roles.includes(r) ? p.roles.filter((x) => x !== r) : [...p.roles, r] }));

  async function register() {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) return toast({ kind: "warn", title: "Email required", msg: "Enter a valid email." });
    setBusy(true);
    const { ok, j, status } = await callGateway("/platform/register-pilot", { orgId: org.id, email: f.email.trim().toLowerCase(), name: f.name.trim(), roles: f.roles, withLaunchCode: f.withCode, redirectTo: location.origin + "/login.html" });
    setBusy(false);
    if (!ok) { toast({ kind: "warn", title: "Register failed", msg: j.reason || `Error ${status}` }); return; }
    toast({ kind: "success", title: "Member registered", msg: j.emailed ? "Set-password link emailed." : "Registered." });
    setReveal({ title: "Member registered", rows: [{ label: "Set-password link", value: j.link }, { label: "Launch code", value: j.launchCode }] });
    setF({ name: "", email: "", roles: [], withCode: false }); loadMembers();
  }

  async function resetPassword(m) {
    setActingId(m.id);
    const { ok, j, status } = await callGateway("/platform/reset-password", { email: m.email, redirectTo: location.origin + (m.is_admin ? "/admin-login.html" : "/login.html") });
    setActingId(null);
    if (!ok) { toast({ kind: "warn", title: "Reset failed", msg: j.reason || `Error ${status}` }); return; }
    toast({ kind: "success", title: "Reset link ready", msg: j.emailed ? "Emailed to the member." : "Copy the link below." });
    setReveal({ title: "Password reset", subtitle: `Set-password link for ${m.email}`, rows: [{ label: "Set-password link", value: j.link }] });
  }

  async function resetCode(m) {
    setActingId(m.id);
    const code = genCode();
    const { error } = await supabase.rpc("platform_set_pilot_code", { p_profile: m.id, p_code: code });
    setActingId(null);
    if (error) { toast({ kind: "warn", title: "Couldn't set code", msg: error.message }); return; }
    setReveal({ title: "Launch code reset", subtitle: `New launch code for ${m.full_name || m.email}`, rows: [{ label: "Launch code", value: code }] });
  }

  async function del(m) {
    if (!window.confirm(`Delete ${m.full_name || m.email}? This permanently removes their account.`)) return;
    setActingId(m.id);
    const { ok, j, status } = await callGateway("/platform/delete-member", { profileId: m.id });
    setActingId(null);
    if (!ok) { toast({ kind: "warn", title: "Delete failed", msg: j.reason || `Error ${status}` }); return; }
    toast({ kind: "success", title: "Member deleted", msg: m.email });
    loadMembers();
  }

  async function demoPilot() {
    setBusy(true);
    const { ok, j, status } = await callGateway("/platform/create-demo-pilot", { orgId: org.id });
    setBusy(false);
    if (!ok) { toast({ kind: "warn", title: "Demo failed", msg: j.reason || `Error ${status}` }); return; }
    toast({ kind: "success", title: "Demo pilot created", msg: "Credentials + launch code below." });
    setReveal({ title: "Demo pilot created", subtitle: "Ready-to-use account (KYC pre-verified)", rows: [{ label: "Email", value: j.email }, { label: "Temp password", value: j.password }, { label: "Launch code", value: j.launchCode }] });
    loadMembers();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 }}>
      <div>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <label className="field-label" style={{ margin: 0 }}>Members ({members?.length ?? "…"})</label>
          <button className="btn btn-sm" onClick={demoPilot} disabled={busy}><Icon name="plus" size={12}/> Demo pilot</button>
        </div>
        <div style={{ border: "1px solid var(--border)", borderRadius: 8, maxHeight: 240, overflowY: "auto" }}>
          {members == null ? <div className="muted" style={{ padding: 16, textAlign: "center" }}>Loading…</div>
            : members.length === 0 ? <div className="muted" style={{ padding: 16, textAlign: "center" }}>No members yet.</div>
            : members.map((m) => (
              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderBottom: "1px solid var(--border)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{m.full_name || m.email} {m.is_admin && <span className="badge" style={{ background: "var(--accent-soft)", color: "var(--accent)", marginLeft: 4 }}>Admin</span>}</div>
                  <div className="muted mono" style={{ fontSize: 11 }}>{m.email} · {(m.roles || []).join(", ") || "no roles"}</div>
                </div>
                <button className="btn btn-sm" title="Reset password" onClick={() => resetPassword(m)} disabled={actingId === m.id}><Icon name="shield" size={12}/></button>
                <button className="btn btn-sm" title="Reset launch code" onClick={() => resetCode(m)} disabled={actingId === m.id}><Icon name="refresh" size={12}/></button>
                <button className="btn btn-sm btn-danger" title="Delete member" onClick={() => del(m)} disabled={actingId === m.id}><Icon name="trash" size={12}/></button>
              </div>
            ))}
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
        <label className="field-label" style={{ marginBottom: 8, display: "block" }}>Register a member into this organization</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="field"><label className="field-label">Name</label><input className="input" value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} placeholder="Full name"/></div>
          <div className="field"><label className="field-label">Email</label><input className="input mono" value={f.email} onChange={(e) => setF((p) => ({ ...p, email: e.target.value }))} placeholder="member@org.com"/></div>
        </div>
        <div style={{ marginTop: 8 }}>
          <label className="field-label" style={{ marginBottom: 6, display: "block" }}>Roles</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {roles.map((r) => (
              <button key={r} className={"btn btn-sm " + (f.roles.includes(r) ? "btn-primary" : "")} onClick={() => toggleRole(r)}>{r}</button>
            ))}
          </div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginTop: 10 }}>
          <input type="checkbox" checked={f.withCode} onChange={(e) => setF((p) => ({ ...p, withCode: e.target.checked }))}/> Generate a launch code for this member
        </label>
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <button className="btn btn-primary" onClick={register} disabled={busy}><Icon name="plus" size={13}/> {busy ? "Registering…" : "Register member"}</button>
        </div>
      </div>

      {reveal && <RevealModal {...reveal} onClose={() => setReveal(null)}/>}
    </div>
  );
}

Object.assign(window, { PlatformApp });
