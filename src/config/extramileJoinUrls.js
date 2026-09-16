/**
 * ExtraMile join / signup entry URLs for share links and QR.
 * CRA replaces process.env.* at compile time — restart `npm start` after editing .env.
 *
 * Order: explicit REACT_APP_EXTRAMILE_* → derive from REACT_APP_BASE_URL → production default.
 */
const explicitGuest = (process.env.REACT_APP_EXTRAMILE_GUEST_JOIN_URL || "").trim();
const explicitSignup = (process.env.REACT_APP_EXTRAMILE_SIGNUP_URL || "").trim();
const baseApp = (process.env.REACT_APP_BASE_URL || "").trim().replace(/\/+$/, "");

export const EXTRAMILE_GUEST_JOIN =
  explicitGuest || (baseApp ? `${baseApp}/join/guest` : "https://extramileplay.com/join/guest");

export const EXTRAMILE_SIGNUP =
  explicitSignup || (baseApp ? `${baseApp}/singin-signup` : "https://extramileplay.com/singin-signup");
