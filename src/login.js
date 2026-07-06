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
  // KYC: everyone provides phone + job title; operating crew also provide
  // license + DOB/gov-ID. Crew is determined by the invited roles.
  const isCrew = (inv.roles || []).some((r) => /pilot/i.test(r));
  $("kyc-fields").style.display = "block";
  $("kyc-crew").style.display = isCrew ? "block" : "none";
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
  // KYC verification gate: tell the new member they need admin approval first.
  const note = document.createElement("p");
  note.style.cssText = "margin-top:14px;font-size:12.5px;color:var(--text-3);line-height:1.5;";
  note.textContent = code
    ? "Your details are pending verification by an admin. Once verified you'll be able to start missions."
    : "Your details are pending verification by an admin.";
  $("code-reveal").appendChild(note);
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
  // First sign-in after confirming an invite → finalize and reveal the code.
  const { data: { user } } = await supabase.auth.getUser();
  const fin = await finalizePendingInvite(user);
  if (fin) { revealCode(fin.name, fin.code); return; }
  window.location.href = "/";
});

async function handleRegister() {
  const name = $("fullname").value.trim();
  const pwd = $("password").value;
  if (!name) return fail("Enter your full name.");
  if (pwd.length < 8 || !/\d/.test(pwd)) return fail("Password must be at least 8 characters with one number.");

  const isCrew = (activeInvite.roles || []).some((r) => /pilot/i.test(r));
  const kyc = {
    phone: $("kyc-phone").value.trim(),
    job_title: $("kyc-title").value.trim(),
    dob: $("kyc-dob").value || null,
    gov_id: $("kyc-govid").value.trim(),
    license: $("kyc-license").value.trim(),
    license_class: $("kyc-license-class").value.trim(),
    license_expiry: $("kyc-license-expiry").value || null,
  };
  if (!kyc.phone) return fail("Enter your phone number.");
  if (isCrew) {
    if (!kyc.dob) return fail("Enter your date of birth.");
    if (!kyc.gov_id) return fail("Enter your government ID number.");
    if (!kyc.license) return fail("Enter your remote-pilot license number.");
    if (!kyc.license_class) return fail("Enter your license class / rating.");
    if (!kyc.license_expiry) return fail("Enter your license expiry date.");
  }

  submitBtn.disabled = true; submitLabel.innerHTML = '<span class="loading-spin"></span> Creating account…';

  const initials = initialsOf(name);
  // Operating crew get a pilot launch code. Email confirmation is required, so
  // signUp returns no session — there's nothing to write to yet. Generate the
  // code now and stash it (with KYC + the invite token) in user_metadata; a
  // finalizer applies everything on the member's first sign-in AFTER they
  // confirm their email (see finalizePendingInvite).
  const pilotCode = isCrew ? genCode() : null;
  const { data: suData, error: suErr } = await supabase.auth.signUp({
    email: activeInvite.email, password: pwd,
    options: {
      data: {
        full_name: name, initials,
        pending_invite_token: inviteToken,
        pending_kyc: kyc,
        pending_pilot_code: pilotCode,
      },
      // After confirming, land on this sign-in page; the finalizer runs on sign-in.
      emailRedirectTo: window.location.origin + "/login.html",
    },
  });
  if (suErr) { fail(suErr.message); submitBtn.disabled = false; submitLabel.textContent = "Complete registration"; return; }

  // Enumeration-safe signal: when the email is already registered, Supabase
  // returns a user with an empty identities array and does NOT set the new
  // password or refresh metadata. Silently "succeeding" here would leave the
  // member unable to sign in. Tell them to sign in / reset instead.
  if (suData?.user && Array.isArray(suData.user.identities) && suData.user.identities.length === 0) {
    submitBtn.disabled = false; submitLabel.textContent = "Complete registration";
    return fail("An account with this email already exists. Sign in with your existing password — your invite is applied automatically once you're in. Forgot it? Use “Forgot password?” to reset.");
  }

  // Confirmation required → no session yet. Tell them to check their email.
  let { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const { data: si } = await supabase.auth.signInWithPassword({ email: activeInvite.email, password: pwd });
    session = si?.session || null;
  }
  if (!session) { showInviteConfirm(activeInvite.email); return; }

  // Project autoconfirms → finalize now and reveal the code immediately.
  const { data: { user } } = await supabase.auth.getUser();
  const fin = await finalizePendingInvite(user);
  revealCode(fin?.name || name, fin?.code ?? pilotCode);
}

// Runs on the member's first authenticated sign-in after they confirm their
// email: accepts the invite (role assignment), saves the KYC they entered at
// registration, and sets the stashed pilot code. Returns { name, code } to
// reveal, or null if this account has nothing pending.
async function finalizePendingInvite(user) {
  // Accept the invite server-side, keyed by the signed-in user's email — robust
  // even if the stashed token was lost. Idempotent. NOTE: supabase.rpc resolves
  // with { error } on failure (it does NOT throw), so we must check .error.
  const { data: fin, error: finErr } = await supabase.rpc("finalize_my_invite");
  if (finErr) console.warn("finalize_my_invite failed:", finErr.message);

  const md = user?.user_metadata || {};
  const hadOnboarding = !!(md.pending_invite_token || md.pending_kyc || md.pending_pilot_code);
  // Nothing stashed and no invite accepted just now → this isn't an invited member.
  if (!hadOnboarding && !(fin && fin.accepted)) return null;

  // Save the KYC entered at registration. Status stays 'pending' until an admin
  // verifies — kyc_status/kyc_submitted_at are admin/server-set.
  if (md.pending_kyc) {
    const k = md.pending_kyc;
    const { error: kycErr } = await supabase.from("profiles").update({
      phone: k.phone || null, job_title: k.job_title || null,
      dob: k.dob || null, gov_id: k.gov_id || null,
      license: k.license || null, license_class: k.license_class || null,
      license_expiry: k.license_expiry || null,
    }).eq("id", user.id);
    if (kycErr) console.warn("KYC save failed:", kycErr.message);
  }

  // Set the pilot launch code (crew only).
  const code = md.pending_pilot_code || null;
  if (code) {
    const { error: pcErr } = await supabase.rpc("set_pilot_code", { p_profile: user.id, p_code: code });
    if (pcErr) console.warn("set_pilot_code failed:", pcErr.message);
  }

  // Clear the one-shot invite/KYC stash. Keep pending_pilot_code so the member can
  // still see their code on the pending-verification screen until an admin verifies.
  await supabase.auth.updateUser({ data: { pending_invite_token: null, pending_kyc: null } });

  return { name: md.full_name || user.email, code };
}

// "Check your email" screen shown after an invited member registers.
function showInviteConfirm(email) {
  show($("page-title"), false); show($("page-desc"), false); show($("invite-banner"), false);
  show(form, false); clearFail();
  const foot = document.querySelector(".login-foot"); if (foot) foot.innerHTML = 'Confirmed already? <a href="/login.html">Sign in →</a>';
  const reveal = $("code-reveal"); reveal.style.display = "block";
  const wrap = $("code-display-wrap"); if (wrap) wrap.style.display = "none";
  $("code-reveal-name").textContent = "Confirm your email";
  const note = document.createElement("p");
  note.style.cssText = "margin-top:12px;font-size:13px;color:var(--text-2);line-height:1.6;";
  const strong = document.createElement("strong"); strong.textContent = email;
  note.append("We've sent a confirmation link to ", strong,
    ". Click it to verify your email, then sign in with the password you just chose — your pilot launch code and details will be set up automatically.");
  reveal.appendChild(note);
}

// ---- forgot / reset password ----------------------------------------------
// Green info notice (success states) — distinct from the red error box.
function notice(msg) {
  let n = $("notice");
  if (!n) {
    n = document.createElement("div");
    n.id = "notice";
    n.style.cssText = "font-size:12.5px;line-height:1.5;padding:11px 13px;border-radius:9px;margin:0 0 16px;" +
      "background:color-mix(in oklab,#16a34a 13%,transparent);color:#16a34a;";
    errEl.parentNode.insertBefore(n, errEl);
  }
  n.textContent = msg; n.style.display = "block";
}

// Step 1: email the reset link. Uses the email already typed in the form.
$("forgot")?.addEventListener("click", async (e) => {
  e.preventDefault();
  clearFail();
  const email = $("email").value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    fail("Enter your email above first, then click “Forgot password?”.");
    $("email").focus();
    return;
  }
  const link = e.currentTarget, prev = link.textContent;
  link.textContent = "Sending…"; link.style.pointerEvents = "none";
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/login.html" });
  link.textContent = prev; link.style.pointerEvents = "";
  if (error) { fail(error.message || "Could not send the reset email. Please try again shortly."); return; }
  notice(`If an account exists for ${email}, a password-reset link is on its way. Check your inbox (and spam).`);
});

// Step 2: the user followed the email link → tokens arrive in the URL hash.
// detectSessionInUrl is off, so set the recovery session manually, then show a
// "set new password" form.
async function handleRecovery() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  if (hash.get("error")) {
    history.replaceState(null, "", location.pathname);
    fail((hash.get("error_description") || hash.get("error") || "This reset link is no longer valid.").replace(/\+/g, " "));
    return false;
  }
  if (hash.get("type") !== "recovery" || !hash.get("access_token")) return false;
  const { error } = await supabase.auth.setSession({
    access_token: hash.get("access_token"),
    refresh_token: hash.get("refresh_token") || "",
  });
  history.replaceState(null, "", location.pathname);   // strip tokens from the address bar
  if (error) { fail("This reset link is invalid or has expired. Request a new one."); return false; }
  showResetForm();
  return true;
}

function showResetForm() {
  show($("invite-banner"), false);
  show(form, false);
  const hide = (sel) => { const el = document.querySelector(sel); if (el) el.style.display = "none"; };
  hide(".login-divider"); hide(".sso-row"); hide(".login-foot");
  if ($("remember-row")) $("remember-row").style.display = "none";
  if ($("page-title")) $("page-title").textContent = "Set a new password";
  if ($("page-desc")) $("page-desc").textContent = "Choose a new password for your account, then sign in.";

  const rf = document.createElement("form");
  rf.className = "field-stack"; rf.id = "reset-form";
  rf.innerHTML =
    '<div class="field"><label class="field-label" for="np">New password</label>' +
    '<div class="input-wrap"><input id="np" class="input" type="password" placeholder="At least 8 characters" autocomplete="new-password" required/></div></div>' +
    '<div class="field"><label class="field-label" for="np2">Confirm new password</label>' +
    '<div class="input-wrap"><input id="np2" class="input" type="password" placeholder="Re-enter password" autocomplete="new-password" required/></div></div>' +
    '<button type="submit" class="btn btn-primary login-submit"><span id="reset-label">Update password</span></button>';
  form.parentNode.insertBefore(rf, form.nextSibling);

  rf.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFail();
    const p1 = $("np").value, p2 = $("np2").value;
    if (p1.length < 8 || !/\d/.test(p1)) return fail("Password must be at least 8 characters with one number.");
    if (p1 !== p2) return fail("Those passwords don't match.");
    const btn = rf.querySelector("button"), lbl = $("reset-label");
    btn.disabled = true; lbl.innerHTML = '<span class="loading-spin"></span> Updating…';
    const { error } = await supabase.auth.updateUser({ password: p1 });
    if (error) { fail(error.message || "Could not update your password."); btn.disabled = false; lbl.textContent = "Update password"; return; }
    rf.remove();
    if ($("page-title")) $("page-title").textContent = "Password updated";
    if ($("page-desc")) $("page-desc").textContent = "Sign in with your new password.";
    notice("Your password has been updated. Redirecting to sign in…");
    await supabase.auth.signOut();
    setTimeout(() => { location.href = "/login.html"; }, 1600);
  });
}

// ---- boot -----------------------------------------------------------------
(async () => {
  if (await handleRecovery()) return;
  if (inviteToken) { await initInvite(); return; }
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    const { data: { user } } = await supabase.auth.getUser();
    const fin = await finalizePendingInvite(user);
    if (fin) { revealCode(fin.name, fin.code); return; }
    const foot = document.querySelector(".login-foot");
    if (foot) foot.innerHTML = 'Signed in · <a href="/">Continue to Pilot Ops →</a>';
  }
})();
