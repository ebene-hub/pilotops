// Per-user notification read/clear state. Notifications are org-wide append-only
// event rows with no per-user flag, so "read" and "cleared" are tracked locally
// per user/device — marking read or clearing never affects other members.
const READ_KEY = "po:notif:readAt";
const CLEAR_KEY = "po:notif:clearedAt";

const get = (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

// Rows the user hasn't cleared (newer than the clear marker).
export function visibleNotifs(items) {
  const c = get(CLEAR_KEY);
  return c ? items.filter((n) => n.created_at > c) : items;
}

// Count of visible rows newer than the last "mark all read".
export function unreadCount(items) {
  const r = get(READ_KEY);
  return visibleNotifs(items).filter((n) => !r || n.created_at > r).length;
}

export function isUnread(n) {
  const r = get(READ_KEY);
  return !r || n.created_at > r;
}

// Mark everything currently present as read (remembers the newest timestamp).
export function markAllRead(items) {
  const latest = (items && items[0] && items[0].created_at) || new Date().toISOString();
  set(READ_KEY, latest);
}

// Hide everything up to now from this user's list.
export function clearAllNotifs() {
  const now = new Date().toISOString();
  set(CLEAR_KEY, now);
  set(READ_KEY, now);
}
