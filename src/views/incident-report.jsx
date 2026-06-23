import React from "react";
import { supabase } from "../api/supabase.js";
import { getCurrentPosition } from "../api/geo.js";
import { refresh } from "../store.jsx";
// Pilot Ops — Incident reporting form
const { useState: irUseState, useEffect: irUseEffect, useRef: irUseRef } = React;

function IncidentReportView({ basemap, setBasemap }) {
  const [files, setFiles] = irUseState([]);
  const [links, setLinks] = irUseState([]);
  const [linkDraft, setLinkDraft] = irUseState("");
  const incidentTypes = (SECTORS.generic?.incidentTypes || []);
  const [form, setForm] = irUseState({
    type: incidentTypes[0] || "Anomaly", severity: "medium", title: "", desc: "",
    location: "", flight: "", lat: null, lng: null,
  });
  const [busy, setBusy] = irUseState(false);
  const [incidentId, setIncidentId] = irUseState(() => "INC-" + Date.now().toString().slice(-6));
  const fileInput = irUseRef(null);
  const toast = useToast();
  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Default the pin to the reporter's real location (best effort).
  irUseEffect(() => {
    let cancelled = false;
    getCurrentPosition()
      .then((p) => { if (!cancelled) setForm(f => ({ ...f, lat: p.lat, lng: p.lng, location: f.location || `${p.lat.toFixed(5)}°, ${p.lng.toFixed(5)}°` })); })
      .catch(() => { /* user can pin on the map / type manually */ });
    return () => { cancelled = true; };
  }, []);

  // ---- Media attachments ----
  const fmtBytes = (n) => n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(0) + " KB" : (n / 1048576).toFixed(1) + " MB";
  const addFiles = (list) => {
    const picked = Array.from(list || []);
    if (!picked.length) return;
    setFiles((prev) => [...prev, ...picked.map((file) => ({
      id: file.name + ":" + file.size + ":" + file.lastModified,
      name: file.name, size: fmtBytes(file.size),
      kind: file.type.startsWith("video") ? "video" : file.type.startsWith("audio") ? "audio" : "image",
      url: file.type.startsWith("image") ? URL.createObjectURL(file) : null,
      file,
    }))]);
  };
  const removeFile = (id) => setFiles((prev) => {
    const f = prev.find((x) => x.id === id); if (f?.url) URL.revokeObjectURL(f.url);
    return prev.filter((x) => x.id !== id);
  });
  async function uploadFiles() {
    const paths = [];
    for (const f of files) {
      if (!f.file) continue;
      const safe = f.file.name.replace(/[^\w.\-]+/g, "_");
      const path = `incidents/${incidentId}/${Date.now()}-${safe}`;
      const { error } = await supabase.storage.from("media").upload(path, f.file, { upsert: true, contentType: f.file.type || undefined });
      if (!error) paths.push(path); else toast({ kind: "warn", title: "Attachment failed", msg: `${f.name}: ${error.message}` });
    }
    return paths;
  }

  // Parse "lat, lng" (with or without ° symbols) typed into the Location field
  // so the map pin follows manual entry, not just map clicks.
  const parseCoords = (text) => {
    const nums = (String(text).match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    if (nums.length >= 2 && nums[0] >= -90 && nums[0] <= 90 && nums[1] >= -180 && nums[1] <= 180) {
      return { lat: nums[0], lng: nums[1] };
    }
    return null;
  };
  const onLocation = (v) => {
    const c = parseCoords(v);
    setForm(f => ({ ...f, location: v, ...(c ? { lat: c.lat, lng: c.lng } : {}) }));
  };

  const canLog = !window.hasPerm || window.hasPerm("incident.create");
  async function persist(status) {
    if (!canLog) { toast({ kind: "warn", title: "No permission", msg: "Your role can't log incidents." }); return; }
    if (status === "open" && !form.title.trim()) { toast({ kind: "warn", title: "Add a title", msg: "Describe the incident before submitting." }); return; }
    setBusy(true);
    const media = await uploadFiles();
    const allFlights = (ACTIVE_FLIGHTS || []).concat(RECENT_FLIGHTS || []);
    const flightDbId = allFlights.find(f => f.id === form.flight)?.dbId || null;
    const { error } = await supabase.from("incidents").insert({
      code: incidentId, flight_id: flightDbId, type: form.type, severity: form.severity,
      place: form.location || form.title || form.type, lat: form.lat, lng: form.lng,
      reporter_id: window.__poUser?.id || null, status,
      description: (form.title.trim() || "(draft)") + (form.desc ? " — " + form.desc : ""),
      visualize: { links, media },
    });
    setBusy(false);
    if (error) { toast({ kind: "warn", title: status === "draft" ? "Could not save draft" : "Could not log incident", msg: error.message }); return; }
    if (status === "open") await supabase.from("notifications").insert({ type: "incident", payload: { incident: incidentId, severity: form.severity }, recipients: [] });
    try { await refresh(); } catch {}
    toast({ kind: "success", title: status === "draft" ? "Draft saved" : "Incident logged", msg: `${incidentId} ${status === "draft" ? "saved as draft" : "recorded"}.` });
    files.forEach((f) => f.url && URL.revokeObjectURL(f.url));
    setFiles([]); setLinks([]);
    setForm(f => ({ ...f, title: "", desc: "" }));
    setIncidentId("INC-" + Date.now().toString().slice(-6));
  }
  const submit = () => persist("open");
  const saveDraft = () => persist("draft");

  return (
    <div className="main-content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Log an incident</h1>
          <div className="page-sub">Capture observations · saved to the incident log (Admin console → Safety → Incident log)</div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={saveDraft} disabled={busy || !canLog}>Save draft</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !canLog} title={canLog ? "" : "Your role can't log incidents"}><Icon name="send" size={14}/> {busy ? "Submitting…" : "Submit incident"}</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: "var(--density-gap)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--density-gap)" }}>
          {/* Basics */}
          <div className="card">
            <div className="card-head">
              <div className="card-title">Incident details</div>
              <span className="badge mono" style={{ marginLeft: "auto" }}>{incidentId}</span>
            </div>
            <div className="card-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div className="field">
                <label className="field-label">Type <span className="req">*</span></label>
                <select className="select" value={form.type} onChange={e => update("type", e.target.value)}>
                  {incidentTypes.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="field-label">Severity <span className="req">*</span></label>
                <div className="row" style={{ gap: 4 }}>
                  {[
                    { k: "low", c: "var(--success)" },
                    { k: "medium", c: "var(--warning)" },
                    { k: "high", c: "var(--danger)" },
                    { k: "critical", c: "#b91c1c" }
                  ].map(s => (
                    <button key={s.k} className="btn btn-sm" onClick={() => update("severity", s.k)}
                            style={{ flex: 1, background: form.severity === s.k ? s.c : "", color: form.severity === s.k ? "white" : "", borderColor: form.severity === s.k ? s.c : "" }}>
                      {s.k[0].toUpperCase() + s.k.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label className="field-label">Title <span className="req">*</span></label>
                <input className="input" value={form.title} onChange={e => update("title", e.target.value)}/>
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label className="field-label">Description</label>
                <textarea className="textarea" rows={4} placeholder="What did you observe? Include time, conditions, and any actions taken." value={form.desc} onChange={e => update("desc", e.target.value)}/>
              </div>
              <div className="field">
                <label className="field-label">Location <span className="req">*</span></label>
                <input className="input mono" value={form.location} onChange={e => onLocation(e.target.value)} placeholder="e.g. 6.43250, 3.42150"/>
                <div className="field-hint">Type coordinates or drop the pin on the map →</div>
              </div>
              <div className="field">
                <label className="field-label">Related flight</label>
                <select className="select" value={form.flight} onChange={e => update("flight", e.target.value)}>
                  <option value="">— None —</option>
                  {ACTIVE_FLIGHTS.concat(RECENT_FLIGHTS).slice(0, 8).map(f => (
                    <option key={f.id} value={f.id}>{f.id} · {f.area || ("Flight " + f.id)}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Media uploads */}
          <div className="card">
            <div className="card-head">
              <div className="card-title">Media</div>
              <div className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{files.length} attached</div>
              <button className="btn btn-sm btn-ghost" style={{ marginLeft: "auto" }} onClick={() => fileInput.current?.click()}><Icon name="upload" size={12}/> Browse</button>
              <input ref={fileInput} type="file" multiple accept="image/*,video/*,audio/*" style={{ display: "none" }}
                     onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}/>
            </div>
            <div className="card-body">
              {/* Dropzone */}
              <div onClick={() => fileInput.current?.click()}
                   onDragOver={(e) => e.preventDefault()}
                   onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
                   style={{ border: "2px dashed var(--border-strong)", borderRadius: 12, padding: 24, textAlign: "center", background: "var(--bg-subtle)", marginBottom: 14, cursor: "pointer" }}>
                <Icon name="upload" size={24} stroke="var(--text-3)"/>
                <div style={{ fontWeight: 500, marginTop: 8 }}>Drop photos, videos or audio here</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>or click to browse · JPG · PNG · MP4 · MOV · WAV</div>
              </div>

              {/* File grid */}
              {files.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
                  {files.map(f => (
                    <div key={f.id} style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
                      <div style={{ aspectRatio: "4/3", background: "var(--bg-muted)", position: "relative", display: "grid", placeItems: "center" }}>
                        {f.url
                          ? <img src={f.url} alt={f.name} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}/>
                          : <Icon name={f.kind === "video" ? "play" : "doc"} size={20} stroke="var(--text-3)"/>}
                        <button className="iconbtn" style={{ position: "absolute", top: 4, right: 4, width: 22, height: 22, background: "rgba(0,0,0,0.4)", color: "white" }} onClick={() => removeFile(f.id)}>
                          <Icon name="x" size={10}/>
                        </button>
                      </div>
                      <div style={{ padding: "6px 8px" }}>
                        <div className="mono" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                        <div className="muted" style={{ fontSize: 10 }}>{f.size}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Links */}
              <div className="field-label" style={{ marginBottom: 8 }}>External links</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                {links.map((l, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 10px", background: "var(--bg-subtle)", borderRadius: 8, border: "1px solid var(--border)" }}>
                    <Icon name="link" size={13} stroke="var(--text-3)"/>
                    <span className="mono" style={{ fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l}</span>
                    <button className="iconbtn" style={{ width: 22, height: 22 }} onClick={() => setLinks(links.filter((_, x) => x !== i))}><Icon name="x" size={10}/></button>
                  </div>
                ))}
              </div>
              <div className="row" style={{ gap: 6 }}>
                <input className="input" placeholder="Paste a URL (recording, doc, ticket)…" value={linkDraft} onChange={e => setLinkDraft(e.target.value)} style={{ flex: 1 }}/>
                <button className="btn" onClick={() => { if (linkDraft.trim()) { setLinks([...links, linkDraft.trim()]); setLinkDraft(""); } }}>Add</button>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--density-gap)" }}>
          <div className="card" style={{ padding: 0 }}>
            <div className="card-head">
              <div className="card-title">Pin location</div>
              <span className="muted" style={{ marginLeft: "auto", fontSize: 11 }}>Click the map to place the pin</span>
            </div>
            <MapCanvas basemap={basemap}
              onPick={(c) => setForm(f => ({ ...f, lat: c.lat, lng: c.lng, location: `${c.lat.toFixed(5)}°, ${c.lng.toFixed(5)}°` }))}
              pins={(form.lat != null && form.lng != null)
                ? [{ lat: form.lat, lng: form.lng, color: "var(--danger)", label: form.title.slice(0, 18) || "Incident", kind: "incident" }]
                : []}
              height={240} showLegend={false}/>
          </div>

          <div className="card">
            <div className="card-head"><div className="card-title">Notify on submit</div></div>
            <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {STAKEHOLDERS.filter(s => s.notify.includes("incidents")).map(s => (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
                  <div className="user-avatar" style={{ width: 24, height: 24, fontSize: 10, background: `linear-gradient(135deg, ${s.avatar}, color-mix(in oklab, ${s.avatar} 70%, #000))` }}>{s.name.split(" ").map(w => w[0]).slice(0, 2).join("")}</div>
                  <div style={{ fontSize: 12 }}>{s.name}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { IncidentReportView });
