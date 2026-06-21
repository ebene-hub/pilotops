import { createClient } from "@supabase/supabase-js";

// Single shared Supabase client for the whole app (frontend, browser-safe).
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Surface misconfiguration early rather than failing deep in a query.
  console.error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — set them in .env");
}

// The Admin console (/admin*.html) and Pilot Ops (/, /login.html) are separate
// areas on the same origin. Give each its own auth storage key so signing out of
// one does NOT end the other's session — and you can be signed into both
// independently (e.g. admin console + a pilot session in the same browser).
const isAdminArea = typeof location !== "undefined" && /admin/i.test(location.pathname);
const storageKey = isAdminArea ? "po-auth-admin" : "po-auth-pilot";

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey },
});

// Also expose on window so the global-script view modules (which don't import)
// can reach the client for mutations.
if (typeof window !== "undefined") window.__supabase = supabase;

// Convenience: current auth user (or null).
export async function currentUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user || null;
}

// Safe profile columns — `select("*")` is denied to authenticated users because
// the pilot_code_hash column grant is revoked (see 0003_rls.sql).
export const PROFILE_COLS =
  "id, short_id, full_name, email, initials, color, license, status, is_admin, admin_role, flight_hours, last_active, pilot_code_set, created_at, updated_at, phone, dob, gov_id, license_class, license_expiry, job_title, kyc_status, kyc_submitted_at";

// Convenience: the signed-in user's profile row (or null).
export async function currentProfile() {
  const u = await currentUser();
  if (!u) return null;
  const { data } = await supabase.from("profiles").select(PROFILE_COLS).eq("id", u.id).single();
  return data || null;
}
