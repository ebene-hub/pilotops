import React from "react";
// Pilot Ops — Media gallery / storage
// Pilots upload photos, video, thermal, LiDAR captures from flights.
const { useState: mgUseState, useMemo: mgUseMemo, useRef: mgUseRef, useEffect: mgUseEffect } = React;

// Media is loaded from the DB by the store into window.MEDIA_LIBRARY; bare
// references below resolve to that real, fresh-at-render global.

const TYPE_META = {
  photo:   { label: "Photo",    icon: "image",     color: "#2563eb" },
  video:   { label: "Video",    icon: "video",     color: "#7c3aed" },
  thermal: { label: "Thermal",  icon: "fire",      color: "#dc2626" },
  lidar:   { label: "LiDAR",    icon: "layers",    color: "#0891b2" },
  map:     { label: "Ortho map",icon: "pin",       color: "#16a34a" },
};

function formatBytes(b) {
  b = Number(b) || 0;
  if (b >= 1e9) return (b / 1e9).toFixed(2) + " GB";
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
  if (b >= 1e3) return (b / 1e3).toFixed(0) + " KB";
  return b + " B";
}

// Storage capacity — set VITE_STORAGE_QUOTA_GB to your Supabase plan's storage
// limit (Free = 1 GB, Pro = 100 GB, …) so the "% used / almost full" indicator is
// accurate. Defaults to 1 GB (free tier) until configured.
const STORAGE_QUOTA_GB = Number(import.meta.env.VITE_STORAGE_QUOTA_GB) || 1;
const STORAGE_QUOTA_BYTES = STORAGE_QUOTA_GB * 1e9;

// Real media preview from the private bucket via a signed URL (videos play,
// photos render). Falls back to the styled thumbnail if there's no file.
function MediaPreview({ item }) {
  const [url, setUrl] = mgUseState(null);
  const [err, setErr] = mgUseState(false);
  mgUseEffect(() => {
    let cancelled = false;
    setUrl(null); setErr(false);
    const path = item?.path;
    if (!path || !window.__supabase) { setErr(true); return; }
    window.__supabase.storage.from("media").createSignedUrl(path, 3600).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data?.signedUrl) setErr(true); else setUrl(data.signedUrl);
    });
    return () => { cancelled = true; };
  }, [item?.id]);

  const box = { width: "100%", height: 360, background: "#0b0f17" };
  if (err || !item?.path) return <div style={{ height: 360 }}><MediaThumb item={item}/></div>;
  if (!url) return <div style={{ ...box, display: "grid", placeItems: "center", color: "var(--text-3)", fontSize: 12.5 }}>Loading…</div>;
  if (item.type === "video") return <video src={url} controls autoPlay playsInline style={{ ...box, objectFit: "contain" }}/>;
  if (item.type === "photo" || item.type === "thermal" || item.type === "map") return <img src={url} alt={item.name} style={{ ...box, objectFit: "contain" }}/>;
  return <div style={{ height: 360 }}><MediaThumb item={item}/></div>;
}

/* ---------- Pseudo-realistic thumbnail per media item ---------- */
function MediaThumb({ item, size = "card" }) {
  const small = size === "small";
  // Deterministic seed for unique-looking variants
  const seed = parseInt(item.id.replace(/\D/g, "")) % 1000;
  const h = small ? 56 : 168;

  const palettes = {
    photo:   ["#7da482", "#cdb784", "#5d7a5e", "#a8b5a0"],
    video:   ["#6b7a8a", "#9aacc1", "#4a5a6b", "#c2cad4"],
    thermal: ["#1a0f2e", "#b91c1c", "#f59e0b", "#fde047"],
    lidar:   ["#0b1220", "#1e3a5f", "#2563eb", "#60a5fa"],
    map:     ["#f1ead6", "#d1b576", "#8b6f3e", "#4a5d2e"],
  };
  const colors = palettes[item.type] || palettes.photo;

  return (
    <div style={{
      position: "relative", width: "100%", height: h, overflow: "hidden",
      borderRadius: small ? 6 : "10px 10px 0 0",
      background: colors[0]
    }}>
      <svg viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice" style={{ width: "100%", height: "100%", display: "block" }}>
        <defs>
          <linearGradient id={`g-${item.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors[1]}/>
            <stop offset="60%" stopColor={colors[0]}/>
            <stop offset="100%" stopColor={colors[2]}/>
          </linearGradient>
          <radialGradient id={`r-${item.id}`} cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor={colors[3]} stopOpacity="0.6"/>
            <stop offset="100%" stopColor={colors[0]} stopOpacity="0"/>
          </radialGradient>
        </defs>

        {/* Sky / base */}
        <rect width="200" height="120" fill={`url(#g-${item.id})`}/>

        {item.type === "thermal" && (
          <>
            <ellipse cx={40 + (seed % 100)} cy={50 + (seed % 30)} rx="60" ry="36" fill={`url(#r-${item.id})`}/>
            <ellipse cx={140 + (seed % 40)} cy={70 + (seed % 20)} rx="34" ry="22" fill="#fde047" opacity="0.5"/>
            <ellipse cx={140 + (seed % 40)} cy={70 + (seed % 20)} rx="14" ry="9" fill="#fef9c3" opacity="0.8"/>
          </>
        )}

        {item.type === "lidar" && (
          <g fill={colors[3]}>
            {Array.from({ length: 80 }).map((_, i) => {
              const x = (Math.sin(i * (seed + 1)) * 100 + 100);
              const y = (Math.cos(i * (seed + 3)) * 60 + 60);
              return <circle key={i} cx={x} cy={y} r={0.6 + (i % 4) * 0.3} opacity={0.4 + (i % 5) * 0.12}/>;
            })}
            <path d={`M0 ${80 + (seed % 20)} L 60 ${60 + (seed % 15)} L 120 ${70 + (seed % 10)} L 200 ${50 + (seed % 25)}`} fill="none" stroke={colors[3]} strokeWidth="0.8" opacity="0.7"/>
          </g>
        )}

        {item.type === "map" && (
          <>
            <pattern id={`grid-${item.id}`} width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M20 0L0 0 0 20" fill="none" stroke={colors[2]} strokeWidth="0.4" opacity="0.5"/>
            </pattern>
            <rect width="200" height="120" fill={`url(#grid-${item.id})`} opacity="0.6"/>
            {/* roads */}
            <path d={`M0 ${30 + (seed % 30)} Q 100 ${(seed % 60)}, 200 ${40 + (seed % 30)}`} fill="none" stroke={colors[2]} strokeWidth="2.2" opacity="0.6"/>
            <path d={`M${40 + (seed % 60)} 0 L ${50 + (seed % 60)} 120`} fill="none" stroke={colors[2]} strokeWidth="1.4" opacity="0.5"/>
            {/* parcels */}
            <rect x={20 + (seed % 40)} y={60 + (seed % 20)} width="40" height="26" fill={colors[3]} opacity="0.4" stroke={colors[2]} strokeWidth="0.4"/>
          </>
        )}

        {(item.type === "photo" || item.type === "video") && (
          <>
            {/* Horizon + hills */}
            <path d={`M0 ${70 + (seed % 25)} Q 60 ${50 + (seed % 20)}, 120 ${62 + (seed % 20)} T 200 ${60 + (seed % 25)} L 200 120 L 0 120 Z`}
                  fill={colors[2]} opacity="0.85"/>
            <path d={`M0 ${90 + (seed % 15)} Q 80 ${75 + (seed % 12)}, 160 ${88 + (seed % 12)} T 200 ${82 + (seed % 12)} L 200 120 L 0 120 Z`}
                  fill={colors[3]} opacity="0.55"/>
            {/* sun */}
            <circle cx={30 + (seed % 140)} cy={28} r="6" fill={colors[3]} opacity="0.7"/>
          </>
        )}

        {/* Crosshair / waypoint */}
        {!small && item.tags.includes("incident") && (
          <g stroke="#fff" strokeWidth="1.2" opacity="0.85" fill="none">
            <circle cx="100" cy="60" r="12"/>
            <line x1="100" y1="44" x2="100" y2="52"/>
            <line x1="100" y1="68" x2="100" y2="76"/>
            <line x1="84" y1="60" x2="92" y2="60"/>
            <line x1="108" y1="60" x2="116" y2="60"/>
          </g>
        )}
      </svg>

      {/* Type chip */}
      {!small && (
        <div style={{
          position: "absolute", top: 8, left: 8,
          display: "flex", alignItems: "center", gap: 4,
          padding: "3px 8px", borderRadius: 999,
          background: "rgba(13,18,30,0.72)", color: "#fff",
          fontSize: 10.5, fontWeight: 600, letterSpacing: "0.02em",
          backdropFilter: "blur(4px)"
        }}>
          <Icon name={(TYPE_META[item.type]||TYPE_META.photo).icon} size={11}/>
          {(TYPE_META[item.type]||TYPE_META.photo).label.toUpperCase()}
        </div>
      )}

      {/* Star */}
      {!small && item.starred && (
        <div style={{ position: "absolute", top: 8, right: 8, color: "#fbbf24", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.5))" }}>
          <Icon name="star" size={14} fill="#fbbf24"/>
        </div>
      )}

      {/* Video duration overlay */}
      {!small && item.type === "video" && (
        <>
          <div style={{
            position: "absolute", inset: 0, display: "grid", placeItems: "center",
            pointerEvents: "none"
          }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.92)", display: "grid", placeItems: "center", color: "#0b1220" }}>
              <Icon name="play" size={14} fill="#0b1220"/>
            </div>
          </div>
          <div style={{
            position: "absolute", bottom: 8, right: 8,
            padding: "2px 7px", borderRadius: 4,
            background: "rgba(13,18,30,0.78)", color: "#fff",
            fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600
          }}>
            {item.dur}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- View ---------- */
function MediaGalleryView({ accent }) {
  const [q, setQ] = mgUseState("");
  const [typeFilter, setTypeFilter] = mgUseState("all");
  const [pilotFilter, setPilotFilter] = mgUseState("all");
  const [showPilotFilter, setShowPilotFilter] = mgUseState(false);
  const [view, setView] = mgUseState("grid");          // grid | list
  const [selected, setSelected] = mgUseState(null);
  const [uploadOpen, setUploadOpen] = mgUseState(false);
  const [media, setMedia] = mgUseState(MEDIA_LIBRARY);
  const [dragHover, setDragHover] = mgUseState(false);
  const [linkFlight, setLinkFlight] = mgUseState("");   // dbId of flight to attach uploads to ("" = unlinked)
  const fileRef = mgUseRef(null);
  const toast = useToast();

  // Real flights the upload can be linked to (active first, then recent).
  const linkableFlights = mgUseMemo(() => {
    const seen = new Set();
    return [...(window.ACTIVE_FLIGHTS || []), ...(window.RECENT_FLIGHTS || [])]
      .filter(f => f.dbId && !seen.has(f.dbId) && seen.add(f.dbId))
      .map(f => ({ dbId: f.dbId, code: f.id, area: f.area, live: (window.ACTIVE_FLIGHTS || []).some(a => a.dbId === f.dbId) }));
  }, []);

  const pilots = mgUseMemo(() => Array.from(new Set(MEDIA_LIBRARY.map(m => m.pilot))).sort(), []);

  const filtered = mgUseMemo(() => media.filter(m => {
    if (typeFilter !== "all" && m.type !== typeFilter) return false;
    if (pilotFilter !== "all" && m.pilot !== pilotFilter) return false;
    if (q) {
      const hay = (m.name + " " + m.area + " " + m.flight + " " + m.pilot + " " + m.tags.join(" ")).toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  }), [media, typeFilter, pilotFilter, q]);

  const counts = mgUseMemo(() => {
    const c = { all: media.length };
    for (const m of media) c[m.type] = (c[m.type] || 0) + 1;
    return c;
  }, [media]);

  const totalBytes = mgUseMemo(() => media.reduce((s, m) => s + (m.size || 0), 0), [media]);
  const [storageNum, storageUnit] = formatBytes(totalBytes).split(" ");
  const usedPct = STORAGE_QUOTA_BYTES > 0 ? (totalBytes / STORAGE_QUOTA_BYTES) * 100 : 0;
  const nearFull = usedPct >= 80;
  const videoBytes = mgUseMemo(() => media.filter(m => m.type === "video").reduce((s, m) => s + (m.size || 0), 0), [media]);
  const uploadedToday = mgUseMemo(() => {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return media.filter(m => m.createdAt && new Date(m.createdAt) >= t).length;
  }, [media]);

  // Keep the gallery live/correct: re-fetch the real media rows whenever this view
  // opens, so screenshots/recordings captured during a flight show up immediately
  // (the sign-in snapshot in MEDIA_LIBRARY may predate them).
  mgUseEffect(() => {
    const sb = window.__supabase; if (!sb) return;
    let cancelled = false;
    const flights = [...(window.ACTIVE_FLIGHTS || []), ...(window.RECENT_FLIGHTS || [])];
    const codeById = {}, pilotByFlight = {};
    flights.forEach(f => { if (f.dbId) { codeById[f.dbId] = f.id; pilotByFlight[f.dbId] = f.pilot?.name; } });
    const rel = (iso) => {
      if (!iso) return "—";
      const d = Date.now() - new Date(iso).getTime();
      if (d < 6e4) return "just now";
      if (d < 36e5) return Math.floor(d / 6e4) + " min ago";
      if (d < 864e5) return Math.floor(d / 36e5) + "h ago";
      return new Date(iso).toLocaleDateString();
    };
    sb.from("media").select("*").order("created_at", { ascending: false }).then(({ data }) => {
      if (cancelled || !data) return;
      setMedia(data.map(m => ({
        id: m.id, shortId: m.id ? m.id.slice(0, 8).toUpperCase() : "", name: m.name, type: m.type, size: m.size, dur: m.duration,
        pilot: pilotByFlight[m.flight_id] || (m.pilot_id && m.pilot_id === window.__poUser?.id ? window.__poUser?.name : null) || "—",
        flight: m.flight_id ? (codeById[m.flight_id] || "—") : "—", flightId: m.flight_id,
        area: m.area, date: rel(m.created_at), createdAt: m.created_at, tags: m.tags || [], starred: m.starred, path: m.storage_path,
      })));
    });
    return () => { cancelled = true; };
  }, []);

  function exportCsv() {
    const rows = [["Name", "Type", "Size (bytes)", "Flight", "Area", "Captured", "Starred"]];
    for (const m of filtered) rows.push([m.name, m.type, m.size, m.flight || "", m.area || "", m.date || "", m.starred ? "yes" : "no"]);
    const csv = rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `media-export-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    toast({ kind: "success", title: "Exported", msg: `${filtered.length} file(s) → CSV` });
  }

  async function handleFiles(files) {
    if (!files || !files.length) return;
    const sb = window.__supabase;
    const uid = window.__poUser?.id || null;
    setUploadOpen(false);
    const added = [];
    for (const f of Array.from(files)) {
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      const type = ["mp4","mov","webm","avi","mkv"].includes(ext) ? "video" : "photo";

      const path = `${uid || "anon"}/${Date.now()}_${f.name}`;
      const up = await sb.storage.from("media").upload(path, f, { upsert: false });
      if (up.error) { toast({ kind: "warn", title: "Upload failed", msg: `${f.name}: ${up.error.message}` }); continue; }

      const linked = linkableFlights.find(x => x.dbId === linkFlight) || null;
      const { data: row, error } = await sb.from("media").insert({
        storage_path: path, name: f.name, type, size: f.size,
        pilot_id: uid, flight_id: linked?.dbId || null, area: linked?.area || null, tags: ["uploaded"],
      }).select().single();
      if (error) { toast({ kind: "warn", title: "Save failed", msg: error.message }); continue; }

      added.push({ id: row.id, name: f.name, type, size: f.size, dur: undefined,
        pilot: window.__poUser?.name || "—", flight: linked?.code || "—", flightId: linked?.dbId || null,
        area: linked?.area || null, date: "just now", tags: ["uploaded"], starred: false, path, _new: true });
    }
    if (added.length) {
      setMedia(prev => [...added, ...prev]);
      toast({ kind: "success", title: `${added.length} file${added.length > 1 ? "s" : ""} uploaded`, msg: "Stored securely." });
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragHover(false);
    handleFiles(e.dataTransfer.files);
  }

  function toggleStar(m) {
    setMedia(prev => prev.map(x => x.id === m.id ? { ...x, starred: !x.starred } : x));
  }

  async function removeItem(m) {
    if (selected?.id === m.id) setSelected(null);
    setMedia(prev => prev.filter(x => x.id !== m.id));
    const sb = window.__supabase;
    const { error } = await sb.from("media").delete().eq("id", m.id);
    if (error) {
      setMedia(prev => [m, ...prev]); // revert — it wasn't deleted
      toast({ kind: "warn", title: "Delete failed", msg: error.message });
      return;
    }
    if (m.path) sb.storage.from("media").remove([m.path]).catch(() => {});
    toast({ kind: "success", title: "File deleted", msg: m.name });
  }

  return (
    <div className="main-content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Media gallery</h1>
          <div className="page-sub">{media.length.toLocaleString()} files · {formatBytes(totalBytes)} of {STORAGE_QUOTA_GB} GB used</div>
        </div>
        <div className="page-actions">
          {showPilotFilter && (
            <select className="select" value={pilotFilter} onChange={e => setPilotFilter(e.target.value)} style={{ height: 34, maxWidth: 200 }}>
              <option value="all">All pilots</option>
              {pilots.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          <button className={"btn" + (showPilotFilter ? " btn-primary" : "")} onClick={() => { setShowPilotFilter(s => !s); if (showPilotFilter) setPilotFilter("all"); }}><Icon name="filter" size={14}/> Filter</button>
          <button className="btn" onClick={exportCsv}><Icon name="download" size={14}/> Export ({filtered.length})</button>
          <button className="btn btn-primary" disabled={window.hasPerm && !window.hasPerm("media.upload")} onClick={() => setUploadOpen(true)} title={(window.hasPerm && !window.hasPerm("media.upload")) ? "Your role can't upload media" : ""}><Icon name="upload" size={14}/> Upload media</button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid-4" style={{ marginBottom: "var(--density-gap)" }}>
        <div className="kpi">
          <div className="kpi-label"><span>Storage used</span></div>
          <div className="kpi-value">
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{storageNum}</span>
            <span className="unit">{storageUnit} / {STORAGE_QUOTA_GB} GB</span>
          </div>
          <div style={{ marginTop: 12, height: 6, borderRadius: 3, background: "var(--bg-muted)", overflow: "hidden" }}>
            <div style={{ width: `${Math.min(100, usedPct)}%`, height: "100%", borderRadius: 3, background: nearFull ? "var(--warning)" : "var(--accent)" }}/>
          </div>
          <div className="kpi-delta" style={{ color: nearFull ? "var(--warning)" : "var(--text-3)", marginTop: 6 }}>
            {usedPct < 0.1 ? "<0.1" : usedPct.toFixed(1)}% used{nearFull ? " · almost full" : ` · ${formatBytes(STORAGE_QUOTA_BYTES - totalBytes)} free`}
          </div>
        </div>
        <KpiTile label="Total media" value={media.length.toLocaleString()} unit="files" delta={`${uploadedToday} today`} trend="up" spark={Array(7).fill(media.length)}/>
        <KpiTile label="Uploaded today" value={String(uploadedToday)} unit="files" trend="up" spark={Array(7).fill(uploadedToday)} color="var(--success)"/>
        <KpiTile label="Linked to flights" value={`${media.length ? Math.round((media.filter(m => m.flightId).length / media.length) * 100) : 0}`} unit="%" trend="up" spark={Array(7).fill(media.filter(m => m.flightId).length)} color="#7c3aed"/>
      </div>

      {/* Upload drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragHover(true); }}
        onDragLeave={() => setDragHover(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        style={{
          marginBottom: "var(--density-gap)",
          border: `1.5px dashed ${dragHover ? "var(--accent)" : "var(--border-strong)"}`,
          borderRadius: "var(--radius-lg)",
          background: dragHover ? "var(--accent-soft)" : "var(--bg-subtle)",
          padding: "22px 24px",
          display: "flex", alignItems: "center", gap: 18,
          cursor: "pointer",
          transition: "all 0.15s"
        }}>
        <input type="file" multiple ref={fileRef} style={{ display: "none" }} onChange={e => handleFiles(e.target.files)}/>
        <div style={{
          width: 52, height: 52, borderRadius: 12,
          background: "var(--accent-soft)", color: "var(--accent)",
          display: "grid", placeItems: "center", flexShrink: 0
        }}>
          <Icon name="upload" size={22}/>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>
            {dragHover ? "Release to upload" : "Drop files here, or click to browse"}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-3)" }}>
            Photos (JPG, PNG) · Video (MP4, MOV, WebM). Max 5 GB / file. Stored to your org's media gallery.
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="card" style={{ marginBottom: "var(--density-gap)" }}>
        <div className="card-head" style={{ gap: 12, flexWrap: "wrap" }}>
          <div className="row" style={{ gap: 4 }}>
            {[
              { k: "all",     l: "All",     ic: "folder" },
              { k: "photo",   l: "Photos",  ic: "image" },
              { k: "video",   l: "Video",   ic: "video" },
            ].map(o => (
              <button key={o.k}
                className={"tab " + (typeFilter === o.k ? "active" : "")}
                onClick={() => setTypeFilter(o.k)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "7px 12px", borderRadius: 6, border: "none",
                  background: typeFilter === o.k ? "var(--accent-soft)" : "transparent",
                  color: typeFilter === o.k ? "var(--accent)" : "var(--text-2)",
                  fontSize: 12.5, fontWeight: 500
                }}>
                <Icon name={o.ic} size={12}/>
                {o.l}
                <span className="mono" style={{ fontSize: 10.5, color: "var(--text-3)", marginLeft: 4 }}>{counts[o.k] || 0}</span>
              </button>
            ))}
          </div>

          <div className="vdivider" style={{ height: 22 }}/>

          <select className="select" value={pilotFilter} onChange={e => setPilotFilter(e.target.value)} style={{ width: 170, height: 32, fontSize: 12.5 }}>
            <option value="all">All pilots</option>
            {pilots.map(p => <option key={p} value={p}>{p}</option>)}
          </select>

          <div className="search-input" style={{ marginLeft: "auto", width: 260, height: 32 }}>
            <Icon name="search" size={14}/>
            <input style={{ flex: 1, border: "none", background: "transparent", outline: "none", color: "var(--text)", fontSize: 12.5 }}
                   placeholder="Search filename, tag, flight…" value={q} onChange={e => setQ(e.target.value)}/>
          </div>

          <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", height: 32 }}>
            <button onClick={() => setView("grid")} title="Grid view"
              style={{ padding: "0 10px", border: "none", background: view === "grid" ? "var(--bg-muted)" : "transparent", color: view === "grid" ? "var(--text)" : "var(--text-3)" }}>
              <Icon name="grid" size={14}/>
            </button>
            <button onClick={() => setView("list")} title="List view"
              style={{ padding: "0 10px", border: "none", background: view === "list" ? "var(--bg-muted)" : "transparent", color: view === "list" ? "var(--text)" : "var(--text-3)", borderLeft: "1px solid var(--border)" }}>
              <Icon name="reports" size={14}/>
            </button>
          </div>
        </div>

        {/* Grid */}
        {view === "grid" && (
          <div style={{
            padding: "var(--density-pad)",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 14
          }}>
            {filtered.map(m => (
              <div key={m.id} onClick={() => setSelected(m)}
                style={{
                  border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)",
                  cursor: "pointer", overflow: "hidden", transition: "all 0.12s",
                  boxShadow: m._new ? "0 0 0 2px var(--accent-ring)" : "none"
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border-strong)"; e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "var(--shadow-md)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = m._new ? "0 0 0 2px var(--accent-ring)" : ""; }}>
                <MediaThumb item={m}/>
                <div style={{ padding: 10 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="mono" style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</div>
                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {m.area}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: "var(--text-3)" }}>
                    <span className="mono">{m.flight}</span>
                    <span>·</span>
                    <span>{m.pilot.split(" ").slice(-1)[0]}</span>
                    <span>·</span>
                    <span className="mono tabular">{formatBytes(m.size)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* List */}
        {view === "list" && (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Preview</th>
                  <th>File</th>
                  <th>Type</th>
                  <th>Flight</th>
                  <th>Pilot</th>
                  <th>Area</th>
                  <th>Size</th>
                  <th>Captured</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(m => (
                  <tr key={m.id} className="clickable" onClick={() => setSelected(m)}>
                    <td style={{ padding: "6px 8px" }}>
                      <div style={{ width: 72, height: 44 }}>
                        <MediaThumb item={m} size="small"/>
                      </div>
                    </td>
                    <td>
                      <div className="mono" style={{ fontWeight: 600, fontSize: 12.5 }}>{m.name}</div>
                      <div style={{ fontSize: 11, color: "var(--text-3)", display: "flex", gap: 4, marginTop: 2 }}>
                        {m.tags.slice(0, 3).map(t => <span key={t} className="pill" style={{ fontSize: 10, padding: "1px 6px" }}>{t}</span>)}
                      </div>
                    </td>
                    <td>
                      <span className="badge" style={{ background: `color-mix(in oklab, ${(TYPE_META[m.type]||TYPE_META.photo).color} 10%, transparent)`, color: (TYPE_META[m.type]||TYPE_META.photo).color, borderColor: `color-mix(in oklab, ${(TYPE_META[m.type]||TYPE_META.photo).color} 30%, transparent)` }}>
                        <Icon name={(TYPE_META[m.type]||TYPE_META.photo).icon} size={10}/> {(TYPE_META[m.type]||TYPE_META.photo).label}
                      </span>
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>{m.flight}</td>
                    <td style={{ fontSize: 12.5 }}>{m.pilot}</td>
                    <td style={{ fontSize: 12.5, color: "var(--text-2)" }}>{m.area}</td>
                    <td className="mono tabular" style={{ fontSize: 12 }}>{formatBytes(m.size)}{m.dur && <div className="muted" style={{ fontSize: 11 }}>{m.dur}</div>}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{m.date}</td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        <button className="btn btn-sm btn-ghost" onClick={e => { e.stopPropagation(); toggleStar(m); }} title="Star">
                          <Icon name="star" size={12} fill={m.starred ? "#fbbf24" : "none"} stroke={m.starred ? "#fbbf24" : "currentColor"}/>
                        </button>
                        <button className="btn btn-sm btn-ghost" title="Download"><Icon name="download" size={12}/></button>
                        <button className="btn btn-sm btn-ghost" onClick={e => { e.stopPropagation(); removeItem(m); }} title="Delete"><Icon name="trash" size={12}/></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {filtered.length === 0 && (
          <div style={{ padding: 48, textAlign: "center", color: "var(--text-3)" }}>
            <Icon name="folder" size={28} stroke="var(--text-4)"/>
            <div style={{ marginTop: 10, fontSize: 13 }}>No media match your filters.</div>
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selected && (
        <Modal open onClose={() => setSelected(null)} size="xl" title={selected.name} subtitle={`${selected.area} · ${selected.flight} · ${selected.date}`}
               footer={
                 <>
                   <button className="btn" onClick={() => toggleStar(selected)}>
                     <Icon name="star" size={14} fill={selected.starred ? "#fbbf24" : "none"} stroke={selected.starred ? "#fbbf24" : "currentColor"}/>
                     {selected.starred ? "Starred" : "Star"}
                   </button>
                   <button className="btn" onClick={async () => {
                     if (!selected.path) return toast({ kind: "warn", title: "No file", msg: "Nothing to link." });
                     const { data } = await window.__supabase.storage.from("media").createSignedUrl(selected.path, 3600);
                     if (data?.signedUrl) { navigator.clipboard?.writeText(data.signedUrl); toast({ kind: "success", title: "Link copied", msg: "Signed link · valid 1 hour" }); }
                   }}><Icon name="link" size={14}/> Copy link</button>
                   <button className="btn"><Icon name="warn" size={14}/> Attach to incident</button>
                   <div style={{ flex: 1 }}/>
                   <button className="btn btn-danger" onClick={() => removeItem(selected)}><Icon name="trash" size={14}/> Delete</button>
                   <button className="btn btn-primary" onClick={async () => {
                     if (!selected.path) return toast({ kind: "warn", title: "No file", msg: "Nothing to download." });
                     const { data, error } = await window.__supabase.storage.from("media").createSignedUrl(selected.path, 3600, { download: selected.name });
                     if (error || !data?.signedUrl) return toast({ kind: "warn", title: "Download failed", msg: error?.message || "No URL" });
                     const a = document.createElement("a");
                     a.href = data.signedUrl; a.download = selected.name || "download";
                     document.body.appendChild(a); a.click(); a.remove();
                   }}><Icon name="download" size={14}/> Download</button>
                 </>
               }>
          <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 18 }}>
            <div>
              <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid var(--border)" }}>
                <MediaPreview item={selected}/>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <DetailRow label="File ID" value={selected.shortId || selected.id} mono/>
              <DetailRow label="Type" value={<span className="badge" style={{ background: `color-mix(in oklab, ${(TYPE_META[selected.type]||TYPE_META.photo).color} 10%, transparent)`, color: (TYPE_META[selected.type]||TYPE_META.photo).color, borderColor: `color-mix(in oklab, ${(TYPE_META[selected.type]||TYPE_META.photo).color} 30%, transparent)` }}><Icon name={(TYPE_META[selected.type]||TYPE_META.photo).icon} size={11}/> {(TYPE_META[selected.type]||TYPE_META.photo).label}</span>}/>
              <DetailRow label="Size" value={formatBytes(selected.size)} mono/>
              {selected.dur && <DetailRow label="Duration" value={selected.dur} mono/>}
              <DetailRow label="Captured" value={selected.date} mono/>
              <DetailRow label="Pilot" value={selected.pilot}/>
              <DetailRow label="Flight" value={selected.flight} mono/>
              <DetailRow label="Coverage area" value={selected.area}/>
              <div>
                <div style={{ fontSize: 11.5, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Tags</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {selected.tags.map(t => <span key={t} className="pill" style={{ fontSize: 11 }}>{t}</span>)}
                  <button className="pill" style={{ fontSize: 11, border: "1px dashed var(--border-strong)", background: "transparent", color: "var(--text-3)", cursor: "pointer" }}>+ add</button>
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Upload modal */}
      {uploadOpen && (
        <Modal open onClose={() => setUploadOpen(false)} title="Upload media" subtitle={linkFlight ? `Linking to ${(linkableFlights.find(f => f.dbId === linkFlight)?.code) || "flight"} · ${linkableFlights.find(f => f.dbId === linkFlight)?.area || ""}` : "Files are stored in your org's media gallery"} icon="upload"
               footer={
                 <>
                   <button className="btn" onClick={() => setUploadOpen(false)}>Cancel</button>
                   <button className="btn btn-primary" onClick={() => fileRef.current?.click()}><Icon name="upload" size={14}/> Choose files</button>
                 </>
               }>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div className="field">
                <label className="field-label">Link to flight</label>
                <select className="select" value={linkFlight} onChange={e => setLinkFlight(e.target.value)}>
                  <option value="">Unlinked</option>
                  {linkableFlights.map(f => (
                    <option key={f.dbId} value={f.dbId}>{f.code} · {f.area}{f.live ? " (live)" : ""}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field-label">Default visibility</label>
                <select className="select" defaultValue="team">
                  <option value="private">Private to me</option>
                  <option value="team">Team only</option>
                  <option value="org">Whole org</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label className="field-label">Tags <span style={{ color: "var(--text-3)", fontWeight: 400 }}>(comma separated)</span></label>
              <input className="input" placeholder="e.g. perimeter, anomaly, INC-0412"/>
            </div>
            <div
              onDragOver={e => { e.preventDefault(); setDragHover(true); }}
              onDragLeave={() => setDragHover(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `1.5px dashed ${dragHover ? "var(--accent)" : "var(--border-strong)"}`,
                borderRadius: 12, padding: "32px 20px",
                background: dragHover ? "var(--accent-soft)" : "var(--bg-subtle)",
                textAlign: "center", cursor: "pointer"
              }}>
              <div style={{ display: "inline-grid", placeItems: "center", width: 56, height: 56, borderRadius: 14, background: "var(--accent-soft)", color: "var(--accent)" }}>
                <Icon name="upload" size={24}/>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, marginTop: 12 }}>Drag files here, or click to browse</div>
              <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>JPG · PNG · MP4 · MOV · WebM — up to 5 GB each</div>
            </div>
            <div style={{ display: "flex", gap: 14, padding: 12, background: "var(--accent-soft)", borderRadius: 8, color: "var(--accent)", fontSize: 12.5, alignItems: "flex-start" }}>
              <Icon name="shield" size={16}/>
              <div style={{ color: "var(--text-2)" }}>
                <strong style={{ color: "var(--text)" }}>EXIF & GPS metadata preserved.</strong> Files are encrypted at rest and a SHA-256 checksum is recorded for chain-of-custody on incident-linked media.
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function DetailRow({ label, value, mono }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 8, fontSize: 13, alignItems: "center" }}>
      <div style={{ fontSize: 11.5, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div className={mono ? "mono" : ""} style={{ color: "var(--text)" }}>{value}</div>
    </div>
  );
}

Object.assign(window, { MediaGalleryView, MediaThumb, TYPE_META, formatBytes });
