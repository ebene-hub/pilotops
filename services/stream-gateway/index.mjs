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
import crypto from "node:crypto";
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
// Supabase "Send Email Hook": auth emails (confirmation, password reset, magic
// link) are POSTed here so they go through our own (cert-tolerant) transport.
// SEND_EMAIL_HOOK_SECRET is the standard-webhooks secret from the Supabase hook;
// AUTH_EMAIL_ORG_ID is the org whose mail config sends them (auth emails are
// platform-level / pre-org, so we borrow a configured org's transport).
const SEND_EMAIL_HOOK_SECRET = process.env.SEND_EMAIL_HOOK_SECRET || "";
const AUTH_EMAIL_ORG_ID = process.env.AUTH_EMAIL_ORG_ID || "";
// Sender for platform provisioning/reset emails when the target org has no active
// email config of its own (e.g. a brand-new org). Defaults to the auth-email org —
// a configured org we borrow. This NEVER changes a tenant's own notification sends,
// which always resolve their own org's transport first.
const PLATFORM_EMAIL_ORG_ID = process.env.PLATFORM_EMAIL_ORG_ID || AUTH_EMAIL_ORG_ID || "";

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
// Stash the raw body so we can verify the standard-webhooks signature on the
// Supabase auth-email hook (signature is computed over the exact bytes).
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
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
          secure: s.smtp_secure !== false, user: s.smtp_username || "", pass: s.smtp_password || "",
          allowInvalidCert: s.smtp_allow_invalid_cert === true };
      }
      if (s.provider === "resend" && s.resend_api_key) {
        return { kind: "resend", from: from || MAIL_FROM, key: s.resend_api_key };
      }
    }
  }
  if (SMTP_HOST) return { kind: "smtp", from: MAIL_FROM, host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_SECURE, user: SMTP_USER, pass: SMTP_PASS, allowInvalidCert: String(process.env.SMTP_ALLOW_INVALID_CERT || "false") === "true" };
  if (RESEND_API_KEY) return { kind: "resend", from: MAIL_FROM, key: RESEND_API_KEY };
  return null;
}

// Turn a nodemailer / fetch send error into a compact, actionable reason string
// that surfaces the SMTP response code (e.g. "535 …") or the network error code
// (e.g. "ETIMEDOUT") so the admin sees WHY a test failed, not just "failed".
function fmtMailErr(e) {
  if (!e) return "send failed";
  const parts = [];
  if (e.responseCode) parts.push(String(e.responseCode)); // SMTP reply code: 535, 550…
  else if (e.code) parts.push(String(e.code));            // network/TLS code: ETIMEDOUT, EAUTH…
  const detail = (e.response || e.message || "").toString().trim();
  if (detail) parts.push(detail.slice(0, 180));
  return parts.join(" ") || "send failed";
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
    smtp = nodemailer.createTransport({
      host: tp.host, port: tp.port, secure: tp.secure,
      auth: tp.user ? { user: tp.user, pass: tp.pass } : undefined,
      // Fail fast instead of hanging ~2 min when the host/port is unreachable or
      // a port/TLS-mode mismatch stalls the handshake — the admin gets the real
      // error (timeout vs auth) quickly.
      connectionTimeout: 12000, // no TCP connect within 12s → ETIMEDOUT/ECONNECTION
      greetingTimeout: 12000,   // connected but no SMTP banner (wrong port/TLS) → fail
      socketTimeout: 20000,
      // Shared hosting often presents a cert for a different name than the mail
      // host; allow it when the org opted in (connection is still encrypted).
      tls: tp.allowInvalidCert ? { rejectUnauthorized: false } : undefined,
    });
  }
  let sent = 0, lastErr = "";
  for (const to of list) {
    try {
      if (tp.kind === "resend") await resendSend(tp, to, subject, html, attachments);
      else await smtp.sendMail({ from: tp.from, to, subject, html, attachments: smtpAtt });
      sent++;
    } catch (e) { lastErr = fmtMailErr(e); log("email send failed", lastErr); }
  }
  try { smtp?.close(); } catch {}
  return { ok: sent > 0, sent, reason: sent > 0 ? undefined : lastErr };
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

function flightEmailHtml(f, isStart, byName, liveUrl) {
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
  // "Watch live" button only on the start email, only when a link is configured.
  const safeLive = isStart && liveUrl && /^https?:\/\//i.test(liveUrl) ? liveUrl : "";
  const button = safeLive
    ? `<div style="margin-top:20px"><a href="${esc(safeLive)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;font-size:13px">▶ Watch live stream</a></div>`
    : "";
  return brandWrap(isStart ? "Mission started" : "Mission ended",
    `<p style="margin:0 0 14px">${lead}</p><table style="width:100%;border-collapse:collapse;font-size:13px">${table}</table>${button}`);
}

// Verify a Standard Webhooks signature (Supabase auth hooks use this).
// signedContent = "<id>.<timestamp>.<rawBody>"; sig = base64(HMAC-SHA256(key, ...)).
function verifyStandardWebhook(secret, headers, rawBody) {
  const id = headers["webhook-id"], ts = headers["webhook-timestamp"], sigHeader = headers["webhook-signature"];
  if (!secret || !id || !ts || !sigHeader) return false;
  // Reject stale timestamps (>5 min) to blunt replay.
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const b64 = secret.replace(/^v1,/, "").replace(/^whsec_/, "");
  let key; try { key = Buffer.from(b64, "base64"); } catch { return false; }
  const expected = crypto.createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest("base64");
  return String(sigHeader).split(" ").some((part) => {
    const sig = part.includes(",") ? part.split(",")[1] : part;
    try { return sig && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { return false; }
  });
}

function authEmailHtml(type, verifyUrl, otp) {
  const t = {
    signup:   ["Confirm your account", "Welcome to Pilot Ops. Confirm your email address to activate your account.", "Confirm email"],
    email:    ["Confirm your account", "Confirm your email address to activate your account.", "Confirm email"],
    recovery: ["Reset your password", "We received a request to reset your Pilot Ops password. Click below to choose a new one.", "Reset password"],
    magiclink:["Your sign-in link", "Click below to sign in to Pilot Ops.", "Sign in"],
    invite:   ["You're invited to Pilot Ops", "You've been invited to Pilot Ops. Click below to set up your account.", "Accept invite"],
  }[type] || ["Pilot Ops", "Complete this action on your Pilot Ops account.", "Continue"];
  return brandWrap(t[0], `
    <p style="margin:0 0 18px">${esc(t[1])}</p>
    <div style="margin:18px 0"><a href="${esc(verifyUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">${esc(t[2])}</a></div>
    ${otp ? `<p style="margin:14px 0 0;font-size:12.5px;color:#5b6479">Or enter this code: <strong style="font-family:monospace;font-size:16px;letter-spacing:2px">${esc(otp)}</strong></p>` : ""}
    <p style="margin:14px 0 0;font-size:11.5px;color:#8a92a3">If the button doesn't work, copy this link:<br>${esc(verifyUrl)}</p>
    <p style="margin:12px 0 0;font-size:11.5px;color:#8a92a3">If you didn't request this, you can ignore this email.</p>`);
}

// Supabase Send Email Hook: sends auth emails through our own transport.
// Accept both path names so whichever URL was configured in Supabase works.
app.post(["/auth-email-hook", "/email-hook"], async (req, res) => {
  const raw = req.rawBody ? req.rawBody.toString("utf8") : JSON.stringify(req.body || {});
  if (!verifyStandardWebhook(SEND_EMAIL_HOOK_SECRET, req.headers, raw)) {
    log("auth-email-hook: signature check failed");
    return res.status(401).json({ error: { http_code: 401, message: "invalid signature" } });
  }
  const p = req.body || {};
  const email = p?.user?.email;
  const ed = p?.email_data || {};
  const type = ed.email_action_type || "signup";
  if (!email || !ed.token_hash) return res.status(400).json({ error: { http_code: 400, message: "missing fields" } });
  // The verify endpoint lives on the Supabase PROJECT URL, not the app Site URL.
  const base = (process.env.SUPABASE_URL || ed.site_url || "").replace(/\/$/, "");
  const verifyUrl = `${base}/auth/v1/verify?token=${encodeURIComponent(ed.token_hash)}&type=${encodeURIComponent(type)}` +
    (ed.redirect_to ? `&redirect_to=${encodeURIComponent(ed.redirect_to)}` : "");
  const subject = type === "recovery" ? "Reset your Pilot Ops password"
    : (type === "signup" || type === "email") ? "Confirm your Pilot Ops account"
    : type === "invite" ? "You're invited to Pilot Ops" : "Your Pilot Ops sign-in link";
  const out = await sendEmailEach(AUTH_EMAIL_ORG_ID || null, [email], subject, authEmailHtml(type, verifyUrl, ed.token));
  if (!out.sent) { log("auth-email-hook send failed", { type, reason: out.reason }); return res.status(500).json({ error: { http_code: 500, message: out.reason || "send failed" } }); }
  log("auth-email-hook sent", { type, email });
  res.json({});   // 200 empty = Supabase proceeds (email handled by us)
});

function inviteEmailHtml(orgName, inviter, roles, message, link) {
  const roleStr = (roles || []).join(", ");
  return brandWrap("You're invited", `
    <p style="margin:0 0 12px"><strong>${esc(inviter)}</strong> has invited you to join <strong>${esc(orgName)}</strong> on Pilot Ops${roleStr ? ` as <strong>${esc(roleStr)}</strong>` : ""}.</p>
    ${message ? `<p style="margin:0 0 14px;padding:10px 12px;background:#f7f8fa;border-radius:8px;font-style:italic;color:#334">${esc(message)}</p>` : ""}
    <p style="margin:0 0 16px">Click below to set up your account. This link is personal to you — please don't share it. After registering, an administrator will verify your details before you can start using Pilot Ops.</p>
    <div style="margin:18px 0"><a href="${esc(link)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:14px">Accept invitation &amp; register</a></div>
    <p style="margin:14px 0 0;font-size:11.5px;color:#8a92a3">If the button doesn't work, copy this link into your browser:<br>${esc(link)}</p>`);
}

// Email an invite link to a prospective member, via the inviting admin's org SMTP.
app.post("/send-invite", async (req, res) => {
  const token = (req.body?.token || "").trim() || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const email = (req.body?.email || "").toString().trim();
  const link = (req.body?.link || "").toString().trim();
  const roles = Array.isArray(req.body?.roles) ? req.body.roles.slice(0, 10) : [];
  const message = (req.body?.message || "").toString().slice(0, 1000);
  const inviterName = (req.body?.inviterName || "Your admin").toString().slice(0, 120);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !/^https?:\/\//i.test(link)) return res.status(400).json({ ok: false, reason: "invalid email or link" });
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user) return res.status(401).json({ ok: false, reason: "unauthorized" });
  const { data: profile } = await admin.from("profiles").select("org_id, is_admin").eq("id", u.user.id).maybeSingle();
  if (!profile || !profile.is_admin) return res.status(403).json({ ok: false, reason: "admin only" });
  const { data: org } = await admin.from("organizations").select("name").eq("id", profile.org_id).maybeSingle();
  const orgName = org?.name || "your organization";
  const out = await sendEmailEach(profile.org_id, [email], `You're invited to join ${orgName} on Pilot Ops`, inviteEmailHtml(orgName, inviterName, roles, message, link));
  log("send-invite", { email, org: profile.org_id, sent: out.sent });
  if (!out.sent) return res.status(502).json({ ok: false, reason: out.reason || "send failed" });
  res.json({ ok: true, sent: out.sent });
});

// Mission lifecycle notice → stakeholders who opted into 'pre-flight' notices.
app.post("/notify-flight", async (req, res) => {
  const flightId = (req.body?.flightId || "").trim();
  const token = (req.body?.token || "").trim() || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const event = (req.body?.event || "start").toString();
  const m = await memberForFlight(token, flightId);
  if (!m.ok) return res.status(401).json({ ok: false, reason: "unauthorized" });
  const f = m.flight;
  const [{ data: stk }, { data: es }] = await Promise.all([
    admin.from("stakeholders").select("email, notify").eq("org_id", f.org_id),
    admin.from("org_email_settings").select("live_url").eq("org_id", f.org_id).maybeSingle(),
  ]);
  const recipients = (stk || []).filter((s) => s.email && (s.notify || []).includes("pre-flight")).map((s) => s.email);
  if (!recipients.length) { log("notify-flight: no opted-in stakeholders", { flightId, event }); return res.json({ ok: true, sent: 0 }); }
  const isStart = event !== "end";
  const code = f.code || f.id.slice(0, 8);
  const subject = isStart ? `Mission ${code} started — ${f.area || ""}`.trim() : `Mission ${code} ended — ${f.area || ""}`.trim();
  const out = await sendEmailEach(f.org_id, recipients, subject, flightEmailHtml(f, isStart, m.userName, es?.live_url));
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
  const targetOrg = (req.body?.orgId || "").toString().trim();
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user) return res.status(401).json({ ok: false, reason: "unauthorized" });
  const { data: profile } = await admin.from("profiles").select("org_id, is_admin").eq("id", u.user.id).maybeSingle();
  // A platform admin may test any org's transport by passing orgId; otherwise the
  // caller must be a tenant admin testing their own org.
  let orgForSend = profile?.org_id || null;
  if (targetOrg) {
    const { data: pa } = await admin.from("platform_admins").select("profile_id").eq("profile_id", u.user.id).maybeSingle();
    if (!pa) return res.status(403).json({ ok: false, reason: "platform admin only" });
    orgForSend = targetOrg;
  } else if (!profile || !profile.is_admin) {
    return res.status(403).json({ ok: false, reason: "admin only" });
  }
  const html = brandWrap("Email test", `<p>This is a test from Pilot Ops. If you received it, your organization's email delivery is configured correctly. 🎉</p>`);
  const out = await sendEmailEach(orgForSend, [to], "Pilot Ops — email test", html);
  log("send-test-email", { org: orgForSend, to, sent: out.sent });
  if (!out.sent) return res.status(502).json({ ok: false, reason: out.reason || "send failed" });
  res.json({ ok: true, sent: out.sent });
});

// ---- platform super-admin: cross-tenant provisioning -----------------------
// These create auth accounts (needs the Admin API, so they can't be SQL RPCs)
// on behalf of the platform operator. Gated by platform_admins membership — the
// same table auth_is_platform_admin() checks in Postgres.
async function isPlatformAdmin(token) {
  if (!token) return { ok: false };
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user) return { ok: false };
  const { data: pa } = await admin.from("platform_admins").select("profile_id").eq("profile_id", u.user.id).maybeSingle();
  return { ok: !!pa, user: u.user };
}

const initialsOf = (name) => (name || "").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "U";

// Create (or reuse) an email-confirmed auth account with NO password, and return
// a recovery ("set password") action link that lands on `redirectTo` — which
// already renders a set-password form for type=recovery (admin-login.js / login.js).
async function provisionUser(email, name, redirectTo) {
  let userId;
  const create = await admin.auth.admin.createUser({
    email, email_confirm: true,
    user_metadata: name ? { full_name: name, initials: initialsOf(name) } : {},
  });
  if (create.error) {
    if (!/already|registered|exists/i.test(create.error.message || "")) return { ok: false, reason: create.error.message };
    // Account already exists — fine, we'll just send them a set-password link.
  } else {
    userId = create.data?.user?.id;
  }
  const link = await admin.auth.admin.generateLink({ type: "recovery", email, options: redirectTo ? { redirectTo } : {} });
  if (link.error) return { ok: false, reason: link.error.message };
  userId = userId || link.data?.user?.id;
  const action = link.data?.properties?.action_link;
  if (!userId || !action) return { ok: false, reason: "could not generate set-password link" };
  return { ok: true, userId, link: action };
}

const genCode = () => String(Math.floor(100000 + Math.random() * 900000));

// Which org's transport sends platform provisioning/reset mail: the target org if
// it has its OWN active config, else the platform sender org (borrowed). Keeps
// tenant sends untouched (those resolve their own org first in transportForOrg).
async function emailSenderOrg(targetOrg) {
  if (targetOrg) {
    const { data: cfg } = await admin.from("org_email_settings").select("active").eq("org_id", targetOrg).maybeSingle();
    if (cfg?.active) return targetOrg;
  }
  return PLATFORM_EMAIL_ORG_ID || targetOrg;
}

// Branded "here's a link to set/reset your password" email.
async function sendAccountEmail(orgId, email, orgName, link, opts = {}) {
  const title = opts.title || "Set up your Pilot Ops account";
  const intro = opts.intro || `An account has been created for you on <strong>${esc(orgName)}</strong>.`;
  const cta = opts.cta || "Set password &amp; sign in";
  const html = brandWrap(title,
    `<p style="margin:0 0 14px">${intro}</p>
     <p style="margin:0 0 18px">Click below to set your password and sign in.</p>
     <div><a href="${esc(link)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;font-size:13px">${cta}</a></div>
     <p style="margin:18px 0 0;font-size:12px;color:#7a8294">If the button doesn't work, paste this link into your browser:<br>${esc(link)}</p>`);
  const out = await sendEmailEach(await emailSenderOrg(orgId), [email], opts.subject || `Your Pilot Ops account for ${orgName}`, html);
  return out.sent > 0;
}

// Create a new organization + its first admin.
app.post("/platform/create-org", async (req, res) => {
  const token = (req.body?.token || "").trim() || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const orgName = (req.body?.orgName || "").toString().trim();
  const adminEmail = (req.body?.adminEmail || "").toString().trim().toLowerCase();
  const adminName = (req.body?.adminName || "").toString().trim();
  const licenseStatus = ["active", "suspended", "expired"].includes(req.body?.licenseStatus) ? req.body.licenseStatus : "active";
  const expires = (req.body?.expires || "").toString().trim() || null;
  const seatsRaw = req.body?.seats;
  const seats = seatsRaw != null && seatsRaw !== "" && Number.isFinite(Number(seatsRaw)) ? Number(seatsRaw) : null;
  const redirectTo = (req.body?.redirectTo || "").toString().trim() || undefined;

  const pa = await isPlatformAdmin(token);
  if (!pa.ok) return res.status(403).json({ ok: false, reason: "platform admin only" });
  if (!orgName) return res.status(400).json({ ok: false, reason: "organization name required" });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail)) return res.status(400).json({ ok: false, reason: "valid admin email required" });

  const { data: org, error: orgErr } = await admin.from("organizations")
    .insert({ name: orgName, license_status: licenseStatus, license_expires_at: expires, seat_limit: seats })
    .select("id").single();
  if (orgErr) return res.status(500).json({ ok: false, reason: orgErr.message });

  const prov = await provisionUser(adminEmail, adminName, redirectTo);
  if (!prov.ok) { // roll back the org so a failed provision doesn't orphan it
    try { await admin.from("organizations").delete().eq("id", org.id); } catch {}
    return res.status(500).json({ ok: false, reason: prov.reason });
  }

  // Make them this org's admin (mirrors create_org_and_claim's effect).
  await admin.from("profiles").update({ org_id: org.id, is_admin: true, admin_role: "Ops Director", ...(adminName ? { full_name: adminName } : {}) }).eq("id", prov.userId);
  const { data: dir } = await admin.from("roles").select("id").eq("name", "Director").maybeSingle();
  if (dir?.id) { try { await admin.from("member_roles").insert({ profile_id: prov.userId, role_id: dir.id, org_id: org.id }); } catch {} }

  const emailed = await sendAccountEmail(org.id, adminEmail, orgName, prov.link);
  log("platform/create-org", { org: org.id, adminEmail, emailed });
  res.json({ ok: true, orgId: org.id, link: prov.link, emailed });
});

// Register a member/pilot into an existing organization.
app.post("/platform/register-pilot", async (req, res) => {
  const token = (req.body?.token || "").trim() || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const orgId = (req.body?.orgId || "").toString().trim();
  const email = (req.body?.email || "").toString().trim().toLowerCase();
  const name = (req.body?.name || "").toString().trim();
  const roles = Array.isArray(req.body?.roles) ? req.body.roles.slice(0, 12).map(String) : [];
  const redirectTo = (req.body?.redirectTo || "").toString().trim() || undefined;

  const pa = await isPlatformAdmin(token);
  if (!pa.ok) return res.status(403).json({ ok: false, reason: "platform admin only" });
  if (!orgId) return res.status(400).json({ ok: false, reason: "organization required" });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ ok: false, reason: "valid email required" });

  const { data: org } = await admin.from("organizations").select("id, name, seat_limit").eq("id", orgId).maybeSingle();
  if (!org) return res.status(404).json({ ok: false, reason: "organization not found" });
  if (org.seat_limit != null) {
    const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("org_id", orgId);
    if ((count || 0) >= org.seat_limit) return res.status(409).json({ ok: false, reason: `seat limit reached (${org.seat_limit})` });
  }

  const prov = await provisionUser(email, name, redirectTo);
  if (!prov.ok) return res.status(500).json({ ok: false, reason: prov.reason });
  await admin.from("profiles").update({ org_id: orgId, ...(name ? { full_name: name } : {}) }).eq("id", prov.userId);
  if (roles.length) {
    const { data: roleRows } = await admin.from("roles").select("id, name").in("name", roles);
    const rows = (roleRows || []).map((r) => ({ profile_id: prov.userId, role_id: r.id, org_id: orgId }));
    if (rows.length) { try { await admin.from("member_roles").insert(rows); } catch {} }
  }
  // Optionally issue a 6-digit launch code (revealed once to the operator).
  let launchCode = null;
  if (req.body?.withLaunchCode) {
    launchCode = genCode();
    const { error } = await admin.rpc("platform_set_pilot_code", { p_profile: prov.userId, p_code: launchCode });
    if (error) { log("register-pilot set code failed", error.message); launchCode = null; }
  }
  const emailed = await sendAccountEmail(orgId, email, org.name, prov.link);
  log("platform/register-pilot", { org: orgId, email, roles, emailed });
  res.json({ ok: true, userId: prov.userId, link: prov.link, emailed, launchCode });
});

// Permanently delete an organization (storage + member auth accounts + all data).
app.post("/platform/delete-org", async (req, res) => {
  const token = (req.body?.token || "").trim() || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const orgId = (req.body?.orgId || "").toString().trim();
  const pa = await isPlatformAdmin(token);
  if (!pa.ok) return res.status(403).json({ ok: false, reason: "platform admin only" });
  if (!orgId) return res.status(400).json({ ok: false, reason: "organization required" });
  try { await purgeOrg(orgId); } catch (e) { return res.status(500).json({ ok: false, reason: e.message }); }
  log("platform/delete-org", { org: orgId });
  res.json({ ok: true });
});

// Delete a single member (their auth account; profile + roles cascade).
app.post("/platform/delete-member", async (req, res) => {
  const token = (req.body?.token || "").trim() || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const profileId = (req.body?.profileId || "").toString().trim();
  const pa = await isPlatformAdmin(token);
  if (!pa.ok) return res.status(403).json({ ok: false, reason: "platform admin only" });
  if (!profileId) return res.status(400).json({ ok: false, reason: "member required" });
  const { data: isPa } = await admin.from("platform_admins").select("profile_id").eq("profile_id", profileId).maybeSingle();
  if (isPa) return res.status(400).json({ ok: false, reason: "can't delete a platform admin here" });
  try { await admin.auth.admin.deleteUser(profileId); } catch (e) { return res.status(500).json({ ok: false, reason: e.message }); }
  log("platform/delete-member", { profile: profileId });
  res.json({ ok: true });
});

// Reset a member/admin password: emails (and returns) a set-password link.
app.post("/platform/reset-password", async (req, res) => {
  const token = (req.body?.token || "").trim() || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const email = (req.body?.email || "").toString().trim().toLowerCase();
  const redirectTo = (req.body?.redirectTo || "").toString().trim() || undefined;
  const pa = await isPlatformAdmin(token);
  if (!pa.ok) return res.status(403).json({ ok: false, reason: "platform admin only" });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ ok: false, reason: "valid email required" });
  const link = await admin.auth.admin.generateLink({ type: "recovery", email, options: redirectTo ? { redirectTo } : {} });
  if (link.error) return res.status(500).json({ ok: false, reason: link.error.message });
  const action = link.data?.properties?.action_link;
  if (!action) return res.status(500).json({ ok: false, reason: "could not generate reset link" });
  // Resolve the org (for sender + email copy).
  let orgId = null, orgName = "Pilot Ops";
  const uid = link.data?.user?.id;
  if (uid) {
    const { data: p } = await admin.from("profiles").select("org_id").eq("id", uid).maybeSingle();
    orgId = p?.org_id || null;
    if (orgId) { const { data: o } = await admin.from("organizations").select("name").eq("id", orgId).maybeSingle(); orgName = o?.name || orgName; }
  }
  const emailed = await sendAccountEmail(orgId, email, orgName, action, { title: "Reset your Pilot Ops password", intro: "A password reset was requested for your account.", cta: "Set a new password", subject: "Reset your Pilot Ops password" });
  log("platform/reset-password", { email, emailed });
  res.json({ ok: true, link: action, emailed });
});

// Create a ready-to-use demo pilot: confirmed account with a temp password,
// verified KYC (skips the admin KYC gate), Pilot role, and a launch code.
app.post("/platform/create-demo-pilot", async (req, res) => {
  const token = (req.body?.token || "").trim() || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const orgId = (req.body?.orgId || "").toString().trim();
  const name = (req.body?.name || "Demo Pilot").toString().trim();
  let email = (req.body?.email || "").toString().trim().toLowerCase();
  const pa = await isPlatformAdmin(token);
  if (!pa.ok) return res.status(403).json({ ok: false, reason: "platform admin only" });
  if (!orgId) return res.status(400).json({ ok: false, reason: "organization required" });
  const { data: org } = await admin.from("organizations").select("id, name").eq("id", orgId).maybeSingle();
  if (!org) return res.status(404).json({ ok: false, reason: "organization not found" });
  if (!email) email = `demo-${Date.now().toString(36)}@demo.pilotops.local`;
  const password = "Demo-" + Math.random().toString(36).slice(2, 8) + Math.floor(10 + Math.random() * 89);

  const create = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name, initials: initialsOf(name) } });
  if (create.error) return res.status(500).json({ ok: false, reason: create.error.message });
  const uid = create.data.user.id;
  await admin.from("profiles").update({ org_id: orgId, full_name: name, kyc_status: "verified" }).eq("id", uid);
  const { data: pilotRole } = await admin.from("roles").select("id").eq("name", "Pilot").maybeSingle();
  if (pilotRole?.id) { try { await admin.from("member_roles").insert({ profile_id: uid, role_id: pilotRole.id, org_id: orgId }); } catch {} }
  const code = genCode();
  const { error: cErr } = await admin.rpc("platform_set_pilot_code", { p_profile: uid, p_code: code });
  if (cErr) log("demo pilot set code failed", cErr.message);
  log("platform/create-demo-pilot", { org: orgId, email });
  res.json({ ok: true, userId: uid, email, password, launchCode: cErr ? null : code });
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

// ---- permanent org deletion (48h grace elapsed) -----------------------------
// An admin schedules deletion (request_org_deletion → delete_after = now+48h).
// Once that time passes, purge the org for good: remove its Storage objects and
// member auth accounts, then delete the org row (all its data cascades via the
// org_id FKs). Runs hourly; a per-org try/catch keeps one failure from blocking
// the rest.
// Hard-purge an org: 1) its Storage files, 2) every member's auth account, 3) the
// org row (all remaining data cascades via the org_id FKs). Shared by the 48h grace
// sweep and the immediate /platform/delete-org endpoint.
async function purgeOrg(orgId) {
  const { data: media } = await admin.from("media").select("storage_path").eq("org_id", orgId);
  const paths = (media || []).map((m) => m.storage_path).filter(Boolean);
  for (let i = 0; i < paths.length; i += 100) {
    try { await admin.storage.from(MEDIA_BUCKET).remove(paths.slice(i, i + 100)); } catch {}
  }
  const { data: profs } = await admin.from("profiles").select("id").eq("org_id", orgId);
  for (const p of (profs || [])) { try { await admin.auth.admin.deleteUser(p.id); } catch {} }
  await admin.from("organizations").delete().eq("id", orgId);
}

async function sweepDeletedOrgs() {
  let orgs;
  try {
    const { data } = await admin.from("organizations").select("id, name").lt("delete_after", new Date().toISOString());
    orgs = data || [];
  } catch { return; }
  for (const o of orgs) {
    try { await purgeOrg(o.id); log("org permanently deleted (48h grace elapsed)", { org: o.id, name: o.name }); }
    catch (e) { log("org deletion sweep error", { org: o.id, err: e.message }); }
  }
}

app.listen(PORT, () => {
  log(`stream-gateway listening on :${PORT}`);
  setInterval(reconcile, POLL_MS);
  setInterval(scanRecordings, Math.max(POLL_MS, 15000));
  cleanupRecordings();
  setInterval(cleanupRecordings, 6 * 60 * 60 * 1000); // every 6h
  sweepDeletedOrgs();
  setInterval(sweepDeletedOrgs, 60 * 60 * 1000); // hourly
});
