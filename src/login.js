// Pilot Ops sign-in (real Supabase auth) + invite-accept registration.
// Drives the existing markup in login.html by element id.
import { supabase } from "./api/supabase.js";

const $ = (id) => document.getElementById(id);
const show = (el, on) => { if (el) el.style.display = on ? (el.classList.contains("login-error") ? "flex" : "block") : "none"; };

const form = $("login-form");
const errEl = $("error");
const errMsg = $("error-msg");
const submitBtn = $("submit");
const submitLabel = $("submit-label");

function fail(msg) { errMsg.textContent = msg; errEl.classList.add("show"); }
function clearFail() { errEl.classList.remove("show"); }
const initialsOf = (n) => (n || "U").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const genCode = () => String(Math.floor(100000 + Math.random() * 900000));

// Password show/hide (markup already wired in the prototype CSS)
$("pwd-toggle")?.addEventListener("click", function () {
  const i = $("password"); const pwd = i.type === "password";
  i.type = pwd ? "text" : "password";
});

// Remove the dead demo-fill button if present
$("demo-fill")?.remove();

// SSO buttons are not configured in v1 — make that explicit instead of silent.
document.querySelectorAll(".sso-btn").forEach((b) =>
  b.addEventListener("click", () => fail("Single sign-on isn't configured yet. Use your email and password.")));

// ---- invite mode ----------------------------------------------------------
const params = new URLSearchParams(location.search);
const inviteToken = params.get("invite");
let activeInvite = null;

function inviteError(title, msg) {
  show($("page-title"), false); show($("page-desc"), false); show(form, false);
  document.querySelector(".login-divider")?.style && (document.querySelector(".login-divider").style.display = "none");
  document.querySelector(".sso-row")?.style && (document.querySelector(".sso-row").style.display = "none");
  document.querySelector(".login-foot")?.style && (document.querySelector(".login-foot").style.display = "none");
  $("invite-error-title").textContent = title;
  $("invite-error-msg").textContent = msg;
  show($("invite-error"), true);
}
function fmtRemaining(ms) {
  if (ms <= 0) return "now";
  if (ms < 3600000) return Math.floor(ms / 60000) + "m";
  if (ms < 86400000) return Math.floor(ms / 3600000) + "h";
  const d = Math.floor(ms / 86400000); return d + " day" + (d === 1 ? "" : "s");
}

async function initInvite() {
  const { data: inv, error } = await supabase.rpc("get_invite", { p_token: inviteToken });
  if (error || !inv) return inviteError("Invitation link invalid", "This link is not recognized. Ask your admin to resend.");
  if (inv.status === "revoked")  return inviteError("Invitation revoked", "This invitation was revoked. Request a new one.");
  if (inv.status === "accepted") return inviteError("Already registered", "This invitation was already used. Sign in instead.");
  if (new Date(inv.expires_at).getTime() < Date.now()) return inviteError("Invitation expired", "Ask your admin to resend the invitation.");

  activeInvite = inv;
  supabase.rpc("mark_invite_opened", { p_token: inviteToken });

  $("page-title").textContent = "Complete your registration";
  $("page-desc").textContent = "You've been invited to join Pilot Ops. Set up your account below.";
  const banner = $("invite-banner"); banner.style.display = "flex";
  $("invite-banner-title").textContent = "Invited as " + (inv.roles || []).join(", ");
  $("invite-banner-sub").textContent =
    "Invited by " + (inv.invited_by_name || "your admin") + " · expires in " + fmtRemaining(new Date(inv.expires_at) - Date.now());
  const rolesEl = $("invite-roles"); rolesEl.innerHTML = "";
  (inv.roles || []).forEach((r) => { const s = document.createElement("span"); s.className = "invite-role-pill"; s.textContent = r; rolesEl.appendChild(s); });
  if (inv.message) { const m = $("invite-message"); m.style.display = "block"; m.textContent = "“" + inv.message + "”"; }

  show($("name-field"), true);
  const email = $("email"); email.value = inv.email; email.readOnly = true; email.style.color = "var(--text-3)";
  $("pwd-label").textContent = "Create a password";
  $("password").placeholder = "At least 8 characters"; $("password").setAttribute("autocomplete", "new-password");
  show($("pwd-hint"), true);
  $("submit-label").textContent = "Complete registration";
  $("remember-row")?.style && ($("remember-row").style.display = "none");
  document.querySelector(".login-divider")?.style && (document.querySelector(".login-divider").style.display = "none");
  document.querySelector(".sso-row")?.style && (document.querySelector(".sso-row").style.display = "none");
  document.querySelector(".login-foot").innerHTML = 'Already registered? <a href="/login.html">Sign in instead →</a>';
}

function revealCode(name, code) {
  show($("page-title"), false); show($("page-desc"), false); show($("invite-banner"), false);
  show(form, false); clearFail(); document.querySelector(".login-foot")?.style && (document.querySelector(".login-foot").style.display = "none");
  const reveal = $("code-reveal"); reveal.style.display = "block";
  $("code-reveal-name").textContent = "Account created for " + name + ". " + (code ? "Save your pilot code below." : "You can now sign in.");
  if (code) {
    $("code-display-wrap").style.display = "block";
    const d = $("code-display"); d.innerHTML = "";
    code.split("").forEach((ch) => { const e = document.createElement("div"); e.className = "code-digit"; e.textContent = ch; d.appendChild(e); });
  }
}

// ---- submit ---------------------------------------------------------------
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearFail();

  if (activeInvite) return handleRegister();

  const email = $("email").value.trim().toLowerCase();
  const pwd = $("password").value;
  submitBtn.disabled = true; submitLabel.innerHTML = '<span class="loading-spin"></span> Signing in…';
  const { error } = await supabase.auth.signInWithPassword({ email, password: pwd });
  if (error) { fail(error.message || "Incorrect email or password."); submitBtn.disabled = false; submitLabel.textContent = "Sign in"; return; }
  window.location.href = "/";
});

async function handleRegister() {
  const name = $("fullname").value.trim();
  const pwd = $("password").value;
  if (!name) return fail("Enter your full name.");
  if (pwd.length < 8 || !/\d/.test(pwd)) return fail("Password must be at least 8 characters with one number.");

  submitBtn.disabled = true; submitLabel.innerHTML = '<span class="loading-spin"></span> Creating account…';

  const initials = initialsOf(name);
  const { error: suErr } = await supabase.auth.signUp({
    email: activeInvite.email, password: pwd,
    options: { data: { full_name: name, initials } },
  });
  if (suErr) { fail(suErr.message); submitBtn.disabled = false; submitLabel.textContent = "Complete registration"; return; }

  // Ensure we have a session (autoconfirm on the server makes this immediate).
  let { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const { error: siErr } = await supabase.auth.signInWithPassword({ email: activeInvite.email, password: pwd });
    if (siErr) { fail("Account created — please sign in."); window.location.href = "/login.html"; return; }
  }

  try { await supabase.rpc("accept_invite", { p_token: inviteToken }); }
  catch (e) { /* roles assignment best-effort */ }

  const isPilot = (activeInvite.roles || []).some((r) => /pilot|field/i.test(r));
  let code = null;
  if (isPilot) {
    code = genCode();
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.rpc("set_pilot_code", { p_profile: user.id, p_code: code });
  }
  revealCode(name, code);
}

// ---- boot -----------------------------------------------------------------
(async () => {
  if (inviteToken) { await initInvite(); return; }
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    const foot = document.querySelector(".login-foot");
    if (foot) foot.innerHTML = 'Signed in · <a href="/">Continue to Pilot Ops →</a>';
  }
})();
