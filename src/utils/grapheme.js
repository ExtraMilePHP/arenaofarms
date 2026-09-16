/** Split a string into Unicode extended grapheme clusters (user-perceived characters). */
export function splitGraphemes(str) {
  if (str == null || str === "") return [];
  try {
    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
      const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
      return Array.from(seg.segment(String(str)), (x) => x.segment);
    }
  } catch {
    // fall through
  }
  return Array.from(String(str));
}

export function countGraphemes(str) {
  return splitGraphemes(str).length;
}

/** Build emoji-picker-react / CDN unified id (e.g. "1f4c5" or "1f468-200d-1f469") from one grapheme. */
export function graphemeToUnified(grapheme) {
  if (grapheme == null || grapheme === "") return "";
  const s = String(grapheme);
  const parts = [];
  for (let i = 0; i < s.length; ) {
    const cp = s.codePointAt(i);
    if (cp === undefined) break;
    parts.push(cp.toString(16).toLowerCase());
    i += cp >= 0x10000 ? 2 : 1;
  }
  return parts.join("-");
}
