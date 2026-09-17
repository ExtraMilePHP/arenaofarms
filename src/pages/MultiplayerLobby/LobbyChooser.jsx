import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  checkLobbyRejoinable,
  createLobby,
  getLocalPlayerId,
  getLocalPlayerName,
} from "../../firebaseArena";
import { setBackButtonUrl } from "../uiSlice";
import { useThemeColors } from "../../functions/useThemeColors";
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

/** The player's name -- always taken from the session payload (userData); the
 *  player never types it in when creating or joining a lobby. */
function playerName() {
  const u = readStoredUserData();
  const n = typeof u.name === "string" ? u.name.trim() : "";
  if (n && !/^null(\s+null)*$/i.test(n)) return n;
  return getLocalPlayerName() || "Player";
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

export default function LobbyChooser() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { status, user } = useSelector((state) => state.auth);
  const { textStyle, buttonStyle } = useThemeColors();
  const [searchParams] = useSearchParams();
  const [code, setCode] = useState(searchParams.get("code") || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checkingRejoin, setCheckingRejoin] = useState(true);
  const storedLobbyCode = useMemo(
    () => String(readStoredUserData()?.lobby || "").trim(),
    []
  );

  const handleCreate = async () => {
    setError("");
    setBusy(true);
    try {
      const playerId = getLocalPlayerId();
      const newCode = await createLobby({ playerId, playerName: playerName() });
      persistLobbyCode(newCode);
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
    persistLobbyCode(clean);
    navigate(`/arena/lobby/${clean}`);
  };

  useEffect(() => {
    dispatch(setBackButtonUrl("/arena"));
  }, [status, user, dispatch]);

  // Silently rejoin a lobby the player already created/joined (persisted on
  // userData.lobby) if it's still open, instead of showing create/join again.
  useEffect(() => {
    let cancelled = false;
    if (!storedLobbyCode) {
      setCheckingRejoin(false);
      return undefined;
    }
    checkLobbyRejoinable(storedLobbyCode, getLocalPlayerId())
      .then((ok) => {
        if (cancelled) return;
        if (ok) {
          navigate(`/arena/lobby/${storedLobbyCode}`, { replace: true });
          return;
        }
        persistLobbyCode(null);
        setCheckingRejoin(false);
      })
      .catch(() => {
        if (!cancelled) setCheckingRejoin(false);
      });
    return () => {
      cancelled = true;
    };
  }, [storedLobbyCode, navigate]);

  if (checkingRejoin) {
    return <div className="aoa-root" style={textStyle} />;
  }

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
            style={{ width: "80%", margin: "auto auto 0", ...buttonStyle }}
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
            style={{ width: "80%", margin: "0 auto", ...buttonStyle }}
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
