import React from "react";
import { supabase } from "../api/supabase.js";
import { refresh } from "../store.jsx";
// Pilot Ops — Live Stream viewer (single pilot) — telemetry, chat, screenshot, AI annotations
const { useState: lsUseState, useEffect: lsUseEffect, useRef: lsUseRef } = React;

// Quick-pick emojis for mission chat (no external picker dependency).
const CHAT_EMOJIS = ["👍","✅","❌","⚠️","🚁","🛰️","📍","👀","🎯","🔥","📸","🟢","🔴","🆗","🙏","👏","🚨","😅","💪","🫡"];

function LiveStreamView({ flight, basemap, setBasemap, onEndFlight }) {
  // Only show a flight that's genuinely in the live list (don't trust a passed
  // flight's possibly-stale status). Else the first active flight, else nothing
  // (empty state) — never render a completed/stale flight as "live".
  const active = window.ACTIVE_FLIGHTS || [];
  const f = active.find(x => x.dbId && x.dbId === flight?.dbId) || active[0] || null;
  const [duration, setDuration] = lsUseState(0);
  const [chat, setChat] = lsUseState([]);
  const [pos, setPos] = lsUseState(null);
  const [online, setOnline] = lsUseState(1);
  const [viewers, setViewers] = lsUseState(0);
  const [draft, setDraft] = lsUseState("");
  const [emojiOpen, setEmojiOpen] = lsUseState(false);
  const [recording, setRecording] = lsUseState(false); // client-side clip recorder
  const mediaRecRef = lsUseRef(null);
  const recChunksRef = lsUseRef([]);
  const recStartRef = lsUseRef(0);
  const endedRef = lsUseRef(false); // guard: only transition out of the live view once
  const [showAnnotations, setShowAnnotations] = lsUseState(true);
  const [flash, setFlash] = lsUseState(false);
  const [screenshots, setScreenshots] = lsUseState([]);
  const [endOpen, setEndOpen] = lsUseState(false);
  const [ingestOpen, setIngestOpen] = lsUseState(false);
  const toast = useToast();
  const chatEnd = lsUseRef(null);
  const videoBoxRef = lsUseRef(null);

  // Public watch link — no login; shows only the livestream + chat.
  // Prefer the PERMANENT per-org link (always shows whatever mission is currently
  // live) so the link never has to be regenerated; fall back to the per-flight
  // link. NOTE: f may be null (empty state) — keep everything here null-safe.
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const orgWatchKey = window.__poUser?.orgWatchKey;
  const permanent = !!orgWatchKey;
  const streamLink = orgWatchKey
    ? `${origin}/watch.html?org=${orgWatchKey}`
    : (f?.dbId && f?.shareKey) ? `${origin}/watch.html?f=${f.dbId}&k=${f.shareKey}` : `${origin}/`;
  const shareStream = async () => {
    const payload = { title: `Pilot Ops — ${f?.id} live`, text: `Live drone feed: ${f?.area}`, url: streamLink };
    try { if (navigator.share) { await navigator.share(payload); return; } } catch {}
    const msg = permanent
      ? "Permanent link — always shows your live mission. No login needed."
      : "Anyone with this link can watch — no login.";
    try { await navigator.clipboard.writeText(streamLink); toast({ kind: "success", title: "Public link copied", msg }); }
    catch { toast({ kind: "info", title: "Share link", msg: streamLink }); }
  };

  // Stream origin (same host as the feed) — used to derive the direct-ingest host.
  const gatewayBase = (() => {
    try { return new URL(import.meta.env.VITE_STREAM_URL || origin, origin).origin; }
    catch { return origin; }
  })();
  // Direct ingest (non-DJI / no app): per-flight RTMP/SRT publish URL + key.
  const streamHost = (() => { try { return new URL(gatewayBase).hostname; } catch { return "your-stream-host"; } })();
  const rtmpIngest = (f?.dbId && f?.ingestKey) ? `rtmp://${streamHost}:1935/${f.dbId}?key=${f.ingestKey}` : "";
  const srtIngest = (f?.dbId && f?.ingestKey) ? `srt://${streamHost}:8890?streamid=publish:${f.dbId}?key=${f.ingestKey}` : "";
  const copy = (text) => { try { navigator.clipboard?.writeText(text); toast({ kind: "success", title: "Copied", msg: "Paste into your encoder / ground station." }); } catch { toast({ kind: "info", title: "Copy", msg: text }); } };
  // Client-side recording: capture the live WHEP/HLS stream straight from the
  // <video> element and save the clip to the gallery the moment you press Stop —
  // no waiting for the mission to end. Survives navigation (stops + uploads on
  // unmount). Works for any viewer who can see the feed.
  const toggleRecord = async () => {
    if (!f?.dbId) return;
    if (mediaRecRef.current) { try { mediaRecRef.current.stop(); } catch {} return; } // stop → onstop uploads
    const video = videoBoxRef.current?.querySelector("video");
    const stream = video?.srcObject || (video?.captureStream ? video.captureStream() : null);
    if (!stream || !video?.videoWidth) { toast({ kind: "warn", title: "No live feed", msg: "Start casting before recording." }); return; }
    let rec;
    try {
      const mime = ["video/mp4;codecs=h264,aac", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
        .find(t => window.MediaRecorder?.isTypeSupported?.(t)) || "";
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch (e) { toast({ kind: "warn", title: "Recording unsupported", msg: e.message }); return; }
    recChunksRef.current = [];
    recStartRef.current = Date.now();
    rec.ondataavailable = (e) => { if (e.data && e.data.size) recChunksRef.current.push(e.data); };
    rec.onstop = async () => {
      mediaRecRef.current = null; setRecording(false);
      const chunks = recChunksRef.current; recChunksRef.current = [];
      if (!chunks.length) return;
      const mime = rec.mimeType || "video/webm";
      const ext = mime.includes("mp4") ? "mp4" : "webm";
      const blob = new Blob(chunks, { type: mime });
      const secs = Math.round((Date.now() - recStartRef.current) / 1000);
      const durStr = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
      const name = `${f.id}-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
      const path = `flights/${f.dbId}/recordings/${name}`;
      const { error: upErr } = await supabase.storage.from("media").upload(path, blob, { contentType: mime, upsert: true });
      if (upErr) { toast({ kind: "warn", title: "Recording not saved", msg: upErr.message }); return; }
      await supabase.from("media").insert({ storage_path: path, name, type: "video", flight_id: f.dbId, pilot_id: window.__poUser?.id || null, area: f.area, size: blob.size, duration: durStr });
      toast({ kind: "success", title: "Recording saved", msg: `${durStr} clip attached to ${f.id} in Media gallery.` });
    };
    rec.start(1000);
    mediaRecRef.current = rec; setRecording(true);
    toast({ kind: "info", title: "Recording started", msg: "Press Stop to save the clip to the gallery." });
  };
  const toggleFullscreen = () => {
    const el = videoBoxRef.current; if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  };
  // Only crew who can start/manage flights may end one (pilot, commander, admin…).
  const canEndFlight = !window.hasPerm || window.hasPerm("flight.create");

  lsUseEffect(() => {
    const t = setInterval(() => setDuration(d => d + 1), 1000);
    return () => clearInterval(t);
  }, []);

  lsUseEffect(() => {
    chatEnd.current?.parentElement?.scrollTo({ top: 1e6, behavior: "smooth" });
  }, [chat.length]);

  // Mission chat — load history and subscribe to realtime inserts for this flight.
  lsUseEffect(() => {
    if (!f?.dbId) return;
    let channel;
    const toMsg = (m) => ({
      from: m.sender_name || "Crew", role: m.sender_role || "ops", text: m.text,
      time: new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      color: "#2563eb",
      mine: !!(m.sender_id && window.__poUser?.id && m.sender_id === window.__poUser.id),
    });
    supabase.from("chat_messages").select("*").eq("flight_id", f.dbId).order("created_at")
      .then(({ data }) => setChat((data || []).map(toMsg)));
    const myKey = window.__poUser?.id || ("g-" + Math.random().toString(36).slice(2, 8));
    channel = supabase.channel("chat:" + f.dbId, { config: { presence: { key: myKey } } })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: "flight_id=eq." + f.dbId },
        (payload) => setChat((c) => [...c, toMsg(payload.new)]))
      .on("presence", { event: "sync" }, () => setOnline(Object.keys(channel.presenceState()).length))
      .subscribe(async (st) => { if (st === "SUBSCRIBED") await channel.track({ name: window.__poUser?.name || "Crew" }); });
    return () => { channel && supabase.removeChannel(channel); };
  }, [f?.dbId]);

  // If the viewer navigates away mid-recording, stop cleanly so the clip is still
  // saved to the gallery (onstop uploads it).
  lsUseEffect(() => () => { try { mediaRecRef.current?.stop(); } catch {} }, []);

  // Public viewer count — read the same realtime presence rooms the watch page
  // joins (per-flight + the org's permanent link). We only subscribe to read the
  // count; we don't track our own presence, so the pilot isn't counted as a viewer.
  lsUseEffect(() => {
    if (!f?.dbId) return;
    const orgKey = window.__poUser?.orgWatchKey;
    const rooms = [`watch-flight:${f.dbId}`, ...(orgKey ? [`watch-org:${orgKey}`] : [])];
    const counts = {};
    const update = () => setViewers(rooms.reduce((s, r) => s + (counts[r] || 0), 0));
    const channels = rooms.map((r) => {
      const ch = supabase.channel(r, { config: { presence: { key: "obs" } } });
      ch.on("presence", { event: "sync" }, () => { counts[r] = Object.keys(ch.presenceState()).length; update(); }).subscribe();
      return ch;
    });
    return () => { channels.forEach((ch) => { try { supabase.removeChannel(ch); } catch {} }); setViewers(0); };
  }, [f?.dbId]);

  // Show the CONTROLLER's location on the map (not this PC's). The GGIS UAV
  // Companion app streams the controller's GPS to the flight's cur_lat/cur_lng
  // while casting; we read it live here. The PC's browser location is no longer
  // written — it could be far from the field (e.g. an HQ desk).
  lsUseEffect(() => {
    if (!f?.dbId) return;
    let channel;
    supabase.from("flights").select("cur_lat, cur_lng").eq("id", f.dbId).maybeSingle()
      .then(({ data }) => { if (data && data.cur_lat != null) setPos({ lat: data.cur_lat, lng: data.cur_lng }); });
    channel = supabase.channel("flightpos:" + f.dbId)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "flights", filter: "id=eq." + f.dbId },
        (p) => {
          if (p.new?.cur_lat != null) setPos({ lat: p.new.cur_lat, lng: p.new.cur_lng });
          // The pilot in command ended (or flagged) the mission → end this live
          // view in sync for everyone else watching it (e.g. the co-pilot). The
          // guard stops the person who clicked End from double-handling.
          if ((p.new?.status === "completed" || p.new?.status === "flagged") && !endedRef.current) {
            endedRef.current = true;
            toast({ kind: "info", title: "Mission ended", msg: "The pilot in command ended this flight." });
            (async () => {
              try { await refresh(); } catch {}
              onEndFlight && onEndFlight({ ...f, status: p.new.status });
            })();
          }
        })
      .subscribe();
    return () => { channel && supabase.removeChannel(channel); };
  }, [f?.dbId]);

  const fmt = s => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`;
  };

  const send = async () => {
    if (!draft.trim() || !f?.dbId) { setDraft(""); return; }
    const text = draft.trim();
    setDraft("");
    // Realtime subscription appends it for everyone (including us).
    await supabase.from("chat_messages").insert({
      flight_id: f.dbId, sender_id: window.__poUser?.id || null,
      sender_name: window.__poUser?.name || "You", sender_role: "ops", text,
    });
  };

  const screenshot = () => {
    const video = videoBoxRef.current?.querySelector("video");
    if (!video || !video.videoWidth) { toast({ kind: "warn", title: "No live feed", msg: "Start casting before capturing a frame." }); return; }
    setFlash(true);
    setTimeout(() => setFlash(false), 220);
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    const ss = { id: "SS-" + Math.random().toString(36).slice(2, 6).toUpperCase(), time: fmt(duration), thumbUrl: canvas.toDataURL("image/jpeg", 0.5) };
    setScreenshots(s => [ss, ...s].slice(0, 6));
    // Save the full-res frame to storage + media gallery.
    canvas.toBlob(async (blob) => {
      if (!blob || !f?.dbId) return;
      const name = `${f.id}-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`;
      const path = `flights/${f.dbId}/screenshots/${name}`;
      const { error: upErr } = await supabase.storage.from("media").upload(path, blob, { contentType: "image/jpeg", upsert: true });
      if (upErr) { toast({ kind: "warn", title: "Screenshot not saved", msg: upErr.message }); return; }
      await supabase.from("media").insert({ storage_path: path, name, type: "photo", flight_id: f.dbId, pilot_id: window.__poUser?.id || null, area: f.area, size: blob.size });
      toast({ kind: "success", title: "Screenshot saved", msg: `Attached to ${f.id} in Media gallery.` });
    }, "image/jpeg", 0.9);
  };

  if (!f) return (
    <div className="main-content">
      <div className="page-head"><div><h1 className="page-title">Live stream</h1><div className="page-sub">Real-time mission feed</div></div></div>
      <div style={{ display: "grid", placeItems: "center", border: "1px dashed var(--border)", borderRadius: 12, minHeight: 460, background: "var(--bg-subtle)" }}>
        <div style={{ textAlign: "center", padding: 40 }}>
          <div style={{ width: 60, height: 60, borderRadius: "50%", background: "var(--bg-muted)", display: "grid", placeItems: "center", margin: "0 auto" }}>
            <Icon name="video" size={26} stroke="var(--text-4)"/>
          </div>
          <div style={{ marginTop: 14, fontSize: 16, fontWeight: 600, color: "var(--text-2)" }}>No active livestream</div>
          <div className="muted" style={{ fontSize: 13, marginTop: 6, maxWidth: 360 }}>
            Start a mission and have the pilot cast from the GGIS UAV Companion app — the live feed will appear here.
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="main-content" style={{ paddingBottom: 0 }}>
      {f.emergency && window.EmergencyFlightBanner && (
        <div style={{ margin: "-16px -16px 16px", borderRadius: 0 }}>
          <EmergencyFlightBanner flight={f} onComplete={onEndFlight}/>
        </div>
      )}
      <div className="page-head">
        <div>
          <div className="topbar-crumbs">
            <span>Flight Hub</span><Icon name="chev" size={12}/>
            <span style={{ color: "var(--text)" }}>{f.id} — Livestream</span>
          </div>
          <h1 className="page-title" style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 10 }}>
            {f.area}
            <span className="badge badge-live"><span className="dot"/>LIVE</span>
            <span className="badge" title="People watching the public share link now" style={{ fontWeight: 600 }}>👁 {viewers} watching</span>
          </h1>
          <div className="page-sub">
            Pilot {f.pilot?.name || "—"} · UAV {f.uav?.id || "—"} · Station {f.station?.name || "—"}
          </div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={shareStream}><Icon name="link" size={14}/> Share link</button>
          <button className="btn" onClick={() => { navigator.clipboard?.writeText(streamLink); toast({ kind: "success", title: "Link copied", msg: streamLink }); }}>
            <Icon name="paperclip" size={14}/> Copy URL
          </button>
          <button className="btn" onClick={() => setIngestOpen(true)} title="Stream from a non-DJI drone / encoder without the app"><Icon name="link" size={14}/> Direct ingest</button>
          <button className="btn btn-danger" onClick={() => setEndOpen(true)} disabled={!canEndFlight} title={canEndFlight ? "End the mission" : "Your role can't end missions"}><Icon name="stop" size={14}/> End flight</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: "var(--density-gap)" }}>
        {/* Video + telemetry */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--density-gap)" }}>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div ref={videoBoxRef} style={{ background: "#000", display: "grid", placeItems: "center" }}>
              <LiveVideoFeed showAnnotations={showAnnotations} flash={flash} duration={duration} flight={f} recording={recording}/>
            </div>
            {/* Video toolbar */}
            <div style={{ display: "flex", gap: 8, padding: "10px 14px", borderTop: "1px solid var(--border)", alignItems: "center", background: "var(--surface)" }}>
              <button className={"btn btn-sm " + (recording ? "btn-danger" : "")} onClick={toggleRecord}
                      title={recording ? "Stop and save this clip to the gallery" : "Record a clip to the gallery"}>
                {recording
                  ? <><span style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff", animation: "pulse 1.5s infinite" }}/> Stop</>
                  : <><span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--danger)" }}/> Record</>}
              </button>
              <button className="btn btn-sm btn-primary" onClick={screenshot}><Icon name="camera" size={13}/> Screenshot</button>
              <button className={"btn btn-sm " + (showAnnotations ? "btn-primary" : "")} onClick={() => setShowAnnotations(s => !s)}><Icon name="sparkle" size={12}/> AI overlay</button>
              <div className="vdivider" style={{ height: 22 }}/>
              <button className="btn btn-sm btn-ghost"><Icon name="layers" size={12}/> EO/IR</button>
              <button className="btn btn-sm btn-ghost"><Icon name="zoom" size={12}/> Zoom 1.0x</button>
              <div className="grow"/>
              <span className="mono tabular muted" style={{ fontSize: 12 }}>{fmt(duration)}</span>
              <button className="btn btn-sm btn-ghost" onClick={toggleFullscreen} title="Fullscreen"><Icon name="expand" size={12}/></button>
            </div>
          </div>

          {/* Telemetry strip */}
          <div className="grid-4">
            <TelemTile label="Altitude" value={f.altitude} unit="m AGL" icon="altitude" delta="+12" trend="up"/>
            <TelemTile label="Ground speed" value={f.speed.toFixed(1)} unit="m/s" icon="pulse"/>
            <TelemTile label="Signal" value={f.signal} unit="%" icon="signal" sub="LTE + RF backup"/>
            <TelemTile label="Battery" value={f.uav?.battery ?? "—"} unit="%" icon="battery" sub={f.uav?.battery != null ? `${Math.floor((f.uav.battery/100)*42)} min remaining` : "—"}/>
          </div>

          {/* Screenshots taken */}
          <div className="card">
            <div className="card-head">
              <div className="card-title">Screenshots this flight</div>
              <div className="muted" style={{ marginLeft: 6, fontSize: 12 }}>{screenshots.length} captured</div>
              <button className="btn btn-sm btn-ghost" style={{ marginLeft: "auto" }}>View all <Icon name="chev" size={12}/></button>
            </div>
            <div className="card-body">
              {screenshots.length === 0 && <div className="muted" style={{ fontSize: 12.5, padding: 8, textAlign: "center" }}>No screenshots yet — tap <strong>Screenshot</strong> on the feed to capture frames.</div>}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
                {screenshots.map(s => (
                  <div key={s.id} style={{ borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)", position: "relative", aspectRatio: "16/10", background: "#000" }}>
                    {s.thumbUrl && <img src={s.thumbUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>}
                    <div style={{ position: "absolute", bottom: 4, left: 4, fontSize: 9, color: "white", fontFamily: "var(--font-mono)", background: "rgba(0,0,0,0.4)", padding: "1px 4px", borderRadius: 3 }}>{s.time}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Chat + mini map */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--density-gap)", minHeight: 0 }}>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="card-head">
              <div className="card-title">Live position</div>
              <span className="badge badge-accent" style={{ marginLeft: "auto" }}><span className="dot"/>{f.pilot?.name || f.id}</span>
            </div>
            <MapCanvas basemap={basemap} pins={[{ lat: pos?.lat ?? f.lat, lng: pos?.lng ?? f.lng, x: 45, y: 40, kind: "drone", color: f.pilot?.color || "#2563eb", label: f.id }]} height={180} showLegend={false}/>
          </div>

          <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: 360, padding: 0 }}>
            <div className="card-head">
              <div className="card-title">Mission chat</div>
              <div className="row" style={{ marginLeft: "auto" }}>
                <span className="badge badge-success"><span className="dot"/>{online} online</span>
              </div>
            </div>
            <div style={{ flex: 1, padding: "8px 14px", overflowY: "auto", maxHeight: 360, display: "flex", flexDirection: "column", gap: 10 }}>
              {chat.map((m, i) => (
                <div key={i} style={{ display: "flex", gap: 8, flexDirection: m.mine ? "row-reverse" : "row" }}>
                  {!m.mine && (
                    <div style={{ width: 26, height: 26, borderRadius: 6, background: `linear-gradient(135deg, ${m.color}, color-mix(in oklab, ${m.color} 70%, #000))`, color: "white", display: "grid", placeItems: "center", fontSize: 10, fontWeight: 600, flexShrink: 0 }}>
                      {m.role === "ai" ? <Icon name="sparkle" size={12}/> : m.from.split(" ").map(w => w[0]).slice(0, 2).join("")}
                    </div>
                  )}
                  <div style={{ maxWidth: "80%", display: "flex", flexDirection: "column", alignItems: m.mine ? "flex-end" : "flex-start" }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexDirection: m.mine ? "row-reverse" : "row" }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{m.mine ? "You" : m.from}</span>
                      <span className="mono muted" style={{ fontSize: 10 }}>{m.time}</span>
                    </div>
                    <div style={{ fontSize: 12.5, lineHeight: 1.45, marginTop: 3, padding: "7px 10px", wordBreak: "break-word",
                                  borderRadius: m.mine ? "10px 10px 2px 10px" : "10px 10px 10px 2px",
                                  background: m.role === "ai" ? "color-mix(in oklab, #7c3aed 10%, var(--surface))" : m.mine ? "var(--accent)" : "var(--bg-muted)",
                                  color: m.mine ? "#fff" : "var(--text)",
                                  border: m.role === "ai" ? "1px solid color-mix(in oklab, #7c3aed 18%, transparent)" : "none" }}>
                      {m.text}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={chatEnd}/>
            </div>
            <div style={{ position: "relative", borderTop: "1px solid var(--border)", padding: 8, display: "flex", gap: 6, background: "var(--surface-2)", alignItems: "center" }}>
              {emojiOpen && (
                <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 8, width: 232, padding: 8, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "var(--shadow-md)", display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 2, zIndex: 20 }}>
                  {CHAT_EMOJIS.map(e => (
                    <button key={e} onClick={() => { setDraft(d => d + e); setEmojiOpen(false); }}
                      style={{ border: "none", background: "transparent", fontSize: 20, cursor: "pointer", borderRadius: 6, padding: 4, lineHeight: 1 }}
                      onMouseEnter={ev => ev.currentTarget.style.background = "var(--bg-muted)"}
                      onMouseLeave={ev => ev.currentTarget.style.background = "transparent"}>{e}</button>
                  ))}
                </div>
              )}
              <button className="btn btn-icon btn-ghost" onClick={() => setEmojiOpen(o => !o)} title="Emoji" style={{ fontSize: 16 }}>😊</button>
              <input className="input" placeholder="Message ops…" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === "Enter" && (setEmojiOpen(false), send())} onFocus={() => setEmojiOpen(false)} style={{ flex: 1 }}/>
              <button className="btn btn-primary btn-icon" onClick={send}><Icon name="send" size={14}/></button>
            </div>
          </div>
        </div>
      </div>

      {ingestOpen && (
        <Modal open onClose={() => setIngestOpen(false)} title="Direct drone ingest" subtitle="Stream a non-DJI drone / any encoder into this mission — no app needed" icon="link"
          footer={<button className="btn btn-primary" onClick={() => setIngestOpen(false)}>Done</button>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 13 }}>
            <div className="muted">While this mission is live, point any RTMP/SRT-capable encoder — OBS, ffmpeg, a hardware encoder, or a drone ground station — at the URL below. The feed shows up here and on the watch link exactly like the companion app.</div>
            <div className="field">
              <label className="field-label">RTMP URL</label>
              <div className="row" style={{ gap: 6 }}>
                <input className="input mono" readOnly value={rtmpIngest} onFocus={e => e.target.select()} style={{ flex: 1, fontSize: 11.5 }}/>
                <button className="btn" onClick={() => copy(rtmpIngest)}><Icon name="paperclip" size={13}/></button>
              </div>
            </div>
            <div className="field">
              <label className="field-label">SRT URL (lower latency)</label>
              <div className="row" style={{ gap: 6 }}>
                <input className="input mono" readOnly value={srtIngest} onFocus={e => e.target.select()} style={{ flex: 1, fontSize: 11.5 }}/>
                <button className="btn" onClick={() => copy(srtIngest)}><Icon name="paperclip" size={13}/></button>
              </div>
            </div>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
              <b>OBS-style split</b> — Server: <span className="mono">rtmp://{streamHost}:1935</span> · Stream key: <span className="mono">{f?.dbId}?key={f?.ingestKey}</span>
            </div>
            <div className="muted" style={{ fontSize: 11.5 }}>Keep this key private — it authorizes publishing to this mission. Each mission has its own key.</div>
          </div>
        </Modal>
      )}

      <Modal open={endOpen} onClose={() => setEndOpen(false)} title="End flight & generate summary" icon="check"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setEndOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={async () => {
              setEndOpen(false);
              endedRef.current = true; // we're ending it ourselves — ignore our own realtime echo
              // Actually end the mission in the DB so it leaves the active board.
              if (f?.dbId) {
                await supabase.from("flights").update({ status: "completed", ended_at: new Date().toISOString() }).eq("id", f.dbId);
                // In-app bell entry + real stakeholder "mission ended" email.
                supabase.from("notifications").insert({ type: "mission_end", payload: { flight: f.id, area: f.area } }).then(() => {}, () => {});
                try {
                  const token = (await supabase.auth.getSession()).data?.session?.access_token || "";
                  fetch(`${gatewayBase}/notify-flight`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ flightId: f.dbId, token, event: "end" }),
                  }).catch(() => {});
                } catch {}
                try { await refresh(); } catch {}
              }
              onEndFlight && onEndFlight(f);
            }}>
              <Icon name="check" size={13}/> End & email summary
            </button>
          </>
        }>
        <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>This will:</div>
        <ul style={{ paddingLeft: 18, lineHeight: 1.8, fontSize: 13 }}>
          <li>Save any in-progress recording clip to the media gallery</li>
          <li>Auto-generate the post-flight summary using the AI summarizer</li>
          <li>Email the summary + key screenshots to <strong>{STAKEHOLDERS.filter(s => s.notify.includes("summary")).length} stakeholders</strong></li>
          <li>Close the case and archive telemetry</li>
        </ul>
      </Modal>
    </div>
  );
}

function TelemTile({ label, value, unit, icon, delta, trend, sub }) {
  return (
    <div className="card" style={{ padding: 14, display: "flex", gap: 12, alignItems: "center" }}>
      <div style={{ width: 36, height: 36, borderRadius: 8, background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center", flexShrink: 0 }}>
        <Icon name={icon} size={16}/>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 500 }}>{label}</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 2 }}>
          <span style={{ fontSize: 18, fontWeight: 600, fontVariantNumeric: "tabular-nums" }} className="mono">{value}</span>
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>{unit}</span>
        </div>
        {sub && <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 2 }}>{sub}</div>}
        {delta && (
          <div style={{ fontSize: 10.5, color: trend === "up" ? "var(--success)" : "var(--danger)", marginTop: 2, display: "flex", alignItems: "center", gap: 2 }}>
            <Icon name={trend === "up" ? "arrowUp" : "arrowDown"} size={9}/> {delta}
          </div>
        )}
      </div>
    </div>
  );
}

function FakeVideoFeed({ showAnnotations, flash, duration, flight, recording }) {
  // Slow drifting scene built from gradients + ground patches + moving target
  const [tick, setTick] = lsUseState(0);
  lsUseEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 60);
    return () => clearInterval(t);
  }, []);

  const dx = Math.sin(tick * 0.014) * 30;
  const dy = Math.cos(tick * 0.011) * 18;

  return (
    <div style={{
      position: "relative",
      width: "100%",
      aspectRatio: "16/9",
      background: "linear-gradient(180deg, #2d3b2a 0%, #3d4d35 35%, #5a6a3a 70%, #6c7138 100%)",
      overflow: "hidden",
      cursor: "crosshair"
    }}>
      {/* Ground "terrain" via SVG */}
      <svg viewBox="0 0 800 450" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <defs>
          <radialGradient id="vignette" cx="50%" cy="50%" r="70%">
            <stop offset="60%" stopColor="black" stopOpacity="0"/>
            <stop offset="100%" stopColor="black" stopOpacity="0.5"/>
          </radialGradient>
          <pattern id="noise" width="4" height="4" patternUnits="userSpaceOnUse">
            <rect width="4" height="4" fill="#3d4d35"/>
            <circle cx="1" cy="1" r="0.5" fill="#475c39" opacity="0.6"/>
            <circle cx="3" cy="3" r="0.4" fill="#5a6a3a" opacity="0.8"/>
          </pattern>
        </defs>
        <g transform={`translate(${dx}, ${dy})`}>
          {/* fields */}
          <rect x="-100" y="100" width="1000" height="450" fill="url(#noise)"/>
          {/* Roads / paths */}
          <path d="M-50 280 Q 200 250, 400 280 T 850 290" stroke="#8a7a4e" strokeWidth="14" fill="none" opacity="0.85"/>
          <path d="M-50 280 Q 200 250, 400 280 T 850 290" stroke="#a8966a" strokeWidth="2" fill="none" strokeDasharray="20 12" opacity="0.7"/>
          {/* Buildings */}
          <g fill="#3a3530" stroke="#1f1c19" strokeWidth="1">
            <rect x="120" y="180" width="60" height="40"/>
            <rect x="190" y="170" width="40" height="50"/>
            <rect x="540" y="200" width="80" height="50"/>
            <rect x="630" y="195" width="50" height="55"/>
          </g>
          {/* Trees scattered */}
          {Array.from({ length: 28 }).map((_, i) => {
            const x = (i * 73) % 800;
            const y = 90 + ((i * 37) % 280);
            return <circle key={i} cx={x} cy={y} r={5 + (i % 4)} fill="#2a3a26" opacity="0.85"/>;
          })}
          {/* River */}
          <path d="M-50 400 Q 200 380, 400 410 T 850 405" stroke="#2c4a6a" strokeWidth="22" fill="none" opacity="0.7"/>
        </g>
        <rect width="800" height="450" fill="url(#vignette)"/>
      </svg>

      {/* AI annotations */}
      {showAnnotations && (
        <>
          <div style={{ position: "absolute", left: `${42 + Math.sin(tick * 0.04) * 4}%`, top: `${52 + Math.cos(tick * 0.05) * 3}%`, width: 80, height: 60, border: "2px solid #ef4444", borderRadius: 2 }}>
            <div style={{ position: "absolute", top: -22, left: -2, background: "#ef4444", color: "white", fontFamily: "var(--font-mono)", fontSize: 10, padding: "2px 6px", whiteSpace: "nowrap" }}>VEHICLE · 0.94</div>
          </div>
          <div style={{ position: "absolute", left: "20%", top: "30%", width: 50, height: 40, border: "2px solid #2563eb", borderRadius: 2 }}>
            <div style={{ position: "absolute", top: -22, left: -2, background: "#2563eb", color: "white", fontFamily: "var(--font-mono)", fontSize: 10, padding: "2px 6px", whiteSpace: "nowrap" }}>STRUCTURE · 0.88</div>
          </div>
          <div style={{ position: "absolute", left: "70%", top: "60%", width: 35, height: 35, border: "2px solid #f59e0b", borderRadius: "50%" }}>
            <div style={{ position: "absolute", top: -22, left: -2, background: "#f59e0b", color: "white", fontFamily: "var(--font-mono)", fontSize: 10, padding: "2px 6px", whiteSpace: "nowrap" }}>HEAT · 41°C</div>
          </div>
        </>
      )}

      {/* Crosshair / reticle */}
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} viewBox="0 0 100 100" preserveAspectRatio="none">
        <line x1="50" y1="0" x2="50" y2="100" stroke="white" strokeWidth="0.05" opacity="0.4" strokeDasharray="2 2"/>
        <line x1="0" y1="50" x2="100" y2="50" stroke="white" strokeWidth="0.05" opacity="0.4" strokeDasharray="2 2"/>
      </svg>

      {/* HUD overlay */}
      <div style={{ position: "absolute", inset: 0, padding: 14, color: "white", fontFamily: "var(--font-mono)", fontSize: 11, display: "flex", flexDirection: "column", justifyContent: "space-between", pointerEvents: "none", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {recording && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", animation: "pulse 1.5s infinite" }}/>}
              <span style={{ fontWeight: 700 }}>{recording ? "REC" : "PAUSE"}</span>
              <span>· {Math.floor(duration / 60)}:{String(duration % 60).padStart(2, "0")}</span>
            </div>
            <div>Pilot Ops · {flight.id}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div>ALT {flight.altitude}M · SPD {flight.speed}M/S</div>
            <div>{flight.lat.toFixed(4)}°N · {flight.lng.toFixed(4)}°E</div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>EO/IR · 1080p60 · 1.0×</div>
          <div>{flight.uav.id} · BATT {flight.uav.battery}% · SIG {flight.signal}%</div>
        </div>
      </div>

      {flash && <div style={{ position: "absolute", inset: 0, background: "white", opacity: 0.65, pointerEvents: "none" }}/>}
    </div>
  );
}

Object.assign(window, { LiveStreamView, FakeVideoFeed });
