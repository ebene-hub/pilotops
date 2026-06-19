import React from "react";
// Pilot Ops — Pre-flight checklist
const { useState: pfUseState, useMemo: pfUseMemo, useEffect: pfUseEffect } = React;

// ---------- Checklist template ----------
const CHECKLIST = [
  {
    id: "weather",
    title: "Weather & airspace",
    icon: "wind",
    color: "#0891b2",
    items: [
      { id: "w-wind",    label: "Wind speed within aircraft limits",     critical: true,  auto: true,  data: "8 kt SE · gust 12 kt · limit 22 kt" },
      { id: "w-vis",     label: "Visibility ≥ 3 SM at takeoff",            critical: true,  auto: true,  data: "10+ SM · scattered clouds @ 4500 ft" },
      { id: "w-precip",  label: "No precipitation forecast in 60 min",     critical: false, auto: true,  data: "Clear · 0% PoP next 2 hr" },
      { id: "w-temp",    label: "OAT within battery operating range",      critical: true,  auto: true,  data: "21°C · range -10 to 40°C" },
      { id: "w-notam",   label: "No active NOTAMs in operating area",     critical: true,  auto: true,  data: "0 active NOTAMs · LAANC approved" },
      { id: "w-tfr",     label: "No active TFRs",                          critical: true,  auto: true,  data: "0 active TFRs" },
      { id: "w-sunset",  label: "Operation completes before civil twilight", critical: false, auto: false, data: "Sunset 19:42 · op ends 09:30" },
    ],
  },
  {
    id: "aircraft",
    title: "Aircraft",
    icon: "drone",
    color: "#2563eb",
    items: [
      { id: "a-airframe", label: "Airframe visual inspection — no damage",  critical: true,  auto: false },
      { id: "a-props",    label: "Propellers seated and free of cracks",    critical: true,  auto: false },
      { id: "a-bat",      label: "Battery 1 charge ≥ 90%",                  critical: true,  auto: true, data: "94% · cycle 142/500 · healthy" },
      { id: "a-bat2",     label: "Battery 2 (backup) charge ≥ 90%",        critical: false, auto: true, data: "91% · cycle 88/500 · healthy" },
      { id: "a-gps",      label: "GPS lock ≥ 12 satellites",                critical: true,  auto: true, data: "16 sats · HDOP 0.6" },
      { id: "a-imu",      label: "IMU calibrated within tolerance",         critical: true,  auto: true, data: "Calibrated 2 days ago · ±0.4°" },
      { id: "a-compass",  label: "Compass calibrated · no interference",    critical: true,  auto: true, data: "Calibrated · no mag anomalies" },
      { id: "a-rth",      label: "RTH altitude set above tallest obstacle", critical: true,  auto: false },
      { id: "a-payload",  label: "Payload secured · gimbal free movement",  critical: true,  auto: false },
      { id: "a-firmware", label: "Firmware up to date",                     critical: false, auto: true, data: "v4.2.1 · current" },
    ],
  },
  {
    id: "pilot",
    title: "Pilot & crew",
    icon: "users",
    color: "#7c3aed",
    items: [
      { id: "p-license", label: "Part 107 license current",                 critical: true,  auto: true, data: "Valid until 2027-08-14" },
      { id: "p-medical", label: "Crew medical & rested",                    critical: true,  auto: false },
      { id: "p-vo",      label: "Visual observer briefed and in position",  critical: true,  auto: false },
      { id: "p-comms",   label: "Comms check completed on Ch 4",            critical: true,  auto: false },
      { id: "p-rules",   label: "Operating rules confirmed (107.31 BVLOS)", critical: true,  auto: false },
      { id: "p-emerg",   label: "Emergency procedures briefed",             critical: true,  auto: false },
    ],
  },
  {
    id: "site",
    title: "Site & safety",
    icon: "pin",
    color: "#16a34a",
    items: [
      { id: "s-laanc",   label: "LAANC authorization confirmed",            critical: true,  auto: true, data: "Approved · 0–400 ft AGL · Class G/E" },
      { id: "s-los",     label: "Line of sight clear from launch pad",     critical: true,  auto: false },
      { id: "s-bystand", label: "No uninvolved persons in operating area",  critical: true,  auto: false },
      { id: "s-hazards", label: "Powerlines / towers identified and marked", critical: true,  auto: false },
      { id: "s-emerg",   label: "Emergency landing site identified",         critical: true,  auto: false },
      { id: "s-firstaid", label: "First aid kit accessible at launch site",  critical: false, auto: false },
    ],
  },
];

const FLAT_ITEMS = CHECKLIST.flatMap(s => s.items.map(i => ({ ...i, section: s.id, sectionTitle: s.title })));
const TOTAL_ITEMS = FLAT_ITEMS.length;
const CRITICAL_COUNT = FLAT_ITEMS.filter(i => i.critical).length;

// Default checklist state — auto-items start as pass
function defaultPreflightState() {
  const init = {};
  for (const item of FLAT_ITEMS) { if (item.auto) init[item.id] = "pass"; }
  return init;
}

// Stats for any state map
function preflightStats(state) {
  let passed = 0, failed = 0, na = 0, criticalFails = 0, criticalUnchecked = 0;
  for (const item of FLAT_ITEMS) {
    const v = state[item.id];
    if (v === "pass") passed++;
    else if (v === "fail") { failed++; if (item.critical) criticalFails++; }
    else if (v === "na") na++;
    else if (item.critical) criticalUnchecked++;
  }
  return { passed, failed, na, criticalFails, criticalUnchecked, completed: passed + failed + na, total: FLAT_ITEMS.length };
}

/* ---------- Embedded compact checklist (used inside Start Mission page) ---------- */
function EmbeddedPreflightChecklist({ state, setState, signoff, setSignoff, pilotName }) {
  const [openSection, setOpenSection] = pfUseState("aircraft");
  const stats = preflightStats(state);
  const completionPct = (stats.completed / stats.total) * 100;
  const allCriticalPass = stats.criticalFails === 0 && stats.criticalUnchecked === 0;

  function setItem(id, v) { setState(prev => ({ ...prev, [id]: prev[id] === v ? undefined : v })); }
  function markAll(secId, v) {
    const items = CHECKLIST.find(s => s.id === secId).items;
    setState(prev => { const next = { ...prev }; items.forEach(i => { next[i.id] = v; }); return next; });
  }
  function resetAll() {
    if (confirm("Reset the pre-flight checklist?")) { setState(defaultPreflightState()); setSignoff(false); }
  }

  return (
    <div>
      {/* Progress strip */}
      <div style={{
        padding: "12px 14px", borderRadius: 10, marginBottom: 12,
        background: stats.criticalFails > 0 ? "color-mix(in oklab, var(--danger) 8%, transparent)"
                  : allCriticalPass ? "color-mix(in oklab, var(--success) 8%, transparent)"
                  : "color-mix(in oklab, var(--warning) 8%, transparent)",
        border: `1px solid ${stats.criticalFails > 0 ? "var(--danger)" : allCriticalPass ? "var(--success)" : "var(--warning)"}`,
        display: "flex", alignItems: "center", gap: 12
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: stats.criticalFails > 0 ? "var(--danger)" : allCriticalPass ? "var(--success)" : "var(--warning)",
          color: "white", display: "grid", placeItems: "center", flexShrink: 0
        }}>
          <Icon name={stats.criticalFails > 0 ? "warn" : allCriticalPass ? "check" : "clock"} size={14}/>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {stats.criticalFails > 0
              ? `${stats.criticalFails} critical failure${stats.criticalFails > 1 ? "s" : ""} — mission blocked`
              : allCriticalPass
                ? "All critical items passed"
                : `${stats.criticalUnchecked} critical item${stats.criticalUnchecked > 1 ? "s" : ""} remaining`}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 1 }}>
            {stats.completed}/{stats.total} reviewed · {stats.passed} pass · {stats.failed} fail · {stats.na} N/A
          </div>
        </div>
        <div style={{ minWidth: 110 }}>
          <div style={{ height: 6, background: "var(--bg-muted)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: `${completionPct}%`, height: "100%", background: stats.criticalFails > 0 ? "var(--danger)" : allCriticalPass ? "var(--success)" : "var(--accent)", transition: "width 0.2s" }}/>
          </div>
          <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 4, textAlign: "right" }} className="mono">{completionPct.toFixed(0)}% complete</div>
        </div>
        <button type="button" onClick={resetAll} style={{ border: "none", background: "transparent", color: "var(--text-3)", cursor: "pointer", padding: 6, borderRadius: 4 }} title="Reset checklist">
          <Icon name="refresh" size={13}/>
        </button>
      </div>

      {/* Accordion sections */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {CHECKLIST.map(sec => {
          const isOpen = openSection === sec.id;
          const items = sec.items;
          const total = items.length;
          const done = items.filter(i => state[i.id] === "pass" || state[i.id] === "na").length;
          const failed = items.some(i => state[i.id] === "fail" && i.critical);
          const allDone = done === total;

          return (
            <div key={sec.id} style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "var(--surface)" }}>
              <button type="button" onClick={() => setOpenSection(isOpen ? null : sec.id)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 14px", background: isOpen ? "var(--bg-subtle)" : "transparent",
                  border: "none", cursor: "pointer", textAlign: "left", color: "var(--text)"
                }}>
                <div style={{ width: 26, height: 26, borderRadius: 7, background: `color-mix(in oklab, ${sec.color} 15%, transparent)`, color: sec.color, display: "grid", placeItems: "center", flexShrink: 0 }}>
                  <Icon name={sec.icon} size={12}/>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{sec.title}</div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>{done}/{total} reviewed</div>
                </div>
                {failed && <span className="badge" style={{ background: "color-mix(in oklab, var(--danger) 10%, transparent)", color: "var(--danger)", borderColor: "color-mix(in oklab, var(--danger) 30%, transparent)", fontSize: 10 }}>FAIL</span>}
                {allDone && !failed && <Icon name="check" size={14} style={{ color: "var(--success)" }}/>}
                <Icon name="chevDown" size={13} style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s", color: "var(--text-3)" }}/>
              </button>

              {isOpen && (
                <div>
                  <div style={{ display: "flex", gap: 6, padding: "6px 14px 8px", borderTop: "1px solid var(--border)" }}>
                    <button type="button" className="btn btn-sm" onClick={() => markAll(sec.id, "pass")} style={{ fontSize: 11, height: 26 }}><Icon name="check" size={11}/> All pass</button>
                    <button type="button" className="btn btn-sm" onClick={() => markAll(sec.id)} style={{ fontSize: 11, height: 26 }}>Clear</button>
                  </div>
                  {items.map(item => {
                    const v = state[item.id];
                    return (
                      <div key={item.id} style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "8px 14px", borderTop: "1px solid var(--border)",
                        background: v === "fail" && item.critical ? "color-mix(in oklab, var(--danger) 4%, transparent)" : "transparent"
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            {item.label}
                            {item.critical && <span style={{ fontSize: 9, fontWeight: 700, color: "var(--danger)", letterSpacing: "0.05em" }}>CRITICAL</span>}
                            {item.auto && <span style={{ fontSize: 9, fontWeight: 700, color: "var(--success)", letterSpacing: "0.05em" }}>AUTO</span>}
                          </div>
                          {item.data && <div className="mono" style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 2 }}>{item.data}</div>}
                        </div>
                        <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                          <CheckBtn label="Pass" tone="success" icon="check" active={v === "pass"} onClick={() => setItem(item.id, "pass")}/>
                          <CheckBtn label="Fail" tone="danger"  icon="close" active={v === "fail"} onClick={() => setItem(item.id, "fail")}/>
                          <CheckBtn label="N/A"  tone="muted"   icon=""      active={v === "na"}   onClick={() => setItem(item.id, "na")}/>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Sign-off */}
      <label style={{
        display: "flex", gap: 12, alignItems: "flex-start", cursor: "pointer",
        padding: 14, marginTop: 14, borderRadius: 10,
        background: signoff ? "color-mix(in oklab, var(--success) 8%, transparent)" : "var(--bg-subtle)",
        border: `1px solid ${signoff ? "var(--success)" : "var(--border)"}`,
        transition: "all 0.15s"
      }}>
        <input type="checkbox" checked={signoff} onChange={e => setSignoff(e.target.checked)}
               disabled={!allCriticalPass}
               style={{ marginTop: 2, width: 18, height: 18, accentColor: "var(--success)" }}/>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>
            I confirm this checklist was completed honestly and the aircraft is fit to fly.
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 3 }}>
            {allCriticalPass
              ? <>Signed by <span style={{ color: "var(--text)" }}>{pilotName || "Pilot"}</span> · {new Date().toLocaleString()}</>
              : "Complete all critical items before signing."}
          </div>
        </div>
      </label>
    </div>
  );
}

function PreflightView({ activeFlight, onLaunch }) {
  const f = activeFlight || ACTIVE_FLIGHTS[0];
  const toast = useToast();

  // Map of itemId -> "pass" | "fail" | "na" | undefined
  const storageKey = `po:preflight:${f.id}`;
  const [state, setState] = pfUseState(() => {
    try { const raw = localStorage.getItem(storageKey); if (raw) return JSON.parse(raw); } catch {}
    // Auto-pass items with critical auto-data on initial load
    const init = {};
    for (const item of FLAT_ITEMS) {
      if (item.auto) init[item.id] = "pass";
    }
    return init;
  });
  pfUseEffect(() => { localStorage.setItem(storageKey, JSON.stringify(state)); }, [state]);

  const [signoff, setSignoff] = pfUseState(false);
  const [activeSection, setActiveSection] = pfUseState("weather");
  const [confirmOpen, setConfirmOpen] = pfUseState(false);

  function setItem(id, v) {
    setState(prev => ({ ...prev, [id]: prev[id] === v ? undefined : v }));
  }

  function markAll(sec, v) {
    const next = { ...state };
    CHECKLIST.find(s => s.id === sec).items.forEach(i => { next[i.id] = v; });
    setState(next);
  }

  function resetAll() {
    if (confirm("Reset the entire pre-flight checklist?")) {
      setState({});
      setSignoff(false);
      toast({ kind: "info", title: "Checklist reset", msg: "All items cleared." });
    }
  }

  const stats = pfUseMemo(() => {
    let passed = 0, failed = 0, na = 0, criticalFails = 0, criticalUnchecked = 0;
    for (const item of FLAT_ITEMS) {
      const v = state[item.id];
      if (v === "pass") passed++;
      else if (v === "fail") { failed++; if (item.critical) criticalFails++; }
      else if (v === "na") na++;
      else if (item.critical) criticalUnchecked++;
    }
    return { passed, failed, na, criticalFails, criticalUnchecked, completed: passed + failed + na };
  }, [state]);

  const allCriticalPass = stats.criticalFails === 0 && stats.criticalUnchecked === 0;
  const canLaunch = allCriticalPass && signoff;
  const completionPct = (stats.completed / TOTAL_ITEMS) * 100;

  function handleLaunch() {
    setConfirmOpen(false);
    toast({ kind: "success", title: "Cleared for takeoff", msg: "Routing to mission start…" });
    if (onLaunch) setTimeout(onLaunch, 600);
  }

  return (
    <div className="main-content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Pre-flight checklist</h1>
          <div className="page-sub">Mission {f.id} · {f.area} · {f.pilot.name} on {f.uav.id}</div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={resetAll}><Icon name="refresh" size={14}/> Reset</button>
          <button className="btn"><Icon name="download" size={14}/> Save as PDF</button>
          <button
            className={"btn " + (canLaunch ? "btn-primary" : "")}
            disabled={!canLaunch}
            onClick={() => canLaunch && setConfirmOpen(true)}
            style={!canLaunch ? { opacity: 0.5, cursor: "not-allowed" } : {}}>
            <Icon name="play" size={14}/> {canLaunch ? "Cleared for takeoff" : "Locked — finish checklist"}
          </button>
        </div>
      </div>

      {/* Status banner */}
      <div style={{
        marginBottom: "var(--density-gap)",
        padding: 14,
        borderRadius: 10,
        border: `1px solid ${stats.criticalFails > 0 ? "var(--danger)" : allCriticalPass ? "var(--success)" : "var(--warning)"}`,
        background: stats.criticalFails > 0 ? "color-mix(in oklab, var(--danger) 8%, transparent)" : allCriticalPass ? "color-mix(in oklab, var(--success) 8%, transparent)" : "color-mix(in oklab, var(--warning) 8%, transparent)",
        display: "flex", alignItems: "center", gap: 14
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: stats.criticalFails > 0 ? "var(--danger)" : allCriticalPass ? "var(--success)" : "var(--warning)",
          color: "white", display: "grid", placeItems: "center", flexShrink: 0
        }}>
          <Icon name={stats.criticalFails > 0 ? "warn" : allCriticalPass ? "check" : "clock"} size={18}/>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {stats.criticalFails > 0
              ? `${stats.criticalFails} critical failure${stats.criticalFails > 1 ? "s" : ""} — flight blocked`
              : allCriticalPass
                ? "All critical items passed — ready to launch"
                : `${stats.criticalUnchecked} critical item${stats.criticalUnchecked > 1 ? "s" : ""} remaining`}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 2 }}>
            {stats.completed}/{TOTAL_ITEMS} items reviewed · {stats.passed} pass · {stats.failed} fail · {stats.na} N/A
          </div>
        </div>
        <div style={{ minWidth: 120 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 4, color: "var(--text-2)" }}>
            <span>Progress</span><span className="mono">{completionPct.toFixed(0)}%</span>
          </div>
          <div style={{ height: 8, background: "var(--bg-muted)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ width: `${completionPct}%`, height: "100%", background: stats.criticalFails > 0 ? "var(--danger)" : allCriticalPass ? "var(--success)" : "var(--accent)", transition: "width 0.2s" }}/>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr 280px", gap: "var(--density-gap)" }}>
        {/* Section nav */}
        <div className="card preflight-nav" style={{ alignSelf: "start", position: "sticky", top: "calc(var(--topbar-h) + 16px)" }}>
          <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 4, padding: 8 }}>
            {CHECKLIST.map(s => {
              const sec = FLAT_ITEMS.filter(i => i.section === s.id);
              const done = sec.filter(i => state[i.id] === "pass" || state[i.id] === "na").length;
              const failed = sec.some(i => state[i.id] === "fail" && i.critical);
              const allDone = done === sec.length;
              return (
                <button key={s.id} onClick={() => {
                  setActiveSection(s.id);
                  document.getElementById(`section-${s.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                }} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 10px", borderRadius: 6,
                  border: "none", cursor: "pointer", textAlign: "left",
                  background: activeSection === s.id ? "var(--accent-soft)" : "transparent",
                  color: activeSection === s.id ? "var(--accent)" : "var(--text)",
                  fontSize: 13
                }}>
                  <div style={{ width: 22, height: 22, borderRadius: 6, background: `color-mix(in oklab, ${s.color} 15%, transparent)`, color: s.color, display: "grid", placeItems: "center", flexShrink: 0 }}>
                    <Icon name={s.icon} size={12}/>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500 }}>{s.title}</div>
                    <div className="muted" style={{ fontSize: 10.5 }}>{done}/{sec.length} complete</div>
                  </div>
                  {failed && <span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--danger)" }}/>}
                  {allDone && !failed && <Icon name="check" size={14} style={{ color: "var(--success)" }}/>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Main checklist */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--density-gap)" }}>
          {CHECKLIST.map(s => (
            <div key={s.id} id={`section-${s.id}`} className="card">
              <div className="card-head">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: `color-mix(in oklab, ${s.color} 15%, transparent)`, color: s.color, display: "grid", placeItems: "center" }}>
                    <Icon name={s.icon} size={15}/>
                  </div>
                  <div className="card-title">{s.title}</div>
                </div>
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <button className="btn btn-sm" onClick={() => markAll(s.id, "pass")}><Icon name="check" size={12}/> All pass</button>
                  <button className="btn btn-sm" onClick={() => markAll(s.id)}>Clear</button>
                </div>
              </div>
              <div style={{ padding: "4px 0" }}>
                {s.items.map(item => {
                  const v = state[item.id];
                  return (
                    <div key={item.id} style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "10px 16px",
                      borderBottom: "1px solid var(--border)",
                      background: v === "fail" && item.critical ? "color-mix(in oklab, var(--danger) 4%, transparent)" : "transparent"
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                          {item.label}
                          {item.critical && <span className="badge" style={{ fontSize: 9.5, padding: "1px 6px", background: "color-mix(in oklab, var(--danger) 12%, transparent)", color: "var(--danger)", borderColor: "color-mix(in oklab, var(--danger) 30%, transparent)" }}>CRITICAL</span>}
                          {item.auto && <span className="badge" style={{ fontSize: 9.5, padding: "1px 6px", background: "color-mix(in oklab, var(--success) 12%, transparent)", color: "var(--success)", borderColor: "color-mix(in oklab, var(--success) 30%, transparent)" }}>AUTO</span>}
                        </div>
                        {item.data && (
                          <div className="mono muted" style={{ fontSize: 11, marginTop: 3 }}>{item.data}</div>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 4 }}>
                        <CheckBtn label="Pass" tone="success" icon="check" active={v === "pass"} onClick={() => setItem(item.id, "pass")}/>
                        <CheckBtn label="Fail" tone="danger"  icon="close" active={v === "fail"} onClick={() => setItem(item.id, "fail")}/>
                        <CheckBtn label="N/A"  tone="muted"   icon=""      active={v === "na"}   onClick={() => setItem(item.id, "na")}/>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Sign-off */}
          <div className="card" style={{ border: signoff ? "1px solid var(--success)" : "1px solid var(--border)" }}>
            <div className="card-head"><div className="card-title">Pilot sign-off</div></div>
            <div className="card-body">
              <label style={{ display: "flex", gap: 12, alignItems: "flex-start", cursor: "pointer" }}>
                <input type="checkbox" checked={signoff} onChange={e => setSignoff(e.target.checked)} style={{ marginTop: 3, width: 18, height: 18, accentColor: "var(--accent)" }}/>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>I confirm this checklist was completed honestly and the aircraft is fit to fly.</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Signed by <span style={{ color: "var(--text)" }}>{f.pilot.name}</span> · {f.pilot.license} · {new Date().toLocaleString()}
                  </div>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Sidebar widgets */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--density-gap)", alignSelf: "start", position: "sticky", top: "calc(var(--topbar-h) + 16px)" }}>
          <div className="card">
            <div className="card-head"><div className="card-title">Weather now</div></div>
            <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #fbbf24, #f59e0b)", display: "grid", placeItems: "center", color: "white" }}>
                  <Icon name="sun" size={20}/>
                </div>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1, fontFamily: "var(--font-mono)" }}>21°C</div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>Clear · feels 22°</div>
                </div>
              </div>
              {[
                ["Wind",       "8 kt SE · gust 12"],
                ["Visibility", "10+ SM"],
                ["Pressure",   "30.12 inHg"],
                ["Dew point",  "12°C"],
                ["Sunset",     "19:42"],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderTop: "1px solid var(--border)" }}>
                  <span className="muted">{k}</span>
                  <span className="mono" style={{ fontWeight: 500 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><div className="card-title">Airspace</div></div>
            <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ padding: 8, borderRadius: 6, background: "color-mix(in oklab, var(--success) 10%, transparent)", color: "var(--success)", fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="check" size={14}/> LAANC approved · 0–400 ft AGL
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderTop: "1px solid var(--border)" }}>
                <span className="muted">Class</span><span className="mono" style={{ fontWeight: 500 }}>G / E</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderTop: "1px solid var(--border)" }}>
                <span className="muted">Active NOTAMs</span><span className="mono" style={{ fontWeight: 500 }}>0</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderTop: "1px solid var(--border)" }}>
                <span className="muted">Active TFRs</span><span className="mono" style={{ fontWeight: 500 }}>0</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderTop: "1px solid var(--border)" }}>
                <span className="muted">Manned traffic</span><span className="mono" style={{ fontWeight: 500 }}>Low</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><div className="card-title">Aircraft</div></div>
            <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span className="muted">Airframe</span><span className="mono" style={{ fontWeight: 600 }}>{f.uav.id}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span className="muted">Model</span><span style={{ fontWeight: 500 }}>{f.uav.model}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span className="muted">Payload</span><span style={{ fontWeight: 500 }}>{f.uav.payload}</span>
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <span className="muted">Battery</span><span className="mono" style={{ fontWeight: 600 }}>{f.uav.battery}%</span>
                </div>
                <div style={{ height: 6, background: "var(--bg-muted)", borderRadius: 3 }}>
                  <div style={{ width: `${f.uav.battery}%`, height: "100%", background: f.uav.battery > 80 ? "var(--success)" : "var(--warning)", borderRadius: 3 }}/>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Confirm launch */}
      {confirmOpen && (
        <Modal open onClose={() => setConfirmOpen(false)} title="Confirm launch" subtitle="Final review before takeoff" icon="play" size="lg"
               footer={<>
                 <button className="btn" onClick={() => setConfirmOpen(false)}>Cancel</button>
                 <button className="btn btn-primary" onClick={handleLaunch}><Icon name="play" size={14}/> Launch mission</button>
               </>}>
          <div style={{ padding: "8px 0" }}>
            <div style={{ padding: 14, borderRadius: 10, background: "color-mix(in oklab, var(--success) 8%, transparent)", border: "1px solid var(--success)", display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <Icon name="check" size={22} style={{ color: "var(--success)" }}/>
              <div>
                <div style={{ fontWeight: 600 }}>All {CRITICAL_COUNT} critical items pass</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{stats.passed} pass · {stats.na} N/A · {stats.failed} fail (non-critical)</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, fontSize: 13 }}>
              <div><div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>Mission</div><div className="mono" style={{ marginTop: 3, fontWeight: 600 }}>{f.id}</div></div>
              <div><div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>Area</div><div style={{ marginTop: 3 }}>{f.area}</div></div>
              <div><div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>Aircraft</div><div className="mono" style={{ marginTop: 3 }}>{f.uav.id} · {f.uav.model}</div></div>
              <div><div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>PIC</div><div style={{ marginTop: 3 }}>{f.pilot.name}</div></div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CheckBtn({ label, tone, icon, active, onClick }) {
  const colors = {
    success: { bg: "var(--success)", border: "var(--success)" },
    danger:  { bg: "var(--danger)",  border: "var(--danger)" },
    muted:   { bg: "var(--text-3)",  border: "var(--text-3)" },
  };
  const c = colors[tone];
  return (
    <button onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "4px 10px", borderRadius: 6,
      border: `1px solid ${active ? c.border : "var(--border)"}`,
      background: active ? c.bg : "var(--surface)",
      color: active ? "white" : "var(--text-2)",
      fontSize: 11.5, fontWeight: 500, cursor: "pointer",
      transition: "all 0.12s"
    }}>
      {icon && <Icon name={icon} size={11}/>}
      {label}
    </button>
  );
}

Object.assign(window, { PreflightView, EmbeddedPreflightChecklist, CHECKLIST, FLAT_ITEMS, CRITICAL_COUNT, defaultPreflightState, preflightStats });
