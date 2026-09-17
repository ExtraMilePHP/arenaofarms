import React, { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import CHARACTERS from "../../data/characters";
import "../arena.css";
import { setBackButtonUrl } from '../uiSlice';
import { useThemeColors } from '../../functions/useThemeColors';
/**
 * One opponent-select card. Tracks the pointer to drive a live perspective
 * tilt (rotateX/rotateY) plus a sheen that follows the cursor, on top of a
 * chunky extruded "3D button" base look. Entrance animation lives on the
 * wrapping <li> instead of the card itself so it doesn't fight the
 * pointer-driven transform (a CSS animation with fill:forwards would
 * otherwise permanently pin the card's `transform` to its last keyframe).
 */
function OpponentCard({ c, index, onSelect, themeColors }) {
  const ref = useRef(null);
  const { buttonTextColor } = themeColors || {};
  const themedCardStyle = {
    ...(buttonTextColor ? { color: buttonTextColor } : null),
  };

  const handleMove = (e) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width; // 0..1
    const y = (e.clientY - rect.top) / rect.height; // 0..1
    const rotateY = (x - 0.5) * 16; // left/right tilt
    const rotateX = (0.5 - y) * 12; // up/down tilt
    el.style.setProperty("--rx", `${rotateX}deg`);
    el.style.setProperty("--ry", `${rotateY}deg`);
    el.style.setProperty("--mx", `${x * 100}%`);
    el.style.setProperty("--my", `${y * 100}%`);
  };

  const handleLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--rx", `0deg`);
    el.style.setProperty("--ry", `0deg`);
  };

  return (
    <li className="aoa-char-card-wrap" style={{ animationDelay: `${index * 100}ms` }}>
      <button
        ref={ref}
        className="aoa-char-card aoa-char-card-3d"
        style={{ "--accent": c.color, ...themedCardStyle }}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        onClick={onSelect}
      >

        <span className="aoa-char-info">
          <div className="aoa-char-name">{c.name}</div>
          <div className="aoa-char-fighter" style={buttonTextColor ? { color: buttonTextColor } : undefined}>{c.fighter}</div>
          <div
            className="aoa-char-fighter"
            style={{ opacity: 0.75, ...(buttonTextColor ? { color: buttonTextColor } : null) }}
          >
            {c.tagline}
          </div>
        </span>
        <span className="aoa-char-diff">{c.difficulty}</span>
      </button>
    </li>
  );
}

export default function SoloSelect() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { status, user } = useSelector((state) => state.auth);
  const themeColors = useThemeColors();
  const { textStyle } = themeColors;

  useEffect(() => {
    dispatch(setBackButtonUrl("/arena"));
  }, [status, user]);

  return (
    <div className="aoa-root aoa-select-root" style={textStyle}>
      <div className="aoa-select-glow aoa-select-glow-a" />
      <div className="aoa-select-glow aoa-select-glow-b" />
      <div className="aoa-select-floor" />

      <div className="aoa-title" style={{ fontSize: "clamp(1.6rem, 5vw, 2.4rem)" }}>Choose Your Opponent</div>
      <div className="aoa-subtitle">Pick a difficulty and start the arm wrestle.</div>

      <ul className="aoa-char-list aoa-char-list-3d">
        {CHARACTERS.map((c, i) => (
          <OpponentCard
            key={c.id}
            c={c}
            index={i}
            themeColors={themeColors}
            onSelect={() => navigate(`/arena/battle/solo/${c.id}`)}
          />
        ))}
      </ul>
    </div>
  );
}
