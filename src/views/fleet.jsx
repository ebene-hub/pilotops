import React from "react";
// Pilot Ops — Fleet & batteries
const { useState: flUseState, useMemo: flUseMemo } = React;

// Fleet data (AIRCRAFT / BATTERIES / MAINTENANCE) is loaded from the DB by the
// store; bare references resolve to those real globals at render. Admins
// register aircraft & batteries in the Admin console — starts empty.

const STATUS_TONES = {
  ready:        { color: "var(--success)", label: "Ready" },
  charged:      { color: "var(--success)", label: "Charged" },
  charging:     { color: "#0891b2",        label: "Charging" },
  discharged:   { color: "var(--text-3)",  label: "Discharged" },
  "in-flight":  { color: "var(--accent)",  label: "In flight" },
  "in-use":     { color: "var(--accent)",  label: "In use" },
  maintenance:  { color: "var(--warning)", label: "Maintenance" },
  grounded:     { color: "var(--danger)",  label: "Grounded" },
  warn:         { color: "var(--warning)", label: "Watch" },
  retire:       { color: "var(--danger)",  label: "Retire" },
};

const BATTERY_STATUS_OPTIONS = [
  { v: "charged",    l: "Charged — ready to fly" },
  { v: "charging",   l: "Charging" },
  { v: "discharged", l: "Discharged — needs charging" },
  { v: "in-use",     l: "Loaded on aircraft" },
  { v: "warn",       l: "Watch (health declining)" },
  { v: "retire",     l: "Retire (approaching cycle limit)" },
  { v: "grounded",   l: "Grounded / damaged" },
];

function FleetView() {
  const [tab, setTab] = flUseState("aircraft");
  const [search, setSearch] = flUseState("");
  const [acDetail, setAcDetail] = flUseState(null);
  // Batteries come from the DB (store global); updates write back to Supabase.
  const [batteries, setBatteries] = flUseState(() => BATTERIES);
  const [updatingBat, setUpdatingBat] = flUseState(null);
  const toast = useToast();

  const fleetStats = flUseMemo(() => ({
    total: AIRCRAFT.length,
    ready: AIRCRAFT.filter(a => a.status === "ready").length,
    inFlight: AIRCRAFT.filter(a => a.status === "in-flight").length,
    grounded: AIRCRAFT.filter(a => a.status === "grounded" || a.status === "maintenance").length,
    totalHours: AIRCRAFT.reduce((s, a) => s + a.hours, 0),
    avgHealth: batteries.reduce((s, b) => s + b.health, 0) / batteries.length,
    batteriesReady: batteries.filter(b => (b.status === "ready" || b.status === "charged") && b.charge > 80).length,
    batteriesRetire: batteries.filter(b => b.status === "retire").length,
    mxOpen: MAINTENANCE.filter(m => m.status === "open" || m.status === "in-progress").length,
  }), [batteries]);

  return (
    <div className="main-content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Aircraft and Batteries</h1>
          <div className="page-sub">
            {fleetStats.total} airframes · {fleetStats.totalHours.toFixed(0)} total hours · {BATTERIES.length} batteries · {fleetStats.mxOpen} maintenance tasks open
          </div>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="download" size={14}/> Export fleet report</button>
          <a href="/admin.html#aircraft" className="btn btn-primary" style={{ textDecoration: "none" }}>
            <Icon name="plus" size={14}/> Register aircraft in Admin
          </a>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid-4" style={{ marginBottom: "var(--density-gap)" }}>
        <KpiTile label="Aircraft ready" value={fleetStats.ready} unit={`/ ${fleetStats.total}`} delta={`${fleetStats.inFlight} in flight`} trend="up" spark={[3,4,4,5,4,4,fleetStats.ready]} color="var(--success)"/>
        <KpiTile label="Maintenance"    value={fleetStats.grounded}  unit="open" delta={fleetStats.grounded > 0 ? "1 overdue" : "All clear"} trend={fleetStats.grounded > 0 ? "down" : "up"} spark={[1,1,2,2,1,2,2]} color="var(--warning)"/>
        <KpiTile label="Avg battery health" value={fleetStats.avgHealth.toFixed(0)} unit="%" delta="-2% MoM" trend="down" spark={[91,90,90,89,88,87,87]} color="#7c3aed"/>
        <KpiTile label="Batteries ready" value={fleetStats.batteriesReady} unit={`/ ${BATTERIES.length}`} delta={`${fleetStats.batteriesRetire} retire soon`} trend="down" spark={[10,9,9,8,8,8,fleetStats.batteriesReady]} color="var(--accent)"/>
      </div>

      {/* Tabs */}
      <div className="card">
        <div className="card-head" style={{ gap: 12, flexWrap: "wrap" }}>
          <div className="row" style={{ gap: 4 }}>
            {[
              { k: "aircraft",    l: "Aircraft",    ic: "drone",   c: AIRCRAFT.length },
              { k: "batteries",   l: "Batteries",   ic: "battery", c: batteries.length },
              { k: "maintenance", l: "Maintenance", ic: "wrench",  c: MAINTENANCE.length },
            ].map(o => (
              <button key={o.k} onClick={() => setTab(o.k)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "7px 12px", borderRadius: 6, border: "none",
                  background: tab === o.k ? "var(--accent-soft)" : "transparent",
                  color: tab === o.k ? "var(--accent)" : "var(--text-2)",
                  fontSize: 12.5, fontWeight: 500, cursor: "pointer"
                }}>
                <Icon name={o.ic} size={12}/>
                {o.l}
                <span className="mono" style={{ fontSize: 10.5, color: "var(--text-3)", marginLeft: 4 }}>{o.c}</span>
              </button>
            ))}
          </div>
          <div className="search-input" style={{ marginLeft: "auto", width: 240, height: 32 }}>
            <Icon name="search" size={13}/>
            <input value={search} onChange={e => setSearch(e.target.value)}
                   placeholder={`Search ${tab}…`}
                   style={{ flex: 1, border: "none", background: "transparent", outline: "none", color: "var(--text)", fontSize: 12.5 }}/>
          </div>
        </div>

        {tab === "aircraft" && (
          <div style={{ padding: "var(--density-pad)", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(310px, 1fr))", gap: 12 }}>
            {AIRCRAFT.filter(a => !search || (a.id + a.model + a.serial + a.location).toLowerCase().includes(search.toLowerCase())).map(a => {
              const tone = STATUS_TONES[a.status];
              return (
                <div key={a.id} onClick={() => setAcDetail(a)} style={{
                  border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)",
                  padding: 14, cursor: "pointer", display: "flex", flexDirection: "column", gap: 10, transition: "all 0.12s"
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border-strong)"; e.currentTarget.style.boxShadow = "var(--shadow-md)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}>
                  {/* Header row */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                      <Icon name="drone" size={20}/>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="mono" style={{ fontWeight: 600, fontSize: 14 }}>{a.id}</span>
                        <span className="badge" style={{ background: `color-mix(in oklab, ${tone.color} 12%, transparent)`, color: tone.color, borderColor: `color-mix(in oklab, ${tone.color} 30%, transparent)` }}>
                          <span style={{ width: 6, height: 6, borderRadius: 3, background: tone.color }}/> {tone.label}
                        </span>
                      </div>
                      <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 1 }}>{a.model}</div>
                      <div className="mono muted" style={{ fontSize: 10.5, marginTop: 1 }}>{a.serial}</div>
                    </div>
                  </div>

                  {a.alert && (
                    <div style={{ padding: "6px 10px", borderRadius: 6, background: "color-mix(in oklab, var(--danger) 10%, transparent)", color: "var(--danger)", fontSize: 11.5, display: "flex", alignItems: "center", gap: 6 }}>
                      <Icon name="warn" size={11}/> {a.alert}
                    </div>
                  )}

                  {/* Battery bar */}
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                      <span className="muted">Battery</span>
                      <span className="mono" style={{ fontWeight: 600 }}>{a.battery}%</span>
                    </div>
                    <div style={{ height: 5, background: "var(--bg-muted)", borderRadius: 3 }}>
                      <div style={{ width: `${a.battery}%`, height: "100%", background: a.battery > 50 ? "var(--success)" : a.battery > 20 ? "var(--warning)" : "var(--danger)", borderRadius: 3 }}/>
                    </div>
                  </div>

                  {/* Stats grid */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                    <Stat label="Total hours" value={a.hours.toFixed(0)} unit="hr"/>
                    <Stat label="Flights" value={a.flights}/>
                    <Stat label="Payload" value={a.payload} small/>
                    <Stat label="Next service"
                          value={a.serviceIn < 0 ? `${Math.abs(a.serviceIn)}d over` : a.serviceIn === 0 ? "—" : `${a.serviceIn}d`}
                          tone={a.serviceIn < 0 ? "danger" : a.serviceIn < 14 ? "warn" : null}/>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 8, borderTop: "1px solid var(--border)", fontSize: 11.5, color: "var(--text-3)" }}>
                    <span><Icon name="pin" size={11} style={{ verticalAlign: "-1px" }}/> {a.location}</span>
                    <span>{a.assignedPilot}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === "batteries" && (
          <>
            <div style={{ padding: "12px 16px 0", display: "flex", gap: 10, alignItems: "flex-start" }}>
              <div style={{
                background: "var(--bg-subtle)", border: "1px solid var(--border)",
                borderRadius: 8, padding: "8px 12px",
                display: "flex", gap: 10, alignItems: "center",
                fontSize: 11.5, color: "var(--text-2)", flex: 1
              }}>
                <Icon name="info" size={14} stroke="var(--text-3)"/>
                <span>Battery charge and health are <strong>updated manually</strong> by the pilot or ground crew after charging or inspection. Click <strong>Update</strong> on any row to log a change.</span>
              </div>
            </div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Battery ID</th>
                  <th>Aircraft</th>
                  <th style={{ width: 110 }}>Charge</th>
                  <th style={{ width: 130 }}>Health</th>
                  <th>Cycles</th>
                  <th>Last updated</th>
                  <th>Status</th>
                  <th style={{ width: 100 }}></th>
                </tr>
              </thead>
              <tbody>
                {batteries.filter(b => !search || (b.id + b.aircraft).toLowerCase().includes(search.toLowerCase())).map(b => {
                  const tone = STATUS_TONES[b.status] || STATUS_TONES.ready;
                  return (
                    <tr key={b.id}>
                      <td>
                        <div className="mono" style={{ fontWeight: 600, fontSize: 12.5 }}>{b.id}</div>
                        {b.alert && <div style={{ fontSize: 10.5, color: "var(--warning)", marginTop: 2 }}>⚠ {b.alert}</div>}
                      </td>
                      <td className="mono" style={{ fontSize: 12 }}>{b.aircraft || <span className="muted">unassigned</span>}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div style={{ flex: 1, height: 5, background: "var(--bg-muted)", borderRadius: 3, overflow: "hidden" }}>
                            <div style={{ width: `${b.charge}%`, height: "100%", background: b.charge > 50 ? "var(--success)" : b.charge > 20 ? "var(--warning)" : "var(--danger)" }}/>
                          </div>
                          <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, minWidth: 32, textAlign: "right" }}>{b.charge}%</span>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div style={{ flex: 1, height: 5, background: "var(--bg-muted)", borderRadius: 3, overflow: "hidden" }}>
                            <div style={{ width: `${b.health}%`, height: "100%", background: b.health > 85 ? "var(--success)" : b.health > 70 ? "var(--warning)" : "var(--danger)" }}/>
                          </div>
                          <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, minWidth: 32, textAlign: "right" }}>{b.health}%</span>
                        </div>
                      </td>
                      <td className="mono tabular" style={{ fontSize: 12 }}>{b.cycles}<span className="muted"> / {b.maxCycles}</span></td>
                      <td style={{ fontSize: 12, color: "var(--text-2)" }}>
                        {b.lastUpdated || b.lastCharge}
                        {b.lastUpdatedBy && <div className="muted" style={{ fontSize: 10.5, marginTop: 1 }}>by {b.lastUpdatedBy}</div>}
                      </td>
                      <td>
                        <span className="badge" style={{ background: `color-mix(in oklab, ${tone.color} 12%, transparent)`, color: tone.color, borderColor: `color-mix(in oklab, ${tone.color} 30%, transparent)` }}>
                          <span style={{ width: 6, height: 6, borderRadius: 3, background: tone.color }}/> {tone.label}
                        </span>
                      </td>
                      <td>
                        <button className="btn btn-sm" disabled={window.hasPerm && !window.hasPerm("battery.update")} onClick={() => setUpdatingBat(b)} title={(window.hasPerm && !window.hasPerm("battery.update")) ? "Your role can't update batteries" : ""}>
                          <Icon name="edit" size={11}/> Update
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}

        {tab === "maintenance" && (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Task ID</th>
                  <th>Asset</th>
                  <th>Type</th>
                  <th>Priority</th>
                  <th>Due</th>
                  <th>Assignee</th>
                  <th>Status</th>
                  <th/>
                </tr>
              </thead>
              <tbody>
                {MAINTENANCE.filter(m => !search || (m.id + m.aircraft + m.type).toLowerCase().includes(search.toLowerCase())).map(m => {
                  const pri = m.priority === "high" ? "var(--danger)" : m.priority === "medium" ? "var(--warning)" : "var(--text-3)";
                  return (
                    <tr key={m.id} className="clickable">
                      <td className="mono" style={{ fontWeight: 600, fontSize: 12.5, color: "var(--accent)" }}>{m.id}</td>
                      <td className="mono" style={{ fontSize: 12 }}>{m.aircraft}</td>
                      <td style={{ fontSize: 12.5 }}>{m.type}</td>
                      <td>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: pri, fontWeight: 500, textTransform: "capitalize" }}>
                          <span style={{ width: 6, height: 6, borderRadius: 3, background: pri }}/>
                          {m.priority}
                        </span>
                      </td>
                      <td style={{ fontSize: 12.5, color: m.due.includes("Overdue") ? "var(--danger)" : "var(--text-2)", fontWeight: m.due.includes("Overdue") ? 600 : 400 }}>{m.due}</td>
                      <td style={{ fontSize: 12.5 }}>{m.assignee}</td>
                      <td>
                        <span className="badge" style={{ textTransform: "capitalize" }}>{m.status.replace("-", " ")}</span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button className="btn btn-sm">Open</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Battery update modal */}
      {updatingBat && (
        <BatteryUpdateModal
          battery={updatingBat}
          onClose={() => setUpdatingBat(null)}
          onSave={async (patch) => {
            setBatteries(prev => prev.map(b => b.id === updatingBat.id ? { ...b, ...patch } : b));
            const bat = updatingBat;
            setUpdatingBat(null);
            if (bat.dbId) {
              const upd = {
                charge: patch.charge, health: patch.health, status: patch.status,
                last_updated_by: window.__poUser?.id || null,
                last_updated_at: new Date().toISOString(), notes: patch.note ?? null,
              };
              if (patch.cycles != null) upd.cycles = patch.cycles;
              const { error } = await window.__supabase.from("batteries").update(upd).eq("id", bat.dbId);
              if (error) { toast({ kind: "warn", title: "Save failed", msg: error.message }); return; }
            }
            toast({ kind: "success", title: `${bat.id} updated`, msg: patch.status ? STATUS_TONES[patch.status]?.label : "Status updated" });
          }}/>
      )}

      {/* Aircraft detail modal */}
      {acDetail && (
        <Modal open onClose={() => setAcDetail(null)} title={`${acDetail.id} — ${acDetail.model}`} subtitle={acDetail.serial} icon="drone" size="lg"
               footer={<>
                 <button className="btn" onClick={() => setAcDetail(null)}>Close</button>
                 <button className="btn"><Icon name="reports" size={14}/> Maintenance log</button>
                 <button className="btn btn-primary"><Icon name="play" size={14}/> Assign to flight</button>
               </>}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {[
              ["Status", STATUS_TONES[acDetail.status].label],
              ["Location", acDetail.location],
              ["Assigned to", acDetail.assignedPilot],
              ["Payload", acDetail.payload],
              ["Total flight hours", `${acDetail.hours.toFixed(1)} hr`],
              ["Total flights", acDetail.flights],
              ["Total cycles", acDetail.cycles],
              ["Battery", `${acDetail.battery}%`],
              ["Last service", acDetail.lastService],
              ["Next service", acDetail.nextService],
            ].map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{k}</div>
                <div className="mono" style={{ marginTop: 3, fontSize: 13, fontWeight: 500 }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Batteries paired with this airframe</div>
            {batteries.filter(b => b.aircraft === acDetail.id).map(b => (              <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                <Icon name="battery" size={16} style={{ color: "var(--text-3)" }}/>
                <div className="mono" style={{ fontSize: 12.5, fontWeight: 500, minWidth: 110 }}>{b.id}</div>
                <div style={{ flex: 1, height: 5, background: "var(--bg-muted)", borderRadius: 3 }}>
                  <div style={{ width: `${b.health}%`, height: "100%", background: b.health > 85 ? "var(--success)" : b.health > 70 ? "var(--warning)" : "var(--danger)", borderRadius: 3 }}/>
                </div>
                <div className="mono" style={{ fontSize: 11.5, minWidth: 70, textAlign: "right" }}>{b.health}% health</div>
                <div className="mono muted" style={{ fontSize: 11.5, minWidth: 80, textAlign: "right" }}>{b.cycles} cycles</div>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function BatteryUpdateModal({ battery, onClose, onSave }) {
  const [charge, setCharge] = React.useState(battery.charge);
  const [health, setHealth] = React.useState(battery.health);
  const [status, setStatus] = React.useState(battery.status);
  const [incrementCycle, setIncrementCycle] = React.useState(false);
  const [notes, setNotes] = React.useState("");

  // Auto-update status when slider hits 100 or 0
  React.useEffect(() => {
    if (charge >= 100 && status === "charging") setStatus("charged");
    if (charge === 0 && (status === "charged" || status === "ready")) setStatus("discharged");
  }, [charge]);

  function save() {
    const now = new Date();
    const ts = now.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const patch = {
      charge: Math.max(0, Math.min(100, +charge)),
      health: Math.max(0, Math.min(100, +health)),
      status,
      lastCharge: status === "charged" || status === "charging" ? ts : battery.lastCharge,
      lastUpdated: ts,
      lastUpdatedBy: window.__poUser?.name || "—",
    };
    if (incrementCycle) patch.cycles = (battery.cycles || 0) + 1;
    if (notes) patch.note = notes;
    onSave(patch);
  }

  const tone = STATUS_TONES[status] || STATUS_TONES.ready;

  return (
    <Modal open onClose={onClose}
      title={`Update ${battery.id}`}
      subtitle={`Paired with ${battery.aircraft || "no aircraft"} · ${battery.cycles}/${battery.maxCycles} cycles`}
      icon="battery" size="md"
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}><Icon name="check" size={14}/> Save update</button>
      </>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

        {/* Charging status — primary */}
        <div className="field">
          <label className="field-label">Charging status</label>
          <select className="select" value={status} onChange={e => setStatus(e.target.value)}>
            {BATTERY_STATUS_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
          <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
            <span className="badge" style={{ background: `color-mix(in oklab, ${tone.color} 12%, transparent)`, color: tone.color, borderColor: `color-mix(in oklab, ${tone.color} 30%, transparent)` }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: tone.color }}/> {tone.label}
            </span>
            <span className="muted" style={{ fontSize: 11 }}>Visible to all crew in the fleet view.</span>
          </div>
        </div>

        {/* Charge slider */}
        <div className="field">
          <label className="field-label" style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Charge level <span style={{ color: "var(--text-3)", fontWeight: 400 }}>(read from the charger or aircraft)</span></span>
            <span className="mono" style={{ fontWeight: 600 }}>{charge}%</span>
          </label>
          <input type="range" min="0" max="100" step="1" value={charge} onChange={e => setCharge(+e.target.value)}
                 style={{ width: "100%", accentColor: "var(--accent)" }}/>
          <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
            {[0, 25, 50, 75, 100].map(v => (
              <button key={v} type="button" onClick={() => setCharge(v)}
                style={{
                  flex: 1, padding: "4px 0", borderRadius: 5,
                  border: "1px solid var(--border)",
                  background: charge === v ? "var(--accent-soft)" : "var(--surface)",
                  color: charge === v ? "var(--accent)" : "var(--text-2)",
                  fontSize: 11, fontWeight: 500, cursor: "pointer",
                  fontFamily: "var(--font-mono)"
                }}>{v}%</button>
            ))}
          </div>
        </div>

        {/* Health slider */}
        <div className="field">
          <label className="field-label" style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Battery health <span style={{ color: "var(--text-3)", fontWeight: 400 }}>(after inspection)</span></span>
            <span className="mono" style={{ fontWeight: 600 }}>{health}%</span>
          </label>
          <input type="range" min="0" max="100" step="1" value={health} onChange={e => setHealth(+e.target.value)}
                 style={{ width: "100%", accentColor: health > 85 ? "var(--success)" : health > 70 ? "var(--warning)" : "var(--danger)" }}/>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>
            {health > 85 ? "Healthy" : health > 70 ? "Watch — degradation detected" : "Retire soon — significant degradation"}
          </div>
        </div>

        {/* Cycle count */}
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: 10, borderRadius: 8, background: "var(--bg-subtle)", border: "1px solid var(--border)", cursor: "pointer" }}>
          <input type="checkbox" checked={incrementCycle} onChange={e => setIncrementCycle(e.target.checked)} style={{ marginTop: 2, accentColor: "var(--accent)" }}/>
          <div style={{ fontSize: 12.5 }}>
            <div>Increment cycle count (+1)</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
              Check this if logging a completed charge cycle. New count: <span className="mono">{(battery.cycles || 0) + (incrementCycle ? 1 : 0)} / {battery.maxCycles}</span>
            </div>
          </div>
        </label>

        {/* Notes */}
        <div className="field">
          <label className="field-label">Notes <span style={{ color: "var(--text-3)", fontWeight: 400 }}>(optional)</span></label>
          <textarea className="input" rows="2" value={notes} onChange={e => setNotes(e.target.value)}
                    placeholder="e.g. Charged on Station Alpha · external charger #3"/>
        </div>

        <div style={{ fontSize: 11, color: "var(--text-3)", padding: "8px 10px", background: "color-mix(in oklab, var(--accent) 5%, transparent)", borderRadius: 6, display: "flex", alignItems: "center", gap: 6 }}>
          <Icon name="shield" size={12}/>
          Update will be logged as: <strong>{window.__poUser?.name || "—"}</strong> · {new Date().toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
    </Modal>
  );
}

function Stat({ label, value, unit, tone, small }) {
  const color = tone === "danger" ? "var(--danger)" : tone === "warn" ? "var(--warning)" : "var(--text)";
  return (
    <div>
      <div style={{ fontSize: 10.5, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>{label}</div>
      <div className={small ? "" : "mono"} style={{ fontSize: small ? 12 : 14, fontWeight: 600, color, fontVariantNumeric: "tabular-nums" }}>
        {value}{unit && <span className="muted" style={{ fontWeight: 400, fontSize: 11, marginLeft: 2 }}>{unit}</span>}
      </div>
    </div>
  );
}

Object.assign(window, { FleetView });
