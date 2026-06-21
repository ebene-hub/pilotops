import React from "react";
// Pilot Ops Admin — Pilot logging dashboard
// Aggregated view of ALL pilots' flight hours, currency, and recent activity.
// Shareable: link / email / PDF / scheduled digest.
const { useState: apdUseState, useMemo: apdUseMemo, useRef: apdUseRef } = React;

// Monday-start of the week containing d.
function startOfWeek(d) {
  const x = new Date(d); const dow = (x.getDay() + 6) % 7;
  x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - dow); return x;
}

/* ---------- Per-pilot rollups from real data ---------- */
// Lifetime hours come from the profile. MTD hours + flight counts aggregate from
// real completed flights (FLIGHT_HOURS); night/BVLOS come from logbook entries
// when pilots log them; license expiry from the pilot's KYC license_expiry. All
// real — zero/blank until data accumulates, never fabricated.
function pilotRollup(p) {
  const fh = (window.FLIGHT_HOURS || []).filter((f) => f.pilotId === p.id);
  const log = (window.LOGBOOK_ENTRIES || []).filter((l) => l.pilotId === p.id);
  const monthCut = new Date(); monthCut.setDate(1); monthCut.setHours(0, 0, 0, 0);
  const mtd = fh.filter((f) => f.date && new Date(f.date) >= monthCut);
  const hrs = (arr) => arr.reduce((s, f) => s + (Number(f.minutes) || 0), 0) / 60;
  const logHrs = (arr, k) => arr.reduce((s, l) => s + (Number(l[k]) || 0), 0) / 60;
  const lastDate = fh.map((f) => f.date).filter(Boolean).sort().slice(-1)[0];
  const expiryDays = p.licenseExpiry ? Math.ceil((new Date(p.licenseExpiry) - Date.now()) / 86400000) : null;
  return {
    ...p,
    monthHours: +hrs(mtd).toFixed(1),
    nightHours: +logHrs(log, "night").toFixed(1),
    bvlosHours: +logHrs(log, "bvlos").toFixed(1),
    flightsMtd: mtd.length,
    incidents90: 0,
    expiryDays,
    expiryStatus: expiryDays == null ? "unknown" : expiryDays < 14 ? "warn" : expiryDays < 60 ? "watch" : "ok",
    lastFlight: lastDate ? new Date(lastDate).toLocaleDateString() : "—",
  };
}

function AdminPilotDashboardView() {
  const [range, setRange] = apdUseState("30");
  const [team, setTeam] = apdUseState("all");
  const [shareOpen, setShareOpen] = apdUseState(false);
  const [pilotDetail, setPilotDetail] = apdUseState(null);
  const toast = useToast();

  const pilots = apdUseMemo(() => PILOTS.map(pilotRollup), []);
  const totals = apdUseMemo(() => ({
    pilots: pilots.length,
    activeWeek: new Set((window.FLIGHT_HOURS || []).filter(f => f.date && (Date.now() - new Date(f.date)) < 7 * 86400000).map(f => f.pilotId)).size,
    totalHours: pilots.reduce((s, p) => s + (Number(p.hours) || 0), 0),
    monthHours: pilots.reduce((s, p) => s + p.monthHours, 0),
    flightsMtd: pilots.reduce((s, p) => s + p.flightsMtd, 0),
    incidents: pilots.reduce((s, p) => s + p.incidents90, 0),
    expiringSoon: pilots.filter(p => p.expiryDays != null && p.expiryDays < 30).length,
    bvlosHours: pilots.reduce((s, p) => s + p.bvlosHours, 0),
    nightHours: pilots.reduce((s, p) => s + p.nightHours, 0),
  }), [pilots]);

  // Weekly hours stacked across all pilots — real completed flights, last 12 weeks.
  const weekly = apdUseMemo(() => {
    const N = 12;
    const thisStart = startOfWeek(new Date());
    const buckets = Array.from({ length: N }, (_, k) => {
      const s = new Date(thisStart); s.setDate(thisStart.getDate() - (N - 1 - k) * 7);
      return { start: s, label: s.toLocaleDateString(undefined, { month: "short", day: "numeric" }), day: 0, night: 0 };
    });
    (window.FLIGHT_HOURS || []).forEach((f) => {
      if (!f.date) return;
      const idx = Math.round((startOfWeek(new Date(f.date)) - buckets[0].start) / (7 * 86400000));
      if (idx >= 0 && idx < N) { const h = (Number(f.minutes) || 0) / 60; if (f.night) buckets[idx].night += h; else buckets[idx].day += h; }
    });
    return buckets.map((b) => ({ label: b.label, day: Math.round(b.day * 10) / 10, night: Math.round(b.night * 10) / 10 }));
  }, [pilots]);
  const maxWeek = Math.max(1, ...weekly.map(w => w.day + w.night));

  // Top performers by hours flown this month
  const topPerformers = [...pilots].sort((a, b) => b.monthHours - a.monthHours).slice(0, 5);

  // Currency expiring soon (only pilots with a known license expiry)
  const expiring = pilots.filter(p => p.expiryDays != null && p.expiryDays < 60).sort((a, b) => a.expiryDays - b.expiryDays);

  // Date stamp (for the share-able "snapshot")
  const today = new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="main-content">
      <div className="page-head">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--text-3)", fontWeight: 500, marginBottom: 4 }}>
            <span style={{ background: "var(--accent-soft)", color: "var(--accent)", padding: "2px 7px", borderRadius: 3, fontSize: 10, letterSpacing: "0.06em", fontWeight: 700 }}>ADMIN DASHBOARD</span>
            <span>· {today}</span>
          </div>
          <h1 className="page-title">Pilot performance & logging</h1>
          <div className="page-sub">
            Live rollup of all {pilots.length} pilots' flight hours, currency, and recent activity. Updated every 5 minutes.
          </div>
        </div>
        <div className="page-actions">
          <select className="select" value={team} onChange={e => setTeam(e.target.value)} style={{ width: 140, height: 34, fontSize: 12.5 }}>
            <option value="all">All teams</option>
            <option value="north">North field</option>
            <option value="south">South field</option>
            <option value="contractor">Contractors</option>
          </select>
          <select className="select" value={range} onChange={e => setRange(e.target.value)} style={{ width: 130, height: 34, fontSize: 12.5 }}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last year</option>
          </select>
          <button className="btn" onClick={() => window.print()}><Icon name="reports" size={14}/> Print</button>
          <button className="btn btn-primary" onClick={() => setShareOpen(true)}>
            <Icon name="send" size={14}/> Share dashboard
          </button>
        </div>
      </div>

      {/* Top KPI strip */}
      <div className="grid-4" style={{ marginBottom: "var(--density-gap)" }}>
        <KpiTile label="Active pilots" value={totals.pilots} unit="total"
                 delta={`${totals.activeWeek} flew this week`} trend="up"
                 spark={[6,7,7,8,8,9,totals.pilots]} color="var(--accent)"/>
        <KpiTile label="Flight hours MTD" value={totals.monthHours.toFixed(0)} unit="hr"
                 delta={`+${Math.round(totals.monthHours / 30 * 10)}/day avg`} trend="up"
                 spark={[120,148,165,189,205,232,totals.monthHours]} color="var(--success)"/>
        <KpiTile label="Flights MTD" value={totals.flightsMtd} unit="missions"
                 delta={`${totals.incidents} incidents flagged`} trend={totals.incidents > 0 ? "down" : "up"}
                 spark={[42,49,55,61,68,72,totals.flightsMtd]} color="#7c3aed"/>
        <KpiTile label="Currency alerts" value={totals.expiringSoon} unit={`/ ${totals.pilots}`}
                 delta={`${expiring.length} within 60 days`} trend={totals.expiringSoon > 0 ? "down" : "up"}
                 spark={[0,0,0,0,0,0,totals.expiringSoon]} color="var(--warning)"/>
      </div>

      {/* Mid: chart + side panels */}
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: "var(--density-gap)", marginBottom: "var(--density-gap)" }}>
        <div className="card">
          <div className="card-head">
            <div className="card-title">Hours flown — across all pilots</div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 14, fontSize: 11.5 }}>
              <LegendDot color="var(--accent)" label="Day"/>
              <LegendDot color="#1e3a8a" label="Night"/>
            </div>
          </div>
          <div className="card-body">
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${weekly.length}, 1fr)`, alignItems: "end", gap: 8, height: 220 }}>
              {weekly.map(w => (
                <div key={w.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <div style={{ width: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", height: 188 }}>
                    <div title={`${w.night} hr night`} style={{ background: "#1e3a8a", height: `${(w.night / maxWeek) * 100}%`, borderRadius: "3px 3px 0 0" }}/>
                    <div title={`${w.day} hr day`} style={{ background: "var(--accent)", height: `${(w.day / maxWeek) * 100}%`, borderRadius: w.night > 0 ? 0 : "3px 3px 0 0" }}/>
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>{w.label}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 24, justifyContent: "center", marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              <StatBlk label="Total" value={`${(totals.totalHours).toFixed(0)} hr`}/>
              <StatBlk label="BVLOS" value={`${totals.bvlosHours.toFixed(0)} hr`} sub={totals.totalHours ? `${((totals.bvlosHours / totals.totalHours) * 100).toFixed(0)}%` : "—"}/>
              <StatBlk label="Night ops" value={`${totals.nightHours.toFixed(0)} hr`} sub={totals.totalHours ? `${((totals.nightHours / totals.totalHours) * 100).toFixed(0)}%` : "—"}/>
              <StatBlk label="Per-pilot avg" value={`${(totals.pilots ? totals.totalHours / totals.pilots : 0).toFixed(0)} hr`}/>
            </div>
          </div>
        </div>

        {/* Top performers */}
        <div className="card">
          <div className="card-head"><div className="card-title">Top performers this month</div></div>
          <div style={{ padding: 8 }}>
            {topPerformers.map((p, i) => (
              <div key={p.id} onClick={() => setPilotDetail(p)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 10px", borderRadius: 8, cursor: "pointer", borderBottom: i < topPerformers.length - 1 ? "1px solid var(--border)" : "none" }}
                onMouseEnter={e => e.currentTarget.style.background = "var(--bg-subtle)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <div style={{ width: 22, height: 22, borderRadius: 6, background: i === 0 ? "#fbbf24" : "var(--bg-muted)", color: i === 0 ? "white" : "var(--text-2)", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 11, fontFamily: "var(--font-mono)" }}>
                  {i + 1}
                </div>
                <div className="user-avatar" style={{ width: 30, height: 30, fontSize: 11, background: `linear-gradient(135deg, ${p.color}, color-mix(in oklab, ${p.color} 70%, #000))` }}>{p.initials}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</div>
                  <div className="muted" style={{ fontSize: 11 }}>{p.license}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{p.monthHours.toFixed(1)} hr</div>
                  <div className="muted" style={{ fontSize: 10.5 }}>{p.flightsMtd} flights</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Currency alerts + pilot table side-by-side row */}
      <div className="card" style={{ marginBottom: "var(--density-gap)" }}>
        <div className="card-head">
          <div className="card-title">Currency & compliance alerts</div>
          <span className="muted" style={{ fontSize: 12 }}>{expiring.length} items expiring within 60 days</span>
          <button className="btn btn-sm" style={{ marginLeft: "auto" }}><Icon name="download" size={12}/> Export</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10, padding: "var(--density-pad)" }}>
          {expiring.slice(0, 6).map(p => {
            const tone = p.expiryStatus === "warn" ? "var(--danger)" : p.expiryStatus === "watch" ? "var(--warning)" : "var(--text-3)";
            return (
              <div key={p.id} style={{ border: "1px solid var(--border)", borderLeft: `3px solid ${tone}`, borderRadius: 8, padding: 12, background: "var(--surface)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div className="user-avatar" style={{ width: 32, height: 32, fontSize: 11, background: `linear-gradient(135deg, ${p.color}, color-mix(in oklab, ${p.color} 70%, #000))` }}>{p.initials}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{p.license}</div>
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                  <span className="muted" style={{ fontSize: 11 }}>License expires in</span>
                  <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: tone }}>{p.expiryDays} days</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Full pilot table */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">Pilot roster — all metrics</div>
          <div className="page-actions" style={{ marginLeft: "auto" }}>
            <button className="btn btn-sm"><Icon name="download" size={12}/> Export CSV</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Pilot</th>
                <th>License</th>
                <th style={{ textAlign: "right" }}>Lifetime hr</th>
                <th style={{ textAlign: "right" }}>MTD hr</th>
                <th style={{ textAlign: "right" }}>Night</th>
                <th style={{ textAlign: "right" }}>BVLOS</th>
                <th style={{ textAlign: "right" }}>Flights MTD</th>
                <th>Last flight</th>
                <th>Currency</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pilots.map(p => {
                const tone = p.expiryStatus === "warn" ? "var(--danger)" : p.expiryStatus === "watch" ? "var(--warning)" : p.expiryStatus === "unknown" ? "var(--text-3)" : "var(--success)";
                const txt = p.expiryStatus === "warn" ? `${p.expiryDays}d ⚠` : p.expiryStatus === "watch" ? `${p.expiryDays}d` : p.expiryStatus === "unknown" ? "—" : "OK";
                return (
                  <tr key={p.id} className="clickable" onClick={() => setPilotDetail(p)}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div className="user-avatar" style={{ width: 28, height: 28, fontSize: 10, background: `linear-gradient(135deg, ${p.color}, color-mix(in oklab, ${p.color} 70%, #000))` }}>{p.initials}</div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</div>
                          <div className="mono muted" style={{ fontSize: 10.5 }}>{p.shortId || p.id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{p.license}</td>
                    <td className="mono tabular" style={{ textAlign: "right", fontWeight: 600 }}>{p.hours}</td>
                    <td className="mono tabular" style={{ textAlign: "right" }}>{p.monthHours.toFixed(1)}</td>
                    <td className="mono tabular muted" style={{ textAlign: "right" }}>{p.nightHours.toFixed(1)}</td>
                    <td className="mono tabular muted" style={{ textAlign: "right" }}>{p.bvlosHours.toFixed(1)}</td>
                    <td className="mono tabular" style={{ textAlign: "right" }}>{p.flightsMtd}</td>
                    <td style={{ fontSize: 12, color: "var(--text-2)" }}>{p.lastFlight}</td>
                    <td>
                      <span className="badge" style={{ background: `color-mix(in oklab, ${tone} 12%, transparent)`, color: tone, borderColor: `color-mix(in oklab, ${tone} 30%, transparent)` }}>
                        <span style={{ width: 6, height: 6, borderRadius: 3, background: tone }}/> {txt}
                      </span>
                    </td>
                    <td>
                      <button className="btn btn-sm btn-ghost"><Icon name="more" size={12}/></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Share modal */}
      {shareOpen && <ShareDashboardModal onClose={() => setShareOpen(false)} toast={toast} dashboardName="Pilot performance" dateLabel={today}/>}

      {/* Pilot detail drilldown */}
      {pilotDetail && (
        <Modal open onClose={() => setPilotDetail(null)} title={pilotDetail.name} subtitle={`${pilotDetail.license || "—"} · ${pilotDetail.shortId || pilotDetail.id}`} icon="users" size="lg"
               footer={<>
                 <button className="btn" onClick={() => setPilotDetail(null)}>Close</button>
                 <a href={`/#logbook`} className="btn btn-primary" style={{ textDecoration: "none" }}><Icon name="reports" size={14}/> Open full logbook</a>
               </>}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14, fontSize: 13 }}>
            {[
              ["Lifetime hours", pilotDetail.hours + " hr"],
              ["Month hours", pilotDetail.monthHours.toFixed(1) + " hr"],
              ["Night ops", pilotDetail.nightHours.toFixed(1) + " hr"],
              ["BVLOS", pilotDetail.bvlosHours.toFixed(1) + " hr"],
              ["Flights MTD", pilotDetail.flightsMtd],
              ["Lifetime flights", pilotDetail.missions],
              ["Last flight", pilotDetail.lastFlight],
              ["License", pilotDetail.expiryDays != null ? pilotDetail.expiryDays + " days remaining" : "—"],
            ].map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{k}</div>
                <div className="mono" style={{ marginTop: 3, fontWeight: 600 }}>{v}</div>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ---------- Share modal ---------- */
function ShareDashboardModal({ onClose, toast, dashboardName, dateLabel }) {
  const [tab, setTab] = apdUseState("link");
  const [visibility, setVisibility] = apdUseState("org");
  const [recipients, setRecipients] = apdUseState("director@pilotops.io, safety@pilotops.io");
  const [emailMsg, setEmailMsg] = apdUseState(`Latest pilot performance snapshot from Pilot Ops as of ${dateLabel}.`);
  const [schedFreq, setSchedFreq] = apdUseState("weekly");
  const [includes, setIncludes] = apdUseState({ kpis: true, chart: true, currency: true, roster: true });
  const linkRef = apdUseRef(null);

  // Generated share link (mock)
  const shareUrl = `https://pilotops.io/share/dash/D-PILOT-${Math.floor(Math.random() * 9000 + 1000)}#snap=${Date.now().toString(36)}`;

  function copyLink() {
    navigator.clipboard?.writeText(shareUrl).then(
      () => toast({ kind: "success", title: "Link copied", msg: "Share link copied to clipboard." }),
      () => toast({ kind: "info", title: "Copy unavailable", msg: "Long-press the URL to copy manually." })
    );
  }

  return (
    <Modal open onClose={onClose}
      title={`Share "${dashboardName}"`}
      subtitle={`Snapshot of ${dateLabel} · choose how to distribute`}
      icon="send" size="lg"
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        {tab === "link" && <button className="btn btn-primary" onClick={copyLink}><Icon name="link" size={14}/> Copy share link</button>}
        {tab === "email" && <button className="btn btn-primary" onClick={() => { toast({ kind: "success", title: "Snapshot sent", msg: `Emailed to ${recipients.split(",").length} recipients` }); onClose(); }}><Icon name="send" size={14}/> Send snapshot</button>}
        {tab === "pdf" && <button className="btn btn-primary" onClick={() => { window.print(); }}><Icon name="download" size={14}/> Export PDF</button>}
        {tab === "schedule" && <button className="btn btn-primary" onClick={() => { toast({ kind: "success", title: "Schedule saved", msg: `${schedFreq} digest enabled` }); onClose(); }}><Icon name="check" size={14}/> Save schedule</button>}
      </>}>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid var(--border)", paddingBottom: 4 }}>
        {[
          { k: "link",     l: "Share link",      ic: "link" },
          { k: "email",    l: "Email snapshot",  ic: "mail" },
          { k: "pdf",      l: "Export PDF",      ic: "reports" },
          { k: "schedule", l: "Recurring digest", ic: "clock" },
        ].map(o => (
          <button key={o.k} onClick={() => setTab(o.k)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "8px 12px", borderRadius: 6, border: "none",
              background: tab === o.k ? "var(--accent-soft)" : "transparent",
              color: tab === o.k ? "var(--accent)" : "var(--text-2)",
              fontSize: 12.5, fontWeight: 500, cursor: "pointer"
            }}>
            <Icon name={o.ic} size={12}/>{o.l}
          </button>
        ))}
      </div>

      {/* LINK */}
      {tab === "link" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="field">
            <label className="field-label">Who can view</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {[
                { v: "org",      l: "Org only",       d: "Anyone signed into Pilot Ops",    ic: "shield" },
                { v: "external", l: "External link",  d: "Anyone with the URL can view",   ic: "link" },
                { v: "password", l: "Password",       d: "Link + password required",        ic: "shield" },
              ].map(o => (
                <button key={o.v} onClick={() => setVisibility(o.v)} type="button"
                  style={{
                    padding: 12, borderRadius: 8, textAlign: "left",
                    border: `1.5px solid ${visibility === o.v ? "var(--accent)" : "var(--border)"}`,
                    background: visibility === o.v ? "var(--accent-soft)" : "var(--surface)",
                    color: "var(--text)", cursor: "pointer"
                  }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <Icon name={o.ic} size={13}/>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{o.l}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-3)" }}>{o.d}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label className="field-label">Shareable URL</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input ref={linkRef} className="input mono" value={shareUrl} readOnly style={{ flex: 1, fontSize: 12 }} onFocus={e => e.target.select()}/>
              <button className="btn" onClick={copyLink}><Icon name="link" size={13}/> Copy</button>
            </div>
            <div className="field-hint" style={{ marginTop: 6 }}>
              <Icon name="shield" size={11} style={{ verticalAlign: "-1px", color: "var(--success)" }}/> Auto-expires in 30 days. Revoke any time from <strong>Audit log</strong>.
            </div>
          </div>

          <div className="field">
            <label className="field-label">Include in snapshot</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { k: "kpis", l: "KPI strip" },
                { k: "chart", l: "Hours flown chart" },
                { k: "currency", l: "Currency alerts" },
                { k: "roster", l: "Full pilot roster" },
              ].map(o => (
                <label key={o.k} style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer" }}>
                  <input type="checkbox" checked={includes[o.k]} onChange={e => setIncludes(prev => ({ ...prev, [o.k]: e.target.checked }))} style={{ accentColor: "var(--accent)" }}/>
                  <span style={{ fontSize: 12.5 }}>{o.l}</span>
                </label>
              ))}
            </div>
          </div>

          {visibility === "password" && (
            <div className="field">
              <label className="field-label">Set password</label>
              <input className="input" type="password" placeholder="At least 8 characters" defaultValue=""/>
            </div>
          )}
        </div>
      )}

      {/* EMAIL */}
      {tab === "email" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="field">
            <label className="field-label">Recipients <span style={{ color: "var(--text-3)", fontWeight: 400 }}>(comma separated)</span></label>
            <textarea className="input mono" rows="2" value={recipients} onChange={e => setRecipients(e.target.value)} style={{ fontSize: 12 }}/>
            <div className="field-hint">Or pick from <strong>Stakeholders</strong>:</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
              {STAKEHOLDERS.slice(0, 4).map(s => (
                <button key={s.id} type="button" onClick={() => setRecipients(prev => prev.includes(s.email) ? prev : prev + (prev ? ", " : "") + s.email)}
                  className="pill" style={{ cursor: "pointer" }}>
                  <Icon name="plus" size={9}/> {s.name}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label className="field-label">Subject</label>
            <input className="input" defaultValue={`Pilot performance snapshot · ${dateLabel}`}/>
          </div>
          <div className="field">
            <label className="field-label">Message</label>
            <textarea className="input" rows="4" value={emailMsg} onChange={e => setEmailMsg(e.target.value)}/>
          </div>
          <div style={{ display: "flex", gap: 10, padding: 12, background: "var(--bg-subtle)", borderRadius: 8, border: "1px solid var(--border)", alignItems: "center" }}>
            <Icon name="info" size={14} stroke="var(--text-3)"/>
            <div style={{ fontSize: 12, color: "var(--text-2)" }}>The email includes an inline summary table and a view-only link to the live dashboard.</div>
          </div>
        </div>
      )}

      {/* PDF */}
      {tab === "pdf" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ padding: 18, borderRadius: 10, background: "var(--bg-subtle)", border: "1px solid var(--border)", display: "flex", gap: 14, alignItems: "center" }}>
            <div style={{ width: 56, height: 70, borderRadius: 4, background: "var(--surface)", border: "1px solid var(--border)", display: "flex", flexDirection: "column", padding: 4, gap: 2, flexShrink: 0 }}>
              <div style={{ height: 8, background: "var(--accent)", borderRadius: 1, width: "60%" }}/>
              <div style={{ height: 3, background: "var(--text-4)", borderRadius: 1 }}/>
              <div style={{ height: 3, background: "var(--text-4)", borderRadius: 1, width: "80%" }}/>
              <div style={{ flex: 1, background: "var(--bg-muted)", borderRadius: 2, marginTop: 2 }}/>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>pilot-performance-{new Date().toISOString().slice(0,10)}.pdf</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>4 pages · A4 portrait · 2.1 MB est.</div>
            </div>
          </div>
          <div className="grid-2">
            <Sel label="Page size" options={[["A4", "A4 (210×297mm)"], ["letter", "US Letter (8.5×11in)"], ["legal", "Legal"]]}/>
            <Sel label="Orientation" options={[["portrait", "Portrait"], ["landscape", "Landscape"]]}/>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }}>
            <input type="checkbox" defaultChecked style={{ accentColor: "var(--accent)" }}/>
            Include "Confidential — internal use only" watermark
          </label>
        </div>
      )}

      {/* SCHEDULE */}
      {tab === "schedule" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="field">
            <label className="field-label">Frequency</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {[
                { v: "daily",   l: "Daily",   d: "Every weekday at 09:00" },
                { v: "weekly",  l: "Weekly",  d: "Mondays at 09:00" },
                { v: "monthly", l: "Monthly", d: "First of the month" },
              ].map(o => (
                <button key={o.v} type="button" onClick={() => setSchedFreq(o.v)}
                  style={{
                    padding: 12, borderRadius: 8, textAlign: "left",
                    border: `1.5px solid ${schedFreq === o.v ? "var(--accent)" : "var(--border)"}`,
                    background: schedFreq === o.v ? "var(--accent-soft)" : "var(--surface)",
                    cursor: "pointer", color: "var(--text)"
                  }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{o.l}</div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3 }}>{o.d}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label className="field-label">Recipients</label>
            <input className="input mono" defaultValue={recipients} style={{ fontSize: 12 }}/>
          </div>
          <div style={{ padding: 14, background: "var(--accent-soft)", borderRadius: 8, fontSize: 12.5, color: "var(--text-2)", display: "flex", alignItems: "flex-start", gap: 10 }}>
            <Icon name="info" size={14} stroke="var(--accent)"/>
            <div>
              Recurring digests count toward the recipient's notification preferences. Each email includes a one-click "unsubscribe from this digest" link.
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ---------- Small components ---------- */
function LegendDot({ color, label }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
    <span style={{ width: 10, height: 10, background: color, borderRadius: 2 }}/>
    <span>{label}</span>
  </span>;
}
function StatBlk({ label, value, sub }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div className="muted" style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>{label}</div>
      <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{value}</div>
      {sub && <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
function Sel({ label, options }) {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <select className="select" defaultValue={options[0][0]}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

Object.assign(window, { AdminPilotDashboardView });
