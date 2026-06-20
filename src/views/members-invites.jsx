import React from "react";
import { refresh } from "../store.jsx";
// Members & Invites view — replaces standalone Stakeholders view.
// Two tabs:
//   • Active members — everyone who has accepted an invite (incl. seeded team)
//   • Pending invites — sent but not yet accepted, with copy-link / resend / revoke

const { useState: mvUseState, useEffect: mvUseEffect, useMemo: mvUseMemo } = React;

// Real roles from the DB (store global), mapped to this view's {key, desc} shape.
// Read at render so the latest roles (incl. Co-pilot, GIS Analyst, …) are offered.
const roleList = () => (window.ALL_ROLES || []).map(r => ({ key: r.name, desc: r.description || "" }));

function MembersInvitesView() {
  const toast = useToast();
  const [tab, setTab] = mvUseState("members");
  const [members, setMembers] = mvUseState(() => ivLoadMembers());
  const [invites, setInvites] = mvUseState(() => ivLoadInvites());
  const [query, setQuery] = mvUseState("");
  const [roleFilter, setRoleFilter] = mvUseState("all");
  const [showInvite, setShowInvite] = mvUseState(false);
  const [editingMember, setEditingMember] = mvUseState(null);
  const [viewingKyc, setViewingKyc] = mvUseState(null);
  const [editingInvite, setEditingInvite] = mvUseState(null);
  const [menuFor, setMenuFor] = mvUseState(null);

  // Live-tick the invite expiry display
  const [now, setNow] = mvUseState(Date.now());
  mvUseEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  // Recompute expired status when "now" crosses an expiry
  mvUseEffect(() => {
    let dirty = false;
    const next = invites.map(i => {
      if (i.status !== "accepted" && i.status !== "revoked" && Date.now() > i.expiresAt && i.status !== "expired") {
        dirty = true;
        return { ...i, status: "expired" };
      }
      return i;
    });
    if (dirty) { setInvites(next); ivSaveInvites(next); }
  }, [now]);

  const pending = mvUseMemo(() => invites.filter(i => i.status !== "accepted"), [invites]);
  const filteredMembers = mvUseMemo(() => {
    const q = query.trim().toLowerCase();
    return members.filter(m => {
      if (roleFilter !== "all" && !m.roles.includes(roleFilter)) return false;
      if (!q) return true;
      return (m.name + " " + m.email + " " + (m.roles || []).join(" ")).toLowerCase().includes(q);
    });
  }, [members, query, roleFilter]);
  const filteredInvites = mvUseMemo(() => {
    const q = query.trim().toLowerCase();
    return pending.filter(i => {
      if (roleFilter !== "all" && !i.roles.includes(roleFilter)) return false;
      if (!q) return true;
      return (i.email + " " + (i.roles || []).join(" ")).toLowerCase().includes(q);
    });
  }, [pending, query, roleFilter]);

  function sendInvites({ emails, roles, message, expiryDays }) {
    const ms = expiryDays * 86400000;
    const newOnes = emails.map(email => ({
      token: ivGenToken(),
      email,
      roles,
      invitedBy: window.__poAdminUser?.email || null,
      invitedByName: window.__poAdminUser?.name || "Admin",
      message,
      sentAt: Date.now(),
      expiresAt: Date.now() + ms,
      openedAt: null,
      status: "pending",
    }));
    const next = [...newOnes, ...invites];
    setInvites(next);
    ivSaveInvites(next);
    toast({
      kind: "success",
      title: emails.length === 1 ? "Invitation sent" : `${emails.length} invitations sent`,
      msg: emails.length === 1 ? emails[0] + " will receive a registration link." : "Recipients will receive a registration link via email.",
    });
    setShowInvite(false);
  }
  function revokeInvite(inv) {
    if (!confirm(`Revoke invite for ${inv.email}? The link will stop working immediately.`)) return;
    const next = invites.map(i => i.token === inv.token ? { ...i, status: "revoked" } : i);
    setInvites(next); ivSaveInvites(next);
    toast({ kind: "info", title: "Invite revoked", msg: inv.email });
    setMenuFor(null);
  }
  function resendInvite(inv) {
    // Replaces the token (old link won't work) and resets expiry
    const next = invites.map(i => i.token === inv.token
      ? { ...i, token: ivGenToken(), sentAt: Date.now(), expiresAt: Date.now() + 7 * 86400000, openedAt: null, status: "pending" }
      : i);
    setInvites(next); ivSaveInvites(next);
    toast({ kind: "success", title: "Invite resent", msg: `New link generated for ${inv.email}. Old link revoked.` });
    setMenuFor(null);
  }
  function copyLink(inv) {
    const link = ivLinkFor(inv.token);
    if (navigator.clipboard) navigator.clipboard.writeText(link);
    toast({ kind: "success", title: "Link copied", msg: link, ms: 4500 });
    setMenuFor(null);
  }
  async function saveMember(patch) {
    const id = editingMember.id;
    const next = members.map(m => m.id === id ? { ...m, ...patch, primaryRole: patch.roles?.[0] || m.primaryRole } : m);
    setMembers(next); ivSaveMembers(next);
    setEditingMember(null);
    const sb = window.__supabase;
    const errs = [];
    if (patch.roles) { const { error } = await sb.rpc("set_member_roles", { p_profile: id, p_roles: patch.roles }); if (error) errs.push(error.message); }
    if (patch.name)  { const { error } = await sb.from("profiles").update({ full_name: patch.name }).eq("id", id); if (error) errs.push(error.message); }
    if (errs.length) { toast({ kind: "warn", title: "Save failed", msg: errs[0] }); return; }
    try { await refresh(); } catch {}
    toast({ kind: "success", title: "Member updated", msg: patch.name });
  }
  function removeMember(m) {
    if (!confirm(`Remove ${m.name} from the team? They will lose access immediately.`)) return;
    const next = members.filter(x => x.id !== m.id);
    setMembers(next); ivSaveMembers(next);
    toast({ kind: "info", title: "Member removed", msg: m.name });
    setMenuFor(null);
  }
  function changeStatus(m, newStatus) {
    const next = members.map(x => x.id === m.id ? { ...x, status: newStatus } : x);
    setMembers(next); ivSaveMembers(next);
    toast({ kind: "info", title: `Member ${newStatus}`, msg: m.name });
    setMenuFor(null);
  }
  async function setKyc(m, status) {
    const next = members.map(x => x.id === m.id ? { ...x, kycStatus: status } : x);
    setMembers(next); ivSaveMembers(next);
    setMenuFor(null);
    const { error } = await window.__supabase.rpc("set_kyc_status", { p_profile: m.id, p_status: status });
    if (error) { toast({ kind: "warn", title: "Update failed", msg: error.message }); return; }
    try { await refresh(); } catch {}
    toast({ kind: status === "verified" ? "success" : "info", title: status === "verified" ? "KYC verified" : `KYC ${status}`, msg: m.name });
  }

  const pendingCount = pending.filter(i => i.status === "pending" || i.status === "opened").length;
  const expiredCount = pending.filter(i => i.status === "expired").length;

  return (
    <>
      {/* KPI strip */}
      <div className="row" style={{ gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <MetricTile label="Active members" value={members.filter(m => m.status === "active").length} icon="users" tone="accent"/>
        <MetricTile label="Pending invites" value={pendingCount} icon="mail" tone="warning"/>
        <MetricTile label="Expired" value={expiredCount} icon="warn" tone="danger"/>
        <MetricTile label="Roles in use" value={new Set(members.flatMap(m => m.roles)).size} icon="shield" tone="default"/>
      </div>

      {/* Tabs + controls */}
      <div className="card" style={{ overflow: "visible" }}>
        <div className="card-head" style={{ flexWrap: "wrap", gap: 12 }}>
          <div className="tab-bar" style={{ display: "flex", gap: 4, padding: 3, background: "var(--bg-muted)", borderRadius: 8 }}>
            <button className={"btn btn-sm " + (tab === "members" ? "btn-primary" : "btn-ghost")} onClick={() => setTab("members")}>
              <Icon name="users" size={12}/> Active members <span className="pill" style={{ background: tab === "members" ? "rgba(255,255,255,0.18)" : "var(--bg-muted)", color: tab === "members" ? "white" : "var(--text-2)", borderColor: "transparent", marginLeft: 4 }}>{filteredMembers.length}</span>
            </button>
            <button className={"btn btn-sm " + (tab === "invites" ? "btn-primary" : "btn-ghost")} onClick={() => setTab("invites")}>
              <Icon name="mail" size={12}/> Pending invites <span className="pill" style={{ background: tab === "invites" ? "rgba(255,255,255,0.18)" : "var(--bg-muted)", color: tab === "invites" ? "white" : "var(--text-2)", borderColor: "transparent", marginLeft: 4 }}>{filteredInvites.length}</span>
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto", flexWrap: "wrap" }}>
            <div style={{ position: "relative" }}>
              <Icon name="search" size={13} stroke="var(--text-3)" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }}/>
              <input className="input" placeholder="Search by name, email, role…" value={query} onChange={e => setQuery(e.target.value)} style={{ paddingLeft: 32, width: 260, height: 34 }}/>
            </div>
            <select className="select" value={roleFilter} onChange={e => setRoleFilter(e.target.value)} style={{ height: 34 }}>
              <option value="all">All roles</option>
              {roleList().map(r => <option key={r.key} value={r.key}>{r.key}</option>)}
            </select>
            <button className="btn btn-primary" onClick={() => setShowInvite(true)}>
              <Icon name="plus" size={13}/> Invite member
            </button>
          </div>
        </div>

        {/* Active members table */}
        {tab === "members" && (
          filteredMembers.length === 0 ? (
            <EmptyState icon="users" title="No members match these filters" msg="Try clearing the search or role filter."/>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="tbl">
                <thead><tr><th>Member</th><th>Email</th><th>Roles</th><th>Status</th><th>Last active</th><th></th></tr></thead>
                <tbody>
                  {filteredMembers.map(m => (
                    <tr key={m.id} className="clickable" onClick={() => setEditingMember(m)}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div className="user-avatar" style={{ width: 32, height: 32, fontSize: 11, background: `linear-gradient(135deg, ${m.color}, color-mix(in oklab, ${m.color} 70%, #000))` }}>{m.initials}</div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{m.name}</div>
                            <div className="mono muted" style={{ fontSize: 10.5, marginTop: 1 }}>{m.shortId || m.id}{m.license ? " · " + m.license : ""}</div>
                          </div>
                        </div>
                      </td>
                      <td className="mono" style={{ fontSize: 12 }}>{m.email}</td>
                      <td>
                        <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                          {(m.roles || []).map(r => <span key={r} className="pill">{r}</span>)}
                        </div>
                      </td>
                      <td>
                        <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                          {m.status === "active" && <span className="badge badge-success"><span className="dot"/>Active</span>}
                          {m.status === "suspended" && <span className="badge badge-warning"><span className="dot"/>Suspended</span>}
                          {m.status === "off-boarded" && <span className="badge"><span className="dot"/>Off-boarded</span>}
                          {m.kycStatus === "pending" && <span className="badge badge-warning" title="KYC awaiting verification"><span className="dot"/>KYC pending</span>}
                          {m.kycStatus === "rejected" && <span className="badge badge-danger" title="KYC rejected"><span className="dot"/>KYC rejected</span>}
                        </div>
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>{relativeTime(m.lastActive)}</td>
                      <td style={{ position: "relative" }} onClick={e => e.stopPropagation()}>
                        <button className="btn btn-sm btn-ghost" onClick={() => setMenuFor(menuFor === m.id ? null : m.id)}><Icon name="more" size={14}/></button>
                        {menuFor === m.id && (
                          <div className="menu-pop">
                            <button onClick={() => { setViewingKyc(m); setMenuFor(null); }}><Icon name="shield" size={12}/> Review KYC</button>
                            {m.kycStatus !== "verified" && <button onClick={() => setKyc(m, "verified")}><Icon name="check" size={12}/> Verify KYC</button>}
                            {m.kycStatus !== "rejected" && <button onClick={() => setKyc(m, "rejected")}><Icon name="x" size={12}/> Reject KYC</button>}
                            <div className="divider"/>
                            <button onClick={() => { setEditingMember(m); setMenuFor(null); }}><Icon name="edit" size={12}/> Edit roles</button>
                            <button onClick={() => copyLink({ token: "demo", email: m.email })}><Icon name="link" size={12}/> Copy profile link</button>
                            {m.status === "active"
                              ? <button onClick={() => changeStatus(m, "suspended")}><Icon name="pause" size={12}/> Suspend</button>
                              : <button onClick={() => changeStatus(m, "active")}><Icon name="play" size={12}/> Reactivate</button>}
                            <div className="divider"/>
                            <button className="danger" onClick={() => removeMember(m)}><Icon name="trash" size={12}/> Remove</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* Pending invites table */}
        {tab === "invites" && (
          filteredInvites.length === 0 ? (
            <EmptyState icon="mail" title="No pending invites" msg={<>All caught up. <button className="link-btn" onClick={() => setShowInvite(true)}>Invite a new member</button> to add to the team.</>}/>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="tbl">
                <thead><tr><th>Recipient</th><th>Roles</th><th>Status</th><th>Invited by</th><th>Sent</th><th>Expires</th><th></th></tr></thead>
                <tbody>
                  {filteredInvites.map(inv => {
                    const expSoon = inv.status === "pending" && inv.expiresAt - now < 86400000;
                    const stale = inv.status === "pending" && now - inv.sentAt > 48 * 3600000;
                    return (
                      <tr key={inv.token} className="clickable" onClick={() => setEditingInvite(inv)}>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div className="user-avatar" style={{ width: 32, height: 32, fontSize: 11, background: "var(--bg-muted)", color: "var(--text-3)", border: "1px dashed var(--border-strong)" }}>
                              <Icon name="mail" size={13}/>
                            </div>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600 }}>{inv.email}</div>
                              {stale && <div className="mono" style={{ fontSize: 10.5, marginTop: 1, color: "var(--warning)" }}>Not opened yet</div>}
                            </div>
                          </div>
                        </td>
                        <td><div className="row" style={{ gap: 4, flexWrap: "wrap" }}>{inv.roles.map(r => <span key={r} className="pill">{r}</span>)}</div></td>
                        <td>
                          {inv.status === "pending" && <span className="badge badge-warning"><span className="dot"/>Pending</span>}
                          {inv.status === "opened" && <span className="badge badge-accent"><span className="dot"/>Opened</span>}
                          {inv.status === "expired" && <span className="badge"><span className="dot"/>Expired</span>}
                          {inv.status === "revoked" && <span className="badge"><span className="dot"/>Revoked</span>}
                        </td>
                        <td className="muted" style={{ fontSize: 12 }}>{inv.invitedByName}</td>
                        <td className="muted" style={{ fontSize: 12 }}>{relativeTime(inv.sentAt)}</td>
                        <td>
                          {inv.status === "expired" ? <span className="muted" style={{ fontSize: 12 }}>{relativeTime(inv.expiresAt)}</span>
                            : inv.status === "revoked" ? <span className="muted" style={{ fontSize: 12 }}>—</span>
                            : <span style={{ fontSize: 12, color: expSoon ? "var(--danger)" : "var(--text-2)" }}>in {fmtRemaining(inv.expiresAt - now)}</span>}
                        </td>
                        <td style={{ position: "relative" }} onClick={e => e.stopPropagation()}>
                          <button className="btn btn-sm btn-ghost" onClick={() => setMenuFor(menuFor === inv.token ? null : inv.token)}><Icon name="more" size={14}/></button>
                          {menuFor === inv.token && (
                            <div className="menu-pop">
                              <button onClick={() => copyLink(inv)} disabled={inv.status === "revoked" || inv.status === "expired"}><Icon name="link" size={12}/> Copy link</button>
                              <button onClick={() => resendInvite(inv)}><Icon name="send" size={12}/> Resend</button>
                              <div className="divider"/>
                              <button className="danger" onClick={() => revokeInvite(inv)} disabled={inv.status === "revoked"}><Icon name="close" size={12}/> Revoke</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {showInvite && <InviteModal onClose={() => setShowInvite(false)} onSend={sendInvites} existingEmails={[...members.map(m => m.email), ...pending.filter(i => i.status === "pending" || i.status === "opened").map(i => i.email)]}/>}
      {editingMember && <MemberEditModal member={editingMember} onClose={() => setEditingMember(null)} onSave={saveMember}/>}
      {viewingKyc && <KycReviewModal member={viewingKyc} onClose={() => setViewingKyc(null)} onVerify={() => { setKyc(viewingKyc, "verified"); setViewingKyc(null); }} onReject={() => { setKyc(viewingKyc, "rejected"); setViewingKyc(null); }}/>}
      {editingInvite && <InviteDetailModal invite={editingInvite} onClose={() => setEditingInvite(null)} onCopy={copyLink} onResend={resendInvite} onRevoke={revokeInvite}/>}

      <style>{`
        .menu-pop {
          position: absolute; right: 8px; top: 100%;
          z-index: 30; background: var(--surface);
          border: 1px solid var(--border); border-radius: 8px;
          box-shadow: var(--shadow-md); padding: 4px; min-width: 180px;
          display: flex; flex-direction: column;
        }
        .menu-pop button {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 7px 10px; border-radius: 5px;
          background: transparent; border: none; color: var(--text);
          font-size: 12.5px; font-family: inherit; cursor: pointer;
          width: 100%; justify-content: flex-start;
        }
        .menu-pop button:hover:not(:disabled) { background: var(--bg-subtle); }
        .menu-pop button:disabled { opacity: 0.4; cursor: not-allowed; }
        .menu-pop button.danger { color: var(--danger); }
        .menu-pop button.danger:hover:not(:disabled) { background: color-mix(in oklab, var(--danger) 8%, transparent); }
        .menu-pop .divider { height: 1px; background: var(--border); margin: 4px 0; }
        .link-btn { background: none; border: none; color: var(--accent); cursor: pointer; font-size: inherit; padding: 0; text-decoration: underline; }
      `}</style>
    </>
  );
}

function MetricTile({ label, value, icon, tone }) {
  const tones = {
    accent:  { bg: "var(--accent-soft)",  fg: "var(--accent)"  },
    warning: { bg: "var(--warning-soft)", fg: "var(--warning)" },
    danger:  { bg: "var(--danger-soft)",  fg: "var(--danger)"  },
    default: { bg: "var(--bg-muted)",     fg: "var(--text-2)"  },
  };
  const t = tones[tone] || tones.default;
  return (
    <div className="card kpi" style={{ flex: "1 1 200px", minWidth: 200, padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div className="kpi-label">{label}</div>
          <div className="kpi-value" style={{ color: t.fg }}>{value}</div>
        </div>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: t.bg, color: t.fg, display: "grid", placeItems: "center", flexShrink: 0 }}>
          <Icon name={icon} size={18}/>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ icon, title, msg }) {
  return (
    <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--text-2)" }}>
      <div style={{ width: 48, height: 48, margin: "0 auto 14px", borderRadius: 12, background: "var(--bg-muted)", color: "var(--text-3)", display: "grid", placeItems: "center" }}>
        <Icon name={icon} size={20}/>
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{title}</div>
      <div style={{ fontSize: 12.5, marginTop: 6 }}>{msg}</div>
    </div>
  );
}

function relativeTime(ts) {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
  if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
  if (diff < 86400000 * 30) return Math.floor(diff / 86400000) + "d ago";
  return new Date(ts).toLocaleDateString();
}
function fmtRemaining(ms) {
  if (ms <= 0) return "now";
  if (ms < 3600000) return Math.floor(ms / 60000) + "m";
  if (ms < 86400000) return Math.floor(ms / 3600000) + "h";
  return Math.floor(ms / 86400000) + "d";
}

/* ---------- Invite modal ---------- */
function InviteModal({ onClose, onSend, existingEmails }) {
  const [emailsRaw, setEmailsRaw] = mvUseState("");
  const [roles, setRoles] = mvUseState(new Set());
  const [message, setMessage] = mvUseState("");
  const [expiry, setExpiry] = mvUseState(7);
  const [touched, setTouched] = mvUseState(false);

  const parsed = emailsRaw
    .split(/[\s,;]+/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  const valid = parsed.filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  const invalid = parsed.filter(e => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  const dupes = valid.filter(e => existingEmails.includes(e));
  const fresh = valid.filter(e => !existingEmails.includes(e));

  const canSend = fresh.length > 0 && roles.size > 0;

  function toggleRole(r) {
    setRoles(prev => { const n = new Set(prev); n.has(r) ? n.delete(r) : n.add(r); return n; });
  }

  return (
    <Modal open onClose={onClose} icon="mail" size="md"
      title="Invite members"
      subtitle="Each invite generates a single-use registration link sent to the recipient's email."
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!canSend}
          onClick={() => onSend({ emails: fresh, roles: [...roles], message: message.trim(), expiryDays: expiry })}>
          <Icon name="send" size={13}/> Send {fresh.length > 1 ? `${fresh.length} invitations` : "invitation"}
        </button>
      </>}>
      <div className="field" style={{ marginBottom: 12 }}>
        <label className="field-label">Email address(es)</label>
        <textarea className="input" rows={3} placeholder="name@pilotops.io&#10;Paste multiple — comma, space, or line-separated"
          value={emailsRaw} onChange={e => { setEmailsRaw(e.target.value); setTouched(true); }}
          style={{ resize: "vertical", fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.55 }}/>
        {touched && parsed.length > 0 && (
          <div style={{ marginTop: 6, display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11.5 }}>
            {fresh.length > 0 && <span style={{ color: "var(--success)" }}>✓ {fresh.length} new</span>}
            {dupes.length > 0 && <span style={{ color: "var(--warning)" }}>⚠ {dupes.length} already on team or invited</span>}
            {invalid.length > 0 && <span style={{ color: "var(--danger)" }}>✕ {invalid.length} invalid format</span>}
          </div>
        )}
      </div>

      <div className="field" style={{ marginBottom: 12 }}>
        <label className="field-label">Assign role(s) <span style={{ color: "var(--text-3)", fontWeight: 400 }}>· multiple allowed</span></label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {roleList().map(r => {
            const on = roles.has(r.key);
            return (
              <label key={r.key} style={{
                display: "flex", gap: 9, alignItems: "flex-start",
                padding: "8px 10px",
                border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
                background: on ? "var(--accent-soft)" : "var(--surface)",
                borderRadius: 6, cursor: "pointer", fontSize: 12.5,
              }}>
                <input type="checkbox" checked={on} onChange={() => toggleRole(r.key)} style={{ accentColor: "var(--accent)", marginTop: 2 }}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{r.key}</div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 1, lineHeight: 1.4 }}>{r.desc}</div>
                </div>
              </label>
            );
          })}
        </div>
        {roles.has("Pilot") && (
          <div style={{ marginTop: 10, padding: "8px 11px", borderRadius: 6, background: "color-mix(in oklab, var(--accent) 8%, transparent)", border: "1px solid color-mix(in oklab, var(--accent) 25%, transparent)", fontSize: 11.5, color: "var(--text-2)", display: "flex", gap: 8, alignItems: "center" }}>
            <Icon name="shield" size={13} stroke="var(--accent)"/> A unique 6-digit pilot code will be generated for each pilot on registration.
          </div>
        )}
      </div>

      <div className="field" style={{ marginBottom: 12 }}>
        <label className="field-label">Personal message <span style={{ color: "var(--text-3)", fontWeight: 400 }}>· optional</span></label>
        <textarea className="input" rows={2} placeholder="Welcome to the team!"
          value={message} onChange={e => setMessage(e.target.value)} style={{ resize: "vertical", fontSize: 12.5 }}/>
      </div>

      <div className="field">
        <label className="field-label">Link expires in</label>
        <div style={{ display: "flex", gap: 6 }}>
          {[1, 7, 14, 30].map(d => (
            <button key={d} type="button" className={"btn btn-sm " + (expiry === d ? "btn-primary" : "")} onClick={() => setExpiry(d)}>
              {d === 1 ? "24 hours" : d + " days"}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/* ---------- KYC review modal ---------- */
function KycReviewModal({ member, onClose, onVerify, onReject }) {
  const isCrew = (member.roles || []).some(r => /pilot/i.test(r));
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString() : "—";
  const expSoon = member.licenseExpiry && (new Date(member.licenseExpiry) - Date.now()) < 30 * 86400000;
  const rows = [
    ["Full name", member.name],
    ["Email", member.email],
    ["Phone", member.phone || "—"],
    ["Job title", member.jobTitle || "—"],
    ...(isCrew ? [
      ["Date of birth", fmtDate(member.dob)],
      ["Government ID", member.govId || "—"],
      ["License number", member.license || "—"],
      ["License class", member.licenseClass || "—"],
      ["License expiry", fmtDate(member.licenseExpiry) + (expSoon ? "  ⚠ expiring soon" : "")],
    ] : []),
  ];
  const statusBadge = member.kycStatus === "verified" ? "badge-success" : member.kycStatus === "rejected" ? "badge-danger" : "badge-warning";
  return (
    <Modal open onClose={onClose} icon="shield" size="md"
      title={`KYC — ${member.name}`}
      subtitle={isCrew ? "Operating crew · full verification" : "Member · identity check"}
      footer={<>
        <button className="btn" onClick={onClose}>Close</button>
        {member.kycStatus !== "rejected" && <button className="btn" onClick={onReject}><Icon name="x" size={13}/> Reject</button>}
        {member.kycStatus !== "verified" && <button className="btn btn-primary" onClick={onVerify}><Icon name="check" size={13}/> Verify</button>}
      </>}>
      <div style={{ marginBottom: 14 }}>
        <span className={"badge " + statusBadge}><span className="dot"/>KYC {member.kycStatus || "verified"}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", rowGap: 10, columnGap: 12, fontSize: 13 }}>
        {rows.map(([k, v]) => <React.Fragment key={k}>
          <div className="muted" style={{ fontSize: 12 }}>{k}</div>
          <div style={{ fontWeight: 500, wordBreak: "break-word" }}>{v}</div>
        </React.Fragment>)}
      </div>
    </Modal>
  );
}

/* ---------- Member edit modal ---------- */
function MemberEditModal({ member, onClose, onSave }) {
  const [name, setName] = mvUseState(member.name);
  const [roles, setRoles] = mvUseState(new Set(member.roles || []));
  const [primaryRole, setPrimaryRole] = mvUseState(member.primaryRole || (member.roles || [])[0]);

  function toggleRole(r) {
    setRoles(prev => { const n = new Set(prev); n.has(r) ? n.delete(r) : n.add(r); return n; });
  }

  return (
    <Modal open onClose={onClose} icon="users" size="md"
      title={`Edit ${member.name}`}
      subtitle={member.email}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!name.trim() || roles.size === 0}
          onClick={() => onSave({ name: name.trim(), roles: [...roles], primaryRole })}>
          <Icon name="check" size={13}/> Save changes
        </button>
      </>}>
      <div className="field" style={{ marginBottom: 14 }}>
        <label className="field-label">Display name</label>
        <input className="input" value={name} onChange={e => setName(e.target.value)}/>
      </div>

      <label className="field-label" style={{ display: "block", marginBottom: 8 }}>Roles ({roles.size})</label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 14 }}>
        {roleList().map(r => {
          const on = roles.has(r.key);
          return (
            <label key={r.key} style={{
              display: "flex", gap: 9, alignItems: "center",
              padding: "8px 10px",
              border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
              background: on ? "var(--accent-soft)" : "var(--surface)",
              borderRadius: 6, cursor: "pointer", fontSize: 12.5,
            }}>
              <input type="checkbox" checked={on} onChange={() => toggleRole(r.key)} style={{ accentColor: "var(--accent)" }}/>
              <span style={{ flex: 1, fontWeight: 600 }}>{r.key}</span>
            </label>
          );
        })}
      </div>

      {member.pilotCode && (
        <div style={{ padding: "10px 12px", borderRadius: 6, background: "var(--bg-subtle)", border: "1px solid var(--border)", fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="shield" size={13} stroke="var(--accent)"/>
          <span>Pilot code on file: <span className="mono" style={{ fontWeight: 600, letterSpacing: 2 }}>{member.pilotCode}</span></span>
          <button className="btn btn-sm btn-ghost" style={{ marginLeft: "auto" }} onClick={() => alert(`In production, this resets ${member.name}'s pilot code and notifies them by email.`)}>Reset code</button>
        </div>
      )}
    </Modal>
  );
}

/* ---------- Invite detail / copy-link modal ---------- */
function InviteDetailModal({ invite, onClose, onCopy, onResend, onRevoke }) {
  const link = ivLinkFor(invite.token);
  const statusInfo = {
    pending:  { color: "var(--warning)", text: "Pending — recipient hasn't opened the link yet." },
    opened:   { color: "var(--accent)",  text: "Opened — recipient has viewed but not completed registration." },
    expired:  { color: "var(--text-3)",  text: "Expired — generate a new invite to send a fresh link." },
    revoked:  { color: "var(--text-3)",  text: "Revoked — this link no longer works." },
  };
  const si = statusInfo[invite.status] || statusInfo.pending;

  return (
    <Modal open onClose={onClose} icon="mail" size="md"
      title="Invitation details" subtitle={invite.email}
      footer={<>
        <button className="btn" onClick={onClose}>Close</button>
        <button className="btn" onClick={() => onResend(invite)}><Icon name="send" size={13}/> Resend</button>
        <button className="btn btn-primary" onClick={() => onCopy(invite)} disabled={invite.status === "revoked" || invite.status === "expired"}>
          <Icon name="link" size={13}/> Copy link
        </button>
      </>}>
      <div style={{ padding: 12, borderRadius: 8, background: "var(--bg-subtle)", border: `1px solid color-mix(in oklab, ${si.color} 25%, var(--border))`, marginBottom: 14, display: "flex", gap: 10, alignItems: "center" }}>
        <span className="dot" style={{ background: si.color, width: 8, height: 8, borderRadius: "50%", flexShrink: 0 }}/>
        <div style={{ fontSize: 12.5, color: "var(--text-2)" }}>{si.text}</div>
      </div>

      <div className="field" style={{ marginBottom: 12 }}>
        <label className="field-label">Registration link</label>
        <div style={{ display: "flex", gap: 6 }}>
          <input className="input mono" readOnly value={link} style={{ fontSize: 11.5 }} onClick={e => e.target.select()}/>
          <button className="btn" onClick={() => onCopy(invite)} disabled={invite.status === "revoked" || invite.status === "expired"}><Icon name="copy" size={13}/></button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <div className="field-label" style={{ marginBottom: 4 }}>Roles</div>
          <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
            {invite.roles.map(r => <span key={r} className="pill">{r}</span>)}
          </div>
        </div>
        <div>
          <div className="field-label" style={{ marginBottom: 4 }}>Invited by</div>
          <div style={{ fontSize: 13 }}>{invite.invitedByName}</div>
        </div>
        <div>
          <div className="field-label" style={{ marginBottom: 4 }}>Sent</div>
          <div style={{ fontSize: 13 }}>{new Date(invite.sentAt).toLocaleString()}</div>
        </div>
        <div>
          <div className="field-label" style={{ marginBottom: 4 }}>Expires</div>
          <div style={{ fontSize: 13 }}>{new Date(invite.expiresAt).toLocaleString()}</div>
        </div>
        {invite.openedAt && (
          <div style={{ gridColumn: "1 / -1" }}>
            <div className="field-label" style={{ marginBottom: 4 }}>First opened</div>
            <div style={{ fontSize: 13 }}>{new Date(invite.openedAt).toLocaleString()}</div>
          </div>
        )}
      </div>

      {invite.message && (
        <div>
          <div className="field-label" style={{ marginBottom: 6 }}>Personal message</div>
          <div style={{ padding: 10, borderRadius: 6, background: "var(--bg-subtle)", border: "1px solid var(--border)", fontSize: 12.5, color: "var(--text-2)", whiteSpace: "pre-wrap" }}>{invite.message}</div>
        </div>
      )}
    </Modal>
  );
}

Object.assign(window, { MembersInvitesView });
