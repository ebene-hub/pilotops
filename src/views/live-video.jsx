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
    let pc, hls, cancelled = false, retry;
    const video = videoRef.current;
    const id = flight?.dbId || flight?.id;
    if (!id || !video) return;

    async function attempt() {
      if (cancelled) return;
      const token = await accessToken();
      try {
        pc = await whepPlay(`${STREAM_BASE}/${id}/whep`, video, token);
        wireConnState(pc);
      } catch {
        try { hls = await hlsPlay(`${HLS_BASE}/${id}/index.m3u8`, video, token); markLive(); }
        catch { schedule(); }
      }
    }
    function wireConnState(p) {
      p.onconnectionstatechange = () => {
        if (cancelled) return;
        if (p.connectionState === "connected") markLive();
        else if (["failed", "disconnected", "closed"].includes(p.connectionState)) { teardown(); schedule(); }
      };
    }
    function markLive() { if (!cancelled) setState("live"); }
    function schedule() { if (cancelled) return; setState("waiting"); retry = setTimeout(attempt, 4000); }
    function teardown() { try { pc && pc.close(); } catch {} try { hls && hls.destroy(); } catch {} pc = hls = null; if (video) video.srcObject = null; }

    attempt();
    return () => { cancelled = true; clearTimeout(retry); teardown(); };
  }, [flight?.dbId, flight?.id]);

  const f = flight || {};
  const rootStyle = fill
    ? { position: "absolute", inset: 0, width: "100%", height: "100%", background: "#0b0f17", overflow: "hidden" }
    : { position: "relative", width: "100%", aspectRatio: "16/9", background: "#0b0f17", overflow: "hidden" };
  const fallback = placeholder || (window.FakeVideoFeed
    ? <FakeVideoFeed showAnnotations={showAnnotations} flash={flash} duration={duration} flight={f} recording={recording}/>
    : null);
  return (
    <div style={rootStyle}>
      {/* The simulated scene stays as the placeholder until the controller connects. */}
      {state !== "live" && fallback}

      <video ref={videoRef} autoPlay muted playsInline
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: state === "live" ? "block" : "none", background: "#000" }}/>

      {/* HUD + connection state overlay on the real feed. */}
      {state === "live" && !fill && (
        <div style={{ position: "absolute", inset: 0, padding: 14, color: "white", fontFamily: "var(--font-mono)", fontSize: 11, display: "flex", flexDirection: "column", justifyContent: "space-between", pointerEvents: "none", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {recording && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444" }}/>}
              <span style={{ fontWeight: 700 }}>{recording ? "REC" : "LIVE"}</span>
              <span>· GGIS Companion · {f.id}</span>
            </div>
            <div style={{ textAlign: "right" }}>
              <div>ALT {f.altitude}M · SPD {f.speed}M/S</div>
              {f.lat != null && f.lng != null && <div>{Number(f.lat).toFixed(4)}°N · {Number(f.lng).toFixed(4)}°E</div>}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <div>Controller mirror · WebRTC</div>
            <div>{f.uav?.id || "—"} · BATT {f.uav?.battery ?? "—"}% · SIG {f.signal}%</div>
          </div>
        </div>
      )}
      {flash && <div style={{ position: "absolute", inset: 0, background: "white", opacity: 0.65, pointerEvents: "none" }}/>}

      {/* Compact LIVE badge for multi-screen tiles. */}
      {state === "live" && fill && (
        <div style={{ position: "absolute", top: 8, left: 8, display: "flex", alignItems: "center", gap: 5, background: "rgba(11,15,23,0.7)", color: "white", padding: "2px 7px", borderRadius: 999, fontSize: 9, fontFamily: "var(--font-mono)" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444" }}/> LIVE
        </div>
      )}

      {/* "Waiting" chip while the controller hasn't started casting. */}
      {state !== "live" && (
        <div style={{ position: "absolute", top: fill ? 8 : 12, left: fill ? 8 : 12, display: "flex", alignItems: "center", gap: fill ? 5 : 8, background: "rgba(11,15,23,0.78)", color: "white", padding: fill ? "2px 7px" : "5px 10px", borderRadius: 999, fontSize: fill ? 9 : 11.5, fontFamily: "var(--font-mono)" }}>
          <span style={{ width: fill ? 6 : 8, height: fill ? 6 : 8, borderRadius: "50%", background: state === "connecting" ? "#f59e0b" : "#64748b", animation: state === "connecting" ? "pulse 1.5s infinite" : "none" }}/>
          {state === "connecting" ? (fill ? "Connecting…" : "Connecting to controller…") : (fill ? "No feed" : "Waiting for controller feed")}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { LiveVideoFeed });
