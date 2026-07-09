import React from "react";
// Pilot Ops — Pilot logbook & currency tracking
const { useState: lbUseState, useMemo: lbUseMemo } = React;

// Logbook entries & currencies are loaded from the DB by the store (bare
// LOGBOOK_ENTRIES / CURRENCIES resolve to those real globals at render). They
// start empty until a pilot logs flights — no dummy data.
const ACHIEVEMENTS = [];

// Raw flight-controller logs a pilot can attach to a manual entry — for flights
// flown from another controller Pilot Ops never auto-logged. Stored in the
// private `media` bucket; the entry row references it (migration 0034).
const LOG_EXT = [".bin", ".log", ".tlog", ".ulg"]; // ArduPilot .bin/.log, MAVLink .tlog, PX4 .ulg
const LOG_MAX_MB = 60;
const fmtSize = (b) => (!b ? "" : b < 1e6 ? (b / 1e3).toFixed(0) + " KB" : (b / 1e6).toFixed(1) + " MB");

async function downloadEntryLog(entry, toast) {
  if (!entry?.logPath) return;
  const { data, error } = await window.__supabase.storage.from("media").createSignedUrl(entry.logPath, 3600, { download: entry.logName || "flight.bin" });
  if (error || !data?.signedUrl) { toast({ kind: "warn", title: "Download failed", msg: error?.message || "Could not fetch the log." }); return; }
  const a = document.createElement("a"); a.href = data.signedUrl; a.download = entry.logName || "flight.bin";
  document.body.appendChild(a); a.click(); a.remove();
}

function LogbookView({ accent }) {
  const me = PILOTS.find(p => p.id === window.__poUser?.id) || PILOTS[0] || { name: window.__poUser?.name || "—", initials: window.__poUser?.initials || "—", color: "#2563eb", hours: 0, license: "" };
  const [range, setRange] = lbUseState("30");
  const [search, setSearch] = lbUseState("");
  const [entries, setEntries] = lbUseState(LOGBOOK_ENTRIES);
  const [addOpen, setAddOpen] = lbUseState(false);
  const [entryDetail, setEntryDetail] = lbUseState(null);
  const [form, setForm] = lbUseState(() => ({
    date: new Date().toISOString().slice(0, 10), time: "12:00",
    aircraft: (typeof UAVS !== "undefined" && UAVS[0]?.id) || "", role: "PIC",
    duration: 30, night: 0, bvlos: 0, ldgs: 1, area: "", notes: "",
  }));
  const [logFile, setLogFile] = lbUseState(null);
  const [uploading, setUploading] = lbUseState(false);
  const toast = useToast();
  const setF = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const closeAdd = () => { if (!uploading) { setAddOpen(false); setLogFile(null); } };

  // Per-pilot filter — defaults to the signed-in pilot if they have entries.
  const pilots = lbUseMemo(() => [...new Set(entries.map(e => e.pilotName).filter(Boolean))].sort(), [entries]);
  const [pilotSel, setPilotSel] = lbUseState(
    (window.__poUser?.name && entries.some(e => e.pilotName === window.__poUser.name)) ? window.__poUser.name : "all"
  );

  // Pilot-scoped set drives the table, KPIs and charts.
  const scoped = lbUseMemo(
    () => (pilotSel === "all" ? entries : entries.filter(e => e.pilotName === pilotSel)),
    [entries, pilotSel]
  );

  const filtered = lbUseMemo(() => scoped.filter(e => {
    if (search) {
      const hay = (e.flightCode + " " + e.aircraft + " " + e.model + " " + e.area + " " + e.role).toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  }), [scoped, search]);

  const totals = lbUseMemo(() => {
    const monthCut = new Date(); monthCut.setDate(1); monthCut.setHours(0, 0, 0, 0);
    const cut90 = Date.now() - 90 * 86400000;
    const inMonth = scoped.filter(e => e.date && new Date(e.date) >= monthCut);
    const in90 = scoped.filter(e => e.date && new Date(e.date).getTime() >= cut90);
    return {
      hours: scoped.reduce((s, e) => s + e.duration, 0) / 60,
      flights: scoped.length,
      night: scoped.reduce((s, e) => s + e.night, 0) / 60,
      bvlos: scoped.reduce((s, e) => s + e.bvlos, 0) / 60,
      ldgs: scoped.reduce((s, e) => s + e.ldgs, 0),
      monthHours: inMonth.reduce((s, e) => s + e.duration, 0) / 60,
      monthFlights: inMonth.length,
      night90: in90.reduce((s, e) => s + e.night, 0) / 60,
      night90Flights: in90.filter(e => e.night > 0).length,
    };
  }, [scoped]);

  // Last 12 months — real hours by month.
  const monthly = lbUseMemo(() => {
    const N = 12, now = new Date();
    const buckets = Array.from({ length: N }, (_, k) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (N - 1 - k), 1);
      return { y: d.getFullYear(), m: d.getMonth(), label: d.toLocaleDateString(undefined, { month: "short" }), day: 0, night: 0 };
    });
    scoped.forEach(e => {
      if (!e.date) return;
      const d = new Date(e.date);
      const b = buckets.find(x => x.y === d.getFullYear() && x.m === d.getMonth());
      if (b) { b.day += (e.day || 0) / 60; b.night += (e.night || 0) / 60; }
    });
    return buckets.map(b => ({ label: b.label, day: Math.round(b.day * 10) / 10, night: Math.round(b.night * 10) / 10 }));
  }, [scoped]);

  const maxMonth = Math.max(1, ...monthly.map(m => m.day + m.night));

  // Mini calendar heatmap — last 91 days, real.
  const calendar = lbUseMemo(() => {
    const days = [];
    const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - 90);
    for (let i = 0; i < 91; i++) {
      const date = new Date(start); date.setDate(start.getDate() + i);
      const key = date.toISOString().slice(0, 10);
      const minutes = scoped.filter(e => e.date && String(e.date).slice(0, 10) === key).reduce((s, e) => s + e.duration, 0);
      days.push({ date, minutes });
    }
    return days;
  }, [scoped]);

  function exportCSV() {
    const rows = [["Date", "Aircraft", "Model", "Area", "Role", "Duration (min)", "Night", "BVLOS"]];
    for (const e of filtered) rows.push([e.date, e.aircraft, e.model, e.area, e.role, e.duration, e.night > 0 ? "yes" : "no", e.bvlos > 0 ? "yes" : "no"]);
    const csv = rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `logbook-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    toast({ kind: "success", title: "Exported", msg: `${filtered.length} entries → CSV` });
  }

  async function addEntry() {
    const sb = window.__supabase;
    const uid = window.__poUser?.id || null;
    if (!uid) { toast({ kind: "warn", title: "Not signed in", msg: "Sign in again and retry." }); return; }
    const dur = Number(form.duration);
    if (!form.date || !(dur > 0)) { toast({ kind: "warn", title: "Missing details", msg: "Enter a date and a duration (min)." }); return; }

    // Optionally attach a raw flight-controller log (.bin etc.) to this entry.
    let logPath = null, logName = null, logSize = null;
    if (logFile) {
      if (!LOG_EXT.some((x) => logFile.name.toLowerCase().endsWith(x))) {
        toast({ kind: "warn", title: "Unsupported file", msg: `Upload a flight log (${LOG_EXT.join(", ")}).` }); return;
      }
      if (logFile.size > LOG_MAX_MB * 1e6) {
        toast({ kind: "warn", title: "File too large", msg: `Logs must be under ${LOG_MAX_MB} MB.` }); return;
      }
      setUploading(true);
      const safe = logFile.name.replace(/[^\w.\-]/g, "_");
      const path = `${uid}/logs/${Date.now()}_${safe}`;
      const up = await sb.storage.from("media").upload(path, logFile, { upsert: false, contentType: "application/octet-stream" });
      if (up.error) { setUploading(false); toast({ kind: "warn", title: "Upload failed", msg: up.error.message }); return; }
      logPath = path; logName = logFile.name; logSize = logFile.size;
    }

    const night = Number(form.night) > 0, bvlos = Number(form.bvlos) > 0;
    const { data, error } = await sb.from("logbook_entries").insert({
      pilot_id: uid, date: form.date, aircraft_type: form.aircraft, conditions: "Manual",
      duration_min: dur, night, bvlos, notes: form.area || form.notes || null,
      log_path: logPath, log_name: logName, log_size: logSize,
    }).select().single();
    setUploading(false);
    if (error) {
      if (logPath) sb.storage.from("media").remove([logPath]).catch(() => {}); // don't orphan the file
      toast({ kind: "warn", title: "Save failed", msg: error.message }); return;
    }

    setEntries(prev => [{
      id: data.id, flightCode: "—", flightId: null, pilotId: uid, pilotName: window.__poUser?.name || "—",
      date: form.date, time: form.time || "", aircraft: form.aircraft, model: form.aircraft,
      area: form.area || form.notes || "", role: form.role, duration: dur,
      day: night ? 0 : dur, night: night ? dur : 0, bvlos: bvlos ? dur : 0, vlos: bvlos ? 0 : dur,
      ldgs: Number(form.ldgs) || 1, mode: "Manual", notes: form.notes,
      logPath, logName, logSize,
    }, ...prev]);
    setAddOpen(false); setLogFile(null);
    toast({ kind: "success", title: "Entry logged", msg: logName ? `${dur} min · log “${logName}” attached` : `${dur} min on ${form.aircraft}` });
  }

  return (
    <div className="main-content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Pilot logbook</h1>
          <div className="page-sub">
            <span className="user-avatar" style={{ width: 22, height: 22, fontSize: 10, background: `linear-gradient(135deg, ${me.color}, color-mix(in oklab, ${me.color} 70%, #000))`, verticalAlign: "-6px", marginRight: 6 }}>{me.initials}</span>
            {me.name} · {me.license} · {me.missions} lifetime flights
          </div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={exportCSV}><Icon name="download" size={14}/> Export CSV</button>
          <button className="btn"><Icon name="reports" size={14}/> Print logbook</button>
          <button className="btn btn-primary" onClick={() => setAddOpen(true)}><Icon name="plus" size={14}/> Log flight</button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid-4" style={{ marginBottom: "var(--density-gap)" }}>
        <KpiTile label="Total flight hours" value={totals.hours.toFixed(1)} unit="hr" delta={`${totals.flights} flights`} trend="up" spark={Array(8).fill(totals.hours)}/>
        <KpiTile label="This month"        value={totals.monthHours.toFixed(1)} unit="hr" delta={`${totals.monthFlights} flights`} trend="up" spark={Array(8).fill(totals.monthHours)} color="var(--success)"/>
        <KpiTile label="Night ops (90d)"   value={totals.night90.toFixed(1)} unit="hr" delta={`${totals.night90Flights} flights`} trend="up" spark={Array(8).fill(totals.night90)} color="#1e3a8a"/>
        <KpiTile label="BVLOS hours"        value={totals.bvlos.toFixed(1)} unit="hr" trend="up" spark={Array(8).fill(totals.bvlos)} color="#7c3aed"/>
      </div>

      {/* Currency / compliance */}
      <div className="card" style={{ marginBottom: "var(--density-gap)" }}>
        <div className="card-head">
          <div className="card-title">Currency & compliance</div>
          <div className="muted" style={{ fontSize: 12 }}>2 items need attention</div>
        </div>
        <div className="card-body" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {CURRENCIES.map(c => {
            const tone = c.status === "valid" ? "var(--success)" : c.status === "warn" ? "var(--warning)" : "var(--danger)";
            return (
              <div key={c.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 14, background: "var(--surface)", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 4, background: tone, marginTop: 5, flexShrink: 0 }}/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{c.kind}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{c.label}</div>
                  </div>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.5 }}>{c.note}</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                  <span className="mono" style={{ fontSize: 11.5, color: "var(--text-2)" }}>
                    {c.expires !== "—" ? "Expires " + c.expires : "Rolling"}
                  </span>
                  {c.days > 0 && (
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: tone }}>
                      {c.days < 30 ? `${c.days} days` : `${Math.round(c.days/30)} mo`}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.55fr 1fr", gap: "var(--density-gap)", marginBottom: "var(--density-gap)" }}>
        {/* Monthly hours chart */}
        <div className="card">
          <div className="card-head">
            <div className="card-title">Hours flown — last 12 months</div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 12, fontSize: 11.5 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, background: "var(--accent)", borderRadius: 2 }}/> Day</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, background: "#1e3a8a", borderRadius: 2 }}/> Night</span>
            </div>
          </div>
          <div className="card-body">
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${monthly.length}, 1fr)`, alignItems: "end", gap: 8, height: 200 }}>
              {monthly.map(m => (
                <div key={m.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <div style={{ width: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", height: 168 }}>
                    <div title={`${m.night} hr night`} style={{ background: "#1e3a8a", height: `${(m.night / maxMonth) * 100}%`, borderRadius: "3px 3px 0 0" }}/>
                    <div title={`${m.day} hr day`} style={{ background: "var(--accent)", height: `${(m.day / maxMonth) * 100}%`, borderRadius: m.night > 0 ? 0 : "3px 3px 0 0" }}/>
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{m.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Achievements + heatmap */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--density-gap)" }}>
          <div className="card">
            <div className="card-head">
              <div className="card-title">Activity — last 90 days</div>
            </div>
            <div className="card-body">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(13, 1fr)", gap: 3 }}>
                {calendar.map((d, i) => {
                  const intensity = d.minutes === 0 ? 0 : d.minutes < 30 ? 1 : d.minutes < 60 ? 2 : 3;
                  const colors = ["var(--bg-muted)", "color-mix(in oklab, var(--accent) 25%, var(--bg-muted))", "color-mix(in oklab, var(--accent) 55%, var(--bg-muted))", "var(--accent)"];
                  return <div key={i} title={`${d.date.toISOString().slice(0,10)}: ${d.minutes} min`} style={{ width: "100%", aspectRatio: "1", borderRadius: 3, background: colors[intensity] }}/>;
                })}
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, fontSize: 11, color: "var(--text-3)" }}>
                <span>Less</span>
                <div style={{ display: "flex", gap: 3 }}>
                  {[0,1,2,3].map(i => <div key={i} style={{ width: 11, height: 11, borderRadius: 2, background: ["var(--bg-muted)", "color-mix(in oklab, var(--accent) 25%, var(--bg-muted))", "color-mix(in oklab, var(--accent) 55%, var(--bg-muted))", "var(--accent)"][i] }}/>)}
                </div>
                <span>More</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><div className="card-title">Milestones</div></div>
            <div style={{ padding: 8 }}>
              {ACHIEVEMENTS.map(a => (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px" }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: `color-mix(in oklab, ${a.color} 15%, transparent)`, color: a.color, display: "grid", placeItems: "center" }}>
                    <Icon name={a.icon} size={15}/>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 500 }}>{a.label}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{a.date}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Logbook entries table */}
      <div className="card">
        <div className="card-head" style={{ gap: 12, flexWrap: "wrap" }}>
          <div className="card-title">Logbook entries <span className="muted" style={{ fontWeight: 400 }}>({filtered.length})</span></div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <div className="search-input" style={{ width: 220, height: 32 }}>
              <Icon name="search" size={13}/>
              <input value={search} onChange={e => setSearch(e.target.value)}
                     placeholder="Search aircraft, area, ID…"
                     style={{ flex: 1, border: "none", background: "transparent", outline: "none", color: "var(--text)", fontSize: 12.5 }}/>
            </div>
            <select className="select" value={pilotSel} onChange={e => setPilotSel(e.target.value)} style={{ width: 150, height: 32, fontSize: 12.5 }}>
              <option value="all">All pilots</option>
              {pilots.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select className="select" value={range} onChange={e => setRange(e.target.value)} style={{ width: 130, height: 32, fontSize: 12.5 }}>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="365">Last year</option>
              <option value="all">All time</option>
            </select>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Flight ID</th>
                <th>Aircraft</th>
                <th>Area</th>
                <th>Role</th>
                <th style={{ textAlign: "right" }}>Total</th>
                <th style={{ textAlign: "right" }}>Day</th>
                <th style={{ textAlign: "right" }}>Night</th>
                <th style={{ textAlign: "right" }}>BVLOS</th>
                <th style={{ textAlign: "right" }}>Ldgs</th>
                <th>Mode</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id} className="clickable" onClick={() => setEntryDetail(e)}>
                  <td className="mono" style={{ fontSize: 12 }}>{e.date} <span className="muted">· {e.time}</span></td>
                  <td className="mono" style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)" }}>{e.flightCode}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{e.aircraft}<div className="muted" style={{ fontSize: 10.5, fontFamily: "var(--font-sans)" }}>{e.model}</div></td>
                  <td style={{ fontSize: 12.5 }}>{e.area}</td>
                  <td>
                    <span className="badge" style={{ background: e.role === "PIC" ? "var(--accent-soft)" : "var(--bg-muted)", color: e.role === "PIC" ? "var(--accent)" : "var(--text-2)" }}>{e.role}</span>
                  </td>
                  <td className="mono tabular" style={{ textAlign: "right", fontWeight: 600 }}>{e.duration.toFixed(1)}m</td>
                  <td className="mono tabular muted" style={{ textAlign: "right" }}>{e.day > 0 ? e.day.toFixed(1) : "—"}</td>
                  <td className="mono tabular muted" style={{ textAlign: "right" }}>{e.night > 0 ? e.night.toFixed(1) : "—"}</td>
                  <td className="mono tabular muted" style={{ textAlign: "right" }}>{e.bvlos > 0 ? e.bvlos.toFixed(1) : "—"}</td>
                  <td className="mono tabular muted" style={{ textAlign: "right" }}>{e.ldgs}</td>
                  <td style={{ fontSize: 12, color: "var(--text-2)" }}>{e.mode}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: "var(--bg-subtle)", fontWeight: 600 }}>
                <td colSpan="5" style={{ fontSize: 12, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Totals ({filtered.length} flights)</td>
                <td className="mono tabular" style={{ textAlign: "right" }}>{filtered.reduce((s, e) => s + e.duration, 0).toFixed(0)}m</td>
                <td className="mono tabular" style={{ textAlign: "right" }}>{filtered.reduce((s, e) => s + e.day, 0).toFixed(0)}m</td>
                <td className="mono tabular" style={{ textAlign: "right" }}>{filtered.reduce((s, e) => s + e.night, 0).toFixed(0)}m</td>
                <td className="mono tabular" style={{ textAlign: "right" }}>{filtered.reduce((s, e) => s + e.bvlos, 0).toFixed(0)}m</td>
                <td className="mono tabular" style={{ textAlign: "right" }}>{filtered.reduce((s, e) => s + e.ldgs, 0)}</td>
                <td/>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Add entry modal */}
      {addOpen && (
        <Modal open onClose={closeAdd} title="Log flight entry" subtitle="Manual entry — e.g. a flight flown from another controller" icon="plus"
               footer={
                 <>
                   <button className="btn" onClick={closeAdd} disabled={uploading}>Cancel</button>
                   <button className="btn btn-primary" onClick={addEntry} disabled={uploading}>
                     {uploading ? <><span className="loading-spin"/> Uploading…</> : <><Icon name="check" size={14}/> Log entry</>}
                   </button>
                 </>
               }>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field"><label className="field-label">Date</label><input className="input" type="date" value={form.date} onChange={e => setF("date", e.target.value)}/></div>
            <div className="field"><label className="field-label">Start time</label><input className="input" type="time" value={form.time} onChange={e => setF("time", e.target.value)}/></div>
            <div className="field"><label className="field-label">Aircraft</label>
              {typeof UAVS !== "undefined" && UAVS.length ? (
                <select className="select" value={form.aircraft} onChange={e => setF("aircraft", e.target.value)}>
                  {UAVS.map(u => <option key={u.id} value={u.id}>{u.id} — {u.model}</option>)}
                </select>
              ) : (
                <input className="input" value={form.aircraft} onChange={e => setF("aircraft", e.target.value)} placeholder="Type / registration"/>
              )}
            </div>
            <div className="field"><label className="field-label">Role</label>
              <select className="select" value={form.role} onChange={e => setF("role", e.target.value)}><option>PIC</option><option>Co-pilot</option><option>Observer</option><option>Trainee</option></select>
            </div>
            <div className="field" style={{ gridColumn: "span 2" }}><label className="field-label">Coverage area</label><input className="input" value={form.area} onChange={e => setF("area", e.target.value)} placeholder="e.g. North Perimeter"/></div>
            <div className="field"><label className="field-label">Total duration (min)</label><input className="input" type="number" min="0" value={form.duration} onChange={e => setF("duration", e.target.value)}/></div>
            <div className="field"><label className="field-label">Of which: night (min)</label><input className="input" type="number" min="0" value={form.night} onChange={e => setF("night", e.target.value)}/></div>
            <div className="field"><label className="field-label">BVLOS (min)</label><input className="input" type="number" min="0" value={form.bvlos} onChange={e => setF("bvlos", e.target.value)}/></div>
            <div className="field"><label className="field-label">Landings</label><input className="input" type="number" min="0" value={form.ldgs} onChange={e => setF("ldgs", e.target.value)}/></div>
            <div className="field" style={{ gridColumn: "span 2" }}><label className="field-label">Notes</label><textarea className="input" rows="2" value={form.notes} onChange={e => setF("notes", e.target.value)} placeholder="Optional — conditions, anomalies, training focus…"/></div>

            {/* Flight-log attachment (.bin from another controller) */}
            <div className="field" style={{ gridColumn: "span 2" }}>
              <label className="field-label">Flight log <span className="muted" style={{ fontWeight: 400 }}>· optional ({LOG_EXT.join(", ")}, max {LOG_MAX_MB} MB)</span></label>
              {logFile ? (
                <div className="row" style={{ gap: 8, alignItems: "center", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}>
                  <Icon name="reports" size={14}/>
                  <span className="mono" style={{ fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{logFile.name}</span>
                  <span className="muted" style={{ fontSize: 11.5 }}>{fmtSize(logFile.size)}</span>
                  <button className="btn btn-sm" onClick={() => setLogFile(null)} disabled={uploading}><Icon name="close" size={12}/></button>
                </div>
              ) : (
                <label className="btn" style={{ cursor: "pointer", display: "inline-flex" }}>
                  <Icon name="upload" size={14}/> Choose log file
                  <input type="file" accept={LOG_EXT.join(",")} style={{ display: "none" }}
                         onChange={e => { const f = e.target.files?.[0]; if (f) setLogFile(f); e.target.value = ""; }}/>
                </label>
              )}
              <div className="muted" style={{ fontSize: 11.5, marginTop: 5, lineHeight: 1.5 }}>
                Attach the raw controller log for a flight that wasn't recorded live in Pilot Ops. Stored securely; downloadable later from this entry.
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Entry detail */}
      {entryDetail && (
        <Modal open onClose={() => setEntryDetail(null)} title={entryDetail.flightCode} subtitle={`${entryDetail.area || entryDetail.pilotName} · ${entryDetail.date}`} icon="reports"
               footer={<>
                 <button className="btn" onClick={() => setEntryDetail(null)}>Close</button>
                 {entryDetail.logPath && <button className="btn" onClick={() => downloadEntryLog(entryDetail, toast)}><Icon name="download" size={14}/> Download log</button>}
                 <button className="btn"><Icon name="edit" size={14}/> Edit</button>
                 <button className="btn btn-primary"><Icon name="reports" size={14}/> Open flight record</button>
               </>}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, fontSize: 13 }}>
            {[
              ["Aircraft", `${entryDetail.aircraft} (${entryDetail.model})`],
              ["Role", entryDetail.role],
              ["Total", `${entryDetail.duration} min`],
              ["Day / Night", `${entryDetail.day} / ${entryDetail.night} min`],
              ["VLOS / BVLOS", `${entryDetail.vlos} / ${entryDetail.bvlos} min`],
              ["Landings", entryDetail.ldgs],
              ["Flight mode", entryDetail.mode],
              ["Time", entryDetail.time],
            ].map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{k}</div>
                <div className="mono" style={{ marginTop: 3, fontWeight: 500 }}>{v}</div>
              </div>
            ))}
          </div>
          {entryDetail.logPath && (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Attached flight log</div>
              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                <Icon name="reports" size={14}/>
                <span className="mono" style={{ fontSize: 12.5, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entryDetail.logName || "flight log"}</span>
                {entryDetail.logSize ? <span className="muted" style={{ fontSize: 11.5 }}>{fmtSize(entryDetail.logSize)}</span> : null}
                <button className="btn btn-sm" onClick={() => downloadEntryLog(entryDetail, toast)}><Icon name="download" size={12}/> Download</button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { LogbookView });
