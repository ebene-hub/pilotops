import React from "react";
// Pilot Ops — Post-flight summary (editable + media gallery picker)
const { useState: seUseState, useEffect: seUseEffect, useRef: seUseRef, useMemo: seUseMemo } = React;

/* ---------- PDF export ----------------------------------------------------
   Build a self-contained, print-ready A4 report from the pilot's edited
   summary and print it in an isolated iframe. Printing the live SPA via
   window.print() produced a blank/clutter page (fixed layout + app print CSS);
   a standalone document renders the real content as a clean, professional PDF. */
function seEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function buildReportHtml(f, doc, media, imgUrls) {
  const pilotName = f?.pilot?.name || (typeof f?.pilot === "string" ? f.pilot : "—");
  const aircraft = f?.uav ? [f.uav.id, f.uav.model].filter(Boolean).join(" · ") : "—";
  const station = f?.station?.name || f?.station?.label || "—";
  const val = (v, suffix = "") => (v && String(v).trim() && v !== "—" ? seEsc(v) + suffix : "—");
  const coverage = f?.coverageKm > 0 ? f.coverageKm + " km²" : "—";
  const altitude = f?.altitude > 0 ? f.altitude + " m" : "—";
  const duration = f?.duration && f.duration !== "00:00:00" ? f.duration : "—";

  const rows = [
    ["Flight ID", f?.id || "—"],
    ["Pilot in command", pilotName],
    ["Aircraft", aircraft],
    ["Ground station", station],
    ["Operations area", f?.area || "—"],
    ["Launch time", f?.started || "—"],
    ["Flight duration", duration],
    ["Coverage", coverage],
    ["Average altitude", altitude],
    ["Status", (f?.status || "—")],
  ];
  const detailHtml = rows.map(([k, v]) => `<div class="d-row"><div class="d-k">${seEsc(k)}</div><div class="d-v">${seEsc(v)}</div></div>`).join("");

  const listHtml = (items, empty) => {
    const clean = (items || []).filter((x) => x && x.trim());
    return clean.length ? `<ul>${clean.map((x) => `<li>${seEsc(x)}</li>`).join("")}</ul>` : `<p class="muted">${empty}</p>`;
  };

  const mediaHtml = media.length
    ? `<div class="media-grid">${media.map((m) => {
        const url = imgUrls[m.id];
        const thumb = url
          ? `<div class="m-thumb" style="background-image:url('${seEsc(url)}')"></div>`
          : `<div class="m-thumb m-ph"><span>${seEsc((m.type || "file").toUpperCase())}</span></div>`;
        const sub = [m.type, m.area, m.flight].filter(Boolean).join(" · ");
        return `<figure class="m-tile">${thumb}<figcaption><b>${seEsc(m.name)}</b><span>${seEsc(sub)}</span></figcaption></figure>`;
      }).join("")}</div>`
    : `<p class="muted">No media attached.</p>`;

  const generated = new Date().toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });

  return `<!doctype html><html><head><meta charset="utf-8"><title>${seEsc(f?.id || "Flight")} — Post-Flight Summary</title>
<style>
  @page { size: A4; margin: 16mm 15mm 18mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #0b1220; font-size: 10.5pt; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .rh { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1d4ed8; padding-bottom: 12px; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand .logo { width: 36px; height: 36px; border-radius: 8px; background: linear-gradient(135deg,#2563eb,#1d4ed8);
    color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 13px; letter-spacing: .5px; }
  .brand .bt { font-weight: 700; font-size: 15px; }
  .brand .bs { font-size: 9px; color: #5b6479; text-transform: uppercase; letter-spacing: .09em; margin-top: 1px; }
  .hm { text-align: right; font-size: 9.5px; color: #5b6479; line-height: 1.6; }
  .hm b { color: #0b1220; }
  h1.title { font-size: 21px; margin: 20px 0 2px; letter-spacing: -.01em; }
  .subtitle { color: #5b6479; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 10.5px; margin-bottom: 14px; }
  h2.sec { font-size: 11px; text-transform: uppercase; letter-spacing: .07em; color: #1d4ed8;
    border-bottom: 1px solid #e6e8ee; padding-bottom: 5px; margin: 22px 0 10px; }
  .details { display: grid; grid-template-columns: 1fr 1fr; gap: 0 28px; }
  .d-row { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px solid #eef0f4; }
  .d-k { color: #5b6479; } .d-v { font-weight: 600; text-align: right; }
  p { margin: 0 0 10px; } ul { margin: 0 0 10px; padding-left: 20px; } li { margin-bottom: 5px; }
  .muted { color: #8a92a3; font-style: italic; }
  .media-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .m-tile { margin: 0; border: 1px solid #e6e8ee; border-radius: 8px; overflow: hidden; break-inside: avoid; }
  .m-thumb { height: 92px; background-size: cover; background-position: center; background-color: #eef1f6;
    display: flex; align-items: center; justify-content: center; }
  .m-ph span { font-size: 10px; color: #6b7280; font-weight: 600; letter-spacing: .06em; }
  figcaption { padding: 6px 8px; }
  figcaption b { display: block; font-family: ui-monospace, monospace; font-size: 8.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  figcaption span { color: #8a92a3; font-size: 8.5px; }
  .signoff { margin-top: 22px; padding-top: 12px; border-top: 1px solid #e6e8ee; }
  .sign-line { margin-top: 30px; display: flex; gap: 44px; }
  .sign-line .sl { flex: 1; border-top: 1px solid #9aa3b2; padding-top: 4px; font-size: 8.5px; color: #5b6479; text-transform: uppercase; letter-spacing: .05em; }
  .rf { position: fixed; bottom: 0; left: 0; right: 0; font-size: 8px; color: #9aa3b2; text-align: center; border-top: 1px solid #e6e8ee; padding-top: 4px; }
  h2.sec, .m-tile, .signoff { break-inside: avoid; }
</style></head>
<body>
  <div class="rh">
    <div class="brand">
      <div class="logo">PO</div>
      <div><div class="bt">Pilot Ops</div><div class="bs">Post-Flight Summary Report</div></div>
    </div>
    <div class="hm">Report&nbsp;ID&nbsp;<b>${seEsc(f?.id || "—")}</b><br>Generated&nbsp;<b>${seEsc(generated)}</b></div>
  </div>

  <h1 class="title">${seEsc(doc.headline || f?.area || "Flight summary")}</h1>
  <div class="subtitle">${seEsc(doc.meta || "")}</div>

  <h2 class="sec">Flight details</h2>
  <div class="details">${detailHtml}</div>

  <h2 class="sec">Mission overview</h2>
  ${doc.intro && doc.intro.trim() ? `<p>${seEsc(doc.intro)}</p>` : `<p class="muted">No overview provided.</p>`}

  <h2 class="sec">Key findings</h2>
  ${listHtml(doc.findings, "No findings recorded.")}

  <h2 class="sec">Recommended actions</h2>
  ${listHtml(doc.actions, "No recommended actions.")}

  <h2 class="sec">Attached media (${media.length})</h2>
  ${mediaHtml}

  <div class="signoff">
    ${doc.signoff && doc.signoff.trim() ? `<div>${seEsc(doc.signoff)}</div>` : ""}
    <div class="sign-line">
      <div class="sl">Pilot in command — signature &amp; date</div>
      <div class="sl">Reviewed by — signature &amp; date</div>
    </div>
  </div>

  <div class="rf">Pilot Ops · Confidential — Internal use only · ${seEsc(f?.id || "")} · Generated ${seEsc(generated)}</div>
</body></html>`;
}

// Render the report HTML in a hidden iframe and open the print dialog once any
// images have loaded (so "Save as PDF" never captures a half-loaded page).
function printHtml(html) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(iframe);
  const idoc = iframe.contentWindow.document;
  idoc.open(); idoc.write(html); idoc.close();
  const fire = () => {
    const imgs = Array.from(idoc.images || []);
    Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : new Promise((res) => { img.onload = img.onerror = res; }))))
      .then(() => {
        try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch {}
        setTimeout(() => { try { iframe.remove(); } catch {} }, 1500);
      });
  };
  // doc.write tends to leave readyState complete immediately; guard both paths.
  if (idoc.readyState === "complete") setTimeout(fire, 60); else iframe.onload = fire;
}

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
  const pilotName = f?.pilot?.name || (typeof f?.pilot === "string" ? f.pilot : "—");
  const uavId = f?.uav?.id || "—";
  const area = f?.area || "the coverage area";
  return {
    headline: f?.area || "Flight summary",
    meta: `${f?.id || "—"} · ${pilotName}`,
    intro: `Summary of mission ${f?.id || ""}${f?.area ? " — sweep of " + area : ""} flown with UAV ${uavId}. Edit this draft before sending.`,
    findings: [],
    actions: [],
    signoff: "Filed by " + pilotName,
    mediaIds: [],
  };
}

/* ---------- Main view ---------- */
function SummaryEmailView({ flight }) {
  // Post-flight summary: use the passed/active flight, else the most recent
  // completed flight so there's always something to summarize.
  const f = flight || ACTIVE_FLIGHTS[0] || RECENT_FLIGHTS[0];
  const toast = useToast();
  // Recipients seed from admin-managed stakeholders (those who get summaries);
  // the pilot can also add ad-hoc emails before sending.
  const [recipients, setRecipients] = seUseState(() =>
    (STAKEHOLDERS || []).filter(s => (s.notify || []).includes("summary")).map(s => ({ id: s.id, name: s.name, email: s.email, avatar: s.avatar })));
  const [emailDraft, setEmailDraft] = seUseState("");
  const [sending, setSending] = seUseState(false);

  function addRecipient() {
    const e = emailDraft.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { toast({ kind: "warn", title: "Invalid email", msg: e || "Enter an email address." }); return; }
    if (recipients.some(r => (r.email || "").toLowerCase() === e.toLowerCase())) { setEmailDraft(""); return; }
    setRecipients(prev => [...prev, { id: "adhoc-" + Date.now(), name: e.split("@")[0], email: e, avatar: "#64748b" }]);
    setEmailDraft("");
  }
  function removeRecipient(id) { setRecipients(prev => prev.filter(r => r.id !== id)); }

  async function sendSummary() {
    if (!recipients.length) { toast({ kind: "warn", title: "No recipients", msg: "Add at least one recipient email." }); return; }
    setSending(true);
    await window.__supabase.from("notifications").insert({ type: "summary", payload: { flight: f?.id }, recipients: recipients.map(r => r.email) });
    setSending(false);
    toast({ kind: "success", title: "Summary sent", msg: `${recipients.length} recipient${recipients.length === 1 ? "" : "s"} notified.` });
  }
  async function downloadPdf() {
    try {
      toast({ kind: "info", title: "Preparing PDF", msg: "Building the post-flight report…" });
      const sb = window.__supabase;
      // Embed real thumbnails for image-type attachments via short-lived signed URLs.
      const imgUrls = {};
      await Promise.all(media.map(async (m) => {
        if (!m.path || !sb || !["photo", "thermal", "map"].includes(m.type)) return;
        try { const { data } = await sb.storage.from("media").createSignedUrl(m.path, 3600); if (data?.signedUrl) imgUrls[m.id] = data.signedUrl; } catch {}
      }));
      printHtml(buildReportHtml(f, doc, media, imgUrls));
    } catch (e) {
      toast({ kind: "warn", title: "PDF failed", msg: e?.message || "Could not generate the report." });
    }
  }

  const storageKey = `po:summary:${f?.id || "none"}`;
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

  if (!f) return (
    <div className="main-content" style={{ display: "grid", placeItems: "center", minHeight: 480 }}>
      <div className="card" style={{ maxWidth: 440, textAlign: "center" }}>
        <div className="card-body" style={{ padding: 40 }}>
          <Icon name="mail" size={32} stroke="var(--text-3)"/>
          <h2 style={{ fontSize: 18, marginTop: 12 }}>No flight to summarize</h2>
          <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>End a mission, or open a completed flight from the Flight log archive, to generate its post-flight summary.</div>
        </div>
      </div>
    </div>
  );

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
          <button className="btn" onClick={downloadPdf}><Icon name="download" size={14}/> Download PDF</button>
          <button className="btn btn-primary" onClick={sendSummary} disabled={sending || !recipients.length} title={!recipients.length ? "Add a recipient first" : "Send summary"}>
            <Icon name="send" size={14}/> {sending ? "Sending…" : `Send to ${recipients.length}`}
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
                      ["Coverage", (f.coverageKm ?? "—") + " km²"],
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
                  <div className="user-avatar" style={{ width: 28, height: 28, fontSize: 11, background: `linear-gradient(135deg, ${r.avatar || "#64748b"}, color-mix(in oklab, ${r.avatar || "#64748b"} 70%, #000))` }}>{(r.name || r.email).split(/[\s@]/).map(w => w[0]).slice(0, 2).join("").toUpperCase()}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 500 }}>{r.name}</div>
                    <div className="muted mono" style={{ fontSize: 10.5 }}>{r.email}</div>
                  </div>
                  <button className="iconbtn" style={{ width: 24, height: 24 }} onClick={() => removeRecipient(r.id)} title="Remove"><Icon name="x" size={12}/></button>
                </div>
              ))}
              {recipients.length === 0 && (
                <div className="muted" style={{ fontSize: 12, padding: "10px 12px", lineHeight: 1.5 }}>
                  No recipients yet. Add emails below, or set who gets summaries in <strong>Admin → Stakeholders</strong>.
                </div>
              )}
              <div className="row" style={{ gap: 6, padding: "8px 10px" }}>
                <input className="input" placeholder="Add recipient email…" value={emailDraft} onChange={e => setEmailDraft(e.target.value)} onKeyDown={e => e.key === "Enter" && addRecipient()} style={{ flex: 1 }}/>
                <button className="btn btn-sm btn-primary" onClick={addRecipient}><Icon name="plus" size={12}/> Add</button>
              </div>
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
