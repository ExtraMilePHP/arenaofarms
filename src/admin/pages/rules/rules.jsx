import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import Swal from "sweetalert2";
import { useNavigate } from "react-router-dom";
import "./rules.css";
import "../themeupdate/themeupdate.css";
import { fetchThemeData } from "../../themeSlice";
import { selectAdminToken, selectOrganizationId, selectSessionId } from "../../sessionSlice";
import { updateThemeData } from "../../functions/updateThemeData";

const MAX_RULES = 6;
const MAX_RULE_LEN = 200;
const MAX_POPUP_LEN = 500;

const NAMED_COLORS = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  gray: "#808080",
  grey: "#808080",
};

const ensureArray = (val) => {
  if (Array.isArray(val)) return val;
  if (val == null || val === "") return [];
  if (typeof val === "string") {
    try {
      const p = JSON.parse(val);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
};

function toColorInputValue(val) {
  if (!val || typeof val !== "string") return "#000000";
  const v = val.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  if (/^#[0-9a-fA-F]{8}$/.test(v)) return `#${v.slice(1, 7).toLowerCase()}`;
  const named = NAMED_COLORS[v.toLowerCase()];
  if (named) return named;
  return "#000000";
}

const clampInt = (n, min, max, fallback) => {
  const x = parseInt(String(n), 10);
  if (Number.isNaN(x)) return fallback;
  return Math.min(max, Math.max(min, x));
};

function parseStoredBool(raw, fallback = true) {
  if (raw === undefined || raw === null || raw === "") return fallback;
  if (typeof raw === "boolean") return raw;
  const s = String(raw).trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return fallback;
}

const Rules = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const adminToken = useSelector(selectAdminToken);
  const organizationId = useSelector(selectOrganizationId);
  const sessionId = useSelector(selectSessionId);
  const { currentTheme, data, status } = useSelector((state) => state.theme);

  const [loading, setLoading] = useState(false);
  const [rules, setRules] = useState([""]);
  const [textColor, setTextColor] = useState("#000000");
  const [buttonColor, setButtonColor] = useState("#667eea");
  const [buttonTextColor, setButtonTextColor] = useState("#ffffff");
  const [textBgColor, setTextBgColor] = useState("#ffffff");
  const [introPopup, setIntroPopup] = useState("");

  useEffect(() => {
    if (currentTheme) dispatch(fetchThemeData({ themeId: currentTheme, isAdmin: true }));
  }, [dispatch, currentTheme]);

  useEffect(() => {
    if (!data) return;

    const r = ensureArray(data.rules);
    setRules(r.length ? r.map(String) : [""]);

    setTextColor(toColorInputValue(data.textcolor));
    setButtonColor(toColorInputValue(data.button_color ?? "#667eea"));
    setButtonTextColor(
      toColorInputValue(data.button_Textcolor ?? data.button_text_color ?? "#ffffff")
    );
    setTextBgColor(toColorInputValue(data.text_bg_color ?? data.icon_bg_color ?? "#ffffff"));
    setIntroPopup(String(data.popup ?? "").slice(0, MAX_POPUP_LEN));
  }, [data]);

  const handleRuleChange = (idx, val) => {
    if (val.length > MAX_RULE_LEN) {
      Swal.fire("Limit", `Each rule can be at most ${MAX_RULE_LEN} characters.`, "warning");
      val = val.slice(0, MAX_RULE_LEN);
    }
    const arr = [...rules];
    arr[idx] = val;
    setRules(arr);
  };

  const handleIntroPopupChange = (val) => {
    if (val.length > MAX_POPUP_LEN) {
      Swal.fire("Limit", `Intro popup text can be at most ${MAX_POPUP_LEN} characters.`, "warning");
      val = val.slice(0, MAX_POPUP_LEN);
    }
    setIntroPopup(val);
  };

  const handleAddRule = () => {
    if (rules.length >= MAX_RULES) {
      Swal.fire("Limit", `Up to ${MAX_RULES} rules.`, "warning");
      return;
    }
    setRules([...rules, ""]);
  };

  const handleRemoveRule = (idx) => {
    if (rules.length <= 1) {
      Swal.fire("Required", "At least one rule is required.", "warning");
      return;
    }
    setRules(rules.filter((_, i) => i !== idx));
  };

  const validate = () => {
    const trimmedRules = rules.map((r) => r.trim()).filter(Boolean);
    if (trimmedRules.length === 0) return { ok: false, msg: "At least one rule is required." };
    for (const r of trimmedRules) {
      if (r.length > MAX_RULE_LEN) return { ok: false, msg: "Each rule must be 200 characters or less." };
    }

    const trimmedPopup = introPopup.trim();
    if (trimmedPopup.length > MAX_POPUP_LEN) {
      return { ok: false, msg: `Intro popup text must be ${MAX_POPUP_LEN} characters or less.` };
    }

    return {
      ok: true,
      payload: {
        rules: trimmedRules,
        popup: trimmedPopup,
        textcolor: textColor,
        button_color: buttonColor,
        button_Textcolor: buttonTextColor,
        text_bg_color: textBgColor,
        // Preserve existing fields that aren't being edited
        landing_page_title: String(data?.landing_page_title ?? "").trim(),
        custom_text_thank_you_page: String(data?.custom_text_thank_you_page ?? "").trim(),
        points: clampInt(data?.points, 1, Number.MAX_SAFE_INTEGER, 1),
        wrong_points: clampInt(data?.wrong_points, 1, Number.MAX_SAFE_INTEGER, 1),
        total_question: clampInt(data?.total_question, 1, Number.MAX_SAFE_INTEGER, 10),
        icon_bg_color: textBgColor,
        box_color: data?.box_color ?? data?.boxcolor ?? "#1e293b",
        use_timeout: parseStoredBool(data?.use_timeout, true),
        question_timeout_minutes: clampInt(data?.question_timeout_minutes, 0, 59, 1),
        question_timeout_seconds: clampInt(data?.question_timeout_seconds, 0, 59, 30),
        main: ensureArray(data?.main),
      },
    };
  };

  const handleSave = async () => {
    const v = validate();
    if (!v.ok) {
      await Swal.fire("Error", v.msg, "error");
      return;
    }
    setLoading(true);
    try {
      await updateThemeData({
        payload: {
          data: v.payload,
          organizationId: organizationId || "admin",
          sessionId: sessionId || "admin",
          currentTheme,
        },
        token: adminToken,
      });
      await dispatch(fetchThemeData({ themeId: currentTheme, isAdmin: true })).unwrap();
      await Swal.fire("Success", "Data updated", "success");
    } catch (e) {
      Swal.fire("Error", e.message || "Failed to save", "error");
    } finally {
      setLoading(false);
    }
  };

  if (status === "loading" && !data) {
    return (
      <div className="rules-page-new">
        <div className="themeupdate-loading">Loading...</div>
      </div>
    );
  }

  return (
    <>
      <div className="back-button-holder">
        <button type="button" className="back-button" onClick={() => navigate("/admin")}>
          <i className="fa-solid fa-arrow-left" /> Back
        </button>
      </div>

      <div className="themeupdate-row rules-php-layout">
        <div className="themeupdate-col rules-php-col">
          <div className="themeupdate-card rules-php-card rules-php-card--left">
            <div className="themeupdate-card-body rules-php-card-body">
              <h4 className="themeupdate-label rules-php-card-title">Add Custom Rules</h4>
              <div className="themeupdate-rules-repeater">
                {rules.map((rule, i) => (
                  <div key={i} className="themeupdate-rule-row rules-php-repeater-row">
                    <textarea
                      className="themeupdate-input rules-php-textarea rules-php-repeater-textarea"
                      placeholder="Rules"
                      maxLength={MAX_RULE_LEN}
                      value={rule}
                      onChange={(e) => handleRuleChange(i, e.target.value)}
                    />
                    <button
                      type="button"
                      className="themeupdate-btn themeupdate-btn-danger"
                      onClick={() => handleRemoveRule(i)}
                    >
                      <i className="fa-solid fa-times" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="themeupdate-btn themeupdate-btn-primary themeupdate-add-rule"
                  onClick={handleAddRule}
                >
                  <i className="fa-solid fa-plus" /> Add new rule
                </button>
                <p className="themeupdate-muted">
                  <code>
                    * Up to {MAX_RULES} rules, at least 1 required, {MAX_RULE_LEN} characters each
                  </code>
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="themeupdate-col rules-php-col">
          <div className="themeupdate-card rules-php-card rules-php-card--right">
            <div className="themeupdate-card-body rules-php-card-body">
              <div className="rules-php-marks-row rules-php-color-row">
                <label htmlFor="rules-button-color" className="rules-php-marks-label">
                  Button color
                </label>
                <input
                  id="rules-button-color"
                  type="color"
                  className="themeupdate-color-input rules-php-color-input"
                  value={buttonColor}
                  onChange={(e) => setButtonColor(e.target.value)}
                />
              </div>

              <div className="rules-php-marks-row rules-php-color-row">
                <label htmlFor="rules-button-text-color" className="rules-php-marks-label">
                  Button text color
                </label>
                <input
                  id="rules-button-text-color"
                  type="color"
                  className="themeupdate-color-input rules-php-color-input"
                  value={buttonTextColor}
                  onChange={(e) => setButtonTextColor(e.target.value)}
                />
              </div>

              <div className="rules-php-marks-row rules-php-color-row">
                <label htmlFor="rules-text-color" className="rules-php-marks-label">
                  Text color
                </label>
                <input
                  id="rules-text-color"
                  type="color"
                  className="themeupdate-color-input rules-php-color-input"
                  value={textColor}
                  onChange={(e) => setTextColor(e.target.value)}
                />
              </div>

              <div className="rules-php-marks-row rules-php-color-row">
                <label htmlFor="rules-text-bg-color" className="rules-php-marks-label">
                  Text background color
                </label>
                <input
                  id="rules-text-bg-color"
                  type="color"
                  className="themeupdate-color-input rules-php-color-input"
                  value={textBgColor}
                  onChange={(e) => setTextBgColor(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rules-php-layout rules-php-layout--single">
        <div className="themeupdate-card rules-php-card rules-php-card--full">
          <div className="themeupdate-card-body rules-php-card-body">
            <h4 className="themeupdate-label rules-php-card-title">Intro Popup Text</h4>
            <textarea
              className="themeupdate-input rules-php-textarea rules-php-popup-textarea"
              placeholder="Text shown in the intro popup before the How to Play screen"
              maxLength={MAX_POPUP_LEN}
              value={introPopup}
              onChange={(e) => handleIntroPopupChange(e.target.value)}
            />
            <p className="themeupdate-muted">
              <code>
                {introPopup.length}/{MAX_POPUP_LEN} characters
              </code>
            </p>
          </div>
        </div>
      </div>

      <div className="rules-action-holder">
        <button type="button" className="save-and-continue" onClick={handleSave} disabled={loading}>
          Save
        </button>

      </div>
    </>
  );
};

export default Rules;
