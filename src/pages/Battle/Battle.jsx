import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useThemeColors } from "../../functions/useThemeColors";
import ArmWrestleScene from "../../three/ArmWrestleScene";
import BattleSound from "./battleSound";
import { getCharacter } from "../../data/characters";
import {
  getLocalPlayerId,
  getSessionUserData,
  listenLobby,
  tapLobby,
  WIN_LIMIT,
} from "../../firebaseArena";
import { reportArmMatch } from "../../functions/armReport";
import { fetchReport, reportHasResult, parseTimeToSeconds } from "../../functions/fetchReport";
import "../arena.css";

// firebaseArena.js's buildPlayerProfile/createLobby/joinLobby fall back to
// these literal placeholders when a player has no real name -- treat them as
// blank here too, so the scoreboard falls through to email/employeeId
// instead of displaying "Player"/"Player 1"/"Player 2".
const GENERIC_PLAYER_NAME_RE = /^(null(\s+null)*|player(\s*\d+)?)$/i;

/** name -> email -> employeeId, skipping blanks/"null"/generic "Player" placeholders. */
function pickIdentityName(src) {
  if (!src || typeof src !== "object") return "";
  const name = typeof src.name === "string" ? src.name.trim() : "";
  if (name && !GENERIC_PLAYER_NAME_RE.test(name)) return name;
  const email = typeof src.email === "string" ? src.email.trim() : "";
  if (email) return email;
  const employeeId = typeof src.employeeId === "string" ? src.employeeId.trim() : "";
  if (employeeId) return employeeId;
  return "";
}

const PLAYER_COLOR = "#3ea6ff";
const OPPONENT_COLOR = "#ff4d4d";

/**
 * Pre-fight "VS" matchup card -- both fighters' names in one big line,
 * centered on screen, auto-advancing into the countdown (or tap/keypress
 * to skip ahead), mirroring a typical arm-wrestling app's matchup screen.
 */
function MatchupIntro({ opponentName, opponentColor, onDone }) {
  const doneRef = useRef(false);
  const [leaving, setLeaving] = useState(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    setLeaving(true);
    setTimeout(() => onDone && onDone(), 320);
  }, [onDone]);

  useEffect(() => {
    const t = setTimeout(finish, 1800);
    const onKey = () => finish();
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [finish]);

  return (
    <div className={`aoa-vs-screen ${leaving ? "aoa-vs-leaving" : ""}`} onPointerDown={finish}>
      <div className="aoa-vs-title">
        <span style={{ color: PLAYER_COLOR }}>YOU</span>
        <span className="aoa-vs-title-sep">VS</span>
        <span style={{ color: opponentColor }}>{opponentName}</span>
      </div>

      <div className="aoa-vs-skip">Tap to continue</div>
    </div>
  );
}

export default function Battle({ mode }) {
  const { characterId, code } = useParams();
  const navigate = useNavigate();
  const playerId = useRef(getLocalPlayerId()).current;

  const character = mode === "solo" ? getCharacter(characterId) : null;
  const opponentColor = mode === "solo" ? character.color : OPPONENT_COLOR;

  // ---- theme colors (admin/pages/rules.jsx) applied to the arena UI ----
  const { textStyle: battleStyle, buttonStyle: powerBtnStyle } = useThemeColors();

  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const rafRef = useRef(null);
  const lastTimeRef = useRef(0);

  const meterRef = useRef(0);
  const playerScoreRef = useRef(0);
  const opponentScoreRef = useRef(0);
  const runningRef = useRef(false);
  const matchStartRef = useRef(0); // performance.now() when play begins -- for report `time`
  const reportedRef = useRef(false); // guard: report the match exactly once
  const pinLatchRef = useRef(0); // 0 | +1 | -1 -- once the meter tops out the
  // winning side is latched so the fold always finishes onto the table even if
  // the meter then dips; the round ends when the arm actually lands the pin
  const finalStatsRef = useRef({ points: 0, time: 0 }); // carried to the thank-you page
  const tapWindowRef = useRef([]); // timestamps of recent taps, for shake intensity
  const lastHudPushRef = useRef(0);
  const powerBtnRef = useRef(null);
  const tappedTimeoutRef = useRef(null);

  const getArmVisualMeter = useCallback(() => {
    const controller = sceneRef.current?.armController;
    if (!controller || !Number.isFinite(controller.angle) || !Number.isFinite(controller.cfg?.maxAngle)) {
      return meterRef.current;
    }

    const maxAngle = Math.abs(controller.cfg.maxAngle) || 1;
    return Math.max(-100, Math.min(100, (controller.angle / maxAngle) * 100));
  }, []);

  const [countdown, setCountdown] = useState(3);
  const [phase, setPhase] = useState("matchup"); // matchup -> countdown -> fight -> playing -> result
  const [hud, setHud] = useState({ meter: 0, player: 0, opponent: 0 });
  const [result, setResult] = useState(null); // 'win' | 'lose'
  const [showStart, setShowStart] = useState(false);
  const [opponentName, setOpponentName] = useState(mode === "solo" ? character.fighter : "Opponent");
  const [opponentProfile, setOpponentProfile] = useState(null);
  // local player's own display name, shown as "YOU (name)" on the scoreboard
  // -- name if set, else email, else employeeId
  const myPlayerName = useRef(pickIdentityName(getSessionUserData())).current;
  // opponent's display name, shown as "Opponent (name)" -- the AI fighter's
  // name in solo, or the lobby opponent's profile name/email/employeeId in
  // multiplayer
  const opponentDisplayName =
    mode === "solo"
      ? character.fighter
      : pickIdentityName(opponentProfile) || pickIdentityName({ name: opponentName });
  const opponentNameRef = useRef(opponentName); // read by finishBattle (stable callback)
  useEffect(() => {
    opponentNameRef.current = opponentName;
  }, [opponentName]);
  const opponentProfileRef = useRef(null); // lobby profile of the opponent
  useEffect(() => {
    opponentProfileRef.current = opponentProfile;
  }, [opponentProfile]);

  const lobbyUnsubRef = useRef(null);
  const lobbyStateRef = useRef(null);
  const soundRef = useRef(null);

  // ---- "already played" gate ----
  // Before the match spins up, check for an existing report row. If its status
  // is non-empty (anything past the default "inprogress" — i.e. a round was
  // already recorded), send the player straight to the thank-you page with the
  // score they ended on instead of letting them play again.
  const [reportChecked, setReportChecked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchReport()
      .then((report) => {
        if (cancelled) return;
        if (reportHasResult(report)) {
          navigate("/thankyou", {
            replace: true,
            state: {
              points: Number(report.points) || 0,
              time: parseTimeToSeconds(report.time),
            },
          });
          return;
        }
        setReportChecked(true);
      })
      .catch(() => {
        if (!cancelled) setReportChecked(true); // don't block play on a fetch error
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  // ---- three.js scene lifecycle ----
  const handleTapRef = useRef(() => {});
  useEffect(() => {
    // wait for the "already played" gate to clear before building the scene
    if (!reportChecked || !containerRef.current) return;
    sceneRef.current = new ArmWrestleScene(containerRef.current, {
      playerColor: PLAYER_COLOR,
      opponentColor,
    });
    sceneRef.current.setTapCallback(() => handleTapRef.current());
    return () => {
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportChecked]);

  // ---- background music + SFX -- synthesized tones, no audio asset files
  // (see battleSound.js). Browsers block audio playback until a real user
  // gesture, so the very first pointerdown/keydown anywhere on the page
  // unlocks it; the match's bass loop plays for the whole fight and stops
  // once the result screen shows. ----
  useEffect(() => {
    soundRef.current = new BattleSound();
    const unlock = () => soundRef.current?.unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      soundRef.current?.dispose();
      soundRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (phase === "result") soundRef.current?.stopMusic();
    else soundRef.current?.startMusic();
  }, [phase]);

  useEffect(() => {
    if (phase === "countdown") soundRef.current?.ready();
    else if (phase === "fight") soundRef.current?.fight();
  }, [phase]);

  // tap directly on the clasped arms (in addition to the POWER button) only
  // while actively playing; the arena keeps a slow 360 showcase spin until then
  useEffect(() => {
    sceneRef.current?.setTappable(phase === "playing");
    sceneRef.current?.setShowcase(phase === "matchup" || phase === "countdown");
    // keep the arms hidden through the whole ready/fight/start beat -- only
    // reveal them once the camera has settled front-on for actual play
    sceneRef.current?.setArmsVisible(phase === "playing" || phase === "result");
  }, [phase]);

  // ---- countdown ----
  useEffect(() => {
    if (phase !== "countdown") return;
    if (countdown <= 0) {
      setPhase("fight");
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 700);
    return () => clearTimeout(t);
  }, [phase, countdown]);

  // ---- big "FIGHT!" beat -- held on screen for a moment before the game
  // loop actually starts, instead of flashing by for a single frame ----
  useEffect(() => {
    if (phase !== "fight") return;
    const t = setTimeout(() => {
      runningRef.current = true;
      matchStartRef.current = performance.now();
      reportedRef.current = false;
      pinLatchRef.current = 0;
      setPhase("playing");
    }, 650);
    return () => clearTimeout(t);
  }, [phase]);

  // ---- brief "START!" flash the instant play actually begins, completing
  // the ready -> fight -> start beat -- shown as an overlay independent of
  // the POWER button/tap-hint below it, not in place of them ----
  useEffect(() => {
    if (phase !== "playing") return;
    setShowStart(true);
    soundRef.current?.start();
    const t = setTimeout(() => setShowStart(false), 550);
    return () => clearTimeout(t);
  }, [phase]);

  const finishBattle = useCallback((outcome) => {
    runningRef.current = false;
    if (outcome === "win") {
      sceneRef.current?.triggerWin();
      soundRef.current?.win();
    } else {
      sceneRef.current?.triggerLose();
      soundRef.current?.lose();
    }

    // report the finished match once -- winner, points, time, status -- via
    // sendReport -> backend /addReport. Fire-and-forget; never blocks the UI.
    if (!reportedRef.current) {
      reportedRef.current = true;
      const durationSec = matchStartRef.current
        ? (performance.now() - matchStartRef.current) / 1000
        : 0;
      finalStatsRef.current = {
        points: Math.round(playerScoreRef.current),
        time: Math.round(durationSec),
      };
      const oppProfile = opponentProfileRef.current || {};
      reportArmMatch({
        outcome,
        points: playerScoreRef.current,
        durationSec,
        mode,
        opponentName:
          mode === "solo" ? character?.fighter : opponentNameRef.current,
        opponent:
          mode === "solo"
            ? { id: "AI", name: character?.fighter || "AI", email: "AI" }
            : {
                id:
                  oppProfile.userId ||
                  oppProfile.employeeId ||
                  oppProfile.email ||
                  opponentNameRef.current ||
                  "",
                name: oppProfile.name || opponentNameRef.current || "Opponent",
                email: oppProfile.email || oppProfile.employeeId || "",
              },
      }).catch(() => {});
    }
    // hold the result overlay back until the arm has actually slammed to the
    // table (isPinComplete), not just a fixed beat -- the meter can trip the
    // win threshold while the arm is still upright, and the pin should be
    // fully seen. Cap it so a stalled animation can never hang the round.
    // the arm is already folded onto the table by the time the meter tops
    // out, so this just holds the pinned pose a short beat before the dark
    // result overlay covers it. Hard cap so a stall can never hang the round.
    const started = performance.now();
    const drop = () => {
      const elapsed = performance.now() - started;
      const done = sceneRef.current?.isPinComplete?.();
      if ((done && elapsed > 450) || elapsed > 1400) {
        setResult(outcome);
        setPhase("result");
      } else {
        requestAnimationFrame(drop);
      }
    };
    requestAnimationFrame(drop);
    // mode + characterId don't change for the life of this component, so the
    // captured `mode`/`character` values stay correct with an empty dep list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- main game loop ----
  useEffect(() => {
    const loop = (t) => {
      rafRef.current = requestAnimationFrame(loop);
      if (!lastTimeRef.current) lastTimeRef.current = t;
      const dt = Math.min((t - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = t;
      if (!runningRef.current) return;

      // The round ends only on a REAL pin: the clasped fists must have folded
      // all the way down onto the table (armController.angle at ~full
      // maxAngle), not merely because the tug-of-war meter hit 100. The meter
      // drives the fold toward the table; the win fires the frame the arm
      // actually gets there -- so the progress bar (fed by the same bone
      // angle, see getArmVisualMeter) reads ~100% at exactly that moment.
      const armController = sceneRef.current?.armController;
      const angle = armController?.angle || 0;
      const maxAngle = Math.abs(armController?.cfg?.maxAngle || 0);
      const playerPinned = maxAngle > 0 && angle >= maxAngle * 0.98;
      const opponentPinned = maxAngle > 0 && angle <= -maxAngle * 0.98;

      // latch the winning side the moment the meter first tops out, and drive
      // the fold hard to that side so the pin always completes onto the table
      if (!pinLatchRef.current) {
        if (meterRef.current >= WIN_LIMIT) pinLatchRef.current = 1;
        else if (meterRef.current <= -WIN_LIMIT) pinLatchRef.current = -1;
      }
      if (pinLatchRef.current) {
        armController?.lock(pinLatchRef.current > 0 ? "right" : "left");
      }

      const playerWinGate = playerPinned && (meterRef.current >= 90 || pinLatchRef.current === 1);
      const opponentWinGate = opponentPinned && (meterRef.current <= -90 || pinLatchRef.current === -1);

      if (playerWinGate) {
        finishBattle("win");
        return;
      }

      if (mode === "solo") {
        opponentScoreRef.current += character.pressure * dt;
        meterRef.current -= character.pressure * dt;
      } else {
        // multiplayer meter derives from synced scores (see listener below)
        const lobby = lobbyStateRef.current;
        if (lobby) {
          const players = lobby.players || {};
          const me = players[playerId]?.score || 0;
          const opp = Object.keys(players)
            .filter((id) => id !== playerId)
            .reduce((sum, id) => sum + (players[id]?.score || 0), 0);
          playerScoreRef.current = me;
          opponentScoreRef.current = opp;
          meterRef.current = me - opp;
        }
      }

      meterRef.current = Math.max(-100, Math.min(100, meterRef.current));

      // whenever the arm swings back through dead center (neither side has an
      // advantage) both players' tug-of-war scores are wiped back to 0 -- the
      // scoreboard tracks the CURRENT push, not lifetime taps. Solo only; in
      // multiplayer the scores are the authoritative synced values.
      if (
        mode === "solo" &&
        !pinLatchRef.current &&
        Math.abs(meterRef.current) <= 1.5
      ) {
        playerScoreRef.current = 0;
        opponentScoreRef.current = 0;
      }

      // the 3D scene reads meterRef directly every frame (setMeter is cheap,
      // no React involved), so the arm's lean/camera stay a full 60fps
      // regardless of how often the HUD below re-renders
      sceneRef.current?.setMeter(meterRef.current);

      // throttle the React state push that drives the HUD (score boxes,
      // meter bar) to ~30fps instead of every animation frame -- pushing it
      // at 60fps re-renders the whole Battle component (including the
      // POWER button) twice as often as it needs to, which was stealing
      // main-thread time from actually handling the button's own tap
      // events and made rapid tapping feel laggy/dropped
      if (t - lastHudPushRef.current >= 33) {
        lastHudPushRef.current = t;
        const visualMeter = getArmVisualMeter();
        setHud({
          meter: visualMeter,
          player: Math.round(playerScoreRef.current),
          opponent: Math.round(opponentScoreRef.current),
        });
      }

      if (opponentWinGate) {
        finishBattle("lose");
        return;
      }
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, character, playerId, finishBattle]);

  // ---- multiplayer lobby sync ----
  useEffect(() => {
    if (mode !== "multiplayer" || !code) return;
    lobbyUnsubRef.current = listenLobby(code, (lobby) => {
      lobbyStateRef.current = lobby;
      if (!lobby) return;
      const players = lobby.players || {};
      const oppEntry = Object.entries(players).find(([id]) => id !== playerId);
      if (oppEntry) {
        setOpponentName(oppEntry[1]?.name || "Opponent");
        setOpponentProfile(oppEntry[1]?.profile || { name: oppEntry[1]?.name });
      }

      // opponent triggered a rematch (scores reset) while we're showing result
      if (lobby.status === "active" && phase === "result") {
        meterRef.current = 0;
        playerScoreRef.current = 0;
        opponentScoreRef.current = 0;
        reportedRef.current = false;
        pinLatchRef.current = 0;
        sceneRef.current?.reset();
        setResult(null);
        setCountdown(3);
        setPhase("countdown");
      }
    });
    return () => lobbyUnsubRef.current && lobbyUnsubRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, code, playerId]);

  // ---- tap handler ----
  // The pressed-state flash used to go through React state (setTapped +
  // setTimeout), which meant every single tap forced a full component
  // re-render on top of the already-frequent HUD one above. Toggling the
  // class directly on the button's own DOM node keeps that feedback
  // instant and off the React render path entirely, so it can't be delayed
  // behind other pending state updates when tapping fast.
  const handleTap = useCallback(() => {
    if (phase !== "playing") return;
    const btn = powerBtnRef.current;
    if (btn) {
      btn.classList.add("tapped");
      clearTimeout(tappedTimeoutRef.current);
      tappedTimeoutRef.current = setTimeout(() => btn.classList.remove("tapped"), 90);
    }

    const now = performance.now();
    tapWindowRef.current = tapWindowRef.current.filter((ts) => now - ts < 1000);
    tapWindowRef.current.push(now);
    const recentTaps = tapWindowRef.current.length;
    sceneRef.current?.pulseTap(1 + Math.min(recentTaps / 6, 1.5));
    soundRef.current?.tap();

    if (mode === "solo") {
      playerScoreRef.current += 3;
      meterRef.current = Math.max(-100, Math.min(100, meterRef.current + 3));
    } else {
      // optimistic local bump for instant feedback; Firebase listener reconciles the true value
      playerScoreRef.current += 3;
      meterRef.current = Math.max(-100, Math.min(100, meterRef.current + 3));
      tapLobby(code, playerId);
    }
  }, [phase, mode, code, playerId]);

  useEffect(() => {
    handleTapRef.current = handleTap;
  }, [handleTap]);

  // keyboard support (space/enter) for desktop testing
  useEffect(() => {
    const onKey = (e) => {
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        handleTap();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleTap]);

  // Multiplayer always moves straight on to the thank-you page — no rematch
  // option there. Solo instead shows a Rematch button (see result overlay
  // below) and only leaves for the thank-you page when the player chooses to.
  useEffect(() => {
    if (mode === "multiplayer" && phase === "result") {
      const timeout = setTimeout(() => {
        navigate("/thankyou", {
          replace: true,
          state: {
            points: finalStatsRef.current.points,
            time: finalStatsRef.current.time,
          },
        });
      }, 2600); // hold the result screen long enough to actually see the
      // win/lose silhouette animation before jumping to the thank-you page

      return () => clearTimeout(timeout);
    }
  }, [mode, phase, navigate]);

  const handleRematch = useCallback(() => {
    meterRef.current = 0;
    playerScoreRef.current = 0;
    opponentScoreRef.current = 0;
    reportedRef.current = false;
    pinLatchRef.current = 0;
    sceneRef.current?.reset();
    setResult(null);
    setCountdown(3);
    setPhase("countdown");
  }, []);

  const handleExit = useCallback(() => {
    navigate("/thankyou", {
      replace: true,
      state: {
        points: finalStatsRef.current.points,
        time: finalStatsRef.current.time,
      },
    });
  }, [navigate]);

  const meterPct = ((hud.meter + 100) / 200) * 100; // 0..100 (50 = dead even)
  const fillLeft = Math.min(50, meterPct);
  const fillWidth = Math.abs(meterPct - 50);
  // who's ahead + how close the leader is to a full pin (WIN_LIMIT = 100)
  const leadSide = hud.meter > 1 ? "player" : hud.meter < -1 ? "opponent" : "even";
  const pinPct = Math.min(100, Math.round((Math.abs(hud.meter) / WIN_LIMIT) * 100));
  const meterCritical = pinPct >= 75;
  const leadColor = leadSide === "opponent" ? OPPONENT_COLOR : PLAYER_COLOR;

  const resultMsg =
    result === "win"
      ? mode === "solo"
        ? `You overpowered ${character.fighter}!`
        : `You overpowered ${opponentName}!`
      : mode === "solo"
      ? `${character.fighter} was too strong this time.`
      : `${opponentName} pushed through.`;

  // hold the whole battle UI back until the "already played" check resolves
  // (a matching report redirects to /thankyou instead)
  if (!reportChecked) {
    return <div className="aoa-battle" style={battleStyle} />;
  }

  return (
    <div className="aoa-battle" style={battleStyle}>
      {phase === "matchup" && (
        <MatchupIntro
          opponentName={mode === "solo" ? character.name : opponentName}
          opponentColor={opponentColor}
          onDone={() => {
            setCountdown(3);
            setPhase("countdown");
          }}
        />
      )}

      <div className="aoa-canvas-layer" ref={containerRef} />

      <div className="aoa-hud">
        {phase !== "matchup" && (
          <div>
            <div className="aoa-scoreboard">
              <div className="aoa-score-box player">
                <div className="aoa-score-name">
                  YOU{myPlayerName ? ` (${myPlayerName})` : ""}
                </div>
                <div className="aoa-score-value">{hud.player}</div>
              </div>
              <div className="aoa-score-box opponent">
                <div className="aoa-score-name">
                  Opponent{opponentDisplayName ? ` (${opponentDisplayName})` : ""}
                </div>
                <div className="aoa-score-value">{hud.opponent}</div>
              </div>
            </div>
            <div
              className={`aoa-meter-row lead-${leadSide}${meterCritical ? " is-critical" : ""}`}
              style={{ "--lead-color": leadColor }}
            >
              <span className="aoa-meter-tag player">YOU</span>
              <div className="aoa-meter-track">
                <div className="aoa-meter-zone left" />
                <div className="aoa-meter-zone right" />
                <div className="aoa-meter-ticks" />
                <div className="aoa-meter-center" />
                <div
                  className="aoa-meter-fill"
                  style={{ left: `${fillLeft}%`, width: `${fillWidth}%` }}
                />
                <div className="aoa-meter-knob" style={{ left: `${meterPct}%` }} />
              </div>
              <span className="aoa-meter-tag opponent">{opponentName}</span>
              <div className="aoa-meter-readout">
                {leadSide === "even" ? "EVEN" : `${pinPct}%`}
              </div>
            </div>
          </div>
        )}

        {(phase === "countdown" || phase === "fight") && (
          <div className={`aoa-countdown ${phase === "countdown" ? "aoa-countdown-ready" : "aoa-countdown-fight"}`}>
            {phase === "countdown" ? "READY" : "FIGHT!"}
          </div>
        )}

        <div className="aoa-bottom-hud">
          {phase === "playing" && (
            <>
              <button
                ref={powerBtnRef}
                className="aoa-power-btn"
                style={powerBtnStyle}
                onPointerDown={(e) => {
                  // prevent the browser's synthetic-click / touch-delay
                  // pipeline from adding lag or double-firing on mobile --
                  // pointerdown already gives instant, reliable tap timing
                  e.preventDefault();
                  handleTap();
                }}
              >
                POWER
              </button>
              <div className="aoa-tap-hint">Tap the button — or the clashing fists — as fast as you can</div>
            </>
          )}
        </div>
      </div>

      {/* completes the ready -> fight -> start beat: a brief independent
          overlay the instant play begins, rather than blocking the POWER
          button/tap-hint that render in the same "playing" phase */}
      {showStart && (
        <div className="aoa-countdown aoa-countdown-start aoa-countdown-overlay">START!</div>
      )}

      {phase === "result" && (
        <div className="aoa-result-overlay">
          <div className={`aoa-result-title ${result}`}>{result === "win" ? "YOU WIN" : "YOU LOSE"}</div>
          <div className="aoa-result-score">
            {hud.player} — {hud.opponent}
          </div>
          <div className="aoa-result-msg">{resultMsg}</div>
          {mode === "solo" && (
            <div className="aoa-result-actions">
              <button className="aoa-btn aoa-btn-primary" style={powerBtnStyle} onClick={handleRematch}>
                Rematch
              </button>
              <button className="aoa-btn aoa-btn-ghost" onClick={handleExit}>
                Exit
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
