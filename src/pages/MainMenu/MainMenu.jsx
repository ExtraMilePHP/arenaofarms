import React, { useEffect, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from "react-router-dom";
import "../arena.css";
import { setBackButtonUrl } from '../uiSlice';
import { useThemeColors } from '../../functions/useThemeColors';
import { getDvSourceImageUrl } from '../../functions/themeAssets';

export default function MainMenu() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { status, user } = useSelector((state) => state.auth);
  const { data: themeData } = useSelector((state) => state.theme);
  const { textStyle, buttonStyle } = useThemeColors();
  const logoUrl = useMemo(
    () => (themeData?.logo ? getDvSourceImageUrl(themeData.logo) : null),
    [themeData]
  );
  const soloEnabled = themeData?.solo_enabled !== false;
  const multiplayerEnabled = themeData?.multiplayer_enabled !== false;
  useEffect(() => {
    dispatch(setBackButtonUrl("/login?&save=true"));
  }, [status, user]);

  return (
    <div className="aoa-root aoa-root-menu" style={textStyle}>
      {logoUrl && <img src={logoUrl} alt="" className="aoa-menu-logo" />}
      <div className="aoa-menu-actions aoa-menu-actions-row">
        {soloEnabled && (
          <button className="aoa-btn aoa-btn-ghost aoa-btn-lg" style={buttonStyle} onClick={() => navigate("/arena/solo")}>
            <i className="fa-solid fa-user" /> Play Solo
          </button>
        )}
        {multiplayerEnabled && (
          <button className="aoa-btn aoa-btn-primary-fill aoa-btn-lg" style={buttonStyle} onClick={() => navigate("/arena/lobby")}>
            <i className="fa-solid fa-users" /> Multiplayer
          </button>
        )}
      </div>
    </div>
  );
}
