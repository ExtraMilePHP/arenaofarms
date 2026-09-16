import React, { useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { loginUser } from "../loginSlice";
import "./login.css";
import { setBackButtonUrl } from "../uiSlice";
import { useThemeColors } from "../../functions/useThemeColors";
import Swal from "sweetalert2";

function Login() {
  const dispatch = useDispatch();
  const { status, user, error } = useSelector((state) => state.auth);
  const { status: themeStatus, data: themeData } = useSelector(
    (state) => state.theme
  );

  const { buttonStyle } = useThemeColors();

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isAdmin = searchParams.get("admin") === "true";

  useEffect(() => {
    dispatch(loginUser());
  }, [dispatch]);

  useEffect(() => {
    if (status === "succeeded" && user && isAdmin) {
      navigate("/admin");
    }
  }, [status, user, isAdmin, navigate]);

  useEffect(() => {
    if (status === "succeeded" && user?.backButtonRedirect) {
      dispatch(setBackButtonUrl(user.backButtonRedirect));
    }
  }, [status, user, dispatch]);



 useEffect(() => {
  if (status !== "failed") return;
  const msg = error ? String(error) : "Session expired";
  const redirect = user && user.backButtonRedirect ? user.backButtonRedirect : "/";
  Swal.fire("Session Expired!", msg, "error").then(() => {
    window.location.href = redirect;
  });
}, [status, error, user]);

// Completed players are shown an "already played" popup and sent to the
// base URL — no replay. Players who are still in progress are left alone
// here so BEGIN PLAY resumes their game from where they left off.
useEffect(() => {
  if (isAdmin) return;
  if (status !== "succeeded" || !user) return;
  if (Number(user.gameover ?? 0) > 0) {
    Swal.fire("Already Played", "You have already completed this game.", "info").then(() => {
      window.location.href = process.env.REACT_APP_BASE_URL || "/";
    });
  }
}, [status, user, isAdmin]);

  if (status === "loading" || themeStatus === "loading") {
    return (
      <div className="login-main-container">
        <div className="quiz-loader-container">
          <div className="quiz-loader"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-main-container">
      {themeData && (
        <img
          src={process.env.REACT_APP_S3_PATH + themeData.logo}
          className="login-logo1"
          alt="Game Logo"
        />
      )}
        {user && status === "succeeded" && Number(user.gameover ?? 0) === 0 && (
          <div>
            <Link
              to="/rules"
              className="begin-play-btn"
              style={buttonStyle}
            >
              BEGIN PLAY
            </Link>
          </div>
        )}
    </div>
  );
}

export default Login;
