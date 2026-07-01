import React from "react";
import { supabase } from "../api/supabase.js";
// Pilot Ops Admin — Email delivery settings (per organization).
// Each org points Pilot Ops at its own SMTP server or Resend key. Secrets are
// write-only: saved here, never read back (the form shows only whether one is set).
const { useState: esUseState, useEffect: esUseEffect } = React;

const gatewayBaseOf = () => {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  try { return new URL(import.meta.env.VITE_STREAM_URL || origin, origin).origin; } catch { return origin; }
};

function AdminEmailSettingsView() {
  const [provider, setProvider] = esUseState("smtp");
  const [fromName, setFromName] = esUseState("");
  const [fromEmail, setFromEmail] = esUseState("");
  const [host, setHost] = esUseState("");
  const [port, setPort] = esUseState(587);
  const [secure, setSecure] = esUseState(false);
  const [username, setUsername] = esUseState("");
  const [password, setPassword] = esUseState("");
  const [apiKey, setApiKey] = esUseState("");
  const [active, setActive] = esUseState(false);
  const [hasPwd, setHasPwd] = esUseState(false);
  const [hasKey, setHasKey] = esUseState(false);
  const [loading, setLoading] = esUseState(true);
  const [saving, setSaving] = esUseState(false);
  const [testTo, setTestTo] = esUseState("");
  const [testing, setTesting] = esUseState(false);
  const toast = useToast();

  async function load() {
    const { data, error } = await supabase.rpc("get_org_email_settings");
    setLoading(false);
    if (error || !data?.exists) return;
    setProvider(data.provider || "smtp");
    setFromName(data.from_name || "");
    setFromEmail(data.from_email || "");
    setHost(data.smtp_host || "");
    setPort(data.smtp_port || 587);
    setSecure(!!data.smtp_secure);
    setUsername(data.smtp_username || "");
    setActive(!!data.active);
    setHasPwd(!!data.has_smtp_password);
    setHasKey(!!data.has_resend_key);
  }
  esUseEffect(() => { load(); }, []);

  async function save() {
    if (!fromEmail.trim()) { toast({ kind: "warn", title: "From address required", msg: "Enter the address emails are sent from." }); return; }
    setSaving(true);
    const payload = {
      provider, from_name: fromName.trim(), from_email: fromEmail.trim(), active,
      smtp_host: host.trim(), smtp_port: String(port || ""), smtp_secure: secure, smtp_username: username.trim(),
      smtp_password: password,      // blank = keep existing
      resend_api_key: apiKey,       // blank = keep existing
    };
    const { error } = await supabase.rpc("set_org_email_settings", { p: payload });
    setSaving(false);
    if (error) { toast({ kind: "warn", title: "Couldn't save", msg: error.message }); return; }
    setPassword(""); setApiKey("");
    toast({ kind: "success", title: "Email settings saved", msg: active ? "This org will now send via your configured server." : "Saved (delivery is off until you enable it)." });
    load();
  }

  async function sendTest() {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(testTo.trim())) { toast({ kind: "warn", title: "Enter a test email", msg: "Add a recipient to send the test to." }); return; }
    setTesting(true);
    try {
      const token = (await supabase.auth.getSession()).data?.session?.access_token || "";
      const r = await fetch(`${gatewayBaseOf()}/send-test-email`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, to: testTo.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) toast({ kind: "success", title: "Test sent", msg: `Check ${testTo.trim()} (and spam).` });
      else toast({ kind: "warn", title: "Test failed", msg: j.reason || `Error ${r.status}. Save your settings first, and enable delivery.` });
    } catch (e) { toast({ kind: "warn", title: "Gateway unreachable", msg: e.message }); }
    setTesting(false);
  }

  if (loading) return <div className="card"><div className="muted" style={{ padding: 28, textAlign: "center", fontSize: 13 }}>Loading…</div></div>;

  const label = { fontSize: 12, fontWeight: 500, color: "var(--text-2)", display: "block", marginBottom: 5 };
  const row = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--density-gap)", maxWidth: 720 }}>
      <div className="card">
        <div className="card-head">
          <div className="card-title">Email delivery</div>
          <span className={"badge " + (active ? "badge-success" : "")} style={{ marginLeft: "auto" }}>{active ? "Enabled" : "Disabled"}</span>
        </div>
        <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 8, lineHeight: 1.5 }}>
            Mission-start/end notices and post-flight summaries for this organization are sent through the server you configure here. Secrets are stored securely and never shown again.
          </div>

          {/* Provider */}
          <div style={{ marginBottom: 14 }}>
            <span style={label}>Provider</span>
            <div className="row" style={{ gap: 8 }}>
              {[["smtp", "SMTP server"], ["resend", "Resend API"]].map(([v, l]) => (
                <button key={v} className={"btn btn-sm " + (provider === v ? "btn-primary" : "")} onClick={() => setProvider(v)}>{l}</button>
              ))}
            </div>
          </div>

          {/* From */}
          <div style={row}>
            <div><span style={label}>From name</span><input className="input" value={fromName} onChange={e => setFromName(e.target.value)} placeholder="Pilot Ops"/></div>
            <div><span style={label}>From email</span><input className="input" value={fromEmail} onChange={e => setFromEmail(e.target.value)} placeholder="ops@yourdomain.com"/></div>
          </div>

          {provider === "smtp" ? (
            <>
              <div style={row}>
                <div><span style={label}>SMTP host</span><input className="input mono" value={host} onChange={e => setHost(e.target.value)} placeholder="smtp.yourprovider.com"/></div>
                <div>
                  <span style={label}>Port</span>
                  <div className="row" style={{ gap: 8, alignItems: "center" }}>
                    <input className="input mono" type="number" value={port} onChange={e => setPort(+e.target.value)} style={{ width: 100 }}/>
                    <label style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6, color: "var(--text-2)" }}>
                      <input type="checkbox" checked={secure} onChange={e => setSecure(e.target.checked)}/> TLS (465)
                    </label>
                  </div>
                </div>
              </div>
              <div style={row}>
                <div><span style={label}>Username</span><input className="input mono" value={username} onChange={e => setUsername(e.target.value)} placeholder="apikey / user@domain"/></div>
                <div><span style={label}>Password {hasPwd && <span className="muted" style={{ fontWeight: 400 }}>· saved</span>}</span>
                  <input className="input mono" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={hasPwd ? "•••••••• (leave blank to keep)" : "SMTP password"}/></div>
              </div>
            </>
          ) : (
            <div style={{ marginBottom: 14 }}>
              <span style={label}>Resend API key {hasKey && <span className="muted" style={{ fontWeight: 400 }}>· saved</span>}</span>
              <input className="input mono" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={hasKey ? "re_•••••••• (leave blank to keep)" : "re_..."}/>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>From email must be on a domain verified in your Resend account.</div>
            </div>
          )}

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 4 }}>
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)}/>
            <span>Enable email delivery for this organization</span>
          </label>

          <div className="row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
            <button className="btn btn-primary" onClick={save} disabled={saving}><Icon name="check" size={13}/> {saving ? "Saving…" : "Save settings"}</button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Send a test</div></div>
        <div className="card-body">
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>Save your settings first, then send a test email to confirm delivery works.</div>
          <div className="row" style={{ gap: 8 }}>
            <input className="input" value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="you@example.com" style={{ flex: 1 }}/>
            <button className="btn" onClick={sendTest} disabled={testing}><Icon name="send" size={13}/> {testing ? "Sending…" : "Send test"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { AdminEmailSettingsView });
