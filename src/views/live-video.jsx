import React from "react";
import { supabase } from "../api/supabase.js";
// Pilot Ops — real live video from the GGIS UAV Companion (controller screen cast).
// Plays the flight's MediaMTX stream over WebRTC (WHEP), HLS fallback, and the
// simulated FakeVideoFeed as a placeholder until the controller connects.
const { useState: lvUseState, useEffect: lvUseEffect, useRef: lvUseRef } = React;

const STREAM_BASE = (import.meta.env.VITE_STREAM_URL || "/stream").replace(/\/$/, "");
const HLS_BASE = (import.meta.env.VITE_STREAM_HLS_URL || "/hls").replace(/\/$/, "");

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
  // Minimise the receiver playout/jitter buffer for live ops — trade a little
  // smoothing for ~hundreds of ms lower glass-to-glass latency.
  pc.getReceivers().forEach((r) => { try { r.playoutDelayHint = 0; r.jitterBufferTarget = 0; } catch {} });
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
  const [state, setState] = lvUseState("connecting"); // connecting | live | waiting

  lvUseEffect(() => {
    let pc, hls, cancelled = false, retry, watchdog;
    const video = videoRef.current;
    const id = flight?.dbId || flight?.id;
    if (!id || !video) return;

    function markLive() { if (cancelled) return; clearTimeout(watchdog); setState("live"); }
    function schedule() { if (cancelled) return; setState("waiting"); clearTimeout(retry); retry = setTimeout(attempt, 3000); }
    function teardown() {
      clearTimeout(watchdog);
      try { pc && pc.close(); } catch {} try { hls && hls.destroy(); } catch {}
      pc = hls = null;
      if (video) { video.onplaying = null; video.srcObject = null; }
    }
    async function attempt() {
      if (cancelled) return;
      const token = await accessToken();
      try {
        pc = await whepPlay(`${STREAM_BASE}/${id}/whep`, video, token);
        video.onplaying = markLive;                       // frames actually arrived
        pc.onconnectionstatechange = () => {
          if (cancelled) return;
          if (pc.connectionState === "connected") markLive();
          else if (["failed", "disconnected", "closed"].includes(pc.connectionState)) { teardown(); schedule(); }
        };
        pc.oniceconnectionstatechange = () => { if (!cancelled && ["connected", "completed"].includes(pc.iceConnectionState)) markLive(); };
        // If a "successful" offer never actually plays within 7s, retry cleanly
        // (avoids getting stuck waiting — no manual refresh needed).
        watchdog = setTimeout(() => { if (!cancelled) { teardown(); schedule(); } }, 7000);
      } catch {
        try { hls = await hlsPlay(`${HLS_BASE}/${id}/index.m3u8`, video, token); video.onplaying = markLive; }
        catch { schedule(); }
      }
    }

    attempt();
    return () => { cancelled = true; clearTimeout(retry); teardown(); };
  }, [flight?.dbId, flight?.id]);

  const f = flight || {};
  const rootStyle = fill
    ? { position: "absolute", inset: 0, width: "100%", height: "100%", background: "#000", overflow: "hidden" }
    : { position: "relative", width: "100%", aspectRatio: "16/9", background: "#000", overflow: "hidden" };
  return (
    <div style={rootStyle}>
      {/* Custom placeholder (e.g. multi-screen tile) shows until the feed is live. */}
      {state !== "live" && placeholder}

      {/* contain — show the whole controller screen, letterboxed, never cropped. */}
      <video ref={videoRef} autoPlay muted playsInline
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", display: state === "live" ? "block" : "none", background: "#000" }}/>

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
