import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { fetchThemeData } from "../../admin/themeSlice";
import { useThemeColors } from "../../functions/useThemeColors";
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
  const { points, time } = location.state || {};

  useEffect(() => {
    dispatch(fetchThemeData({ themeId: null }));
  }, [dispatch]);

  const accent =
    themeData?.textcolor ??
    themeData?.text_color ??
    themeData?.landing_page_title_color ??
    "#ffffff";

  // Reached directly (no score/time carried over) — nothing to show here.
  if (points == null && time == null) {
    return <Navigate to="/leaderboard" replace />;
  }

  return (
    <div className="lb-stage ty-stage" style={{ "--lb-accent": accent }}>
      <div className="lb-overlay">
        <img
          src="/img/ty.png"
          alt="Thank You For Playing!"
          className="ty-badge"
        />

        <div className="ty-content">
          <div className="ty-stats">
            <div className="ty-stat">
              <span className="ty-stat__icon" aria-hidden="true">
                ⭐
              </span>
              <span className="ty-stat__label">Your Score</span>
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
          <button
            type="button"
            className="lb-thankyou-btn ty-btn"
            style={buttonStyle}
            onClick={() => navigate("/leaderboard")}
          >
            View Leaderboard
          </button>
        </div>
      </div>
    </div>
  );
}
