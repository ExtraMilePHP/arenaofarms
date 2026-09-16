import { useMemo } from "react";
import { useSelector } from "react-redux";

/**
 * Theme colors authored in admin/pages/rules/rules.jsx and stored on the theme
 * record. One place so every user-facing page applies them the same way:
 *   - textColor       -> body/heading text        (themeData.textcolor)
 *   - buttonColor     -> primary button background (themeData.button_color)
 *   - buttonTextColor -> primary button label      (themeData.button_Textcolor)
 *
 * Primary buttons also get a box-shadow built from a darkened version of the
 * button color, so the CTA reads the same on every screen.
 *
 * Every value is trimmed and only returned when non-empty, so pages fall back to
 * their own CSS when the theme leaves a color blank.
 */
const clean = (raw) => {
  if (raw == null || raw === "") return undefined;
  const c = String(raw).trim();
  return c || undefined;
};

const NAMED = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  orange: "#ffa500",
  purple: "#800080",
  gray: "#808080",
  grey: "#808080",
};

/** "#rgb" / "#rrggbb" / a few named colors -> { r, g, b }, or null. */
function toRgb(color) {
  if (!color) return null;
  let v = String(color).trim().toLowerCase();
  if (NAMED[v]) v = NAMED[v];
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short) {
    return {
      r: parseInt(short[1] + short[1], 16),
      g: parseInt(short[2] + short[2], 16),
      b: parseInt(short[3] + short[3], 16),
    };
  }
  const full = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(v);
  if (full) {
    return {
      r: parseInt(full[1], 16),
      g: parseInt(full[2], 16),
      b: parseInt(full[3], 16),
    };
  }
  return null;
}

/** Darken toward black by `amount` (0..1). */
function darken(color, amount = 0.45) {
  const rgb = toRgb(color);
  if (!rgb) return undefined;
  const f = Math.max(0, 1 - amount);
  const r = Math.round(rgb.r * f);
  const g = Math.round(rgb.g * f);
  const b = Math.round(rgb.b * f);
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

function rgba(color, alpha) {
  const rgb = toRgb(color);
  if (!rgb) return undefined;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

export function useThemeColors() {
  const themeData = useSelector((state) => state.theme?.data);

  return useMemo(() => {
    const textColor = clean(themeData?.textcolor);
    const buttonColor = clean(themeData?.button_color);
    const buttonTextColor = clean(
      themeData?.button_Textcolor ?? themeData?.button_text_color
    );
    const buttonShadowColor = buttonColor ? darken(buttonColor, 0.5) : undefined;

    const buttonStyle = {
      ...(buttonColor ? { backgroundColor: buttonColor } : null),
      ...(buttonTextColor ? { color: buttonTextColor } : null),
    };
    // box-shadow uses a dark version of the same button color
    if (buttonShadowColor) {
      buttonStyle.boxShadow = `0 6px 0 ${buttonShadowColor}, 0 10px 22px ${
        rgba(buttonShadowColor, 0.45) || buttonShadowColor
      }`;
    }

    return {
      textColor,
      buttonColor,
      buttonTextColor,
      buttonShadowColor,
      // spread onto a page's root element
      textStyle: textColor ? { color: textColor } : undefined,
      // spread onto a primary button
      buttonStyle,
    };
  }, [themeData]);
}

export default useThemeColors;
