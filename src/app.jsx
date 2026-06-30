import React from "react";
import { supabase } from "./api/supabase.js";
import { visibleNotifs, unreadCount, isUnread, markAllRead, clearAllNotifs } from "./api/notif-read.js";
// Pilot Ops — App shell: sidebar nav, topbar, tweaks, routing
const { useState: appUseState, useEffect: appUseEffect, useMemo: appUseMemo } = React;

// Static nav structure (no dummy badges). Live counts are injected at render.
const NAV = [
  { group: "Operations", items: [
    { id: "flight-hub", label: "Flight Hub", icon: "drone" },
    { id: "notify", label: "Start mission", icon: "play", perm: "flight.create" },
    { id: "live", label: "Live stream", icon: "video" },
    { id: "multi", label: "Multi-screen ops", icon: "grid" },
    { id: "summary", label: "Post-flight summary", icon: "mail" },
  ]},
  { group: "Fleet", items: [
    { id: "fleet", label: "Aircraft and Batteries", icon: "drone" },
  ]},
  { group: "Storage", items: [
    { id: "gallery", label: "Media gallery", icon: "image" },
  ]},
  { group: "Logging", items: [
    { id: "logbook", label: "Pilot logbook", icon: "reports" },
    { id: "incidents", label: "Log incident", icon: "warn" },
    { id: "reports", label: "Flight log archive", icon: "reports" },
  ]},
];

// Inject live badges (real active-flight counts) onto the nav.
function navWithBadges() {
  const active = (window.ACTIVE_FLIGHTS || []).length;
  return NAV.map(g => ({ ...g, items: g.items.map(it => {
    const locked = it.perm && window.hasPerm && !window.hasPerm(it.perm);
    if (it.id === "flight-hub" || it.id === "multi") return { ...it, locked, badge: active ? String(active) : null };
    if (it.id === "live") return { ...it, locked, badge: active ? "LIVE" : null, live: active > 0 };
    return { ...it, locked };
  })}));
}

const TITLES = {
  "flight-hub": ["Operations", "Flight Hub"],
  "notify": ["Operations", "Start mission"],
  "live": ["Operations", "Live stream"],
  "multi": ["Operations", "Multi-screen ops"],
  "summary": ["Operations", "Post-flight summary"],
  "fleet": ["Fleet", "Aircraft and Batteries"],
  "gallery": ["Storage", "Media gallery"],
  "logbook": ["Logging", "Pilot logbook"],
  "incidents": ["Logging", "Incident report"],
  "reports": ["Logging", "Flight log archive"],
};

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "accent": "#2563eb",
  "basemap": "carto",
  "density": "regular",
  "sector": "generic",
  "sidebarPos": "left",
  "sidebarCollapsed": false,
  "showLiveBadge": true,
  "showAiAvatar": true
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [view, setView] = appUseState("flight-hub");
  const [activeFlight, setActiveFlight] = appUseState(ACTIVE_FLIGHTS[0]);
  const [mobileNavOpen, setMobileNavOpen] = appUseState(false);
  const [paletteOpen, setPaletteOpen] = appUseState(false);

  // Close mobile nav when route changes
  appUseEffect(() => { setMobileNavOpen(false); }, [view]);

  // Track narrow viewport for responsive UI affordances
  const [isNarrow, setIsNarrow] = appUseState(typeof window !== "undefined" && window.innerWidth < 900);
  appUseEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < 900);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Cmd-K / Ctrl-K global hotkey
  appUseEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(p => !p);
      } else if (e.key === "/" && !/INPUT|TEXTAREA/.test(e.target?.tagName) && !e.target?.isContentEditable) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Admin-managed state shared with the pilot's mission-start form
  const [teamRoster, setTeamRoster] = appUseState(TEAM_ROSTER);
  const [fieldConfig, setFieldConfig] = appUseState(DEFAULT_FIELD_CONFIG);

  // Apply theme / density / accent / sector / sidebar on the shell
  appUseEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = t.theme === "dark" ? "dark" : t.theme === "hc" ? "hc" : "";
    root.dataset.density = t.density;
    root.style.setProperty("--accent", t.accent);
    // Recompute hover from accent
    root.style.setProperty("--accent-hover", t.accent);
    root.style.setProperty("--accent-soft", `color-mix(in oklab, ${t.accent} 10%, transparent)`);
    root.style.setProperty("--accent-ring", `color-mix(in oklab, ${t.accent} 22%, transparent)`);
  }, [t.theme, t.density, t.accent]);

  const breadcrumbs = TITLES[view] || ["", ""];

  const setBasemap = (b) => setTweak("basemap", b);

  return (
    <div className="app-shell" data-sidebar-pos={t.sidebarPos} data-sidebar-collapsed={t.sidebarCollapsed} data-mobile-nav={mobileNavOpen ? "open" : "closed"}>
      {mobileNavOpen && <div className="mobile-nav-scrim" onClick={() => setMobileNavOpen(false)}/>}
      <Sidebar nav={navWithBadges()} view={view} setView={setView} collapsed={t.sidebarCollapsed && !isNarrow} onToggle={() => setTweak("sidebarCollapsed", !t.sidebarCollapsed)} onMobileClose={() => setMobileNavOpen(false)}/>
      <div className="main-col">
        <Topbar crumbs={breadcrumbs} view={view} sector={t.sector} setSector={v => setTweak("sector", v)} onMobileMenu={() => setMobileNavOpen(true)} onOpenPalette={() => setPaletteOpen(true)} t={t} setTweak={setTweak}/>
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          <ViewRenderer view={view} basemap={t.basemap} setBasemap={setBasemap} activeFlight={activeFlight}
            onStartFlight={() => setView("notify")}
            onOpenStream={(f) => { setActiveFlight(f); setView("live"); }}
            onEndFlight={(f) => {
              // The live view already refreshed the store, so the just-ended flight
              // is now in RECENT_FLIGHTS with its final data (status, duration,
              // coverage…). Hand that completed copy to the summary so it shows
              // instantly — no manual refresh.
              const ended = (window.RECENT_FLIGHTS || []).find(x => x.dbId === f?.dbId) || f;
              setActiveFlight(ended);
              setView("summary");
            }}
            onEmergencyLaunched={(entry) => {
              // emergency-launch builds the real flight (with dbId) for us.
              const flight = entry.flightObj || {
                id: entry.id, area: entry.area, pilot: PILOTS[0] || null,
                uav: (typeof AIRCRAFT !== "undefined" ? AIRCRAFT.find(a => a.id === entry.aircraft) : null) || null,
                status: "live", emergency: true, emergencyType: entry.type,
                typeLabel: entry.typeLabel, justification: entry.justification,
              };
              setActiveFlight(flight);
              setView("live");
            }}
            onFocus={(f) => { setActiveFlight(f); setView("live"); }}
            accent={t.accent}
            teamRoster={teamRoster} setTeamRoster={setTeamRoster}
            fieldConfig={fieldConfig} setFieldConfig={setFieldConfig}
          />
        </div>
      </div>
      <PilotOpsTweaks t={t} setTweak={setTweak}/>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onNavigate={(r) => setView(r)}/>
    </div>
  );
}

function Sidebar({ nav, view, setView, collapsed, onToggle, onMobileClose }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-mark">PO</div>
        {!collapsed && (
          <div className="brand-text">
            Pilot Ops
            <span className="brand-sub">Logging & operations</span>
          </div>
        )}
        <button className="iconbtn mobile-only" style={{ marginLeft: "auto", width: 28, height: 28 }} onClick={onMobileClose} title="Close nav">
          <Icon name="close" size={14}/>
        </button>
        <button className="iconbtn desktop-only" style={{ marginLeft: "auto", width: 28, height: 28 }} onClick={onToggle} title="Collapse sidebar">
          <Icon name="sidebar" size={14}/>
        </button>
      </div>
      <nav className="sidebar-nav">
        {nav.map(g => (
          <div key={g.group}>
            {!collapsed && <div className="nav-group-label">{g.group}</div>}
            {g.items.map(it => (
              <button key={it.id}
                className={"nav-item " + (view === it.id ? "active" : "")}
                onClick={() => !it.locked && setView(it.id)}
                disabled={it.locked}
                style={it.locked ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
                title={it.locked ? "Your role can't start missions" : it.label}>
                <Icon name={it.icon} size={16}/>
                <span>{it.label}</span>
                {it.badge && (
                  <span className={"badge " + (it.live ? "badge-live" : "")} style={{ marginLeft: "auto", fontSize: 9.5, padding: "1px 6px" }}>
                    {it.live && <span className="dot"/>}
                    {it.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-foot">
        {!collapsed && (
          <a href="/admin.html" style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "9px 12px", borderRadius: 8, marginBottom: 10,
            background: "var(--bg-subtle)", color: "var(--text-2)",
            textDecoration: "none", fontSize: 12.5, fontWeight: 500,
            border: "1px solid var(--border)"
          }} title="Open Admin console">
            <Icon name="settings" size={14}/>
            <span style={{ flex: 1 }}>Admin console</span>
            <Icon name="arrowRight" size={11} style={{ opacity: 0.6 }}/>
          </a>
        )}
        <div className="user-card" title={`Signed in as ${(window.__poUser?.name) || "Dispatcher Kade"}`}>
          <div className="user-avatar" style={{ background: window.__poUser ? `linear-gradient(135deg, ${(PILOTS.find(p => p.id === window.__poUser.pilotId)?.color) || "#2563eb"}, color-mix(in oklab, ${(PILOTS.find(p => p.id === window.__poUser.pilotId)?.color) || "#2563eb"} 70%, #000))` : "linear-gradient(135deg, #2563eb, #1d4ed8)" }}>
            {window.__poUser?.initials || "DK"}
          </div>
          {!collapsed && (
            <div className="user-meta">
              <div className="user-name">{window.__poUser?.name || "Dispatcher Kade"}</div>
              <div className="user-role">{window.__poUser ? `${window.__poUser.role || "Member"} · signed in` : "Operations Director"}</div>
            </div>
          )}
          {!collapsed && (
            <button
              className="iconbtn"
              style={{ width: 28, height: 28, marginLeft: "auto" }}
              title="Sign out"
              onClick={async (e) => {
                e.stopPropagation();
                if (confirm("Sign out of Pilot Ops?")) {
                  try { await supabase.auth.signOut(); } catch {}
                  window.location.href = "/login.html";
                }
              }}>
              <Icon name="logout" size={13}/>
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = React.useState(() => document.documentElement.getAttribute("data-theme") || "light");
  function flip() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("po:theme", next); } catch {}
    setTheme(next);
  }
  return (
    <button className="iconbtn theme-toggle hide-narrow" onClick={flip}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
      <span className="ic-sun"><Icon name="sun" size={16}/></span>
      <span className="ic-moon"><Icon name="moon" size={16}/></span>
    </button>
  );
}

function useClickOutside(onClose) {
  const ref = appUseState(() => ({ current: null }))[0];
  appUseEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) onClose(); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  return ref;
}
const POPOVER = { position: "absolute", top: "calc(100% + 8px)", right: 0, background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 10px 30px rgba(13,18,30,0.22)", zIndex: 1000, overflow: "hidden" };

function notifLabel(n) { const p = n.payload || {};
  if (n.type === "mission_start") return `Mission started · ${p.flight || ""}`;
  if (n.type === "mission_end") return `Mission ended · ${p.flight || ""}`;
  if (n.type === "emergency") return `Emergency launch · ${p.flight || ""}`;
  if (n.type === "incident") return `Incident logged${p.severity ? " · " + p.severity : ""}`;
  if (n.type === "summary") return `Post-flight summary sent · ${p.flight || ""}`;
  if (n.type === "invite") return `Invite sent · ${p.email || ""}`;
  if (n.type === "lockout") return `Pilot locked out · ${p.pilot || ""}`;
  return n.type; }
function notifRelTime(ts) { const d = Date.now() - new Date(ts).getTime(); if (d < 60000) return "just now"; if (d < 3600000) return Math.floor(d / 60000) + "m ago"; if (d < 86400000) return Math.floor(d / 3600000) + "h ago"; return Math.floor(d / 86400000) + "d ago"; }
function notifIcon(t) { return t === "emergency" || t === "incident" ? "warn" : t === "summary" ? "mail" : t === "invite" ? "mail" : "drone"; }

function NotificationDropdown({ items, onMarkRead, onClear }) {
  const visible = visibleNotifs(items);
  return (
    <div style={{ ...POPOVER, width: 320 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>Notifications</span>
        {visible.length > 0 && (
          <span style={{ display: "flex", gap: 12 }}>
            <button onClick={onMarkRead} style={{ border: "none", background: "transparent", color: "var(--accent)", fontSize: 11.5, cursor: "pointer", padding: 0 }}>Mark all read</button>
            <button onClick={onClear} style={{ border: "none", background: "transparent", color: "var(--text-3)", fontSize: 11.5, cursor: "pointer", padding: 0 }}>Clear</button>
          </span>
        )}
      </div>
      <div style={{ maxHeight: 360, overflowY: "auto" }}>
        {visible.length === 0 ? <div className="muted" style={{ padding: 20, textAlign: "center", fontSize: 12.5 }}>No notifications.</div>
          : visible.map((n, i) => { const unread = isUnread(n); return (
            <div key={i} style={{ display: "flex", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--border)", background: unread ? "var(--accent-soft)" : "transparent" }}>
              <div style={{ width: 28, height: 28, borderRadius: 7, background: n.type === "emergency" ? "color-mix(in oklab, var(--danger) 12%, transparent)" : "var(--surface)", border: "1px solid var(--border)", color: n.type === "emergency" ? "var(--danger)" : "var(--accent)", display: "grid", placeItems: "center", flexShrink: 0 }}><Icon name={notifIcon(n.type)} size={13}/></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: "var(--text)", fontWeight: unread ? 600 : 400 }}>{notifLabel(n)}</div>
                <div className="muted mono" style={{ fontSize: 10.5, marginTop: 2 }}>{notifRelTime(n.created_at)}</div>
              </div>
            </div>
          ); })}
      </div>
    </div>
  );
}

function NotificationsBell() {
  const [open, setOpen] = appUseState(false);
  const [items, setItems] = appUseState([]);
  const [, bump] = appUseState(0);
  const ref = useClickOutside(() => setOpen(false));
  async function load() {
    const { data } = await supabase.from("notifications").select("type,payload,created_at").order("created_at", { ascending: false }).limit(30);
    setItems(data || []);
  }
  appUseEffect(() => { load(); }, []);
  const unread = unreadCount(items);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="iconbtn" title="Notifications" onClick={() => { const n = !open; setOpen(n); if (n) load(); }}>
        <Icon name="bell" size={16}/>{unread > 0 && <span className="dot"/>}
      </button>
      {open && <NotificationDropdown items={items}
        onMarkRead={() => { markAllRead(items); bump(x => x + 1); }}
        onClear={() => { clearAllNotifs(); bump(x => x + 1); }}/>}
    </div>
  );
}

function SegBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: "5px 6px", fontSize: 12, textTransform: "capitalize", cursor: "pointer",
      borderRadius: 6, border: "1px solid " + (active ? "var(--accent)" : "var(--border)"),
      background: active ? "var(--accent-soft)" : "transparent",
      color: active ? "var(--accent)" : "var(--text-2)", fontWeight: active ? 600 : 500,
    }}>{children}</button>
  );
}

function SettingsMenu({ t, setTweak }) {
  const [open, setOpen] = appUseState(false);
  const ref = useClickOutside(() => setOpen(false));
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="iconbtn hide-narrow" title="Settings" onClick={() => setOpen(o => !o)}><Icon name="settings" size={16}/></button>
      {open && (
        <div style={{ ...POPOVER, width: 244, padding: 8 }}>
          <div style={{ padding: "4px 8px", fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Appearance</div>
          <div style={{ padding: "6px 8px" }}>
            <div style={{ fontSize: 12, marginBottom: 6, color: "var(--text)" }}>Theme</div>
            <div style={{ display: "flex", gap: 4 }}>
              {["light", "dark", "hc"].map(m => <SegBtn key={m} active={t.theme === m} onClick={() => setTweak("theme", m)}>{m === "hc" ? "Contrast" : m}</SegBtn>)}
            </div>
          </div>
          <div style={{ padding: "6px 8px" }}>
            <div style={{ fontSize: 12, marginBottom: 6, color: "var(--text)" }}>Density</div>
            <div style={{ display: "flex", gap: 4 }}>
              {["compact", "regular", "comfy"].map(d => <SegBtn key={d} active={t.density === d} onClick={() => setTweak("density", d)}>{d}</SegBtn>)}
            </div>
          </div>
          <div style={{ borderTop: "1px solid var(--border)", marginTop: 6, paddingTop: 6 }}>
            <button onClick={async () => { if (confirm("Sign out of Pilot Ops?")) { try { await supabase.auth.signOut(); } catch {} window.location.href = "/login.html"; } }}
              style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 8px", fontSize: 12.5, cursor: "pointer", borderRadius: 6, border: "none", background: "transparent", color: "var(--danger)", fontWeight: 500 }}>
              <Icon name="logout" size={13}/> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Topbar({ crumbs, view, sector, setSector, onMobileMenu, onOpenPalette, t, setTweak }) {
  return (
    <header className="topbar">
      <button className="iconbtn mobile-only" onClick={onMobileMenu} title="Menu">
        <Icon name="menu" size={18}/>
      </button>
      <div className="topbar-crumbs">
        <span className="hide-narrow">{crumbs[0]}</span>
        <Icon name="chev" size={12} className="sep hide-narrow"/>
        <span style={{ color: "var(--text)", fontWeight: 600 }}>{crumbs[1]}</span>
      </div>
      <div className="topbar-spacer"/>
      <button className="search-input hide-narrow" onClick={onOpenPalette}
        style={{ cursor: "pointer", border: "1px solid var(--border)", background: "var(--bg-subtle)" }}
        title="Search (⌘K)">
        <Icon name="search" size={14}/>
        <span>Search flights, incidents, pilots…</span>
        <kbd>⌘K</kbd>
      </button>
      <button className="iconbtn mobile-only" onClick={onOpenPalette} title="Search (⌘K)">
        <Icon name="search" size={16}/>
      </button>
      <select className="select hide-narrow" value={sector} onChange={e => setSector(e.target.value)} style={{ width: 180, height: 34, fontSize: 12.5 }}>
        {Object.entries(SECTORS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
      </select>
      <NotificationsBell/>
      <ThemeToggle/>
      <SettingsMenu t={t} setTweak={setTweak}/>
      <div className="vdivider hide-narrow" style={{ height: 22 }}/>
      <div className="user-avatar" style={{ background: "linear-gradient(135deg, #2563eb, #1d4ed8)" }}>DK</div>
    </header>
  );
}

function ViewRenderer({ view, basemap, setBasemap, activeFlight, onStartFlight, onOpenStream, onEndFlight, onFocus, accent, teamRoster, setTeamRoster, fieldConfig, setFieldConfig, onEmergencyLaunched }) {
  switch (view) {
    case "flight-hub": return <FlightHubView basemap={basemap} setBasemap={setBasemap} onStartFlight={onStartFlight} onOpenStream={onOpenStream} onEmergencyLaunched={onEmergencyLaunched}/>;
    case "notify":     return <NotifyComposerView teamRoster={teamRoster} fieldConfig={fieldConfig} onOpenStream={onOpenStream}/>;
    case "live":       return <LiveStreamView flight={activeFlight} basemap={basemap} setBasemap={setBasemap} onEndFlight={onEndFlight}/>;
    case "multi":      return <MultiScreenView basemap={basemap} onFocus={onFocus}/>;
    case "summary":    return <SummaryEmailView flight={activeFlight}/>;
    case "fleet":      return <FleetView/>;
    case "gallery":    return <MediaGalleryView accent={accent}/>;
    case "logbook":    return <LogbookView accent={accent}/>;
    case "incidents":  return <IncidentReportView basemap={basemap} setBasemap={setBasemap}/>;
    case "reports":    return <ReportsArchiveView/>;
    default:           return null;
  }
}

function PilotOpsTweaks({ t, setTweak }) {
  return (
    <TweaksPanel>
      <TweakSection label="Theme"/>
      <TweakRadio label="Mode" value={t.theme} options={["light", "dark", "hc"]} onChange={v => setTweak("theme", v)}/>
      <TweakColor label="Accent" value={t.accent}
        options={["#2563eb", "#7c3aed", "#0891b2", "#059669", "#d97706", "#db2777"]}
        onChange={v => setTweak("accent", v)}/>
      <TweakRadio label="Density" value={t.density} options={["compact", "regular", "comfy"]} onChange={v => setTweak("density", v)}/>

      <TweakSection label="Map"/>
      <TweakSelect label="Basemap" value={t.basemap} options={["streets", "satellite", "topographic", "dark", "carto"]} onChange={v => setTweak("basemap", v)}/>

      <TweakSection label="Sector preset"/>
      <TweakSelect label="Sector" value={t.sector}
        options={Object.entries(SECTORS).map(([k, s]) => ({ value: k, label: s.label }))}
        onChange={v => setTweak("sector", v)}/>

      <TweakSection label="Layout"/>
      <TweakRadio label="Sidebar" value={t.sidebarPos} options={["left", "right"]} onChange={v => setTweak("sidebarPos", v)}/>
      <TweakToggle label="Collapse sidebar" value={t.sidebarCollapsed} onChange={v => setTweak("sidebarCollapsed", v)}/>
      <TweakToggle label="Show LIVE badge in nav" value={t.showLiveBadge} onChange={v => setTweak("showLiveBadge", v)}/>
    </TweaksPanel>
  );
}

// Expose the shell so the entry module (main.jsx) can mount it after all
// view modules have registered their components on `window`.
Object.assign(window, { App });
