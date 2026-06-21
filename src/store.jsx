// Bootstrap store — loads real data from Supabase and maps it into the exact
// global shapes the views already read (the `data.js` contract). Populating
// `window.*` BEFORE the app mounts keeps the prototype's read pattern intact;
// mutations (Phase 2) write via Supabase and refresh().
import { supabase, PROFILE_COLS } from "./api/supabase.js";

const PALETTE = ["#2563eb", "#0891b2", "#7c3aed", "#16a34a", "#d97706", "#db2777", "#0d9488", "#dc2626", "#94a3b8"];
const colorFor = (id) => PALETTE[Math.abs(hash(id || "")) % PALETTE.length];
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
const initialsOf = (name) => (name || "U").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

function fmtClock(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
}
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
const dateLabel = (iso) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

async function safe(promise, fallback) {
  try { const { data, error } = await promise; if (error) throw error; return data ?? fallback; }
  catch (e) { console.warn("[store] load failed:", e?.message || e); return fallback; }
}

// ---- mappers: DB row -> legacy global shape -------------------------------
function mapProfile(p) {
  const roles = (p.member_roles || []).map((mr) => mr.roles?.name).filter(Boolean);
  return {
    id: p.id, shortId: p.short_id || "", name: p.full_name, email: p.email,
    initials: p.initials || initialsOf(p.full_name),
    color: p.color || colorFor(p.id), license: p.license || "",
    role: roles[0] || (p.is_admin ? "Director" : "Member"),
    roles, status: p.status, hours: Number(p.flight_hours || 0), missions: 0,
    isAdmin: p.is_admin, hasCode: !!p.pilot_code_set,
    kycStatus: p.kyc_status || "verified", phone: p.phone || "",
    dob: p.dob || "", govId: p.gov_id || "", licenseClass: p.license_class || "",
    licenseExpiry: p.license_expiry || "", jobTitle: p.job_title || "",
  };
}
function mapStation(s) { return { id: s.id, code: s.code, name: s.name, coords: s.coords, lat: s.lat, lng: s.lng }; }
function mapAircraft(a, batteries) {
  const batt = (batteries || []).filter((b) => b.aircraft_id === a.id);
  const charge = batt.length ? Math.round(batt.reduce((s, b) => s + (b.charge || 0), 0) / batt.length) : 0;
  const serviceIn = a.next_service ? Math.ceil((new Date(a.next_service) - Date.now()) / 86400000) : 0;
  return {
    id: a.code || a.id, dbId: a.id, model: a.model, serial: a.serial, payload: a.payload,
    status: a.status, homeStation: a.home_station, primaryPilot: a.primary_pilot,
    inService: a.in_service, nextService: a.next_service, lastService: a.in_service, serviceIn,
    hours: Number(a.flight_hours || 0), flights: 0, cycles: 0, location: "", assignedPilot: "—",
    alert: serviceIn < 0 ? "Service overdue" : null,
    notes: a.notes, battery: charge, batteries: batt.map(mapBattery),
  };
}
function mapBattery(b) {
  return {
    id: b.code || b.id, dbId: b.id, aircraft: b.aircraft_id, capacity: b.capacity_mah,
    cycleRating: b.cycle_rating, maxCycles: b.cycle_rating || 500, cycles: b.cycles || 0,
    health: b.health, charge: b.charge, status: b.status, temp: null,
    lastCharge: b.last_updated_at ? new Date(b.last_updated_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—",
    lastUpdatedBy: b.last_updated_by, lastUpdated: b.last_updated_at, notes: b.notes,
  };
}
function mapFlight(f, liveSet) {
  const pilot = f.pilot ? mapProfile(f.pilot) : null;
  const uav = f.aircraft ? { id: f.aircraft.code || f.aircraft.id, model: f.aircraft.model, payload: f.aircraft.payload } : null;
  const station = f.station ? mapStation(f.station) : null;
  const started = f.started_at;
  return {
    id: f.code || f.id, dbId: f.id, pilot, uav, station,
    area: f.area, coverageKm: Number(f.coverage_km || 0),
    duration: started ? fmtClock(Date.now() - new Date(started).getTime()) : "00:00:00",
    started: hhmm(started), status: f.status, altitude: f.altitude || 0,
    speed: 0, signal: 90, lat: f.cur_lat ?? f.launch_lat, lng: f.cur_lng ?? f.launch_lng,
    emergency: f.emergency, emergencyType: f.emergency_type, justification: f.justification,
    streamStatus: f.stream_status || "offline", streamStartedAt: f.stream_started_at || null,
  };
}

// ---- the bootstrap --------------------------------------------------------
export async function bootstrap() {
  const [
    profilesRaw, stations, aircraftRaw, batteriesRaw, maintenanceRaw, stakeholdersRaw,
    flightsRaw, incidentsRaw, reportsRaw, logbookRaw, currenciesRaw, mediaRaw,
    sectorsRaw, coverageRaw, purposesRaw, fieldCfgRaw, rolesRaw,
  ] = await Promise.all([
    safe(supabase.from("profiles").select(`${PROFILE_COLS}, member_roles(roles(name))`), []),
    safe(supabase.from("stations").select("*").order("name"), []),
    safe(supabase.from("aircraft").select("*").order("created_at"), []),
    safe(supabase.from("batteries").select("*").order("created_at"), []),
    safe(supabase.from("maintenance").select("*").order("due"), []),
    safe(supabase.from("stakeholders").select("*").order("name"), []),
    safe(supabase.from("flights").select(`*, pilot:pilot_id(${PROFILE_COLS}, member_roles(roles(name))), aircraft:aircraft_id(*), station:station_id(*)`).order("created_at", { ascending: false }), []),
    safe(supabase.from("incidents").select("*, reporter:reporter_id(full_name)").order("created_at", { ascending: false }), []),
    safe(supabase.from("reports").select("*, author:author_id(full_name)").order("created_at", { ascending: false }), []),
    safe(supabase.from("logbook_entries").select("*").order("date", { ascending: false }), []),
    safe(supabase.from("currencies").select("*"), []),
    safe(supabase.from("media").select("*").order("created_at", { ascending: false }), []),
    safe(supabase.from("sectors").select("*"), []),
    safe(supabase.from("coverage_areas").select("*").order("sort"), []),
    safe(supabase.from("purposes").select("*").order("sort"), []),
    safe(supabase.from("form_field_config").select("*"), []),
    safe(supabase.from("roles").select("*").order("name"), []),
  ]);

  // Members & invites (invites are admin-RLS — pilots just get []).
  const invitesRaw = await safe(supabase.from("invites").select("*").order("created_at", { ascending: false }), []);

  const profiles = profilesRaw.map(mapProfile);
  const liveSet = new Set(flightsRaw.filter((f) => f.status === "live").map((f) => f.pilot_id));
  const pilots = profiles
    .filter((p) => p.roles.includes("Pilot") || p.roles.includes("Co-pilot") || p.roles.includes("Mission Commander"))
    .map((p) => ({ ...p, status: liveSet.has(p.id) ? "in-flight" : p.status === "active" ? "standby" : p.status }));

  const aircraft = aircraftRaw.map((a) => mapAircraft(a, batteriesRaw));
  const batteries = batteriesRaw.map(mapBattery);

  const flights = flightsRaw.map((f) => mapFlight(f, liveSet));
  const activeFlights = flights.filter((f) => f.status === "live");

  // Real per-flight hours (completed flights) for the live pilot-performance
  // dashboard — duration from started→ended; day/night by launch hour.
  const flightHours = flightsRaw
    .filter((f) => f.started_at && f.ended_at)
    .map((f) => {
      const start = new Date(f.started_at), end = new Date(f.ended_at);
      const h = start.getHours();
      return { date: f.ended_at, minutes: Math.max(0, (end - start) / 60000), night: (h < 6 || h >= 18), pilotId: f.pilot_id };
    });
  const recentFlights = flightsRaw
    .filter((f) => f.status === "completed" || f.status === "flagged")
    .slice(0, 12)
    .map((f) => ({
      id: f.code || f.id, dbId: f.id, pilot: f.pilot?.full_name || "—",
      date: dateLabel(f.ended_at || f.created_at),
      duration: f.started_at && f.ended_at ? fmtClock(new Date(f.ended_at) - new Date(f.started_at)) : "—",
      area: f.area, incidents: 0, status: f.status,
    }));

  const incidents = incidentsRaw.map((i) => ({
    id: i.code || i.id, dbId: i.id, type: i.type, severity: i.severity, place: i.place,
    reporter: i.reporter?.full_name || "—", date: dateLabel(i.created_at),
    lat: i.lat, lng: i.lng, status: i.status, description: i.description,
  }));

  const reports = reportsRaw.map((r) => ({
    id: r.code || r.id, dbId: r.id, title: r.title, author: r.author?.full_name || "—",
    date: dateLabel(r.created_at), flights: r.flights, incidents: r.incidents, status: r.status, type: r.type,
  }));

  const media = mediaRaw.map((m) => ({
    id: m.id, name: m.name, type: m.type, size: m.size, dur: m.duration,
    pilot: m.pilot_id, flight: m.flight_id, area: m.area,
    date: dateLabel(m.created_at), tags: m.tags || [], starred: m.starred, path: m.storage_path,
  }));

  const sectors = {};
  sectorsRaw.forEach((s) => {
    sectors[s.id] = { label: s.label, units: s.units || {}, incidentTypes: s.incident_types || [], samplePlaces: s.sample_places || [] };
  });
  if (!Object.keys(sectors).length) sectors.generic = { label: "Multi-sector", units: { area: "km²", asset: "asset" }, incidentTypes: [], samplePlaces: [] };

  const fieldConfig = {};
  fieldCfgRaw.forEach((f) => { fieldConfig[f.key] = { type: f.type, options: f.options || [] }; });
  const defaultFieldConfig = {
    coverageArea: fieldConfig.coverageArea || { type: "text", options: [] },
    purpose: fieldConfig.purpose || { type: "dropdown", options: [] },
    flightStation: fieldConfig.flightStation || { type: "dropdown", options: [] },
    uav: fieldConfig.uav || { type: "dropdown", options: [] },
  };

  const data = {
    SECTORS: sectors,
    PILOTS: pilots,
    FLIGHT_HOURS: flightHours,
    STATIONS: stations.map(mapStation),
    UAVS: aircraft.map((a) => ({ id: a.id, model: a.model, payload: a.payload, battery: a.battery ?? 100 })),
    AIRCRAFT: aircraft,
    BATTERIES: batteries,
    MAINTENANCE: maintenanceRaw.map((m) => ({ id: m.id, aircraft: m.aircraft_id, type: m.type, due: m.due, status: m.status, priority: "—", assignee: "—", notes: m.notes })),
    STAKEHOLDERS: stakeholdersRaw.map((s) => ({ id: s.id, name: s.name, email: s.email, role: s.role, notify: s.notify || [], avatar: s.avatar || colorFor(s.id) })),
    ACTIVE_FLIGHTS: activeFlights,
    RECENT_FLIGHTS: recentFlights,
    INCIDENTS: incidents,
    REPORTS_ARCHIVE: reports,
    MEDIA_LIBRARY: media,
    LOGBOOK_ENTRIES: logbookRaw.map((l) => {
      const dur = Number(l.duration_min || 0);
      return {
        id: l.id, pilotId: l.pilot_id, date: l.date, time: "", aircraft: l.aircraft_type, model: l.aircraft_type,
        area: "", role: "PIC", duration: dur, day: l.night ? 0 : dur, night: l.night ? dur : 0,
        bvlos: l.bvlos ? dur : 0, vlos: l.bvlos ? 0 : dur, ldgs: 1, mode: l.conditions || "Auto", notes: l.notes,
      };
    }),
    CURRENCIES: currenciesRaw.map((c) => {
      const days = c.expires_at ? Math.ceil((new Date(c.expires_at) - Date.now()) / 86400000) : 0;
      return { id: c.id, label: c.type, expires: c.expires_at || "—", days, kind: c.type,
        status: c.status || (days <= 0 ? "expired" : days < 30 ? "warn" : "valid"), note: "" };
    }),
    TEAM_ROSTER: profiles.map((p) => ({ id: p.id, shortId: p.shortId, name: p.name, role: p.role, roles: p.roles, initials: p.initials, color: p.color, license: p.license, email: p.email, hasCode: p.hasCode, status: p.status, hours: p.hours, kycStatus: p.kycStatus, phone: p.phone, dob: p.dob, govId: p.govId, licenseClass: p.licenseClass, licenseExpiry: p.licenseExpiry, jobTitle: p.jobTitle })),
    TEAM_ROLES: rolesRaw.map((r) => r.name),
    ALL_ROLES: rolesRaw.map((r) => ({ id: r.id, name: r.name, description: r.description, permissions: r.permissions || [] })),
    COVERAGE_AREA_LIBRARY: coverageRaw.map((c) => c.name),
    PURPOSE_LIBRARY: purposesRaw.map((p) => p.name),
    DEFAULT_FIELD_CONFIG: defaultFieldConfig,
    CHAT_MESSAGES: [],
    // analytics placeholders (computed views were removed from this app)
    HOTSPOTS: [], TS_INCIDENTS: [], TS_PREDICTION: [], BAR_BY_TYPE: [], PIE_BY_SEVERITY: [],
  };

  Object.assign(window, data);
  window.__poData = data;

  // Members & invites caches for the admin Members view + invites-store helpers.
  window.__poMembers = profiles.map((p) => ({
    id: p.id, shortId: p.shortId, name: p.name, email: p.email, initials: p.initials, color: p.color,
    roles: p.roles.length ? p.roles : (p.isAdmin ? ["Director"] : ["Member"]),
    primaryRole: p.role, status: p.status, license: p.license, hasCode: p.hasCode,
    kycStatus: p.kycStatus, phone: p.phone, dob: p.dob, govId: p.govId,
    licenseClass: p.licenseClass, licenseExpiry: p.licenseExpiry, jobTitle: p.jobTitle,
    joinedAt: Date.now(), lastActive: Date.now(),
  }));
  window.__poInvites = invitesRaw.map((i) => ({
    token: i.token, email: i.email, roles: i.roles || [],
    invitedByName: i.invited_by_name, status: i.status, message: i.message,
    sentAt: i.created_at ? new Date(i.created_at).getTime() : Date.now(),
    expiresAt: i.expires_at ? new Date(i.expires_at).getTime() : Date.now(),
    openedAt: i.opened_at ? new Date(i.opened_at).getTime() : null,
    acceptedAt: i.accepted_at ? new Date(i.accepted_at).getTime() : null,
  }));

  return data;
}

// Re-run the bootstrap and refresh the globals (used after mutations / realtime).
export async function refresh() {
  const data = await bootstrap();
  window.dispatchEvent(new CustomEvent("po:data"));
  return data;
}
