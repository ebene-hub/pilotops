import React from "react";
import { refresh } from "../store.jsx";
import { getCurrentPosition } from "../api/geo.js";
// Pilot Ops — Admin / stakeholder management
const { useState: adUseState, useEffect: adUseEffect } = React;

function AdminView({ teamRoster, setTeamRoster, fieldConfig, setFieldConfig }) {
  teamRoster = teamRoster || TEAM_ROSTER;
  fieldConfig = fieldConfig || DEFAULT_FIELD_CONFIG;
  const [tab, setTab] = adUseState("Team roster");
  return (
    <div className="main-content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Admin & configuration</h1>
          <div className="page-sub">Team roster · form fields · stakeholders · notification rules · integrations</div>
        </div>
        <div className="page-actions">
          {tab === "Team roster" && <button className="btn btn-primary" onClick={() => setTeamRoster && setTeamRoster([...teamRoster, { id: "TM-" + String(teamRoster.length + 1).padStart(3, "0"), name: "New member", role: "Pilot", initials: "NM", color: "#94a3b8", email: "new@pilotops.io" }])}><Icon name="plus" size={14}/> Add team member</button>}
          {tab === "Stakeholders" && <button className="btn btn-primary"><Icon name="plus" size={14}/> Add stakeholder</button>}
        </div>
      </div>

      <div className="tabs">
        {["Team roster", "Form fields", "Stakeholders", "Roles & permissions", "Notification rules", "Sectors & presets", "API & integrations", "Audit log"].map(t => (
          <button key={t} className={"tab " + (tab === t ? "active" : "")} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === "Team roster" && <TeamRosterTab teamRoster={teamRoster} setTeamRoster={setTeamRoster}/>}
      {tab === "Form fields" && <FormFieldsTab fieldConfig={fieldConfig} setFieldConfig={setFieldConfig}/>}

      {tab === "Stakeholders" && (
        <div className="card">
          <div className="card-head">
            <div className="card-title">All stakeholders</div>
            <span className="muted" style={{ fontSize: 12, marginLeft: 6 }}>{STAKEHOLDERS.length} active</span>
            <div className="search-input" style={{ marginLeft: "auto", width: 220 }}>
              <Icon name="search" size={14}/>
              <span style={{ color: "var(--text-3)" }}>Search…</span>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Name</th><th>Email</th><th>Role</th><th>Notifications</th><th>Last active</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {STAKEHOLDERS.map(s => (
                  <tr key={s.id} className="clickable">
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div className="user-avatar" style={{ width: 30, height: 30, fontSize: 11, background: `linear-gradient(135deg, ${s.avatar}, color-mix(in oklab, ${s.avatar} 70%, #000))` }}>{s.name.split(" ").map(w => w[0]).slice(0, 2).join("")}</div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div>
                          <div className="mono muted" style={{ fontSize: 11 }}>ID-{String(s.id).padStart(4, "0")}</div>
                        </div>
                      </div>
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>{s.email}</td>
                    <td><span className="pill">{s.role}</span></td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        {s.notify.map(n => (
                          <span key={n} className="badge" style={{ fontSize: 10 }}>{n}</span>
                        ))}
                      </div>
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>{["2 min ago", "14 min ago", "1h ago", "3h ago", "yesterday", "2d ago"][s.id - 1]}</td>
                    <td><span className="badge badge-success"><span className="dot"/>Active</span></td>
                    <td>
                      <button className="btn btn-sm btn-ghost"><Icon name="more" size={14}/></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "Roles & permissions" && (
        <div className="grid-2">
          {[
            { name: "Director", desc: "Full read/write on all sectors", count: 2, perms: ["all"] },
            { name: "Safety", desc: "Read flights · read/write incidents", count: 4, perms: ["flights:read", "incidents:rw", "summary:read"] },
            { name: "Command", desc: "Read flights & summaries · approve reports", count: 3, perms: ["flights:read", "reports:approve"] },
            { name: "External", desc: "Receive summaries only", count: 8, perms: ["summary:read"] },
            { name: "Field", desc: "Pilot & ops on assigned missions", count: 12, perms: ["flights:rw:assigned", "incidents:create"] },
            { name: "Legal", desc: "Read audit log & compliance reports", count: 2, perms: ["audit:read", "compliance:read"] },
          ].map(r => (
            <div key={r.name} className="card">
              <div className="card-body" style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                  <Icon name="shield" size={18}/>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{r.name}</div>
                    <span className="pill">{r.count} members</span>
                  </div>
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{r.desc}</div>
                  <div className="row" style={{ flexWrap: "wrap", gap: 4, marginTop: 10 }}>
                    {r.perms.map(p => <span key={p} className="badge mono" style={{ fontSize: 10 }}>{p}</span>)}
                  </div>
                </div>
                <button className="btn btn-sm btn-ghost"><Icon name="settings" size={13}/></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "Notification rules" && (
        <div className="card">
          <div className="card-head">
            <div className="card-title">Notification routing</div>
            <button className="btn btn-sm btn-ghost" style={{ marginLeft: "auto" }}><Icon name="plus" size={12}/> Add rule</button>
          </div>
          <table className="tbl">
            <thead><tr><th>Event</th><th>Audience</th><th>Channels</th><th>Window</th><th></th></tr></thead>
            <tbody>
              {[
                { e: "Flight scheduled", aud: "Director, Safety, Command", ch: ["email", "slack"], w: "T-15min" },
                { e: "Flight in air", aud: "Field, Command", ch: ["app push"], w: "Immediate" },
                { e: "Incident · Critical", aud: "Director, Safety, External", ch: ["sms", "email", "slack"], w: "Immediate" },
                { e: "Incident · High", aud: "Director, Safety", ch: ["email", "slack"], w: "Immediate" },
                { e: "Incident · Medium", aud: "Safety", ch: ["email"], w: "Hourly digest" },
                { e: "Post-flight summary", aud: "Director, Command, Legal", ch: ["email"], w: "On landing" },
                { e: "Weekly rollup", aud: "All stakeholders", ch: ["email"], w: "Mondays 09:00" },
              ].map((r, i) => (
                <tr key={i} className="clickable">
                  <td>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <Icon name={r.e.includes("Critical") ? "warn" : r.e.includes("Incident") ? "pin" : r.e.includes("flight") ? "drone" : "mail"} size={14} stroke={r.e.includes("Critical") ? "var(--danger)" : "var(--text-2)"}/>
                      <strong style={{ fontSize: 13 }}>{r.e}</strong>
                    </div>
                  </td>
                  <td>{r.aud}</td>
                  <td><div className="row" style={{ gap: 4 }}>{r.ch.map(c => <span key={c} className="pill">{c}</span>)}</div></td>
                  <td className="mono" style={{ fontSize: 12 }}>{r.w}</td>
                  <td><button className="btn btn-sm btn-ghost"><Icon name="more" size={14}/></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "Sectors & presets" && (
        <div className="grid-2">
          {Object.entries(SECTORS).map(([key, s]) => (
            <div key={key} className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">{s.label}</div>
                  <div className="mono muted" style={{ fontSize: 11 }}>{key}</div>
                </div>
                {key === "generic" && <span className="badge badge-accent" style={{ marginLeft: "auto" }}>Active preset</span>}
              </div>
              <div className="card-body">
                <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>Incident types</div>
                <div className="row" style={{ flexWrap: "wrap", gap: 4, marginBottom: 14 }}>
                  {s.incidentTypes.map(t => <span key={t} className="pill">{t}</span>)}
                </div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>Sample places</div>
                <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
                  {s.samplePlaces.slice(0, 6).map(t => <span key={t} className="pill mono">{t}</span>)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "API & integrations" && (
        <div className="grid-2">
          {[
            { n: "Slack", d: "Push notifications & livestream alerts to channels", st: "connected", icon: "link" },
            { n: "Microsoft Teams", d: "Mirror Slack rules to Teams", st: "connected", icon: "link" },
            { n: "Salesforce Service Cloud", d: "Sync incidents to cases", st: "disconnected", icon: "pin" },
            { n: "ArcGIS Online", d: "Two-way layer sync for geospatial data", st: "connected", icon: "layers" },
            { n: "AWS S3 archive", d: "Encrypted bucket for recordings & telemetry", st: "connected", icon: "shield" },
            { n: "Twilio SMS", d: "SMS fallback for critical alerts", st: "connected", icon: "send" },
            { n: "PagerDuty", d: "Escalations on critical incidents", st: "disconnected", icon: "warn" },
            { n: "Webhooks", d: "Subscribe to any Pilot Ops event", st: "connected", icon: "link" },
          ].map(c => (
            <div key={c.n} className="card">
              <div className="card-body" style={{ display: "flex", gap: 14, alignItems: "center" }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: c.st === "connected" ? "var(--success-soft)" : "var(--bg-muted)", color: c.st === "connected" ? "var(--success)" : "var(--text-3)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                  <Icon name={c.icon} size={18}/>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{c.n}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{c.d}</div>
                </div>
                <button className={"btn btn-sm " + (c.st === "connected" ? "" : "btn-primary")}>{c.st === "connected" ? "Configure" : "Connect"}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "Audit log" && (
        <div className="card">
          <div className="card-head"><div className="card-title">Recent activity</div></div>
          <div style={{ padding: 8 }}>
            {[
              { a: "A. Mensah", e: "Started flight FL-2240", t: "2 min ago", k: "drone" },
              { a: "Ops Assistant", e: "Flagged INC-0412 · heat anomaly (confidence 0.94)", t: "14 min ago", k: "sparkle" },
              { a: "Ops Director", e: "Approved RPT-2024-Q2-018 for distribution", t: "1h ago", k: "check" },
              { a: "M. Rosselló", e: "Submitted INC-0409 · Critical breach", t: "yesterday", k: "warn" },
              { a: "Safety Lead", e: "Updated notification rule · Incident Critical", t: "yesterday", k: "settings" },
              { a: "System", e: "Nightly model retrain · RMSE 1.84 (-4.1%)", t: "2d ago", k: "refresh" },
            ].map((l, i) => (
              <div key={i} style={{ display: "flex", gap: 12, padding: "10px 12px", borderBottom: i < 5 ? "1px solid var(--border)" : "none", alignItems: "flex-start" }}>
                <div style={{ width: 28, height: 28, borderRadius: 7, background: "var(--bg-muted)", display: "grid", placeItems: "center", color: "var(--text-2)" }}><Icon name={l.k} size={14}/></div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13 }}><strong>{l.a}</strong> <span className="muted">·</span> {l.e}</div>
                  <div className="muted mono" style={{ fontSize: 11, marginTop: 2 }}>{l.t}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Team roster tab ---------- */
function TeamRosterTab({ teamRoster, setTeamRoster }) {
  const [editingId, setEditingId] = adUseState(null);
  const [search, setSearch] = adUseState("");
  const [roleFilter, setRoleFilter] = adUseState("All");
  const [revealCode, setRevealCode] = adUseState(null);
  const toast = useToast ? useToast() : (() => {});

  const update = (id, patch) => setTeamRoster(teamRoster.map(m => m.id === id ? { ...m, ...patch, initials: patch.name ? patch.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase() : m.initials } : m));

  // Persist an edited member to the DB (profile fields + role).
  async function saveEdit(id) {
    const m = teamRoster.find(x => x.id === id);
    setEditingId(null);
    if (!m) return;
    const sb = window.__supabase;
    const { error: e1 } = await sb.from("profiles").update({ full_name: m.name, license: m.license, email: m.email, initials: m.initials }).eq("id", id);
    const { error: e2 } = await sb.rpc("set_member_roles", { p_profile: id, p_roles: [m.role] });
    if (e1 || e2) { toast({ kind: "warn", title: "Save failed", msg: (e1 || e2).message }); return; }
    try { await refresh(); } catch {}
    toast({ kind: "success", title: "Member saved", msg: `${m.name} · ${m.role}` });
  }

  async function remove(id) {
    const m = teamRoster.find(x => x.id === id);
    if (!confirm(`Remove ${m?.name || "this member"} from the team? Their roles are cleared and they lose role-based access.`)) return;
    setTeamRoster(teamRoster.filter(x => x.id !== id));
    await window.__supabase.rpc("set_member_roles", { p_profile: id, p_roles: [] });
    try { await refresh(); } catch {}
    toast({ kind: "info", title: "Member removed", msg: m?.name });
  }

  async function resetCode(id) {
    const m = teamRoster.find(x => x.id === id);
    const newCode = String(Math.floor(100000 + Math.random() * 900000));
    const { error } = await window.__supabase.rpc("set_pilot_code", { p_profile: id, p_code: newCode });
    if (error) { toast({ kind: "warn", title: "Reset failed", msg: error.message }); return; }
    update(id, { hasCode: true });
    setRevealCode({ id, code: newCode });
    toast({ kind: "success", title: "Code reset", msg: `New code for ${m?.name}. Shown once — share securely.` });
  }

  const filtered = teamRoster.filter(m =>
    (roleFilter === "All" || m.role === roleFilter) &&
    (!search || (m.name + m.role + m.id).toLowerCase().includes(search.toLowerCase()))
  );

  const roleCounts = TEAM_ROLES.reduce((acc, r) => {
    acc[r] = teamRoster.filter(m => m.role === r).length;
    return acc;
  }, {});

  return (
    <>
      <div className="card" style={{ marginBottom: "var(--density-gap)" }}>
        <div className="card-body" style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div className="muted" style={{ fontSize: 12 }}>{teamRoster.length} members across {Object.values(roleCounts).filter(c => c > 0).length} roles</div>
          <div className="vdivider" style={{ height: 22 }}/>
          <div className="row" style={{ gap: 6, flexWrap: "wrap", flex: 1 }}>
            {TEAM_ROLES.map(r => (
              <span key={r} className="pill">{r} <span className="mono" style={{ color: "var(--text-3)" }}>· {roleCounts[r] || 0}</span></span>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Team members</div>
          <div className="muted" style={{ marginLeft: 8, fontSize: 12 }}>Pilots select from this roster when starting a mission</div>
          <div style={{ marginLeft: "auto" }} className="row">
            <select className="select" style={{ width: 160, height: 30, fontSize: 12 }} value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
              <option>All</option>
              {TEAM_ROLES.map(r => <option key={r}>{r}</option>)}
            </select>
            <div className="search-input" style={{ width: 200 }}>
              <Icon name="search" size={14}/>
              <input style={{ border: "none", background: "transparent", outline: "none", color: "var(--text)", flex: 1 }} placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}/>
            </div>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr><th>Member</th><th>ID</th><th>Role</th><th>License</th><th>Pilot code</th><th>Email</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map(m => {
                const isEdit = editingId === m.id;
                return (
                  <tr key={m.id}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div className="user-avatar" style={{ width: 30, height: 30, fontSize: 11, background: `linear-gradient(135deg, ${m.color}, color-mix(in oklab, ${m.color} 70%, #000))` }}>{m.initials}</div>
                        {isEdit
                          ? <input className="input" value={m.name} onChange={e => update(m.id, { name: e.target.value })} style={{ width: 200, height: 30 }}/>
                          : <span style={{ fontWeight: 600, fontSize: 13 }}>{m.name}</span>
                        }
                      </div>
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>{m.shortId || "—"}</td>
                    <td>
                      {isEdit
                        ? <select className="select" value={m.role} onChange={e => update(m.id, { role: e.target.value })} style={{ height: 30, fontSize: 12 }}>
                            {TEAM_ROLES.map(r => <option key={r}>{r}</option>)}
                          </select>
                        : <span className="pill">{m.role}</span>
                      }
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {isEdit
                        ? <input className="input mono" value={m.license || ""} placeholder="—" onChange={e => update(m.id, { license: e.target.value })} style={{ width: 140, height: 30, fontSize: 11.5 }}/>
                        : (m.license || <span className="muted">—</span>)
                      }
                    </td>
                    <td>
                      {(/pilot/i.test(m.role) || (m.roles || []).some(r => /pilot/i.test(r))) ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span className="mono" style={{ fontSize: 12, letterSpacing: 2, fontWeight: 600, color: (revealCode?.id === m.id || m.hasCode) ? "var(--text)" : "var(--text-3)" }}>
                            {revealCode?.id === m.id ? revealCode.code : (m.hasCode ? "••••••" : "— not set —")}
                          </span>
                          <button className="btn btn-sm btn-ghost" title={m.hasCode ? "Reset (generate new) code" : "Generate code"}
                            onClick={() => { if (!m.hasCode || confirm(`Reset ${m.name}'s pilot code? The current code will stop working.`)) resetCode(m.id); }}>
                            <Icon name="refresh" size={12}/>
                          </button>
                        </div>
                      ) : (
                        <span className="muted" style={{ fontSize: 11 }}>n/a</span>
                      )}
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {isEdit
                        ? <input className="input mono" value={m.email || ""} onChange={e => update(m.id, { email: e.target.value })} style={{ width: 200, height: 30, fontSize: 11.5 }}/>
                        : m.email
                      }
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        {isEdit
                          ? <button className="btn btn-sm btn-primary" onClick={() => saveEdit(m.id)}><Icon name="check" size={12}/> Save</button>
                          : <>
                              <button className="btn btn-sm btn-ghost" onClick={() => setEditingId(m.id)} title="Edit"><Icon name="settings" size={13}/></button>
                              <button className="btn btn-sm btn-ghost" onClick={() => remove(m.id)} title="Remove"><Icon name="x" size={13}/></button>
                            </>
                        }
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="muted" style={{ padding: 40, textAlign: "center" }}>No members match.</div>}
        </div>
      </div>
    </>
  );
}

/* ---------- Form fields tab ---------- */
function FormFieldsTab({ fieldConfig, setFieldConfig }) {
  const toast = useToast();
  const [saving, setSaving] = adUseState(false);
  // Flight stations (separate `stations` table; pilots pick from this list).
  const [stations, setStations] = adUseState(() => (window.STATIONS || []));
  const [stationModal, setStationModal] = adUseState(false);

  const fields = [
    { key: "coverageArea", label: "Coverage area",   desc: "What pilots enter for mission area", presetEditable: true },
    { key: "purpose",      label: "Mission purpose", desc: "Why the mission is being flown",      presetEditable: true },
  ];

  const setType = (key, type) => setFieldConfig({ ...fieldConfig, [key]: { ...(fieldConfig[key] || {}), type } });
  const setOptions = (key, options) => setFieldConfig({ ...fieldConfig, [key]: { ...(fieldConfig[key] || {}), options } });

  async function save() {
    setSaving(true);
    const sb = window.__supabase;
    const rows = ["coverageArea", "purpose", "flightStation", "uav"].map((k) => ({
      key: k, type: fieldConfig[k]?.type || "dropdown", options: fieldConfig[k]?.options || [],
    }));
    const { error } = await sb.from("form_field_config").upsert(rows, { onConflict: "key" });
    setSaving(false);
    if (error) { toast({ kind: "warn", title: "Save failed", msg: error.message }); return; }
    try { await refresh(); } catch {}
    toast({ kind: "success", title: "Saved", msg: "Pilots will see the updated fields." });
  }

  async function addStation({ name, lat, lng }) {
    const coords = (lat != null && lng != null) ? `${(+lat).toFixed(4)}, ${(+lng).toFixed(4)}` : null;
    const { data, error } = await window.__supabase.from("stations").insert({ name, lat: lat ?? null, lng: lng ?? null, coords }).select().single();
    if (error) { toast({ kind: "warn", title: "Could not add station", msg: error.message }); return; }
    setStations((s) => [...s, { id: data.id, name: data.name, lat: data.lat, lng: data.lng, coords: data.coords }]);
    setStationModal(false);
    try { await refresh(); } catch {}
    toast({ kind: "success", title: "Station added", msg: name });
  }
  async function removeStation(id) {
    const { error } = await window.__supabase.from("stations").delete().eq("id", id);
    if (error) { toast({ kind: "warn", title: "Could not remove", msg: error.message }); return; }
    setStations((s) => s.filter((x) => x.id !== id));
    try { await refresh(); } catch {}
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--density-gap)" }}>
      <div className="card" style={{ background: "var(--accent-soft)", borderColor: "color-mix(in oklab, var(--accent) 25%, transparent)" }}>
        <div className="card-body" style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--accent)", color: "white", display: "grid", placeItems: "center", flexShrink: 0 }}><Icon name="sparkle" size={15}/></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Configure how pilots fill mission fields</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>Each field can be a <strong>dropdown</strong> (pilots pick from a curated list) or <strong>free text</strong>. <strong>Save</strong> to push changes to the pilot form.</div>
          </div>
          <button className="btn btn-primary" onClick={save} disabled={saving}><Icon name="check" size={14}/> {saving ? "Saving…" : "Save changes"}</button>
        </div>
      </div>

      {fields.map(f => {
        const cfg = fieldConfig[f.key] || { type: "text", options: [] };
        return (
          <div key={f.key} className="card">
            <div className="card-head">
              <div>
                <div className="card-title">{f.label}</div>
                <div className="card-sub">{f.desc}</div>
              </div>
              <div className="row" style={{ marginLeft: "auto", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, padding: 2, gap: 0 }}>
                <button className={"btn btn-sm " + (cfg.type === "dropdown" ? "btn-primary" : "btn-ghost")} onClick={() => setType(f.key, "dropdown")} style={{ height: 28 }}>
                  <Icon name="chevDown" size={12}/> Dropdown
                </button>
                <button className={"btn btn-sm " + (cfg.type === "text" ? "btn-primary" : "btn-ghost")} onClick={() => setType(f.key, "text")} style={{ height: 28 }}>
                  <Icon name="doc" size={12}/> Free text
                </button>
              </div>
            </div>
            <div className="card-body">
              {cfg.type === "dropdown" ? (
                <FieldOptionsEditor options={cfg.options || []} onChange={(opts) => setOptions(f.key, opts)}/>
              ) : (
                <div style={{ background: "var(--bg-subtle)", border: "1px dashed var(--border-strong)", borderRadius: 8, padding: 14, textAlign: "center", color: "var(--text-3)", fontSize: 12.5 }}>
                  <Icon name="doc" size={20}/>
                  <div style={{ marginTop: 6 }}>Pilots will type the value freely.</div>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Flight stations — the dropdown pilots pick from on the mission form. */}
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Flight stations</div>
            <div className="card-sub">Launch sites pilots choose from. These feed the "Flight station" field on the pilot's Start mission form.</div>
          </div>
        </div>
        <div className="card-body">
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
            {stations.map((s) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 8 }}>
                <Icon name="pin" size={13} stroke="var(--text-3)"/>
                <span style={{ flex: 1, fontSize: 12.5 }}>{s.name}{s.coords ? <span className="muted mono" style={{ fontSize: 11, marginLeft: 8 }}>{s.coords}</span> : null}</span>
                <button className="iconbtn" style={{ width: 24, height: 24 }} onClick={() => removeStation(s.id)} title="Remove"><Icon name="x" size={12}/></button>
              </div>
            ))}
            {stations.length === 0 && <div className="muted" style={{ fontSize: 12.5, padding: 14, textAlign: "center", border: "1px dashed var(--border)", borderRadius: 8 }}>No stations yet — add the launch sites your pilots use.</div>}
          </div>
          <button className="btn btn-primary" onClick={() => setStationModal(true)}><Icon name="plus" size={13}/> Add station</button>
        </div>
      </div>

      {stationModal && <StationModal onClose={() => setStationModal(false)} onSave={addStation}/>}

      <div className="card">
        <div className="card-head"><div className="card-title">Field preview · what pilots will see</div></div>
        <div className="card-body" style={{ background: "var(--bg-subtle)" }}>
          <div className="grid-2">
            {fields.map(f => {
              const cfg = fieldConfig[f.key] || { type: "text", options: [] };
              return (
                <div key={f.key}>
                  <div className="field-label" style={{ marginBottom: 6 }}>{f.label}</div>
                  {cfg.type === "dropdown" ? (
                    <select className="select"><option>— Select —</option>{(cfg.options || []).map(o => <option key={o}>{o}</option>)}</select>
                  ) : (
                    <input className="input" placeholder={`Type ${f.label.toLowerCase()}…`}/>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Station picker (coords / current location / click map) ---------- */
function StationModal({ onClose, onSave }) {
  const [name, setName] = adUseState("");
  const [lat, setLat] = adUseState("");
  const [lng, setLng] = adUseState("");
  const [locating, setLocating] = adUseState(false);
  const toast = useToast();

  async function useCurrent() {
    setLocating(true);
    try { const p = await getCurrentPosition(); setLat(p.lat.toFixed(6)); setLng(p.lng.toFixed(6)); }
    catch (e) { toast({ kind: "warn", title: "Location unavailable", msg: e.message }); }
    setLocating(false);
  }

  const hasCoords = lat !== "" && lng !== "" && !isNaN(+lat) && !isNaN(+lng);
  const pins = hasCoords ? [{ lat: +lat, lng: +lng, color: "#16a34a", label: name || "Station", size: 7 }] : [];

  return (
    <Modal open onClose={onClose} icon="pin" size="lg" title="Add flight station"
      subtitle="Name the launch site and set its location — type coordinates, use your current location, or click the map."
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!name.trim()}
          onClick={() => onSave({ name: name.trim(), lat: hasCoords ? +lat : null, lng: hasCoords ? +lng : null })}>
          <Icon name="check" size={13}/> Save station
        </button>
      </>}>
      <div className="field" style={{ marginBottom: 12 }}>
        <label className="field-label">Station name <span className="req">*</span></label>
        <input className="input" placeholder="e.g. Hangar Alpha" value={name} onChange={e => setName(e.target.value)} autoFocus/>
      </div>
      <div className="grid-2" style={{ marginBottom: 10 }}>
        <div className="field"><label className="field-label">Latitude</label><input className="input mono" placeholder="12.5000" value={lat} onChange={e => setLat(e.target.value)}/></div>
        <div className="field"><label className="field-label">Longitude</label><input className="input mono" placeholder="9.3000" value={lng} onChange={e => setLng(e.target.value)}/></div>
      </div>
      <button className="btn" onClick={useCurrent} disabled={locating} style={{ marginBottom: 12 }}>
        <Icon name="pin" size={13}/> {locating ? "Locating…" : "Use my current location"}
      </button>
      <MapCanvas basemap="carto" pins={pins} height={300} showLegend={false}
        onPick={(p) => { setLat(p.lat.toFixed(6)); setLng(p.lng.toFixed(6)); }}/>
      <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
        <Icon name="info" size={11} style={{ verticalAlign: "-1px" }}/> Click anywhere on the map to drop the station pin.
      </div>
    </Modal>
  );
}

function FieldOptionsEditor({ options, onChange }) {
  const [draft, setDraft] = adUseState("");
  const add = () => { if (draft.trim()) { onChange([...options, draft.trim()]); setDraft(""); } };
  const remove = (i) => onChange(options.filter((_, x) => x !== i));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= options.length) return;
    const arr = options.slice();
    [arr[i], arr[j]] = [arr[j], arr[i]];
    onChange(arr);
  };

  return (
    <div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Approved options ({options.length})</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
        {options.map((o, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 8 }}>
            <span className="mono muted" style={{ fontSize: 10, width: 18 }}>{i + 1}</span>
            <input className="input" value={o} onChange={e => {
              const arr = options.slice(); arr[i] = e.target.value; onChange(arr);
            }} style={{ flex: 1, height: 28, fontSize: 12.5, padding: "4px 8px" }}/>
            <button className="iconbtn" style={{ width: 24, height: 24 }} onClick={() => move(i, -1)} title="Move up"><Icon name="arrowUp" size={12}/></button>
            <button className="iconbtn" style={{ width: 24, height: 24 }} onClick={() => move(i, 1)} title="Move down"><Icon name="arrowDown" size={12}/></button>
            <button className="iconbtn" style={{ width: 24, height: 24 }} onClick={() => remove(i)} title="Remove"><Icon name="x" size={12}/></button>
          </div>
        ))}
        {options.length === 0 && <div className="muted" style={{ fontSize: 12.5, padding: 14, textAlign: "center", border: "1px dashed var(--border)", borderRadius: 8 }}>No options yet — add one below.</div>}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <input className="input" placeholder="Add an option…" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} style={{ flex: 1 }}/>
        <button className="btn btn-primary" onClick={add}><Icon name="plus" size={13}/> Add</button>
      </div>
    </div>
  );
}

Object.assign(window, { AdminView, TeamRosterTab, FormFieldsTab });
