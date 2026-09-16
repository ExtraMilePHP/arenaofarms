import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { selectAdminToken } from './sessionSlice';

// existing fetchThemeData thunk…

/** 
 * A minimal thunk for hitting /processQuestions with the current theme.
 * We don’t track pending/succeeded/failed in state — it just fires off the request.
 */
export const processQuestions = createAsyncThunk(
  'theme/processQuestions',
  async (_, { getState, rejectWithValue }) => {
    try {
      const state = getState();
      const token = selectAdminToken(state);
      const currentTheme = state.theme.currentTheme;
      console.log("need theme",currentTheme);
      if (!currentTheme) {
        throw new Error('No currentTheme set');
      }

      console.log("hitting process");
      await fetch(`${process.env.REACT_APP_BACKEND_URL}/processQuestions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentTheme }),
      });
      // we don’t need to return any data
    } catch (err) {
      // if you want to catch errors later you can still handle them
      return rejectWithValue(err.message);
    }
  }
);

const themeSlice = createSlice({
  name: 'theme',
  initialState: {
    currentTheme: localStorage.getItem('currentTheme') || null,
    availableThemes: [],
    status: 'idle',
    error: null,
    data: null,
  },
  reducers: {
    selectTheme(state, action) {
      state.currentTheme = action.payload;
      localStorage.setItem('currentTheme', action.payload);
    },
    resetTheme(state) {
      state.currentTheme = null;
      localStorage.removeItem('currentTheme');
    },
  },
  extraReducers: (builder) => {
    builder
      // your existing fetchThemeData handlers…
      .addCase(processQuestions.rejected, (state, action) => {
        // optionally capture an error if you ever need it
        console.error('processQuestions failed:', action.payload);
      });
      // no need to handle pending/fulfilled
  },
});

export const { selectTheme, resetTheme } = themeSlice.actions;
export default themeSlice.reducer;
