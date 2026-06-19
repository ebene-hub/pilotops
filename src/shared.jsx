import React from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
// Shared UI primitives — icons, modal, toast, charts, map
// Exposed on window for cross-script use.

const { useState, useEffect, useRef, useMemo, createContext, useContext } = React;

/* ---------- Icons (Phosphor-inspired, 1.5 stroke) ---------- */
const Ic = ({ d, size = 16, fill = "none", stroke = "currentColor", sw = 1.6, children, ...rest }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
       fill={fill} stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    {d ? <path d={d} /> : children}
  </svg>
);

const icons = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></>,
  drone: <><path d="M5 5l4 4M19 5l-4 4M5 19l4-4M19 19l-4-4"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><rect x="9" y="9" width="6" height="6" rx="1.5"/></>,
  bell: <><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9z"/><path d="M10.3 21a1.94 1.94 0 003.4 0"/></>,
  video: <><rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3"/></>,
  grid: <><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></>,
  mail: <><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 7l10 7 10-7"/></>,
  analytics: <><path d="M3 3v18h18"/><path d="M7 14l3-3 4 4 6-6"/></>,
  brain: <><path d="M9 2a3 3 0 00-3 3 3 3 0 00-3 3v1a3 3 0 002 2.8V13a3 3 0 003 3v1a3 3 0 003 3 3 3 0 003-3v-1a3 3 0 003-3v-1.2a3 3 0 002-2.8V8a3 3 0 00-3-3 3 3 0 00-3-3 3 3 0 00-3 1.5A3 3 0 009 2z"/></>,
  warn: <><path d="M10.3 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4M12 17h.01"/></>,
  reports: <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></>,
  users: <><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></>,
  search: <><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H2a2 2 0 110-4h.09A1.65 1.65 0 003.6 8a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H8a1.65 1.65 0 001-1.51V2a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V8a1.65 1.65 0 001.51 1H22a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  check: <><path d="M20 6L9 17l-5-5"/></>,
  x: <><path d="M18 6L6 18M6 6l12 12"/></>,
  chev: <><path d="M9 18l6-6-6-6"/></>,
  chevDown: <><path d="M6 9l6 6 6-6"/></>,
  arrowUp: <><path d="M12 19V5M5 12l7-7 7 7"/></>,
  arrowDown: <><path d="M12 5v14M5 12l7 7 7-7"/></>,
  arrowRight: <><path d="M5 12h14M12 5l7 7-7 7"/></>,
  arrowLeft: <><path d="M19 12H5M12 19l-7-7 7-7"/></>,
  close: <><path d="M18 6L6 18M6 6l12 12"/></>,
  eye: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>,
  eyeOff: <><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.5 18.5 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>,
  logout: <><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>,
  edit: <><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z"/></>,
  info: <><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></>,
  trendUp: <><path d="M22 7L13.5 15.5l-5-5L2 17"/><path d="M16 7h6v6"/></>,
  trendDown: <><path d="M22 17L13.5 8.5l-5 5L2 7"/><path d="M16 17h6v-6"/></>,
  pin: <><path d="M12 22s8-8 8-13a8 8 0 10-16 0c0 5 8 13 8 13z"/><circle cx="12" cy="9" r="3"/></>,
  camera: <><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></>,
  send: <><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/></>,
  upload: <><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></>,
  download: <><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></>,
  play: <><polygon points="5 3 19 12 5 21 5 3"/></>,
  pause: <><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></>,
  stop: <><rect x="5" y="5" width="14" height="14" rx="1"/></>,
  expand: <><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></>,
  collapse: <><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/></>,
  clock: <><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></>,
  signal: <><path d="M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 4v16"/></>,
  battery: <><rect x="2" y="7" width="18" height="10" rx="2"/><path d="M22 11v2"/><rect x="4" y="9" width="11" height="6" fill="currentColor" stroke="none"/></>,
  altitude: <><path d="M12 22V2M5 9l7-7 7 7M5 15l7 7 7-7"/></>,
  filter: <><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></>,
  more: <><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></>,
  link: <><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></>,
  paperclip: <><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></>,
  layers: <><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></>,
  zoom: <><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/></>,
  shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></>,
  pulse: <><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></>,
  refresh: <><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></>,
  fire: <><path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z"/></>,
  sparkle: <><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></>,
  doc: <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></>,
  collapse2: <><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/></>,
  sidebar: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></>,
  menu: <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>,
  wind: <><path d="M9.59 4.59A2 2 0 1111 8H2"/><path d="M17.73 2.27A2.5 2.5 0 1119.5 6.5H2"/><path d="M14 18a2.5 2.5 0 102.5 2.5H2"/></>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></>,
  moon: <><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></>,
  wrench: <><path d="M14.7 6.3a4.5 4.5 0 105.66 5.66l-3.91-3.91-1.75-1.75z"/><path d="M14.7 6.3L7 14l3 3 7.66-7.66"/><path d="M5 17l-3 3 2 2 3-3"/></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></>,
  folder: <><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></>,
  film: <><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"/></>,
  hardDrive: <><line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/></>,
  trash: <><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></>,
  tag: <><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><circle cx="7" cy="7" r="1.2" fill="currentColor" stroke="none"/></>,
  star: <><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></>,
};

const Icon = ({ name, size = 16, ...rest }) => (
  <Ic size={size} {...rest}>{icons[name] || null}</Ic>
);

/* ---------- Sparkline ---------- */
function Sparkline({ data, color = "currentColor", height = 32, fill = true, showDot = false }) {
  const w = 100;
  const h = height;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = Math.max(max - min, 1);
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - ((v - min) / range) * (h - 4) - 2]);
  const path = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const area = path + ` L${w},${h} L0,${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: "100%", display: "block" }}>
      {fill && <path d={area} fill={color} opacity="0.12" />}
      <path d={path} fill="none" stroke={color} strokeWidth="1.6" />
      {showDot && <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.4" fill={color} />}
    </svg>
  );
}

/* ---------- LineChart with prediction band ---------- */
function LineChart({ history, prediction, height = 220, accent = "var(--accent)" }) {
  const w = 760;
  const h = height;
  const padL = 40, padR = 16, padT = 16, padB = 26;
  const all = history.concat(prediction || []);
  const max = Math.max(...all.map(d => d.high ?? d.val)) * 1.1;
  const min = 0;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const xAt = i => padL + (i / (all.length - 1)) * innerW;
  const yAt = v => padT + innerH - ((v - min) / (max - min)) * innerH;

  const histPath = history.map((d, i) => (i ? "L" : "M") + xAt(i) + "," + yAt(d.val)).join(" ");
  const histArea = histPath + ` L${xAt(history.length - 1)},${padT + innerH} L${xAt(0)},${padT + innerH} Z`;

  let predPath = "", bandPath = "";
  if (prediction && prediction.length) {
    const start = history.length - 1;
    const lastHist = history[history.length - 1];
    const allPred = [{ val: lastHist.val, low: lastHist.val, high: lastHist.val }].concat(prediction);
    predPath = allPred.map((d, i) => (i ? "L" : "M") + xAt(start + i) + "," + yAt(d.val)).join(" ");
    const upper = allPred.map((d, i) => (i ? "L" : "M") + xAt(start + i) + "," + yAt(d.high ?? d.val)).join(" ");
    const lower = allPred.slice().reverse().map((d, i) => "L" + xAt(start + (allPred.length - 1 - i)) + "," + yAt(d.low ?? d.val)).join(" ");
    bandPath = upper + " " + lower + " Z";
  }

  const ticks = 4;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: h }}>
      {/* gridlines */}
      {Array.from({ length: ticks + 1 }).map((_, i) => {
        const y = padT + (i / ticks) * innerH;
        const v = max - (i / ticks) * (max - min);
        return (
          <g key={i}>
            <line x1={padL} y1={y} x2={w - padR} y2={y} stroke="var(--border)" strokeDasharray="2 4" />
            <text x={padL - 6} y={y + 4} fontSize="10" fill="var(--text-3)" textAnchor="end" fontFamily="var(--font-mono)">{Math.round(v)}</text>
          </g>
        );
      })}
      {/* divider between history & prediction */}
      {prediction && prediction.length && (
        <line x1={xAt(history.length - 1)} y1={padT} x2={xAt(history.length - 1)} y2={padT + innerH} stroke="var(--border-strong)" strokeDasharray="3 3"/>
      )}
      {/* history area & line */}
      <path d={histArea} fill={accent} opacity="0.08"/>
      <path d={histPath} fill="none" stroke={accent} strokeWidth="2"/>
      {/* prediction band & line */}
      {bandPath && <path d={bandPath} fill="#7c3aed" opacity="0.10"/>}
      {predPath && <path d={predPath} fill="none" stroke="#7c3aed" strokeWidth="2" strokeDasharray="4 4"/>}
      {/* x labels */}
      {[0, Math.floor(history.length / 2), history.length - 1, all.length - 1].map((i, k) => (
        <text key={k} x={xAt(i)} y={h - 8} fontSize="10" fill="var(--text-3)" textAnchor="middle" fontFamily="var(--font-mono)">D-{30 - all[i].day + (all[i].day > 30 ? 30 - all[i].day : 0)}{all[i].day > 30 ? "(fcst)" : ""}</text>
      ))}
    </svg>
  );
}

/* ---------- BarChart ---------- */
function BarChart({ data, height = 200, horizontal = false }) {
  const max = Math.max(...data.map(d => d.val)) * 1.1;
  if (horizontal) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {data.map(d => (
          <div key={d.label} style={{ display: "grid", gridTemplateColumns: "80px 1fr 40px", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 12, color: "var(--text-2)" }}>{d.label}</div>
            <div style={{ background: "var(--bg-muted)", borderRadius: 4, height: 18, position: "relative", overflow: "hidden" }}>
              <div style={{ background: d.color, height: "100%", width: `${(d.val / max) * 100}%`, borderRadius: 4, transition: "width 0.4s" }}/>
            </div>
            <div className="mono tabular" style={{ fontSize: 12, color: "var(--text-2)", textAlign: "right" }}>{d.val}</div>
          </div>
        ))}
      </div>
    );
  }
  const w = 100 / data.length;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height, padding: "0 4px" }}>
      {data.map(d => (
        <div key={d.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, height: "100%" }}>
          <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "flex-end" }}>
            <div title={`${d.label}: ${d.val}`} style={{ width: "100%", background: d.color, height: `${(d.val / max) * 100}%`, borderRadius: "4px 4px 0 0", minHeight: 4, transition: "height 0.4s" }}/>
          </div>
          <div style={{ fontSize: 10, color: "var(--text-3)" }}>{d.label}</div>
        </div>
      ))}
    </div>
  );
}

/* ---------- DonutChart ---------- */
function DonutChart({ data, size = 160, thickness = 22, centerLabel, centerSub }) {
  const total = data.reduce((s, d) => s + d.val, 0);
  const r = size / 2 - thickness / 2;
  const cx = size / 2, cy = size / 2;
  let acc = 0;
  const segs = data.map(d => {
    const frac = d.val / total;
    const start = acc;
    acc += frac;
    const end = acc;
    return { ...d, frac, start, end };
  });
  const arc = (start, end) => {
    const a0 = start * Math.PI * 2 - Math.PI / 2;
    const a1 = end * Math.PI * 2 - Math.PI / 2;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const large = end - start > 0.5 ? 1 : 0;
    return `M${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      <svg width={size} height={size}>
        {segs.map((s, i) => (
          <path key={i} d={arc(s.start, s.end)} fill="none" stroke={s.color} strokeWidth={thickness}/>
        ))}
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize="22" fontWeight="600" fill="var(--text)" fontFamily="var(--font-sans)" style={{ fontVariantNumeric: "tabular-nums" }}>{centerLabel ?? total}</text>
        <text x={cx} y={cy + 16} textAnchor="middle" fontSize="10" fill="var(--text-3)" style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>{centerSub ?? "TOTAL"}</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {segs.map(s => (
          <div key={s.label} style={{ display: "grid", gridTemplateColumns: "10px 70px 30px", alignItems: "center", gap: 8, fontSize: 12 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color }}/>
            <span style={{ color: "var(--text-2)" }}>{s.label}</span>
            <span className="mono tabular muted" style={{ textAlign: "right" }}>{Math.round(s.frac * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Modal ---------- */
function Modal({ open, onClose, title, subtitle, children, footer, size, icon }) {
  useEffect(() => {
    if (!open) return;
    const h = e => e.key === "Escape" && onClose();
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={"modal " + (size === "lg" ? "modal-lg" : size === "xl" ? "modal-xl" : "")}>
        <div className="modal-head">
          {icon && <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center" }}><Icon name={icon} size={16}/></div>}
          <div className="grow">
            <div className="modal-title">{title}</div>
            {subtitle && <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>{subtitle}</div>}
          </div>
          <button className="iconbtn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- Toast system ---------- */
const ToastCtx = createContext(null);
function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = (t) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(arr => [...arr, { id, ...t }]);
    setTimeout(() => setToasts(arr => arr.filter(x => x.id !== id)), t.duration || 4200);
  };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-stack">
        {toasts.map(t => (
          <div key={t.id} className={"toast " + (t.kind || "info")}>
            <div className="toast-ic">
              <Icon name={t.kind === "success" ? "check" : t.kind === "warn" ? "warn" : "bell"} size={13}/>
            </div>
            <div>
              <div className="toast-title">{t.title}</div>
              {t.msg && <div className="toast-msg">{t.msg}</div>}
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
const useToast = () => useContext(ToastCtx);

/* ---------- Severity / status badges ---------- */
const SeverityBadge = ({ level }) => {
  const map = {
    critical: { cls: "badge-live", label: "Critical" },
    high:     { cls: "badge", label: "High",   style: { background: "#fef2f2", color: "#b91c1c", borderColor: "#fecaca" } },
    medium:   { cls: "badge-warning", label: "Medium" },
    low:      { cls: "badge-success", label: "Low" }
  };
  const m = map[level] || map.medium;
  return <span className={"badge " + m.cls} style={m.style}><span className="dot"/>{m.label}</span>;
};

const StatusBadge = ({ status }) => {
  const map = {
    "live": { cls: "badge-live", label: "LIVE" },
    "in-flight": { cls: "badge-live", label: "In flight" },
    "standby": { cls: "badge-info", label: "Standby" },
    "off-duty": { cls: "badge", label: "Off duty" },
    "completed": { cls: "badge-success", label: "Completed" },
    "flagged": { cls: "badge-warning", label: "Flagged" },
    "open": { cls: "badge-warning", label: "Open" },
    "investigating": { cls: "badge-info", label: "Investigating" },
    "closed": { cls: "badge", label: "Closed" },
    "published": { cls: "badge-success", label: "Published" },
    "draft": { cls: "badge", label: "Draft" },
  };
  const m = map[status] || { cls: "badge", label: status };
  return <span className={"badge " + m.cls}>{m.label !== "LIVE" && m.label !== "In flight" ? null : <span className="dot"/>}{m.label}</span>;
};

/* ---------- Map (real tile basemaps via Leaflet) ---------- */
// Basemap presets backed by real tile services: OpenStreetMap, Esri (ArcGIS
// Online), and CARTO. Keys match the tweaks-panel + basemap switch options.
const BASEMAPS = {
  streets: {
    label: "Streets",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    subdomains: "abc", maxZoom: 19,
  },
  satellite: {
    label: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    maxZoom: 19,
  },
  topographic: {
    label: "Topographic",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, USGS, NOAA",
    maxZoom: 19,
  },
  dark: {
    label: "Dark",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd", maxZoom: 20,
  },
  carto: {
    label: "Light",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd", maxZoom: 20,
  },
};

// Operations area — centered on the active-flight cluster (≈ northern Nigeria).
const MAP_CENTER = [12.5, 9.3];
const MAP_ZOOM = 11;
// Bounding box used to place legacy pins that only carry x/y percentages:
// x:0→west, x:100→east, y:0→north, y:100→south.
const MAP_BBOX = { north: 12.80, south: 12.20, west: 8.92, east: 9.68 };

function xyToLatLng(p) {
  const lat = MAP_BBOX.north - ((p.y ?? 50) / 100) * (MAP_BBOX.north - MAP_BBOX.south);
  const lng = MAP_BBOX.west + ((p.x ?? 50) / 100) * (MAP_BBOX.east - MAP_BBOX.west);
  return [lat, lng];
}
function pinLatLng(p) {
  return (p.lat != null && p.lng != null) ? [p.lat, p.lng] : xyToLatLng(p);
}
// Resolve "var(--x)" colors so Leaflet's SVG renderer gets a concrete value.
function resolveColor(c) {
  if (typeof c === "string" && c.startsWith("var(")) {
    const name = c.slice(4, -1).trim();
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || "#2563eb";
  }
  return c || "#2563eb";
}

function MapCanvas({ basemap = "dark", pins = [], hotspots = [], heatmap = false, flightPaths = [], height = 380, showLegend = true, children, onBasemapChange, onPick }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const tileRef = useRef(null);
  const overlayRef = useRef(null);
  const lastFitRef = useRef("");
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const presets = ["streets", "satellite", "topographic", "dark", "carto"];

  // Init the Leaflet map once.
  useEffect(() => {
    const map = L.map(elRef.current, {
      center: MAP_CENTER, zoom: MAP_ZOOM,
      zoomControl: true, scrollWheelZoom: true, attributionControl: true,
    });
    mapRef.current = map;
    overlayRef.current = L.layerGroup().addTo(map);
    // Click-to-pick a coordinate (used by the station picker).
    map.on("click", (e) => { if (onPickRef.current) onPickRef.current({ lat: e.latlng.lat, lng: e.latlng.lng }); });
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(elRef.current);
    setTimeout(() => map.invalidateSize(), 0);
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; };
  }, []);

  // Swap the basemap tile layer when the prop changes.
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const def = BASEMAPS[basemap] || BASEMAPS.carto;
    const layer = L.tileLayer(def.url, {
      attribution: def.attribution, maxZoom: def.maxZoom || 19,
      ...(def.subdomains ? { subdomains: def.subdomains } : {}),
    });
    layer.addTo(map);
    if (tileRef.current) map.removeLayer(tileRef.current);
    tileRef.current = layer;
    layer.bringToBack();
  }, [basemap]);

  // Render pins + hotspots as Leaflet overlays.
  useEffect(() => {
    const map = mapRef.current, grp = overlayRef.current;
    if (!map || !grp) return;
    grp.clearLayers();
    const bounds = [];

    if (heatmap) {
      hotspots.forEach(h => {
        const ll = pinLatLng(h);
        L.circle(ll, { radius: 400 + (h.weight || 4) * 220, color: "#f97316", weight: 1, fillColor: "#ef4444", fillOpacity: 0.22 }).addTo(grp);
        if (h.label) L.marker(ll, { icon: L.divIcon({ className: "map-pin-icon", html: `<span class="map-hot-label">${h.label}${h.count ? " · " + h.count : ""}</span>`, iconSize: [0, 0] }) }).addTo(grp);
        bounds.push(ll);
      });
    }

    (flightPaths || []).forEach(fp => {
      if (Array.isArray(fp.latlngs)) {
        L.polyline(fp.latlngs, { color: resolveColor(fp.color || "var(--accent)"), weight: 2, dashArray: "6 4", opacity: 0.85 }).addTo(grp);
      }
    });

    pins.forEach(p => {
      const ll = pinLatLng(p);
      const color = resolveColor(p.color);
      if (p.kind === "drone") {
        const html = `<span class="map-drone" style="--c:${color}"><span class="map-drone-pulse"></span><span class="map-drone-dot"></span></span>` +
          (p.label ? `<span class="map-pin-label">${p.label}</span>` : "");
        L.marker(ll, { icon: L.divIcon({ className: "map-pin-icon", html, iconSize: [14, 14], iconAnchor: [7, 7] }), zIndexOffset: 1000 }).addTo(grp);
      } else {
        L.circleMarker(ll, { radius: p.size || 5, color: "#fff", weight: 1.5, fillColor: color, fillOpacity: 1 }).addTo(grp);
        if (p.label) {
          L.marker(ll, { icon: L.divIcon({ className: "map-pin-icon", html: `<span class="map-pin-label map-pin-label-static">${p.label}</span>`, iconSize: [0, 0] }) }).addTo(grp);
        }
      }
      bounds.push(ll);
    });

    // Fit to the points — but only when the set actually changes, so ordinary
    // re-renders don't override the user's manual pan/zoom.
    const sig = JSON.stringify(bounds);
    if (sig !== lastFitRef.current) {
      lastFitRef.current = sig;
      if (bounds.length >= 2) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      else if (bounds.length === 1) map.setView(bounds[0], 13);
    }
  }, [pins, hotspots, heatmap, flightPaths]);

  return (
    <div className="map-wrap" style={{ height }}>
      <div ref={elRef} className="leaflet-map" />

      {onBasemapChange && (
        <div className="basemap-switch">
          {presets.map(p => (
            <button key={p} className={basemap === p ? "active" : ""} onClick={() => onBasemapChange(p)}>
              {(BASEMAPS[p] && BASEMAPS[p].label) || (p[0].toUpperCase() + p.slice(1))}
            </button>
          ))}
        </div>
      )}

      {showLegend && (heatmap || pins.length > 0) && (
        <div className="map-legend">
          <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--text)" }}>Legend</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {heatmap && <div style={{ display: "flex", gap: 6, alignItems: "center" }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: "linear-gradient(135deg, #ef4444, #f97316)" }}/><span>Incident hotspot</span></div>}
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--accent)" }}/><span>Active flight</span></div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: "#16a34a" }}/><span>Station</span></div>
          </div>
        </div>
      )}

      {children}
    </div>
  );
}

/* ---------- KpiTile ---------- */
function KpiTile({ label, value, unit, delta, trend, spark, color = "var(--accent)" }) {
  return (
    <div className="kpi">
      <div className="kpi-label">
        <span>{label}</span>
      </div>
      <div className="kpi-value">
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{value}</span>
        {unit && <span className="unit">{unit}</span>}
      </div>
      {delta && (
        <div className={"kpi-delta " + (trend || "")}>
          {trend === "up" && <Icon name="arrowUp" size={11}/>}
          {trend === "down" && <Icon name="arrowDown" size={11}/>}
          <span>{delta}</span>
        </div>
      )}
      {spark && <div className="kpi-spark" style={{ color }}><Sparkline data={spark} color={color}/></div>}
    </div>
  );
}

Object.assign(window, { Icon, Sparkline, LineChart, BarChart, DonutChart, Modal, ToastProvider, useToast, SeverityBadge, StatusBadge, MapCanvas, KpiTile });
