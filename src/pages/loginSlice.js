import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';
import { fetchThemeData } from '../admin/themeSlice';
import { setSession } from '../admin/sessionSlice';
import { setBackButtonUrl, setCompanyLogoUrl } from './uiSlice';
import { syncThemesIfCopySession } from '../functions/copySessionThemes';

/** Session-scoped user payload — `gameover` from DB indicates completed play (>0). */
const USER_DATA_KEY = 'userData';

const uuid4 = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

const isTrueQueryParam = (value) =>
  typeof value === "string" && value.trim().toLowerCase() === "true";

/** Reads `stages.gameover` via backend (Firebase login does not include it). */
async function fetchStageGameover({ sessionId, organizationId, userId }) {
  try {
    const backendBase = String(process.env.REACT_APP_BACKEND_URL || "").replace(
      /\/+$/,
      ""
    );
    if (!backendBase || !sessionId || !organizationId || !userId) return 0;
    const res = await fetch(`${backendBase}/fetchReport`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionId}&${organizationId}`,
      },
      body: JSON.stringify({ userId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.success || !data.report) return 0;
    const g = data.report.gameover;
    if (g == null || g === "") return 0;
    const n = Number(g);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export const loginUser = createAsyncThunk(
  'auth/loginUser',
  async (_, { dispatch, rejectWithValue }) => {
    try {
      const queryParams = new URLSearchParams(window.location.search);
      const save = queryParams.get('save');
      const demo = queryParams.get('demo');
      const fromMobileApp = isTrueQueryParam(queryParams.get('fromMobileApp'));

      if (save) {
        let stored = sessionStorage.getItem(USER_DATA_KEY);
        if (!stored) {
          const legacy = localStorage.getItem(USER_DATA_KEY);
          if (legacy) {
            sessionStorage.setItem(USER_DATA_KEY, legacy);
            localStorage.removeItem(USER_DATA_KEY);
            stored = legacy;
          }
        }
        if (!stored) return rejectWithValue('No saved user data found.');
        let userData = JSON.parse(stored);
        const persistedFromMobileApp = isTrueQueryParam(String(userData?.fromMobileApp ?? ""));
        const finalFromMobileApp = fromMobileApp || persistedFromMobileApp;
        if (finalFromMobileApp !== persistedFromMobileApp) {
          userData = { ...userData, fromMobileApp: finalFromMobileApp };
          sessionStorage.setItem(USER_DATA_KEY, JSON.stringify(userData));
        }
        dispatch(setSession({ sessionId: userData.sessionId, organizationId: userData.organizationId }));
        try {
          await syncThemesIfCopySession({
            sessionId: userData.sessionId,
            organizationId: userData.organizationId,
            isCopy: userData.isCopy,
            originalSessionId: userData.originalSessionId,
          });
        } catch (syncErr) {
          console.error('syncThemesIfCopySession (save):', syncErr);
        }
        dispatch(fetchThemeData({ themeId: null }));
        // Ensure header UI is populated on "save" login flow too.
        dispatch(setCompanyLogoUrl(userData.companyLogoUrl || process.env.REACT_APP_EM_LOGO || null));
        dispatch(setBackButtonUrl(userData.backButtonRedirect || null));
        const go = await fetchStageGameover({
          sessionId: userData.sessionId,
          organizationId: userData.organizationId,
          userId: userData.userId,
        });
        userData = { ...userData, gameover: go };
        sessionStorage.setItem(USER_DATA_KEY, JSON.stringify(userData));
        return userData;
      }

      let userResponseData;
      if (demo) {
        console.log("working with demo now");
        function generateRandomUser() {
          const randomString = 'demo' + Math.floor(Math.random() * 10000);
          return {
            data: {
              data: {
                id: Math.floor(Math.random() * 100000),
                email: `${randomString}@gmail.com`,
                userId: randomString,
                firstName: randomString,
                lastName: randomString,
                employeeId: `EM${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`,
                sessionId: 'demo'+Math.floor(Math.random() * 100000),
                organizationId: 'demo'+Math.floor(Math.random() * 100000),
                gameId: null,
                role:"demobypass",
                companyLogoUrl: process.env.REACT_APP_EM_LOGO,
                backButtonRedirect: process.env.REACT_APP_BASE_URL,
                gameover: 0,
                
              }
            }
          };
        }
        const response = generateRandomUser();
        userResponseData = response.data.data;
      } else {
        const otp = queryParams.get('otp');
        const role = queryParams.get('role');
        if (!otp) return rejectWithValue('OTP is required for login.');

        let apiUrl = process.env.REACT_APP_FIREBASE_LOGIN_API;
        const requestData = { otp };
        let source = 'ORG_USER';
        if (role === 'GUEST_USER') {
          apiUrl = process.env.REACT_APP_FIREBASE_GUEST_USER_API;
          requestData.role = 'GUEST_USER';
          source = 'GUEST_USER';
        }

        const clientSecret =
          process.env.REACT_APP_FIREBASE_CLIENT_SECRET ||
          process.env.REACT_APP_CLIENT_SECRET;
        const headers = {
          'client-secret': clientSecret,
          'Content-Type': 'application/json',
          'Idempotency-Key': uuid4(),
        };

        const response = await axios.post(apiUrl, requestData, { headers });
        if (response.data.message !== 'LOGIN SUCCESS') {
          return rejectWithValue('Login failed');
        }
        response.data.data["role"]=source;
        userResponseData = response.data.data;
      }

      // Store session; for duplicate sessions sync themes from original before fetch
      dispatch(setSession({ sessionId: userResponseData.sessionId, organizationId: userResponseData.organizationId }));
      try {
        await syncThemesIfCopySession({
          sessionId: userResponseData.sessionId,
          organizationId: userResponseData.organizationId,
          isCopy: userResponseData.isCopy,
          originalSessionId: userResponseData.originalSessionId,
        });
      } catch (syncErr) {
        console.error('syncThemesIfCopySession:', syncErr);
      }
      dispatch(fetchThemeData({ themeId: null }));

      // Build user data to persist
      const userData = {
        userId: userResponseData.userId || userResponseData.id,
        token: userResponseData.token || "",
        name: `${userResponseData.firstName} ${userResponseData.lastName}`.trim(),
        email: userResponseData.email || userResponseData.employeeId,
        sessionId: userResponseData.sessionId,
        organizationId: userResponseData.organizationId,
        gameId: userResponseData.gameId,
        source: demo ? 'DEMO' : 'ORG_USER',
        expiry: Date.now() + 24 * 60 * 60 * 1000,
        role:userResponseData.role,
        companyLogoUrl: process.env.REACT_APP_EM_LOGO,
        backButtonRedirect: process.env.REACT_APP_BASE_URL,
        gameover: 0,
        fromMobileApp,
        isCopy: !!userResponseData.isCopy,
        originalSessionId: userResponseData.originalSessionId || null,
        // multiplayer lobby code the player last created/joined (see
        // LobbyChooser.jsx) -- lets a fresh session silently rejoin it
        // instead of starting the lobby flow over, same as
        // noughts_and_crosses_react-master's loginSlice/lobby.jsx.
        lobby: userResponseData.lobby || null,
      };

      if (!demo) {
        userData.gameover = await fetchStageGameover({
          sessionId: userData.sessionId,
          organizationId: userData.organizationId,
          userId: userData.userId,
        });
      }

      // Fetch organization details if not demo
      if (!demo) {
        const orgRes = await axios.get(`${process.env.REACT_APP_ORG_API}/${userResponseData.organizationId}`);
         console.log(orgRes);
        if (orgRes.data?.message === 'ORGANIZATIONS_FETCHED_SUCCESSFULLY') {
          console.log(orgRes.data);
          console.log(orgRes.data?.organization.companyLogo);
          if(!orgRes.data?.organization?.companyLogo){
            userData.companyLogoUrl = process.env.REACT_APP_EM_LOGO;
          }else{
            const s3Source = process.env.REACT_APP_S3_SOURCE || "";
            const base = s3Source.endsWith("/") ? s3Source : `${s3Source}/`;
            userData.companyLogoUrl = `${base}${orgRes.data.organization.companyLogo}`;
          }
          userData.backButtonRedirect = `${process.env.REACT_APP_BASE_URL}/game-detail/${userResponseData.gameId}`;
          console.log("setcompany url",userData.companyLogoUrl);
        }
      }
      
      dispatch(setCompanyLogoUrl(userData.companyLogoUrl));
      dispatch(setBackButtonUrl(userData.backButtonRedirect || null));
      try {
        localStorage.removeItem(USER_DATA_KEY);
      } catch (_) {
        /* ignore */
      }
      sessionStorage.setItem(USER_DATA_KEY, JSON.stringify(userData));
      return userData;
    } catch (error) {
      if (error.response?.status === 401) {
        sessionStorage.removeItem(USER_DATA_KEY);
        try {
          localStorage.removeItem(USER_DATA_KEY);
        } catch (_) {
          /* ignore */
        }
      }
      const data = error.response?.data;
      const apiMsg =
        (typeof data?.message === 'string' && data.message) ||
        data?.err?.message;
      return rejectWithValue(apiMsg || error.message);
    }
  }
);
const authSlice = createSlice({
  name: 'auth',
  initialState: {
    user: null,
    status: 'idle',
    error: null
  },
  reducers: {
    logout: state => {
      state.user = null;
      sessionStorage.removeItem(USER_DATA_KEY);
      try {
        localStorage.removeItem(USER_DATA_KEY);
      } catch (_) {
        /* ignore */
      }
    }
  },
  extraReducers: builder => {
    builder
      .addCase(loginUser.pending, state => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(loginUser.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.user = action.payload;
      })
      .addCase(loginUser.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload;
        state.user = null;
      });
  }
});

export const { logout } = authSlice.actions;
export default authSlice.reducer;