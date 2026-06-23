import React from "react";
import { supabase } from "../api/supabase.js";
import { watchPosition } from "../api/geo.js";
import { refresh } from "../store.jsx";
// Pilot Ops — Live Stream viewer (single pilot) — telemetry, chat, screenshot, AI annotations
const { useState: lsUseState, useEffect: lsUseEffect, useRef: lsUseRef } = React;

function LiveStreamView({ flight, basemap, setBasemap, onEndFlight }) {
  // Only show a flight that's actually live: the full store flight if it's still
  // active, else the passed flight if live, else the first active flight — else
  // nothing (empty state). Avoids rendering a stale/completed flight as "live".
  const active = window.ACTIVE_FLIGHTS || [];
  const f = active.find(x => x.dbId && x.dbId === flight?.dbId)
    || (flight && flight.status === "live" ? flight : null)
    || active[0]
    || null;
  const [duration, setDuration] = lsUseState(0);
  const [chat, setChat] = lsUseState([]);
  const [pos, setPos] = lsUseState(null);
  const [draft, setDraft] = lsUseState("");
  const [recording, setRecording] = lsUseState(true);
  const [showAnnotations, setShowAnnotations] = lsUseState(true);
  const [flash, setFlash] = lsUseState(false);
  const [screenshots, setScreenshots] = lsUseState([]);
  const [endOpen, setEndOpen] = lsUseState(false);
  const toast = useToast();
  const chatEnd = lsUseRef(null);
  const videoBoxRef = lsUseRef(null);

  // Public watch link — no login; shows only the livestream + chat.
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const streamLink = (f.dbId && f.shareKey)
    ? `${origin}/watch.html?f=${f.dbId}&k=${f.shareKey}`
    : `${origin}/`;
  const shareStream = async () => {
    const payload = { title: `Pilot Ops — ${f.id} live`, text: `Live drone feed: ${f.area}`, url: streamLink };
    try { if (navigator.share) { await navigator.share(payload); return; } } catch {}
    try { await navigator.clipboard.writeText(streamLink); toast({ kind: "success", title: "Public link copied", msg: "Anyone with this link can watch — no login." }); }
    catch { toast({ kind: "info", title: "Share link", msg: streamLink }); }
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
    });
    supabase.from("chat_messages").select("*").eq("flight_id", f.dbId).order("created_at")
      .then(({ data }) => setChat((data || []).map(toMsg)));
    channel = supabase.channel("chat:" + f.dbId)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: "flight_id=eq." + f.dbId },
        (payload) => setChat((c) => [...c, toMsg(payload.new)]))
      .subscribe();
    return () => { channel && supabase.removeChannel(channel); };
  }, [f?.dbId]);

  // Stream the pilot's real device position to the flight row while live.
  lsUseEffect(() => {
    if (!f?.dbId) return;
    let last = 0;
    const stop = watchPosition((p) => {
      setPos({ lat: p.lat, lng: p.lng });
      const now = Date.now();
      if (now - last > 5000) { last = now; supabase.from("flights").update({ cur_lat: p.lat, cur_lng: p.lng }).eq("id", f.dbId); }
    });
    return stop;
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
              <button className="btn btn-sm" onClick={() => setRecording(!recording)}>
                {recording ? <><span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--danger)" }}/> Recording</> : <><Icon name="play" size={12}/> Paused</>}
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
                <span className="badge badge-success"><span className="dot"/>5 online</span>
              </div>
            </div>
            <div style={{ flex: 1, padding: "8px 14px", overflowY: "auto", maxHeight: 360, display: "flex", flexDirection: "column", gap: 10 }}>
              {chat.map((m, i) => (
                <div key={i} style={{ display: "flex", gap: 8 }}>
                  <div style={{ width: 26, height: 26, borderRadius: 6, background: `linear-gradient(135deg, ${m.color}, color-mix(in oklab, ${m.color} 70%, #000))`, color: "white", display: "grid", placeItems: "center", fontSize: 10, fontWeight: 600, flexShrink: 0 }}>
                    {m.role === "ai" ? <Icon name="sparkle" size={12}/> : m.from.split(" ").map(w => w[0]).slice(0, 2).join("")}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{m.from}</span>
                      <span className="mono muted" style={{ fontSize: 10 }}>{m.time}</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.45, marginTop: 2,
                                  background: m.role === "ai" ? "color-mix(in oklab, #7c3aed 8%, var(--surface))" : "transparent",
                                  border: m.role === "ai" ? "1px solid color-mix(in oklab, #7c3aed 18%, transparent)" : "none",
                                  padding: m.role === "ai" ? "6px 8px" : 0,
                                  borderRadius: 6 }}>
                      {m.text}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={chatEnd}/>
            </div>
            <div style={{ borderTop: "1px solid var(--border)", padding: 8, display: "flex", gap: 6, background: "var(--surface-2)" }}>
              <input className="input" placeholder="Message ops…" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} style={{ flex: 1 }}/>
              <button className="btn btn-primary btn-icon" onClick={send}><Icon name="send" size={14}/></button>
            </div>
          </div>
        </div>
      </div>

      <Modal open={endOpen} onClose={() => setEndOpen(false)} title="End flight & generate summary" icon="check"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setEndOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={async () => {
              setEndOpen(false);
              // Actually end the mission in the DB so it leaves the active board.
              if (f?.dbId) {
                await supabase.from("flights").update({ status: "completed", ended_at: new Date().toISOString() }).eq("id", f.dbId);
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
          <li>Stop recording and seal the video to encrypted cloud storage</li>
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
