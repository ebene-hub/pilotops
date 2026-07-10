// Platform (super-admin) sign-in. Password auth + a platform_admins membership
// check (via the auth_is_platform_admin RPC). Non-platform accounts are rejected
// even with valid credentials. Includes forgot-password + recovery (set-password)
// so a bootstrapped platform account can set its first password via an emailed link.
import { supabase } from "./api/supabase.js";

const $ = (id) => document.getElementById(id);
const errEl = $("error"), errMsg = $("error-msg");
const submitBtn = $("submit"), submitLabel = $("submit-label");

function fail(msg) { errMsg.textContent = msg; errEl.classList.add("show"); }

$("pwd-toggle")?.addEventListener("click", function () {
  const i = $("password"); i.type = i.type === "password" ? "text" : "password";
});

async function isPlatformAdmin() {
  const { data, error } = await supabase.rpc("auth_is_platform_admin");
  if (error) { console.warn("auth_is_platform_admin:", error.message); return false; }
  return data === true;
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  errEl.classList.remove("show");
  const email = $("email").value.trim().toLowerCase();
  const pwd = $("password").value;
  submitBtn.disabled = true; submitLabel.innerHTML = '<span class="loading-spin"></span> Verifying…';

  const { error } = await supabase.auth.signInWithPassword({ email, password: pwd });
  if (error) { fail(error.message || "Incorrect email or password."); submitBtn.disabled = false; submitLabel.textContent = "Sign in"; return; }

  if (!(await isPlatformAdmin())) {
    await supabase.auth.signOut();
    fail("This account isn't a platform operator.");
    submitBtn.disabled = false; submitLabel.textContent = "Sign in";
    return;
  }
  window.location.href = "/platform.html";
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

$("forgot")?.addEventListener("click", async (e) => {
  e.preventDefault();
  errEl.classList.remove("show");
  const email = $("email").value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { fail("Enter your email above first, then click “Forgot password?”."); $("email").focus(); return; }
  const link = e.currentTarget, prev = link.textContent;
  link.textContent = "Sending…"; link.style.pointerEvents = "none";
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/platform-login.html" });
  link.textContent = prev; link.style.pointerEvents = "";
  if (error) { fail(error.message || "Could not send the reset email."); return; }
  notice(`If a platform account exists for ${email}, a set-password link is on its way. Check your inbox (and spam).`);
});

// Handle the recovery link (tokens in the URL hash) → set-new-password form.
async function handleRecovery() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  if (hash.get("error")) {
    history.replaceState(null, "", location.pathname);
    fail((hash.get("error_description") || hash.get("error") || "This link is no longer valid.").replace(/\+/g, " "));
    return false;
  }
  if (hash.get("type") !== "recovery" || !hash.get("access_token")) return false;
  const { error } = await supabase.auth.setSession({
    access_token: hash.get("access_token"),
    refresh_token: hash.get("refresh_token") || "",
  });
  history.replaceState(null, "", location.pathname);
  if (error) { fail("This link is invalid or has expired. Request a new one."); return false; }
  showResetForm();
  return true;
}

function showResetForm() {
  const loginForm = $("login-form");
  if (loginForm) loginForm.style.display = "none";
  const foot = document.querySelector(".login-foot"); if (foot) foot.style.display = "none";
  const title = document.querySelector(".login-title"); if (title) title.textContent = "Set a new password";
  const desc = document.querySelector(".login-desc"); if (desc) desc.textContent = "Choose a password for your platform account, then sign in.";

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
    setTimeout(() => { location.href = "/platform-login.html"; }, 1600);
  });
}

// ---- boot: recovery first, else offer continue if already signed in --------
(async () => {
  if (await handleRecovery()) return;
  const { data: { session } } = await supabase.auth.getSession();
  if (session && (await isPlatformAdmin())) window.location.href = "/platform.html";
})();
