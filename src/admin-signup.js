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

  const { error: suErr } = await supabase.auth.signUp({
    email, password: pwd, options: { data: { full_name: name, initials: initialsOf(name) } },
  });
  if (suErr) { fail(suErr.message); submitBtn.disabled = false; submitLabel.textContent = "Create admin account"; return; }

  // Ensure a session (server autoconfirm makes this immediate).
  let { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const { error } = await supabase.auth.signInWithPassword({ email, password: pwd });
    if (error) { fail("Account created — please sign in."); window.location.href = "/admin-login.html"; return; }
  }

  // Create the org and become its admin (server-enforced).
  const { error: orgErr } = await supabase.rpc("create_org_and_claim", { p_name: orgName });
  if (orgErr) {
    fail(orgErr.message.includes("already belong") ? "This account already belongs to an organization." : orgErr.message);
    submitBtn.disabled = false; submitLabel.textContent = "Create admin account";
    return;
  }
  window.location.href = "/admin.html";
});
