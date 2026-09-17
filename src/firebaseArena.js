// Firebase setup for Arena of Arms multiplayer (Realtime Database)
import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  onValue,
  off,
  runTransaction,
  onDisconnect,
  serverTimestamp,
  remove,
} from "firebase/database";

// Firebase web-SDK config for the "arenaofarms-2123f" project. These values
// are NOT secret -- the web config is meant to ship in client code and
// access is gated by Realtime Database security rules. Env vars
// (REACT_APP_FIREBASE_*, see .env) override the defaults when present, but
// the hard-coded fallbacks keep the arena working if the .env isn't loaded.
const firebaseConfig = {
  apiKey:
    process.env.REACT_APP_FIREBASE_API_KEY ||
    "AIzaSyCXGuFPbgZVvvxceAaLm2XS5rSN0W3CERQ",
  authDomain:
    process.env.REACT_APP_FIREBASE_AUTH_DOMAIN ||
    "arenaofarms-2123f.firebaseapp.com",
  databaseURL:
    process.env.REACT_APP_FIREBASE_DATABASE_URL ||
    "https://arenaofarms-2123f-default-rtdb.firebaseio.com",
  projectId:
    process.env.REACT_APP_FIREBASE_PROJECT_ID || "arenaofarms-2123f",
  storageBucket:
    process.env.REACT_APP_FIREBASE_STORAGE_BUCKET ||
    "arenaofarms-2123f.firebasestorage.app",
  messagingSenderId:
    process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || "324242096543",
  appId:
    process.env.REACT_APP_FIREBASE_APP_ID ||
    "1:324242096543:web:fce9771812f7dab1217daa",
  measurementId:
    process.env.REACT_APP_FIREBASE_MEASUREMENT_ID || "G-JK5R3JJPCF",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getDatabase(app);

// No Firebase Auth here on purpose -- the app has its own login system
// (userData in session/local storage) and talks to the Realtime Database
// unauthenticated. Access is controlled entirely by the project's Database
// Rules (Firebase console -> Realtime Database -> Rules), which must allow
// open read/write, e.g.:
//   { "rules": { ".read": true, ".write": true } }
// If lobby creation ever starts throwing PERMISSION_DENIED again, that's a
// rules issue on the Firebase console, not something to fix here -- check
// the rules haven't reverted to requiring auth (or expired out of test mode).

/**
 * Player identity used as the key under `<sessionId>/lobbies/<code>/players/`.
 * Prefers the logged-in userId (stable across devices/refreshes and matches
 * the report rows); falls back to a random, browser-persisted id only when
 * there's no session (e.g. /arena opened directly).
 */
export function getLocalPlayerId() {
  try {
    const raw =
      sessionStorage.getItem("userData") ||
      localStorage.getItem("userData") ||
      "{}";
    const u = JSON.parse(raw) || {};
    const userId = u.userId || u.userid || u.id || "";
    if (userId) return String(userId);
  } catch {
    /* ignore — fall through to the local id */
  }
  let id = localStorage.getItem("aoa_playerId");
  if (!id) {
    id = "p_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem("aoa_playerId", id);
  }
  return id;
}

export function getLocalPlayerName() {
  return localStorage.getItem("aoa_playerName") || "";
}

/** The full logged-in player payload (userData) from session/local storage. */
export function getSessionUserData() {
  try {
    const raw =
      sessionStorage.getItem("userData") ||
      localStorage.getItem("userData") ||
      "{}";
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

/**
 * Everything about the player we want mirrored onto their lobby node
 * (`<sessionId>/lobbies/<code>/players/<playerId>/profile`) — name, email, ids, role, etc.
 * Firebase rejects `undefined`, so every field is coerced to a real value and
 * empty ones are dropped.
 */
export function buildPlayerProfile(overrideName) {
  const u = getSessionUserData();
  const raw = {
    name:
      overrideName ||
      (typeof u.name === "string" ? u.name.trim() : "") ||
      getLocalPlayerName() ||
      "Player",
    email: u.email || "",
    employeeId: u.employeeId || "",
    userId: u.userId || u.userid || u.id || "",
    sessionId: u.sessionId || "",
    organizationId: u.organizationId || "",
    gameId: u.gameId || "",
    role: u.role || u.source || "",
    phone: u.phone || u.mobile || "",
    department: u.department || "",
    designation: u.designation || "",
  };
  return Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== "" && v != null)
  );
}

export function setLocalPlayerName(name) {
  localStorage.setItem("aoa_playerName", name);
}

/**
 * Session scope every lobby is nested under (`<sessionId>/lobbies/<code>`
 * instead of a flat top-level `lobbies/<code>`), so lobbies from different
 * sessions/organizations never collide. Falls back to "admin" the same way
 * the rest of the app does when there's no logged-in session.
 */
export function getSessionId() {
  const u = getSessionUserData();
  return String(u.sessionId || "").trim() || "admin";
}

function lobbiesPath(sessionId = getSessionId()) {
  return `${sessionId}/lobbies`;
}

/** Generate a unique-ish 6-digit lobby code, retrying if it's already taken. */
export async function generateLobbyCode() {
  const base = lobbiesPath();
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const snap = await get(ref(db, `${base}/${code}`));
    if (!snap.exists()) return code;
  }
  // extremely unlikely fallback
  return String(Date.now()).slice(-6);
}

const WIN_LIMIT = 100;

export async function createLobby({ playerId, playerName }) {
  const code = await generateLobbyCode();
  const lobbyRef = ref(db, `${lobbiesPath()}/${code}`);
  const profile = buildPlayerProfile(playerName);
  await set(lobbyRef, {
    code,
    status: "waiting", // waiting -> active -> finished
    createdAt: serverTimestamp(),
    winLimit: WIN_LIMIT,
    players: {
      [playerId]: {
        name: profile.name || playerName || "Player 1",
        profile,
        score: 0,
        joinedAt: serverTimestamp(),
        host: true,
        connected: true,
      },
    },
  });
  onDisconnect(ref(db, `${lobbiesPath()}/${code}/players/${playerId}/connected`)).set(false);
  return code;
}

export async function joinLobby({ code, playerId, playerName }) {
  const lobbyRef = ref(db, `${lobbiesPath()}/${code}`);
  const snap = await get(lobbyRef);
  if (!snap.exists()) throw new Error("Lobby not found. Check the code and try again.");
  const lobby = snap.val();
  const players = lobby.players || {};
  const ids = Object.keys(players);

  const profile = buildPlayerProfile(playerName);

  if (players[playerId]) {
    // rejoining same lobby (e.g. refresh)
    await update(ref(db, `${lobbiesPath()}/${code}/players/${playerId}`), {
      connected: true,
      name: profile.name || playerName || players[playerId].name,
      profile,
    });
    return code;
  }

  if (ids.length >= 2) throw new Error("This lobby is already full.");

  await update(ref(db, `${lobbiesPath()}/${code}/players/${playerId}`), {
    name: profile.name || playerName || "Player 2",
    profile,
    score: 0,
    joinedAt: serverTimestamp(),
    host: false,
    connected: true,
  });

  if (ids.length === 1) {
    await update(lobbyRef, { status: "active", battleStartAt: serverTimestamp() });
  }

  onDisconnect(ref(db, `${lobbiesPath()}/${code}/players/${playerId}/connected`)).set(false);
  return code;
}

/**
 * Whether a previously-joined lobby (persisted on userData.lobby, mirroring
 * noughts_and_crosses_react-master's lobby.jsx re-entry check) can still be
 * auto-rejoined: it must exist, not be finished, and either already have
 * this player or still have a free seat.
 */
export async function checkLobbyRejoinable(code, playerId) {
  if (!code || !playerId) return false;
  try {
    const snap = await get(ref(db, `${lobbiesPath()}/${code}`));
    if (!snap.exists()) return false;
    const lobby = snap.val();
    if (String(lobby.status ?? "").trim().toLowerCase() === "finished") return false;
    const players = lobby.players || {};
    if (players[playerId]) return true;
    return Object.keys(players).length < 2;
  } catch {
    return false;
  }
}

export function listenLobby(code, callback) {
  const lobbyRef = ref(db, `${lobbiesPath()}/${code}`);
  const handler = (snap) => callback(snap.val());
  onValue(lobbyRef, handler);
  return () => off(lobbyRef, "value", handler);
}

/** Every tap = +3 power, applied via transaction so rapid taps never clobber each other. */
export function tapLobby(code, playerId) {
  const scoreRef = ref(db, `${lobbiesPath()}/${code}/players/${playerId}/score`);
  runTransaction(scoreRef, (current) => (current || 0) + 3);
}

export async function setLobbyStatus(code, status, extra = {}) {
  await update(ref(db, `${lobbiesPath()}/${code}`), { status, ...extra });
}

/** Quick rematch: reset both players' scores in the same lobby. */
export async function rematchLobby(code) {
  const lobbyRef = ref(db, `${lobbiesPath()}/${code}`);
  const snap = await get(lobbyRef);
  if (!snap.exists()) return;
  const players = snap.val().players || {};
  const updates = { status: "active", battleStartAt: serverTimestamp(), winner: null };
  Object.keys(players).forEach((id) => {
    updates[`players/${id}/score`] = 0;
  });
  await update(lobbyRef, updates);
}

/**
 * "Play Again" flag from the /thankyou page (post-match, after Battle.jsx has
 * already unmounted) — one player flips their own flag; once BOTH players in
 * the lobby have it set, either client's listener fires the actual rematch
 * (rematchLobby + clearRematchReady) and both navigate back into the battle.
 */
export async function setPlayerRematchReady(code, playerId, ready) {
  await update(ref(db, `${lobbiesPath()}/${code}/players/${playerId}`), {
    rematchReady: !!ready,
  });
}

/** Resets every player's rematchReady flag once a rematch has actually kicked off. */
export async function clearRematchReady(code) {
  const lobbyRef = ref(db, `${lobbiesPath()}/${code}`);
  const snap = await get(lobbyRef);
  if (!snap.exists()) return;
  const players = snap.val().players || {};
  const updates = {};
  Object.keys(players).forEach((id) => {
    updates[`players/${id}/rematchReady`] = false;
  });
  if (Object.keys(updates).length) await update(lobbyRef, updates);
}

export async function leaveLobby(code, playerId) {
  try {
    await remove(ref(db, `${lobbiesPath()}/${code}/players/${playerId}`));
  } catch (e) {
    // ignore
  }
}

export { WIN_LIMIT };
