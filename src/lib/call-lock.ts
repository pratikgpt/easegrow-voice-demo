// Cross-tab "one call at a time" lock.
//
// Any tab that starts / is in a call writes a heartbeat to localStorage every
// few seconds. Other tabs check for a fresh heartbeat from a different tab
// before starting a new call. Heartbeats older than STALE_MS are ignored so a
// crashed / force-closed tab can't lock everyone out.

const KEY = "egai:call-lock";
const HEARTBEAT_MS = 2000;
const STALE_MS = 6000;

type LockPayload = { tabId: string; ts: number };

function readLock(): LockPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LockPayload;
    if (!parsed || typeof parsed.ts !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Returns the tabId of another live tab holding the lock, or null. */
export function otherTabHoldingCall(myTabId: string): string | null {
  const lock = readLock();
  if (!lock) return null;
  if (lock.tabId === myTabId) return null;
  if (Date.now() - lock.ts > STALE_MS) return null;
  return lock.tabId;
}

export function generateTabId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Start publishing a heartbeat for this tab. Returns a release function that
 * clears the lock. Safe to call multiple times; each call replaces the prior
 * heartbeat interval for this tab.
 */
export function acquireCallLock(tabId: string): () => void {
  if (typeof window === "undefined") return () => {};
  const write = () => {
    try {
      window.localStorage.setItem(
        KEY,
        JSON.stringify({ tabId, ts: Date.now() } satisfies LockPayload),
      );
    } catch {
      /* storage full / disabled — best-effort */
    }
  };
  write();
  const interval = window.setInterval(write, HEARTBEAT_MS);
  return () => {
    window.clearInterval(interval);
    try {
      const lock = readLock();
      if (lock && lock.tabId === tabId) window.localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  };
}