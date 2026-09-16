import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSelector, useDispatch } from "react-redux";
import { selectAdminToken } from "../../admin/sessionSlice";
import { doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import { database } from "../../database/firebase";
import { EXTRAMILE_GUEST_JOIN, EXTRAMILE_SIGNUP } from "../../config/extramileJoinUrls";
import "./host.css";
import { setBackButtonUrl } from '../uiSlice';

const CURRENT_LOBBY_KEY = "mythFactCurrentLobby";
const TOTAL_USER_COUNT_KEY = "mythFactTotalUserCount";

function readStoredUserData() {
  try {
    const raw =
      localStorage.getItem("userData") ||
      sessionStorage.getItem("userData") ||
      "{}";
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

function parseFourDigitLobbyPin(value) {
  const raw = String(value ?? "").trim();
  if (!raw || !/^\d{1,4}$/.test(raw)) return "";
  return raw.padStart(4, "0");
}

function randomFourDigitLobbyPinString() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function resolveTotalUserCount() {
  return 2;
}

function buildExtramileJoinUrl(isGuest, gameId, sessionId) {
  const base = (isGuest ? EXTRAMILE_GUEST_JOIN : EXTRAMILE_SIGNUP).replace(/\/$/, "");
  const u = new URL(base);
  u.searchParams.set("gameId", String(gameId ?? ""));
  u.searchParams.set("sessionId", String(sessionId ?? ""));
  return u.toString();
}

/** Append lobby + share flags (same pattern as host/qr.jsx). */
function appendLobbyShareFlagsToJoinUrl(baseUrl, lobbyId) {
  const base = String(baseUrl ?? "").trim();
  const id = String(lobbyId ?? "").trim();
  if (!base) return "";
  if (!id) return base;
  try {
    const u = new URL(base);
    u.searchParams.set("lobby", id);
    u.searchParams.set("fromShare", "1");
    u.searchParams.set("shared", "1");
    return u.toString();
  } catch {
    return base;
  }
}

function deriveGuestFromUser(u) {
  const t = String(u?.user_type ?? u?.userType ?? "").toLowerCase();
  if (t === "guest") return true;
  const src = String(u?.source ?? u?.roles ?? "").toUpperCase();
  return src === "GUEST_USER" || src === "GUEST";
}

function buildFallbackAppLink(lobbyCode) {
  const base = String(process.env.REACT_APP_BASE_URL || window.location.origin || "").replace(/\/+$/, "");
  const code = encodeURIComponent(String(lobbyCode || "").trim() || "main");
  return `${base}/game?pin=${code}&lobby=${code}`;
}

function Host() {
  const navigate = useNavigate();
  const location = useLocation();
  const adminToken = useSelector(selectAdminToken);
  const userData = useMemo(() => readStoredUserData(), []);
  const { status, user } = useSelector((state) => state.auth);
  const dispatch = useDispatch();


  useEffect(() => {
    dispatch(setBackButtonUrl("/lobby"));
  }, [status, user]);


  const totalUserCount = useMemo(() => resolveTotalUserCount(), []);
  const [loginPin] = useState(() => {
    const fromRedirect =
      parseFourDigitLobbyPin(location.state?.loginPin) ||
      parseFourDigitLobbyPin(location.state?.lobbyName);
    if (fromRedirect) {
      try {
        sessionStorage.setItem(CURRENT_LOBBY_KEY, fromRedirect);
      } catch {
        // ignore storage failures
      }
      return fromRedirect;
    }
    try {
      const fromSs = parseFourDigitLobbyPin(sessionStorage.getItem(CURRENT_LOBBY_KEY));
      if (fromSs) return fromSs;
    } catch {
      // ignore storage failures
    }
    const fromUser = parseFourDigitLobbyPin(userData?.lobby);
    if (fromUser) {
      try {
        sessionStorage.setItem(CURRENT_LOBBY_KEY, fromUser);
      } catch {
        // ignore storage failures
      }
      return fromUser;
    }
    const fresh = randomFourDigitLobbyPinString();
    try {
      sessionStorage.setItem(CURRENT_LOBBY_KEY, fresh);
    } catch {
      // ignore storage failures
    }
    return fresh;
  });
  const lobbyName = loginPin;
  const loginPinNumber = Number.parseInt(loginPin, 10);
  const isGuest = useMemo(() => deriveGuestFromUser(userData), [userData]);
  const { status: themeStatus, data: themeData } = useSelector(
    (state) => state.theme
  );
  const themeColors = themeData?.colors || themeData || {};
  const textStyle = themeColors?.text_color
    ? { color: themeColors.text_color }
    : undefined;
  const buttonStyle =
    themeColors?.option_color != null && themeColors?.option_text_color != null
      ? {
          backgroundColor: themeColors.option_color,
          color: themeColors.option_text_color,
        }
      : undefined;

  const joinUrl = useMemo(() => {
    const gameId = String(userData.gameId ?? "").trim();
    const sessionId = String(userData.sessionId ?? "").trim();
    const lobbyId = String(lobbyName ?? "").trim();
    if (gameId && sessionId) {
      const base = buildExtramileJoinUrl(isGuest, gameId, sessionId);
      console.log("joinUrl", base);
      return appendLobbyShareFlagsToJoinUrl(base, lobbyId);
    }
    const fromState =
      typeof location.state?.link === "string" ? location.state.link.trim() : "";
    if (fromState) return fromState;
    return buildFallbackAppLink(lobbyId);
  }, [isGuest, lobbyName, location.state?.link, userData.gameId, userData.sessionId]);
  const [copyLabel, setCopyLabel] = useState("Copy link");
  const copyResetTimerRef = useRef(null);

  useEffect(() => {
    const initLobbyDoc = async () => {
      const sessionId = String(userData.sessionId ?? "").trim();
      const lobbyId = String(lobbyName ?? "").trim();
      const userId =
        userData.userId || userData.userid || userData.id || "";
      if (!sessionId || !lobbyId) return;
      const ref = doc(database, `lobbies/${sessionId}/lobby/${lobbyId}`);
      try {
        const snap = await getDoc(ref);
        const existingStatus = String(snap.data()?.status ?? "").trim().toLowerCase();
        const shouldPreserveStatus =
          existingStatus === "gameover" || existingStatus === "play";
        await setDoc(
          ref,
          {
            totalUserCount,
            ...(!shouldPreserveStatus ? { status: "waiting" } : {}),
            createdBy: userId,
            ...(!snap.exists() ? { createdAt: Date.now() } : {}),
          },
          { merge: true }
        );
      } catch (firestoreError) {
        console.error("Failed to initialize lobby settings:", firestoreError);
      }
    };
    initLobbyDoc();
  }, [lobbyName, totalUserCount, userData]);

  useEffect(() => {
    const sessionId = String(userData.sessionId ?? "").trim();
    const lobbyId = String(lobbyName ?? "").trim();
    if (!sessionId || !lobbyId) return undefined;

    const lobbyRef = doc(database, `lobbies/${sessionId}/lobby/${lobbyId}`);
    const unsubscribe = onSnapshot(
      lobbyRef,
      (snap) => {
        if (!snap.exists()) return;
        const lobbyStatus = String(snap.data()?.status ?? "").trim().toLowerCase();
        if (lobbyStatus === "gameover") {
          navigate("/leaderboard");
        }
      },
      (e) => {
        console.error("Host lobby status snapshot failed:", e);
      }
    );

    return () => unsubscribe();
  }, [lobbyName, navigate, userData.sessionId]);

  useEffect(() => {
    try {
      sessionStorage.setItem(CURRENT_LOBBY_KEY, loginPin);
    } catch {
      // ignore storage failures
    }
  }, [loginPin]);

  // Ensure downstream pages (like /waiting) can read the lobby name from stored userData.
  useEffect(() => {
    if (!lobbyName) return;
    try {
      const merged = { ...(userData || {}), lobby: lobbyName };
      const payload = JSON.stringify(merged);
      localStorage.setItem("userData", payload);
      sessionStorage.setItem("userData", payload);
    } catch {
      // ignore storage failures
    }
  }, [lobbyName, userData]);

  const resetCopyLabelLater = (delayMs = 10000) => {
    if (copyResetTimerRef.current) {
      window.clearTimeout(copyResetTimerRef.current);
    }
    copyResetTimerRef.current = window.setTimeout(() => {
      setCopyLabel("Copy link");
      copyResetTimerRef.current = null;
    }, delayMs);
  };

  const handleCopyLink = async () => {
    const text = String(joinUrl || "").trim();
    console.log("handleCopyLink", text);
    if (!text) {
      setCopyLabel("Copy link");
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopyLabel("Copied");
      resetCopyLabelLater(10000);
    } catch {
      setCopyLabel("Copy failed");
      resetCopyLabelLater(3000);
    }
  };

  const handleDownloadQr = async () => {
    try {
      const resp = await fetch(qrSrc);
      if (!resp.ok) throw new Error("QR download failed");
      const blob = await resp.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      const slug = String(loginPin || "")
        .trim()
        .replace(/[^\w.-]+/g, "_")
        .slice(0, 48);
      a.download = `block-and-belong-qr-${slug || "lobby"}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.open(qrSrc, "_blank", "noopener,noreferrer");
    }
  };

  useEffect(() => {
    document.documentElement.classList.add("host-static-bg");
    document.body.classList.add("host-static-bg");
    return () => {
      document.documentElement.classList.remove("host-static-bg");
      document.body.classList.remove("host-static-bg");
    };
  }, []);

  const qrSrc = useMemo(() => {
    return `https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=2&data=${encodeURIComponent(joinUrl)}`;
  }, [joinUrl]);

  useEffect(() => {
    const saveStageAccess = async () => {
      const userId = userData.userId || userData.userid || userData.id;
      const sessionId = userData.sessionId;
      const organizationId = userData.organizationId;
      const resolvedThemeName = String(themeData?.themename ?? "").trim();
      console.log("saveStageAccess", userId, sessionId, organizationId, resolvedThemeName);

      if (
        !adminToken ||
        !userId ||
        !sessionId ||
        !organizationId ||
        !resolvedThemeName
      )
        return;

      try {
        const playerName = String(userData.name || "").trim();
        const userEmail = String(userData.email || "").trim();

        const lobbyUserRef = doc(
          database,
          `lobbies/${sessionId}/lobby/${lobbyName}/users/${userId}`
        );

        const existingLobbyUserSnap = await getDoc(lobbyUserRef);
        const existingLobbyUserData = existingLobbyUserSnap.exists()
          ? existingLobbyUserSnap.data()
          : null;

        // If host is already initialized, don't re-generate "code/scanner" on refresh.
        if (existingLobbyUserData?.hostInitialized === true) return;

        try {
          await setDoc(
            lobbyUserRef,
            {
              userId,
              sessionId,
              lobby: lobbyName,
              link: joinUrl,
              loginPin: loginPinNumber,
              organizationId,
              name: playerName,
              email: userEmail,
              lobby: lobbyName,
              character:"c6",
              timestamp: existingLobbyUserData?.timestamp || Date.now(),
              status: "hold",
              hostInitialized: true,
              presenter: true,
            },
            { merge: true }
          );
        } catch (firestoreError) {
          console.error("Failed to create host user in Firestore:", firestoreError);
        }
      } catch (err) {
        console.error("host setDoc error:", err);
      }
    };

    saveStageAccess();
  }, [adminToken, joinUrl, lobbyName, themeData, userData]);

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current) {
        window.clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  const handleStart = async () => {
    // Persist lobby name so downstream pages can reliably read it.
    try {
      const merged = { ...(userData || {}), lobby: lobbyName || "" };
      const payload = JSON.stringify(merged);
      localStorage.setItem("userData", payload);
      sessionStorage.setItem("userData", payload);
    } catch {
      // ignore storage failures
    }

    try {
      const userId = userData.userId || userData.userid || userData.id;
      const sessionId = String(userData.sessionId || "").trim();
      const storedLobbyName = String(lobbyName || "").trim();
      if (userId && sessionId && storedLobbyName) {
        const lobbyUserRef = doc(
          database,
          `lobbies/${sessionId}/lobby/${storedLobbyName}/users/${userId}`
        );
        await setDoc(
          lobbyUserRef,
          {
            status: "live",
            updatedAt: Date.now(),
          },
          { merge: true }
        );
      }
    } catch (firestoreError) {
      console.error("Failed to update user live status:", firestoreError);
    }

    navigate("/waiting", {
      replace: false,
      state: {
        pin: loginPinNumber,
        loginPin: loginPinNumber,
        link: joinUrl,
        lobbyName,
      },
    });
  };

  return (
    <div className="host-page">
      <div className="host-landing">
        <div className="host-join-wrap">
          <section className="host-glass-card host-glass-card--scan">
            <h2 className="host-card-title" style={textStyle}>
              SCAN TO JOIN
            </h2>
            <div className="host-qr-card">
              <img src={qrSrc} alt="Join QR code" className="host-qr-image" />
            </div>
          </section>
          <section className="host-glass-card host-glass-card--pin">
            <h2 className="host-card-title" style={textStyle}>
              JOIN BY PIN
            </h2>
            <div className="host-pin" style={textStyle}>
              {loginPin}
            </div>
          </section>
        </div>

        <div className="host-share-row">
          <button
            type="button"
            className="host-secondary-btn"
            onClick={handleDownloadQr}
            style={buttonStyle}
          >
            Download QR
          </button>
          <button
            type="button"
            className="host-secondary-btn"
            onClick={handleCopyLink}
            style={buttonStyle}
          >
            {copyLabel}
          </button>
        </div>

        <button
          type="button"
          className="host-start-btn"
          onClick={handleStart}
          style={buttonStyle}
        >
          Start
        </button>
      </div>
    </div>
  );
}

export default Host;