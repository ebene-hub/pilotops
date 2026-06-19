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
  const { data: profile } = await supabase.from("profiles").select("is_admin").eq("id", user.id).single();
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

// Already signed in as admin? offer continue.
(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    const foot = document.querySelector("#step-1 .login-foot");
    if (foot) foot.innerHTML = 'Signed in · <a href="/admin.html">Continue to Admin →</a>';
  }
})();
