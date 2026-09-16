import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate, useParams } from "react-router-dom";
import { setBackButtonUrl } from '../uiSlice';
import { useThemeColors } from '../../functions/useThemeColors';
import { EXTRAMILE_GUEST_JOIN, EXTRAMILE_SIGNUP } from "../../config/extramileJoinUrls";
import {
  getLocalPlayerId,
  getLocalPlayerName,
  joinLobby,
  listenLobby,
} from "../../firebaseArena";
import QRCode from "../../components/QRCode";
import "../arena.css";

function readStoredUserData() {
  try {
    const raw =
      sessionStorage.getItem("userData") ||
      localStorage.getItem("userData") ||
      "{}";
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

/** The logged-in player's name from the session payload (userData). */
function userDataName() {
  const n = typeof readStoredUserData().name === "string" ? readStoredUserData().name.trim() : "";
  return n && !/^null(\s+null)*$/i.test(n) ? n : "";
}

/** Remember the lobby code on userData (mirrors noughts_and_crosses_react-master's
 *  lobby.jsx) so re-opening the app can silently drop the player back into a
 *  lobby they already created/joined instead of starting over. */
function persistLobbyCode(code) {
  try {
    const merged = { ...readStoredUserData(), lobby: code || null };
    const payload = JSON.stringify(merged);
    localStorage.setItem("userData", payload);
    sessionStorage.setItem("userData", payload);
  } catch {
    /* ignore storage failures */
  }
}

function deriveGuestFromUser(u) {
  const t = String(u?.user_type ?? u?.userType ?? "").toLowerCase();
  if (t === "guest") return true;
  // `source` is always set ("ORG_USER"/"DEMO"), so `??` here never actually
  // reaches `role` -- check both explicitly instead.
  const src = String(u?.source ?? "").toUpperCase();
  const role = String(u?.role ?? "").toUpperCase();
  return src === "GUEST_USER" || src === "GUEST" || role === "GUEST_USER" || role === "GUEST";
}

function buildExtramileJoinUrl(isGuest, gameId, sessionId) {
  alert(`isGuest: ${isGuest}`);
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

export default function LobbyRoom() {
  const { code } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { status, user } = useSelector((state) => state.auth);
  const { textStyle, buttonStyle } = useThemeColors();
  const playerId = useRef(getLocalPlayerId()).current;
  const [lobby, setLobby] = useState(null);
  const [error, setError] = useState("");
  const [copyLabel, setCopyLabel] = useState("Copy");
  const joinAttempted = useRef(false);
  const navigated = useRef(false);
  const startTimerRef = useRef(null);
  useEffect(() => {
    dispatch(setBackButtonUrl("/arena/lobby"));
  }, [status, user]);

  const userData = useMemo(() => readStoredUserData(), []);
  const isGuest = useMemo(() => deriveGuestFromUser(userData), [userData]);

  console.log("LobbyRoom: userData", userData, "isGuest", isGuest);

  const link = useMemo(() => {
    const gameId = String(userData.gameId ?? "").trim();
    const sessionId = String(userData.sessionId ?? "").trim();
    if (gameId && sessionId) {
      const base = buildExtramileJoinUrl(isGuest, gameId, sessionId);
      return appendLobbyShareFlagsToJoinUrl(base, code);
    }
    return `${window.location.origin}/arena/lobby/${code}?code=${code}`;
  }, [userData, isGuest, code]);

  const qrSrc = useMemo(
    () => `https://api.qrserver.com/v1/create-qr-code/?size=168x168&margin=8&data=${encodeURIComponent(link)}`,
    [link]
  );

  useEffect(() => {
    const unsubscribe = listenLobby(code, (data) => {
      setLobby(data);
    });
    return unsubscribe;
  }, [code]);

  useEffect(() => {
    if (!lobby) return; // still loading / doesn't exist yet
    const players = lobby.players || {};
    const isMember = !!players[playerId];
    const count = Object.keys(players).length;

    if (isMember) {
      // remember this lobby on userData so LobbyChooser can silently
      // rejoin it later (e.g. reopening the app after closing the tab)
      persistLobbyCode(code);
      return;
    }

    if (!joinAttempted.current) {
      if (count >= 2) {
        setError("This lobby is already full.");
        return;
      }
      joinAttempted.current = true;
      joinLobby({
        code,
        playerId,
        playerName: userDataName() || getLocalPlayerName() || "Player",
      })
        .then(() => persistLobbyCode(code))
        .catch((e) => {
          setError(e.message || "Could not join lobby.");
        });
    }
  }, [lobby, code, playerId]);

  useEffect(() => {
    if (!lobby || navigated.current) return;
    const players = lobby.players || {};
    const count = Object.keys(players).length;
    // Start the battle as soon as both fighters are present in the lobby.
    if (count >= 2 && players[playerId]) {
      navigated.current = true;
      // Fire-and-forget: keep the id on a ref so later lobby snapshots
      // (score/connected/status writes) can't cancel this via effect cleanup.
      startTimerRef.current = setTimeout(
        () => navigate(`/arena/battle/multiplayer/${code}`),
        900
      );
    }
  }, [lobby, code, playerId, navigate]);

  useEffect(() => () => clearTimeout(startTimerRef.current), []);

  // const handleLeave = async () => {
  //   await leaveLobby(code, playerId);
  //   navigate("/arena/lobby");
  // };

  const copyLink = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        // Clipboard API is unavailable outside a secure context (plain
        // http:// on a real server, unlike localhost) -- fall back to the
        // classic hidden-textarea + execCommand trick.
        const ta = document.createElement("textarea");
        ta.value = link;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopyLabel("Copied!");
      setTimeout(() => setCopyLabel("Copy"), 1500);
    } catch {
      setCopyLabel("Copy failed");
      setTimeout(() => setCopyLabel("Copy"), 1500);
    }
  };

  const downloadQr = async () => {
    try {
      const resp = await fetch(qrSrc);
      if (!resp.ok) throw new Error("QR download failed");
      const blob = await resp.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `arena-of-arms-qr-${code || "lobby"}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.open(qrSrc, "_blank", "noopener,noreferrer");
    }
  };

  if (error) {
    return (
      <div className="aoa-root" style={textStyle}>
        <div className="aoa-title" style={{ fontSize: "2rem" }}>Arena of Arms</div>
        <div className="aoa-card">
          <div className="aoa-error">{error}</div>
          <button className="aoa-btn aoa-btn-secondary" style={{ width: "100%", marginTop: "1rem", ...buttonStyle }} onClick={() => navigate("/arena/lobby")}>
            Back to Lobby Menu
          </button>
        </div>
      </div>
    );
  }

  const players = lobby?.players || {};
  const playerCount = Object.keys(players).length;
  const opponentJoined = playerCount >= 2;

  return (
    <div className="aoa-root" style={textStyle}>
      {/* <button className="aoa-back" onClick={handleLeave}>← Leave</button> */}
      <div className="aoa-title" style={{ fontSize: "clamp(1.6rem, 5vw, 2.4rem)" }}>
        {opponentJoined ? "Opponent Found!" : "Lobby Ready"}
      </div>
      <div className="aoa-subtitle">
        {opponentJoined ? "Starting battle…" : "Share the code, QR, or link with your opponent."}
      </div>

      <div className="aoa-card" style={{ textAlign: "center" }}>
        <div className="aoa-lobby-label">Lobby Code</div>
        <div className="aoa-lobby-code">{code}</div>

        <div className="aoa-qr-wrap">
          <QRCode value={link} />
        </div>

        <div className="aoa-link-row">
          <button className="aoa-btn aoa-btn-ghost" onClick={copyLink}>{copyLabel}</button>
          <button className="aoa-btn aoa-btn-ghost" onClick={downloadQr}>Download QR</button>
        </div>

        <div style={{ marginTop: "1.4rem" }}>
          {!opponentJoined ? (
            <div style={{ color: "#b9aed0" }}>
              <span className="aoa-waiting-pulse" />
              Waiting for opponent to join…
            </div>
          ) : (
            <div style={{ color: "#3ea6ff", fontWeight: 700 }}>Both fighters ready ⚔️</div>
          )}
        </div>
      </div>
    </div>
  );
}
