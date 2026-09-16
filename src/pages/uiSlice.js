// src/app/uiSlice.js
import { createSlice } from '@reduxjs/toolkit';

// Session tab userData only (same key as loginSlice; not localStorage — avoids stale auth UI)
const persistedUser = JSON.parse(sessionStorage.getItem('userData') || 'null');
const initialState = {
  companyLogoUrl:
    persistedUser?.companyLogoUrl || process.env.REACT_APP_EM_LOGO || null,
  backButtonUrl: persistedUser?.backButtonRedirect || null,
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setCompanyLogoUrl(state, action) {
      state.companyLogoUrl = action.payload;
    },
    setBackButtonUrl(state, action) {
      state.backButtonUrl = action.payload;
    },
  },
});

export const { setCompanyLogoUrl, setBackButtonUrl } = uiSlice.actions;
export default uiSlice.reducer;
