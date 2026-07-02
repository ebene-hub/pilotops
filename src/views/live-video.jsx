import React from "react";
import { supabase } from "../api/supabase.js";
// Pilot Ops — real live video from the GGIS UAV Companion (controller screen cast).
// Plays the flight's MediaMTX stream over WebRTC (WHEP), HLS fallback, and the
// simulated FakeVideoFeed as a placeholder until the controller connects.
const { useState: lvUseState, useEffect: lvUseEffect, useRef: lvUseRef } = React;

const STREAM_BASE = (import.meta.env.VITE_STREAM_URL || "/stream").replace(/\/$/, "");
const HLS_BASE = (import.meta.env.VITE_STREAM_HLS_URL || "/hls").replace(/\/$/, "");
// Data-saver: refresh the snapshot preview this often (ms). The stream is a single
// encoding (no server transcode), so "low-res" = a periodic still instead of a
// continuous decode — ~90% less CPU/bandwidth for a secondary view.
const SAVER_INTERVAL = 6000;
// Target receiver buffer (ms). A small buffer (not zero) absorbs jitter/packet
// loss so poor connections stop freezing, while staying well under a second.
const JITTER_MS = Number(import.meta.env.VITE_STREAM_JITTER_MS) || 500;

async function accessToken() {
  try { const { data } = await supabase.auth.getSession(); return data?.session?.access_token || ""; }
  catch { return ""; }
}

// Minimal WHEP client: POST our SDP offer, apply the answer. MediaMTX serves
// WHEP at <base>/<path>/whep. WebRTC media then flows over UDP directly.
async function whepPlay(url, videoEl, token) {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });
  pc.ontrack = (e) => { if (videoEl && e.streams[0]) videoEl.srcObject = e.streams[0]; };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const res = await fetch(url + (token ? `?token=${encodeURIComponent(token)}` : ""), {
    method: "POST", headers: { "Content-Type": "application/sdp" }, body: offer.sdp,
  });
  if (!res.ok) { pc.close(); throw new Error("WHEP " + res.status); }
  const answer = await res.text();
  await pc.setRemoteDescription({ type: "answer", sdp: answer });
  // Small jitter buffer (not zero): smooths lossy/poor connections so the feed
  // stops freezing, while keeping glass-to-glass latency sub-second.
  pc.getReceivers().forEach((r) => { try { r.jitterBufferTarget = JITTER_MS; r.playoutDelayHint = JITTER_MS / 1000; } catch {} });
  return pc;
}

async function hlsPlay(url, videoEl, token) {
  const src = url + (token ? `?token=${encodeURIComponent(token)}` : "");
  if (videoEl.canPlayType("application/vnd.apple.mpegurl")) { videoEl.src = src; return { destroy() { videoEl.src = ""; } }; }
  const Hls = (await import("hls.js")).default;
  if (!Hls.isSupported()) throw new Error("HLS unsupported");
  const hls = new Hls({ lowLatencyMode: true, backBufferLength: 10 });
  hls.loadSource(src); hls.attachMedia(videoEl);
  return hls;
}

function LiveVideoFeed({ showAnnotations, flash, duration, flight, recording, placeholder, fill }) {
  const videoRef = lvUseRef(null);
  const canvasRef = lvUseRef(null);
  const [state, setState] = lvUseState("connecting"); // connecting | live | waiting
  const [saver, setSaver] = lvUseState(false);        // data-saver (snapshot) mode

  lvUseEffect(() => {
    let pc, hls, cancelled = false, retry, watchdog, stallTimer, saverTimer, whepFails = 0, preferHls = false;
    const video = videoRef.current;
    const id = flight?.dbId || flight?.id;
    if (!id || !video) return;

    function markLive() { if (cancelled) return; clearTimeout(watchdog); whepFails = 0; setState("live"); watchFrames(); }
    // After WebRTC fails repeatedly (UDP blocked / too lossy), prefer HLS, which
    // rides TCP/HTTPS and survives poor or restrictive networks.
    function failWhep() { if (++whepFails >= 2) preferHls = true; teardown(); schedule(); }
    // Silent-freeze watchdog. A WHEP session can stay "connected" yet stop
    // rendering new frames (packet loss leaves the decoder waiting for a keyframe),
    // so the picture freezes while connectionState never reports a problem. Watch
    // the video clock: if it stops advancing for ~4s while playing, reconnect
    // cleanly (same path the hard-drop case takes). Works for WHEP and HLS.
    function watchFrames() {
      if (stallTimer) return;                              // already watching
      let lastT = -1, stalls = 0;
      stallTimer = setInterval(() => {
        if (cancelled || !video || video.paused || video.ended) { stalls = 0; return; }
        const t = video.currentTime;
        if (t > lastT + 0.01) { lastT = t; stalls = 0; return; }  // progressing
        if (++stalls >= 4) { stalls = 0; teardown(); schedule(); } // frozen → reconnect
      }, 1000);
    }
    function schedule() { if (cancelled) return; setState("waiting"); clearTimeout(retry); retry = setTimeout(attempt, 3000); }
    function teardown() {
      clearTimeout(watchdog); clearInterval(stallTimer); stallTimer = null;
      try { pc && pc.close(); } catch {} try { hls && hls.destroy(); } catch {}
      pc = hls = null;
      if (video) { video.onplaying = null; video.srcObject = null; }
    }
    async function playHls(token) {
      try { hls = await hlsPlay(`${HLS_BASE}/${id}/index.m3u8`, video, token); video.onplaying = markLive; }
      catch { schedule(); }
    }
    async function attempt() {
      if (cancelled) return;
      const token = await accessToken();
      if (preferHls) return playHls(token);                // stay on the resilient path
      try {
        pc = await whepPlay(`${STREAM_BASE}/${id}/whep`, video, token);
        video.onplaying = markLive;                       // frames actually arrived
        pc.onconnectionstatechange = () => {
          if (cancelled) return;
          if (pc.connectionState === "connected") markLive();
          else if (["failed", "disconnected", "closed"].includes(pc.connectionState)) failWhep();
        };
        pc.oniceconnectionstatechange = () => { if (!cancelled && ["connected", "completed"].includes(pc.iceConnectionState)) markLive(); };
        // If a "successful" offer never actually plays within 7s, retry cleanly
        // (and count it toward escalating to HLS).
        watchdog = setTimeout(() => { if (!cancelled) failWhep(); }, 7000);
      } catch {
        if (++whepFails >= 2) preferHls = true;
        await playHls(token);
      }
    }

    // Data-saver: briefly connect, grab one frame to the canvas, disconnect, wait.
    // Sustained cost is near-zero (connected ~1s per SAVER_INTERVAL).
    async function snapshotLoop() {
      if (cancelled) return;
      const token = await accessToken();
      let localPc;
      try {
        localPc = await whepPlay(`${STREAM_BASE}/${id}/whep`, video, token);
        await new Promise((res) => { const t = setTimeout(res, 4500); video.onplaying = () => { clearTimeout(t); setTimeout(res, 350); }; });
        if (!cancelled && video.videoWidth && canvasRef.current) {
          const c = canvasRef.current; c.width = video.videoWidth; c.height = video.videoHeight;
          c.getContext("2d").drawImage(video, 0, 0);
          setState("live");
        }
      } catch {}
      try { localPc && localPc.close(); } catch {}
      if (video) { video.onplaying = null; video.srcObject = null; }
      if (!cancelled) saverTimer = setTimeout(snapshotLoop, SAVER_INTERVAL);
    }

    if (saver) { setState("connecting"); snapshotLoop(); }
    else attempt();
    return () => { cancelled = true; clearTimeout(retry); clearTimeout(saverTimer); teardown(); };
  }, [flight?.dbId, flight?.id, saver]);

  // Pause decoding while this window/tab is hidden or minimized, so a background
  // player doesn't compete for CPU/GPU with a visible one (and stops wasting
  // bandwidth). Resumes instantly when visible again. The freeze watchdog ignores
  // paused video, so this won't trigger a false reconnect.
  lvUseEffect(() => {
    const onVis = () => {
      const v = videoRef.current; if (!v) return;
      if (document.hidden) { try { v.pause(); } catch {} }
      else { v.play?.().catch(() => {}); }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const f = flight || {};
  const rootStyle = fill
    ? { position: "absolute", inset: 0, width: "100%", height: "100%", background: "#000", overflow: "hidden" }
    : { position: "relative", width: "100%", aspectRatio: "16/9", background: "#000", overflow: "hidden" };
  return (
    <div style={rootStyle}>
      {/* Custom placeholder (e.g. multi-screen tile) shows until the feed is live. */}
      {state !== "live" && placeholder}

      {/* contain — show the whole controller screen, letterboxed, never cropped.
          Hidden in data-saver mode (used only to grab periodic snapshots). */}
      <video ref={videoRef} autoPlay muted playsInline
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", display: (!saver && state === "live") ? "block" : "none", background: "#000" }}/>
      {/* Snapshot canvas — shown in data-saver mode. */}
      <canvas ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", display: (saver && state === "live") ? "block" : "none", background: "#000" }}/>

      {/* Data-saver toggle (bottom-right). */}
      <button onClick={() => setSaver(s => !s)}
        title={saver ? "Switch to smooth live video" : "Data saver — low-bandwidth snapshot preview (great for a secondary view)"}
        style={{ position: "absolute", bottom: fill ? 6 : 10, right: fill ? 6 : 10, zIndex: 4, border: "none", cursor: "pointer",
          background: saver ? "rgba(37,99,235,0.92)" : "rgba(0,0,0,0.55)", color: "#fff", borderRadius: 999,
          padding: fill ? "2px 7px" : "4px 10px", fontSize: fill ? 9 : 11, fontWeight: 600, display: "flex", alignItems: "center", gap: 5, backdropFilter: "blur(4px)" }}>
        {saver ? "⚡ Go live" : "🐢 Data saver"}
      </button>
      {saver && state === "live" && (
        <div style={{ position: "absolute", top: fill ? 8 : 12, right: fill ? 8 : 12, zIndex: 4, background: "rgba(37,99,235,0.9)", color: "#fff", borderRadius: 4, padding: fill ? "1px 5px" : "2px 7px", fontSize: fill ? 8.5 : 10, fontWeight: 700, letterSpacing: "0.03em", pointerEvents: "none" }}>
          DATA SAVER · snapshot
        </div>
      )}

      {/* Minimal overlay on the real feed: REC badge only while actually recording. */}
      {state === "live" && recording && (
        <div style={{ position: "absolute", top: fill ? 8 : 12, left: fill ? 8 : 12, display: "flex", gap: 6, alignItems: "center", color: "white", fontFamily: "var(--font-mono)", fontSize: fill ? 9 : 12, pointerEvents: "none", textShadow: "0 1px 2px rgba(0,0,0,0.7)" }}>
          <span style={{ width: fill ? 6 : 8, height: fill ? 6 : 8, borderRadius: "50%", background: "#ef4444", animation: "pulse 1.5s infinite" }}/>
          <span style={{ fontWeight: 700 }}>REC</span>
          {!fill && <span>· GGIS Companion · {f.id}</span>}
        </div>
      )}
      {flash && <div style={{ position: "absolute", inset: 0, background: "white", opacity: 0.65, pointerEvents: "none" }}/>}

      {/* Waiting state — clean, no simulated scene. */}
      {state !== "live" && !placeholder && (
        fill ? (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#64748b", fontFamily: "var(--font-mono)", fontSize: 9 }}>
            {state === "connecting" ? "Connecting…" : "No feed"}
          </div>
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
            <div style={{ textAlign: "center" }}>
              {window.Icon && <Icon name="video" size={30} stroke="#475569"/>}
              <div style={{ marginTop: 10, fontSize: 13, fontFamily: "var(--font-mono)", color: "#94a3b8", display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: state === "connecting" ? "#f59e0b" : "#64748b", animation: state === "connecting" ? "pulse 1.5s infinite" : "none" }}/>
                {state === "connecting" ? "Connecting to controller…" : "Waiting for controller feed"}
              </div>
            </div>
          </div>
        )
      )}
    </div>
  );
}

Object.assign(window, { LiveVideoFeed });
