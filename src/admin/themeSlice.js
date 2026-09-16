import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { selectAdminToken } from './sessionSlice';

// Async thunk unchanged
export const fetchThemeData = createAsyncThunk(
  'api/fetchThemeData',
  async (
    { themeId = null, isAdmin = false },
    { getState, rejectWithValue }
  ) => {
    try {
      const state = getState();
      const adminToken = selectAdminToken(state);

      const response = await fetch(
        `${process.env.REACT_APP_BACKEND_URL}/fetchThemeData`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
          },
          body: JSON.stringify({
            currentTheme: themeId,
          }),
        }
      );


      if (!response.ok) throw new Error('Network response was not ok');
      return await response.json();
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

// Attempt to load a persisted themeName from localStorage
const persistedTheme = localStorage.getItem('currentTheme');

const themeSlice = createSlice({
  name: 'theme',
  initialState: {
    currentTheme: persistedTheme || null,
    availableThemes: [],
    status: 'idle',
    error: null,
    data: null,
    /** Ignore fulfilled/rejected from older requests when a newer fetchThemeData was dispatched */
    latestFetchRequestId: null,
  },
  reducers: {
    // Direct theme selection: update both state and localStorage
    selectTheme: (state, action) => {
      state.currentTheme = action.payload;
      localStorage.setItem('currentTheme', action.payload);
    },
    // Clear theme: remove from state and localStorage
    resetTheme: (state) => {
      state.currentTheme = null;
      localStorage.removeItem('currentTheme');
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchThemeData.pending, (state, action) => {
        state.latestFetchRequestId = action.meta.requestId;
        state.status = 'loading';
      })
      .addCase(fetchThemeData.fulfilled, (state, action) => {
        if (action.meta.requestId !== state.latestFetchRequestId) {
          return;
        }
        state.status = 'succeeded';
        state.error = null;
        // Save payload as-is if you need it
        state.data = action.payload.data;

        // Session theme id (list rows use themename; API may send themeName only)
        const themeName =
          action.payload.data?.themename ?? action.payload.data?.themeName;
        state.currentTheme = themeName ?? null;
        // Persist only the theme name
        if (themeName != null) {
          localStorage.setItem('currentTheme', themeName);
        }

        // If admin mode, store available themes
        if (action.meta.arg.isAdmin) {
          state.availableThemes = action.payload.availableThemes || [];
        }
      })
      .addCase(fetchThemeData.rejected, (state, action) => {
        if (action.meta.requestId !== state.latestFetchRequestId) {
          return;
        }
        state.status = 'failed';
        state.error = action.payload;
      });
  },
});

export const { selectTheme, resetTheme } = themeSlice.actions;
export default themeSlice.reducer;
