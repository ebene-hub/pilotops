import React from "react";
import { supabase } from "../api/supabase.js";
import { getCurrentPosition } from "../api/geo.js";
import { refresh } from "../store.jsx";
// Pilot Ops — Pre-flight form (PILOT VIEW)
// Pilot only sees: team selection + mission details + Start Mission button.
// Notifications, channels and automation are handled automatically per admin rules.
const { useState: ncUseState, useMemo: ncUseMemo, useEffect: ncUseEffect } = React;

function NotifyComposerView({ teamRoster, fieldConfig, onOpenStream }) {
  teamRoster = teamRoster || TEAM_ROSTER;
  fieldConfig = fieldConfig || DEFAULT_FIELD_CONFIG;

  const [launched, setLaunched] = ncUseState(false);
  const [createdFlight, setCreatedFlight] = ncUseState(null);
  const [pairCode, setPairCode] = ncUseState(null);
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

  // Pilot in command is ALWAYS the signed-in user (fixed). They pick a co-pilot
  // (any registered Pilot or Co-pilot) and optionally other crew.
  const myId = window.__poUser?.id || "";
  const draftKey = `po:mission-draft:${myId}`;
  const loadDraft = () => { try { return JSON.parse(localStorage.getItem(draftKey) || "null"); } catch { return null; } };

  const [team, setTeam] = ncUseState(() => {
    const d = loadDraft();
    if (d?.team?.length) {
      // Always keep the PIC row as the signed-in user and locked.
      return d.team.map(r => r.role === "Pilot" ? { ...r, memberId: myId, required: true, locked: true } : r);
    }
    return [
      { role: "Pilot",       memberId: myId, required: true, locked: true },
      { role: "Co-pilot",    memberId: "",   required: false },
      { role: "GIS Analyst", memberId: "",   required: false },
    ];
  });

  const [form, setForm] = ncUseState(() => {
    const d = loadDraft();
    return d?.form || {
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
    };
  });

  const saveDraft = () => {
    try {
      localStorage.setItem(draftKey, JSON.stringify({ form, team }));
      toast({ kind: "success", title: "Draft saved", msg: "Your mission setup is saved on this device — it'll be here when you return." });
    } catch { toast({ kind: "warn", title: "Couldn't save draft", msg: "Local storage is unavailable." }); }
  };

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Pull fresh crew/flight data when this view opens so the busy-crew set and the
  // "you're already assigned" check reflect what just happened on other sessions.
  const [, setTick] = ncUseState(0);
  ncUseEffect(() => { let on = true; (async () => { try { await refresh(); } catch {} if (on) setTick(t => t + 1); })(); return () => { on = false; }; }, []);

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
      // DB-level crew exclusivity (migration 0023): a pilot already on a live
      // mission can't start another.
      const msg = /PILOT_BUSY/.test(error.message)
        ? "You're already assigned to a live mission — end it before starting another."
        : error.message;
      toast({ kind: "warn", title: "Could not start mission", msg });
      return;
    }

    // Crew rows one at a time so one just-booked member doesn't block the rest;
    // the DB rejects anyone double-booked (CREW_BUSY) as a race-proof backstop.
    const crewRows = team.filter(r => r.memberId).map(r => ({ flight_id: flight.id, profile_id: r.memberId, role: r.role }));
    const droppedCrew = [];
    for (const c of crewRows) {
      const { error: ce } = await supabase.from("flight_crew").insert(c);
      if (ce && c.profile_id !== pilotRow?.memberId) {
        droppedCrew.push(teamRoster.find(m => m.id === c.profile_id)?.name || "A crew member");
      }
    }
    if (droppedCrew.length) {
      toast({ kind: "warn", title: "Some crew were unavailable", msg: `${droppedCrew.join(", ")} got assigned to another mission and weren't added.` });
    }
    await supabase.from("preflight_checks").insert({
      flight_id: flight.id, state: preflightState, signoff: true,
      signed_by: pilotRow?.memberId || null, signed_at: new Date().toISOString(),
    });
    // Notify the live-stream link to admins (in-app bell) + stakeholders who opted
    // into pre-flight notices (their emails are recorded for delivery).
    const streamLink = (typeof window !== "undefined" ? window.location.origin : "") + "/";
    const recipients = (window.STAKEHOLDERS || [])
      .filter((s) => (s.notify || []).includes("pre-flight") && s.email)
      .map((s) => ({ name: s.name, email: s.email }));
    await supabase.from("notifications").insert({
      type: "mission_start",
      payload: { flight: flightId, area: form.coverageArea, link: streamLink },
      recipients,
    });
    await supabase.from("audit_log").insert({
      actor_id: pilotRow?.memberId || null, actor_name: pilotMember?.name,
      kind: "mission_start", context: flightId, detail: { area: form.coverageArea },
    });

    // Mint a pairing code so the pilot can bind the GGIS UAV Companion app on
    // the controller to this flight (works for co-pilots / shared controllers).
    try {
      const { data: code } = await supabase.rpc("start_pairing", { p_flight: flight.id });
      if (code) setPairCode(code);
    } catch {}

    // The mission is live — clear the saved draft so it doesn't reappear.
    try { localStorage.removeItem(draftKey); } catch {}

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

  if (launched) return <MissionStartedState flightId={flightId} team={team} teamRoster={teamRoster} form={form} createdFlight={createdFlight} pairCode={pairCode} onNew={() => { setLaunched(false); setPairCode(null); }} onOpenStream={onOpenStream}/>;

  // If the signed-in user is already committed to a live mission as crew (e.g.
  // picked as co-pilot by another PIC), they can't start their own. Show what
  // they're assigned to instead of the start-mission form.
  const myAssignment = (window.CREW_ASSIGNMENTS || {})[myId];
  if (myAssignment && myAssignment.picId && myAssignment.picId !== myId) {
    const assignedFlight = (window.ACTIVE_FLIGHTS || []).find(f => f.dbId === myAssignment.flightId) || null;
    return <MissionAssignedState assignment={myAssignment} flight={assignedFlight} teamRoster={teamRoster} myId={myId} onOpenStream={onOpenStream}/>;
  }

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
          <button className="btn" onClick={saveDraft}><Icon name="doc" size={14}/> Save draft</button>
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
          <FormCard n="1" title="Mission team" subtitle="You are the pilot in command. Add a co-pilot (a registered pilot or co-pilot) and any crew.">
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {team.map((row, idx) => {
                // Co-pilot can be any registered Pilot or Co-pilot (excluding the PIC).
                const base = row.role === "Co-pilot"
                  ? [...(byRole["Pilot"] || []), ...(byRole["Co-pilot"] || [])].filter((m, i, arr) => m.id !== myId && arr.findIndex(x => x.id === m.id) === i)
                  : (byRole[row.role] || []);
                // Exclude anyone already committed to a live mission, or already
                // picked in another row of this form — so crew can't be double-booked.
                const busy = window.CREW_ASSIGNMENTS || {};
                const chosenElsewhere = new Set(team.filter((_, i) => i !== idx).map(r => r.memberId).filter(Boolean));
                const candidates = base.filter(m => m.id === row.memberId || (!busy[m.id] && !chosenElsewhere.has(m.id)));
                const selected = teamRoster.find(m => m.id === row.memberId) || (row.locked ? { name: window.__poUser?.name, initials: window.__poUser?.initials, color: "#2563eb" } : null);
                return (
                  <div key={idx} style={{ display: "grid", gridTemplateColumns: "160px 1fr 32px", gap: 10, alignItems: "center", padding: "10px 12px", background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="pill" style={{ background: row.required ? "var(--accent-soft)" : "var(--bg-muted)", color: row.required ? "var(--accent)" : "var(--text-2)", borderColor: row.required ? "color-mix(in oklab, var(--accent) 25%, transparent)" : "var(--border)" }}>
                        {row.role}{row.required && " *"}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {selected && (
                        <div className="user-avatar" style={{ width: 28, height: 28, fontSize: 11, background: `linear-gradient(135deg, ${selected.color || "#2563eb"}, color-mix(in oklab, ${selected.color || "#2563eb"} 70%, #000))` }}>{selected.initials || "—"}</div>
                      )}
                      {row.locked ? (
                        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selected?.name || "You"}</span>
                          <span className="pill" style={{ background: "var(--bg-muted)", color: "var(--text-3)", fontSize: 9.5 }}>You · pilot in command</span>
                        </div>
                      ) : (
                        <select className="select" value={row.memberId} onChange={e => updateTeamRow(idx, { memberId: e.target.value })} style={{ flex: 1 }}>
                          <option value="">— Select {row.role.toLowerCase()} —</option>
                          {candidates.map(m => <option key={m.id} value={m.id}>{m.name}{m.shortId ? " · " + m.shortId : ""}</option>)}
                        </select>
                      )}
                    </div>
                    {(!row.required && !row.locked) ? (
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

// Watches a flight's stream_status so the pairing panel flips to "connected"
// the moment the controller starts casting.
function ControllerPairing({ dbId, pairCode }) {
  const [connected, setConnected] = ncUseState(false);
  ncUseEffect(() => {
    if (!dbId) return;
    let channel, stop = false;
    supabase.from("flights").select("stream_status").eq("id", dbId).maybeSingle()
      .then(({ data }) => { if (!stop && data?.stream_status === "live") setConnected(true); });
    channel = supabase.channel("pair:" + dbId)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "flights", filter: "id=eq." + dbId },
        (p) => { if (p.new?.stream_status === "live") setConnected(true); })
      .subscribe();
    return () => { stop = true; channel && supabase.removeChannel(channel); };
  }, [dbId]);

  return (
    <div style={{ background: connected ? "var(--success-soft)" : "var(--accent-soft)", border: "1px solid " + (connected ? "var(--success)" : "var(--accent)"), borderRadius: 10, padding: 18, marginTop: 18, textAlign: "center" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Pair your controller</div>
      {pairCode ? (
        <div className="mono" style={{ fontSize: 34, fontWeight: 700, letterSpacing: 8, margin: "8px 0 4px" }}>{pairCode}</div>
      ) : (
        <div className="muted" style={{ fontSize: 13, margin: "10px 0" }}>Generating code…</div>
      )}
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
        Open <strong>GGIS UAV Companion</strong> on the controller, sign in, and enter this code to start casting.
      </div>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 12.5, fontWeight: 600, color: connected ? "var(--success)" : "var(--accent)" }}>
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: "currentColor", animation: connected ? "none" : "pulse 1.5s infinite" }}/>
        {connected ? "Controller connected — feed is live" : "Waiting for controller…"}
      </div>
    </div>
  );
}

function MissionStartedState({ flightId, team, teamRoster, form, createdFlight, pairCode, onNew, onOpenStream }) {
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

          <ControllerPairing dbId={flightForStream?.dbId} pairCode={pairCode}/>

          <div className="row" style={{ gap: 8, marginTop: 22, justifyContent: "center" }}>
            <button className="btn" onClick={onNew}><Icon name="plus" size={13}/> New mission</button>
            <button className="btn btn-primary" onClick={() => onOpenStream && onOpenStream(flightForStream)}><Icon name="video" size={13}/> Open livestream</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Shown to a crew member (e.g. a pilot picked as co-pilot) who is already
// committed to a live mission — they can't start their own until it ends.
function MissionAssignedState({ assignment, flight, teamRoster, myId, onOpenStream }) {
  const crew = (window.LIVE_CREW_BY_FLIGHT || {})[assignment.flightId] || [];
  const rosterById = (id) => (teamRoster || []).find(m => m.id === id) || {};
  return (
    <div className="main-content">
      <div className="page-head">
        <div>
          <div className="topbar-crumbs"><span>Operations</span><Icon name="chev" size={12}/><span style={{ color: "var(--text)" }}>Pre-flight</span></div>
          <h1 className="page-title" style={{ marginTop: 4 }}>Start a mission</h1>
          <div className="page-sub">You're already assigned to an active mission</div>
        </div>
      </div>
      <div style={{ display: "grid", placeItems: "center", minHeight: 440 }}>
        <div className="card" style={{ maxWidth: 520, width: "100%" }}>
          <div className="card-body" style={{ padding: 32 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                <Icon name="users" size={22}/>
              </div>
              <div>
                <h2 style={{ fontSize: 18, margin: 0 }}>You're on a live mission</h2>
                <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                  Assigned as <strong>{assignment.role}</strong> on <strong className="mono">{assignment.code}</strong> under <strong>{assignment.picName}</strong>.
                </div>
              </div>
            </div>
            <div style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 11.5, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Mission</div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{assignment.area || assignment.code}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "14px 0 6px" }}>Team on this mission</div>
              {crew.map((m, i) => {
                const a = rosterById(m.id);
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
                    <div className="user-avatar" style={{ width: 30, height: 30, fontSize: 11, background: `linear-gradient(135deg, ${a.color || "#2563eb"}, color-mix(in oklab, ${a.color || "#2563eb"} 70%, #000))` }}>{a.initials || (m.name || "?").split(" ").map(w => w[0]).slice(0, 2).join("")}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 500 }}>{m.name}{m.id === myId ? " (you)" : ""}</div>
                      <div className="muted" style={{ fontSize: 10.5 }}>{m.role}{m.id === assignment.picId ? " · pilot in command" : ""}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 14, display: "flex", gap: 8, alignItems: "flex-start" }}>
              <Icon name="info" size={13} style={{ marginTop: 1, flexShrink: 0 }}/>
              <span>You can't start a new mission while you're part of one. You'll be free to start your own once <strong className="mono">{assignment.code}</strong> ends.</span>
            </div>
            {flight && (
              <div className="row" style={{ marginTop: 18, justifyContent: "flex-end" }}>
                <button className="btn btn-primary" onClick={() => onOpenStream && onOpenStream(flight)}><Icon name="video" size={13}/> Open livestream</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { NotifyComposerView });
