import react, { useEffect, useState } from "react"

function AdminRedirect(){
    const [themeData, setThemeData] = useState(null);
    const [userData, setUserData] = useState(null);

    useEffect(()=>{
        const raw = sessionStorage.getItem("userData");
        const themeRaw =
          localStorage.getItem("themeData") || sessionStorage.getItem("themeData");
        if (!raw) return;
        try {
          setUserData(JSON.parse(raw));
          if (themeRaw) setThemeData(JSON.parse(themeRaw));
        } catch {
          /* ignore */
        }
      },[]);

     useEffect(()=>{
        if (userData == null) return;
        const base = process.env.REACT_APP_ADMIN_REDIRECT;
        if (!base) return;
        const q = new URLSearchParams({
          sessionId: String(userData.sessionId ?? ""),
          userId: String(userData.userId ?? ""),
          organizationId: String(userData.organizationId ?? ""),
        });
        window.location.href = `${base.replace(/\/$/, "")}?${q.toString()}`;
      },[userData]);

    return (
        <>

        </>
    )
}

export default AdminRedirect;