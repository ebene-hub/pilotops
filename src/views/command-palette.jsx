import React from "react";
// Pilot Ops — Cmd-K command palette
// Global keyboard-driven palette: navigate, search flights/incidents/pilots/media.
const { useState: ckUseState, useEffect: ckUseEffect, useMemo: ckUseMemo, useRef: ckUseRef } = React;

function CommandPalette({ open, onClose, onNavigate }) {
  const [q, setQ] = ckUseState("");
  const [activeIdx, setActiveIdx] = ckUseState(0);
  const inputRef = ckUseRef(null);
  const listRef = ckUseRef(null);

  // Reset on open
  ckUseEffect(() => {
    if (open) {
      setQ("");
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // ---------- Source data ----------
  const navItems = ckUseMemo(() => [
    { kind: "Navigate", label: "Flight Hub",           id: "flight-hub", icon: "drone",  shortcut: "G F" },
    { kind: "Navigate", label: "Start mission",        id: "notify",     icon: "play",   shortcut: "G S" },
    { kind: "Navigate", label: "Live stream",          id: "live",       icon: "video",  shortcut: "G L" },
    { kind: "Navigate", label: "Multi-screen ops",     id: "multi",      icon: "grid" },
    { kind: "Navigate", label: "Post-flight summary",  id: "summary",    icon: "mail" },
    { kind: "Navigate", label: "Aircraft and Batteries", id: "fleet",      icon: "drone" },
    { kind: "Navigate", label: "Pilot logbook",        id: "logbook",    icon: "reports" },
    { kind: "Navigate", label: "Media gallery",        id: "gallery",    icon: "image" },
    { kind: "Navigate", label: "Log incident",         id: "incidents",  icon: "warn" },
    { kind: "Navigate", label: "Flight log archive",   id: "reports",    icon: "reports" },
    { kind: "Navigate", label: "Admin console →",      id: "_admin",     icon: "settings" },
  ], []);

  const flights = ckUseMemo(() => [
    ...ACTIVE_FLIGHTS.map(f => ({ kind: "Flight", label: f.id, sub: `${f.area} · ${f.pilot.name}`, route: "flight-hub", icon: "drone", badge: "LIVE" })),
    ...RECENT_FLIGHTS.map(f => ({ kind: "Flight", label: f.id, sub: `${f.area} · ${f.pilot}`, route: "reports", icon: "reports" })),
  ], []);

  const incidents = ckUseMemo(() => INCIDENTS.map(i => ({
    kind: "Incident", label: i.id, sub: `${i.type} · ${i.place} · ${i.severity}`, route: "incidents", icon: "warn",
    badge: i.status === "open" ? "OPEN" : null,
  })), []);

  const pilots = ckUseMemo(() => PILOTS.map(p => ({
    kind: "Pilot", label: p.name, sub: `${p.license} · ${p.hours} hr`, route: "logbook", icon: "users",
    avatar: p.initials, avatarColor: p.color,
  })), []);

  const actions = ckUseMemo(() => [
    { kind: "Action", label: "Toggle dark mode",       icon: "settings", do: () => {
      const el = document.documentElement;
      el.dataset.theme = el.dataset.theme === "dark" ? "light" : "dark";
    }},
    { kind: "Action", label: "Open Tweaks panel",       icon: "settings", do: () => window.parent?.postMessage({ type: "tweaks:open" }, "*") },
    { kind: "Action", label: "Export current view…",    icon: "download", do: () => alert("Export coming soon") },
  ], []);

  const all = ckUseMemo(() => [...navItems, ...flights, ...incidents, ...pilots, ...actions], [navItems, flights, incidents, pilots, actions]);

  // ---------- Filter ----------
  const filtered = ckUseMemo(() => {
    if (!q.trim()) {
      // No query — show navigate items + recents
      return [...navItems, ...flights.slice(0, 4), ...incidents.slice(0, 3), ...actions];
    }
    const lc = q.toLowerCase();
    return all
      .map(item => {
        const text = (item.label + " " + (item.sub || "") + " " + item.kind).toLowerCase();
        let score = 0;
        if (text.startsWith(lc)) score = 100;
        else if (item.label.toLowerCase().includes(lc)) score = 60;
        else if (text.includes(lc)) score = 30;
        return { ...item, _score: score };
      })
      .filter(x => x._score > 0)
      .sort((a, b) => b._score - a._score)
      .slice(0, 40);
  }, [q, all, navItems, flights, incidents, actions]);

  // Reset active index when filtered changes
  ckUseEffect(() => { setActiveIdx(0); }, [q]);

  // Scroll active row into view
  ckUseEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-row="${activeIdx}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  function pick(item) {
    if (item.id === "_admin") {
      window.location.href = "/admin.html";
      return;
    }
    if (item.do) item.do();
    else if (item.route) onNavigate(item.route);
    else if (item.id) onNavigate(item.id);
    onClose();
  }

  function onKey(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(i => Math.min(filtered.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx(i => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[activeIdx]) pick(filtered[activeIdx]); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  }

  if (!open) return null;

  // Group results by kind for display
  const groups = filtered.reduce((acc, item, idx) => {
    const k = item.kind || "Other";
    if (!acc[k]) acc[k] = [];
    acc[k].push({ ...item, _idx: idx });
    return acc;
  }, {});

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(8, 12, 22, 0.55)",
      backdropFilter: "blur(4px)",
      display: "grid", placeItems: "start center",
      paddingTop: "min(15vh, 120px)",
      animation: "cmdkFadeIn 0.12s ease-out"
    }}>
      <style>{`
        @keyframes cmdkFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes cmdkSlideIn { from { transform: translateY(-8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .cmdk-row { transition: background 0.06s; }
      `}</style>
      <div onClick={e => e.stopPropagation()} style={{
        width: "min(640px, 90vw)",
        maxHeight: "70vh",
        background: "var(--surface)",
        borderRadius: 14,
        border: "1px solid var(--border-strong)",
        boxShadow: "0 24px 60px rgba(0,0,0,0.32), 0 4px 12px rgba(0,0,0,0.16)",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
        animation: "cmdkSlideIn 0.16s cubic-bezier(0.2,0.7,0.2,1)"
      }}>
        {/* Search input */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 18px", borderBottom: "1px solid var(--border)" }}>
          <Icon name="search" size={18} stroke="var(--text-3)"/>
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey}
                 placeholder="Search flights, incidents, pilots, actions… or jump anywhere"
                 style={{ flex: 1, border: "none", background: "transparent", outline: "none", fontSize: 15, color: "var(--text)" }}/>
          <kbd style={{ fontSize: 10, padding: "3px 7px", borderRadius: 4, background: "var(--bg-muted)", color: "var(--text-3)", border: "1px solid var(--border)" }}>ESC</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
          {filtered.length === 0 && (
            <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-3)" }}>
              <Icon name="search" size={28} stroke="var(--text-4)"/>
              <div style={{ marginTop: 10, fontSize: 14 }}>No matches for "{q}"</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Try a flight ID, pilot name, or action.</div>
            </div>
          )}
          {Object.entries(groups).map(([groupName, rows]) => (
            <div key={groupName}>
              <div style={{
                padding: "10px 18px 4px", fontSize: 10.5, fontWeight: 600,
                color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em"
              }}>{groupName}</div>
              {rows.map(item => {
                const isActive = item._idx === activeIdx;
                return (
                  <div key={item._idx + "-" + item.label} data-row={item._idx}
                    className="cmdk-row"
                    onMouseMove={() => setActiveIdx(item._idx)}
                    onClick={() => pick(item)}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "9px 18px", cursor: "pointer",
                      background: isActive ? "var(--accent-soft)" : "transparent",
                    }}>
                    {item.avatar ? (
                      <div className="user-avatar" style={{
                        width: 26, height: 26, fontSize: 10,
                        background: `linear-gradient(135deg, ${item.avatarColor}, color-mix(in oklab, ${item.avatarColor} 70%, #000))`,
                        flexShrink: 0
                      }}>{item.avatar}</div>
                    ) : (
                      <div style={{
                        width: 26, height: 26, borderRadius: 6,
                        background: isActive ? "var(--accent)" : "var(--bg-muted)",
                        color: isActive ? "white" : "var(--text-2)",
                        display: "grid", placeItems: "center", flexShrink: 0,
                        transition: "all 0.1s"
                      }}>
                        <Icon name={item.icon || "search"} size={13}/>
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 500, color: isActive ? "var(--accent)" : "var(--text)" }}>{item.label}</div>
                      {item.sub && <div className="muted" style={{ fontSize: 11.5, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.sub}</div>}
                    </div>
                    {item.badge && (
                      <span style={{ fontSize: 9.5, fontWeight: 700, padding: "1.5px 6px", borderRadius: 3, background: item.badge === "LIVE" ? "var(--danger)" : "var(--bg-muted)", color: item.badge === "LIVE" ? "white" : "var(--text-2)", letterSpacing: "0.05em" }}>
                        {item.badge}
                      </span>
                    )}
                    {item.shortcut && !item.badge && (
                      <span className="mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>{item.shortcut}</span>
                    )}
                    {isActive && <Icon name="chev" size={13} style={{ color: "var(--accent)" }}/>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          display: "flex", alignItems: "center", gap: 16,
          padding: "8px 18px", borderTop: "1px solid var(--border)",
          background: "var(--bg-subtle)", fontSize: 11, color: "var(--text-3)"
        }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <kbd style={kbdStyle}>↑</kbd><kbd style={kbdStyle}>↓</kbd> navigate
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <kbd style={kbdStyle}>↵</kbd> select
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <kbd style={kbdStyle}>esc</kbd> close
          </span>
          <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)" }}>
            {filtered.length} result{filtered.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>
    </div>
  );
}

const kbdStyle = {
  display: "inline-grid", placeItems: "center",
  minWidth: 16, height: 16, padding: "0 4px",
  fontSize: 9.5, fontFamily: "var(--font-mono)",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 3, color: "var(--text-2)",
};

Object.assign(window, { CommandPalette });
