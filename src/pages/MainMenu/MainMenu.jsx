import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from "react-router-dom";
import CinematicIntro from "../../components/CinematicIntro";
import "../arena.css";
import { setBackButtonUrl } from '../uiSlice';
import { useThemeColors } from '../../functions/useThemeColors';

const INTRO_SEEN_KEY = "aoa_seen_landing_intro";

export default function MainMenu() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { status, user } = useSelector((state) => state.auth);
  const { textStyle, buttonStyle } = useThemeColors();
  const [showIntro, setShowIntro] = useState(() => !sessionStorage.getItem(INTRO_SEEN_KEY));

  const dismissIntro = () => {
    sessionStorage.setItem(INTRO_SEEN_KEY, "1");
    setShowIntro(false);
  };
  useEffect(() => {
    dispatch(setBackButtonUrl("/login?&save=true"));
  }, [status, user]);

  if (showIntro) {
    return (
      <CinematicIntro
        eyebrow="Welcome to"
        title="Arena of Arms"
        subtitle="Tap. Push. Overpower."
        accentColor="#ff4d4d"
        autoAdvanceMs={3200}
        onDone={dismissIntro}
      />
    );
  }

  return (
    <div className="aoa-root" style={textStyle}>
      <div className="aoa-title">Arena of Arms</div>
      <div className="aoa-subtitle">Tap. Push. Overpower. Win the arm wrestle.</div>

      <div className="aoa-menu-actions">
        <button className="aoa-btn aoa-btn-primary" style={buttonStyle} onClick={() => navigate("/arena/solo")}>
          🥊 Play Solo
        </button>
        <button className="aoa-btn aoa-btn-secondary" style={buttonStyle} onClick={() => navigate("/arena/lobby")}>
          🌐 Play Multiplayer
        </button>
      </div>
    </div>
  );
}
