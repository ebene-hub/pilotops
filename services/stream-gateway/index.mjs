// Pilot Ops — stream gateway.
//
// Sits between MediaMTX and Supabase:
//   POST /auth   — MediaMTX external auth: validate the Supabase JWT in ?token=,
//                  check the flight + org, allow/deny (and flip stream live).
//   reconcile()  — polls the MediaMTX API to flip flights back to 'offline' when
//                  their controller disconnects (works with the scratch MediaMTX
//                  image, which has no shell/curl for runOn* hooks).
//   scanRecordings() — watches the shared recordings folder and uploads finished
//                  casts to Storage + attaches them to the flight (media row).
//   POST /unpublish, /recording-complete — kept as hook fallbacks if available.
//
// Uses the SERVICE ROLE key (server-side only — never shipped to a browser).
import express from "express";
import nodemailer from "nodemailer";
import { readFile, readdir, stat, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PORT = Number(process.env.PORT || 9000);
const MEDIA_BUCKET = process.env.MEDIA_BUCKET || "media";
const MEDIAMTX_API = (process.env.MEDIAMTX_API_URL || "http://mediamtx:9997").replace(/\/$/, "");
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || "/recordings";
const POLL_MS = Number(process.env.POLL_MS || 5000);
// Skip uploading recordings larger than this (Supabase Storage per-file limit is
// ~50MB by default). Oversized files are left on disk, not retried — buffering
// huge files into RAM on every scan was crashing the gateway in a loop.
const RECORDING_MAX_BYTES = Number(process.env.RECORDING_MAX_MB || 45) * 1024 * 1024;
// Safety net: purge local recordings older than this so the disk can't fill.
// Clips that uploaded are already deleted; this only reaps the leftover
// (oversized/failed) files after a window long enough to retrieve them.
const RECORDING_RETENTION_DAYS = Number(process.env.RECORDING_RETENTION_DAYS || 7);
// Email. Per-org config (org_email_settings) wins; otherwise the server-wide
// fallback below is used. Set EITHER a global SMTP server (SMTP_HOST…) or a global
// Resend key. With neither configured (and no org config), email endpoints no-op.
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const MAIL_FROM = process.env.MAIL_FROM || "Pilot Ops <onboarding@resend.dev>";
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || (SMTP_PORT === 465 ? "true" : "false")) === "true";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";

if (!URL || !SERVICE_KEY) {
  console.error("stream-gateway: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(1);
}

// A stray rejection (e.g. a recording upload error) must never take the whole
// gateway down — log and keep serving.
process.on("unhandledRejection", (e) => console.log(new Date().toISOString(), "unhandledRejection", e?.message || String(e)));
process.on("uncaughtException", (e) => console.log(new Date().toISOString(), "uncaughtException", e?.message || String(e)));

const admin = createClient(URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// CORS for the browser-facing endpoints (the Pilot Ops web app toggling
// recording). Auth is by token in the body/query, not cookies, so reflecting the
// origin is safe. Harmless for the native/server callers (/grant, /auth).
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const tokenFromQuery = (q) => {
  try { return new URLSearchParams(q || "").get("token") || ""; } catch { return ""; }
};
const keyFromQuery = (q) => {
  try { return new URLSearchParams(q || "").get("key") || ""; } catch { return ""; }
};
const log = (...a) => console.log(new Date().toISOString(), ...a);
const flipLive = (id) => admin.from("flights").update({ stream_status: "live", stream_started_at: new Date().toISOString() }).eq("id", id);

// Short-lived publish grants. RTMP clients (RootEncoder) drop the URL query, so
// the token can't ride in the stream URL; instead the app POSTs /grant over
// HTTPS first, and we authorise the subsequent RTMP publish by that grant.
const grants = new Map(); // flightId -> timestamp
const GRANT_TTL = Number(process.env.GRANT_TTL_MS || 300000); // 5 min

// Validate that `token` may publish `flightId` (live flight, same org, crew/admin).
async function validatePublisher(token, flightId) {
  if (!token || !flightId) return { ok: false, reason: "missing" };
  const { data: u } = await admin.auth.getUser(token);
  const user = u?.user;
  if (!user) return { ok: false, reason: "bad token" };
  const [{ data: flight }, { data: profile }] = await Promise.all([
    admin.from("flights").select("id, org_id, status, pilot_id").eq("id", flightId).maybeSingle(),
    admin.from("profiles").select("org_id, is_admin").eq("id", user.id).maybeSingle(),
  ]);
  if (!flight || !profile) return { ok: false, reason: "unknown flight/profile" };
  if (flight.org_id !== profile.org_id) return { ok: false, reason: "cross-org" };
  if (flight.status !== "live") return { ok: false, reason: "not live" };
  let crew = flight.pilot_id === user.id;
  if (!crew) {
    const { data } = await admin.from("flight_crew").select("profile_id").eq("flight_id", flightId).eq("profile_id", user.id).limit(1);
    crew = (data || []).length > 0;
  }
  if (!crew && !profile.is_admin) return { ok: false, reason: "not crew" };
  return { ok: true };
}

// ---- App pre-authorises a cast (over HTTPS) before pushing RTMP -------------
app.post("/grant", async (req, res) => {
  const flightId = (req.body?.flightId || "").trim();
  const token = (req.body?.token || "").trim() || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const v = await validatePublisher(token, flightId);
  if (!v.ok) { log("grant deny", { flightId, reason: v.reason }); return res.status(401).json({ ok: false, reason: v.reason }); }
  grants.set(flightId, Date.now());
  log("grant ok", { flightId });
  res.sendStatus(200);
});

// ---- Per-mission recording toggle -------------------------------------------
// Recording is OFF by default (pathDefaults record:no). The Pilot Ops web app
// flips it per flight; we add/patch a MediaMTX path config (path = flight id)
// with record on/off so only chosen missions are saved.
async function setPathRecord(name, enable) {
  const body = JSON.stringify({ record: !!enable });
  const opts = { method: "PATCH", headers: { "Content-Type": "application/json" }, body };
  let r = await fetch(`${MEDIAMTX_API}/v3/config/paths/patch/${encodeURIComponent(name)}`, opts);
  if (r.status === 404 || r.status === 400) {
    r = await fetch(`${MEDIAMTX_API}/v3/config/paths/add/${encodeURIComponent(name)}`,
      { ...opts, method: "POST" });
  }
  if (!r.ok) throw new Error(`mediamtx ${r.status}`);
}
async function getPathRecord(name) {
  try {
    const r = await fetch(`${MEDIAMTX_API}/v3/config/paths/get/${encodeURIComponent(name)}`);
    if (!r.ok) return false; // no path-specific config → defaults (record:no)
    const j = await r.json();
    return !!j.record;
  } catch { return false; }
}

app.post("/record", async (req, res) => {
  const flightId = (req.body?.flightId || "").trim();
  const token = (req.body?.token || "").trim() || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const enable = !!req.body?.enable;
  const v = await validatePublisher(token, flightId);
  if (!v.ok) return res.status(401).json({ ok: false, reason: v.reason });
  try { await setPathRecord(flightId, enable); }
  catch (e) { log("record toggle failed", { flightId, enable, err: e.message }); return res.status(502).json({ ok: false, reason: "recorder unavailable" }); }
  log("record", { flightId, enable });
  res.json({ ok: true, recording: enable });
});

app.get("/record", async (req, res) => {
  const flightId = (req.query?.flightId || "").toString().trim();
  const token = (req.query?.token || "").toString().trim();
  const v = await validatePublisher(token, flightId);
  if (!v.ok) return res.status(401).json({ ok: false, reason: v.reason });
  res.json({ ok: true, recording: await getPathRecord(flightId) });
});

// ---- Email (Resend) ---------------------------------------------------------
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fromStr = (name, email) => email ? (name ? `${name} <${email}>` : email) : "";

// Resolve which mail transport to use for an org: its own active config first,
// then the server-wide fallback (global SMTP, else global Resend). Returns null
// when nothing is configured.
async function transportForOrg(orgId) {
  if (orgId) {
    const { data: s } = await admin.from("org_email_settings").select("*").eq("org_id", orgId).maybeSingle();
    if (s && s.active) {
      const from = fromStr(s.from_name, s.from_email);
      if (s.provider === "smtp" && s.smtp_host) {
        return { kind: "smtp", from: from || MAIL_FROM, host: s.smtp_host, port: s.smtp_port || 587,
          secure: s.smtp_secure !== false, user: s.smtp_username || "", pass: s.smtp_password || "" };
      }
      if (s.provider === "resend" && s.resend_api_key) {
        return { kind: "resend", from: from || MAIL_FROM, key: s.resend_api_key };
      }
    }
  }
  if (SMTP_HOST) return { kind: "smtp", from: MAIL_FROM, host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_SECURE, user: SMTP_USER, pass: SMTP_PASS };
  if (RESEND_API_KEY) return { kind: "resend", from: MAIL_FROM, key: RESEND_API_KEY };
  return null;
}

async function resendSend(tp, to, subject, html, attachments) {
  const body = { from: tp.from, to, subject, html };
  if (attachments?.length) body.attachments = attachments.map((a) => ({ filename: a.filename, path: a.url }));
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${tp.key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`resend ${r.status} ${(await r.text().catch(() => "")).slice(0, 140)}`);
}

// Send one email per recipient (so stakeholders never see each other's address).
// Uses the org's transport, falling back to the server default. `attachments` is
// an optional [{filename, url}] the transport fetches. Returns {ok,sent}.
async function sendEmailEach(orgId, recipients, subject, html, attachments) {
  const tp = await transportForOrg(orgId);
  if (!tp) { log("email skipped — no transport configured", { orgId }); return { ok: false, sent: 0, reason: "email not configured" }; }
  const list = [...new Set((recipients || []).map((e) => (e || "").trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))].slice(0, 100);
  if (!list.length) return { ok: false, sent: 0, reason: "no valid recipients" };
  const smtpAtt = (attachments || []).map((a) => ({ filename: a.filename, path: a.url }));
  let smtp = null;
  if (tp.kind === "smtp") {
    smtp = nodemailer.createTransport({ host: tp.host, port: tp.port, secure: tp.secure, auth: tp.user ? { user: tp.user, pass: tp.pass } : undefined });
  }
  let sent = 0;
  for (const to of list) {
    try {
      if (tp.kind === "resend") await resendSend(tp, to, subject, html, attachments);
      else await smtp.sendMail({ from: tp.from, to, subject, html, attachments: smtpAtt });
      sent++;
    } catch (e) { log("email send failed", e.message); }
  }
  try { smtp?.close(); } catch {}
  return { ok: sent > 0, sent };
}

// Validate the caller is a member of the flight's org (lighter than the publish
// check — any signed-in org member may trigger notices for their org's flight).
async function memberForFlight(token, flightId) {
  if (!token || !flightId) return { ok: false };
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user) return { ok: false };
  const [{ data: flight }, { data: profile }] = await Promise.all([
    admin.from("flights").select("id, code, area, org_id, status, started_at, ended_at, pilot_id").eq("id", flightId).maybeSingle(),
    admin.from("profiles").select("org_id, full_name").eq("id", u.user.id).maybeSingle(),
  ]);
  if (!flight || !profile || flight.org_id !== profile.org_id) return { ok: false };
  return { ok: true, flight, userName: profile.full_name };
}

const brandWrap = (title, bodyHtml) => `<!doctype html><html><body style="margin:0;background:#f4f6fb;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0b1220">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e6e8ee">
    <div style="background:linear-gradient(135deg,#2563eb,#1d4ed8);padding:20px 24px;color:#fff">
      <div style="font-weight:700;font-size:15px;letter-spacing:.2px">Pilot Ops</div>
      <div style="font-size:12px;opacity:.85;margin-top:2px">${esc(title)}</div>
    </div>
    <div style="padding:22px 24px;font-size:14px;line-height:1.6">${bodyHtml}</div>
    <div style="padding:14px 24px;background:#f7f8fa;border-top:1px solid #e6e8ee;font-size:11px;color:#7a8294">
      You're receiving this because you're a registered stakeholder. Sent automatically by Pilot Ops.
    </div>
  </div></body></html>`;

function flightEmailHtml(f, isStart, byName) {
  const code = f.code || (f.id ? f.id.slice(0, 8) : "—");
  const when = new Date(isStart ? (f.started_at || Date.now()) : (f.ended_at || Date.now())).toLocaleString();
  const rows = [
    ["Mission", code],
    ["Area", f.area || "—"],
    [isStart ? "Started" : "Ended", when],
  ];
  if (isStart && byName) rows.push(["Pilot in command", byName]);
  const table = rows.map(([k, v]) => `<tr><td style="padding:6px 0;color:#5b6479;width:150px">${esc(k)}</td><td style="padding:6px 0;font-weight:600">${esc(v)}</td></tr>`).join("");
  const lead = isStart
    ? `A mission has just <strong>started</strong> and is now live.`
    : `A mission has <strong>ended</strong>. A post-flight summary may follow.`;
  return brandWrap(isStart ? "Mission started" : "Mission ended",
    `<p style="margin:0 0 14px">${lead}</p><table style="width:100%;border-collapse:collapse;font-size:13px">${table}</table>`);
}

// Mission lifecycle notice → stakeholders who opted into 'pre-flight' notices.
app.post("/notify-flight", async (req, res) => {
  const flightId = (req.body?.flightId || "").trim();
  const token = (req.body?.token || "").trim() || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const event = (req.body?.event || "start").toString();
  const m = await memberForFlight(token, flightId);
  if (!m.ok) return res.status(401).json({ ok: false, reason: "unauthorized" });
  const f = m.flight;
  const { data: stk } = await admin.from("stakeholders").select("email, notify").eq("org_id", f.org_id);
  const recipients = (stk || []).filter((s) => s.email && (s.notify || []).includes("pre-flight")).map((s) => s.email);
  if (!recipients.length) { log("notify-flight: no opted-in stakeholders", { flightId, event }); return res.json({ ok: true, sent: 0 }); }
  const isStart = event !== "end";
  const code = f.code || f.id.slice(0, 8);
  const subject = isStart ? `Mission ${code} started — ${f.area || ""}`.trim() : `Mission ${code} ended — ${f.area || ""}`.trim();
  const out = await sendEmailEach(f.org_id, recipients, subject, flightEmailHtml(f, isStart, m.userName));
  log("notify-flight", { flightId, event, sent: out.sent });
  res.json({ ok: true, sent: out.sent });
});

// Post-flight summary → the recipient emails chosen in the summary view. The
// client supplies the rendered HTML + recipients (auth'd to the flight's org).
app.post("/send-summary", async (req, res) => {
  const flightId = (req.body?.flightId || "").trim();
  const token = (req.body?.token || "").trim() || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const recipients = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
  const subject = (req.body?.subject || "Pilot Ops — Post-flight summary").toString().slice(0, 200);
  const html = (req.body?.html || "").toString().slice(0, 200000);
  const m = await memberForFlight(token, flightId);
  if (!m.ok) return res.status(401).json({ ok: false, reason: "unauthorized" });
  if (!recipients.length || !html) return res.status(400).json({ ok: false, reason: "missing recipients or content" });
  // Attach media, but keep the email deliverable: skip files over ~20MB and cap
  // the total at ~24MB (most mail servers reject larger). Skipped files are still
  // linked from the app; huge videos just aren't email-attached.
  const PER = 20 * 1024 * 1024, TOTAL = 24 * 1024 * 1024;
  const attachments = []; let acc = 0;
  for (const a of (Array.isArray(req.body?.attachments) ? req.body.attachments : [])) {
    if (!a?.url || !a?.filename) continue;
    const sz = Number(a.size) || 0;
    if (sz > PER || acc + sz > TOTAL) continue;
    acc += sz;
    attachments.push({ filename: String(a.filename).slice(0, 200), url: String(a.url) });
  }
  const out = await sendEmailEach(m.flight.org_id, recipients, subject, brandWrap("Post-flight summary", html), attachments);
  log("send-summary", { flightId, sent: out.sent });
  res.json({ ok: true, sent: out.sent });
});

// Admin "send test" from the Email delivery settings page. Verifies the caller is
// an admin, then sends one email to `to` using that admin's org transport.
app.post("/send-test-email", async (req, res) => {
  const token = (req.body?.token || "").trim() || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const to = (req.body?.to || "").toString().trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.status(400).json({ ok: false, reason: "invalid recipient" });
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user) return res.status(401).json({ ok: false, reason: "unauthorized" });
  const { data: profile } = await admin.from("profiles").select("org_id, is_admin").eq("id", u.user.id).maybeSingle();
  if (!profile || !profile.is_admin) return res.status(403).json({ ok: false, reason: "admin only" });
  const html = brandWrap("Email test", `<p>This is a test from Pilot Ops. If you received it, your organization's email delivery is configured correctly. 🎉</p>`);
  const out = await sendEmailEach(profile.org_id, [to], "Pilot Ops — email test", html);
  log("send-test-email", { org: profile.org_id, to, sent: out.sent });
  if (!out.sent) return res.status(502).json({ ok: false, reason: out.reason || "send failed" });
  res.json({ ok: true, sent: out.sent });
});

// Whether THIS org (or the server default) can send email.
app.get("/email-status", async (req, res) => {
  const token = (req.query?.token || "").toString().trim();
  let orgId = null;
  if (token) { const { data: u } = await admin.auth.getUser(token); if (u?.user) { const { data: p } = await admin.from("profiles").select("org_id").eq("id", u.user.id).maybeSingle(); orgId = p?.org_id || null; } }
  const tp = await transportForOrg(orgId);
  res.json({ configured: !!tp, provider: tp?.kind || null });
});

// ---- MediaMTX external auth -------------------------------------------------
app.post("/auth", async (req, res) => {
  const { path = "", query = "", action = "" } = req.body || {};
  if (["api", "metrics", "pprof"].includes(action)) return res.sendStatus(200);
  const token = tokenFromQuery(query);

  if (action === "publish") {
    // Path A: a token survived in the query (e.g. ffmpeg) — validate it.
    if (token) {
      const v = await validatePublisher(token, path);
      if (v.ok) { await flipLive(path); log("auth allow publish (token)", { path }); return res.sendStatus(200); }
    }
    // Path A2: a per-flight ingest key — direct RTMP/SRT from a non-app encoder
    // or drone ground station (OBS, ffmpeg, hardware encoder). Any publisher that
    // can put ?key=<ingest_key> in the URL authenticates this way.
    const ikey = keyFromQuery(query);
    if (ikey) {
      const { data: flight } = await admin.from("flights").select("status, ingest_key").eq("id", path).maybeSingle();
      if (flight && flight.ingest_key && flight.ingest_key === ikey && flight.status === "live") {
        await flipLive(path); log("auth allow publish (ingest key)", { path }); return res.sendStatus(200);
      }
    }
    // Path B: a recent /grant for this flight (the normal app path).
    const g = grants.get(path);
    if (g && Date.now() - g < GRANT_TTL) {
      const { data: flight } = await admin.from("flights").select("status").eq("id", path).maybeSingle();
      if (flight?.status === "live") { await flipLive(path); log("auth allow publish (grant)", { path }); return res.sendStatus(200); }
    }
    log("auth deny publish", { path, hadToken: !!token });
    return res.sendStatus(401);
  }

  // read/playback (WHEP/HLS). Public viewer: a valid share_key for this flight
  // allows a tokenless read.
  const key = keyFromQuery(query);
  if (key) {
    const { data: f } = await admin.from("flights").select("share_key").eq("id", path).maybeSingle();
    if (f && f.share_key && f.share_key === key) return res.sendStatus(200);
  }
  // Otherwise require a valid token in the same org as the flight.
  if (!token) { log("auth deny read: no token/key", { path }); return res.sendStatus(401); }
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user) { log("auth deny read: bad token", { path }); return res.sendStatus(401); }
  const [{ data: flight }, { data: profile }] = await Promise.all([
    admin.from("flights").select("org_id").eq("id", path).maybeSingle(),
    admin.from("profiles").select("org_id").eq("id", u.user.id).maybeSingle(),
  ]);
  if (!flight || !profile || flight.org_id !== profile.org_id) { log("auth deny read: org", { path }); return res.sendStatus(401); }
  return res.sendStatus(200);
});

// ---- controller disconnected ------------------------------------------------
app.post("/unpublish", async (req, res) => {
  const path = (req.body?.path || "").trim();
  if (path) { await admin.from("flights").update({ stream_status: "offline" }).eq("id", path); log("offline", { path }); }
  res.sendStatus(200);
});

// Upload one finished recording file and attach it to the flight.
async function uploadRecording(flightId, file, name, size) {
  const buf = await readFile(file);
  const storagePath = `flights/${flightId}/${name}`;
  const up = await admin.storage.from(MEDIA_BUCKET).upload(storagePath, buf, { contentType: "video/mp4", upsert: true });
  if (up.error) throw up.error;
  const { data: flight } = await admin.from("flights").select("area, pilot_id, org_id").eq("id", flightId).maybeSingle();
  await admin.from("media").insert({
    storage_path: storagePath, name, type: "video", flight_id: flightId,
    pilot_id: flight?.pilot_id || null, area: flight?.area || null, org_id: flight?.org_id || null,
    size: size ?? buf.length,
  });
  log("recording attached", { flightId, name, bytes: size ?? buf.length });
}

// ---- recording finished hook (fallback if MediaMTX has curl) -----------------
app.post("/recording-complete", async (req, res) => {
  const path = (req.body?.path || "").trim();
  const file = (req.body?.file || "").trim();
  if (path && file) { try { await uploadRecording(path, file, basename(file)); await unlink(file).catch(() => {}); } catch (e) { log("recording-complete error", e.message); } }
  res.sendStatus(200);
});

app.get("/healthz", (_req, res) => res.json({ ok: true }));

// ---- offline reconcile: ask MediaMTX who is actually publishing --------------
// Flips flights back to 'offline' when their controller stops casting. A 15s
// grace avoids racing a publish that just started.
async function reconcile() {
  try {
    const res = await fetch(`${MEDIAMTX_API}/v3/paths/list?itemsPerPage=1000`);
    if (!res.ok) return;
    const data = await res.json();
    const live = (data.items || []).filter((p) => p.ready && p.source).map((p) => p.name);
    let q = admin.from("flights").update({ stream_status: "offline" })
      .eq("stream_status", "live")
      .lt("stream_started_at", new Date(Date.now() - 15000).toISOString());
    if (live.length) q = q.not("id", "in", `(${live.join(",")})`);
    await q;
  } catch { /* MediaMTX not reachable yet — try next tick */ }
}

// ---- recordings watcher: upload finished casts, then free local disk ---------
// Files we've given up on (too large, or a failed upload) — so we don't re-read
// them into memory on every scan. Reset only on process restart.
const skipRecordings = new Set();
async function scanRecordings() {
  let dirs;
  try { dirs = await readdir(RECORDINGS_DIR, { withFileTypes: true }); } catch { return; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const flightId = d.name, dirPath = join(RECORDINGS_DIR, flightId);
    let files; try { files = await readdir(dirPath); } catch { continue; }
    for (const name of files) {
      if (!name.endsWith(".mp4")) continue;
      const fp = join(dirPath, name);
      if (skipRecordings.has(fp)) continue;
      let st; try { st = await stat(fp); } catch { continue; }
      if (Date.now() - st.mtimeMs < 20000) continue; // still being written
      if (st.size > RECORDING_MAX_BYTES) {
        log("recording too large for storage — left on disk", { name, mb: Math.round(st.size / 1048576) });
        skipRecordings.add(fp);
        continue;
      }
      // One attempt per file per process lifetime — never retry in a tight loop.
      try { await uploadRecording(flightId, fp, name, st.size); await unlink(fp); }
      catch (e) { log("recording upload failed — left on disk", e.message); skipRecordings.add(fp); }
    }
  }
}

// Reap local recordings older than the retention window so the disk can't fill.
async function cleanupRecordings() {
  const cutoff = Date.now() - RECORDING_RETENTION_DAYS * 86400000;
  let dirs;
  try { dirs = await readdir(RECORDINGS_DIR, { withFileTypes: true }); } catch { return; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dirPath = join(RECORDINGS_DIR, d.name);
    let files; try { files = await readdir(dirPath); } catch { continue; }
    for (const name of files) {
      if (!name.endsWith(".mp4")) continue;
      const fp = join(dirPath, name);
      let st; try { st = await stat(fp); } catch { continue; }
      if (st.mtimeMs < cutoff) {
        try { await unlink(fp); skipRecordings.delete(fp); log("old recording purged (retention)", { name, days: RECORDING_RETENTION_DAYS }); } catch {}
      }
    }
  }
}

app.listen(PORT, () => {
  log(`stream-gateway listening on :${PORT}`);
  setInterval(reconcile, POLL_MS);
  setInterval(scanRecordings, Math.max(POLL_MS, 15000));
  cleanupRecordings();
  setInterval(cleanupRecordings, 6 * 60 * 60 * 1000); // every 6h
});
