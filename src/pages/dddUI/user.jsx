import React,{ useEffect, useRef, useState } from "react";
import "./user.css";
import { useDispatch, useSelector } from 'react-redux';
import { fetchThemeData } from '../../admin/themeSlice';
import { useLocation, useNavigate } from "react-router-dom";

function USER({children }) {
  const dispatch = useDispatch();
    const location = useLocation();
    const navigate = useNavigate();
    const headerRef = useRef(null);

    const {companyLogoUrl,backButtonUrl} = useSelector(state => state.ui);
    const [logoUrl,setLogoUrl]=useState("");
    const [backUrl,setBackUrl]=useState("");

    const { user } = useSelector(state => state.auth);
    const { status: themeStatus, data: themeData } = useSelector(state => state.theme);
    const fromMobileAppInUrl =
      String(new URLSearchParams(location.search).get("fromMobileApp") || "").toLowerCase() ===
      "true";
    const fromMobileAppInUser = String(user?.fromMobileApp || "").toLowerCase() === "true";
    const persistedFromMobileApp = (() => {
      try {
        const persisted = JSON.parse(
          sessionStorage.getItem("userData") || "{}"
        );
        return String(persisted?.fromMobileApp || "").toLowerCase() === "true";
      } catch {
        return false;
      }
    })();
    const isFromMobileApp = fromMobileAppInUrl || fromMobileAppInUser || persistedFromMobileApp;
  const isLeaderboardRoute = /^\/leaderboard\/?$/.test(location.pathname);
  const leaderboardBackHref = String(process.env.REACT_APP_BASE_URL || "").replace(/\/+$/, "") || "/";

  const applyCustomTheme = (theme) => {
  if (!theme) return;

  document.documentElement.style.setProperty('--text-color', theme.text_color);
  document.documentElement.style.setProperty('--ui-color-1', theme.ui_color_1);
  document.documentElement.style.setProperty('--ui-color-2', theme.ui_color_2);
  document.documentElement.style.setProperty('--option-color', theme.option_color);
  document.documentElement.style.setProperty('--option-text-color', theme.option_text_color);
};
    
  useEffect(() => {
      if (!/^\/login(?:\/)?$/.test(location.pathname)) {
        if (themeStatus === "idle") {
          dispatch(fetchThemeData({ themeId: null }));
        }
      }
  }, [themeStatus, dispatch, location.pathname]);

  useEffect(()=>{
    setBackUrl(backButtonUrl);
    setLogoUrl(companyLogoUrl);
  },[backButtonUrl,companyLogoUrl])

  // Publish the header's real rendered height as a CSS variable so full-viewport
  // pages (e.g. the climb game) can offset below it instead of sliding underneath.
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return undefined;
    const applyHeight = () => {
      document.documentElement.style.setProperty("--pf-header-h", `${header.offsetHeight}px`);
    };
    applyHeight();
    const observer = new ResizeObserver(applyHeight);
    observer.observe(header);
    return () => observer.disconnect();
  }, [logoUrl, backUrl]);


  useEffect(() => {
    if (themeStatus !== "succeeded" || !themeData) return;

    applyCustomTheme(themeData.colors);

    const isWelcomeGame =
      /^\/welcome\/?$/.test(location.pathname) || /^\/fullhouse\/?$/.test(location.pathname);
    const isGameRoute = /^\/game\/?$/.test(location.pathname);
    /** Leaderboard paints its own full-viewport bg (`lb-stage`); avoid body + page double layers */
    const isLeaderboardRoute = /^\/leaderboard\/?$/.test(location.pathname);
    if (isWelcomeGame || isGameRoute || isLeaderboardRoute) return;

    const applyBodyBackground = () => {
      const body = document.body;
      const bg = window.innerWidth <= 768 ? themeData.background_mob : themeData.background_desk;
      const bgUrl = bg ? encodeURI(process.env.REACT_APP_S3_PATH + bg) : null;
      if (bgUrl) {
        body.style.backgroundImage = `url("${bgUrl}")`;
        body.style.backgroundSize = "100% 100%";
        body.style.backgroundRepeat = "no-repeat";
        body.style.backgroundAttachment = "fixed";
      } else {
        body.style.removeProperty("background-image");
      }
    };

    applyBodyBackground();
    window.addEventListener("resize", applyBodyBackground);
    window.addEventListener("orientationchange", applyBodyBackground);
    return () => {
      window.removeEventListener("resize", applyBodyBackground);
      window.removeEventListener("orientationchange", applyBodyBackground);
    };
  }, [themeStatus, themeData, location.pathname]);

  const handleLogoClick = (e) => {
    if (!isFromMobileApp) return;
    e.preventDefault();
    window.GameStatus?.postMessage?.("navigate_back");
  };

  // Back always returns to whatever page the player actually came from.
  // Falls back to the redux-provided backUrl only when there's no in-app
  // history to go back to (e.g. the page was opened directly).
  const handleBackClick = (e) => {
    if (isLeaderboardRoute) return; // anchor's own href handles this case
    e.preventDefault();
    if (window.history.length > 2) {
      navigate(-1);
    } else if (backUrl) {
      window.location.href = backUrl;
    } else {
      navigate("/");
    }
  };

  return (
    <>
      <header className="upperaction" ref={headerRef}>
      <a href={process.env.REACT_APP_BASE_URL} onClick={handleLogoClick}><img src={logoUrl} className="logo-holder" /></a>
        {!isFromMobileApp && (
          <div className="back-holder">
            <a href={isLeaderboardRoute ? leaderboardBackHref : backUrl} onClick={handleBackClick}>
              <button
                type="button"
                className="back-default"
              >
                Back
              </button>
            </a>
          </div>
        )}

      </header>
      {children}
    </>
  );
}

export default USER;
