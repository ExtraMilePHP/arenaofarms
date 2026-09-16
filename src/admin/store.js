import { configureStore } from '@reduxjs/toolkit';
import themeReducer from './themeSlice';
import sessionReducer from './sessionSlice'; 
import authReducer from "../pages/loginSlice";   
import uiReducer  from "../pages/uiSlice";   

export const store = configureStore({
  reducer: {
    theme: themeReducer,
    session: sessionReducer,
    auth:authReducer,
    ui:uiReducer 
  }
});