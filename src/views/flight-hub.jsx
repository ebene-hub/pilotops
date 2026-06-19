import React from "react";
import { getCurrentPosition } from "../api/geo.js";
// Pilot Ops — Flight Hub view: pilot dispatch, active flights, log new flight modal
const { useState: fhUseState, useMemo: fhUseMemo, useEffect: fhUseEffect } = React;

function FlightHubView({ basemap, setBasemap, onStartFlight, onOpenStream, onEmergencyLaunched }) {
  const [emergencyOpen, setEmergencyOpen] = fhUseState(false);
  const [myLoc, setMyLoc] = fhUseState(null);

  // Request the operator's real device location and show it on the map.
  fhUseEffect(() => {
    let cancelled = false;
    getCurrentPosition()
      .then((p) => { if (!cancelled) setMyLoc({ lat: p.lat, lng: p.lng }); })
      .catch(() => { /* permission denied / unavailable — map still shows flights */ });
    return () => { cancelled = true; };
  }, []);

  const flightPins = ACTIVE_FLIGHTS.map((f, i) => ({
    lat: f.lat, lng: f.lng, x: 25 + i * 18, y: 30 + (i % 2) * 25, kind: "drone",
    color: f.pilot?.color || "#2563eb",
    // Show the pilot's registered ID + name (fall back to the flight code).
    label: f.pilot ? `${f.pilot.shortId || ""} ${f.pilot.name}`.trim() : f.id,
  }));
  const stationPins = STATIONS.map((s, i) => ({
    lat: s.lat, lng: s.lng, x: 18 + i * 22, y: 70, kind: "pin", color: "#16a34a", label: s.name, size: 6
  }));
  // Label the operator's own position with their readable pilot ID (+ name).
  const me = (window.TEAM_ROSTER || []).find(m => m.id === window.__poUser?.id);
  const meLabel = me ? `${me.shortId || ""} ${me.name}`.trim() : (window.__poUser?.name || "You");
  const myPin = myLoc ? [{ lat: myLoc.lat, lng: myLoc.lng, kind: "drone", color: "var(--accent)", label: meLabel }] : [];
  const canFly = !window.hasPerm || window.hasPerm("flight.create");

  return (
    <div className="main-content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Flight Hub</h1>
          <div className="page-sub">{ACTIVE_FLIGHTS.length} active flights · {PILOTS.filter(p => p.status === "in-flight").length} pilots aloft · {STATIONS.length} stations online</div>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="refresh" size={14}/> Sync</button>
          <button className="btn"><Icon name="filter" size={14}/> Filter</button>
          <button className="btn" disabled={!canFly} onClick={() => setEmergencyOpen(true)} style={{ color: canFly ? "var(--danger)" : undefined, borderColor: canFly ? "color-mix(in oklab, var(--danger) 35%, var(--border))" : undefined }} title={canFly ? "Skip pre-flight for time-critical missions" : "Your role can't start missions"}>
            <Icon name="warn" size={14}/> Emergency launch
          </button>
          <button className="btn btn-primary" disabled={!canFly} onClick={onStartFlight} title={canFly ? "Start a mission" : "Your role can't start missions"}>
            <Icon name="plus" size={14}/> Log new flight
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: "var(--density-gap)", marginBottom: "var(--density-gap)" }}>
        {/* Live ops map */}
        <div className="card" style={{ padding: 0 }}>
          <div className="card-head">
            <div>
              <div className="card-title">Live operations map</div>
              <div className="card-sub">Real-time positions · updated every 2s</div>
            </div>
            <div className="row" style={{ marginLeft: "auto", gap: 6 }}>
              <span className="badge badge-live"><span className="dot"/>{ACTIVE_FLIGHTS.length} LIVE</span>
              <button className="btn btn-sm btn-ghost"><Icon name="expand" size={13}/></button>
            </div>
          </div>
          <MapCanvas basemap={basemap} pins={[...myPin, ...flightPins, ...stationPins]} height={420} onBasemapChange={setBasemap}/>
        </div>

        {/* Pilots column */}
        <div className="card">
          <div className="card-head">
            <div className="card-title">Pilots on roster</div>
            <button className="btn btn-sm btn-ghost" style={{ marginLeft: "auto" }}>View all</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {PILOTS.map(p => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px var(--density-pad)", borderTop: "1px solid var(--border)" }}>
                <div className="user-avatar" style={{ background: `linear-gradient(135deg, ${p.color}, color-mix(in oklab, ${p.color} 70%, #000))` }}>{p.initials}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text-3)" }} className="mono">{p.shortId || p.id}{p.license ? " · " + p.license : ""}</div>
                </div>
                <StatusBadge status={p.status}/>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Active flights table */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">Active flights</div>
          <div className="card-sub" style={{ marginLeft: 12 }}>Tap a row to open the livestream</div>
          <div style={{ marginLeft: "auto" }} className="row">
            <button className="btn btn-sm btn-ghost"><Icon name="grid" size={13}/> Multi-screen</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Flight ID</th><th>Pilot</th><th>UAV</th><th>Area</th><th>Station</th>
                <th>Duration</th><th>Altitude</th><th>Signal</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {ACTIVE_FLIGHTS.map(f => (
                <tr key={f.id} className="clickable" onClick={() => onOpenStream(f)}>
                  <td className="mono" style={{ fontWeight: 600 }}>{f.id}</td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div className="user-avatar" style={{ width: 24, height: 24, fontSize: 10, background: `linear-gradient(135deg, ${f.pilot?.color || "#2563eb"}, color-mix(in oklab, ${f.pilot?.color || "#2563eb"} 70%, #000))` }}>{f.pilot?.initials || "—"}</div>
                      <div>
                        <div style={{ fontSize: 13 }}>{f.pilot?.name || "—"}</div>
                        <div style={{ fontSize: 11, color: "var(--text-3)" }} className="mono">{f.pilot?.shortId || ""}</div>
                      </div>
                    </div>
                  </td>
                  <td className="mono">{f.uav?.id || "—"}<div className="muted" style={{ fontSize: 11 }}>{f.uav?.model || ""}</div></td>
                  <td>{f.area}</td>
                  <td className="mono">{f.station?.name || "—"}</td>
                  <td className="mono tabular">{f.duration}</td>
                  <td className="mono tabular">{f.altitude}m</td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 40, height: 4, background: "var(--bg-muted)", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${f.signal}%`, background: f.signal > 75 ? "var(--success)" : f.signal > 50 ? "var(--warning)" : "var(--danger)" }}/>
                      </div>
                      <span className="mono tabular" style={{ fontSize: 11 }}>{f.signal}%</span>
                    </div>
                  </td>
                  <td><StatusBadge status={f.status}/></td>
                  <td><button className="btn btn-sm" onClick={e => { e.stopPropagation(); onOpenStream(f); }}><Icon name="video" size={12}/> Watch</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Emergency launch modal */}
      {window.EmergencyLaunchModal && (
        <EmergencyLaunchModal
          open={emergencyOpen}
          onClose={() => setEmergencyOpen(false)}
          onLaunched={(entry) => onEmergencyLaunched && onEmergencyLaunched(entry)}/>
      )}

    </div>
  );
}

function LogFlightModal({ open, onClose, onSubmit }) {
  const [step, setStep] = fhUseState(1);
  const [form, setForm] = fhUseState({
    pilot: PILOTS[4].id,
    uav: UAVS[0].id,
    station: STATIONS[0].id,
    area: "",
    coverageKm: 8,
    durationMin: 45,
    altitude: 120,
    purpose: "Routine inspection",
    autoRecord: true,
    autoSummary: true,
    notifyAt: "T-15min",
    stakeholders: [1, 2, 3]
  });
  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const flightId = "FL-" + (2244 + Math.floor(Math.random() * 30));

  fhUseEffect(() => { if (open) setStep(1); }, [open]);

  return (
    <Modal open={open} onClose={onClose}
      title="Log new flight"
      subtitle={`Step ${step} of 3 · ${step === 1 ? "Mission details" : step === 2 ? "Notifications" : "Review & dispatch"}`}
      size="lg"
      icon="drone"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <div className="grow"/>
          {step > 1 && <button className="btn" onClick={() => setStep(step - 1)}>Back</button>}
          {step < 3 && <button className="btn btn-primary" onClick={() => setStep(step + 1)}>Continue <Icon name="chev" size={13}/></button>}
          {step === 3 && <button className="btn btn-primary" onClick={() => onSubmit({ ...form, id: flightId })}><Icon name="send" size={13}/> Dispatch & notify</button>}
        </>
      }
    >
      {step === 1 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div className="field">
            <label className="field-label">Flight ID</label>
            <input className="input mono" value={flightId} readOnly style={{ background: "var(--bg-subtle)" }}/>
          </div>
          <div className="field">
            <label className="field-label">Pilot <span className="req">*</span></label>
            <select className="select" value={form.pilot} onChange={e => update("pilot", e.target.value)}>
              {PILOTS.map(p => <option key={p.id} value={p.id}>{p.name} · {p.shortId || p.id}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field-label">UAV asset <span className="req">*</span></label>
            <select className="select" value={form.uav} onChange={e => update("uav", e.target.value)}>
              {UAVS.map(u => <option key={u.id} value={u.id}>{u.id} · {u.model} ({u.battery}% battery)</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field-label">Flight station <span className="req">*</span></label>
            <select className="select" value={form.station} onChange={e => update("station", e.target.value)}>
              {STATIONS.map(s => <option key={s.id} value={s.id}>{s.name} ({s.coords})</option>)}
            </select>
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label className="field-label">Coverage area / mission name <span className="req">*</span></label>
            <input className="input" placeholder="e.g. Western Perimeter sweep — KP 142 to KP 158" value={form.area} onChange={e => update("area", e.target.value)}/>
          </div>
          <div className="field">
            <label className="field-label">Planned coverage (km²)</label>
            <input className="input mono" type="number" value={form.coverageKm} onChange={e => update("coverageKm", +e.target.value)}/>
          </div>
          <div className="field">
            <label className="field-label">Estimated duration (min)</label>
            <input className="input mono" type="number" value={form.durationMin} onChange={e => update("durationMin", +e.target.value)}/>
          </div>
          <div className="field">
            <label className="field-label">Cruise altitude (m AGL)</label>
            <input className="input mono" type="number" value={form.altitude} onChange={e => update("altitude", +e.target.value)}/>
          </div>
          <div className="field">
            <label className="field-label">Mission purpose</label>
            <select className="select" value={form.purpose} onChange={e => update("purpose", e.target.value)}>
              <option>Routine inspection</option>
              <option>Incident follow-up</option>
              <option>Scheduled survey</option>
              <option>Emergency response</option>
              <option>Training</option>
            </select>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <div className="field" style={{ marginBottom: 14 }}>
            <label className="field-label">Notify stakeholders at</label>
            <div className="row" style={{ gap: 6 }}>
              {["T-30min", "T-15min", "T-5min", "On takeoff"].map(o => (
                <button key={o} className={"btn btn-sm " + (form.notifyAt === o ? "btn-primary" : "")} onClick={() => update("notifyAt", o)}>{o}</button>
              ))}
            </div>
          </div>

          <div className="field-label" style={{ marginBottom: 8 }}>Stakeholders to notify <span className="muted">({form.stakeholders.length} selected)</span></div>
          <div className="card" style={{ marginBottom: 14 }}>
            {STAKEHOLDERS.map(s => {
              const on = form.stakeholders.includes(s.id);
              return (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderTop: s.id > 1 ? "1px solid var(--border)" : "none", cursor: "pointer" }}
                  onClick={() => update("stakeholders", on ? form.stakeholders.filter(x => x !== s.id) : [...form.stakeholders, s.id])}>
                  <div style={{ width: 18, height: 18, borderRadius: 5, border: "1.5px solid " + (on ? "var(--accent)" : "var(--border-strong)"), background: on ? "var(--accent)" : "transparent", display: "grid", placeItems: "center", color: "white", flexShrink: 0 }}>
                    {on && <Icon name="check" size={12}/>}
                  </div>
                  <div className="user-avatar" style={{ width: 28, height: 28, fontSize: 11, background: `linear-gradient(135deg, ${s.avatar}, color-mix(in oklab, ${s.avatar} 70%, #000))` }}>{s.name.split(" ").map(w => w[0]).slice(0, 2).join("")}</div>
                  <div className="grow">
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text-3)" }} className="mono">{s.email}</div>
                  </div>
                  <span className="pill">{s.role}</span>
                </div>
              );
            })}
          </div>

          <div className="field-label" style={{ marginBottom: 8 }}>Automations</div>
          <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
            <ToggleRow label="Auto-record video to cloud" desc="Recording starts on takeoff and saves to encrypted bucket." val={form.autoRecord} onChange={v => update("autoRecord", v)}/>
            <ToggleRow label="Auto-generate post-flight summary" desc="AI-drafted summary emailed to stakeholders after landing." val={form.autoSummary} onChange={v => update("autoSummary", v)}/>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <div className="card" style={{ background: "var(--accent-soft)", borderColor: "color-mix(in oklab, var(--accent) 25%, transparent)", marginBottom: 14 }}>
            <div className="card-body" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--accent)", color: "white", display: "grid", placeItems: "center" }}><Icon name="check" size={16}/></div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>Ready to dispatch · {flightId}</div>
                <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 2 }}>Notifications will go out at <strong>{form.notifyAt}</strong> with the livestream link.</div>
              </div>
            </div>
          </div>

          <div className="grid-2">
            <ReviewBlock title="Mission" rows={[
              ["Pilot", PILOTS.find(p => p.id === form.pilot).name],
              ["UAV", UAVS.find(u => u.id === form.uav).id + " · " + UAVS.find(u => u.id === form.uav).model],
              ["Station", STATIONS.find(s => s.id === form.station).name],
              ["Area", form.area || "— (required)"],
              ["Purpose", form.purpose],
            ]}/>
            <ReviewBlock title="Flight envelope" rows={[
              ["Coverage", form.coverageKm + " km²"],
              ["Duration", form.durationMin + " min"],
              ["Altitude", form.altitude + " m AGL"],
              ["Auto-record", form.autoRecord ? "Yes" : "No"],
              ["Auto-summary", form.autoSummary ? "Yes" : "No"],
            ]}/>
          </div>

          <div style={{ marginTop: 14 }}>
            <div className="field-label" style={{ marginBottom: 6 }}>Recipients ({form.stakeholders.length})</div>
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
              {form.stakeholders.map(id => {
                const s = STAKEHOLDERS.find(x => x.id === id);
                return <span key={id} className="pill">{s.name}</span>;
              })}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ToggleRow({ label, desc, val, onChange }) {
  return (
    <div style={{ flex: "1 1 280px", border: "1px solid var(--border)", borderRadius: 10, padding: 12, display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }} onClick={() => onChange(!val)}>
      <div className={"switch " + (val ? "on" : "")}/>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2, lineHeight: 1.4 }}>{desc}</div>
      </div>
    </div>
  );
}

function ReviewBlock({ title, rows }) {
  return (
    <div className="card">
      <div className="card-head" style={{ padding: "10px 14px" }}>
        <div className="card-title" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)" }}>{title}</div>
      </div>
      <div style={{ padding: 4 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 10, padding: "8px 12px", fontSize: 12.5 }}>
            <div className="muted">{k}</div>
            <div style={{ fontWeight: 500 }}>{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { FlightHubView, LogFlightModal });
