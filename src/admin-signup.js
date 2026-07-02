// Admin sign-up — creates a NEW organization and makes you its first admin.
// Each organization is fully isolated (its own pilots, fleet, flights, data).
// Org + admin grant happen server-side via create_org_and_claim().
import { supabase } from "./api/supabase.js";

const $ = (id) => document.getElementById(id);
const form = $("signup-form");
const errEl = $("error"), errMsg = $("error-msg");
const submitBtn = $("submit"), submitLabel = $("submit-label");

function fail(msg) { errMsg.textContent = msg; errEl.classList.add("show"); }
const initialsOf = (n) => (n || "U").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

$("pwd-toggle")?.addEventListener("click", function () {
  const i = $("password"); i.type = i.type === "password" ? "text" : "password";
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errEl.classList.remove("show");
  const orgName = $("orgname").value.trim();
  const name = $("fullname").value.trim();
  const email = $("email").value.trim().toLowerCase();
  const pwd = $("password").value;
  if (!orgName) return fail("Enter an organization name.");
  if (!name) return fail("Enter your full name.");
  if (pwd.length < 8 || !/\d/.test(pwd)) return fail("Password must be at least 8 characters with one number.");

  submitBtn.disabled = true; submitLabel.innerHTML = '<span class="loading-spin"></span> Creating organization…';

  // The org name rides along in user_metadata so the org can be created on first
  // sign-in even if the project requires email confirmation first.
  const { error: suErr } = await supabase.auth.signUp({
    email, password: pwd,
    options: {
      data: { full_name: name, initials: initialsOf(name), pending_org_name: orgName },
      // After confirming their email, send them to admin sign-in, where the org
      // is created on first sign-in (see admin-login.js).
      emailRedirectTo: window.location.origin + "/admin-login.html",
    },
  });
  if (suErr) { fail(suErr.message); submitBtn.disabled = false; submitLabel.textContent = "Create admin account"; return; }

  // If email confirmation is enabled, signUp returns no session.
  let { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const { data: si } = await supabase.auth.signInWithPassword({ email, password: pwd });
    session = si?.session || null;
  }
  if (!session) { showConfirm(email); return; }   // must verify email → org created on first sign-in

  // Auto-confirmed → create the org and become its admin now.
  const { error: orgErr } = await supabase.rpc("create_org_and_claim", { p_name: orgName });
  if (orgErr) {
    fail(orgErr.message.includes("already belong") ? "This account already belongs to an organization." : orgErr.message);
    submitBtn.disabled = false; submitLabel.textContent = "Create admin account";
    return;
  }
  window.location.href = "/admin.html";
});

// Replace the form with a "check your email" confirmation message.
function showConfirm(email) {
  form.style.display = "none";
  errEl.classList.remove("show");
  const box = document.createElement("div");
  box.style.cssText = "text-align:center;padding:6px 0";
  const safe = document.createElement("strong"); safe.textContent = email;
  box.innerHTML =
    `<div style="width:46px;height:46px;border-radius:50%;background:color-mix(in oklab,var(--accent) 12%,transparent);color:var(--accent);display:grid;place-items:center;margin:0 auto 14px">` +
    `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"/><path d="M22 6l-10 7L2 6"/></svg></div>` +
    `<div style="font-size:16px;font-weight:600;margin-bottom:8px">Confirm your email</div>` +
    `<div style="font-size:13px;color:var(--text-2);line-height:1.6">We've sent a confirmation link to <strong>${safe.innerHTML}</strong>. Click it to verify your account, then sign in — your organization will be set up automatically.</div>` +
    `<div style="margin-top:18px"><a href="/admin-login.html" class="btn btn-primary" style="text-decoration:none;display:inline-block">Go to sign in</a></div>`;
  form.parentNode.insertBefore(box, form.nextSibling);
}
