import React, { useRef, useState } from "react";
import Switch from "react-switch";
import Swal from "sweetalert2";
import "./createTheme.css";
import { useDispatch, useSelector } from "react-redux";
import { selectAdminToken, setSession } from "../../sessionSlice";

function CreateTheme({ isOpen, onClose }) {
  const [themeName, setThemeName] = useState("");
  const [scorePerQuestion, setScorePerQuestion] = useState(1);
  const [lifelinesEnabled, setLifelinesEnabled] = useState(false);
  const [shuffleEnable, setshuffleEnable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [themeDescription, setThemeDescription] = useState("");

  const [files, setFiles] = useState({
    thumbnail: null,
    logo: null,
    desktopBg: null,
    mobileBg: null,
  });
  const [previews, setPreviews] = useState({
    thumbnail: null,
    logo: null,
    desktopBg: null,
    mobileBg: null,
  });
  const [errors, setErrors] = useState({});
  const fileInputs = useRef({});
  const submitInFlightRef = useRef(false);
  const adminToken = useSelector(selectAdminToken);

  const resetForm = () => {
    setPreviews((prev) => {
      Object.values(prev).forEach((url) => {
        if (url && String(url).startsWith("blob:")) URL.revokeObjectURL(url);
      });
      return {
        thumbnail: null,
        logo: null,
        desktopBg: null,
        mobileBg: null,
      };
    });
    setFiles({
      thumbnail: null,
      logo: null,
      desktopBg: null,
      mobileBg: null,
    });
    setThemeName("");
    setThemeDescription("");
    setScorePerQuestion(1);
    setLifelinesEnabled(false);
    setshuffleEnable(false);
    setErrors({});
    setSaving(false);
    submitInFlightRef.current = false;
    Object.keys(fileInputs.current).forEach((key) => {
      const el = fileInputs.current[key];
      if (el) el.value = "";
    });
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  if (!isOpen) return null;

  const validateImage = async (file, type) => {
    const validExt = ["jpg", "jpeg", "png"];
    const maxSizeMB = 5;
    const dimensionRequirements = {
      thumbnail: [200, 300],
      logo: [400, 300],
      desktopBg: [1920, 1080],
      mobileBg: [414, 896],
    };

    // Extension check
    const extension = file.name.split(".").pop().toLowerCase();
    if (!validExt.includes(extension)) {
      return `Only ${validExt.join(", ")} formats allowed`;
    }

    // Size check
    if (file.size > maxSizeMB * 1024 * 1024) {
      return `File size exceeds ${maxSizeMB}MB limit`;
    }

    // Dimension check
    try {
      const dimensions = await getImageDimensions(file);
      const [reqWidth, reqHeight] = dimensionRequirements[type];

      if (dimensions.width !== reqWidth || dimensions.height !== reqHeight) {
        return `Image must be ${reqWidth}x${reqHeight} pixels`;
      }
    } catch (error) {
      return "Failed to validate image dimensions";
    }

    return null;
  };

  const getImageDimensions = (file) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.width, height: img.height });
      };
      img.src = URL.createObjectURL(file);
    });
  };

  const handleFileChange = async (type, e) => {
    const file = e.target.files[0];
    if (!file) return;

    const error = await validateImage(file, type);

    if (error) {
      await Swal.fire({
        title: "Invalid Image",
        text: error,
        icon: "error",
      });
      e.target.value = "";
      setFiles((prev) => ({ ...prev, [type]: null }));
    } else {
      setFiles((prev) => ({ ...prev, [type]: file }));
      const previewUrl = URL.createObjectURL(file);
      setPreviews((prev) => ({ ...prev, [type]: previewUrl }));
    }
  };

  const handleSubmit = async () => {
    if (submitInFlightRef.current || saving) return;
    // Validate theme name
    if (!themeName.trim()) {
      await Swal.fire({
        title: "Error",
        text: "Theme name is required",
        icon: "error",
      });
      return;
    }

    if(!themeDescription.trim()){
      await Swal.fire({
        title: "Error",
        text: "Theme Description is required",
        icon: "error",
      });
      return;
    }


    if(themeName.trim().length>50){
      await Swal.fire({
        title: "Error",
        text: "Theme name should not exceed than 50 character",
        icon: "error",
      });
      return;
    }

     if(themeDescription.trim().length>200){
      await Swal.fire({
        title: "Error",
        text: "Theme description should not exceed than 200 character",
        icon: "error",
      });
      return;
    }

    // Check all files are uploaded
    const missingFiles = Object.entries(files).filter(([_, file]) => !file);
    if (missingFiles.length > 0) {
      await Swal.fire({
        title: "Error",
        text: "All images are required",
        icon: "error",
      });
      return;
    }

    // Prepare form data
    const formData = new FormData();
    const extraData = {
      themeName,
      themeDescription,
      // correctPoints: scorePerQuestion,
      // lifelines: lifelinesEnabled,
      // shuffle: shuffleEnable,
    };
    formData.append("extraData", JSON.stringify(extraData));

    Object.entries(files).forEach(([key, file]) => {
      formData.append(key, file);
    });

    submitInFlightRef.current = true;
    setSaving(true);
    try {
      const response = await fetch(
        process.env.REACT_APP_BACKEND_URL + "/uploadNewTheme",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${adminToken}`, // send it like a JWT for now
          },
          body: formData,
        }
      );

      if (!response.ok) {
        throw new Error("Upload failed");
      }

      await Swal.fire({
        title: "Success",
        text: "Theme created successfully",
        icon: "success",
      });
      setTimeout(() => {
        window.location.reload();
      }, 1000);
      resetForm();
      onClose();
    } catch (error) {
      await Swal.fire({
        title: "Error",
        text: "Failed to upload theme",
        icon: "error",
      });
    } finally {
      submitInFlightRef.current = false;
      setSaving(false);
    }
  };

  return (
    <>
      <div className="modal-backdrop" onClick={handleClose} />
      <div className="theme-modal">
        <div className="form-group">
          <label>Add Theme Name</label>
          <input
            type="text"
            value={themeName}
            onChange={(e) => {
              setThemeName(e.target.value);
              setErrors((prev) => ({ ...prev, themeName: null }));
            }}
            placeholder="Enter theme name"
          />
          {errors.themeName && (
            <span className="error">{errors.themeName}</span>
          )}
           <div className='code'>* Max length 50 characters.</div> 
        </div>
        <div className="form-group">
          <label>Theme Description</label>
          <input
            type="text"
            value={themeDescription}
            onChange={(e) => {
              setThemeDescription(e.target.value);
              setErrors((prev) => ({ ...prev, themeDescription: null }));
            }}
            placeholder="Enter theme description"
          />
          {errors.themeDescription && (
            <span className="error">{errors.themeDescription}</span>
          )}
        <div className='code'>* Max length 200 characters.</div> 
        </div>

        <div className="image-upload-group">
          <h3>Upload Background and Thumbnail</h3>
          <p className="format-note">
            * Allowed image formats are JPG, JPEG, PNG
          </p>

          <div className="file-upload-container">
            {[
              { type: "thumbnail", label: "Thumbnail \n (200x300)" },
              { type: "logo", label: "Logo \n (400x300)" },
              { type: "desktopBg", label: "Desktop Background \n (1920x1080)" },
              { type: "mobileBg", label: "Mobile Background \n (414x896)" },
            ].map(({ type, label }) => (
              <div className="file-upload-wrapper" key={type}>
                <label>Upload {label}</label>
                <div
                  className="file-icon-container"
                  onClick={() => fileInputs.current[type].click()}
                >
                  {previews[type] ? (
                    <div className="preview-wrapper">
                      <img
                        src={previews[type]}
                        alt={`${label} preview`}
                        className="thumb-preview"
                      />
                      {/* <i className="fas fa-check-circle tickmark" /> */}
                    </div>
                  ) : (
                    <i className="fas fa-upload" />
                  )}
                </div>
                <input
                  ref={(el) => (fileInputs.current[type] = el)}
                  type="file"
                  accept="image/jpeg,image/png"
                  className="file-upload-input"
                  onChange={(e) => handleFileChange(type, e)}
                />
                {errors[type] && <span className="error">{errors[type]}</span>}
              </div>
            ))}
            {errors.files && <span className="error">{errors.files}</span>}
          </div>
        </div>

        {/* <div className="form-group per-question-container">
          <label>Score Per Question</label>
          <input
            type="number"
            min="1"
            value={scorePerQuestion}
            onChange={(e) => setScorePerQuestion(parseInt(e.target.value))}
          />
        </div>

        <div className="toggle-group">
          <div className="toggle-item">
            <label>Lifelines</label>
            <Switch
              checked={lifelinesEnabled}
              onChange={setLifelinesEnabled}
              onColor="#4caf50"
            />
          </div>

          <div className="toggle-item">
            <label>Shuffle Question</label>
            <Switch
              checked={shuffleEnable}
              onChange={setshuffleEnable}
              onColor="#4caf50"
            />
          </div>
        </div> */}

        {errors.api && <div className="api-error">{errors.api}</div>}

        <div className="modal-actions">
          <button className="cancel-btn" onClick={handleClose}>
            Cancel
          </button>
          <button className="save-btn" onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </>
  );
}

export default CreateTheme;
