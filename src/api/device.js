// Per-device (controller/PC) identity for device licensing (see 0038_device_licenses.sql).
//
// Strength note: this is a browser deterrent, not a hardware lock. The device token is a
// UUID persisted in localStorage (stable per browser profile); the fingerprint is a hash
// of stable-ish browser/hardware signals used as a secondary signal so a cache-clear on
// the SAME browser can rebind without burning a license slot. A different browser or a
// wiped profile looks like a new device — that's the accepted deterrent-grade limit.

const DEVICE_KEY = "po:device";

// Stable per-browser device token. Generated once, then reused.
export function deviceToken() {
  try {
    let t = localStorage.getItem(DEVICE_KEY);
    if (!t) {
      t = (crypto?.randomUUID?.() || fallbackUuid());
      localStorage.setItem(DEVICE_KEY, t);
    }
    return t;
  } catch {
    // Private mode / storage blocked → ephemeral token (will re-prompt each session).
    return fallbackUuid();
  }
}

function fallbackUuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// A small, stable-ish hardware/browser fingerprint (hex SHA-256). Best-effort — used only
// to make re-activation on the same controller cheap, never as a security boundary.
export async function deviceFingerprint() {
  const n = typeof navigator !== "undefined" ? navigator : {};
  const s = typeof screen !== "undefined" ? screen : {};
  let tz = "";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch {}
  const parts = [
    n.userAgent || "", n.platform || "", String(n.hardwareConcurrency || ""),
    String(n.deviceMemory || ""), n.language || "",
    `${s.width || ""}x${s.height || ""}x${s.colorDepth || ""}`, tz, canvasHash(),
  ].join("|");
  return sha256Hex(parts);
}

// Tiny canvas-render hash — varies by GPU/font stack, adds entropy across machines.
function canvasHash() {
  try {
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d");
    if (!ctx) return "";
    ctx.textBaseline = "top";
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = "#f60";
    ctx.fillRect(10, 1, 62, 20);
    ctx.fillStyle = "#069";
    ctx.fillText("PilotOps✈️", 2, 15);
    return c.toDataURL().slice(-64);
  } catch {
    return "";
  }
}

async function sha256Hex(str) {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    // Fallback: cheap non-crypto hash (still deterministic per device).
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return "x" + h.toString(16);
  }
}

// Friendly default label for the activation form ("Windows · Chrome"-style).
export function deviceLabelGuess() {
  const ua = (navigator?.userAgent || "").toLowerCase();
  const os = /windows/.test(ua) ? "Windows"
           : /android/.test(ua) ? "Android"
           : /iphone|ipad|ios/.test(ua) ? "iOS"
           : /mac/.test(ua) ? "macOS"
           : /linux/.test(ua) ? "Linux" : "Device";
  const br = /edg\//.test(ua) ? "Edge"
           : /chrome|crios/.test(ua) ? "Chrome"
           : /firefox|fxios/.test(ua) ? "Firefox"
           : /safari/.test(ua) ? "Safari" : "Browser";
  return `${os} · ${br}`;
}
