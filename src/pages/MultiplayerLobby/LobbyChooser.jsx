import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  createLobby,
  getLocalPlayerId,
  getLocalPlayerName,
} from "../../firebaseArena";
import { setBackButtonUrl } from "../uiSlice";
import { useThemeColors } from "../../functions/useThemeColors";
import "../arena.css";

/** The player's name -- always taken from the session payload (userData); the
 *  player never types it in when creating or joining a lobby. */
function playerName() {
  try {
    const raw =
      sessionStorage.getItem("userData") ||
      localStorage.getItem("userData") ||
      "{}";
    const u = JSON.parse(raw) || {};
    const n = typeof u.name === "string" ? u.name.trim() : "";
    if (n && !/^null(\s+null)*$/i.test(n)) return n;
  } catch {
    /* ignore */
  }
  return getLocalPlayerName() || "Player";
}

export default function LobbyChooser() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { status, user } = useSelector((state) => state.auth);
  const { textStyle, buttonStyle } = useThemeColors();
  const [searchParams] = useSearchParams();
  const [code, setCode] = useState(searchParams.get("code") || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleCreate = async () => {
    setError("");
    setBusy(true);
    try {
      const playerId = getLocalPlayerId();
      const newCode = await createLobby({ playerId, playerName: playerName() });
      navigate(`/arena/lobby/${newCode}`);
    } catch (e) {
      setError(e.message || "Could not create lobby.");
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = () => {
    setError("");
    const clean = code.trim();
    if (!/^\d{6}$/.test(clean)) return setError("Enter the 6-digit lobby code.");
    navigate(`/arena/lobby/${clean}`);
  };

  useEffect(() => {
    dispatch(setBackButtonUrl("/arena"));
  }, [status, user, dispatch]);

  return (
    <div className="aoa-root" style={textStyle}>
      <div className="aoa-title" style={{ fontSize: "clamp(1.6rem, 5vw, 2.4rem)" }}>
        Multiplayer Lobby
      </div>
      <div className="aoa-subtitle">Create a lobby or join with a code.</div>

      <div className="aoa-lobby-split">
        <div className="aoa-card aoa-lobby-panel">
          <div className="aoa-lobby-panel-title">Create Lobby</div>
          <div className="aoa-lobby-panel-desc">Challenge your friends, anywhere.</div>
          <button
            className="aoa-btn aoa-btn-primary"
            style={{ width: "100%", marginTop: "auto", ...buttonStyle }}
            disabled={busy}
            onClick={handleCreate}
          >
            {busy ? "Creating…" : "Create Lobby"}
          </button>
        </div>

        <div className="aoa-card aoa-lobby-panel">
          <div className="aoa-lobby-panel-title">Join Lobby</div>
          <div className="aoa-lobby-panel-desc">Enter a room code to join.</div>
          <input
            className="aoa-code-input"
            placeholder="000000"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => {
              setError("");
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
            }}
            style={{ marginBottom: "0.9rem" }}
          />
          <button
            className="aoa-btn aoa-btn-primary"
            style={{ width: "100%", ...buttonStyle }}
            onClick={handleJoin}
          >
            Join
          </button>
        </div>
      </div>

      {error && <div className="aoa-error">{error}</div>}
    </div>
  );
}
