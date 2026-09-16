import { createSlice } from '@reduxjs/toolkit';

const SESSION_KEY = 'session';

// Load just the adminToken from localStorage, then split it back out.
const getStoredSession = () => {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) {
    return { adminToken: null, sessionId: null, organizationId: null };
  }
  const adminToken = raw;
  const [sessionId, organizationId] = adminToken.split('&');
  return { adminToken, sessionId, organizationId };
};

const initialState = getStoredSession();

const sessionSlice = createSlice({
  name: 'session',
  initialState,
  reducers: {
    setSession: (state, { payload }) => {
      const { sessionId, organizationId } = payload;
      const adminToken = `${sessionId}&${organizationId}`;
      // update Redux state
      state.adminToken = adminToken;
      state.sessionId = sessionId;
      state.organizationId = organizationId;
      // persist only the token
      localStorage.setItem(SESSION_KEY, adminToken);
    },
    clearSession: (state) => {
      state.adminToken = null;
      state.sessionId = null;
      state.organizationId = null;
      localStorage.removeItem(SESSION_KEY);
    },
  },
});

export const { setSession, clearSession } = sessionSlice.actions;
export default sessionSlice.reducer;

// Selectors for use with useSelector(...)
export const selectAdminToken = (state) => state.session.adminToken;
export const selectSessionId = (state) => state.session.sessionId;
export const selectOrganizationId = (state) => state.session.organizationId;

// Convenience utilities (bypass Redux if you just need the token)
export const getAdminToken = () => getStoredSession().adminToken;
export const isLoggedIn = () => Boolean(getStoredSession().adminToken);
