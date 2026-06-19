// Pilot Ops — global defaults.
//
// NO MORE DUMMY DATA. These are empty/safe defaults so the global names exist
// before the bootstrap store (src/store.jsx) fills them with REAL rows from
// Supabase. The app only mounts after bootstrap() completes, so views render
// against real data; these defaults just prevent "undefined" if a load fails.

const SECTORS = {
  generic: { label: "Multi-sector", units: { area: "km²", asset: "asset" }, incidentTypes: [], samplePlaces: [] },
};

const PILOTS = [];
const STATIONS = [];
const UAVS = [];
const STAKEHOLDERS = [];
const ACTIVE_FLIGHTS = [];
const RECENT_FLIGHTS = [];
const INCIDENTS = [];

// Analytics placeholders (the analytics/predictive views were removed from this app).
const HOTSPOTS = [];
const TS_INCIDENTS = [];
const TS_PREDICTION = [];
const BAR_BY_TYPE = [];
const PIE_BY_SEVERITY = [];

const CHAT_MESSAGES = [];
const REPORTS_ARCHIVE = [];

const TEAM_ROLES = [];
const TEAM_ROSTER = [];
const COVERAGE_AREA_LIBRARY = [];
const PURPOSE_LIBRARY = [];

const DEFAULT_FIELD_CONFIG = {
  coverageArea:  { type: "text",     options: [] },
  purpose:       { type: "dropdown", options: [] },
  flightStation: { type: "dropdown", options: [] },
  uav:           { type: "dropdown", options: [] },
};

Object.assign(window, {
  SECTORS, PILOTS, STATIONS, UAVS, STAKEHOLDERS, ACTIVE_FLIGHTS, RECENT_FLIGHTS,
  INCIDENTS, HOTSPOTS, TS_INCIDENTS, TS_PREDICTION, BAR_BY_TYPE, PIE_BY_SEVERITY,
  CHAT_MESSAGES, REPORTS_ARCHIVE,
  TEAM_ROLES, TEAM_ROSTER, COVERAGE_AREA_LIBRARY, PURPOSE_LIBRARY, DEFAULT_FIELD_CONFIG,
});
