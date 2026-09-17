import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { fetchThemeData } from "../../admin/themeSlice";
import { useThemeColors } from "../../functions/useThemeColors";
import {
  getLocalPlayerId,
  listenLobby,
  setPlayerRematchReady,
  rematchLobby,
  clearRematchReady,
} from "../../firebaseArena";
import "../leaderboard/leaderboard.css";

function formatTime(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export default function ThankYou() {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { data: themeData } = useSelector((state) => state.theme);
  const { buttonStyle } = useThemeColors();
  const { points, time, totalPoints, totalTime, mode, code, result, characterId } =
    location.state || {};
  const isMultiplayer = mode === "multiplayer" && !!code;
  const playerId = useRef(getLocalPlayerId()).current;
  const resultLabel = result === "lose" ? "YOU LOST" : "YOU WON";

  // 'idle' -> this player hasn't clicked Play Again yet
  // 'waiting' -> this player is ready, waiting on the opponent
  // 'starting' -> both ready, about to jump back into the battle
  const [rematchState, setRematchState] = useState("idle");
  const lobbyUnsubRef = useRef(null);

  useEffect(() => {
    dispatch(fetchThemeData({ themeId: null }));
  }, [dispatch]);

  // Solo restarts the same matchup by re-entering the same battle route;
  // multiplayer's own "Play Again" flow (below) keeps the same lobby instead.
  const playAgainPath = characterId
    ? `/arena/battle/solo/${characterId}`
    : "/arena/solo";

  const startMultiplayerRematch = useCallback(() => {
    lobbyUnsubRef.current?.();
    lobbyUnsubRef.current = null;
    // best-effort -- both clients may race to do this, which is harmless
    // since resetting scores/flags twice lands on the same end state
    rematchLobby(code).catch(() => {});
    clearRematchReady(code).catch(() => {});
    navigate(`/arena/battle/multiplayer/${code}`, { replace: true });
  }, [code, navigate]);

  const handlePlayAgain = useCallback(() => {
    if (!isMultiplayer) {
      navigate(playAgainPath);
      return;
    }
    if (rematchState !== "idle") return;
    setRematchState("waiting");
    setPlayerRematchReady(code, playerId, true).catch(() => {});
    lobbyUnsubRef.current = listenLobby(code, (lobby) => {
      if (!lobby) return;
      const players = lobby.players || {};
      const ids = Object.keys(players);
      const bothReady = ids.length >= 2 && ids.every((id) => players[id]?.rematchReady);
      if (bothReady) {
        setRematchState("starting");
        startMultiplayerRematch();
      }
    });
  }, [isMultiplayer, playAgainPath, navigate, rematchState, code, playerId, startMultiplayerRematch]);

  useEffect(() => {
    return () => {
      lobbyUnsubRef.current?.();
      lobbyUnsubRef.current = null;
    };
  }, []);

  const accent =
    themeData?.textcolor ??
    themeData?.text_color ??
    themeData?.landing_page_title_color ??
    "#ffffff";

  // Reached directly (no score/time carried over) — nothing to show here.
  if (points == null && time == null) {
    return <Navigate to="/leaderboard" replace />;
  }

  const playAgainLabel =
    rematchState === "waiting"
      ? "Waiting for opponent…"
      : rematchState === "starting"
        ? "Starting…"
        : "Play Again";

  return (
    <div className="lb-stage ty-stage" style={{ "--lb-accent": accent }}>
      <div className="lb-overlay">
        <img
          src="/img/ty.png"
          alt="Thank You For Playing!"
          className="ty-badge"
        />

        <div className="ty-content">
          {result && (
            <div className={`ty-result ty-result-${result}`}>{resultLabel}</div>
          )}
          <div className="ty-stats">
            <div className="ty-stat">
              <span className="ty-stat__icon" aria-hidden="true">
                ⭐
              </span>
              <span className="ty-stat__label">Current Score</span>
              <span className="ty-stat__value">{points ?? 0}</span>
            </div>
            <div className="ty-stat">
              <span className="ty-stat__icon" aria-hidden="true">
                ⏱️
              </span>
              <span className="ty-stat__label">Time Taken</span>
              <span className="ty-stat__value">{formatTime(time)}</span>
            </div>
          </div>
          {/* lifetime totals across every match/opponent played so far --
              only shown when reportArmMatch actually returned them */}
          {(totalPoints != null || totalTime != null) && (
            <div className="ty-stats ty-stats--total">
              <div className="ty-stat">
                <span className="ty-stat__icon" aria-hidden="true">
                  🏆
                </span>
                <span className="ty-stat__label">Total Score</span>
                <span className="ty-stat__value">{totalPoints ?? points ?? 0}</span>
              </div>
              <div className="ty-stat">
                <span className="ty-stat__icon" aria-hidden="true">
                  ⏱️
                </span>
                <span className="ty-stat__label">Total Time</span>
                <span className="ty-stat__value">{formatTime(totalTime ?? time)}</span>
              </div>
            </div>
          )}
          <button
            type="button"
            className="lb-thankyou-btn ty-btn"
            style={buttonStyle}
            disabled={rematchState !== "idle"}
            onClick={handlePlayAgain}
          >
            {rematchState !== "idle" && (
              <span className="aoa-waiting-pulse" aria-hidden="true" />
            )}
            {isMultiplayer ? playAgainLabel : "Play Again"}
          </button>
          {/* kept in the DOM (not removed) per request -- just hidden */}
          <button
            type="button"
            className="lb-thankyou-btn ty-btn"
            style={{ ...buttonStyle, display: "none" }}
            onClick={() => navigate("/leaderboard")}
          >
            View Leaderboard
          </button>
        </div>
      </div>
    </div>
  );
}
