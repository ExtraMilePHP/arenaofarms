import React, { useEffect, useState, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import Swal from "sweetalert2";
import "./addcontent.css";
import { fetchThemeData } from "../../themeSlice";
import { selectAdminToken, selectOrganizationId, selectSessionId } from "../../sessionSlice";
import { useNavigate } from "react-router-dom";
import { updateThemeData } from "../../functions/updateThemeData";
import TabMenu from "../tabmenu/TabMenu";

/**
 * Parse PHP-style serialized array of strings, e.g. a:2:{i:0;s:3:"one";i:1;s:3:"two";}
 * Also accepts a:2:[...] (square bracket). Returns array of strings or null if not valid.
 */
const parsePhpSerializedArray = (str) => {
  if (typeof str !== "string" || !str.startsWith("a:")) return null;
  const result = [];
  let i = 2; // skip "a:"
  const len = str.length;
  const readNum = () => {
    let n = "";
    while (i < len && str[i] !== ":") { n += str[i]; i++; }
    i++;
    return parseInt(n, 10);
  };
  const readStr = () => {
    if (i >= len || str[i] !== "s" || str[i + 1] !== ":") return null;
    i += 2;
    const lenS = readNum();
    if (i >= len || str[i] !== '"') return null;
    i++;
    const s = str.slice(i, i + lenS);
    i += lenS + 2; // closing ";
    return s;
  };
  try {
    const count = readNum();
    // Accept both { and [ after count (some backends use [)
    if (str[i] !== "{" && str[i] !== "[") return null;
    i++;
    for (let k = 0; k < count && i < len; k++) {
      if (str[i] === "i" && str[i + 1] === ":") {
        i += 2;
        readNum();
        if (str[i] === ";") i++;
      }
      if (i < len && str[i] === "s" && str[i + 1] === ":") {
        const s = readStr();
        if (s != null) result.push(String(s));
      }
    }
    if (result.length > 0) return result;
  } catch {
    // fall through to regex fallback
  }
  // Fallback: extract all s:LEN:"value"; patterns (robust to minor format issues)
  const regex = /s:\d+:"([^"]*)";/g;
  const fallback = [];
  let m;
  while ((m = regex.exec(str)) !== null) {
    if (m[1].trim()) fallback.push(m[1].trim());
  }
  return fallback.length > 0 ? fallback : null;
};

const parseArray = (val) => {
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === "string") {
    // Try PHP serialized first (common when backend stores serialized)
    const php = parsePhpSerializedArray(val);
    if (php) return php;
    try {
      const p = JSON.parse(val);
      return Array.isArray(p) ? p.map(String) : [];
    } catch {
      return val.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
};

const COUNT_OPTIONS = [20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70];
const MIN_WORDS = 15;
const MAX_CHARS = 20;
const TICKET_DIMS = [798, 458];
const LUCKYLOGO_DIMS = [300, 140];
const VALID_EXT = ["jpg", "jpeg", "png"];
const MAX_FILE_MB = 5;

const AddContent = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const adminToken = useSelector(selectAdminToken);
  const organizationId = useSelector(selectOrganizationId);
  const sessionId = useSelector(selectSessionId);
  const { currentTheme, data, status } = useSelector((state) => state.theme);

  const [valuesArray, setValuesArray] = useState([]);
  const [words, setWords] = useState([]);
  const [maxvalue, setMaxvalue] = useState(70);
  const [addType, setAddType] = useState("words");
  const [selectedCount, setSelectedCount] = useState(70);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);
  const [csvFileName, setCsvFileName] = useState("");
  const [csvFile, setCsvFile] = useState(null);
  const [ticketFile, setTicketFile] = useState(null);
  const [luckylogoFile, setLuckylogoFile] = useState(null);
  const [ticketPreviewLocalUrl, setTicketPreviewLocalUrl] = useState(null);
  const [luckylogoPreviewLocalUrl, setLuckylogoPreviewLocalUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const ticketInputRef = useRef(null);
  const luckylogoInputRef = useRef(null);

  useEffect(() => {
    if (currentTheme) dispatch(fetchThemeData({ themeId: currentTheme }));
  }, [dispatch, currentTheme]);

  useEffect(() => {
    if (!ticketFile) {
      setTicketPreviewLocalUrl(null);
      return;
    }
    const url = URL.createObjectURL(ticketFile);
    setTicketPreviewLocalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [ticketFile]);

  useEffect(() => {
    if (!luckylogoFile) {
      setLuckylogoPreviewLocalUrl(null);
      return;
    }
    const url = URL.createObjectURL(luckylogoFile);
    setLuckylogoPreviewLocalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [luckylogoFile]);

  useEffect(() => {
    if (!data) return;
    const arr = parseArray(data.values_array);
    setValuesArray(arr);
    setWords(parseArray(data.words));
    const mv = Number(data.maxvalue);
    setMaxvalue(Number.isNaN(mv) ? 70 : mv);
    const idx = COUNT_OPTIONS.indexOf(mv);
    setSelectedCount(idx >= 0 ? COUNT_OPTIONS[idx] : 70);
  }, [data]);

  const addItem = (item) => {
    const trimmed = String(item).trim().slice(0, MAX_CHARS);
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (valuesArray.some((w) => w.toLowerCase() === lower)) {
      Swal.fire("Duplicate not allowed", "Word/number already exists.", "error");
      return;
    }
    setValuesArray((prev) => [...prev, trimmed]);
    setInputValue("");
  };

  const removeItem = (index) => {
    setValuesArray((prev) => prev.filter((_, i) => i !== index));
  };

  const handleInputKeyDown = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addItem(inputValue);
    }
  };

  const handleSaveWords = async () => {
    if (valuesArray.length < MIN_WORDS) {
      Swal.fire("Error", `Minimum ${MIN_WORDS} words/numbers required.`, "error");
      return;
    }
    setLoading(true);
    try {
      const shuffle = Array.from({ length: valuesArray.length }, (_, i) => String(i + 1));
      await updateThemeData({
        payload: {
          data: {
            values_array: valuesArray,
            words: valuesArray,
            maxvalue: valuesArray.length,
            shuffle,
          },
          organizationId: organizationId || "admin",
          sessionId: sessionId || "admin",
          currentTheme,
        },
        token: adminToken,
      });
      await dispatch(fetchThemeData({ themeId: currentTheme })).unwrap();
      setSelectedCount(valuesArray.length);
      Swal.fire("Success", "Data Updated", "success");
    } catch (e) {
      Swal.fire("Error", e.message || "Failed to save", "error");
    } finally {
      setLoading(false);
    }
  };

  const generateFromTypeAndCount = () => {
    if (addType === "numbers") {
      const arr = Array.from({ length: selectedCount }, (_, i) => String(i + 1));
      setValuesArray(arr);
    } else {
      const take = words.slice(0, selectedCount);
      setValuesArray(take);
    }
  };

  const handleAddTypeChange = (newType) => {
    setAddType(newType);
    if (newType === "numbers") {
      const arr = Array.from({ length: selectedCount }, (_, i) => String(i + 1));
      setValuesArray(arr);
    } else {
      setValuesArray(words.slice(0, selectedCount));
    }
  };

  const handleCountChange = (newCount) => {
    setSelectedCount(newCount);
    if (addType === "numbers") {
      const arr = Array.from({ length: newCount }, (_, i) => String(i + 1));
      setValuesArray(arr);
    }
  };

  const handleSaveTypeAndCount = async () => {
    if (valuesArray.length < MIN_WORDS) {
      Swal.fire("Error", `Minimum ${MIN_WORDS} words/numbers required.`, "error");
      return;
    }
    setLoading(true);
    try {
      const shuffle = Array.from({ length: valuesArray.length }, (_, i) => String(i + 1));
      await updateThemeData({
        payload: {
          data: {
            values_array: valuesArray,
            words: valuesArray,
            maxvalue: valuesArray.length,
            shuffle,
          },
          organizationId: organizationId || "admin",
          sessionId: sessionId || "admin",
          currentTheme,
        },
        token: adminToken,
      });
      await dispatch(fetchThemeData({ themeId: currentTheme })).unwrap();
      setSelectedCount(valuesArray.length);
      Swal.fire("Success", "Data Updated", "success");
    } catch (e) {
      Swal.fire("Error", e.message || "Failed to save", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleCsvFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext !== "csv") {
      Swal.fire("Error", "Use CSV file only", "error");
      e.target.value = "";
      return;
    }
    setCsvFile(file);
    setCsvFileName(file.name);
    e.target.value = "";
  };

  const handleCsvUpload = () => {
    if (!csvFile) {
      Swal.fire("Info", "Please choose a CSV file first", "info");
      return;
    }
    setCsvLoading(true);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result || "";
        const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const parsed = [];
        for (const line of lines) {
          const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, "").replace(/\s+/g, " ").slice(0, MAX_CHARS));
          parsed.push(...cells.filter(Boolean));
        }
        const unique = [...new Set(parsed)];
        setValuesArray(unique);
        if (unique.length > 0) setSelectedCount(unique.length);
        setCsvFile(null);
        setCsvFileName("");
        Swal.fire("Success", `Loaded ${unique.length} words/numbers from CSV`, "success");
      } catch (err) {
        Swal.fire("Error", "Failed to parse CSV", "error");
      }
      setCsvLoading(false);
    };
    reader.readAsText(csvFile);
  };

  const downloadSampleCsv = () => {
    const sample = ["Word1", "Word2", "Word3"].join("\n");
    const blob = new Blob([sample], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sample.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const validateImageDimensions = (file, requiredWidth, requiredHeight) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img.width === requiredWidth && img.height === requiredHeight);
      img.onerror = () => reject(new Error("Invalid image"));
      img.src = URL.createObjectURL(file);
    });
  };

  const handleTicketLogoSubmit = async (e) => {
    e.preventDefault();
    if (!ticketFile && !luckylogoFile) {
      Swal.fire("Info", "Select at least one image", "info");
      return;
    }
    const ext = (f) => f?.name.split(".").pop().toLowerCase();
    const valid = (f) => f && VALID_EXT.includes(ext(f)) && f.size <= MAX_FILE_MB * 1024 * 1024;
    if (ticketFile && !valid(ticketFile)) {
      Swal.fire("Error", "Ticket: JPG/JPEG/PNG only, max 5MB", "error");
      return;
    }
    if (luckylogoFile && !valid(luckylogoFile)) {
      Swal.fire("Error", "Lucky logo: JPG/JPEG/PNG only, max 5MB", "error");
      return;
    }
    try {
      if (ticketFile) {
        const ok = await validateImageDimensions(ticketFile, TICKET_DIMS[0], TICKET_DIMS[1]);
        if (!ok) {
          Swal.fire("Error", `Ticket image must be ${TICKET_DIMS[0]}×${TICKET_DIMS[1]}`, "error");
          return;
        }
      }
      if (luckylogoFile) {
        const ok = await validateImageDimensions(luckylogoFile, LUCKYLOGO_DIMS[0], LUCKYLOGO_DIMS[1]);
        if (!ok) {
          Swal.fire("Error", `Lucky logo must be ${LUCKYLOGO_DIMS[0]}×${LUCKYLOGO_DIMS[1]}`, "error");
          return;
        }
      }
    } catch {
      Swal.fire("Error", "Failed to validate image dimensions", "error");
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("themeName", currentTheme);
      formData.append("organizationId", organizationId || "admin");
      formData.append("sessionId", sessionId || "admin");
      formData.append("extraData", JSON.stringify({ themeName: data?.themeName || "", themeDescription: data?.themeDescription || "" }));
      if (ticketFile) formData.append("ticket", ticketFile);
      if (luckylogoFile) formData.append("luckylogo", luckylogoFile);
      const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/updateThemeMedia`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      await dispatch(fetchThemeData({ themeId: currentTheme })).unwrap();
      setTicketFile(null);
      setLuckylogoFile(null);
      if (ticketInputRef.current) ticketInputRef.current.value = "";
      if (luckylogoInputRef.current) luckylogoInputRef.current.value = "";
      Swal.fire("Success", "Images updated", "success");
    } catch (err) {
      Swal.fire("Error", err.message || "Failed to upload images", "error");
    } finally {
      setUploading(false);
    }
  };

  const ticketPreviewServer = data?.ticket ? (process.env.REACT_APP_S3_PATH || "") + data.ticket : null;
  const luckylogoPreviewServer = data?.luckylogo ? (process.env.REACT_APP_S3_PATH || "") + data.luckylogo : null;
  const ticketPreview = ticketPreviewLocalUrl || ticketPreviewServer;
  const luckylogoPreview = luckylogoPreviewLocalUrl || luckylogoPreviewServer;

  if (status === "loading" && !data) {
    return (
      <div className="addcontent-page">
        <div className="addcontent-loading">Loading...</div>
      </div>
    );
  }

  return (
    <>
      <div className="back-button-holder">
        <button type="button" className="back-button" onClick={() => navigate("/admin/rules")}>
          <i className="fa-solid fa-arrow-left"></i> Back
        </button>
      </div>

      <TabMenu />

      <div className="addcontent-page">
        <div className="addcontent-row">
          <div className="addcontent-col">
            <div className="addcontent-card">
              <div className="addcontent-card-header">Add Words or Numbers</div>
              <div className="addcontent-card-body">
                <label className="addcontent-label">These Numbers or words will reflect on Landing Page</label>
                <div className="addcontent-tags-wrap">
                  {valuesArray.map((item, i) => (
                    <span key={`${i}-${String(item)}`} className="addcontent-tag">
                      <span className="addcontent-tag-text">{String(item)}</span>
                      <button type="button" className="addcontent-tag-remove" onClick={() => removeItem(i)} aria-label="Remove">
                        <i className="fa-solid fa-times"></i>
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    className="addcontent-tag-input"
                    placeholder="Add word or number..."
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleInputKeyDown}
                    onBlur={() => inputValue && addItem(inputValue)}
                  />
                </div>
                <p className="addcontent-muted">
                  <code>
                    * Duplicate words not allowed<br />
                    * Word must be fewer than 20 characters.<br />
                    * To add a word or number, delete one first to avoid errors.<br />
                    * Minimum {MIN_WORDS} words/numbers required.
                  </code>
                </p>
                <div className="addcontent-count-badge">
                  {addType === "numbers" ? "numbers" : "words"} {valuesArray.length} / {selectedCount}
                </div>
              </div>
            </div>
          </div>

          <div className="addcontent-col">
            <div className="addcontent-card">
              <div className="addcontent-card-header">Select number of words/numbers</div>
              <div className="addcontent-card-body">
                <div className="addcontent-form-row">
                  <label className="addcontent-label-inline">Add</label>
                  <select
                    className="addcontent-select"
                    value={addType}
                    onChange={(e) => handleAddTypeChange(e.target.value)}
                  >
                    <option value="words">Words</option>
                    <option value="numbers">Numbers</option>
                  </select>
                  <select
                    className="addcontent-select"
                    value={selectedCount}
                    onChange={(e) => handleCountChange(Number(e.target.value))}
                  >
                    {COUNT_OPTIONS.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
                <p className="addcontent-muted">
                  <code>
                    * Clear list first to apply type/count.<br />
                    * Words/numbers show on landing page until saved.<br />
                    * CSV count should match dropdown when using both.
                  </code>
                </p>
                <div className="addcontent-actions addcontent-actions-row">
                  <button
                    type="button"
                    className="addcontent-btn addcontent-btn-primary"
                    onClick={handleSaveTypeAndCount}
                    disabled={loading}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="addcontent-btn addcontent-btn-secondary"
                    onClick={generateFromTypeAndCount}
                  >
                    Apply {addType === "numbers" ? "Numbers" : "Words"} ({selectedCount})
                  </button>
                </div>

                <h4 className="addcontent-h4">Upload words/numbers from CSV file</h4>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleCsvFileSelect}
                  className="addcontent-file-input-hidden"
                  id="addcontent-csv-input"
                />
                <div className="addcontent-csv-row">
                  <button
                    type="button"
                    className="addcontent-btn addcontent-btn-csv"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Choose CSV file
                  </button>
                  <button
                    type="button"
                    className="addcontent-btn addcontent-btn-primary"
                    onClick={handleCsvUpload}
                    disabled={!csvFile || csvLoading}
                  >
                    {csvLoading ? "Uploading..." : "Upload"}
                  </button>
                </div>
                {csvFileName && <span className="addcontent-csv-filename">{csvFileName}</span>}
                <p className="addcontent-muted">
                  <code>* Use CSV file only. Special characters not allowed; spaces removed.</code>
                </p>
                <div className="addcontent-actions">
                  <button
                    type="button"
                    onClick={downloadSampleCsv}
                    className="addcontent-btn addcontent-btn-outline"
                  >
                    Download Sample CSV
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="addcontent-col">
            <div className="addcontent-card">
              <div className="addcontent-card-header">Ticket background</div>
              <div className="addcontent-card-body">
                <form onSubmit={handleTicketLogoSubmit}>
                  <h4 className="addcontent-h4">Ticket Background</h4>
                  <div className="addcontent-file-row">
                    <input
                      ref={ticketInputRef}
                      type="file"
                      accept=".jpg,.jpeg,.png"
                      onChange={(e) => setTicketFile(e.target.files?.[0] || null)}
                      className="addcontent-file-input"
                    />
                    <label className="addcontent-file-label">Choose file{ticketFile ? ` — ${ticketFile.name}` : ""}</label>
                  </div>
                  <p className="addcontent-muted">
                    <code>* JPG, JPEG, PNG. Dimensions {TICKET_DIMS[0]}×{TICKET_DIMS[1]}</code>
                  </p>
                  <h4 className="addcontent-h4">Preview Ticket</h4>
                  <div className="addcontent-preview">
                    {ticketPreview ? (
                      <img src={ticketPreview} alt="Ticket" className="addcontent-preview-img" />
                    ) : (
                      <span className="addcontent-preview-placeholder">No image</span>
                    )}
                  </div>

                  <hr className="addcontent-hr" />

                  <h4 className="addcontent-h4">Lucky Logo</h4>
                  <div className="addcontent-file-row">
                    <input
                      ref={luckylogoInputRef}
                      type="file"
                      accept=".jpg,.jpeg,.png"
                      onChange={(e) => setLuckylogoFile(e.target.files?.[0] || null)}
                      className="addcontent-file-input"
                    />
                    <label className="addcontent-file-label">Choose file{luckylogoFile ? ` — ${luckylogoFile.name}` : ""}</label>
                  </div>
                  <p className="addcontent-muted">
                    <code>* JPG, JPEG, PNG. Dimensions {LUCKYLOGO_DIMS[0]}×{LUCKYLOGO_DIMS[1]}</code>
                  </p>
                  <h4 className="addcontent-h4">Preview Lucky logo</h4>
                  <div className="addcontent-preview">
                    {luckylogoPreview ? (
                      <img src={luckylogoPreview} alt="Lucky logo" className="addcontent-preview-img" />
                    ) : (
                      <span className="addcontent-preview-placeholder">No image</span>
                    )}
                  </div>

                  <div className="addcontent-actions">
                    <button type="submit" className="addcontent-btn addcontent-btn-primary" disabled={uploading}>
                      {uploading ? "Uploading..." : "Upload"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default AddContent;
