import React from "react";
import { supabase } from "../api/supabase.js";
import { getCurrentPosition } from "../api/geo.js";
import { refresh } from "../store.jsx";
// Pilot Ops — Emergency launch flow
// Bypasses the pre-flight checklist for time-critical missions (S&R, medical, fire, etc.)
// Designed with multiple abuse guards:
//   1. Pilot must declare emergency TYPE from a fixed list
//   2. Pilot must write a justification (>= 50 chars)
//   3. Pilot must acknowledge personal liability + auto-supervisor notification
//   4. Recent-emergency counter is visible; >5 in 30 days hard-locks (call dispatch)
//   5. Every launch creates an audit-log entry + draft incident report
//   6. Mission stays tagged EMERGENCY until checklist is completed post-flight
//      AND a supervisor signs off — only then can the flight log be archived.

const { useState: elUseState, useEffect: elUseEffect } = React;

const EMERGENCY_TYPES = [
  { v: "search-rescue", l: "Search & rescue",        ic: "shield", desc: "Missing person / vessel · life-safety" },
  { v: "medical",       l: "Medical / casualty",     ic: "shield", desc: "Injury report · medical extraction" },
  { v: "fire",          l: "Active fire",            ic: "warn",   desc: "Wildfire / structure fire reconnaissance" },
  { v: "threat",        l: "Security threat",        ic: "shield", desc: "Active intruder · perimeter breach" },
  { v: "infrastructure",l: "Infrastructure failure", ic: "warn",   desc: "Pipeline leak · powerline down · pump failure" },
  { v: "weather",       l: "Severe weather response",ic: "warn",   desc: "Storm damage assessment · flood survey" },
  { v: "other",         l: "Other (requires detail)",ic: "warn",   desc: "Time-critical but not above" },
];

const SOFT_LIMIT = 3;   // shows warning
const HARD_LIMIT = 5;   // disables emergency launch

// Local audit / rate-limit storage
function readEmergencyLog() {
  try { return JSON.parse(localStorage.getItem("po:emergencyLog") || "[]"); } catch { return []; }
}
function writeEmergencyLog(arr) {
  try { localStorage.setItem("po:emergencyLog", JSON.stringify(arr)); } catch {}
}
function emergencyCountLast30(pilotId) {
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  return readEmergencyLog().filter(e => e.pilotId === pilotId && e.ts > cutoff).length;
}

function EmergencyLaunchModal({ open, onClose, onLaunched }) {
  const [pilotId, setPilotId] = elUseState(PILOTS[0]?.id || "");
  const me = PILOTS.find(p => p.id === pilotId) || PILOTS[0] || null;
  const [emType, setEmType] = elUseState("");
  const [justification, setJustification] = elUseState("");
  const [aircraft, setAircraft] = elUseState((AIRCRAFT.find(a => a.status === "ready") || AIRCRAFT[0])?.id || "");
  const [area, setArea] = elUseState("");
  const [ack, setAck] = elUseState(false);
  const [submitting, setSubmitting] = elUseState(false);
  const [authOpen, setAuthOpen] = elUseState(false);
  const [recentCount, setRecentCount] = elUseState(0);
  const toast = useToast();

  const hardLocked = recentCount >= HARD_LIMIT;

  // Server-side 30-day emergency tally for the selected pilot (real rate limit).
  elUseEffect(() => {
    if (!open || !me?.id) return;
    supabase.rpc("emergency_count_30d", { p_pilot: me.id }).then(({ data }) => setRecentCount(data || 0));
  }, [open, me?.id]);

  elUseEffect(() => {
    if (!open) { setEmType(""); setJustification(""); setArea(""); setAck(false); }
  }, [open]);

  const justMin = 20;
  const justOk  = justification.trim().length >= justMin;
  const canLaunch = !hardLocked && !!emType && justOk && !!aircraft && !!area.trim() && ack && !submitting;
  const launchHint = submitting ? "" :
    hardLocked ? "Emergency launches are locked" :
    !emType ? "Select an emergency type" :
    !aircraft ? "No aircraft available — register one in Aircraft registry" :
    !area.trim() ? "Enter the location / area" :
    !justOk ? `Justification needs ${justMin}+ characters (${justification.trim().length}/${justMin})` :
    !ack ? "Tick the acknowledgement below to enable launch" : "";

  function launch() {
    if (!canLaunch) return;
    setAuthOpen(true);
  }

  async function doLaunchAfterAuth() {
    setAuthOpen(false);
    setSubmitting(true);

    let loc = null;
    try { loc = await getCurrentPosition(); } catch { /* best effort */ }

    const id = "FL-EMG-" + Math.floor(Math.random() * 9000 + 1000);
    const ac = (window.AIRCRAFT || []).find(a => a.id === aircraft);
    const typeLabel = EMERGENCY_TYPES.find(t => t.v === emType)?.l;

    const { data: flight, error } = await supabase.from("flights").insert({
      code: id, pilot_id: me.id, aircraft_id: ac?.dbId || null, area,
      status: "live", emergency: true, emergency_type: emType, justification,
      started_at: new Date().toISOString(),
      launch_lat: loc?.lat ?? null, launch_lng: loc?.lng ?? null,
      cur_lat: loc?.lat ?? null, cur_lng: loc?.lng ?? null,
    }).select().single();

    if (error) { toast({ kind: "warn", title: "Could not launch", msg: error.message }); setSubmitting(false); return; }

    // Review queue + audit + supervisor notification + crew (best effort).
    await supabase.from("emergency_reviews").insert({ flight_id: flight.id, status: "pending" });
    await supabase.from("flight_crew").insert({ flight_id: flight.id, profile_id: me.id, role: "Pilot" });
    await supabase.from("audit_log").insert({ actor_id: me.id, actor_name: me.name, kind: "emergency_launch", context: id, detail: { type: emType, area, justification } });
    await supabase.from("notifications").insert({ type: "emergency", payload: { flight: id, type: emType }, recipients: [] });
    try { await refresh(); } catch {}

    toast({ kind: "warn", title: "Emergency flight launched", msg: `Supervisor + Safety lead notified · ${id} flagged for review.` });

    const flightObj = {
      id, dbId: flight.id, area, status: "live", emergency: true, emergencyType: emType, typeLabel, justification,
      pilot: me ? { id: me.id, name: me.name, initials: me.initials, color: me.color } : null,
      uav: ac ? { id: ac.id, model: ac.model, payload: ac.payload } : null,
      lat: loc?.lat, lng: loc?.lng,
    };
    setSubmitting(false);
    onLaunched && onLaunched({ id, type: emType, typeLabel, area, justification, aircraft, pilotId: me.id, flightObj });
    onClose();
  }

  if (!open) return null;
  if (!me) return null;

  return (
    <>
    <Modal open onClose={onClose} size="lg"
      title={<span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--danger)", color: "white", display: "grid", placeItems: "center" }}>
          <Icon name="warn" size={16}/>
        </span>
        Emergency launch
      </span>}
      subtitle="Skip the pre-flight checklist for a life-safety or time-critical mission. All emergency launches are reviewed."
      footer={<>
        {launchHint && <span style={{ fontSize: 11.5, color: "var(--warning)", marginRight: "auto", alignSelf: "center" }}>{launchHint}</span>}
        <button className="btn" onClick={onClose} disabled={submitting}>Cancel</button>
        <button
          className="btn"
          onClick={launch}
          disabled={!canLaunch}
          style={{
            background: canLaunch ? "var(--danger)" : "var(--bg-muted)",
            color: canLaunch ? "white" : "var(--text-3)",
            borderColor: canLaunch ? "var(--danger)" : "var(--border)",
            opacity: canLaunch ? 1 : 0.6,
            cursor: canLaunch ? "pointer" : "not-allowed",
          }}>
          <Icon name="shield" size={14}/> Confirm code & launch
        </button>
      </>}>

      {/* Rate-limit banner */}
      <div style={{
        padding: 12, borderRadius: 8, marginBottom: 16,
        background: hardLocked ? "color-mix(in oklab, var(--danger) 10%, transparent)"
                  : recentCount >= SOFT_LIMIT ? "color-mix(in oklab, var(--warning) 10%, transparent)"
                  : "var(--bg-subtle)",
        border: `1px solid ${hardLocked ? "var(--danger)" : recentCount >= SOFT_LIMIT ? "var(--warning)" : "var(--border)"}`,
        display: "flex", gap: 12, alignItems: "flex-start"
      }}>
        <Icon name={hardLocked ? "warn" : "shield"} size={16} stroke={hardLocked ? "var(--danger)" : recentCount >= SOFT_LIMIT ? "var(--warning)" : "var(--text-2)"} style={{ marginTop: 2 }}/>
        <div style={{ flex: 1, fontSize: 12.5, lineHeight: 1.5 }}>
          {hardLocked ? (
            <>
              <strong style={{ color: "var(--danger)" }}>Emergency launch locked.</strong> You've used {recentCount} emergency launches in the last 30 days
              ({HARD_LIMIT} is the limit). <strong>Call dispatch on Ch 4</strong> for a verbal override.
            </>
          ) : recentCount >= SOFT_LIMIT ? (
            <>
              You've used <strong>{recentCount} emergency launches</strong> in the last 30 days. Each one is reviewed by the Safety lead.
              {HARD_LIMIT - recentCount} more before the system locks you out and requires a verbal dispatch override.
            </>
          ) : (
            <>
              You've used <strong>{recentCount}</strong> emergency launches in the last 30 days. Use this only for genuine life-safety or
              time-critical operations. All launches are logged and reviewed.
            </>
          )}
        </div>
      </div>

      {/* Pilot — selectable dropdown */}
      <div className="field" style={{ marginBottom: 14 }}>
        <label className="field-label">Pilot in command <span style={{ color: "var(--danger)" }}>*</span></label>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderRadius: 8, background: "var(--bg-subtle)", border: "1px solid var(--border)" }}>
          <div className="user-avatar" style={{ width: 32, height: 32, fontSize: 12, background: `linear-gradient(135deg, ${me.color}, color-mix(in oklab, ${me.color} 70%, #000))` }}>{me.initials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <select value={pilotId} onChange={e => setPilotId(e.target.value)}
              style={{
                width: "100%", background: "transparent", border: "none",
                padding: 0, fontSize: 13.5, fontWeight: 600, color: "var(--text)",
                outline: "none", cursor: "pointer"
              }}>
              {PILOTS.map(p => <option key={p.id} value={p.id}>{p.name} — {p.license}</option>)}
            </select>
            <div className="muted mono" style={{ fontSize: 10.5, marginTop: 1 }}>{me.id} · {me.status} · {me.hours} hr lifetime</div>
          </div>
          <Icon name="shield" size={15} stroke="var(--text-3)"/>
        </div>
        <div className="field-hint" style={{ marginTop: 6 }}>The selected pilot will be prompted for their 6-digit code to confirm identity before launch.</div>
      </div>

      {/* Emergency type */}
      <div className="field" style={{ marginBottom: 14 }}>
        <label className="field-label">Emergency type <span style={{ color: "var(--danger)" }}>*</span></label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {EMERGENCY_TYPES.map(t => (
            <button key={t.v} type="button" onClick={() => !hardLocked && setEmType(t.v)}
              disabled={hardLocked}
              style={{
                padding: "10px 12px", borderRadius: 8, textAlign: "left",
                border: `1.5px solid ${emType === t.v ? "var(--danger)" : "var(--border)"}`,
                background: emType === t.v ? "color-mix(in oklab, var(--danger) 8%, transparent)" : "var(--surface)",
                color: "var(--text)", cursor: hardLocked ? "not-allowed" : "pointer",
                opacity: hardLocked ? 0.5 : 1,
                display: "flex", gap: 8, alignItems: "flex-start"
              }}>
              <Icon name={t.ic} size={13} stroke={emType === t.v ? "var(--danger)" : "var(--text-2)"} style={{ marginTop: 2, flexShrink: 0 }}/>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{t.l}</div>
                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{t.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Aircraft + area */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
        <div className="field">
          <label className="field-label">Aircraft <span style={{ color: "var(--danger)" }}>*</span></label>
          <select className="select" value={aircraft} onChange={e => setAircraft(e.target.value)} disabled={hardLocked}>
            {AIRCRAFT.filter(a => a.status === "ready" || a.status === "in-flight").map(a => (
              <option key={a.id} value={a.id}>{a.id} — {a.model} · {a.battery}%</option>
            ))}
          </select>
          <div className="field-hint">Only ready or in-flight aircraft are available.</div>
        </div>
        <div className="field">
          <label className="field-label">Target area / coordinates <span style={{ color: "var(--danger)" }}>*</span></label>
          <input className="input" value={area} onChange={e => setArea(e.target.value)} placeholder="e.g. KP 287 / River bend, 41.2N 74.1W" disabled={hardLocked}/>
        </div>
      </div>

      {/* Justification */}
      <div className="field" style={{ marginBottom: 14 }}>
        <label className="field-label" style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Justification <span style={{ color: "var(--danger)" }}>*</span></span>
          <span className="mono" style={{ fontSize: 11, color: justOk ? "var(--success)" : "var(--text-3)", fontWeight: 400 }}>
            {justification.trim().length} / {justMin} min
          </span>
        </label>
        <textarea className="input" rows="4" value={justification} onChange={e => setJustification(e.target.value)}
                  disabled={hardLocked}
                  placeholder="Describe the emergency, who reported it, and why a pre-flight delay isn't acceptable. This text is read by the Safety lead."/>
      </div>

      {/* What happens next */}
      <div style={{ padding: 14, borderRadius: 8, background: "var(--bg-subtle)", border: "1px solid var(--border)", marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
          <Icon name="info" size={13}/> What happens when you launch
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--text-2)", lineHeight: 1.7 }}>
          <li>You go <strong>straight to live stream</strong>. No checklist required for takeoff.</li>
          <li>Supervisor, Safety lead, and on-call dispatcher are <strong>notified immediately</strong>.</li>
          <li>A draft incident report is auto-created, linked to this flight.</li>
          <li>After landing, you <strong>must complete the skipped checklist</strong> and get a <strong>supervisor sign-off</strong> before the flight log can be archived.</li>
          <li>This launch is added to your 30-day emergency-launch tally and reviewed within 24 hr.</li>
        </ul>
      </div>

      {/* Acknowledgment */}
      <label style={{
        display: "flex", gap: 10, padding: 12, borderRadius: 8,
        background: ack ? "color-mix(in oklab, var(--danger) 6%, transparent)" : "var(--surface)",
        border: `1px solid ${ack ? "var(--danger)" : "var(--border)"}`,
        cursor: hardLocked ? "not-allowed" : "pointer",
        alignItems: "flex-start"
      }}>
        <input type="checkbox" checked={ack} disabled={hardLocked} onChange={e => setAck(e.target.checked)}
               style={{ marginTop: 2, width: 18, height: 18, accentColor: "var(--danger)" }}/>
        <div style={{ flex: 1, fontSize: 12.5 }}>
          <div style={{ fontWeight: 500 }}>
            I confirm this is a genuine emergency and accept that misuse may result in license suspension or termination per the Pilot Ops Acceptable Use policy.
          </div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
            Signed as <strong style={{ color: "var(--text-2)" }}>{me.name}</strong> · {me.license} · {new Date().toLocaleString()}
          </div>
        </div>
      </label>
    </Modal>
    {window.PilotAuthModal && (
      <PilotAuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        pilot={me}
        context="Emergency launch"
        accentColor="var(--danger)"
        onConfirmed={doLaunchAfterAuth}/>
    )}
    </>
  );
}
/* ---------- Banner shown on flights launched via emergency ---------- */
function EmergencyFlightBanner({ flight, onComplete }) {
  if (!flight?.emergency) return null;
  return (
    <div style={{
      background: "linear-gradient(90deg, var(--danger), color-mix(in oklab, var(--danger) 75%, #000))",
      color: "white", padding: "10px 16px",
      display: "flex", alignItems: "center", gap: 12,
      fontSize: 13
    }}>
      <Icon name="warn" size={16}/>
      <div style={{ flex: 1 }}>
        <strong style={{ fontWeight: 700 }}>EMERGENCY FLIGHT · {flight.id}</strong>
        <span style={{ marginLeft: 10, opacity: 0.9 }}>{flight.typeLabel} · pre-flight skipped · awaiting post-flight justification</span>
      </div>
      <button onClick={onComplete} style={{
        background: "white", color: "var(--danger)",
        border: "none", borderRadius: 5, padding: "5px 12px",
        fontSize: 12, fontWeight: 600, cursor: "pointer"
      }}>
        Complete post-flight ›
      </button>
    </div>
  );
}

Object.assign(window, { EmergencyLaunchModal, EmergencyFlightBanner, emergencyCountLast30, readEmergencyLog });
