/**
 * Copy themes/themesdata from originalSessionId into the current (duplicate) session.
 * Reusable across games that share the same backend theme tables.
 *
 * @param {{
 *   sessionId: string,
 *   organizationId: string,
 *   originalSessionId: string,
 *   backendUrl?: string,
 * }} params
 * @returns {Promise<object>}
 */
export async function copySessionThemes({
  sessionId,
  organizationId,
  originalSessionId,
  backendUrl,
}) {
  const base = String(
    backendUrl || process.env.REACT_APP_BACKEND_URL || ""
  ).replace(/\/+$/, "");

  if (!base) {
    throw new Error("Backend URL is not configured");
  }
  if (!sessionId || !organizationId) {
    throw new Error("sessionId and organizationId are required");
  }
  if (!originalSessionId) {
    throw new Error("originalSessionId is required");
  }

  const res = await fetch(`${base}/copySessionThemes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionId}&${organizationId}`,
    },
    body: JSON.stringify({ originalSessionId }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(
      data.message || data.error || `copySessionThemes failed (${res.status})`
    );
  }
  return data;
}

/** Truthy check for login `isCopy` (boolean or string). */
export function isCopySession(value) {
  if (value === true || value === 1) return true;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v === "true" || v === "1" || v === "yes";
  }
  return false;
}

/**
 * If login payload is a duplicate session, sync themes from the original first.
 * Safe no-op when not a copy or originalSessionId is missing.
 */
export async function syncThemesIfCopySession({
  sessionId,
  organizationId,
  isCopy,
  originalSessionId,
  backendUrl,
}) {
  if (!isCopySession(isCopy) || !originalSessionId) {
    return { skipped: true, reason: "not_a_copy_session" };
  }
  return copySessionThemes({
    sessionId,
    organizationId,
    originalSessionId,
    backendUrl,
  });
}
