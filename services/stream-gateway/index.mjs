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

if (!URL || !SERVICE_KEY) {
  console.error("stream-gateway: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(1);
}

const admin = createClient(URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const tokenFromQuery = (q) => {
  try { return new URLSearchParams(q || "").get("token") || ""; } catch { return ""; }
};
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---- MediaMTX external auth -------------------------------------------------
app.post("/auth", async (req, res) => {
  const { path = "", query = "", action = "" } = req.body || {};
  // Control actions are excluded in mediamtx.yml, but be safe.
  if (["api", "metrics", "pprof"].includes(action)) return res.sendStatus(200);

  const token = tokenFromQuery(query);
  if (!token) { log("auth deny: no token", { path, action }); return res.sendStatus(401); }

  // 1. Validate the JWT (hits GoTrue).
  const { data: u, error: uErr } = await admin.auth.getUser(token);
  const user = u?.user;
  if (uErr || !user) { log("auth deny: bad token", { path, action }); return res.sendStatus(401); }

  // 2. The path is the flight uuid. Load flight + the caller's profile.
  const [{ data: flight }, { data: profile }] = await Promise.all([
    admin.from("flights").select("id, org_id, status, pilot_id").eq("id", path).maybeSingle(),
    admin.from("profiles").select("org_id, is_admin").eq("id", user.id).maybeSingle(),
  ]);
  if (!flight || !profile) { log("auth deny: unknown flight/profile", { path }); return res.sendStatus(401); }

  // 3. Same-org enforcement (multi-tenant isolation).
  if (flight.org_id !== profile.org_id) { log("auth deny: cross-org", { path }); return res.sendStatus(401); }

  if (action === "publish") {
    // Only an active flight, cast by its pilot / crew (or an admin), may publish.
    if (flight.status !== "live") { log("auth deny: flight not live", { path }); return res.sendStatus(401); }
    let crew = flight.pilot_id === user.id;
    if (!crew) {
      const { data } = await admin.from("flight_crew").select("profile_id").eq("flight_id", path).eq("profile_id", user.id).limit(1);
      crew = (data || []).length > 0;
    }
    if (!crew && !profile.is_admin) { log("auth deny: not crew", { path, user: user.id }); return res.sendStatus(401); }

    await admin.from("flights").update({ stream_status: "live", stream_started_at: new Date().toISOString() }).eq("id", path);
    log("auth allow publish", { path, user: user.id });
    return res.sendStatus(200);
  }

  // read/playback: any authenticated member of the flight's org may view.
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
      let st; try { st = await stat(fp); } catch { continue; }
      if (Date.now() - st.mtimeMs < 20000) continue; // still being written
      try { await uploadRecording(flightId, fp, name, st.size); await unlink(fp); }
      catch (e) { log("recording upload failed (will retry)", e.message); }
    }
  }
}

app.listen(PORT, () => {
  log(`stream-gateway listening on :${PORT}`);
  setInterval(reconcile, POLL_MS);
  setInterval(scanRecordings, Math.max(POLL_MS, 15000));
});
