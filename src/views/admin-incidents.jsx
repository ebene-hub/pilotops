import React from "react";
import { supabase } from "../api/supabase.js";
// Pilot Ops — Admin incident log: every incident crew submit (saved to the
// `incidents` table) shown here, filterable and exportable to CSV.
const { useState: aiUseState, useEffect: aiUseEffect, useMemo: aiUseMemo } = React;

const SEV_COLOR = { critical: "#b91c1c", high: "var(--danger)", medium: "var(--warning)", low: "var(--success)" };

function AdminIncidentsView() {
  const [rows, setRows] = aiUseState([]);
  const [loading, setLoading] = aiUseState(true);
  const [q, setQ] = aiUseState("");
  const [sev, setSev] = aiUseState("all");
  const [status, setStatus] = aiUseState("all");
  const toast = useToast();

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from("incidents")
      .select("*, reporter:reporter_id(full_name), flight:flight_id(code)")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) { toast({ kind: "warn", title: "Couldn't load incidents", msg: error.message }); return; }
    setRows((data || []).map((i) => ({
      id: i.code || (i.id ? i.id.slice(0, 8).toUpperCase() : "—"),
      type: i.type || "—", severity: (i.severity || "—").toLowerCase(),
      place: i.place || "—", reporter: i.reporter?.full_name || "—",
      flight: i.flight?.code || "—", status: i.status || "open",
      description: i.description || "",
      date: i.created_at ? new Date(i.created_at).toLocaleString() : "—",
    })));
  }
  aiUseEffect(() => { load(); }, []);

  const filtered = aiUseMemo(() => rows.filter((r) =>
    (sev === "all" || r.severity === sev) &&
    (status === "all" || r.status === status) &&
    (!q || (r.id + r.type + r.place + r.reporter + r.description).toLowerCase().includes(q.toLowerCase()))
  ), [rows, q, sev, status]);

  const counts = aiUseMemo(() => ({
    total: rows.length,
    open: rows.filter((r) => r.status === "open").length,
    severe: rows.filter((r) => r.severity === "critical" || r.severity === "high").length,
  }), [rows]);

  function exportCsv() {
    if (!filtered.length) { toast({ kind: "info", title: "Nothing to export", msg: "No incidents match the filter." }); return; }
    const head = ["Code", "Date", "Type", "Severity", "Place", "Reporter", "Flight", "Status", "Description"];
    const lines = [head].concat(filtered.map((r) => [r.id, r.date, r.type, r.severity, r.place, r.reporter, r.flight, r.status, r.description]));
    const csv = lines.map((row) => row.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `incidents-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    toast({ kind: "success", title: "Exported", msg: `${filtered.length} incidents → CSV` });
  }

  return (
    <div>
      <div className="page-actions" style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginBottom: "var(--density-gap)" }}>
        <button className="btn" onClick={load}><Icon name="refresh" size={14}/> Refresh</button>
        <button className="btn btn-primary" onClick={exportCsv}><Icon name="download" size={14}/> Export CSV</button>
      </div>

      <div className="grid-4" style={{ marginBottom: "var(--density-gap)" }}>
        <KpiTile label="Total incidents" value={counts.total} unit="logged" spark={Array(7).fill(counts.total)}/>
        <KpiTile label="Open" value={counts.open} unit="unresolved" color="var(--warning)" spark={Array(7).fill(counts.open)}/>
        <KpiTile label="High / critical" value={counts.severe} unit="severe" color="var(--danger)" spark={Array(7).fill(counts.severe)}/>
        <KpiTile label="Showing" value={filtered.length} unit="filtered" color="var(--accent)" spark={Array(7).fill(filtered.length)}/>
      </div>

      <div className="card">
        <div className="card-head" style={{ gap: 10, flexWrap: "wrap" }}>
          <div className="card-title">Incident log <span className="muted" style={{ fontWeight: 400 }}>({filtered.length})</span></div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <div className="search-input" style={{ width: 220, height: 32 }}>
              <Icon name="search" size={13}/>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search type, place, reporter…"
                     style={{ flex: 1, border: "none", background: "transparent", outline: "none", color: "var(--text)", fontSize: 12.5 }}/>
            </div>
            <select className="select" value={sev} onChange={(e) => setSev(e.target.value)} style={{ width: 130, height: 32, fontSize: 12.5 }}>
              <option value="all">All severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 120, height: 32, fontSize: 12.5 }}>
              <option value="all">All status</option>
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr><th>Code</th><th>Date</th><th>Type</th><th>Severity</th><th>Place</th><th>Reporter</th><th>Flight</th><th>Status</th></tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={r.id + i}>
                  <td className="mono" style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)" }}>{r.id}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{r.date}</td>
                  <td style={{ fontSize: 12.5 }}>{r.type}</td>
                  <td><span className="badge" style={{ background: "color-mix(in oklab, " + (SEV_COLOR[r.severity] || "var(--text-3)") + " 18%, transparent)", color: SEV_COLOR[r.severity] || "var(--text-2)", textTransform: "capitalize" }}>{r.severity}</span></td>
                  <td style={{ fontSize: 12.5 }}>{r.place}</td>
                  <td style={{ fontSize: 12.5 }}>{r.reporter}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{r.flight}</td>
                  <td><StatusBadge status={r.status}/></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && filtered.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)" }}>No incidents{rows.length ? " match the filter" : " logged yet"}.</div>}
          {loading && <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)" }}>Loading…</div>}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { AdminIncidentsView });
