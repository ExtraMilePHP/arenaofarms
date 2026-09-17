import { sendReport, extractReportIdFromResponse } from "./sendReport";

const USER_DATA_KEY = "userData";
// per-opponent cumulative report state (reportId + running points/time),
// keyed by opponentId so repeat matches against the SAME opponent merge onto
// the same report row (and the same external reportId) instead of every
// replay creating a brand new, disconnected report -- see reportArmMatch.
const OPPONENT_REPORTS_KEY = "aoa_opponentReports";

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

function readOpponentReports() {
  try {
    return JSON.parse(localStorage.getItem(OPPONENT_REPORTS_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function writeOpponentReports(map) {
  try {
    localStorage.setItem(OPPONENT_REPORTS_KEY, JSON.stringify(map));
  } catch {
    /* ignore storage failures */
  }
}

/** Grand total across every opponent ever played -- for the thank-you page. */
function computeGrandTotal(map) {
  let points = 0;
  let seconds = 0;
  Object.values(map || {}).forEach((v) => {
    points += Number(v?.points) || 0;
    seconds += Number(v?.seconds) || 0;
  });
  return { points, seconds };
}

/**
 * Fire-and-forget report for one Arena of Arms match. Runs when a solo /
 * multiplayer round ends. The player can replay freely (no "already played"
 * gate) -- each match against the SAME opponent merges onto that opponent's
 * existing report row instead of starting a fresh one:
 *
 *   1) look up this opponent's last-known reportId + cumulative points/time
 *      (stored locally, since the backend's /fetchReport is per-user, not
 *      per-opponent)
 *   2) add this match's score/time on top, and call sendReport WITH that
 *      reportId when one exists -- sendReport treats a present reportId as
 *      an update (PUT) rather than a new report (POST), so the external
 *      game-server row itself accumulates instead of multiplying
 *   3) mirror the same cumulative totals onto our own `stages` row via
 *      /addReport, keyed by the same reportId
 *
 * `status` is 'win' or 'lose' (NOT 'completed'), so stages.gameover is never
 * set and this game never gets an "Already Played" gate.
 *
 * @param {object} match
 * @param {"win"|"lose"} match.outcome     from the player's point of view
 * @param {number}       match.points      the player's THIS-MATCH score
 * @param {number}       match.durationSec elapsed match time in seconds
 * @param {"solo"|"multiplayer"} match.mode
 * @param {string}       match.opponentName the opponent's display name
 * @param {object}       match.opponent    { id, name, email } — real opponent
 *   identity. In multiplayer this comes from the lobby profile; in solo it's
 *   the AI fighter.
 * @returns {Promise<{matchScore:number, matchSeconds:number, totalPoints:number, totalSeconds:number}|null>}
 *   this match's own score/time plus the grand total accumulated across every
 *   opponent played so far (for the thank-you page's "total score" stat) --
 *   `null` when there was nothing to report to (demo/no session).
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

  if (role === "demobypass" || role === "DEMO") return null;
  if (!userId || !sessionId || !organizationId) {
    // no real session (e.g. opened /arena directly) — nothing to report to
    return null;
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
  const opponentKey = opponentId || "AI";

  // the winner is the player (their own id) when they won; otherwise it's the
  // opponent's real id in multiplayer, or "AI" for a solo loss
  const winnerId = won
    ? playerId
    : isSolo
      ? "AI"
      : opponentId || "AI";
  const winnerName = won ? playerName : opponentName_;
  const matchScore = Math.round(Number(points) || 0);
  const matchSeconds = Math.max(0, Math.round(Number(durationSec) || 0));
  const status = won ? "win" : "lose";

  // merge this match's score/time onto whatever's already accumulated
  // against this exact opponent
  const opponentReports = readOpponentReports();
  const existing = opponentReports[opponentKey];
  const cumulativePoints = (existing?.points || 0) + matchScore;
  const cumulativeSeconds = (existing?.seconds || 0) + matchSeconds;
  const time = fmtTime(cumulativeSeconds);

  // 1) external game-server report — reuse the opponent's existing reportId
  // (sendReport PUTs/updates when one is present) so the row accumulates
  // instead of a new one being created every rematch
  let reportId = existing?.reportId || null;
  try {
    const resp = await sendReport({
      sessionId,
      organizationId,
      userId,
      role,
      token: u.token,
      gameId: u.gameId,
      name: playerName,
      points: cumulativePoints,
      time,
      ...(reportId ? { reportId } : {}),
    });
    reportId = extractReportIdFromResponse(resp) || reportId;
  } catch (err) {
    console.warn("[reportArmMatch] sendReport failed:", err);
  }
  if (!reportId) {
    reportId = `arm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  opponentReports[opponentKey] = {
    reportId,
    points: cumulativePoints,
    seconds: cumulativeSeconds,
  };
  writeOpponentReports(opponentReports);

  const grandTotal = computeGrandTotal(opponentReports);
  const result = {
    matchScore,
    matchSeconds,
    totalPoints: grandTotal.points,
    totalSeconds: grandTotal.seconds,
  };

  // 2) mirror the same cumulative totals onto our own stages row, keyed by
  // the same reportId so it updates in place rather than inserting a new
  // row per rematch
  const base = String(process.env.REACT_APP_BACKEND_URL || "").replace(/\/+$/, "");
  if (!base) return result;
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
        points: cumulativePoints,
        total_score: cumulativePoints,
        time,
        status,
        winnerId, // player's id (win), opponent's id (mp loss), or "AI" (solo loss)
        opponentId: opponentKey,
        opponentemail: opponentEmail || opponentKey,
        // full match identity also rides along in the opaque `current` array
        // -- this entry is THIS match's own score/time, not the cumulative
        // total, so the per-match history stays legible
        current: [
          {
            outcome: status,
            playerId,
            playerName,
            playerEmail,
            winnerId,
            winnerName,
            opponentId: opponentKey,
            opponentName: opponentName_,
            opponentEmail: opponentEmail || "",
            points: matchScore,
            time: fmtTime(matchSeconds),
            at: new Date().toISOString(),
          },
        ],
        answers: [],
      }),
    });
  } catch (err) {
    console.error("[reportArmMatch] addReport failed:", err);
  }
  return result;
}
