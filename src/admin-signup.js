// Admin sign-up — secure first-run bootstrap. Creates the organization's FIRST
// admin only; once an admin exists the page shows a "closed" state. Admin status
// is granted server-side via claim_first_admin() (never from client metadata).
import { supabase } from "./api/supabase.js";

const $ = (id) => document.getElementById(id);
const form = $("signup-form");
const errEl = $("error"), errMsg = $("error-msg");
const submitBtn = $("submit"), submitLabel = $("submit-label");

function fail(msg) { errMsg.textContent = msg; errEl.classList.add("show"); }
const initialsOf = (n) => (n || "U").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
function showClosed() { $("signup").style.display = "none"; $("closed").style.display = "block"; }

$("pwd-toggle")?.addEventListener("click", function () {
  const i = $("password"); i.type = i.type === "password" ? "text" : "password";
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errEl.classList.remove("show");
  const name = $("fullname").value.trim();
  const email = $("email").value.trim().toLowerCase();
  const pwd = $("password").value;
  if (!name) return fail("Enter your full name.");
  if (pwd.length < 8 || !/\d/.test(pwd)) return fail("Password must be at least 8 characters with one number.");

  submitBtn.disabled = true; submitLabel.innerHTML = '<span class="loading-spin"></span> Creating account…';

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

  // Claim the first-admin slot (server enforces "only if none exists").
  const { data: claimed, error: claimErr } = await supabase.rpc("claim_first_admin");
  if (claimErr) { fail(claimErr.message); submitBtn.disabled = false; submitLabel.textContent = "Create admin account"; return; }
  if (claimed) {
    window.location.href = "/admin.html";
  } else {
    // Someone became admin first — this account is a normal user.
    await supabase.auth.signOut();
    submitBtn.disabled = false; submitLabel.textContent = "Create admin account";
    showClosed();
  }
});

// On load, gate the form on whether an admin already exists.
(async () => {
  const { data: exists } = await supabase.rpc("admin_exists");
  if (exists) showClosed();
})();
