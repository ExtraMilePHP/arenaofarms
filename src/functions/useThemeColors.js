import { useMemo } from "react";
import { useSelector } from "react-redux";

/**
 * Theme colors authored in admin/pages/rules/rules.jsx and stored on the theme
 * record. One place so every user-facing page applies them the same way:
 *   - textColor       -> body/heading text        (themeData.textcolor)
 *   - buttonTextColor -> primary button label      (themeData.button_Textcolor)
 *
 * Buttons use the shared button background image, so no theme color or shadow
 * is painted behind the image.
 *
 * Every value is trimmed and only returned when non-empty, so pages fall back to
 * their own CSS when the theme leaves a color blank.
 */
const clean = (raw) => {
  if (raw == null || raw === "") return undefined;
  const c = String(raw).trim();
  return c || undefined;
};

export function useThemeColors() {
  const themeData = useSelector((state) => state.theme?.data);

  return useMemo(() => {
    const textColor = clean(themeData?.textcolor);
    const buttonColor = clean(themeData?.button_color);
    const buttonTextColor = clean(
      themeData?.button_Textcolor ?? themeData?.button_text_color
    );

    const buttonStyle = {
      ...(buttonTextColor ? { color: buttonTextColor } : null),
    };

    return {
      textColor,
      buttonColor,
      buttonTextColor,
      // spread onto a page's root element
      textStyle: textColor ? { color: textColor } : undefined,
      // spread onto a primary button
      buttonStyle,
    };
  }, [themeData]);
}

export default useThemeColors;
