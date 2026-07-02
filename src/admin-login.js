// Admin sign-in (real Supabase auth) with TOTP 2FA when a factor is enrolled.
// Drives the existing two-step markup in admin-login.html.
import { supabase } from "./api/supabase.js";

const $ = (id) => document.getElementById(id);
const errEl = $("error"), errMsg = $("error-msg");
const submitBtn = $("submit"), submitLabel = $("submit-label");
const err2fa = $("error-2fa"), submit2fa = $("submit-2fa"), submit2faLabel = $("submit-2fa-label");
const digits = Array.from(document.querySelectorAll(".twofa-digit"));

let factorId = null, challengeId = null;

function fail(msg) { errMsg.textContent = msg; errEl.classList.add("show"); }
function toStep2(email) {
  $("who-email").textContent = email;
  $("step-1").classList.remove("active"); $("step-2").classList.add("active");
  setTimeout(() => digits[0]?.focus(), 50);
}

$("pwd-toggle")?.addEventListener("click", function () {
  const i = $("password"); i.type = i.type === "password" ? "text" : "password";
});
$("demo-fill")?.remove();

async function afterPassword(email) {
  // Reject non-admins early (admin.html would bounce them anyway).
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from("profiles").select("is_admin, org_id").eq("id", user.id).single();
  // Founding admin who just confirmed their email: create their org now (the name
  // was stashed in user_metadata at sign-up). This makes them an admin.
  if (!profile?.org_id && user?.user_metadata?.pending_org_name) {
    const { error } = await supabase.rpc("create_org_and_claim", { p_name: user.user_metadata.pending_org_name });
    if (!error) { window.location.href = "/admin.html"; return; }
  }
  if (!profile?.is_admin) {
    await supabase.auth.signOut();
    fail("This isn't an admin account.");
    submitBtn.disabled = false; submitLabel.textContent = "Continue";
    return;
  }

  // If a verified TOTP factor exists, require it (AAL2). Otherwise allow in.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const totp = (factors?.totp || []).find((f) => f.status === "verified");
  if (totp) {
    factorId = totp.id;
    const { data: ch, error } = await supabase.auth.mfa.challenge({ factorId });
    if (error) { fail(error.message); submitBtn.disabled = false; submitLabel.textContent = "Continue"; return; }
    challengeId = ch.id;
    toStep2(email);
  } else {
    window.location.href = "/admin.html";
  }
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  errEl.classList.remove("show");
  const email = $("email").value.trim().toLowerCase();
  const pwd = $("password").value;
  submitBtn.disabled = true; submitLabel.innerHTML = '<span class="loading-spin"></span> Verifying…';

  const { error } = await supabase.auth.signInWithPassword({ email, password: pwd });
  if (error) { fail(error.message || "Incorrect email or password."); submitBtn.disabled = false; submitLabel.textContent = "Continue"; return; }
  await afterPassword(email);
});

// 2FA digit inputs: auto-advance, backspace, paste, enter
digits.forEach((d) => {
  d.addEventListener("input", (e) => {
    const v = (e.target.value || "").replace(/\D/g, "").slice(-1);
    e.target.value = v;
    const idx = +e.target.dataset.idx;
    if (v && idx < 5) digits[idx + 1].focus();
    if (idx === 5 && v && digits.every((x) => x.value)) verify2fa();
  });
  d.addEventListener("keydown", (e) => {
    const idx = +e.target.dataset.idx;
    if (e.key === "Backspace" && !e.target.value && idx > 0) digits[idx - 1].focus();
    else if (e.key === "Enter") verify2fa();
  });
  d.addEventListener("paste", (e) => {
    e.preventDefault();
    const txt = (e.clipboardData?.getData("text") || "").replace(/\D/g, "").slice(0, 6);
    if (!txt) return;
    digits.forEach((dd, i) => { dd.value = txt[i] || ""; });
    digits[Math.min(5, txt.length - 1)].focus();
    if (txt.length === 6) verify2fa();
  });
});

async function verify2fa() {
  err2fa.classList.remove("show");
  const code = digits.map((d) => d.value).join("");
  if (code.length !== 6) return;
  submit2fa.disabled = true; submit2faLabel.innerHTML = '<span class="loading-spin"></span> Signing in…';

  const { error } = await supabase.auth.mfa.verify({ factorId, challengeId, code });
  if (error) {
    err2fa.classList.add("show");
    digits.forEach((d) => (d.value = "")); digits[0].focus();
    submit2fa.disabled = false; submit2faLabel.textContent = "Sign in";
    return;
  }
  window.location.href = "/admin.html";
}
submit2fa.addEventListener("click", verify2fa);
$("back-btn").addEventListener("click", () => {
  $("step-2").classList.remove("active"); $("step-1").classList.add("active");
  digits.forEach((d) => (d.value = "")); err2fa.classList.remove("show");
});

// ---- forgot / reset password ----------------------------------------------
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

// Step 1: email the reset link to the admin.
$("forgot")?.addEventListener("click", async (e) => {
  e.preventDefault();
  errEl.classList.remove("show");
  const email = $("email").value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    fail("Enter your email above first, then click “Forgot password?”.");
    $("email").focus();
    return;
  }
  const link = e.currentTarget, prev = link.textContent;
  link.textContent = "Sending…"; link.style.pointerEvents = "none";
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/admin-login.html" });
  link.textContent = prev; link.style.pointerEvents = "";
  if (error) { fail(error.message || "Could not send the reset email. Please try again shortly."); return; }
  notice(`If an admin account exists for ${email}, a password-reset link is on its way. Check your inbox (and spam).`);
});

// Step 2: handle the recovery link (tokens in the URL hash) → set-new-password.
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
  history.replaceState(null, "", location.pathname);
  if (error) { fail("This reset link is invalid or has expired. Request a new one."); return false; }
  showResetForm();
  return true;
}

function showResetForm() {
  const loginForm = $("login-form");
  if (loginForm) loginForm.style.display = "none";
  document.querySelectorAll("#step-1 .login-foot").forEach((el) => (el.style.display = "none"));
  const remember = document.querySelector("#step-1 .remember-row"); if (remember) remember.style.display = "none";
  const title = document.querySelector("#step-1 .login-title"); if (title) title.textContent = "Set a new password";
  const desc = document.querySelector("#step-1 .login-desc"); if (desc) desc.textContent = "Choose a new password for your admin account, then sign in.";

  const rf = document.createElement("form");
  rf.className = "field-stack"; rf.id = "reset-form";
  rf.innerHTML =
    '<div class="field"><label class="field-label" for="np">New password</label>' +
    '<div class="input-wrap"><input id="np" class="input" type="password" placeholder="At least 8 characters" autocomplete="new-password" required/></div></div>' +
    '<div class="field"><label class="field-label" for="np2">Confirm new password</label>' +
    '<div class="input-wrap"><input id="np2" class="input" type="password" placeholder="Re-enter password" autocomplete="new-password" required/></div></div>' +
    '<button type="submit" class="btn btn-primary login-submit"><span id="reset-label">Update password</span></button>';
  errEl.parentNode.insertBefore(rf, errEl.nextSibling);

  rf.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.classList.remove("show");
    const p1 = $("np").value, p2 = $("np2").value;
    if (p1.length < 8 || !/\d/.test(p1)) return fail("Password must be at least 8 characters with one number.");
    if (p1 !== p2) return fail("Those passwords don't match.");
    const btn = rf.querySelector("button"), lbl = $("reset-label");
    btn.disabled = true; lbl.innerHTML = '<span class="loading-spin"></span> Updating…';
    const { error } = await supabase.auth.updateUser({ password: p1 });
    if (error) { fail(error.message || "Could not update your password."); btn.disabled = false; lbl.textContent = "Update password"; return; }
    rf.remove();
    if (title) title.textContent = "Password updated";
    if (desc) desc.textContent = "Sign in with your new password.";
    notice("Your password has been updated. Redirecting to sign in…");
    await supabase.auth.signOut();
    setTimeout(() => { location.href = "/admin-login.html"; }, 1600);
  });
}

// ---- boot: recovery first, else offer continue if already signed in --------
(async () => {
  if (await handleRecovery()) return;
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    const foot = document.querySelector("#step-1 .login-foot");
    if (foot) foot.innerHTML = 'Signed in · <a href="/admin.html">Continue to Admin →</a>';
  }
})();
