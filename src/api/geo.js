// Geolocation helpers — request the user's real device location with a clear
// permission flow and graceful fallback when denied/unavailable.

export function geoSupported() {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

// One-shot current position. Resolves { lat, lng, accuracy } or rejects with a
// friendly Error (caller can fall back to a manual pin).
export function getCurrentPosition(opts = {}) {
  return new Promise((resolve, reject) => {
    if (!geoSupported()) return reject(new Error("Geolocation is not supported on this device."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (err) => reject(new Error(friendly(err))),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000, ...opts }
    );
  });
}

// Continuous tracking. Calls onUpdate({lat,lng,accuracy,heading,speed}) as the
// device moves. Returns a stop() function. onError is optional.
export function watchPosition(onUpdate, onError, opts = {}) {
  if (!geoSupported()) {
    onError && onError(new Error("Geolocation is not supported on this device."));
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (p) => onUpdate({
      lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy,
      heading: p.coords.heading, speed: p.coords.speed,
    }),
    (err) => onError && onError(new Error(friendly(err))),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000, ...opts }
  );
  return () => navigator.geolocation.clearWatch(id);
}

// Best-effort permission state ("granted" | "denied" | "prompt" | "unknown").
export async function permissionState() {
  try {
    if (!navigator.permissions) return "unknown";
    const s = await navigator.permissions.query({ name: "geolocation" });
    return s.state;
  } catch {
    return "unknown";
  }
}

function friendly(err) {
  switch (err.code) {
    case err.PERMISSION_DENIED: return "Location permission denied. Enable it or drop a pin manually.";
    case err.POSITION_UNAVAILABLE: return "Location unavailable right now. Try again or pin manually.";
    case err.TIMEOUT: return "Timed out getting your location. Try again or pin manually.";
    default: return "Could not get your location.";
  }
}
