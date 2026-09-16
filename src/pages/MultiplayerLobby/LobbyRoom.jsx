import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate, useParams } from "react-router-dom";
import { setBackButtonUrl } from '../uiSlice';
import { useThemeColors } from '../../functions/useThemeColors';
import {
  getLocalPlayerId,
  getLocalPlayerName,
  joinLobby,
  listenLobby,
} from "../../firebaseArena";
import QRCode from "../../components/QRCode";
import "../arena.css";

/** The logged-in player's name from the session payload (userData). */
function userDataName() {
  try {
    const raw =
      sessionStorage.getItem("userData") ||
      localStorage.getItem("userData") ||
      "{}";
    const u = JSON.parse(raw) || {};
    const n = typeof u.name === "string" ? u.name.trim() : "";
    return n && !/^null(\s+null)*$/i.test(n) ? n : "";
  } catch {
    return "";
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
  const [copied, setCopied] = useState(false);
  const joinAttempted = useRef(false);
  const navigated = useRef(false);
  const startTimerRef = useRef(null);
  useEffect(() => {
    dispatch(setBackButtonUrl("/arena/lobby"));
  }, [status, user]);

  const link = `${window.location.origin}/arena/lobby/${code}?code=${code}`;

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

    if (!isMember && !joinAttempted.current) {
      if (count >= 2) {
        setError("This lobby is already full.");
        return;
      }
      joinAttempted.current = true;
      joinLobby({
        code,
        playerId,
        playerName: userDataName() || getLocalPlayerName() || "Player",
      }).catch((e) => {
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

  const copyLink = () => {
    navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
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
          <div className="aoa-link-input">{link}</div>
          <button className="aoa-btn aoa-btn-ghost" onClick={copyLink}>{copied ? "Copied!" : "Copy"}</button>
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
