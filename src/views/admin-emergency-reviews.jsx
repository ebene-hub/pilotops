import React from "react";
import { supabase } from "../api/supabase.js";
// Pilot Ops Admin — Emergency launch review queue.
// Reads real emergency flights + their review rows from the DB. Safety lead /
// ops director reviews, signs off, or flags for further investigation.

const { useState: erUseState, useEffect: erUseEffect, useMemo: erUseMemo } = React;

const EM_TYPE_LABELS = {
  "search-rescue":   { l: "Search & rescue",         color: "#0891b2" },
  "medical":         { l: "Medical / casualty",      color: "#16a34a" },
  "fire":            { l: "Active fire",             color: "#dc2626" },
  "threat":          { l: "Security threat",         color: "#7c3aed" },
  "infrastructure":  { l: "Infrastructure failure",  color: "#d97706" },
  "weather":         { l: "Severe weather",          color: "#0284c7" },
  "other":           { l: "Other",                   color: "#6b7280" },
};

const REVIEW_STATUS = {
  active:    { l: "Active",        color: "var(--accent)" },
  pending:   { l: "Pending review", color: "var(--warning)" },
  approved:  { l: "Approved",       color: "var(--success)" },
  flagged:   { l: "Flagged",        color: "var(--danger)" },
};

function AdminEmergencyReviewView() {
  const toast = useToast();
  const [log, setLog] = erUseState([]);
  const [filter, setFilter] = erUseState("all");
  const [detail, setDetail] = erUseState(null);

  // Load real emergency flights + their review status from the DB.
  erUseEffect(() => {
    supabase.from("flights")
      .select("id, code, area, emergency_type, justification, created_at, pilot_id, aircraft:aircraft_id(code), pilot:pilot_id(full_name), emergency_reviews(status, reviewed_by, reviewed_at)")
      .eq("emergency", true).order("created_at", { ascending: false })
      .then(({ data }) => setLog((data || []).map((f) => {
        const r = (f.emergency_reviews || [])[0] || {};
        return {
          id: f.code || f.id, flightDbId: f.id, ts: new Date(f.created_at).getTime(),
          pilotId: f.pilot_id, pilotName: f.pilot?.full_name, type: f.emergency_type,
          typeLabel: EM_TYPE_LABELS[f.emergency_type]?.l, area: f.area,
          aircraft: f.aircraft?.code || "", justification: f.justification,
          status: r.status || "pending",
          signedBy: r.reviewed_by, signedAt: r.reviewed_at ? new Date(r.reviewed_at).getTime() : null,
        };
      })));
  }, []);

  async function setStatus(id, status, signedBy) {
    const e = log.find((x) => x.id === id);
    if (e?.flightDbId) {
      await supabase.from("emergency_reviews").update({
        status, reviewed_by: window.__poAdminUser?.id || null, reviewed_at: new Date().toISOString(),
      }).eq("flight_id", e.flightDbId);
    }
    setLog((prev) => prev.map((x) => x.id === id ? { ...x, status, signedBy, signedAt: Date.now() } : x));
    toast({ kind: status === "approved" ? "success" : "info", title: status === "approved" ? "Approved" : "Flagged", msg: `${id} marked ${status}` });
    setDetail(null);
  }

  const filtered = log.filter(e => filter === "all" || e.status === filter);

  const stats = erUseMemo(() => ({
    total: log.length,
    pending: log.filter(e => !e.status || e.status === "active" || e.status === "pending").length,
    approved: log.filter(e => e.status === "approved").length,
    flagged: log.filter(e => e.status === "flagged").length,
    last30: log.filter(e => e.ts > Date.now() - 30 * 24 * 3600 * 1000).length,
  }), [log]);

  return (
    <div className="main-content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Emergency launch reviews</h1>
          <div className="page-sub">
            Every emergency launch is reviewed within 24 hr. {stats.pending} pending · {stats.approved} approved · {stats.flagged} flagged.
          </div>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="download" size={14}/> Export review log</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid-4" style={{ marginBottom: "var(--density-gap)" }}>
        <KpiTile label="Pending review" value={stats.pending} unit="open" delta={stats.pending > 0 ? "review within 24 hr" : "All clear"} trend={stats.pending > 0 ? "down" : "up"} spark={[1,2,3,2,3,3,stats.pending]} color="var(--warning)"/>
        <KpiTile label="Approved (90d)" value={stats.approved} unit="" delta="legitimate use" trend="up" spark={[2,3,3,4,5,5,stats.approved]} color="var(--success)"/>
        <KpiTile label="Flagged (90d)" value={stats.flagged} unit="" delta={stats.flagged > 0 ? "policy review needed" : "0 abuse signals"} trend={stats.flagged > 0 ? "down" : "up"} spark={[0,0,0,1,0,0,stats.flagged]} color="var(--danger)"/>
        <KpiTile label="Total (30d)" value={stats.last30} unit="launches" delta="all pilots" trend="up" spark={[2,3,5,6,7,7,stats.last30]} color="var(--accent)"/>
      </div>

      {/* Filter pills */}
      <div className="card">
        <div className="card-head" style={{ gap: 12, flexWrap: "wrap" }}>
          <div className="row" style={{ gap: 4 }}>
            {[
              { k: "all",      l: "All",       c: log.length },
              { k: "pending",  l: "Pending",   c: stats.pending },
              { k: "approved", l: "Approved",  c: stats.approved },
              { k: "flagged",  l: "Flagged",   c: stats.flagged },
            ].map(o => (
              <button key={o.k} onClick={() => setFilter(o.k)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "7px 12px", borderRadius: 6, border: "none",
                  background: filter === o.k ? "var(--accent-soft)" : "transparent",
                  color: filter === o.k ? "var(--accent)" : "var(--text-2)",
                  fontSize: 12.5, fontWeight: 500, cursor: "pointer"
                }}>
                {o.l}
                <span className="mono" style={{ fontSize: 10.5, color: "var(--text-3)", marginLeft: 4 }}>{o.c}</span>
              </button>
            ))}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Flight ID</th>
                <th>Pilot</th>
                <th>Type</th>
                <th>Area</th>
                <th>Aircraft</th>
                <th>Launched</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => {
                const type = EM_TYPE_LABELS[e.type] || { l: e.typeLabel || e.type, color: "var(--text-3)" };
                const status = REVIEW_STATUS[e.status || "pending"];
                const pilot = PILOTS.find(p => p.id === e.pilotId) || { name: e.pilotName || "Unknown", initials: "??", color: "#94a3b8" };
                return (
                  <tr key={e.id} className="clickable" onClick={() => setDetail(e)}>
                    <td className="mono" style={{ fontSize: 12, fontWeight: 600, color: "var(--danger)" }}>{e.id}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div className="user-avatar" style={{ width: 26, height: 26, fontSize: 10, background: `linear-gradient(135deg, ${pilot.color}, color-mix(in oklab, ${pilot.color} 70%, #000))` }}>{pilot.initials}</div>
                        <div>
                          <div style={{ fontSize: 12.5, fontWeight: 500 }}>{pilot.name}</div>
                          <div className="mono muted" style={{ fontSize: 10.5 }}>{pilot.id || e.pilotId}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="badge" style={{ background: `color-mix(in oklab, ${type.color} 12%, transparent)`, color: type.color, borderColor: `color-mix(in oklab, ${type.color} 30%, transparent)` }}>
                        <span style={{ width: 6, height: 6, borderRadius: 3, background: type.color }}/> {type.l}
                      </span>
                    </td>
                    <td style={{ fontSize: 12.5 }}>{e.area}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{e.aircraft}</td>
                    <td style={{ fontSize: 12, color: "var(--text-2)" }}>{relTime(e.ts)}</td>
                    <td>
                      <span className="badge" style={{ background: `color-mix(in oklab, ${status.color} 12%, transparent)`, color: status.color, borderColor: `color-mix(in oklab, ${status.color} 30%, transparent)` }}>
                        <span style={{ width: 6, height: 6, borderRadius: 3, background: status.color }}/> {status.l}
                      </span>
                    </td>
                    <td>
                      <button className="btn btn-sm" onClick={(ev) => { ev.stopPropagation(); setDetail(e); }}>Review</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div style={{ padding: 48, textAlign: "center", color: "var(--text-3)" }}>
              <Icon name="check" size={28} stroke="var(--text-4)"/>
              <div style={{ marginTop: 10, fontSize: 13 }}>No emergency launches in this view.</div>
            </div>
          )}
        </div>
      </div>

      {/* Detail / review modal */}
      {detail && (
        <Modal open onClose={() => setDetail(null)} size="lg" icon="warn"
               title={`Review ${detail.id}`}
               subtitle={`${EM_TYPE_LABELS[detail.type]?.l || detail.typeLabel} · ${relTime(detail.ts)}`}
               footer={<>
                 <button className="btn" onClick={() => setDetail(null)}>Close</button>
                 <button className="btn" style={{ color: "var(--danger)", borderColor: "color-mix(in oklab, var(--danger) 35%, var(--border))" }}
                   onClick={() => setStatus(detail.id, "flagged", "Ops Director")}>
                   <Icon name="warn" size={13}/> Flag for review
                 </button>
                 <button className="btn btn-primary"
                   onClick={() => setStatus(detail.id, "approved", "Ops Director")}>
                   <Icon name="check" size={13}/> Approve & sign off
                 </button>
               </>}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
            {[
              ["Pilot", (PILOTS.find(p => p.id === detail.pilotId)?.name) || detail.pilotName],
              ["Pilot ID", detail.pilotId],
              ["Aircraft", detail.aircraft],
              ["Target area", detail.area],
              ["Emergency type", EM_TYPE_LABELS[detail.type]?.l || detail.typeLabel],
              ["Launched at", new Date(detail.ts).toLocaleString()],
            ].map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{k}</div>
                <div className="mono" style={{ marginTop: 3, fontSize: 13, fontWeight: 500 }}>{v}</div>
              </div>
            ))}
          </div>

          <div className="field">
            <label className="field-label">Pilot's justification</label>
            <div style={{ padding: 14, borderRadius: 8, background: "var(--bg-subtle)", border: "1px solid var(--border)", fontSize: 13, lineHeight: 1.6, color: "var(--text)" }}>
              {detail.justification || <span className="muted">— no justification recorded —</span>}
            </div>
          </div>

          {/* Recent emergency count for this pilot */}
          {(() => {
            const recent = log.filter(x => x.pilotId === detail.pilotId && x.ts > Date.now() - 30 * 24 * 3600 * 1000).length;
            const tone = recent > 3 ? "var(--danger)" : recent > 1 ? "var(--warning)" : "var(--text-3)";
            return (
              <div style={{ marginTop: 14, padding: 12, borderRadius: 8, background: `color-mix(in oklab, ${tone} 8%, transparent)`, border: `1px solid color-mix(in oklab, ${tone} 30%, transparent)`, display: "flex", alignItems: "center", gap: 12 }}>
                <Icon name="shield" size={16} stroke={tone}/>
                <div style={{ fontSize: 12.5, color: "var(--text-2)" }}>
                  This pilot has used <strong style={{ color: tone }}>{recent}</strong> emergency launch{recent === 1 ? "" : "es"} in the last 30 days.
                  {recent > 3 && " Consider a policy conversation."}
                </div>
              </div>
            );
          })()}

          {detail.signedBy && (
            <div style={{ marginTop: 14, padding: 10, borderRadius: 6, background: "var(--bg-subtle)", fontSize: 12, color: "var(--text-2)" }}>
              <Icon name="check" size={12} style={{ verticalAlign: "-1px", color: "var(--success)" }}/> Reviewed by <strong>{detail.signedBy}</strong> on {new Date(detail.signedAt).toLocaleString()}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function relTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} hr ago`;
  return `${Math.floor(diff / 86400000)} days ago`;
}

Object.assign(window, { AdminEmergencyReviewView });
