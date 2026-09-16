import React, { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { fetchThemeData } from "../../admin/themeSlice";
import { selectAdminToken } from "../../admin/sessionSlice";
import { getDvSourceImageUrl, toCssUrlValue } from "../../functions/themeAssets";
import "./leaderboard.css";

function normalizeBoxColor(themeData) {
  const raw = String(themeData?.box_color ?? themeData?.boxcolor ?? "#334155").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-fA-F]{8}$/.test(raw)) return `#${raw.slice(1, 7)}`.toLowerCase();
  return "#334155";
}

function resolveBackdrop(themeData, preferMobileViewport) {
  if (!themeData) return "";
  const desk = themeData.background_desk ?? themeData.desktop_view_image;
  const mob = themeData.background_mob ?? themeData.mobile_view_image;
  const ds = desk != null ? String(desk).trim() : "";
  const ms = mob != null ? String(mob).trim() : "";
  if (preferMobileViewport && ms) return ms;
  if (!preferMobileViewport && ds) return ds;
  return ds || ms;
}

function pickPoints(r) {
  if (r.points != null && r.points !== "") return r.points;
  if (r.total_score != null && r.total_score !== "") return r.total_score;
  if (r.score != null && r.score !== "") return r.score;
  return "—";
}

/** Same semantics as GamePage `parseMmSsToSeconds` — `stages.time` is MM:SS elapsed. */
function parseMmSsToSeconds(t) {
  const m = /^(\d+):(\d{1,2})$/.exec(String(t ?? "0:00").trim());
  if (!m) return Number.POSITIVE_INFINITY;
  return Number(m[1]) * 60 + Number(m[2]);
}

function pointsForSort(row) {
  const p = row?.points;
  if (p === "—" || p == null || p === "") return 0;
  const n = Number(p);
  return Number.isFinite(n) ? n : 0;
}

/** Higher points first; ties broken by less elapsed time (MM:SS). */
function sortAndRankLeaderboardRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const out = rows.map((r) => ({ ...r }));
  out.sort((a, b) => {
    const pd = pointsForSort(b) - pointsForSort(a);
    if (pd !== 0) return pd;
    return parseMmSsToSeconds(a.time) - parseMmSsToSeconds(b.time);
  });
  return out.map((r, i) => ({ ...r, rank: i + 1 }));
}

function normalizeLeaderboardResponse(payload, currentUserId) {
  const uid = currentUserId != null && String(currentUserId).trim() !== "" ? String(currentUserId) : null;
  const isMeRow = (row) =>
    !!uid &&
    (String(row?.userId ?? row?.userid ?? row?.user_id ?? "") === uid ||
      row?.isMe === true);

  const cell = (v) => (v != null && String(v).trim() !== "" ? String(v) : "—");

  const rowFromApi = (r) => ({
    rank: r.rank,
    name: r.name != null && String(r.name).trim() !== "" ? String(r.name) : "—",
    opponent: cell(r.opponent ?? r.opponentemail ?? r.opponentId),
    winner: cell(r.winner),
    time: r.time ?? r.timestamp ?? "—",
    points: pickPoints(r),
    userId: r.userId ?? r.userid ?? r.user_id,
    isMe: isMeRow(r),
  });

  if (!payload) return { rows: [], me: null };
  if (payload.success === false) return { rows: [], me: null };

  const d = payload.data;
  if (d && typeof d === "object" && !Array.isArray(d)) {
    const source = Array.isArray(d.all)
      ? d.all
      : Array.isArray(d.top)
        ? d.top
        : [];
    const rows = source.map((r) => {
      const base = rowFromApi(r);
      return { ...base, isMe: base.isMe || r.isMe === true };
    });
    const me = d.me
      ? {
          rank: d.me.rank,
          name: d.me.name != null ? String(d.me.name) : "—",
          opponent: cell(d.me.opponent ?? d.me.opponentemail ?? d.me.opponentId),
          winner: cell(d.me.winner),
          time: d.me.time ?? d.me.timestamp ?? "—",
          points: d.me.points ?? d.me.total_score ?? d.me.score ?? "—",
          userId: d.me.userId ?? d.me.userid,
          isMe: true,
        }
      : null;
    return { rows, me };
  }

  if (Array.isArray(d)) {
    return {
      rows: d.map((r) => ({
        ...rowFromApi(r),
        isMe: isMeRow(r),
      })),
      me: null,
    };
  }

  return { rows: [], me: null };
}

const LB_TOP_N = 10;

/** Show top N rows; if current user is not in that slice, append their row as the (N+1)th row. */
function buildDisplayRows(allRows, meRow, currentUserId) {
  if (!Array.isArray(allRows) || allRows.length === 0) return [];
  const uid =
    currentUserId != null && String(currentUserId).trim() !== "" ? String(currentUserId).trim() : "";
  const topSlice = allRows.slice(0, LB_TOP_N);
  const rowUid = (r) => String(r?.userId ?? r?.userid ?? r?.user_id ?? "").trim();

  const meInTop = uid && topSlice.some((r) => rowUid(r) === uid || r.isMe);
  if (!uid || meInTop) return topSlice;

  const myRow = meRow ?? allRows.find((r) => rowUid(r) === uid);
  if (!myRow) return topSlice;

  return [...topSlice, { ...myRow, isMe: true }];
}

export default function Leaderboard() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const adminToken = useSelector(selectAdminToken);
  const { data: themeData } = useSelector((state) => state.theme);
  /** Keep user on leaderboard — browser Back would otherwise return to the game */
  const lbPathRef = useRef(
    typeof window !== "undefined"
      ? `${window.location.pathname}${window.location.search || ""}`
      : "/leaderboard"
  );

  const [rows, setRows] = useState([]);
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [narrowViewport, setNarrowViewport] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 768px)").matches : false
  );

  const storedUserData = useMemo(() => {
    try {
      return JSON.parse(sessionStorage.getItem("userData") || "{}") || {};
    } catch {
      return {};
    }
  }, []);

  const userId = storedUserData?.userId || storedUserData?.userid || storedUserData?.id || null;

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const sync = () => setNarrowViewport(mq.matches);
    if (mq.addEventListener) mq.addEventListener("change", sync);
    else mq.addListener(sync);
    sync();
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", sync);
      else mq.removeListener(sync);
    };
  }, []);

  useEffect(() => {
    dispatch(fetchThemeData({ themeId: null }));
  }, [dispatch]);

  /** Latest "my" score/time (seconds) — carried to /thankyou on browser Back. */
  const myStatsRef = useRef({ points: 0, time: 0 });

  useEffect(() => {
    const path = lbPathRef.current || "/leaderboard";
    window.history.pushState({ leaderboardExitLock: true }, "", path);
    const onPopState = () => {
      window.history.pushState({ leaderboardExitLock: true }, "", path);
      navigate("/thankyou", { replace: true, state: { ...myStatsRef.current } });
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [navigate]);

  /** coment */
  useEffect(() => {
    const body = document.body;
    const prev = {
      backgroundImage: body.style.backgroundImage,
      backgroundSize: body.style.backgroundSize,
      backgroundPosition: body.style.backgroundPosition,
      backgroundRepeat: body.style.backgroundRepeat,
      backgroundAttachment: body.style.backgroundAttachment,
      background: body.style.background,
    };
    const hadCommon = body.classList.contains("common-bg");
    body.classList.remove("common-bg");
    body.style.backgroundImage = "none";
    body.style.removeProperty("background-size");
    body.style.removeProperty("background-position");
    body.style.removeProperty("background-repeat");
    body.style.removeProperty("background-attachment");
    body.style.removeProperty("background");
    return () => {
      body.style.backgroundImage = prev.backgroundImage;
      body.style.backgroundSize = prev.backgroundSize;
      body.style.backgroundPosition = prev.backgroundPosition;
      body.style.backgroundRepeat = prev.backgroundRepeat;
      body.style.backgroundAttachment = prev.backgroundAttachment;
      if (prev.background) body.style.background = prev.background;
      else body.style.removeProperty("background");
      if (hadCommon) body.classList.add("common-bg");
    };
  }, []);

  useEffect(() => {
    if (!adminToken) {
      setRows([]);
      setMe(null);
      setError("Missing session. Open the app from your login link.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const url = `${String(process.env.REACT_APP_BACKEND_URL || "").replace(/\/+$/, "")}/getLeaderboard`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${adminToken}`,
          },
          body: JSON.stringify({
            userId: userId || undefined,
          }),
        });
        const raw = await res.text();
        let data = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          setError(res.ok ? "Invalid response from server." : `Server error (${res.status})`);
          return;
        }
        if (cancelled) return;
        if (!res.ok) {
          setError(data.message || data.error || `Request failed (${res.status})`);
          return;
        }
        if (data.success === false) {
          setError(data.message || data.error || "Failed to load leaderboard");
          return;
        }
        const { rows: r, me: m } = normalizeLeaderboardResponse(data, userId);
        setRows(r);
        setMe(m);
      } catch (e) {
        if (!cancelled) setError(e.message || "Failed to load leaderboard");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adminToken, userId]);

  const accent =
    themeData?.textcolor ??
    themeData?.text_color ??
    themeData?.landing_page_title_color ??
    "#ffffff";

  const boxColorSolid = useMemo(() => normalizeBoxColor(themeData), [themeData]);

  const bgRaw = resolveBackdrop(themeData, narrowViewport);
  const bgHref = bgRaw ? getDvSourceImageUrl(bgRaw) : "";

  const decorRaw =
    themeData?.leaderboard_decor_image ??
    themeData?.dreamcatchter_image ??
    themeData?.dreamcatcher_image ??
    "";
  const dcUrl = decorRaw ? getDvSourceImageUrl(String(decorRaw).trim()) : "";

  const rankedRows = useMemo(() => sortAndRankLeaderboardRows(rows), [rows]);
  const displayRows = useMemo(() => buildDisplayRows(rankedRows, me, userId), [rankedRows, me, userId]);

  useEffect(() => {
    const uid = userId != null ? String(userId).trim() : "";
    const rowUid = (r) => String(r?.userId ?? r?.userid ?? r?.user_id ?? "").trim();
    const mine =
      me ||
      (uid && rankedRows.find((r) => rowUid(r) === uid || r.isMe)) ||
      null;
    if (mine) {
      const pts = Number(mine.points);
      myStatsRef.current = {
        points: Number.isFinite(pts) ? pts : 0,
        time: parseMmSsToSeconds(mine.time) === Number.POSITIVE_INFINITY
          ? 0
          : parseMmSsToSeconds(mine.time),
      };
    }
  }, [rankedRows, me, userId]);

  return (
    <div
      className="lb-stage"
      style={{
        ...(bgHref ? { backgroundImage: toCssUrlValue(bgHref) } : {}),
        "--lb-accent": accent,
        "--lb-box": boxColorSolid,
      }}
    >
      <div className="lb-overlay">
        <img
          src="/img/leaderboard.png"
          alt="Leaderboard — Climb higher. Score bigger. Be the legend!"
          className="lb-banner"
        />

        <div className="lb-card-wrap">
          {dcUrl ? (
            <>
              <img className="lb-dc left" src={dcUrl} alt="" draggable={false} />
              <img className="lb-dc right" src={dcUrl} alt="" draggable={false} />
            </>
          ) : null}

          <div className="lb-card lb-card--panel">
            {dcUrl ? <img className="lb-dc center" src={dcUrl} alt="" draggable={false} /> : null}

            {loading ? (
              <div className="lb-state-msg">Loading…</div>
            ) : error ? (
              <div className="lb-state-msg">{error}</div>
            ) : (
              <>
                <div className="lb-row lb-row--head">
                  <span className="lb-col lb-col-rank">Rank</span>
                  <span className="lb-col lb-col-player">Player</span>
                  <span className="lb-col lb-col-opponent">Opponent</span>
                  <span className="lb-col lb-col-winner">Winner</span>
                  <span className="lb-col lb-col-time">Time</span>
                  <span className="lb-col lb-col-points">Points</span>
                </div>

                {displayRows.length === 0 ? (
                  <div className="lb-state-msg">No entries yet.</div>
                ) : (
                  <div className="lb-rows">
                    {displayRows.map((r) => {
                      const rankNum = Number(r.rank);
                      const rankTier =
                        rankNum === 1 ? "gold" : rankNum === 2 ? "silver" : rankNum === 3 ? "bronze" : "plain";
                      return (
                        <div
                          key={`rank-${r.rank}-${r.userId ?? r.name}-${r.time}-${r.isMe ? "me" : "row"}`}
                          className={`lb-row lb-row--entry lb-row--${rankTier}${r?.isMe ? " lb-me" : ""}`}
                        >
                          <span className="lb-col lb-col-rank">
                            <span className={`lb-badge lb-badge--${rankTier}`}>
                              {rankTier === "gold" && (
                                <span className="lb-badge__crown" aria-hidden="true">
                                  👑
                                </span>
                              )}
                              <span className="lb-badge__num">
                                {r.rank != null && r.rank !== "" ? r.rank : "—"}
                              </span>
                            </span>
                          </span>
                          <span className="lb-col lb-col-player">
                            <span className="lb-player-info">
                              <span className="lb-player-name">{r.name}</span>
                            </span>
                          </span>
                          <span className="lb-col lb-col-opponent">
                            <span className="lb-opponent-val">{r.opponent}</span>
                          </span>
                          <span className="lb-col lb-col-winner">
                            <span className="lb-winner-val">{r.winner}</span>
                          </span>
                          <span className="lb-col lb-col-time">
                            <span className="lb-time-val">⏱ {r.time && r.time !== "—" ? r.time : "—"}</span>
                          </span>
                          <span className="lb-col lb-col-points">
                            <span className={`lb-coin lb-coin--${rankTier}`} aria-hidden="true">
                              ★
                            </span>
                            <span className="lb-points-val">{r.points}</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
