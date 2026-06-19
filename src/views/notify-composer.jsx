import React from "react";
import { supabase } from "../api/supabase.js";
import { getCurrentPosition } from "../api/geo.js";
import { refresh } from "../store.jsx";
// Pilot Ops — Pre-flight form (PILOT VIEW)
// Pilot only sees: team selection + mission details + Start Mission button.
// Notifications, channels and automation are handled automatically per admin rules.
const { useState: ncUseState, useMemo: ncUseMemo } = React;

function NotifyComposerView({ teamRoster, fieldConfig, onOpenStream }) {
  teamRoster = teamRoster || TEAM_ROSTER;
  fieldConfig = fieldConfig || DEFAULT_FIELD_CONFIG;

  const [launched, setLaunched] = ncUseState(false);
  const [createdFlight, setCreatedFlight] = ncUseState(null);
  const [showConfirm, setShowConfirm] = ncUseState(false);
  const [authOpen, setAuthOpen] = ncUseState(false);
  // Embedded pre-flight checklist state
  const [preflightState, setPreflightState] = ncUseState(() => (window.defaultPreflightState ? window.defaultPreflightState() : {}));
  const [preflightSignoff, setPreflightSignoff] = ncUseState(false);
  const toast = useToast();

  const flightId = ncUseMemo(() => "FL-" + (2244 + Math.floor(Math.random() * 30)), []);
  const today = new Date();
  const pad = n => String(n).padStart(2, "0");
  const defaultDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const defaultTime = `${pad((today.getHours() + 1) % 24)}:15`;

  // Build role-indexed lookups
  const byRole = ncUseMemo(() => {
    const r = {};
    teamRoster.forEach(m => { (r[m.role] = r[m.role] || []).push(m); });
    return r;
  }, [teamRoster]);

  // Default team rows: Pilot (required), Co-pilot, GIS Analyst (optional)
  const [team, setTeam] = ncUseState([
    { role: "Pilot",       memberId: byRole["Pilot"]?.[0]?.id || "",       required: true },
    { role: "Co-pilot",    memberId: byRole["Co-pilot"]?.[0]?.id || "",    required: false },
    { role: "GIS Analyst", memberId: byRole["GIS Analyst"]?.[0]?.id || "", required: false },
  ]);

  const [form, setForm] = ncUseState({
    coverageArea: fieldConfig.coverageArea?.options?.[0] || "",
    coverageSize: 18.4,
    durationMin: 45,
    flightStation: STATIONS[0]?.id || "",
    uav: UAVS[0]?.id || "",
    altitude: 120,
    purpose: fieldConfig.purpose?.options?.[0] || "Routine inspection",
    scheduledDate: defaultDate,
    scheduledTime: defaultTime,
    notes: "",
  });

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const updateTeamRow = (idx, patch) => setTeam(t => t.map((r, i) => i === idx ? { ...r, ...patch } : r));
  const removeTeamRow = (idx) => setTeam(t => t.filter((_, i) => i !== idx));
  const addTeamRow = (role) => {
    const defaultMember = byRole[role]?.[0]?.id || "";
    setTeam(t => [...t, { role, memberId: defaultMember, required: false }]);
  };

  // Validation
  const pilotRow = team.find(r => r.role === "Pilot");
  const errors = {};
  if (!pilotRow || !pilotRow.memberId) errors.pilot = "Pilot is required";
  if (!form.coverageArea?.toString().trim()) errors.coverageArea = "Required";
  if (!form.durationMin || form.durationMin < 1) errors.durationMin = "Required";
  if (!form.flightStation) errors.flightStation = "Required";

  // Pre-flight checklist gating
  const pfStats = window.preflightStats ? window.preflightStats(preflightState) : { criticalFails: 0, criticalUnchecked: 99, total: 0, completed: 0 };
  const preflightOk = pfStats.criticalFails === 0 && pfStats.criticalUnchecked === 0 && preflightSignoff;
  if (!preflightOk) errors.preflight = "Pre-flight checklist not complete";

  const canFly = !window.hasPerm || window.hasPerm("flight.create");
  if (!canFly) errors.perm = "Your role can't start missions";
  const isValid = Object.keys(errors).length === 0 && canFly;

  const doLaunch = () => {
    setShowConfirm(false);
    setAuthOpen(true);
  };

  const finalLaunch = async () => {
    setAuthOpen(false);

    // Capture the pilot's real launch location (best effort — never blocks launch).
    let loc = null;
    try { loc = await getCurrentPosition(); } catch { /* permission denied / unavailable */ }

    const pilotMember = teamRoster.find(m => m.id === pilotRow?.memberId);
    const aircraft = (window.AIRCRAFT || []).find(a => a.id === form.uav);
    const scheduledAt = form.scheduledDate && form.scheduledTime
      ? new Date(`${form.scheduledDate}T${form.scheduledTime}`).toISOString() : null;

    const { data: flight, error } = await supabase.from("flights").insert({
      code: flightId,
      pilot_id: pilotRow?.memberId || null,
      aircraft_id: aircraft?.dbId || null,
      station_id: form.flightStation || null,
      area: form.coverageArea, coverage_km: form.coverageSize, purpose: form.purpose,
      altitude: form.altitude, scheduled_at: scheduledAt, started_at: new Date().toISOString(),
      status: "live",
      launch_lat: loc?.lat ?? null, launch_lng: loc?.lng ?? null,
      cur_lat: loc?.lat ?? null, cur_lng: loc?.lng ?? null,
    }).select().single();

    if (error) {
      toast({ kind: "warn", title: "Could not start mission", msg: error.message });
      return;
    }

    // Crew, pre-flight record, notification + audit trail (best effort).
    const crew = team.filter(r => r.memberId).map(r => ({ flight_id: flight.id, profile_id: r.memberId, role: r.role }));
    if (crew.length) await supabase.from("flight_crew").insert(crew);
    await supabase.from("preflight_checks").insert({
      flight_id: flight.id, state: preflightState, signoff: true,
      signed_by: pilotRow?.memberId || null, signed_at: new Date().toISOString(),
    });
    await supabase.from("notifications").insert({
      type: "mission_start", payload: { flight: flightId, area: form.coverageArea }, recipients: [],
    });
    await supabase.from("audit_log").insert({
      actor_id: pilotRow?.memberId || null, actor_name: pilotMember?.name,
      kind: "mission_start", context: flightId, detail: { area: form.coverageArea },
    });

    // Refresh the global store so the new flight shows up everywhere.
    try { await refresh(); } catch {}

    setCreatedFlight({
      id: flightId, dbId: flight.id,
      pilot: pilotMember ? { id: pilotMember.id, name: pilotMember.name, initials: pilotMember.initials, color: pilotMember.color } : null,
      uav: aircraft ? { id: aircraft.id, model: aircraft.model, payload: aircraft.payload } : null,
      area: form.coverageArea, altitude: form.altitude, status: "live",
      lat: loc?.lat, lng: loc?.lng,
    });
    setLaunched(true);
    toast({ kind: "success", title: "Mission started", msg: `${flightId} is live on the dispatch board.` });
  };

  if (launched) return <MissionStartedState flightId={flightId} team={team} teamRoster={teamRoster} form={form} createdFlight={createdFlight} onNew={() => setLaunched(false)} onOpenStream={onOpenStream}/>;

  // Coverage area renderer (dropdown vs text) based on admin config
  const renderCoverageArea = () => {
    if (fieldConfig.coverageArea?.type === "dropdown") {
      return (
        <select className="select" value={form.coverageArea} onChange={e => update("coverageArea", e.target.value)}>
          <option value="">— Select a coverage area —</option>
          {(fieldConfig.coverageArea.options || []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    return <input className="input" placeholder="e.g. Western Perimeter sweep — KP 142 to KP 158" value={form.coverageArea} onChange={e => update("coverageArea", e.target.value)}/>;
  };
  const renderPurpose = () => {
    if (fieldConfig.purpose?.type === "dropdown") {
      return (
        <select className="select" value={form.purpose} onChange={e => update("purpose", e.target.value)}>
          {(fieldConfig.purpose.options || []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    return <input className="input" value={form.purpose} onChange={e => update("purpose", e.target.value)}/>;
  };

  return (
    <div className="main-content">
      <div className="page-head">
        <div>
          <div className="topbar-crumbs">
            <span>Operations</span><Icon name="chev" size={12}/>
            <span style={{ color: "var(--text)" }}>Pre-flight</span>
          </div>
          <h1 className="page-title" style={{ marginTop: 4 }}>Start a mission</h1>
          <div className="page-sub">Fill the mission details to begin · {flightId}</div>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="doc" size={14}/> Save draft</button>
          <button className="btn btn-primary btn-lg" disabled={!isValid} onClick={() => setShowConfirm(true)} title={!isValid ? Object.values(errors)[0] : "Start mission"}>
            <Icon name="play" size={14}/> {!canFly ? "No permission to start missions" : preflightOk ? "Start mission" : "Locked — finish pre-flight"}
          </button>
        </div>
      </div>

      {/* Pilot guidance banner */}
      <div style={{ background: "var(--accent-soft)", border: "1px solid color-mix(in oklab, var(--accent) 22%, transparent)", borderRadius: 10, padding: "10px 14px", marginBottom: "var(--density-gap)", display: "flex", gap: 10, alignItems: "center", fontSize: 12.5, color: "var(--text-2)" }}>
        <Icon name="shield" size={15} stroke="var(--accent)"/>
        <span>Recording, livestream link, and stakeholder notifications are handled <strong>automatically</strong> per admin rules — you don't need to configure them.</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "var(--density-gap)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--density-gap)" }}>
          {/* Team section */}
          <FormCard n="1" title="Mission team" subtitle="Select team members from the roster">
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {team.map((row, idx) => {
                const candidates = byRole[row.role] || [];
                const selected = teamRoster.find(m => m.id === row.memberId);
                return (
                  <div key={idx} style={{ display: "grid", gridTemplateColumns: "160px 1fr 32px", gap: 10, alignItems: "center", padding: "10px 12px", background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="pill" style={{ background: row.required ? "var(--accent-soft)" : "var(--bg-muted)", color: row.required ? "var(--accent)" : "var(--text-2)", borderColor: row.required ? "color-mix(in oklab, var(--accent) 25%, transparent)" : "var(--border)" }}>
                        {row.role}{row.required && " *"}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {selected && (
                        <div className="user-avatar" style={{ width: 28, height: 28, fontSize: 11, background: `linear-gradient(135deg, ${selected.color}, color-mix(in oklab, ${selected.color} 70%, #000))` }}>{selected.initials}</div>
                      )}
                      <select className="select" value={row.memberId} onChange={e => updateTeamRow(idx, { memberId: e.target.value })} style={{ flex: 1 }}>
                        <option value="">— Select {row.role.toLowerCase()} —</option>
                        {candidates.map(m => <option key={m.id} value={m.id}>{m.name}{m.license ? " · " + m.license : ""}</option>)}
                      </select>
                    </div>
                    {!row.required ? (
                      <button className="iconbtn" onClick={() => removeTeamRow(idx)} title="Remove"><Icon name="x" size={14}/></button>
                    ) : <div/>}
                  </div>
                );
              })}
            </div>
            {errors.pilot && <div style={{ fontSize: 11.5, color: "var(--danger)", marginTop: 8 }}>{errors.pilot}</div>}

            {/* Add another role */}
            <div style={{ marginTop: 12 }}>
              <div className="muted" style={{ fontSize: 11.5, marginBottom: 6 }}>Add another team member</div>
              <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                {TEAM_ROLES.filter(r => (byRole[r] || []).length > 0).map(r => (
                  <button key={r} className="pill" style={{ cursor: "pointer" }} onClick={() => addTeamRow(r)}>
                    <Icon name="plus" size={10}/> {r}
                  </button>
                ))}
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
                <Icon name="users" size={11}/>
                Don't see a name? Ask admin to add team members in <strong>Admin → Team roster</strong>.
              </div>
            </div>
          </FormCard>

          {/* Pre-flight checklist */}
          <FormCard n="2" title="Pre-flight checklist" subtitle="All critical items must pass before launch · manual sign-off required">
            {window.EmbeddedPreflightChecklist ? (
              <EmbeddedPreflightChecklist
                state={preflightState}
                setState={setPreflightState}
                signoff={preflightSignoff}
                setSignoff={setPreflightSignoff}
                pilotName={teamRoster.find(m => m.id === pilotRow?.memberId)?.name}/>
            ) : (
              <div className="muted" style={{ fontSize: 13 }}>Pre-flight checklist unavailable.</div>
            )}
          </FormCard>

          {/* Mission */}
          <FormCard n="3" title="Mission details" subtitle="Coverage, station, schedule">
            <Field label="Coverage area" error={errors.coverageArea} required hint={fieldConfig.coverageArea?.type === "dropdown" ? "Choose from approved areas" : "Free-form description"}>
              {renderCoverageArea()}
            </Field>
            <div className="grid-3" style={{ marginTop: 14 }}>
              <Field label="Coverage size" hint="km²">
                <div style={{ position: "relative" }}>
                  <input className="input mono" type="number" step="0.1" value={form.coverageSize} onChange={e => update("coverageSize", +e.target.value)} style={{ paddingRight: 40 }}/>
                  <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "var(--text-3)" }} className="mono">km²</span>
                </div>
              </Field>
              <Field label="Duration" error={errors.durationMin} required hint="minutes">
                <div style={{ position: "relative" }}>
                  <input className="input mono" type="number" value={form.durationMin} onChange={e => update("durationMin", +e.target.value)} style={{ paddingRight: 40 }}/>
                  <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "var(--text-3)" }} className="mono">min</span>
                </div>
              </Field>
              <Field label="Cruise altitude" hint="m AGL">
                <div style={{ position: "relative" }}>
                  <input className="input mono" type="number" value={form.altitude} onChange={e => update("altitude", +e.target.value)} style={{ paddingRight: 50 }}/>
                  <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "var(--text-3)" }} className="mono">m</span>
                </div>
              </Field>
            </div>
            <div className="grid-2" style={{ marginTop: 14 }}>
              <Field label="Flight station" error={errors.flightStation} required>
                <select className="select" value={form.flightStation} onChange={e => update("flightStation", e.target.value)}>
                  {STATIONS.map(s => <option key={s.id} value={s.id}>{s.name} · {s.coords}</option>)}
                </select>
              </Field>
              <Field label="UAV asset">
                <select className="select" value={form.uav} onChange={e => update("uav", e.target.value)}>
                  {UAVS.map(u => <option key={u.id} value={u.id}>{u.id} · {u.model} ({u.battery}% batt)</option>)}
                </select>
              </Field>
              <Field label="Scheduled date">
                <input className="input mono" type="date" value={form.scheduledDate} onChange={e => update("scheduledDate", e.target.value)}/>
              </Field>
              <Field label="Scheduled takeoff time">
                <input className="input mono" type="time" value={form.scheduledTime} onChange={e => update("scheduledTime", e.target.value)}/>
              </Field>
              <Field label="Mission purpose">
                {renderPurpose()}
              </Field>
              <Field label="Operations notes" hint="optional context">
                <input className="input" placeholder="e.g. Watch for movement near east fence" value={form.notes} onChange={e => update("notes", e.target.value)}/>
              </Field>
            </div>
          </FormCard>
        </div>

        {/* Right column: summary preview */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--density-gap)" }}>
          <div className="card">
            <div className="card-head"><div className="card-title">Mission summary</div></div>
            <div style={{ padding: 4 }}>
              {[
                ["Flight ID", flightId],
                ["Team", team.filter(r => r.memberId).length + " members"],
                ["Area", form.coverageArea || "—"],
                ["Coverage", form.coverageSize + " km²"],
                ["When", `${form.scheduledDate} · ${form.scheduledTime}`],
                ["Duration", form.durationMin + " min"],
                ["Altitude", form.altitude + " m AGL"],
                ["Station", STATIONS.find(s => s.id === form.flightStation)?.name],
                ["UAV", form.uav],
                ["Purpose", form.purpose],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "grid", gridTemplateColumns: "76px 1fr", gap: 8, padding: "6px 12px", fontSize: 12 }}>
                  <span className="muted">{k}</span>
                  <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><div className="card-title">Team on this mission</div></div>
            <div style={{ padding: 4 }}>
              {team.filter(r => r.memberId).map((r, i) => {
                const m = teamRoster.find(x => x.id === r.memberId);
                if (!m) return null;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8 }}>
                    <div className="user-avatar" style={{ width: 30, height: 30, fontSize: 11, background: `linear-gradient(135deg, ${m.color}, color-mix(in oklab, ${m.color} 70%, #000))` }}>{m.initials}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 500 }}>{m.name}</div>
                      <div className="muted" style={{ fontSize: 10.5 }}>{r.role}{m.license ? " · " + m.license : ""}</div>
                    </div>
                  </div>
                );
              })}
              {team.filter(r => r.memberId).length === 0 && (
                <div className="muted" style={{ padding: 14, fontSize: 12.5, textAlign: "center" }}>No team members selected yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <Modal open={showConfirm} onClose={() => setShowConfirm(false)} icon="play"
        title="Start mission?"
        subtitle="Once started, the flight goes live on the dispatch board and recording begins."
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setShowConfirm(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={doLaunch}><Icon name="play" size={13}/> Start mission</button>
          </>
        }>
        <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>This will:</div>
        <ul style={{ paddingLeft: 18, lineHeight: 1.7, fontSize: 13, color: "var(--text-2)", margin: 0 }}>
          <li>Register flight <strong className="mono" style={{ color: "var(--text)" }}>{flightId}</strong> on the dispatch board</li>
          <li>Arm auto-record on takeoff</li>
          <li>Dispatch stakeholder notifications per the admin's pre-flight rule</li>
          <li>Open the livestream view for you</li>
        </ul>
      </Modal>

      {/* Pilot identity confirmation — uses the real roster member (profile id). */}
      {window.PilotAuthModal && (() => {
        const pilotForAuth = teamRoster.find(m => m.id === pilotRow?.memberId) || null;
        return pilotForAuth ? (
          <PilotAuthModal
            open={authOpen}
            onClose={() => setAuthOpen(false)}
            pilot={pilotForAuth}
            context={`Start mission ${flightId}`}
            onConfirmed={finalLaunch}/>
        ) : null;
      })()}
    </div>
  );
}

/* ---------- Helpers ---------- */
function FormCard({ n, title, subtitle, children }) {
  return (
    <div className="card">
      <div className="card-head" style={{ gap: 14 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 12, fontFamily: "var(--font-mono)", flexShrink: 0 }}>{n}</div>
        <div>
          <div className="card-title">{title}</div>
          {subtitle && <div className="card-sub">{subtitle}</div>}
        </div>
      </div>
      <div className="card-body">{children}</div>
    </div>
  );
}

function Field({ label, hint, error, required, children }) {
  return (
    <div className="field">
      <label className="field-label">{label}{required && <span className="req">*</span>}{error && <span style={{ marginLeft: "auto", color: "var(--danger)", fontWeight: 500 }}>{error}</span>}</label>
      {children}
      {hint && !error && <div className="field-hint">{hint}</div>}
    </div>
  );
}

function MissionStartedState({ flightId, team, teamRoster, form, createdFlight, onNew, onOpenStream }) {
  const filled = team.filter(r => r.memberId);
  const flightForStream = createdFlight || ACTIVE_FLIGHTS[0]; // the flight we just created
  return (
    <div className="main-content" style={{ display: "grid", placeItems: "center", minHeight: 600 }}>
      <div className="card" style={{ maxWidth: 560, width: "100%" }}>
        <div className="card-body" style={{ textAlign: "center", padding: 40 }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--success-soft)", color: "var(--success)", display: "grid", placeItems: "center", margin: "0 auto 18px" }}>
            <Icon name="play" size={28} fill="currentColor" stroke="currentColor"/>
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>Mission started</h2>
          <div className="muted" style={{ fontSize: 13.5, marginTop: 8, lineHeight: 1.5 }}>
            <strong className="mono" style={{ color: "var(--text)" }}>{flightId}</strong> is live.<br/>
            Stakeholders notified automatically.
          </div>

          <div style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 10, padding: 16, marginTop: 22, textAlign: "left" }}>
            {[
              ["Area", form.coverageArea],
              ["When", `${form.scheduledDate} · ${form.scheduledTime}`],
              ["Duration", form.durationMin + " min"],
              ["Team", filled.length + " members"],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 8, padding: "4px 0", fontSize: 12.5 }}>
                <span className="muted">{k}</span>
                <span style={{ fontWeight: 500 }}>{v}</span>
              </div>
            ))}
          </div>

          <div className="row" style={{ gap: 8, marginTop: 22, justifyContent: "center" }}>
            <button className="btn" onClick={onNew}><Icon name="plus" size={13}/> New mission</button>
            <button className="btn btn-primary" onClick={() => onOpenStream && onOpenStream(flightForStream)}><Icon name="video" size={13}/> Open livestream</button>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { NotifyComposerView });
