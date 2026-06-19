import React from "react";
// Pilot Ops — Multi-screen ops grid (4 simultaneous pilot feeds)
const { useState: msUseState } = React;

function MultiScreenView({ basemap, onFocus }) {
  const [layout, setLayout] = msUseState("2x2"); // "2x2", "1+3", "focus"
  const [focused, setFocused] = msUseState(null);

  const gridStyle = {
    "2x2": { gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr" },
    "1+3": { gridTemplateColumns: "2fr 1fr", gridTemplateRows: "1fr 1fr 1fr" },
    "focus": { gridTemplateColumns: "3fr 1fr", gridTemplateRows: "1fr 1fr 1fr 1fr" }
  }[layout];

  return (
    <div className="main-content" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="page-head" style={{ marginBottom: 12 }}>
        <div>
          <h1 className="page-title">Multi-screen ops</h1>
          <div className="page-sub">{ACTIVE_FLIGHTS.length} simultaneous feeds · synchronized telemetry</div>
        </div>
        <div className="page-actions">
          <div className="row" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 2 }}>
            {["2x2", "1+3", "focus"].map(l => (
              <button key={l} className={"btn btn-sm " + (layout === l ? "btn-primary" : "btn-ghost")} onClick={() => setLayout(l)} style={{ height: 28 }}>{l}</button>
            ))}
          </div>
          <button className="btn"><Icon name="grid" size={13}/> Add tile</button>
          <button className="btn"><Icon name="expand" size={13}/> Fullscreen</button>
        </div>
      </div>

      {ACTIVE_FLIGHTS.length === 0 ? (
        <div style={{ flex: 1, display: "grid", placeItems: "center", border: "1px dashed var(--border)", borderRadius: 10 }}>
          <div style={{ textAlign: "center", color: "var(--text-3)" }}>
            <Icon name="grid" size={34} stroke="var(--text-4)"/>
            <div style={{ marginTop: 12, fontSize: 15, fontWeight: 500, color: "var(--text-2)" }}>No active flights</div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>Live feeds appear here as pilots start missions.</div>
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", ...gridStyle, gap: 10, flex: 1, minHeight: 0 }}>
          {ACTIVE_FLIGHTS.map((f, i) => (
            <FeedTile key={f.id} flight={f} index={i} layout={layout} onFocus={() => onFocus(f)} onPin={() => setFocused(f.id)}/>
          ))}
          {/* Fill the rest of the grid with placeholders so the layout reads as multi-screen */}
          {Array.from({ length: Math.max(0, 4 - ACTIVE_FLIGHTS.length) }).map((_, i) => (
            <div key={"ph" + i} style={{ background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 10, display: "grid", placeItems: "center", color: "var(--text-4)" }}>
              <div style={{ textAlign: "center" }}>
                <Icon name="video" size={22} stroke="var(--text-4)"/>
                <div style={{ marginTop: 6, fontSize: 11.5 }}>Awaiting feed</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer strip — ops chat / quick command */}
      <div style={{ marginTop: 10, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 8, display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {ACTIVE_FLIGHTS.map(f => (
            <div key={f.id} title={f.pilot?.name || f.id} className="user-avatar" style={{ width: 28, height: 28, fontSize: 11, background: `linear-gradient(135deg, ${f.pilot?.color || "#2563eb"}, color-mix(in oklab, ${f.pilot?.color || "#2563eb"} 70%, #000))` }}>{f.pilot?.initials || "—"}</div>
          ))}
        </div>
        <div className="vdivider" style={{ height: 24 }}/>
        <input className="input" placeholder="Broadcast to all pilots… (Enter to send)" style={{ flex: 1, border: "none", background: "transparent" }}/>
        <button className="btn btn-primary btn-sm"><Icon name="send" size={12}/> Broadcast</button>
      </div>
    </div>
  );
}

function FeedTile({ flight, index, onFocus, onPin }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", position: "relative", display: "flex", flexDirection: "column" }}>
      {/* tile head */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderBottom: "1px solid var(--border)", background: "var(--surface-2)" }}>
        <div className="user-avatar" style={{ width: 22, height: 22, fontSize: 9, background: `linear-gradient(135deg, ${flight.pilot?.color || "#2563eb"}, color-mix(in oklab, ${flight.pilot?.color || "#2563eb"} 70%, #000))` }}>{flight.pilot?.initials || "—"}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            {flight.pilot?.name || flight.id} <span className="mono muted" style={{ fontSize: 10 }}>· {flight.id}</span>
          </div>
          <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{flight.area}</div>
        </div>
        <span className="badge badge-live" style={{ fontSize: 9, padding: "1px 6px" }}><span className="dot"/>LIVE</span>
        <button className="iconbtn" style={{ width: 24, height: 24 }} onClick={onFocus}><Icon name="expand" size={12}/></button>
      </div>

      {/* mini feed */}
      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
        <MiniFeed flight={flight} index={index}/>
      </div>

      {/* tile foot — telemetry */}
      <div style={{ display: "flex", gap: 10, padding: "6px 10px", borderTop: "1px solid var(--border)", background: "var(--surface-2)", fontSize: 11 }} className="mono">
        <span><Icon name="altitude" size={10}/> {flight.altitude || 0}m</span>
        <span><Icon name="pulse" size={10}/> {(flight.speed ?? 0).toFixed(1)}m/s</span>
        <span style={{ color: flight.signal > 75 ? "var(--success)" : flight.signal > 50 ? "var(--warning)" : "var(--danger)" }}><Icon name="signal" size={10}/> {flight.signal ?? "—"}%</span>
        <span><Icon name="battery" size={10}/> {flight.uav?.battery ?? "—"}%</span>
        <span className="muted" style={{ marginLeft: "auto" }}>{flight.duration}</span>
      </div>
    </div>
  );
}

function MiniFeed({ flight, index }) {
  const palettes = [
    ["#2a3a26", "#5a6a3a"],
    ["#2c3a5a", "#4a5c80"],
    ["#3a2a2a", "#6a4a3a"],
    ["#2a3a3a", "#3a5a5a"],
  ];
  const [a, b] = palettes[index % palettes.length];

  return (
    <div style={{ position: "absolute", inset: 0, background: `linear-gradient(${135 + index * 12}deg, ${a}, ${b})`, overflow: "hidden" }}>
      <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <path d={`M-50 ${150 + index * 8} Q 100 ${130 + index * 4}, 250 ${160 + index * 6} T 450 ${140 + index * 2}`} stroke="#8a7a4e" strokeWidth="8" fill="none" opacity="0.8"/>
        {Array.from({ length: 18 }).map((_, i) => {
          const x = (i * 37 + index * 13) % 400;
          const y = ((i * 53 + index * 7) % 240) + 30;
          return <circle key={i} cx={x} cy={y} r={3 + (i % 3)} fill="#1f2818" opacity="0.7"/>;
        })}
        <g fill="#2a2520">
          <rect x={60 + index * 11} y={90} width="40" height="28"/>
          <rect x={210 + index * 6} y={110} width="50" height="32"/>
        </g>
        <path d={`M-50 ${220 + index * 5} Q 150 ${210 + index * 3}, 250 ${230 + index * 2} T 450 ${220}`} stroke="#2c4a6a" strokeWidth="14" fill="none" opacity="0.6"/>
      </svg>
      {/* Detection box */}
      <div style={{ position: "absolute", left: `${30 + (index * 7) % 30}%`, top: `${40 + (index * 9) % 25}%`, width: 50, height: 32, border: "2px solid #ef4444" }}>
        <div style={{ position: "absolute", top: -16, left: -2, background: "#ef4444", color: "white", fontFamily: "var(--font-mono)", fontSize: 8, padding: "1px 4px" }}>OBJ {(0.78 + index * 0.04).toFixed(2)}</div>
      </div>
      <div style={{ position: "absolute", inset: 0, color: "white", padding: 8, fontFamily: "var(--font-mono)", fontSize: 9, textShadow: "0 1px 2px rgba(0,0,0,0.6)", display: "flex", justifyContent: "space-between", alignItems: "flex-end", pointerEvents: "none" }}>
        <span>{(flight.lat ?? 0).toFixed(3)}°N · {(flight.lng ?? 0).toFixed(3)}°E</span>
        <span>EO/IR · 1080p</span>
      </div>
    </div>
  );
}

Object.assign(window, { MultiScreenView });
