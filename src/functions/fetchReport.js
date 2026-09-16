const USER_DATA_KEY = "userData";

function readSessionUserData() {
  try {
    const raw =
      sessionStorage.getItem(USER_DATA_KEY) ||
      localStorage.getItem(USER_DATA_KEY) ||
      "{}";
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

function parseTimeToSeconds(t) {
  if (t == null) return 0;
  if (typeof t === "number") return Math.round(t);
  const parts = String(t).split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/**
 * Fetch this user's existing Arena of Arms report row (the `stages` row keyed
 * by sessionId + organizationId + userId). Returns the parsed report object,
 * or null when there is no row yet / no real session.
 *
 * Shape: { id, points, time, reportId, current, status, gameover }
 *   status  — 'inprogress' | 'win' | 'lose' | 'completed'
 */
export async function fetchReport(opts = {}) {
  const u = readSessionUserData();
  const userId =
    opts.userId || u.userId || u.userid || u.id || "";
  const sessionId = opts.sessionId || u.sessionId || "";
  const organizationId = opts.organizationId || u.organizationId || "";

  const base = String(process.env.REACT_APP_BACKEND_URL || "").replace(/\/+$/, "");
  if (!base || !userId || !sessionId || !organizationId) return null;

  const resp = await fetch(`${base}/fetchReport`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionId}&${organizationId}`,
    },
    body: JSON.stringify({ userId }),
  });
  if (!resp.ok) {
    const { message } = await resp.json().catch(() => ({}));
    throw new Error(message || "Failed to fetch report");
  }
  const data = await resp.json();
  return data && data.success ? data.report || null : null;
}

/**
 * True once the player has already recorded an Arena match — any non-empty
 * status other than the default 'inprogress' means a round was played and
 * they should be sent to the thank-you page instead of replaying.
 */
export function reportHasResult(report) {
  if (!report) return false;
  const status = String(report.status || "").trim().toLowerCase();
  return status !== "" && status !== "inprogress";
}

export { parseTimeToSeconds };
