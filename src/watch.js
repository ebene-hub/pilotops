// Pilot Ops — public live watch page (no login). Resolves a flight by share_key,
// plays the WebRTC feed, and shows read-only mission chat.
import { createClient } from "@supabase/supabase-js";

const sb = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const STREAM_BASE = (import.meta.env.VITE_STREAM_URL || "/stream").replace(/\/$/, "");

const params = new URLSearchParams(location.search);
// flightId/key are mutable: in permanent org mode they're resolved (and swapped)
// as missions go live/end. In per-flight mode they come straight from the URL.
let flightId = params.get("f") || "";
let key = params.get("k") || "";
const watchKey = params.get("org") || "";

const $ = (id) => document.getElementById(id);
const video = $("v"), waiting = $("waiting"), rec = $("rec"), liveBadge = $("liveBadge");

function fail(msg) {
  $("main").innerHTML = `<div class="err">${msg}</div>`;
}
function setLive(on) {
  video.style.display = on ? "block" : "none";
  waiting.style.display = on ? "none" : "grid";
  rec.classList.toggle("on", on);
  liveBadge.classList.toggle("on", on);
}
function setWaiting(text) { waiting.innerHTML = `<span class="dot"></span>${text}`; }

// Minimal WHEP client (same protocol as the in-app player).
async function whepPlay(url, el) {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });
  pc.ontrack = (e) => { if (e.streams[0]) el.srcObject = e.streams[0]; };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/sdp" }, body: offer.sdp });
  if (!res.ok) { pc.close(); throw new Error("WHEP " + res.status); }
  await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
  return pc;
}

let pc = null;
// Generation guard: bumping `gen` (on teardown / mission switch) cancels any
// in-flight connection + pending retry so we never reconnect to a stale flight.
let gen = 0;
function teardown() { gen++; if (pc) { try { pc.close(); } catch {} pc = null; } setLive(false); }
function connectStream() {
  const myGen = gen;
  whepPlay(`${STREAM_BASE}/${flightId}/whep?key=${encodeURIComponent(key)}`, video)
    .then((p) => {
      if (myGen !== gen) { try { p.close(); } catch {} return; }
      pc = p;
      p.onconnectionstatechange = () => {
        if (myGen !== gen) return;
        if (p.connectionState === "connected") setLive(true);
        else if (["failed", "disconnected", "closed"].includes(p.connectionState)) {
          setLive(false); setWaiting("Waiting for controller feed"); try { p.close(); } catch {}
          setTimeout(() => { if (myGen === gen) connectStream(); }, 4000);
        }
      };
    })
    .catch(() => {
      if (myGen !== gen) return;
      setLive(false); setWaiting("Waiting for controller feed");
      setTimeout(() => { if (myGen === gen) connectStream(); }, 4000);
    });
}

function relTime(ts) {
  const d = Date.now() - new Date(ts).getTime();
  if (d < 60000) return "just now";
  if (d < 3600000) return Math.floor(d / 60000) + "m";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function initials(name) { return (name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase(); }

function renderChat(msgs) {
  const box = $("msgs");
  if (!msgs.length) { box.innerHTML = '<div class="empty">No messages yet.</div>'; return; }
  box.innerHTML = msgs.map((m) => `
    <div class="msg ${m.role === "guest" ? "guest" : ""}">
      <div class="who">${escapeHtml(m.from || "Crew")}<span class="time">${relTime(m.at)}</span></div>
      <div class="text">${escapeHtml(m.text || "")}</div>
    </div>`).join("");
  box.scrollTop = box.scrollHeight;
}
async function pollChatOnce() {
  if (!flightId || !key) { renderChat([]); return; }
  const { data } = await sb.rpc("get_public_chat", { p_flight: flightId, p_key: key });
  if (data?.ok) renderChat(data.messages || []);
}
function chatLoop() { pollChatOnce().finally(() => setTimeout(chatLoop, 4000)); }

function nameFor() {
  let n = localStorage.getItem("po:watch:name") || "";
  if (!n) { n = (prompt("Your name to chat as:") || "").trim().slice(0, 40); if (n) localStorage.setItem("po:watch:name", n); }
  return n || "Guest";
}
function wireSend() {
  const form = $("sendForm"), input = $("chatinput"), btn = $("sendBtn");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    btn.disabled = true;
    const { data } = await sb.rpc("post_public_chat", { p_flight: flightId, p_key: key, p_name: nameFor(), p_text: text });
    btn.disabled = false;
    if (data?.ok) { input.value = ""; pollChatOnce(); }
  });
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// Permanent org link — follow whichever mission is currently live. Polls the
// active-mission resolver; switches the player + chat when a new mission goes
// live, and shows a waiting state (still polling) when the org is idle.
function orgMode() {
  let curFlight = null;
  async function tick() {
    const { data } = await sb.rpc("get_active_public_stream", { p_watch_key: watchKey });
    if (data?.ok) {
      if (data.flight !== curFlight) {
        curFlight = data.flight; flightId = data.flight; key = data.key;
        document.title = `${data.code || "Live"} · Pilot Ops`;
        $("meta").textContent = `${data.area || ""}${data.pilot ? " · " + data.pilot : ""}`;
        teardown(); setWaiting("Connecting to live mission…"); connectStream(); pollChatOnce();
      }
    } else if (data?.reason === "invalid") {
      return fail("This watch link is invalid.");
    } else if (curFlight || flightId) {
      curFlight = null; flightId = ""; key = "";
      teardown(); setWaiting("No active mission right now — this page goes live automatically when a mission starts.");
      $("meta").textContent = "Waiting for the next mission"; renderChat([]);
    } else {
      setWaiting("No active mission right now — this page goes live automatically when a mission starts.");
      $("meta").textContent = "Waiting for the next mission";
    }
    setTimeout(tick, 6000);
  }
  tick();
  chatLoop();
  wireSend();
}

(async () => {
  if (watchKey) return orgMode();
  if (!flightId || !key) return fail("Invalid link.");
  const { data, error } = await sb.rpc("get_public_stream", { p_flight: flightId, p_key: key });
  if (error || !data?.ok) return fail("This live link is invalid or has expired.");
  document.title = `${data.code || "Live"} · Pilot Ops`;
  $("meta").textContent = `${data.area || ""}${data.pilot ? " · " + data.pilot : ""}`;
  if (data.status !== "live") setWaiting("Mission not currently live");
  connectStream();
  chatLoop();
  wireSend();
})();
