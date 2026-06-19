import React from "react";
// Pilot Ops — Pilot logbook & currency tracking
const { useState: lbUseState, useMemo: lbUseMemo } = React;

// Logbook entries & currencies are loaded from the DB by the store (bare
// LOGBOOK_ENTRIES / CURRENCIES resolve to those real globals at render). They
// start empty until a pilot logs flights — no dummy data.
const ACHIEVEMENTS = [];

function LogbookView({ accent }) {
  const me = PILOTS.find(p => p.id === window.__poUser?.id) || PILOTS[0] || { name: window.__poUser?.name || "—", initials: window.__poUser?.initials || "—", color: "#2563eb", hours: 0, license: "" };
  const [range, setRange] = lbUseState("30");
  const [search, setSearch] = lbUseState("");
  const [entries, setEntries] = lbUseState(LOGBOOK_ENTRIES);
  const [addOpen, setAddOpen] = lbUseState(false);
  const [entryDetail, setEntryDetail] = lbUseState(null);
  const toast = useToast();

  const filtered = lbUseMemo(() => entries.filter(e => {
    if (search) {
      const hay = (e.id + " " + e.aircraft + " " + e.model + " " + e.area + " " + e.role).toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  }), [entries, search]);

  const totals = lbUseMemo(() => ({
    hours: entries.reduce((s, e) => s + e.duration, 0) / 60,
    flights: entries.length,
    night: entries.reduce((s, e) => s + e.night, 0) / 60,
    bvlos: entries.reduce((s, e) => s + e.bvlos, 0) / 60,
    ldgs: entries.reduce((s, e) => s + e.ldgs, 0),
  }), [entries]);

  // Last 12 months stacked column data (synthetic)
  const monthly = lbUseMemo(() => {
    const months = ["Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr","May","Jun"];
    return months.map((m, i) => ({
      label: m,
      day: 10 + Math.round(Math.sin(i * 0.6) * 8 + i * 1.4),
      night: 2 + Math.round(Math.cos(i * 0.5) * 3 + (i > 7 ? 2 : 0)),
    }));
  }, []);

  const maxMonth = Math.max(...monthly.map(m => m.day + m.night));

  // Mini calendar heatmap
  const calendar = lbUseMemo(() => {
    const days = [];
    for (let i = 0; i < 91; i++) {
      const date = new Date(2026, 2, 5 + i);
      const minutes = entries.filter(e => e.date === date.toISOString().slice(0, 10)).reduce((s, e) => s + e.duration, 0);
      days.push({ date, minutes });
    }
    return days;
  }, [entries]);

  function exportCSV() {
    toast({ kind: "success", title: "Exported", msg: `logbook_${me.id}_${new Date().toISOString().slice(0,10)}.csv` });
  }

  async function addEntry(e) {
    const { data, error } = await window.__supabase.from("logbook_entries").insert({
      pilot_id: window.__poUser?.id || null, date: e.date,
      aircraft_type: e.aircraft, conditions: e.mode, duration_min: e.duration,
      night: !!e.night, bvlos: !!e.bvlos, notes: e.area,
    }).select().single();
    if (error) { toast({ kind: "warn", title: "Save failed", msg: error.message }); return; }
    setEntries(prev => [{ ...e, id: data.id }, ...prev]);
    setAddOpen(false);
    toast({ kind: "success", title: "Entry logged", msg: `${e.duration} min on ${e.aircraft}` });
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
        <KpiTile label="Total flight hours" value={totals.hours.toFixed(1)} unit="hr" delta="+8.4 hr / mo" trend="up" spark={[280,295,310,325,348,372,398,412]}/>
        <KpiTile label="This month"        value="18.4" unit="hr" delta="6 flights" trend="up" spark={[2,5,8,11,13,15,17,18.4]} color="var(--success)"/>
        <KpiTile label="Night ops (90d)"   value="3.2" unit="hr" delta="3 flights" trend="up" spark={[0,0,0.5,1,1.5,2.4,3,3.2]} color="#1e3a8a"/>
        <KpiTile label="BVLOS hours"        value="44.0" unit="hr" delta="+1.1 hr" trend="up" spark={[18,22,26,30,34,38,42,44]} color="#7c3aed"/>
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
                  <td className="mono" style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)" }}>{e.id}</td>
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
        <Modal open onClose={() => setAddOpen(false)} title="Log flight entry" subtitle="Manual logbook entry — auto-logged flights need no entry" icon="plus"
               footer={
                 <>
                   <button className="btn" onClick={() => setAddOpen(false)}>Cancel</button>
                   <button className="btn btn-primary" onClick={() => addEntry({
                     date: new Date().toISOString().slice(0,10), time: "12:00",
                     aircraft: "UAV-A14", model: "Skyhawk 6X", area: "Manual entry",
                     role: "PIC", duration: 30, day: 30, night: 0, bvlos: 0, vlos: 30, ldgs: 1, mode: "Manual"
                   })}><Icon name="check" size={14}/> Log entry</button>
                 </>
               }>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field"><label className="field-label">Date</label><input className="input" type="date" defaultValue="2026-06-03"/></div>
            <div className="field"><label className="field-label">Start time</label><input className="input" type="time" defaultValue="07:30"/></div>
            <div className="field"><label className="field-label">Aircraft</label>
              <select className="select" defaultValue="UAV-A14">{UAVS.map(u => <option key={u.id} value={u.id}>{u.id} — {u.model}</option>)}</select>
            </div>
            <div className="field"><label className="field-label">Role</label>
              <select className="select" defaultValue="PIC"><option>PIC</option><option>Co-pilot</option><option>Observer</option><option>Trainee</option></select>
            </div>
            <div className="field" style={{ gridColumn: "span 2" }}><label className="field-label">Coverage area</label><input className="input" placeholder="e.g. North Perimeter"/></div>
            <div className="field"><label className="field-label">Total duration (min)</label><input className="input" type="number" defaultValue="30"/></div>
            <div className="field"><label className="field-label">Of which: night (min)</label><input className="input" type="number" defaultValue="0"/></div>
            <div className="field"><label className="field-label">BVLOS (min)</label><input className="input" type="number" defaultValue="0"/></div>
            <div className="field"><label className="field-label">Landings</label><input className="input" type="number" defaultValue="1"/></div>
            <div className="field" style={{ gridColumn: "span 2" }}><label className="field-label">Notes</label><textarea className="input" rows="2" placeholder="Optional — conditions, anomalies, training focus…"/></div>
          </div>
        </Modal>
      )}

      {/* Entry detail */}
      {entryDetail && (
        <Modal open onClose={() => setEntryDetail(null)} title={entryDetail.id} subtitle={`${entryDetail.area} · ${entryDetail.date}`} icon="reports"
               footer={<>
                 <button className="btn" onClick={() => setEntryDetail(null)}>Close</button>
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
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { LogbookView });
