// Pilot Ops — public live watch page (no login).
//  - ?f=<flightId>&k=<shareKey>  → a single mission.
//  - ?org=<watchKey>             → the org's permanent link: shows ALL currently
//    live missions as a multi-screen gallery, following them as they start/end.
// Plays WebRTC (WHEP) feeds and shows read-only + guest mission chat for the
// focused tile.
import { createClient } from "@supabase/supabase-js";

const sb = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const STREAM_BASE = (import.meta.env.VITE_STREAM_URL || "/stream").replace(/\/$/, "");

const params = new URLSearchParams(location.search);
const singleFlight = params.get("f") || "";
const singleKey = params.get("k") || "";
const watchKey = params.get("org") || "";

const $ = (id) => document.getElementById(id);
const grid = $("grid"), waiting = $("waiting"), liveBadge = $("liveBadge");

// Chat targets whichever tile is focused.
let flightId = "", key = "";

function fail(msg) { $("main").innerHTML = `<div class="err">${msg}</div>`; }
function setWaiting(text) {
  waiting.style.display = "grid";
  waiting.innerHTML = `<div class="inner"><span class="dot"></span>${text}</div>`;
}

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

// ---- Tiles (one per live mission) ------------------------------------------
const tiles = new Map(); // flightId -> { el, video, pc, gen, key, label }
let focusId = null;

function connectTile(t) {
  const myGen = ++t.gen;
  whepPlay(`${STREAM_BASE}/${t.flightId}/whep?key=${encodeURIComponent(t.key)}`, t.video)
    .then((p) => {
      if (myGen !== t.gen) { try { p.close(); } catch {} return; }
      t.pc = p;
      p.onconnectionstatechange = () => {
        if (myGen !== t.gen) return;
        if (p.connectionState === "connected") t.el.classList.add("live");
        else if (["failed", "disconnected", "closed"].includes(p.connectionState)) {
          t.el.classList.remove("live"); try { p.close(); } catch {}
          setTimeout(() => { if (myGen === t.gen) connectTile(t); }, 4000);
        }
      };
    })
    .catch(() => {
      if (myGen !== t.gen) return;
      t.el.classList.remove("live");
      setTimeout(() => { if (myGen === t.gen) connectTile(t); }, 4000);
    });
}

const MAX_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3"/></svg>`;

function addTile(s) {
  const el = document.createElement("div");
  el.className = "tile";
  el.innerHTML =
    `<video autoplay muted playsinline></video>` +
    `<div class="tile-wait"><span class="dot"></span>Connecting…</div>` +
    `<button class="tile-max" title="Maximize this feed" aria-label="Maximize this feed">${MAX_ICON}</button>` +
    `<div class="tile-label"><span class="livedot"></span><b>${escapeHtml(s.code || "Live")}</b>` +
    `<span class="area">${escapeHtml(s.area || "")}${s.pilot ? " · " + escapeHtml(s.pilot) : ""}</span></div>`;
  const t = { el, video: el.querySelector("video"), pc: null, gen: 0,
    flightId: s.flight, key: s.key, label: s.code || "Live" };
  el.addEventListener("click", () => setFocus(t.flightId));
  // Maximize just this feed (fullscreen the tile); don't also trigger focus.
  el.querySelector(".tile-max").addEventListener("click", (e) => {
    e.stopPropagation();
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  });
  tiles.set(s.flight, t);
  grid.appendChild(el);
  connectTile(t);
  return t;
}

function removeTile(id) {
  const t = tiles.get(id);
  if (!t) return;
  t.gen++; try { t.pc?.close(); } catch {}
  t.el.remove();
  tiles.delete(id);
}

function setFocus(id) {
  focusId = id;
  const t = id ? tiles.get(id) : null;
  for (const [fid, tt] of tiles) tt.el.classList.toggle("focused", fid === id);
  const head = document.querySelector(".chat-head h3");
  if (t) {
    flightId = t.flightId; key = t.key;
    document.title = `${t.label} · Pilot Ops`;
    if (head) head.textContent = tiles.size > 1 ? `Chat · ${t.label}` : "Mission chat";
    renderChat([]); pollChatOnce();
  } else {
    flightId = ""; key = "";
    if (head) head.textContent = "Mission chat";
    renderChat([]);
  }
}

function layoutGrid() {
  grid.classList.toggle("single", tiles.size <= 1);
  waiting.style.display = tiles.size ? "none" : "grid";
  liveBadge.classList.toggle("on", tiles.size > 0);
}

function setMeta(streams) {
  const n = streams.length;
  if (n === 0) { $("meta").textContent = "Waiting for the next mission"; return; }
  if (n === 1) { const s = streams[0]; $("meta").innerHTML = `<b>${escapeHtml(s.code || "Live")}</b> · ${escapeHtml(s.area || "")}${s.pilot ? " · " + escapeHtml(s.pilot) : ""}`; return; }
  $("meta").innerHTML = `<b>${n} missions live</b> · tap a feed to view its chat`;
}

// Reconcile the visible tiles against the current live set.
function syncTiles(streams) {
  const liveIds = new Set(streams.map((s) => s.flight));
  for (const id of [...tiles.keys()]) if (!liveIds.has(id)) removeTile(id);
  for (const s of streams) if (!tiles.has(s.flight)) addTile(s);
  if (!focusId || !tiles.has(focusId)) setFocus(streams[0] ? streams[0].flight : null);
  layoutGrid();
  setMeta(streams);
}

// ---- Chat (focused tile) ----------------------------------------------------
function relTime(ts) {
  const d = Date.now() - new Date(ts).getTime();
  if (d < 60000) return "just now";
  if (d < 3600000) return Math.floor(d / 60000) + "m";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
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
  const f = flightId, k = key;
  const { data } = await sb.rpc("get_public_chat", { p_flight: f, p_key: k });
  if (f === flightId && data?.ok) renderChat(data.messages || []);
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
    if (!text || !flightId) return;
    btn.disabled = true;
    const { data } = await sb.rpc("post_public_chat", { p_flight: flightId, p_key: key, p_name: nameFor(), p_text: text });
    btn.disabled = false;
    if (data?.ok) { input.value = ""; pollChatOnce(); }
  });
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// Teams-style controls: fullscreen + collapsible chat.
function wireUi() {
  const app = $("app");
  const stage = document.querySelector(".stage");
  $("btnFs")?.addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else (stage || app)?.requestFullscreen?.();
  });
  const toggleChat = () => {
    const hidden = app.classList.toggle("chat-hidden");
    $("btnChat")?.classList.toggle("active", !hidden);
  };
  $("btnChat")?.addEventListener("click", toggleChat);
  $("chatMin")?.addEventListener("click", toggleChat);
}

// ---- Org (permanent) mode: follow all live missions -------------------------
async function orgTick() {
  let streams;
  let { data, error } = await sb.rpc("get_active_public_streams", { p_watch_key: watchKey });
  if (error) {
    // Migration 0017 not applied yet — fall back to the single-stream resolver.
    const r = await sb.rpc("get_active_public_stream", { p_watch_key: watchKey });
    if (r.data?.reason === "invalid") return fail("This watch link is invalid.");
    streams = r.data?.ok ? [r.data] : [];
  } else {
    if (data?.reason === "invalid") return fail("This watch link is invalid.");
    streams = data?.streams || [];
  }
  if (!streams.length) setWaiting("No active mission right now — this page goes live automatically when a mission starts.");
  syncTiles(streams);
  setTimeout(orgTick, 6000);
}

// ---- init -------------------------------------------------------------------
wireUi();
wireSend();
chatLoop();

(async () => {
  if (watchKey) return orgTick();
  if (!singleFlight || !singleKey) return fail("Invalid link.");
  const { data, error } = await sb.rpc("get_public_stream", { p_flight: singleFlight, p_key: singleKey });
  if (error || !data?.ok) return fail("This live link is invalid or has expired.");
  syncTiles([{ flight: singleFlight, key: singleKey, code: data.code, area: data.area, pilot: data.pilot }]);
  if (data.status !== "live") setWaiting("Mission not currently live");
})();
