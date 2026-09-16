import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from "react-router-dom";
import CinematicIntro from "../../components/CinematicIntro";
import "../arena.css";
import { setBackButtonUrl } from '../uiSlice';
import { useThemeColors } from '../../functions/useThemeColors';
import { getDvSourceImageUrl } from '../../functions/themeAssets';

const INTRO_SEEN_KEY = "aoa_seen_landing_intro";

export default function MainMenu() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { status, user } = useSelector((state) => state.auth);
  const { data: themeData } = useSelector((state) => state.theme);
  const { textStyle, buttonColor, buttonTextColor, buttonShadowColor } = useThemeColors();
  const themedBtnStyle = {
    ...(buttonColor ? { "--btn-bg": buttonColor } : null),
    ...(buttonTextColor ? { "--btn-color": buttonTextColor } : null),
    ...(buttonShadowColor
      ? { "--btn-shadow": `0 8px 0 ${buttonShadowColor}` }
      : null),
  };
  const logoUrl = useMemo(
    () => (themeData?.logo ? getDvSourceImageUrl(themeData.logo) : null),
    [themeData]
  );
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
    <div className="aoa-root aoa-root-menu" style={textStyle}>
      {logoUrl && <img src={logoUrl} alt="" className="aoa-menu-logo" />}
      <div className="aoa-menu-actions aoa-menu-actions-row">
        <button className="aoa-btn aoa-btn-ghost aoa-btn-lg" style={themedBtnStyle} onClick={() => navigate("/arena/solo")}>
          <i className="fa-solid fa-user" /> Play Solo
        </button>
        <button className="aoa-btn aoa-btn-primary-fill aoa-btn-lg" style={themedBtnStyle} onClick={() => navigate("/arena/lobby")}>
          <i className="fa-solid fa-users" /> Multiplayer
        </button>
      </div>
    </div>
  );
}
