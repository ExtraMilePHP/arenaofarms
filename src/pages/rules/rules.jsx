// rules.jsx
import React, { useEffect, useMemo, useState } from 'react';
import './rules.css';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { setBackButtonUrl } from '../uiSlice';
import { useThemeColors } from '../../functions/useThemeColors';

function UserRules() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { status: themeStatus, data: themeData } = useSelector(
    (state) => state.theme
  );
  const { status, user, error } = useSelector((state) => state.auth);
  const [redirect, setRedirect] = useState("/maingame");
  const [isLoading, setIsLoading] = useState(false);

  const rulesList = useMemo(() => {
    const raw = themeData?.rules;
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string' && raw.trim() !== '') {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [raw];
      } catch {
        return [raw];
      }
    }
    return [];
  }, [themeData]);

  useEffect(() => {
    if (!themeData) return;
    setIsLoading(true);
  }, [themeData]);

  useEffect(() => {
    if (!themeData) return;

    setRedirect("/arena");
  }, [themeData]);

  useEffect(() => {
    dispatch(setBackButtonUrl("/login?&save=true"));
  }, [status, user]);

  const handleNextClick = (e) => {
    e.preventDefault();
    navigate(redirect);
  };

  const { textColor: rulesTextColor, buttonStyle: nextButtonStyle } = useThemeColors();

  if (!isLoading) {
  return (
      <div className='quiz-loader-container'>
       <div className="quiz-loader"></div>
      </div>
  );
}

  return (
    <>
      <div className="user-rules-page">
        <div className="user-rules-stack">
          <fieldset
            className="user-rules-fieldset"
            style={rulesTextColor ? { color: rulesTextColor } : undefined}
          >
            <legend className="user-rules-heading">How to Play</legend>
            <ul className="user-rules-list">
              {rulesList.map((rule, index) => (
                <li key={index}>
                
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </fieldset>
          <button
            type="button"
            className="user-next-button"
            onClick={handleNextClick}
            style={nextButtonStyle}
          >
            Start Mission
          </button>
        </div>
      </div>
    </>
  )
}

export default UserRules;