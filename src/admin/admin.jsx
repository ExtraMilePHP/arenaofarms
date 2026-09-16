import react from "react"
import "./admin.css";
import { useLocation, useNavigate } from "react-router-dom";

function Admin({children}){
  const location = useLocation();
  const navigate = useNavigate();

 const raw = location.pathname;
 const cleaned = raw.endsWith("/") && raw !== "/" ? raw.slice(0, -1) : raw;
 const isRootAdmin = cleaned === "/admin";

      const redirectGameSession=()=>{
        const raw = sessionStorage.getItem("userData");
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const getGameId = parsed?.gameId;
        if (getGameId == null) return;
        window.location.href=process.env.REACT_APP_BASE_URL+"/active-games/"+getGameId;
      }

      return <div className="admin-background">
       <div className="header-admin">
        {/* {!isRootAdmin && (
          <div className="back-button-holder">
              <button
                className="back-button"
                onClick={() => navigate(-1)}
              >
              <i className="fa-solid fa-arrow-left"></i> Back
              </button>
          </div>
        )} */}

         <div className="brand-logo-and-game-holder">
          <div className="brand-logo-holder" onClick={()=>{window.location.href = process.env.REACT_APP_BASE_URL;}}>
          <img src="/admin/play.png" className="brand-logo"/>{localStorage.getItem("session") === "admin&admin" && " SUPERADMIN"}
         </div>
         <div onClick={()=>{redirectGameSession()}}>Arena of Arms </div>
          
         </div>
       
         
         <div className="user">
            <img src="/admin/user.png"/>
         </div>
       </div>
       {children}
      </div>
}

export default Admin;
