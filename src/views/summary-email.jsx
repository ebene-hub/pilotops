import React from "react";
// Pilot Ops — Post-flight summary (editable + media gallery picker)
const { useState: seUseState, useEffect: seUseEffect, useRef: seUseRef, useMemo: seUseMemo } = React;

/* ---------- Inline-editable text (contentEditable) ---------- */
function Editable({ tag = "div", value, onChange, placeholder, style, multiline = false, className }) {
  const ref = seUseRef(null);
  const Tag = tag;

  // Set initial content; don't re-render on every keystroke (would lose caret)
  seUseEffect(() => {
    if (ref.current && ref.current.innerText !== value) {
      ref.current.innerText = value;
    }
  }, []);

  return (
    <Tag
      ref={ref}
      className={"editable " + (className || "")}
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onBlur={e => onChange(e.currentTarget.innerText)}
      onKeyDown={e => {
        if (!multiline && e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
      }}
      style={style}
    />
  );
}

/* ---------- Editable bullet list ---------- */
function EditableList({ items, onChange, placeholder }) {
  function update(i, v) {
    const next = items.slice();
    next[i] = v;
    onChange(next.filter((s, idx) => idx !== i || s.trim()));
  }
  function add() {
    onChange([...items, ""]);
  }
  function remove(i) {
    onChange(items.filter((_, idx) => idx !== i));
  }
  return (
    <ul style={{ paddingLeft: 18, margin: "0 0 16px", lineHeight: 1.7 }}>
      {items.map((it, i) => (
        <li key={i} style={{ position: "relative", paddingRight: 22 }}>
          <Editable
            tag="span"
            value={it}
            onChange={v => update(i, v)}
            placeholder={placeholder}
            style={{ display: "inline" }}
          />
          <button
            onClick={() => remove(i)}
            className="row-remove"
            title="Remove"
            style={{
              position: "absolute", top: 2, right: 0,
              border: "none", background: "transparent", color: "#9aa3b2",
              cursor: "pointer", padding: 2, opacity: 0,
              transition: "opacity 0.12s"
            }}>
            <Icon name="close" size={11}/>
          </button>
        </li>
      ))}
      <li style={{ listStyle: "none", marginLeft: -18 }}>
        <button onClick={add} style={{
          border: "1px dashed #c5cbd6", background: "transparent", color: "#5b6479",
          padding: "3px 10px", borderRadius: 6, fontSize: 11.5, cursor: "pointer",
          display: "inline-flex", alignItems: "center", gap: 4, marginTop: 4
        }}>
          <Icon name="plus" size={10}/> Add bullet
        </button>
      </li>
    </ul>
  );
}

/* ---------- Media picker modal (sources from gallery) ---------- */
function MediaPicker({ open, onClose, onConfirm, alreadySelected = [] }) {
  const library = window.MEDIA_LIBRARY || [];
  const TYPE_META = window.TYPE_META || {};
  const MediaThumb = window.MediaThumb;

  const [picked, setPicked] = seUseState(new Set(alreadySelected));
  const [typeFilter, setTypeFilter] = seUseState("all");
  const [q, setQ] = seUseState("");

  seUseEffect(() => { if (open) setPicked(new Set(alreadySelected)); }, [open]);

  const filtered = library.filter(m => {
    if (typeFilter !== "all" && m.type !== typeFilter) return false;
    if (q) {
      const hay = (m.name + " " + m.area + " " + m.flight + " " + m.tags.join(" ")).toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  function toggle(id) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPicked(next);
  }

  if (!open) return null;

  return (
    <Modal open onClose={onClose} size="xl" title="Add from media gallery"
           subtitle={`${library.length} files available · ${picked.size} selected`}
           icon="image"
           footer={
             <>
               <button className="btn" onClick={onClose}>Cancel</button>
               <button className="btn btn-primary" onClick={() => onConfirm([...picked])} disabled={picked.size === 0}>
                 <Icon name="check" size={14}/> Insert {picked.size > 0 ? picked.size : ""} {picked.size === 1 ? "file" : "files"}
               </button>
             </>
           }>
      {/* Toolbar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {[
            { k: "all",     l: "All",     ic: "folder" },
            { k: "photo",   l: "Photos",  ic: "image" },
            { k: "video",   l: "Video",   ic: "video" },
            { k: "thermal", l: "Thermal", ic: "fire" },
            { k: "lidar",   l: "LiDAR",   ic: "layers" },
            { k: "map",     l: "Maps",    ic: "pin" },
          ].map(o => (
            <button key={o.k}
              onClick={() => setTypeFilter(o.k)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "6px 10px", borderRadius: 6, border: "none",
                background: typeFilter === o.k ? "var(--accent-soft)" : "transparent",
                color: typeFilter === o.k ? "var(--accent)" : "var(--text-2)",
                fontSize: 12, fontWeight: 500, cursor: "pointer"
              }}>
              <Icon name={o.ic} size={11}/>{o.l}
            </button>
          ))}
        </div>
        <div className="search-input" style={{ marginLeft: "auto", width: 240, height: 30 }}>
          <Icon name="search" size={13}/>
          <input style={{ flex: 1, border: "none", background: "transparent", outline: "none", color: "var(--text)", fontSize: 12 }}
                 placeholder="Search filename, tag…" value={q} onChange={e => setQ(e.target.value)}/>
        </div>
      </div>

      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
        gap: 10, maxHeight: 460, overflowY: "auto", paddingRight: 4
      }}>
        {filtered.map(m => {
          const isPicked = picked.has(m.id);
          return (
            <div key={m.id} onClick={() => toggle(m.id)}
              style={{
                border: isPicked ? "2px solid var(--accent)" : "1px solid var(--border)",
                borderRadius: 10, background: "var(--surface)",
                cursor: "pointer", overflow: "hidden",
                boxShadow: isPicked ? "0 0 0 4px var(--accent-ring)" : "none",
                position: "relative", transition: "all 0.12s"
              }}>
              <div style={{ position: "relative" }}>
                {MediaThumb && <MediaThumb item={m}/>}
                <div style={{
                  position: "absolute", top: 6, right: 6,
                  width: 20, height: 20, borderRadius: 5,
                  background: isPicked ? "var(--accent)" : "rgba(255,255,255,0.9)",
                  border: isPicked ? "none" : "1px solid var(--border-strong)",
                  color: isPicked ? "#fff" : "transparent",
                  display: "grid", placeItems: "center"
                }}>
                  {isPicked && <Icon name="check" size={12}/>}
                </div>
              </div>
              <div style={{ padding: "7px 9px" }}>
                <div className="mono" style={{ fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</div>
                <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 1 }}>{m.flight} · {m.area}</div>
              </div>
            </div>
          );
        })}
      </div>
      {filtered.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
          No media matches your filters.
        </div>
      )}
    </Modal>
  );
}

/* ---------- Default editable doc ---------- */
function defaultDoc(f) {
  return {
    headline: f.area,
    meta: `${f.id} · ${f.pilot.name} · Jun 3, 2026 08:30–09:18 (00:48:12)`,
    intro: `The 48-minute sweep of the ${f.area} was completed without incident. UAV ${f.uav.id} covered ${f.coverageKm} km² across 6 waypoints with no telemetry loss above the 5-second threshold.`,
    findings: [
      "INC-0412 · Heat anomaly at 12.487°N, 9.231°E — flagged as possible vehicle. Visual confirmation captured at 08:18.",
      "INC-0413 · Vegetation encroachment along Loop Rd north — 14m segment requires clearance crew dispatch.",
      "No insulator or conductor abnormalities along Span 18–22.",
    ],
    actions: [
      "Schedule follow-up sweep at INC-0412 within 24 hours.",
      "Dispatch maintenance crew for vegetation clearance (est. 4 hours).",
    ],
    signoff: "Filed by " + f.pilot.name,
    mediaIds: ["MED-1023", "MED-1022", "MED-1024"],
  };
}

/* ---------- Main view ---------- */
function SummaryEmailView({ flight }) {
  const f = flight || ACTIVE_FLIGHTS[0];
  const recipients = STAKEHOLDERS.filter(s => s.notify.includes("summary"));
  const toast = useToast();

  const storageKey = `po:summary:${f.id}`;
  const [doc, setDoc] = seUseState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) return JSON.parse(raw);
    } catch {}
    return defaultDoc(f);
  });
  seUseEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(doc));
  }, [doc]);

  const [pickerOpen, setPickerOpen] = seUseState(false);
  const [lastSaved, setLastSaved] = seUseState("just now");

  const library = window.MEDIA_LIBRARY || [];
  const TYPE_META = window.TYPE_META || {};
  const MediaThumb = window.MediaThumb;
  const formatBytes = window.formatBytes || (b => b);

  const media = doc.mediaIds.map(id => library.find(m => m.id === id)).filter(Boolean);

  function setField(k, v) {
    setDoc(prev => ({ ...prev, [k]: v }));
    setLastSaved("just now");
  }

  function addMedia(ids) {
    const next = Array.from(new Set([...doc.mediaIds, ...ids]));
    setField("mediaIds", next);
    setPickerOpen(false);
    toast({ kind: "success", title: `${ids.length - doc.mediaIds.filter(id => ids.includes(id)).length} file(s) added`, msg: "Inserted into post-flight summary." });
  }

  function removeMedia(id) {
    setField("mediaIds", doc.mediaIds.filter(x => x !== id));
  }

  function moveMedia(id, dir) {
    const arr = doc.mediaIds.slice();
    const i = arr.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setField("mediaIds", arr);
  }

  function resetDoc() {
    if (confirm("Reset summary to the auto-generated draft? Your edits will be lost.")) {
      setDoc(defaultDoc(f));
      toast({ kind: "info", title: "Reset to draft", msg: "Summary restored." });
    }
  }

  return (
    <div className="main-content">
      <style>{`
        .editable {
          outline: none;
          border-radius: 4px;
          transition: background 0.12s, box-shadow 0.12s;
          padding: 1px 3px;
          margin: -1px -3px;
        }
        .editable:hover { background: rgba(37,99,235,0.04); }
        .editable:focus { background: rgba(37,99,235,0.08); box-shadow: 0 0 0 1px rgba(37,99,235,0.4); }
        .editable:empty::before {
          content: attr(data-placeholder);
          color: #b6bbc6;
        }
        ul li:hover .row-remove { opacity: 1 !important; }
        .media-tile { position: relative; }
        .media-tile .tile-actions {
          position: absolute; top: 6px; left: 6px;
          display: flex; gap: 3px; opacity: 0;
          transition: opacity 0.12s;
        }
        .media-tile:hover .tile-actions { opacity: 1; }
        .tile-actions button {
          width: 22px; height: 22px; border-radius: 5px;
          background: rgba(13,18,30,0.78); color: #fff;
          border: none; cursor: pointer; display: grid; place-items: center;
        }
        .tile-actions button:hover { background: rgba(13,18,30,0.95); }
      `}</style>

      <div className="page-head">
        <div>
          <div className="topbar-crumbs">
            <span>Flight Hub</span><Icon name="chev" size={12}/>
            <span>{f.id}</span><Icon name="chev" size={12}/>
            <span style={{ color: "var(--text)" }}>Post-flight summary</span>
          </div>
          <h1 className="page-title" style={{ marginTop: 4 }}>Post-flight summary</h1>
          <div className="page-sub">
            <Icon name="check" size={12} style={{ color: "var(--success)", verticalAlign: "-2px", marginRight: 4 }}/>
            Auto-saved {lastSaved} · {recipients.length} recipients pending
          </div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={resetDoc} title="Restore the auto-generated draft"><Icon name="refresh" size={14}/> Reset to draft</button>
          <button className="btn"><Icon name="download" size={14}/> Download PDF</button>
          <button className="btn btn-primary" onClick={() => toast({ kind: "success", title: "Summary sent", msg: `${recipients.length} recipients notified.` })}>
            <Icon name="send" size={14}/> Send to {recipients.length}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: "var(--density-gap)" }}>
        {/* Email preview */}
        <div className="card">
          <div className="card-head">
            <div className="card-title">Email preview</div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
              <span className="badge"><Icon name="edit" size={10}/> Editable</span>
              <span className="badge"><Icon name="image" size={10}/> {media.length} media</span>
            </div>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <div style={{ background: "var(--bg-subtle)", padding: 28 }}>
              <div style={{ maxWidth: 640, margin: "0 auto", background: "white", borderRadius: 12, overflow: "hidden", boxShadow: "var(--shadow-md)" }}>
                {/* Header band */}
                <div style={{ background: "linear-gradient(135deg, #2563eb, #1d4ed8)", padding: "24px 28px", color: "white" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
                    <div style={{ width: 30, height: 30, borderRadius: 7, background: "rgba(255,255,255,0.15)", display: "grid", placeItems: "center", fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 12 }}>PO</div>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>Pilot Ops Flight Summary</span>
                  </div>
                  <Editable
                    tag="div"
                    value={doc.headline}
                    onChange={v => setField("headline", v)}
                    placeholder="Mission area"
                    style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.2, color: "white" }}/>
                  <Editable
                    tag="div"
                    value={doc.meta}
                    onChange={v => setField("meta", v)}
                    placeholder="Flight metadata"
                    style={{ fontSize: 13, opacity: 0.85, marginTop: 4, fontFamily: "var(--font-mono)", color: "white" }}/>
                </div>

                {/* Body */}
                <div style={{ padding: "24px 28px", fontSize: 13.5, color: "#0b1220", lineHeight: 1.6 }}>
                  <Editable
                    tag="p"
                    value={doc.intro}
                    onChange={v => setField("intro", v)}
                    placeholder="Intro paragraph…"
                    multiline
                    style={{ margin: "0 0 16px" }}/>

                  {/* KPI strip */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, margin: "20px 0", padding: 14, background: "#f7f8fa", borderRadius: 10, border: "1px solid #e6e8ee" }}>
                    {[
                      ["Coverage", f.coverageKm + " km²"],
                      ["Avg altitude", f.altitude + " m"],
                      ["Incidents", "2 flagged"],
                      ["Footage", "48m 12s"],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <div style={{ fontSize: 10, color: "#7a8294", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 500 }}>{k}</div>
                        <div style={{ fontSize: 16, fontWeight: 600, fontFamily: "var(--font-mono)", marginTop: 2 }}>{v}</div>
                      </div>
                    ))}
                  </div>

                  <h3 style={{ fontSize: 14, marginTop: 24, marginBottom: 8 }}>Key findings</h3>
                  <EditableList
                    items={doc.findings}
                    onChange={v => setField("findings", v)}
                    placeholder="Describe a finding…"/>

                  <h3 style={{ fontSize: 14, marginTop: 20, marginBottom: 8 }}>Recommended actions</h3>
                  <EditableList
                    items={doc.actions}
                    onChange={v => setField("actions", v)}
                    placeholder="Describe a recommended action…"/>

                  {/* Media section */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 20, marginBottom: 8 }}>
                    <h3 style={{ fontSize: 14, margin: 0 }}>
                      Attached media {media.length > 0 && <span style={{ color: "#7a8294", fontWeight: 400 }}>({media.length})</span>}
                    </h3>
                    <button onClick={() => setPickerOpen(true)} style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      padding: "5px 11px", borderRadius: 6,
                      background: "#eff4ff", color: "#2563eb",
                      border: "1px solid #c5d9ff", cursor: "pointer",
                      fontSize: 12, fontWeight: 500
                    }}>
                      <Icon name="plus" size={11}/> Add from gallery
                    </button>
                  </div>

                  {media.length > 0 ? (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 18 }}>
                      {media.map((m, i) => (
                        <div key={m.id} className="media-tile" style={{
                          aspectRatio: "16/10", borderRadius: 8, overflow: "hidden",
                          position: "relative", border: "1px solid #e6e8ee", background: "#f7f8fa"
                        }}>
                          {MediaThumb && <MediaThumb item={m}/>}
                          {/* Filename overlay */}
                          <div style={{
                            position: "absolute", bottom: 0, left: 0, right: 0,
                            padding: "14px 8px 5px",
                            background: "linear-gradient(to top, rgba(0,0,0,0.75), transparent)",
                            color: "white", fontFamily: "var(--font-mono)", fontSize: 10,
                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
                          }}>{m.name}</div>
                          {/* Hover actions */}
                          <div className="tile-actions">
                            <button onClick={() => moveMedia(m.id, -1)} disabled={i === 0} title="Move left"
                              style={{ opacity: i === 0 ? 0.4 : 1 }}>
                              <Icon name="arrowLeft" size={11}/>
                            </button>
                            <button onClick={() => moveMedia(m.id, 1)} disabled={i === media.length - 1} title="Move right"
                              style={{ opacity: i === media.length - 1 ? 0.4 : 1 }}>
                              <Icon name="arrowRight" size={11}/>
                            </button>
                            <button onClick={() => removeMedia(m.id)} title="Remove">
                              <Icon name="close" size={11}/>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div onClick={() => setPickerOpen(true)} style={{
                      border: "1.5px dashed #c5cbd6", borderRadius: 10,
                      padding: "26px 16px", textAlign: "center", color: "#5b6479",
                      fontSize: 12.5, cursor: "pointer", marginBottom: 18,
                      background: "#fafbfc"
                    }}>
                      <Icon name="image" size={18} stroke="#9aa3b2"/>
                      <div style={{ marginTop: 6 }}>No media attached yet. <span style={{ color: "#2563eb", fontWeight: 500 }}>Add from gallery →</span></div>
                    </div>
                  )}

                  <Editable
                    tag="div"
                    value={doc.signoff}
                    onChange={v => setField("signoff", v)}
                    placeholder="Sign-off…"
                    style={{ fontSize: 13, color: "#5b6479", marginTop: 18, paddingTop: 14, borderTop: "1px solid #e6e8ee" }}/>

                  {/* Buttons */}
                  <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
                    <a href="#" onClick={e => e.preventDefault()} style={{ background: "#2563eb", color: "white", padding: "10px 18px", borderRadius: 8, textDecoration: "none", fontWeight: 500, fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="video" size={13}/> View recording</a>
                    <a href="#" onClick={e => e.preventDefault()} style={{ background: "white", color: "#2563eb", padding: "10px 18px", borderRadius: 8, textDecoration: "none", fontWeight: 500, fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid #2563eb" }}><Icon name="reports" size={13}/> Full report (PDF)</a>
                  </div>
                </div>

                <div style={{ padding: "12px 28px", background: "#f7f8fa", fontSize: 11, color: "#7a8294", borderTop: "1px solid #e6e8ee" }}>
                  Filed via Pilot Ops · Auto-saved {lastSaved} · Recipients are notified only when you click Send.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--density-gap)" }}>
          {/* Editor toolbar / actions card */}
          <div className="card">
            <div className="card-head"><div className="card-title">Editor</div></div>
            <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              <button className="btn" style={{ justifyContent: "flex-start" }} onClick={() => setPickerOpen(true)}>
                <Icon name="image" size={14}/> Add media from gallery
              </button>
              <button className="btn" style={{ justifyContent: "flex-start" }} onClick={() => setField("findings", [...doc.findings, ""])}>
                <Icon name="plus" size={14}/> Add finding
              </button>
              <button className="btn" style={{ justifyContent: "flex-start" }} onClick={() => setField("actions", [...doc.actions, ""])}>
                <Icon name="plus" size={14}/> Add recommended action
              </button>
              <div style={{ fontSize: 11, color: "var(--text-3)", padding: "8px 4px 0", borderTop: "1px solid var(--border)", marginTop: 4 }}>
                <Icon name="info" size={11} style={{ verticalAlign: "-1px" }}/> Click any text in the preview to edit it directly. Changes auto-save.
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><div className="card-title">Recipients ({recipients.length})</div></div>
            <div style={{ padding: 4 }}>
              {recipients.map(r => (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8 }}>
                  <div className="user-avatar" style={{ width: 28, height: 28, fontSize: 11, background: `linear-gradient(135deg, ${r.avatar}, color-mix(in oklab, ${r.avatar} 70%, #000))` }}>{r.name.split(" ").map(w => w[0]).slice(0, 2).join("")}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 500 }}>{r.name}</div>
                    <div className="muted mono" style={{ fontSize: 10.5 }}>{r.email}</div>
                  </div>
                  <Icon name="check" size={14} style={{ color: "var(--success)" }}/>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><div className="card-title">Attachments</div></div>
            <div style={{ padding: 8 }}>
              {[
                { ic: "doc", name: f.id + "_summary.pdf", size: "1.4 MB" },
                { ic: "video", name: f.id + "_recording.mp4", size: "284 MB", note: "Encrypted link" },
                { ic: "doc", name: "telemetry_log.csv", size: "82 KB" },
                ...media.slice(0, 3).map(m => ({ ic: TYPE_META[m.type]?.icon || "image", name: m.name, size: formatBytes(m.size), note: "From gallery" })),
              ].map(a => (
                <div key={a.name} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", borderRadius: 8 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 6, background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center" }}><Icon name={a.ic} size={13}/></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mono" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                    <div className="muted" style={{ fontSize: 10.5 }}>{a.size}{a.note ? " · " + a.note : ""}</div>
                  </div>
                  <button className="iconbtn" style={{ width: 24, height: 24 }}><Icon name="download" size={12}/></button>
                </div>
              ))}
            </div>
          </div>

          {/* Send checklist */}
          <div className="card">
            <div className="card-head"><div className="card-title">Pre-send checklist</div></div>
            <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                ["Flight log closed", true],
                ["Incidents reviewed (2)", true],
                ["Media reviewed", media.length > 0],
                ["Recipients confirmed", true],
              ].map(([k, done]) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5 }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: 5,
                    background: done ? "var(--success)" : "var(--bg-muted)",
                    color: done ? "#fff" : "var(--text-4)",
                    display: "grid", placeItems: "center",
                    border: done ? "none" : "1px solid var(--border-strong)"
                  }}>
                    {done ? <Icon name="check" size={11}/> : null}
                  </div>
                  <span style={{ color: done ? "var(--text)" : "var(--text-3)" }}>{k}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <MediaPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onConfirm={addMedia}
        alreadySelected={doc.mediaIds}/>
    </div>
  );
}

Object.assign(window, { SummaryEmailView });
