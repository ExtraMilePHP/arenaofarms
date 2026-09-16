// index.js or main file
import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import reportWebVitals from './reportWebVitals';
import { BrowserRouter, Route, Routes, useLocation, Navigate } from 'react-router-dom';
import Login from './pages/login/login';
import AdminRedirect from './adminRedirect/admin';
import Admin from './admin/admin';
import Home from './admin/pages/home/home';
import Rules from './admin/pages/rules/rules';
import UserRules from './pages/rules/rules';
import { Provider } from 'react-redux';
import { store } from './admin/store';
import LoginPage from './admin/pages/login/login';
import ThankYou from './pages/thankyou/thankyou';
import Leaderboard from './pages/leaderboard/Leaderboard';
import USER from './pages/dddUI/user';
import MainAme from './pages/maingame/maingame';
import CopySession from './pages/copySession/copySession';
import MainMenu from './pages/MainMenu/MainMenu';
import SoloSelect from './pages/SoloSelect/SoloSelect';
import LobbyChooser from './pages/MultiplayerLobby/LobbyChooser';
import LobbyRoom from './pages/MultiplayerLobby/LobbyRoom';
import Battle from './pages/Battle/Battle';
import ArmRigDebug from './pages/Battle/ArmRigDebug';

function usePageBackground() {
  const location = useLocation();
  useEffect(() => {
    const body = document.body;
    const path = location.pathname;
    /** Routes that set their own full-viewport theme image — skip index.css `common-bg` (img/background.jpg) to avoid double layers */
    const ownBackdrop =
      /^\/game\/?$/i.test(path) ||
      /^\/leaderboard\/?$/i.test(path) ||
      /^\/maingame\/?$/i.test(path) ||
      /^\/arena(\/|$)/i.test(path);
    if (path.startsWith("/admin")) {
      body.classList.remove("common-bg");
    } else if (ownBackdrop) {
      body.classList.remove("common-bg");
    } else {
      body.classList.add("common-bg");
    }
  }, [location]);
}

function App() {
  usePageBackground();

  return (
    <Provider store={store}>
      <Routes>
        {/* Explicit paths (most specific first) so /admin always = theme admin, never the superadmin login */}
        <Route path="/admin/superadmin" element={<LoginPage />} />
        <Route path="/admin/rules" element={<Admin><Rules /></Admin>} />
        <Route path="/admin" element={<Admin><Home /></Admin>} />

        {/* Arena of Arms — self-contained tap-battle game, own full-screen layout.
            Routes inlined directly here (instead of a separate ArenaRoutes.jsx)
            so the whole /arena/* route table is visible in this file. */}
        <Route path="/arena/*" element={
          <USER>
            <Routes>
              <Route index element={<MainMenu />} />
              {/* TEMPORARY rig-verification tool — remove with ArmRigDebug.jsx */}
              <Route path="armdebug" element={<ArmRigDebug />} />
              <Route path="solo" element={<SoloSelect />} />
              <Route path="lobby" element={<LobbyChooser />} />
              <Route path="lobby/:code" element={<LobbyRoom />} />
              <Route path="battle/solo/:characterId" element={<Battle mode="solo" />} />
              <Route path="battle/multiplayer/:code" element={<Battle mode="multiplayer" />} />
            </Routes>
          </USER>
        } />

        <Route path="*" element={
          <USER>
            <Routes>
              <Route index element={<Login />} />
              <Route path="/login" element={<Login />} />
              <Route path="/rules" element={<UserRules />} />
              <Route path="/welcome" element={<Navigate to="/game" replace />} />
              <Route path="/maingame" element={<MainAme />} />
              <Route path="/sortandtoss" element={<Navigate to="/welcome" replace />} />
              <Route path="/leaderboard" element={<Leaderboard />} />
              <Route path="/AdminRedirect" element={<AdminRedirect />} />
              <Route path="/CopySession" element={<CopySession />} />
              <Route path="/thankyou" element={<ThankYou />} />
            </Routes>
          </USER>
        } />
      </Routes>
    </Provider>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);

reportWebVitals();
