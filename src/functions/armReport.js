import { sendReport, extractReportIdFromResponse } from "./sendReport";

const USER_DATA_KEY = "userData";

function readSessionUserData() {
  try {
    const raw =
      sessionStorage.getItem(USER_DATA_KEY) ||
      localStorage.getItem(USER_DATA_KEY) ||
      "{}";
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

function fmtTime(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/**
 * Fire-and-forget report for one Arena of Arms match. Runs when a solo /
 * multiplayer round ends: first hits the external game-server via sendReport
 * to get a fresh reportId (never reused, so every match is its own entry and
 * the game stays replayable), then mirrors winner / points / time / status
 * onto our own `stages` row via the backend /addReport controller.
 *
 * `status` is 'win' or 'lose' (NOT 'completed'), so stages.gameover is never
 * set and the "Already Played" gate never triggers for this game.
 *
 * @param {object} match
 * @param {"win"|"lose"} match.outcome     from the player's point of view
 * @param {number}       match.points      the player's final score
 * @param {number}       match.durationSec elapsed match time in seconds
 * @param {"solo"|"multiplayer"} match.mode
 * @param {string}       match.opponentName the opponent's display name
 * @param {object}       match.opponent    { id, name, email } — real opponent
 *   identity. In multiplayer this comes from the lobby profile; in solo it's
 *   the AI fighter.
 */
export async function reportArmMatch({
  outcome,
  points,
  durationSec,
  mode,
  opponentName,
  opponent,
}) {
  const u = readSessionUserData();
  const userId = u.userId || u.userid || u.id || "";
  const { sessionId, organizationId } = u;
  const role = u.role || u.source;

  if (role === "demobypass" || role === "DEMO") return;
  if (!userId || !sessionId || !organizationId) {
    // no real session (e.g. opened /arena directly) — nothing to report to
    return;
  }

  const won = outcome === "win";
  const isSolo = mode === "solo";
  const playerId = String(userId);
  const playerName = (typeof u.name === "string" && u.name.trim()) || "Player";
  const playerEmail = u.email || u.employeeId || "";

  // opponent identity — real id/name/email in multiplayer, "AI" in solo
  const opponentName_ = opponent?.name || opponentName || (isSolo ? "AI" : "Opponent");
  const opponentId = opponent?.id
    ? String(opponent.id)
    : isSolo
      ? "AI"
      : "";
  const opponentEmail = opponent?.email
    ? String(opponent.email)
    : isSolo
      ? "AI"
      : "";

  // the winner is the player (their own id) when they won; otherwise it's the
  // opponent's real id in multiplayer, or "AI" for a solo loss
  const winnerId = won
    ? playerId
    : isSolo
      ? "AI"
      : opponentId || "AI";
  const winnerName = won ? playerName : opponentName_;
  const time = fmtTime(durationSec);
  const score = Math.round(Number(points) || 0);
  const status = won ? "win" : "lose";

  // 1) external game-server report -> reportId (no id passed = always new)
  let reportId = null;
  try {
    const resp = await sendReport({
      sessionId,
      organizationId,
      userId,
      role,
      token: u.token,
      gameId: u.gameId,
      name: playerName,
      points: score,
      time,
    });
    reportId = extractReportIdFromResponse(resp);
  } catch (err) {
    console.warn("[reportArmMatch] sendReport failed:", err);
  }
  if (!reportId) {
    reportId = `arm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // 2) mirror onto our own stages row
  const base = String(process.env.REACT_APP_BACKEND_URL || "").replace(/\/+$/, "");
  if (!base) return;
  try {
    await fetch(`${base}/addReport`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionId}&${organizationId}`,
      },
      body: JSON.stringify({
        userId,
        reportId,
        name: playerName,
        email: playerEmail,
        points: score,
        total_score: score,
        time,
        status,
        winnerId, // player's id (win), opponent's id (mp loss), or "AI" (solo loss)
        opponentId: opponentId || "AI",
        opponentemail: opponentEmail || opponentId || "AI",
        // full match identity also rides along in the opaque `current` array
        current: [
          {
            outcome: status,
            playerId,
            playerName,
            playerEmail,
            winnerId,
            winnerName,
            opponentId: opponentId || "AI",
            opponentName: opponentName_,
            opponentEmail: opponentEmail || "",
            points: score,
            time,
            at: new Date().toISOString(),
          },
        ],
        answers: [],
      }),
    });
  } catch (err) {
    console.error("[reportArmMatch] addReport failed:", err);
  }
}
