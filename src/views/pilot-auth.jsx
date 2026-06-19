import React from "react";
import { supabase } from "../api/supabase.js";
// Pilot Ops — Pilot identity confirmation
// Anti-impersonation guard required before launching ANY mission (normal or emergency).
//
// Each pilot has a personal 6-digit code (stored on the pilot object as `code`).
// Before takeoff, the pilot in command enters their code. Three failed attempts
// locks the account for 15 minutes and logs the attempt.
//
// This is a deterrent against another person picking up a logged-in tablet and
// starting flights in someone else's name — not a replacement for real auth.

const { useState: paUseState, useEffect: paUseEffect, useRef: paUseRef } = React;

const PILOT_CODE_LENGTH = 6;
const MAX_ATTEMPTS = 3;
const LOCKOUT_MIN = 15;

function readAuthLog() {
  try { return JSON.parse(localStorage.getItem("po:authLog") || "[]"); } catch { return []; }
}
function writeAuthLog(arr) {
  try { localStorage.setItem("po:authLog", JSON.stringify(arr.slice(0, 50))); } catch {}
}
function recordAuthEvent(pilotId, ok, context) {
  const log = readAuthLog();
  log.unshift({ ts: Date.now(), pilotId, ok, context });
  writeAuthLog(log);
}
function getLockout(pilotId) {
  try {
    const raw = localStorage.getItem("po:authLockouts");
    const map = raw ? JSON.parse(raw) : {};
    const until = map[pilotId] || 0;
    return until > Date.now() ? until : 0;
  } catch { return 0; }
}
function setLockout(pilotId, durationMin) {
  try {
    const raw = localStorage.getItem("po:authLockouts");
    const map = raw ? JSON.parse(raw) : {};
    map[pilotId] = Date.now() + durationMin * 60 * 1000;
    localStorage.setItem("po:authLockouts", JSON.stringify(map));
  } catch {}
}
function clearLockout(pilotId) {
  try {
    const raw = localStorage.getItem("po:authLockouts");
    const map = raw ? JSON.parse(raw) : {};
    delete map[pilotId];
    localStorage.setItem("po:authLockouts", JSON.stringify(map));
  } catch {}
}

function PilotAuthModal({ open, onClose, pilot, context, onConfirmed, accentColor }) {
  const inputs = Array.from({ length: PILOT_CODE_LENGTH }, () => paUseRef(null));
  const blank = Array(PILOT_CODE_LENGTH).fill("");
  const [digits, setDigits] = paUseState(blank);
  const [attempts, setAttempts] = paUseState(0);
  const [shake, setShake] = paUseState(false);
  const [error, setError] = paUseState("");
  const [showHint, setShowHint] = paUseState(false);

  const [lockedUntil, setLockedUntil] = paUseState(0);
  const isLocked = lockedUntil > Date.now();
  const lockoutMinsLeft = isLocked ? Math.ceil((lockedUntil - Date.now()) / 60000) : 0;

  // Reset and focus on open
  paUseEffect(() => {
    if (open) {
      setDigits(Array(PILOT_CODE_LENGTH).fill(""));
      setError("");
      setAttempts(0);
      setShowHint(false);
      setLockedUntil(0);
      setTimeout(() => inputs[0].current?.focus(), 80);
    }
  }, [open]);

  function onDigitChange(idx, raw) {
    const v = (raw || "").replace(/\D/g, "").slice(-1);
    setDigits(prev => {
      const next = [...prev];
      next[idx] = v;
      if (v && idx < PILOT_CODE_LENGTH - 1) inputs[idx + 1].current?.focus();
      // Auto-submit when last digit entered
      if (idx === PILOT_CODE_LENGTH - 1 && v && next.every(x => x)) {
        setTimeout(() => verify(next.join("")), 50);
      }
      return next;
    });
    setError("");
  }

  function onKeyDown(idx, e) {
    if (e.key === "Backspace" && !digits[idx] && idx > 0) {
      inputs[idx - 1].current?.focus();
    } else if (e.key === "ArrowLeft" && idx > 0) {
      inputs[idx - 1].current?.focus();
    } else if (e.key === "ArrowRight" && idx < PILOT_CODE_LENGTH - 1) {
      inputs[idx + 1].current?.focus();
    } else if (e.key === "Enter") {
      verify(digits.join(""));
    }
  }

  function onPaste(e) {
    e.preventDefault();
    const txt = (e.clipboardData?.getData("text") || "").replace(/\D/g, "").slice(0, PILOT_CODE_LENGTH);
    if (!txt) return;
    const next = Array(PILOT_CODE_LENGTH).fill("");
    for (let i = 0; i < txt.length; i++) next[i] = txt[i];
    setDigits(next);
    inputs[Math.min(PILOT_CODE_LENGTH - 1, txt.length - 1)].current?.focus();
    if (txt.length === PILOT_CODE_LENGTH) setTimeout(() => verify(txt), 50);
  }

  async function verify(code) {
    if (!pilot) return;
    // Server verifies the hashed code, records the attempt, and enforces the
    // lockout — the code never leaves the device in plaintext beyond this call.
    const { data, error: rpcErr } = await supabase.rpc("verify_pilot_code", {
      p_pilot: pilot.id, p_code: code, p_context: context || "mission",
    });
    if (rpcErr) { setError("Could not verify code — check your connection and try again."); return; }

    if (data && data.ok) {
      onConfirmed && onConfirmed(pilot);
      onClose && onClose();
      return;
    }

    const newAttempts = attempts + 1;
    setAttempts(newAttempts);
    setShake(true);
    setTimeout(() => setShake(false), 400);
    setDigits(Array(PILOT_CODE_LENGTH).fill(""));
    inputs[0].current?.focus();

    if (data && data.locked) {
      setLockedUntil(data.locked_until ? new Date(data.locked_until).getTime() : Date.now() + LOCKOUT_MIN * 60000);
      setError(`Account locked for ${LOCKOUT_MIN} minutes. Notify your supervisor.`);
    } else {
      const rem = data ? data.attempts_remaining : (MAX_ATTEMPTS - newAttempts);
      setError(`Incorrect code — ${rem} attempt${rem === 1 ? "" : "s"} remaining.`);
    }
  }

  if (!open || !pilot) return null;
  const accent = accentColor || "var(--accent)";

  return (
    <Modal open onClose={onClose} size="sm"
      title={<span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
        <Icon name="shield" size={16}/>
        Confirm pilot identity
      </span>}
      subtitle={`Enter your 6-digit pilot code to launch — ${context || "mission"}`}>

      <style>{`@keyframes paShake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-6px); } 75% { transform: translateX(6px); } }`}</style>

      {/* Pilot in command card */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: 12, borderRadius: 10, marginBottom: 18,
        background: `color-mix(in oklab, ${pilot.color} 8%, transparent)`,
        border: `1px solid color-mix(in oklab, ${pilot.color} 30%, transparent)`,
      }}>
        <div className="user-avatar" style={{ width: 38, height: 38, fontSize: 13, background: `linear-gradient(135deg, ${pilot.color}, color-mix(in oklab, ${pilot.color} 70%, #000))` }}>{pilot.initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{pilot.name}</div>
          <div className="mono muted" style={{ fontSize: 11, marginTop: 2 }}>{pilot.license || "—"} · {pilot.shortId || ""}</div>
        </div>
        <Icon name="shield" size={16} stroke={pilot.color}/>
      </div>

      {/* Code input */}
      {isLocked ? (
        <div style={{
          padding: 18, borderRadius: 10,
          background: "color-mix(in oklab, var(--danger) 10%, transparent)",
          border: "1px solid var(--danger)", textAlign: "center"
        }}>
          <Icon name="warn" size={28} stroke="var(--danger)"/>
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 10, color: "var(--danger)" }}>
            Account locked
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 6, lineHeight: 1.5 }}>
            Too many failed attempts. {pilot.name} can try again in <strong>{lockoutMinsLeft} minute{lockoutMinsLeft === 1 ? "" : "s"}</strong>.
            <br/>For an immediate override, notify your supervisor.
          </div>
        </div>
      ) : (
        <>
          <div style={{
            display: "flex", gap: 8, justifyContent: "center", marginBottom: 14,
            animation: shake ? "paShake 0.4s" : "none"
          }} onPaste={onPaste}>
            {digits.map((d, i) => (
              <input
                key={i}
                ref={inputs[i]}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={1}
                value={d}
                onChange={e => onDigitChange(i, e.target.value)}
                onKeyDown={e => onKeyDown(i, e)}
                style={{
                  width: 44, height: 56,
                  textAlign: "center",
                  fontSize: 24, fontWeight: 600,
                  fontFamily: "var(--font-mono)",
                  border: `1.5px solid ${error ? "var(--danger)" : d ? accent : "var(--border)"}`,
                  background: "var(--surface)",
                  color: "var(--text)",
                  borderRadius: 10,
                  outline: "none",
                  transition: "border-color 0.1s",
                  caretColor: accent,
                }}
              />
            ))}
          </div>

          {error ? (
            <div style={{
              padding: "8px 12px", borderRadius: 6,
              background: "color-mix(in oklab, var(--danger) 8%, transparent)",
              border: "1px solid color-mix(in oklab, var(--danger) 30%, transparent)",
              color: "var(--danger)", fontSize: 12, marginBottom: 14,
              display: "flex", alignItems: "center", gap: 8
            }}>
              <Icon name="warn" size={12}/> {error}
            </div>
          ) : (
            <div style={{ fontSize: 11.5, color: "var(--text-3)", textAlign: "center", marginBottom: 14 }}>
              {MAX_ATTEMPTS - attempts} attempt{MAX_ATTEMPTS - attempts === 1 ? "" : "s"} before lockout · paste to fill
            </div>
          )}

          {/* Forgot code → admin reset (codes are never revealed here). */}
          <div style={{ textAlign: "center", fontSize: 11, color: "var(--text-3)" }}>
            Forgot your code? An admin can reset it from the console.
          </div>
        </>
      )}

      <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

Object.assign(window, { PilotAuthModal, recordAuthEvent, readAuthLog, PILOT_CODE_LENGTH });
