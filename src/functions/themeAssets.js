/**
 * Normalize theme list fields from fetchThemeData: API may return arrays or JSON-encoded strings.
 * (Admin themeupdate uses the same logic as ensureArray.)
 */
export function ensureThemeJsonArray(val) {
  if (Array.isArray(val)) return val;
  if (val == null || val === "") return [];
  if (typeof val === "string") {
    try {
      const p = JSON.parse(val);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Build a safe URL for theme images (S3 keys under REACT_APP_S3_PATH, or full https URLs).
 * Encodes each path segment so spaces, parentheses, %, etc. resolve to the correct object key.
 */
export function getDvSourceImageUrl(imgPath) {
  if (!imgPath) return "";
  const s = String(imgPath).trim();
  if (!s) return "";
  const encodePathSegments = (relativePath) =>
    relativePath
      .split("/")
      .map((seg) => {
        if (!seg) return seg;
        try {
          return encodeURIComponent(decodeURIComponent(seg));
        } catch {
          return encodeURIComponent(seg);
        }
      })
      .join("/");
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const parts = u.pathname.split("/").filter(Boolean);
      u.pathname = `/${parts.map((seg) => encodePathSegments(seg)).join("/")}`;
      return u.toString();
    } catch {
      return encodeURI(s);
    }
  }
  const base = (process.env.REACT_APP_S3_PATH || "").replace(/\/?$/, "/");
  const path = s.replace(/^\/+/, "");
  return `${base}${encodePathSegments(path)}`;
}

/**
 * Value for CSS `background-image` / `url(...)`. Unquoted `url(https://.../a(2).png)` is invalid — the `(` ends the URL.
 */
export function toCssUrlValue(href) {
  if (!href) return "none";
  const escaped = String(href).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `url("${escaped}")`;
}
