import React from "react";
import { supabase } from "../api/supabase.js";
import { refresh } from "../store.jsx";
// Pilot Ops — Reports archive
const { useState: raUseState, useMemo: raUseMemo } = React;

function ReportsArchiveView() {
  const [q, setQ] = raUseState("");
  const [tab, setTab] = raUseState("All");
  const [busy, setBusy] = raUseState(false);
  const toast = useToast();

  async function newReport() {
    const title = window.prompt("Report title");
    if (!title) return;
    setBusy(true);
    const code = "RPT-" + new Date().getFullYear() + "-" + Date.now().toString().slice(-4);
    const { error } = await supabase.from("reports").insert({
      code, title, author_id: window.__poUser?.id || null, type: "Incident", status: "draft",
    });
    setBusy(false);
    if (error) { toast({ kind: "warn", title: "Could not create report", msg: error.message }); return; }
    try { await refresh(); } catch {}
    toast({ kind: "success", title: "Draft created", msg: code });
  }
  const filtered = raUseMemo(() => REPORTS_ARCHIVE.filter(r =>
    (tab === "All" || r.type === tab) &&
    (!q || (r.title + r.id + r.author).toLowerCase().includes(q.toLowerCase()))
  ), [q, tab]);

  return (
    <div className="main-content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Reports archive</h1>
          <div className="page-sub">{REPORTS_ARCHIVE.length} reports · {REPORTS_ARCHIVE.filter(r => r.status === "published").length} published · {REPORTS_ARCHIVE.filter(r => r.status === "draft").length} drafts</div>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="filter" size={14}/> Filter</button>
          <button className="btn"><Icon name="download" size={14}/> Export all</button>
          <button className="btn btn-primary" onClick={newReport} disabled={busy}><Icon name="plus" size={14}/> New report</button>
        </div>
      </div>

      {/* Aggregate stats */}
      <div className="grid-4" style={{ marginBottom: "var(--density-gap)" }}>
        <KpiTile label="Reports"          value={REPORTS_ARCHIVE.length} unit="reports" delta={`${REPORTS_ARCHIVE.filter(r => r.status === "published").length} published`} trend="up" spark={Array(7).fill(REPORTS_ARCHIVE.length)}/>
        <KpiTile label="Published"        value={REPORTS_ARCHIVE.filter(r => r.status === "published").length} unit="reports" trend="up" spark={Array(7).fill(REPORTS_ARCHIVE.filter(r => r.status === "published").length)} color="var(--success)"/>
        <KpiTile label="Flights archived" value={(window.RECENT_FLIGHTS || []).length} unit="flights" trend="up" spark={Array(7).fill((window.RECENT_FLIGHTS || []).length)}/>
        <KpiTile label="Incidents covered" value={REPORTS_ARCHIVE.reduce((s, r) => s + (r.incidents || 0), 0)} unit="cases" trend="up" spark={Array(7).fill(REPORTS_ARCHIVE.reduce((s, r) => s + (r.incidents || 0), 0))} color="#7c3aed"/>
      </div>

      <div className="card" style={{ marginBottom: "var(--density-gap)" }}>
        <div className="card-head">
          <div className="row" style={{ gap: 4 }}>
            {["All", "Weekly", "Monthly", "Quarterly", "Incident"].map(t => (
              <button key={t} className={"tab " + (tab === t ? "active" : "")} onClick={() => setTab(t)} style={{ padding: "8px 12px", borderRadius: 6, border: "none", background: "transparent", borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent" }}>{t}</button>
            ))}
          </div>
          <div className="search-input" style={{ marginLeft: "auto", width: 240 }}>
            <Icon name="search" size={14}/>
            <input style={{ flex: 1, border: "none", background: "transparent", outline: "none", color: "var(--text)" }} placeholder="Search reports…" value={q} onChange={e => setQ(e.target.value)}/>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Report</th>
                <th>Type</th>
                <th>Author</th>
                <th>Date</th>
                <th>Flights</th>
                <th>Incidents</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} className="clickable">
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ width: 36, height: 44, borderRadius: 4, background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center", flexShrink: 0, border: "1px solid color-mix(in oklab, var(--accent) 25%, transparent)" }}>
                        <Icon name="doc" size={18}/>
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{r.title}</div>
                        <div className="mono muted" style={{ fontSize: 11 }}>{r.id}</div>
                      </div>
                    </div>
                  </td>
                  <td><span className="pill">{r.type}</span></td>
                  <td>{r.author}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{r.date}</td>
                  <td className="mono tabular">{r.flights}</td>
                  <td className="mono tabular">{r.incidents}</td>
                  <td><StatusBadge status={r.status}/></td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <button className="btn btn-sm btn-ghost"><Icon name="download" size={12}/></button>
                      <button className="btn btn-sm btn-ghost"><Icon name="more" size={14}/></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)" }}>No reports match.</div>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "var(--density-gap)" }}>
        <div className="card">
          <div className="card-head"><div className="card-title">Recent flights linked to reports</div></div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr><th>Flight</th><th>Pilot</th><th>Date</th><th>Area</th><th>Duration</th><th>Incidents</th><th></th></tr>
              </thead>
              <tbody>
                {RECENT_FLIGHTS.map(f => (
                  <tr key={f.id} className="clickable">
                    <td className="mono" style={{ fontWeight: 600 }}>{f.id}</td>
                    <td>{f.pilot}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{f.date}</td>
                    <td>{f.area}</td>
                    <td className="mono tabular">{f.duration}</td>
                    <td>{f.incidents > 0 ? <span className="badge badge-warning">{f.incidents}</span> : <span className="muted mono" style={{ fontSize: 11 }}>—</span>}</td>
                    <td><StatusBadge status={f.status}/></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div className="card-title">Reports per author</div></div>
          <div className="card-body">
            <BarChart data={[
              { label: "Ops Dept",    val: 24, color: "var(--accent)" },
              { label: "Ops Assistant",     val: 18, color: "#7c3aed" },
              { label: "A. Mensah",   val: 8,  color: "#0891b2" },
              { label: "M. Rosselló", val: 6,  color: "#16a34a" },
              { label: "L. Vainio",   val: 5,  color: "#d97706" },
            ]} horizontal/>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ReportsArchiveView });
