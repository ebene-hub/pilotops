import React from "react";
import { refresh } from "./store.jsx";
import { visibleNotifs, unreadCount, isUnread, markAllRead, clearAllNotifs } from "./api/notif-read.js";
// Pilot Ops Admin — App shell. Standalone admin product, separate from pilot dashboard.
const { useState: aaAppUseState, useEffect: aaAppUseEffect } = React;

const ADMIN_NAV = [
  { group: "Dashboards", items: [
    { id: "pilot-dash", label: "Pilot performance", icon: "reports" },
  ]},
  { group: "Safety", items: [
    { id: "emergency-reviews", label: "Emergency reviews", icon: "warn" },
    { id: "incidents",         label: "Incident log",      icon: "warn" },
    { id: "lockouts",          label: "Pilot lockouts",    icon: "shield" },
  ]},
  { group: "Organization", items: [
    { id: "members",       label: "Members & invites",     icon: "users" },
    { id: "team",          label: "Team roster",           icon: "users" },
    { id: "roles",         label: "Roles & permissions",   icon: "shield" },
    { id: "stakeholders",  label: "Stakeholders",          icon: "mail" },
  ]},
  { group: "Fleet management", items: [
    { id: "aircraft",      label: "Aircraft registry",     icon: "drone" },
  ]},
  { group: "Workflows", items: [
    { id: "fields",        label: "Mission form fields",   icon: "doc" },
    { id: "notifications", label: "Notification rules",    icon: "bell" },
  ]},
  { group: "System", items: [
    { id: "sectors",       label: "Sectors & presets",     icon: "layers" },
    { id: "integrations",  label: "API & integrations",    icon: "link" },
    { id: "email",         label: "Email delivery",        icon: "mail" },
    { id: "audit",         label: "Audit log",             icon: "reports" },
  ]},
];

const ADMIN_TITLES = {
  "pilot-dash":       ["Dashboards",        "Pilot performance"],
  "emergency-reviews": ["Safety",           "Emergency reviews"],
  incidents:          ["Safety",            "Incident log"],
  lockouts:           ["Safety",            "Pilot lockouts"],
  members:            ["Organization",      "Members & invites"],
  team:               ["Organization",      "Team roster"],
  roles:         ["Organization",      "Roles & permissions"],
  stakeholders:  ["Organization",      "Stakeholders"],
  aircraft:      ["Fleet management",  "Aircraft registry"],
  fields:        ["Workflows",         "Mission form fields"],
  notifications: ["Workflows",         "Notification rules"],
  sectors:       ["System",            "Sectors & presets"],
  integrations:  ["System",            "API & integrations"],
  email:         ["System",            "Email delivery"],
  audit:         ["System",            "Audit log"],
};

const ADMIN_TWEAK_DEFAULTS = {
  "theme": "light",
  "accent": "#2563eb",
  "density": "regular",
};

function AdminApp() {
  const [t, setTweak] = useTweaks(ADMIN_TWEAK_DEFAULTS);
  // Initial route from hash: e.g. /admin.html#aircraft
  const initial = (typeof location !== "undefined" && location.hash.replace("#", "")) || "pilot-dash";
  const [view, setView] = aaAppUseState(ADMIN_TITLES[initial] ? initial : "pilot-dash");
  const [mobileNavOpen, setMobileNavOpen] = aaAppUseState(false);

  const [teamRoster, setTeamRoster] = aaAppUseState(TEAM_ROSTER);
  const [fieldConfig, setFieldConfig] = aaAppUseState(DEFAULT_FIELD_CONFIG);

  // Sync hash + close nav on route change
  aaAppUseEffect(() => {
    if (typeof history !== "undefined") history.replaceState(null, "", "#" + view);
    setMobileNavOpen(false);
  }, [view]);

  // Apply theme / density / accent
  aaAppUseEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = t.theme === "dark" ? "dark" : "";
    root.dataset.density = t.density;
    root.style.setProperty("--accent", t.accent);
    root.style.setProperty("--accent-hover", t.accent);
    root.style.setProperty("--accent-soft", `color-mix(in oklab, ${t.accent} 10%, transparent)`);
    root.style.setProperty("--accent-ring", `color-mix(in oklab, ${t.accent} 22%, transparent)`);
  }, [t.theme, t.density, t.accent]);

  const crumbs = ADMIN_TITLES[view] || ["", ""];

  return (
    <div className="app-shell" data-sidebar-pos="left" data-mobile-nav={mobileNavOpen ? "open" : "closed"}>
      {mobileNavOpen && <div className="mobile-nav-scrim" onClick={() => setMobileNavOpen(false)}/>}
      <AdminSidebar nav={ADMIN_NAV} view={view} setView={setView} onMobileClose={() => setMobileNavOpen(false)}/>
      <div className="main-col">
        <AdminTopbar crumbs={crumbs} onMobileMenu={() => setMobileNavOpen(true)}/>
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          <AdminViewRenderer view={view} teamRoster={teamRoster} setTeamRoster={setTeamRoster} fieldConfig={fieldConfig} setFieldConfig={setFieldConfig}/>
        </div>
      </div>
    </div>
  );
}

function AdminSidebar({ nav, view, setView, onMobileClose }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-mark" style={{ background: "linear-gradient(135deg, #1e293b, #0f172a)" }}>PO</div>
        <div className="brand-text">
          Pilot Ops
          <span className="brand-sub" style={{ color: "var(--accent)", fontWeight: 600, letterSpacing: "0.06em", fontSize: 10 }}>ADMIN CONSOLE</span>
        </div>
        <button className="iconbtn mobile-only" style={{ marginLeft: "auto", width: 28, height: 28 }} onClick={onMobileClose} title="Close nav">
          <Icon name="close" size={14}/>
        </button>
      </div>
      <nav className="sidebar-nav">
        {nav.map(g => (
          <div key={g.group}>
            <div className="nav-group-label">{g.group}</div>
            {g.items.map(it => (
              <button key={it.id} className={"nav-item " + (view === it.id ? "active" : "")} onClick={() => setView(it.id)} title={it.label}>
                <Icon name={it.icon} size={16}/>
                <span>{it.label}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-foot">
        <a href="/" style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 12px", borderRadius: 8,
          background: "var(--accent-soft)", color: "var(--accent)",
          textDecoration: "none", fontSize: 13, fontWeight: 500
        }}>
          <Icon name="arrowLeft" size={14}/>
          <span style={{ flex: 1 }}>Switch to Pilot Ops</span>
          <Icon name="arrowRight" size={12} style={{ opacity: 0.6 }}/>
        </a>
        <div className="user-card" style={{ marginTop: 10 }} title={`Signed in as ${(window.__poAdminUser?.name) || "Dispatcher Kade"}`}>
          <div className="user-avatar" style={{ background: "linear-gradient(135deg, #1e293b, #0f172a)" }}>
            {window.__poAdminUser?.initials || "DK"}
          </div>
          <div className="user-meta">
            <div className="user-name">{window.__poAdminUser?.name || "Dispatcher Kade"}</div>
            <div className="user-role">{window.__poAdminUser?.role || "Ops Director"} · Admin</div>
          </div>
          <button
            className="iconbtn"
            style={{ width: 28, height: 28 }}
            title="Sign out"
            onClick={async (e) => {
              e.stopPropagation();
              if (confirm("Sign out of the Admin console?")) {
                try { await window.__supabase?.auth?.signOut(); } catch {}
                window.location.href = "/admin-login.html";
              }
            }}>
            <Icon name="logout" size={13}/>
          </button>
        </div>
      </div>
    </aside>
  );
}

function AdminThemeToggle() {
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

function aaNotifLabel(n) { const p = n.payload || {};
  if (n.type === "mission_start") return `Mission started · ${p.flight || ""}`;
  if (n.type === "mission_end") return `Mission ended · ${p.flight || ""}`;
  if (n.type === "emergency") return `Emergency launch · ${p.flight || ""}`;
  if (n.type === "incident") return `Incident logged${p.severity ? " · " + p.severity : ""}`;
  if (n.type === "summary") return `Post-flight summary sent · ${p.flight || ""}`;
  if (n.type === "invite") return `Invite sent · ${p.email || ""}`;
  if (n.type === "lockout") return `Pilot locked out · ${p.pilot || ""}`;
  return n.type; }
function aaNotifRt(ts) { const d = Date.now() - new Date(ts).getTime(); if (d < 60000) return "just now"; if (d < 3600000) return Math.floor(d / 60000) + "m ago"; if (d < 86400000) return Math.floor(d / 3600000) + "h ago"; return Math.floor(d / 86400000) + "d ago"; }
function aaNotifIcon(t) { return t === "lockout" ? "shield" : t === "emergency" || t === "incident" ? "warn" : t === "summary" || t === "invite" ? "mail" : "drone"; }

function AdminNotificationsBell() {
  const [open, setOpen] = aaAppUseState(false);
  const [items, setItems] = aaAppUseState([]);
  const [, bump] = aaAppUseState(0);
  const ref = aaAppUseState(() => ({ current: null }))[0];
  aaAppUseEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  async function load() {
    if (!window.__supabase) return;
    const { data } = await window.__supabase.from("notifications").select("type,payload,created_at").order("created_at", { ascending: false }).limit(30);
    setItems(data || []);
  }
  // Live delivery: new notifications (lockouts, mission start/end, incidents…)
  // appear in the bell instantly, org-scoped by RLS.
  aaAppUseEffect(() => {
    load();
    const sb = window.__supabase; if (!sb) return;
    const ch = sb.channel("notif-bell-admin")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" },
        (p) => setItems(prev => [p.new, ...prev].slice(0, 30)))
      .subscribe();
    return () => { try { sb.removeChannel(ch); } catch {} };
  }, []);
  const visible = visibleNotifs(items);
  const unread = unreadCount(items);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="iconbtn" title="Notifications" onClick={() => { const n = !open; setOpen(n); if (n) load(); }}>
        <Icon name="bell" size={16}/>{unread > 0 && <span className="dot"/>}
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 320, background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 10px 30px rgba(13,18,30,0.22)", zIndex: 1000, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>Notifications</span>
            {visible.length > 0 && (
              <span style={{ display: "flex", gap: 12 }}>
                <button onClick={() => { markAllRead(items); bump(x => x + 1); }} style={{ border: "none", background: "transparent", color: "var(--accent)", fontSize: 11.5, cursor: "pointer", padding: 0 }}>Mark all read</button>
                <button onClick={() => { clearAllNotifs(); bump(x => x + 1); }} style={{ border: "none", background: "transparent", color: "var(--text-3)", fontSize: 11.5, cursor: "pointer", padding: 0 }}>Clear</button>
              </span>
            )}
          </div>
          <div style={{ maxHeight: 360, overflowY: "auto" }}>
            {visible.length === 0 ? <div className="muted" style={{ padding: 20, textAlign: "center", fontSize: 12.5 }}>No notifications.</div>
              : visible.map((n, i) => { const ur = isUnread(n); return (
                <div key={i} style={{ display: "flex", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--border)", background: ur ? "var(--accent-soft)" : "transparent" }}>
                  <div style={{ width: 28, height: 28, borderRadius: 7, background: (n.type === "emergency" || n.type === "lockout") ? "color-mix(in oklab, var(--danger) 12%, transparent)" : "var(--surface)", border: "1px solid var(--border)", color: (n.type === "emergency" || n.type === "lockout") ? "var(--danger)" : "var(--accent)", display: "grid", placeItems: "center", flexShrink: 0 }}><Icon name={aaNotifIcon(n.type)} size={13}/></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: "var(--text)", fontWeight: ur ? 600 : 400 }}>{aaNotifLabel(n)}</div>
                    <div className="muted mono" style={{ fontSize: 10.5, marginTop: 2 }}>{aaNotifRt(n.created_at)}</div>
                  </div>
                </div>
              ); })}
          </div>
        </div>
      )}
    </div>
  );
}

function AdminTopbar({ crumbs, onMobileMenu }) {
  return (
    <header className="topbar">
      <button className="iconbtn mobile-only" onClick={onMobileMenu} title="Menu">
        <Icon name="menu" size={18}/>
      </button>
      <div className="topbar-crumbs">
        <span className="hide-narrow" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.08em", background: "var(--accent-soft)", padding: "2px 6px", borderRadius: 3 }}>ADMIN</span>
          {crumbs[0]}
        </span>
        <Icon name="chev" size={12} className="sep hide-narrow"/>
        <span style={{ color: "var(--text)", fontWeight: 600 }}>{crumbs[1]}</span>
      </div>
      <div className="topbar-spacer"/>
      <a href="/" className="btn hide-narrow" style={{ textDecoration: "none" }}>
        <Icon name="arrowLeft" size={13}/> Pilot Ops
      </a>
      <AdminNotificationsBell/>
      <AdminThemeToggle/>
      <div className="vdivider hide-narrow" style={{ height: 22 }}/>
      <div className="user-avatar" style={{ background: "linear-gradient(135deg, #1e293b, #0f172a)" }}>DK</div>
    </header>
  );
}

function AdminViewRenderer({ view, teamRoster, setTeamRoster, fieldConfig, setFieldConfig }) {
  switch (view) {
    case "pilot-dash":         return <AdminPilotDashboardView/>;
    case "emergency-reviews":  return <AdminEmergencyReviewView/>;
    case "incidents":          return <AdminPage title="Incident log" sub="Every incident logged by crew, saved to the incidents table. Filter and export to CSV."><AdminIncidentsView/></AdminPage>;
    case "lockouts":           return <AdminPage title="Pilot lockouts" sub="Pilots are locked for 15 minutes after 3 wrong launch codes. Override to let a pilot retry immediately."><AdminLockoutsView/></AdminPage>;
    case "members":            return <AdminPage title="Members & invites" sub="Everyone who can sign in to Pilot Ops. Invite new members by email — they register via a single-use link."><MembersInvitesView/></AdminPage>;
    case "team":               return <AdminPage title="Team roster" sub="Field crew and pilot codes. Pilots pick from this list when starting a mission — codes prevent impersonation."><TeamRosterTab teamRoster={teamRoster} setTeamRoster={setTeamRoster}/></AdminPage>;
    case "roles":         return <AdminPage title="Roles & permissions" sub="What each role can read, write, or approve."><RolesView/></AdminPage>;
    case "stakeholders":  return <AdminPage title="Stakeholders & recipients" sub="External people who receive notifications and post-flight summaries by email — they are not app users."><StakeholdersView/></AdminPage>;
    case "aircraft":      return <AdminAircraftView/>;
    case "fields":        return <AdminPage title="Mission form fields" sub="Configure what pilots fill in when starting a mission."><FormFieldsTab fieldConfig={fieldConfig} setFieldConfig={setFieldConfig}/></AdminPage>;
    case "notifications": return <AdminPage title="Notification rules" sub="Who gets notified, when, and via which channel."><NotificationsView/></AdminPage>;
    case "sectors":       return <AdminPage title="Sectors & presets" sub="Industry-specific defaults for incident types and places."><SectorsView/></AdminPage>;
    case "integrations":  return <AdminPage title="API & integrations" sub="Connect Pilot Ops to your existing tools."><IntegrationsView/></AdminPage>;
    case "email":         return <AdminPage title="Email delivery" sub="Send mission notices & post-flight summaries through your own SMTP server or Resend key."><AdminEmailSettingsView/></AdminPage>;
    case "audit":         return <AdminPage title="Audit log" sub="Every configuration change is logged here."><AuditView/></AdminPage>;
    default:              return null;
  }
}

function AdminPage({ title, sub, children }) {
  return (
    <div className="main-content">
      <div className="page-head">
        <div>
          <h1 className="page-title">{title}</h1>
          <div className="page-sub">{sub}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

/* ---------- Sub-views (extracted from old AdminView so each admin route is self-contained) ---------- */

function RolesView() {
  const toast = useToast();
  // Real roles from the DB (store global). Edits are session-local for now.
  const [roles, setRoles] = React.useState(() =>
    (window.ALL_ROLES || []).map(r => ({ id: r.id, name: r.name, desc: r.description || "", perms: r.permissions || [] })));
  const [editing, setEditing] = React.useState(null);
  const [viewingMembers, setViewingMembers] = React.useState(null);
  const [members, setMembers] = React.useState(() => (window.ivLoadMembers ? ivLoadMembers() : []));

  // Refresh members whenever the tab regains focus (so changes from Members & invites flow back here)
  React.useEffect(() => {
    function refresh() { if (window.ivLoadMembers) setMembers(ivLoadMembers()); }
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  // Map role name -> array of members assigned that role
  const membersByRole = React.useMemo(() => {
    const map = {};
    roles.forEach(r => { map[r.name] = []; });
    members.forEach(m => {
      (m.roles || []).forEach(r => {
        if (!map[r]) map[r] = [];
        map[r].push(m);
      });
    });
    return map;
  }, [roles, members]);

  // Canonical, ENFORCED permissions (RLS gates writes on these; see 0006).
  const ALL_PERMS = [
    { v: "*", l: "Full access (everything)" },
    { v: "flight.create", l: "Start missions / flights" },
    { v: "incident.create", l: "Log incidents" },
    { v: "media.upload", l: "Upload media" },
    { v: "battery.update", l: "Update batteries" },
    { v: "report.create", l: "Create reports" },
    { v: "report.approve", l: "Approve reports" },
    { v: "emergency.review", l: "Review emergency launches" },
    { v: "fleet.manage", l: "Manage aircraft & batteries" },
    { v: "team.manage", l: "Manage members & roles" },
    { v: "audit.read", l: "Read audit log" },
  ];

  async function save(patch) {
    const sb = window.__supabase;
    const row = { name: patch.name, description: patch.desc, permissions: patch.perms };
    if (editing._new) {
      const { data, error } = await sb.from("roles").insert(row).select().single();
      if (error) { toast({ kind: "warn", title: "Create failed", msg: error.message }); return; }
      setRoles(prev => [...prev, { id: data.id, name: data.name, desc: data.description || "", perms: data.permissions || [] }]);
      toast({ kind: "success", title: "Role created", msg: `${patch.name} is now selectable when inviting members.` });
    } else {
      const { error } = await sb.from("roles").update(row).eq("id", editing.id);
      if (error) { toast({ kind: "warn", title: "Save failed", msg: error.message }); return; }
      setRoles(prev => prev.map(r => r.id === editing.id ? { ...r, ...patch } : r));
      toast({ kind: "success", title: "Role updated", msg: `${patch.name} permissions saved.` });
    }
    try { await refresh(); if (window.ivLoadMembers) setMembers(ivLoadMembers()); } catch {}
    setEditing(null);
  }
  async function remove(role) {
    const count = (membersByRole[role.name] || []).length;
    if (!confirm(`Delete role "${role.name}"? ${count} member(s) will lose this role.`)) return;
    const { error } = await window.__supabase.from("roles").delete().eq("id", role.id);
    if (error) { toast({ kind: "warn", title: "Delete failed", msg: error.message }); return; }
    setRoles(prev => prev.filter(r => r.id !== role.id));
    try { await refresh(); } catch {}
    toast({ kind: "info", title: "Role deleted", msg: `${role.name} removed.` });
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={() => setEditing({ _new: true, name: "", desc: "", perms: [] })}>
          <Icon name="plus" size={13}/> Add role
        </button>
      </div>
      <div className="grid-2">
        {roles.map(r => {
          const ms = membersByRole[r.name] || [];
          return (
          <div key={r.id} className="card">
            <div className="card-body" style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                <Icon name="shield" size={18}/>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{r.name}</div>
                  <button className="pill" onClick={() => ms.length && setViewingMembers({ role: r.name, members: ms })} style={{ cursor: ms.length ? "pointer" : "default", border: "1px solid var(--border)" }}>
                    {ms.length} {ms.length === 1 ? "member" : "members"}
                  </button>
                </div>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{r.desc}</div>

                {/* Avatar stack */}
                {ms.length > 0 && (
                  <button onClick={() => setViewingMembers({ role: r.name, members: ms })}
                    style={{ display: "flex", alignItems: "center", gap: 0, marginTop: 10, padding: 0, border: "none", background: "transparent", cursor: "pointer" }}>
                    {ms.slice(0, 5).map((m, i) => (
                      <div key={m.id} className="user-avatar" style={{ width: 26, height: 26, fontSize: 9.5, marginLeft: i === 0 ? 0 : -6, background: `linear-gradient(135deg, ${m.color}, color-mix(in oklab, ${m.color} 70%, #000))`, boxShadow: "0 0 0 2px var(--surface)" }}>{m.initials}</div>
                    ))}
                    {ms.length > 5 && (
                      <div className="user-avatar" style={{ width: 26, height: 26, fontSize: 9.5, marginLeft: -6, background: "var(--bg-muted)", color: "var(--text-2)", boxShadow: "0 0 0 2px var(--surface)", fontWeight: 600 }}>+{ms.length - 5}</div>
                    )}
                    <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>View all</span>
                  </button>
                )}

                <div className="row" style={{ flexWrap: "wrap", gap: 4, marginTop: 12, paddingTop: 12, borderTop: "1px dashed var(--border)" }}>
                  {r.perms.map(p => <span key={p} className="badge mono" style={{ fontSize: 10 }}>{p}</span>)}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <button className="btn btn-sm btn-ghost" title="Edit role" onClick={() => setEditing(r)}><Icon name="edit" size={13}/></button>
                {r.name !== "Director" && <button className="btn btn-sm btn-ghost" title="Delete role" onClick={() => remove(r)}><Icon name="trash" size={13}/></button>}
              </div>
            </div>
          </div>
        );})}
      </div>

      {viewingMembers && (
        <Modal open onClose={() => setViewingMembers(null)} icon="users" size="md"
          title={`${viewingMembers.role} — ${viewingMembers.members.length} member${viewingMembers.members.length === 1 ? "" : "s"}`}
          subtitle="Click a member to manage their roles in Members & invites."
          footer={<>
            <button className="btn" onClick={() => setViewingMembers(null)}>Close</button>
            <a href="#members" className="btn btn-primary" onClick={() => setViewingMembers(null)}><Icon name="users" size={13}/> Go to Members</a>
          </>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {viewingMembers.members.map(m => (
              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface)" }}>
                <div className="user-avatar" style={{ width: 32, height: 32, fontSize: 11, background: `linear-gradient(135deg, ${m.color}, color-mix(in oklab, ${m.color} 70%, #000))` }}>{m.initials}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{m.name}</div>
                  <div className="mono muted" style={{ fontSize: 11, marginTop: 1 }}>{m.email}</div>
                </div>
                <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                  {(m.roles || []).map(rn => <span key={rn} className="pill" style={{ background: rn === viewingMembers.role ? "var(--accent-soft)" : "var(--bg-muted)", color: rn === viewingMembers.role ? "var(--accent)" : "var(--text-2)", borderColor: rn === viewingMembers.role ? "var(--accent)" : "var(--border)" }}>{rn}</span>)}
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {editing && (
        <RoleEditModal role={editing} allPerms={ALL_PERMS} onClose={() => setEditing(null)} onSave={save}/>
      )}
    </>
  );
}

function RoleEditModal({ role, allPerms, onClose, onSave }) {
  const [name, setName] = React.useState(role.name);
  const [desc, setDesc] = React.useState(role.desc);
  const [perms, setPerms] = React.useState(new Set(role.perms));

  function toggle(p) {
    setPerms(prev => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  }

  return (
    <Modal open onClose={onClose} icon="shield" size="md"
      title={role._new ? "Add role" : `Edit ${role.name}`}
      subtitle="Roles define what each team member can read, write, or approve."
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!name.trim()}
          onClick={() => onSave({ name: name.trim(), desc: desc.trim(), perms: [...perms] })}>
          <Icon name="check" size={13}/> {role._new ? "Create role" : "Save changes"}
        </button>
      </>}>
      <div className="field" style={{ marginBottom: 12 }}>
        <label className="field-label">Role name</label>
        <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Operations"/>
      </div>
      <div className="field" style={{ marginBottom: 14 }}>
        <label className="field-label">Description</label>
        <input className="input" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Short summary shown to admins"/>
      </div>
      <label className="field-label" style={{ display: "block", marginBottom: 8 }}>Permissions ({perms.size})</label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, maxHeight: 280, overflowY: "auto", paddingRight: 4 }}>
        {allPerms.map(p => {
          const on = perms.has(p.v);
          return (
            <label key={p.v} style={{ display: "flex", gap: 8, alignItems: "center", padding: "7px 10px", border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`, background: on ? "var(--accent-soft)" : "var(--surface)", borderRadius: 6, cursor: "pointer", fontSize: 12.5 }}>
              <input type="checkbox" checked={on} onChange={() => toggle(p.v)} style={{ accentColor: "var(--accent)" }}/>
              <span style={{ flex: 1 }}>{p.l}</span>
              <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>{p.v}</span>
            </label>
          );
        })}
      </div>
    </Modal>
  );
}

function NotificationsView() {
  const toast = useToast();
  const [rules, setRules] = React.useState([
    { id: 1, e: "Flight scheduled", aud: "Director, Safety, Command", ch: ["email", "slack"], w: "T-15min" },
    { id: 2, e: "Flight in air", aud: "Field, Command", ch: ["app push"], w: "Immediate" },
    { id: 3, e: "Incident · Critical", aud: "Director, Safety, External", ch: ["sms", "email", "slack"], w: "Immediate" },
    { id: 4, e: "Incident · High", aud: "Director, Safety", ch: ["email", "slack"], w: "Immediate" },
    { id: 5, e: "Incident · Medium", aud: "Safety", ch: ["email"], w: "Hourly digest" },
    { id: 6, e: "Post-flight summary", aud: "Director, Command, Legal", ch: ["email"], w: "On landing" },
    { id: 7, e: "Weekly rollup", aud: "All stakeholders", ch: ["email"], w: "Mondays 09:00" },
  ]);
  const [editing, setEditing] = React.useState(null);
  const [menuFor, setMenuFor] = React.useState(null);

  function save(patch) {
    if (editing._new) {
      setRules(prev => [...prev, { ...patch, id: Date.now() }]);
      toast({ kind: "success", title: "Rule created", msg: patch.e });
    } else {
      setRules(prev => prev.map(r => r.id === editing.id ? { ...r, ...patch } : r));
      toast({ kind: "success", title: "Rule updated", msg: patch.e });
    }
    setEditing(null);
  }
  function remove(r) {
    if (!confirm(`Delete rule "${r.e}"?`)) return;
    setRules(prev => prev.filter(x => x.id !== r.id));
    toast({ kind: "info", title: "Rule deleted", msg: r.e });
    setMenuFor(null);
  }
  function duplicate(r) {
    setRules(prev => [...prev, { ...r, id: Date.now(), e: r.e + " (copy)" }]);
    toast({ kind: "success", title: "Rule duplicated", msg: r.e });
    setMenuFor(null);
  }

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">Notification routing</div>
        <button className="btn btn-sm btn-primary" style={{ marginLeft: "auto" }}
          onClick={() => setEditing({ _new: true, e: "", aud: "", ch: ["email"], w: "Immediate" })}>
          <Icon name="plus" size={12}/> Add rule
        </button>
      </div>
      <table className="tbl">
        <thead><tr><th>Event</th><th>Audience</th><th>Channels</th><th>Window</th><th></th></tr></thead>
        <tbody>
          {rules.map(r => (
            <tr key={r.id} className="clickable" onClick={() => setEditing(r)}>
              <td><div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Icon name={r.e.includes("Critical") ? "warn" : r.e.includes("Incident") ? "pin" : r.e.toLowerCase().includes("flight") ? "drone" : "mail"} size={14} stroke={r.e.includes("Critical") ? "var(--danger)" : "var(--text-2)"}/>
                <strong style={{ fontSize: 13 }}>{r.e}</strong>
              </div></td>
              <td>{r.aud}</td>
              <td><div className="row" style={{ gap: 4 }}>{r.ch.map(c => <span key={c} className="pill">{c}</span>)}</div></td>
              <td className="mono" style={{ fontSize: 12 }}>{r.w}</td>
              <td style={{ position: "relative" }} onClick={e => e.stopPropagation()}>
                <button className="btn btn-sm btn-ghost" onClick={() => setMenuFor(menuFor === r.id ? null : r.id)}><Icon name="more" size={14}/></button>
                {menuFor === r.id && (
                  <div style={{ position: "absolute", right: 8, top: "100%", zIndex: 30, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "var(--shadow-md)", padding: 4, minWidth: 150 }}>
                    <button className="btn btn-sm btn-ghost" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => { setEditing(r); setMenuFor(null); }}><Icon name="edit" size={12}/> Edit</button>
                    <button className="btn btn-sm btn-ghost" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => duplicate(r)}><Icon name="plus" size={12}/> Duplicate</button>
                    <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }}/>
                    <button className="btn btn-sm btn-ghost" style={{ width: "100%", justifyContent: "flex-start", color: "var(--danger)" }} onClick={() => remove(r)}><Icon name="trash" size={12}/> Delete</button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && <RuleEditModal rule={editing} onClose={() => setEditing(null)} onSave={save}/>}
    </div>
  );
}

function RuleEditModal({ rule, onClose, onSave }) {
  const [e, setE] = React.useState(rule.e);
  const [aud, setAud] = React.useState(rule.aud);
  const [ch, setCh] = React.useState(new Set(rule.ch));
  const [w, setW] = React.useState(rule.w);
  const channels = ["email", "sms", "slack", "teams", "app push", "webhook"];
  function toggle(c) { setCh(prev => { const n = new Set(prev); n.has(c) ? n.delete(c) : n.add(c); return n; }); }
  return (
    <Modal open onClose={onClose} icon="bell" size="md"
      title={rule._new ? "Add notification rule" : `Edit "${rule.e}"`}
      subtitle="Configure who gets notified, when, and how."
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!e.trim() || !aud.trim()}
          onClick={() => onSave({ e: e.trim(), aud: aud.trim(), ch: [...ch], w })}>
          <Icon name="check" size={13}/> {rule._new ? "Create rule" : "Save"}
        </button>
      </>}>
      <div className="field" style={{ marginBottom: 12 }}>
        <label className="field-label">Trigger event</label>
        <input className="input" value={e} onChange={ev => setE(ev.target.value)} placeholder="e.g. Incident · Critical"/>
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <label className="field-label">Audience</label>
        <input className="input" value={aud} onChange={ev => setAud(ev.target.value)} placeholder="Director, Safety, etc."/>
      </div>
      <div className="field" style={{ marginBottom: 14 }}>
        <label className="field-label">Delivery window</label>
        <select className="select" value={w} onChange={ev => setW(ev.target.value)}>
          <option>Immediate</option><option>T-15min</option><option>T-1h</option><option>On landing</option><option>Hourly digest</option><option>Daily digest</option><option>Mondays 09:00</option>
        </select>
      </div>
      <label className="field-label" style={{ display: "block", marginBottom: 8 }}>Channels ({ch.size})</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {channels.map(c => {
          const on = ch.has(c);
          return <button key={c} type="button" onClick={() => toggle(c)} className="pill"
            style={{ cursor: "pointer", background: on ? "var(--accent-soft)" : "var(--surface)", color: on ? "var(--accent)" : "var(--text-2)", borderColor: on ? "var(--accent)" : "var(--border)" }}>
            {on && <Icon name="check" size={10}/>} {c}
          </button>;
        })}
      </div>
    </Modal>
  );
}

function SectorsView() {
  const toast = useToast();
  const [activeKey, setActiveKey] = React.useState("generic");
  const [editing, setEditing] = React.useState(null);

  return (
    <>
      <div className="grid-2">
        {Object.entries(SECTORS).map(([key, s]) => (
          <div key={key} className="card">
            <div className="card-head">
              <div>
                <div className="card-title">{s.label}</div>
                <div className="mono muted" style={{ fontSize: 11 }}>{key}</div>
              </div>
              {activeKey === key && <span className="badge badge-accent" style={{ marginLeft: "auto" }}>Active preset</span>}
            </div>
            <div className="card-body">
              <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>Incident types ({s.incidentTypes.length})</div>
              <div className="row" style={{ flexWrap: "wrap", gap: 4, marginBottom: 14 }}>
                {s.incidentTypes.map(t => <span key={t} className="pill">{t}</span>)}
              </div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>Sample places</div>
              <div className="row" style={{ flexWrap: "wrap", gap: 4, marginBottom: 14 }}>
                {s.samplePlaces.slice(0, 6).map(t => <span key={t} className="pill mono">{t}</span>)}
              </div>
              <div style={{ display: "flex", gap: 6, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                <button className="btn btn-sm" onClick={() => setEditing({ key, ...s })}><Icon name="edit" size={12}/> Edit preset</button>
                {activeKey !== key && (
                  <button className="btn btn-sm btn-primary" onClick={() => { setActiveKey(key); toast({ kind: "success", title: "Preset activated", msg: `${s.label} is now the default for new missions.` }); }}>
                    <Icon name="check" size={12}/> Set active
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {editing && <SectorEditModal preset={editing} onClose={() => setEditing(null)}
        onSave={() => { toast({ kind: "success", title: "Preset saved", msg: `${editing.label} updated.` }); setEditing(null); }}/>}
    </>
  );
}

function SectorEditModal({ preset, onClose, onSave }) {
  const [types, setTypes] = React.useState([...preset.incidentTypes]);
  const [places, setPlaces] = React.useState([...preset.samplePlaces]);
  const [newType, setNewType] = React.useState("");
  const [newPlace, setNewPlace] = React.useState("");

  return (
    <Modal open onClose={onClose} icon="layers" size="md"
      title={`Edit ${preset.label}`} subtitle="Customize incident types and sample places for this sector preset."
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={onSave}><Icon name="check" size={13}/> Save preset</button>
      </>}>
      <div style={{ marginBottom: 16 }}>
        <label className="field-label" style={{ display: "block", marginBottom: 8 }}>Incident types ({types.length})</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
          {types.map(t => (
            <span key={t} className="pill" style={{ paddingRight: 4 }}>
              {t}
              <button onClick={() => setTypes(p => p.filter(x => x !== t))} style={{ background: "none", border: "none", padding: "0 4px", color: "var(--text-3)", cursor: "pointer" }}><Icon name="close" size={10}/></button>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input className="input" value={newType} onChange={e => setNewType(e.target.value)} placeholder="Add incident type…" style={{ flex: 1 }} onKeyDown={e => { if (e.key === "Enter" && newType.trim()) { setTypes(p => [...p, newType.trim()]); setNewType(""); } }}/>
          <button className="btn btn-sm" onClick={() => { if (newType.trim()) { setTypes(p => [...p, newType.trim()]); setNewType(""); } }}>Add</button>
        </div>
      </div>
      <div>
        <label className="field-label" style={{ display: "block", marginBottom: 8 }}>Sample places ({places.length})</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
          {places.map(t => (
            <span key={t} className="pill mono" style={{ paddingRight: 4 }}>
              {t}
              <button onClick={() => setPlaces(p => p.filter(x => x !== t))} style={{ background: "none", border: "none", padding: "0 4px", color: "var(--text-3)", cursor: "pointer" }}><Icon name="close" size={10}/></button>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input className="input mono" value={newPlace} onChange={e => setNewPlace(e.target.value)} placeholder="Add sample place…" style={{ flex: 1 }} onKeyDown={e => { if (e.key === "Enter" && newPlace.trim()) { setPlaces(p => [...p, newPlace.trim()]); setNewPlace(""); } }}/>
          <button className="btn btn-sm" onClick={() => { if (newPlace.trim()) { setPlaces(p => [...p, newPlace.trim()]); setNewPlace(""); } }}>Add</button>
        </div>
      </div>
    </Modal>
  );
}

function IntegrationsView() {
  const toast = useToast();
  const streamHost = (() => { try { return new URL(import.meta.env.VITE_STREAM_URL || location.origin, location.origin).hostname; } catch { return "your-stream-host"; } })();
  const copy = (t) => { try { navigator.clipboard?.writeText(t); toast({ kind: "success", title: "Copied", msg: t }); } catch {} };
  const sb = window.__supabase;
  const KIND_LABEL = { slack: "Slack", teams: "Microsoft Teams", webhook: "Generic webhook" };
  const [hooks, setHooks] = React.useState([]);
  const [draft, setDraft] = React.useState({ kind: "slack", url: "", label: "" });
  const [busy, setBusy] = React.useState(false);

  async function loadHooks() {
    if (!sb) return;
    const { data } = await sb.from("integrations").select("*").order("created_at", { ascending: false });
    setHooks(data || []);
  }
  React.useEffect(() => { loadHooks(); }, []);

  async function addHook() {
    if (!/^https?:\/\/.+/i.test(draft.url.trim())) { toast({ kind: "warn", title: "Enter a valid URL", msg: "Paste the incoming-webhook URL." }); return; }
    setBusy(true);
    const { error } = await sb.from("integrations").insert({ kind: draft.kind, url: draft.url.trim(), label: draft.label.trim() || null, active: true });
    setBusy(false);
    if (error) { toast({ kind: "warn", title: "Couldn't add", msg: error.message }); return; }
    setDraft({ kind: "slack", url: "", label: "" }); loadHooks();
    toast({ kind: "success", title: "Webhook added", msg: "Pilot Ops will POST new incidents here." });
  }
  async function toggleHook(h) { await sb.from("integrations").update({ active: !h.active }).eq("id", h.id); loadHooks(); }
  async function removeHook(h) { if (!confirm("Remove this webhook?")) return; await sb.from("integrations").delete().eq("id", h.id); loadHooks(); }
  async function testHook(h) {
    const body = h.kind === "webhook"
      ? JSON.stringify({ event: "test", message: "Pilot Ops test event", at: new Date().toISOString() })
      : JSON.stringify({ text: "✅ Pilot Ops test — your incident webhook is working." });
    try { await fetch(h.url, { method: "POST", mode: "no-cors", headers: { "Content-Type": "application/json" }, body }); toast({ kind: "success", title: "Test sent", msg: "Check your channel / endpoint." }); }
    catch (e) { toast({ kind: "warn", title: "Test failed", msg: e.message }); }
  }

  return (
    <>
      {/* Real, first-party ingest API for any drone / encoder */}
      <div className="card" style={{ marginBottom: "var(--density-gap)", borderColor: "color-mix(in oklab, var(--accent) 30%, var(--border))" }}>
        <div className="card-head" style={{ gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "color-mix(in oklab, var(--accent) 12%, transparent)", color: "var(--accent)", display: "grid", placeItems: "center", flexShrink: 0 }}>
            <Icon name="drone" size={18}/>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="card-title">Direct drone ingest API</div>
            <div className="muted" style={{ fontSize: 12 }}>Stream any drone into Pilot Ops — DJI, Autel, custom ground stations or fixed-wing — without the Android companion app.</div>
          </div>
          <span className="badge badge-success" style={{ marginLeft: "auto", flexShrink: 0 }}><span className="dot"/> Live</span>
        </div>
        <div className="card-body" style={{ display: "grid", gap: 12 }}>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
            Any RTMP- or SRT-capable encoder (OBS, ffmpeg, a hardware encoder, or a drone ground station) can publish a live mission feed. Start a mission in Pilot Ops, open <b>Live stream → Direct ingest</b> to copy that mission's unique URL + key, then point your encoder at it. The feed appears in the livestream and on the public watch link — authenticated and recorded like an app cast.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
            {[
              ["RTMP ingest", `rtmp://${streamHost}:1935/<flightId>?key=<ingestKey>`],
              ["SRT ingest (lower latency)", `srt://${streamHost}:8890?streamid=publish:<flightId>?key=<ingestKey>`],
            ].map(([label, url]) => (
              <div key={label} className="field">
                <label className="field-label">{label}</label>
                <div className="row" style={{ gap: 6 }}>
                  <input className="input mono" readOnly value={url} onFocus={e => e.target.select()} style={{ flex: 1, fontSize: 11.5 }}/>
                  <button className="btn" onClick={() => copy(url)}><Icon name="paperclip" size={13}/></button>
                </div>
              </div>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 11.5 }}>Per-mission keys (no shared secret) — each flight has its own <span className="mono">ingestKey</span>, shown to its crew in the live view. Sub-second WebRTC/WHEP playback in the browser.</div>
        </div>
      </div>

      {/* Real outgoing webhooks (Slack / Teams / generic) */}
      <div className="card">
        <div className="card-head" style={{ gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "color-mix(in oklab, var(--accent) 12%, transparent)", color: "var(--accent)", display: "grid", placeItems: "center", flexShrink: 0 }}><Icon name="link" size={18}/></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="card-title">Outgoing webhooks</div>
            <div className="muted" style={{ fontSize: 12 }}>POST mission start/end and new incidents to Slack, Microsoft Teams, or any endpoint. Paste an incoming-webhook URL — no OAuth needed.</div>
          </div>
        </div>
        <div className="card-body" style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select className="select" value={draft.kind} onChange={e => setDraft(d => ({ ...d, kind: e.target.value }))} style={{ width: 160 }}>
              <option value="slack">Slack</option>
              <option value="teams">Microsoft Teams</option>
              <option value="webhook">Generic webhook</option>
            </select>
            <input className="input" placeholder="Label (optional)" value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} style={{ width: 160 }}/>
            <input className="input mono" placeholder="https://hooks.slack.com/services/…" value={draft.url} onChange={e => setDraft(d => ({ ...d, url: e.target.value }))} style={{ flex: 1, minWidth: 220, fontSize: 12 }}/>
            <button className="btn btn-primary" onClick={addHook} disabled={busy}><Icon name="plus" size={13}/> Add</button>
          </div>
          {hooks.length === 0
            ? <div className="muted" style={{ fontSize: 12.5, padding: "8px 2px" }}>No webhooks yet. Add a Slack or Teams incoming-webhook URL above to receive incident alerts.</div>
            : hooks.map(h => (
              <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface)" }}>
                <span className={"badge " + (h.active ? "badge-success" : "")} style={{ flexShrink: 0 }}>{KIND_LABEL[h.kind] || h.kind}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{h.label || KIND_LABEL[h.kind] || h.kind}</div>
                  <div className="mono muted" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.url}</div>
                </div>
                <button className="btn btn-sm" onClick={() => testHook(h)}><Icon name="send" size={12}/> Test</button>
                <button className="btn btn-sm" onClick={() => toggleHook(h)}>{h.active ? "Pause" : "Resume"}</button>
                <button className="btn btn-sm" style={{ color: "var(--danger)" }} onClick={() => removeHook(h)}><Icon name="x" size={12}/></button>
              </div>
            ))}
        </div>
      </div>

      {/* Honest note: deeper platform integrations need bespoke setup */}
      <div className="card" style={{ marginTop: "var(--density-gap)" }}>
        <div className="card-body" style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.55 }}>
          <Icon name="info" size={13} style={{ verticalAlign: "-2px" }}/> Deeper platform integrations (Salesforce, ArcGIS, Twilio SMS, PagerDuty, S3 archive) need bespoke credentials and backend wiring — they're intentionally not shown as "connected" until they actually are. Tell us which you need and we'll wire it.
        </div>
      </div>
    </>
  );
}

function AuditView() {
  // Real audit data from the DB: audit_log (mission/emergency actions) +
  // auth_attempts (pilot-code identity events, admin-readable).
  const [auditRows, setAuditRows] = React.useState([]);
  const [authEvents, setAuthEvents] = React.useState([]);
  React.useEffect(() => {
    const sb = window.__supabase;
    sb.from("audit_log").select("actor_name,kind,context,detail,ts").order("ts", { ascending: false }).limit(60).then(({ data }) => setAuditRows(data || []));
    sb.from("auth_attempts").select("ok,context,ts,profile_id").order("ts", { ascending: false }).limit(60).then(({ data }) => setAuthEvents(data || []));
  }, []);

  function rt(ts) {
    const d = Date.now() - ts;
    if (d < 60000) return "just now";
    if (d < 3600000) return Math.floor(d / 60000) + " min ago";
    if (d < 86400000) return Math.floor(d / 3600000) + " hr ago";
    return Math.floor(d / 86400000) + " days ago";
  }
  const KIND_LABEL = { mission_start: "Started a mission", emergency_launch: "Emergency launch", invite: "Sent an invite" };

  const events = [];
  auditRows.forEach(r => events.push({
    ts: new Date(r.ts).getTime(), a: r.actor_name || "—",
    e: (KIND_LABEL[r.kind] || r.kind) + (r.context ? " · " + r.context : ""),
    k: r.kind === "emergency_launch" ? "warn" : r.kind === "mission_start" ? "drone" : "settings",
    kind: r.kind === "emergency_launch" ? "emergency" : "",
  }));
  authEvents.forEach(ev => {
    const pilot = PILOTS.find(p => p.id === ev.profile_id);
    events.push({
      ts: new Date(ev.ts).getTime(), a: pilot?.name || "Pilot",
      e: ev.ok ? `Identity confirmed · ${ev.context || ""}` : `Failed pilot-code entry · ${ev.context || ""}`,
      k: ev.ok ? "shield" : "warn", kind: "auth",
    });
  });

  const log = events.sort((a, b) => b.ts - a.ts).slice(0, 30);
  const failedAuth = authEvents.filter(e => !e.ok).length;
  const emergencyCount = auditRows.filter(r => r.kind === "emergency_launch").length;

  return (
    <>
      <div className="grid-2" style={{ marginBottom: "var(--density-gap)" }}>
        <div className="card">
          <div className="card-body" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: failedAuth > 0 ? "color-mix(in oklab, var(--warning) 12%, transparent)" : "color-mix(in oklab, var(--success) 12%, transparent)", color: failedAuth > 0 ? "var(--warning)" : "var(--success)", display: "grid", placeItems: "center" }}>
              <Icon name="shield" size={16}/>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Pilot identity</div>
              <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{authEvents.length} attempts · {failedAuth} failed</div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-body" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: "color-mix(in oklab, var(--danger) 12%, transparent)", color: "var(--danger)", display: "grid", placeItems: "center" }}>
              <Icon name="warn" size={16}/>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Emergency launches</div>
              <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{emergencyCount} total · <a href="#emergency-reviews" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 500, fontSize: 13 }}>open queue →</a></div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Recent activity</div></div>
        <div style={{ padding: 8 }}>
          {log.map((l, i) => (
            <div key={i} style={{ display: "flex", gap: 12, padding: "10px 12px", borderBottom: i < log.length - 1 ? "1px solid var(--border)" : "none", alignItems: "flex-start" }}>
              <div style={{ width: 28, height: 28, borderRadius: 7, background: l.kind === "emergency" ? "color-mix(in oklab, var(--danger) 10%, transparent)" : l.kind === "auth" ? (l.k === "warn" ? "color-mix(in oklab, var(--warning) 12%, transparent)" : "color-mix(in oklab, var(--success) 12%, transparent)") : "var(--bg-muted)", display: "grid", placeItems: "center", color: l.kind === "emergency" ? "var(--danger)" : l.kind === "auth" ? (l.k === "warn" ? "var(--warning)" : "var(--success)") : "var(--text-2)" }}>
                <Icon name={l.k} size={14}/>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13 }}><strong>{l.a}</strong> <span className="muted">·</span> {l.e}</div>
                <div className="muted mono" style={{ fontSize: 11, marginTop: 2 }}>{rt(l.ts)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ---------- Stakeholders (external email recipients) ---------- */
const NOTIFY_KINDS = [
  { v: "pre-flight", l: "Pre-flight notices" },
  { v: "incidents",  l: "Incident reports" },
  { v: "summary",    l: "Post-flight summaries" },
];

function StakeholdersView() {
  const toast = useToast();
  const [list, setList] = React.useState(() => (window.STAKEHOLDERS || []));
  const [editing, setEditing] = React.useState(null);

  async function save(s) {
    const sb = window.__supabase;
    const row = { name: s.name, email: s.email, role: s.role || "External", notify: s.notify || [] };
    if (s.id) {
      const { error } = await sb.from("stakeholders").update(row).eq("id", s.id);
      if (error) { toast({ kind: "warn", title: "Save failed", msg: error.message }); return; }
      setList(prev => prev.map(x => x.id === s.id ? { ...x, ...row } : x));
    } else {
      const { data, error } = await sb.from("stakeholders").insert(row).select().single();
      if (error) { toast({ kind: "warn", title: "Add failed", msg: error.message }); return; }
      setList(prev => [...prev, { ...data, notify: data.notify || [], avatar: data.avatar || "#64748b" }]);
    }
    try { await refresh(); } catch {}
    setEditing(null);
    toast({ kind: "success", title: "Stakeholder saved", msg: s.name });
  }
  async function remove(s) {
    if (!confirm(`Remove ${s.name} from notification recipients?`)) return;
    await window.__supabase.from("stakeholders").delete().eq("id", s.id);
    setList(prev => prev.filter(x => x.id !== s.id));
    try { await refresh(); } catch {}
    toast({ kind: "info", title: "Removed", msg: s.name });
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={() => setEditing({ _new: true, name: "", email: "", role: "External", notify: ["summary"] })}>
          <Icon name="plus" size={13}/> Add stakeholder
        </button>
      </div>
      <div className="card">
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Receives</th><th></th></tr></thead>
            <tbody>
              {list.map(s => (
                <tr key={s.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div className="user-avatar" style={{ width: 28, height: 28, fontSize: 11, background: `linear-gradient(135deg, ${s.avatar || "#64748b"}, color-mix(in oklab, ${s.avatar || "#64748b"} 70%, #000))` }}>{(s.name || s.email).split(/[\s@]/).map(w => w[0]).slice(0, 2).join("").toUpperCase()}</div>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{s.name}</span>
                    </div>
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>{s.email}</td>
                  <td><span className="pill">{s.role}</span></td>
                  <td>
                    <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                      {(s.notify || []).length === 0 ? <span className="muted" style={{ fontSize: 11 }}>—</span>
                        : (s.notify || []).map(n => <span key={n} className="badge mono" style={{ fontSize: 10 }}>{n}</span>)}
                    </div>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => setEditing(s)} title="Edit"><Icon name="edit" size={13}/></button>
                      <button className="btn btn-sm btn-ghost" onClick={() => remove(s)} title="Remove"><Icon name="trash" size={13}/></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length === 0 && <div className="muted" style={{ padding: 40, textAlign: "center" }}>No stakeholders yet. Add the people who should receive notices and summaries by email.</div>}
        </div>
      </div>
      {editing && <StakeholderModal stakeholder={editing} onClose={() => setEditing(null)} onSave={save}/>}
    </>
  );
}

function StakeholderModal({ stakeholder, onClose, onSave }) {
  const [name, setName] = React.useState(stakeholder.name || "");
  const [email, setEmail] = React.useState(stakeholder.email || "");
  const [role, setRole] = React.useState(stakeholder.role || "External");
  const [notify, setNotify] = React.useState(new Set(stakeholder.notify || []));
  const valid = name.trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  return (
    <Modal open onClose={onClose} icon="mail" size="md"
      title={stakeholder._new ? "Add stakeholder" : `Edit ${stakeholder.name}`}
      subtitle="External recipient — receives notifications/summaries by email; not an app login."
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!valid} onClick={() => onSave({ id: stakeholder.id, name: name.trim(), email: email.trim(), role, notify: [...notify] })}>
          <Icon name="check" size={13}/> Save
        </button>
      </>}>
      <div className="grid-2" style={{ gap: 12 }}>
        <div className="field"><label className="field-label">Name</label><input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus/></div>
        <div className="field"><label className="field-label">Role / org</label><input className="input" value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. Insurance, Regulator"/></div>
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label className="field-label">Email</label>
        <input className="input mono" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com"/>
      </div>
      <label className="field-label" style={{ display: "block", marginTop: 14, marginBottom: 8 }}>Receives</label>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {NOTIFY_KINDS.map(k => {
          const on = notify.has(k.v);
          return (
            <label key={k.v} style={{ display: "flex", gap: 9, alignItems: "center", padding: "8px 10px", border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`, background: on ? "var(--accent-soft)" : "var(--surface)", borderRadius: 6, cursor: "pointer", fontSize: 12.5 }}>
              <input type="checkbox" checked={on} onChange={() => setNotify(prev => { const n = new Set(prev); n.has(k.v) ? n.delete(k.v) : n.add(k.v); return n; })} style={{ accentColor: "var(--accent)" }}/>
              <span style={{ fontWeight: 600 }}>{k.l}</span>
            </label>
          );
        })}
      </div>
    </Modal>
  );
}

// Mounted by admin-main.jsx after all admin view modules have registered.
Object.assign(window, { AdminApp });
