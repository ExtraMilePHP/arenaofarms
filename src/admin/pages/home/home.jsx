import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import CreateTheme from "../createTheme/createTheme";
import { useDispatch, useSelector } from "react-redux";
import { fetchThemeData } from "../../themeSlice";
import { useNavigate } from "react-router-dom";

import Swal from "sweetalert2";
import "./home.css";

import { selectAdminToken } from "../../sessionSlice";
import UpdateThemeImages from "../updateThemeImage/updateThemeImage";

function normalizeThemeName(name) {
  return String(name ?? "").trim().toLowerCase();
}

/** Backend or overlapping fetches can occasionally return duplicate rows; keep one card per theme. */
function dedupeThemeRows(rows) {
  if (!Array.isArray(rows)) return [];
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const idPart = row?.id != null && row.id !== "" ? String(row.id) : "";
    const namePart = normalizeThemeName(row?.themename ?? row?.themeName);
    const key = idPart || namePart || `__row_${out.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function Home() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [themes, setThemes] = useState([]);
  const fetchAllThemesSeq = useRef(0);
  const adminToken = useSelector(selectAdminToken);
  const navigate = useNavigate();

  const dispatch = useDispatch();
  const { status, data, currentTheme } = useSelector((state) => state.theme);

  const fetchAllThemes = useCallback(() => {
    const seq = ++fetchAllThemesSeq.current;
    setThemes([]);
    fetch(process.env.REACT_APP_BACKEND_URL + "/fetchAllThemes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        test: "test",
      }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("Network response was not ok");
        return res.json();
      })
      .then((json) => {
        if (seq !== fetchAllThemesSeq.current) return;
        if (json.success) {
          setThemes(dedupeThemeRows(json.data));
        } else {
          console.error("API error:", json.message);
        }
      })
      .catch((err) => console.error("Fetch error:", err));
  }, [adminToken]);

  // Wait for session token, then load theme + theme list (avoids unauthenticated first request and race with login fetch)
  useEffect(() => {
    if (!adminToken || isUpdateModalOpen) return;
    let cancelled = false;
    (async () => {
      try {
        await dispatch(fetchThemeData({ isAdmin: true })).unwrap();
      } catch {
        /* slice sets status/error */
      }
      if (!cancelled) {
        fetchAllThemes();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dispatch, adminToken, isUpdateModalOpen, fetchAllThemes]);

  /**
   * Exactly one row should show the check:
   * 1) Prefer session theme from Redux + fetchThemeData (currentTheme / data), matched to a list row by themename or themeName.
   * 2) If fetchAllThemes incorrectly marks multiple rows selected, pick one row deterministically (never show two checks).
   * 3) Fallback: single row with selected==="true", or first of many.
   */
  const activeThemeNorm = useMemo(() => {
    const candidates = [currentTheme, data?.themename, data?.themeName]
      .map(normalizeThemeName)
      .filter(Boolean);

    for (const c of candidates) {
      const row = themes.find(
        (t) =>
          normalizeThemeName(t.themename) === c ||
          normalizeThemeName(t.themeName) === c
      );
      if (row) return normalizeThemeName(row.themename);
    }

    const marked = themes.filter(
      (t) => String(t.selected).toLowerCase() === "true"
    );
    if (marked.length === 0) return "";
    if (marked.length === 1) return normalizeThemeName(marked[0].themename);

    for (const t of marked) {
      const tn = normalizeThemeName(t.themename);
      if (
        candidates.some(
          (c) => c === tn || c === normalizeThemeName(t.themeName)
        )
      ) {
        return tn;
      }
    }
    return normalizeThemeName(marked[0].themename);
  }, [currentTheme, data, themes]);

  const browseTheme = async (themeName) => {
    try {
      // wait until the server responds and state is updated
      await dispatch(fetchThemeData({ themeId: themeName })).unwrap();
      navigate("/admin/rules");
    } catch (err) {
      Swal.fire("Error loading theme", err.message, "error");
    }
  };

  const persistThemeSelection = (themeName) => {
    fetch(`${process.env.REACT_APP_BACKEND_URL}/selectTheme`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        themeName,
      }),
    })
      .then((res) => res.json())
      .then((json) => {
        if (!json.success) {
          console.error("SelectTheme error:", json.message);
        } else {
          Swal.fire({
            title: "Theme Selected",
            text: "",
            icon: "success",
          });
          fetchAllThemes();
          dispatch(fetchThemeData({ isAdmin: true }));
        }
      })
      .catch((err) => console.error("SelectTheme fetch error:", err));
  };

  const deleteTheme = (themeName) => {
    Swal.fire({
      title: "Are you sure?",
      text: `Do you really want to delete the theme ?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, delete it!",
      cancelButtonText: "No, keep it",
    }).then((result) => {
      if (result.isConfirmed) {
        fetch(`${process.env.REACT_APP_BACKEND_URL}/deleteTheme`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${adminToken}`,
          },
          body: JSON.stringify({ themeName }),
        })
          .then((res) => res.json())
          .then((json) => {
            if (!json.success) {
              console.error("deleteTheme error:", json.message);
              Swal.fire("Error", json.message, "error");
            } else {
              Swal.fire("Deleted!", `Theme has been deleted.`, "success").then(
                () => {
                  // refresh or update state
                  window.location.reload();
                }
              );
            }
          })
          .catch((err) => {
            console.error("deleteTheme fetch error:", err);
            Swal.fire("Error", "Network error, please try again.", "error");
          });
      }
      // else: user cancelled, do nothing
    });
  };

  const OpenUpdateModal = (themeName) => {
    dispatch(fetchThemeData({ themeId: themeName }));
    setIsUpdateModalOpen(true);
  };

  if (status === "loading") {
    return (
      <div className="load-theme-container">
        <div className="load-theme-spinner"></div>
        <p>Loading themes...</p>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="load-theme-container">
        <p className="load-theme-error">❌ Error loading themes</p>
      </div>
    );
  }

  return (
    <>
      <CreateTheme isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
      <UpdateThemeImages
        isOpen={isUpdateModalOpen}
        onClose={() => setIsUpdateModalOpen(false)}
      />
      <div className="te-container">
        {/* LEFT SIDE (70%) */}
        <div className="te-left">
          <div className="te-image-wrapper">
            {data?.themename || data?.themeName ? (
              <img
                src={process.env.REACT_APP_S3_PATH + `${data?.themeImage}`}
                className="te-main-image"
                alt=""
              />
            ) : (
              <>No Theme Found</>
            )}
          </div>

          <div className="te-info">
            <h2 className="te-name">{data?.themeName ?? data?.themename}</h2>
            <p className="te-desc">{data?.themeDescription}</p>
          </div>
        </div>

        {/* RIGHT SIDE (30%) */}
        <div className="te-right">
          <div className="te-select-header">
            <h3 className="te-select-title">Select Themes</h3>
            <button
              className="te-create-btn"
              onClick={() => setIsModalOpen(true)}
            >
              + Create Theme
            </button>
          </div>
          <div className="te-themes-list">
            {themes.map((theme) => (
              <div
                key={
                  theme.id != null && theme.id !== ""
                    ? String(theme.id)
                    : `${normalizeThemeName(theme.themename)}-${normalizeThemeName(theme.themeName)}`
                }
                className="te-theme-item"
                onClick={() => persistThemeSelection(theme.themename)}
              >
                {/* Theme image */}
                <img
                  src={process.env.REACT_APP_S3_PATH + `${theme.themeImage}`}
                  alt={theme.themename}
                  className="te-theme-image"
                />

                {activeThemeNorm &&
                  normalizeThemeName(theme.themename) === activeThemeNorm && (
                  <i
                    className="fa-solid fa-check te-selected-icon"
                    title="Selected"
                  />
                )}

                {/* Existing action icons */}
                <div className="te-icons">
                  <i
                    className="fa-solid fa-image te-icon"
                    title="Edit Image"
                    onClick={(e) => {
                      e.stopPropagation(); // ← prevent parent onClick
                      // setIsUpdateModalOpen(true);
                      OpenUpdateModal(theme.themename);
                    }}
                  ></i>
                  <i
                    className="fa-solid fa-gear te-icon"
                    title="Settings"
                    onClick={(e) => {
                      e.stopPropagation(); // ← prevent parent onClick
                      browseTheme(theme.themename); // ← your settings action
                    }}
                  />
                  <i
                    className="fa-solid fa-trash te-icon"
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation(); // ← prevent parent onClick
                      deleteTheme(theme.themename); // ← your settings action
                    }}
                  ></i>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

export default Home;
