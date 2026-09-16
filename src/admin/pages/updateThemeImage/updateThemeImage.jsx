import React, { useRef, useState, useEffect } from "react";
import { useSelector } from "react-redux";
import Swal from "sweetalert2";
import "./updateThemeImages.css";
import { fetchThemeData, selectTheme } from "../../themeSlice";
import { selectAdminToken } from "../../sessionSlice";

// Define image fields once
const IMAGE_FIELDS = [
  { key: "themeImage", label: "Thumbnail Image (200x300)", dimensions: [200, 300] },
  { key: "logo", label: "Logo Image (400,300)", dimensions: [400, 300] },
  {
    key: "background_desk",
    label: "Desktop Background Image (1920x1080)",
    dimensions: [1920, 1080],
  },
  { key: "background_mob", label: "Mobile Background (414x896)", dimensions: [414, 896] },
];

const VALID_EXT = ["jpg", "jpeg", "png"];
const MAX_SIZE_MB = 5;

function UpdateThemeImages({ isOpen, onClose }) {
  // Pull theme state from Redux
  const { currentTheme, data: themeData } = useSelector((state) => state.theme);
  const adminToken = useSelector(selectAdminToken);
  const [themeName, setThemeName] = useState("");
  const [errors, setErrors] = useState({});
  const [themeDescription, setThemeDescription] = useState("");
  
  console.log(currentTheme);

  // Local state for files and previews
  const [files, setFiles] = useState(
    IMAGE_FIELDS.reduce((acc, { key }) => ({ ...acc, [key]: null }), {})
  );
  const [previews, setPreviews] = useState(
    IMAGE_FIELDS.reduce((acc, { key }) => ({ ...acc, [key]: null }), {})
  );
  const fileInputs = useRef({});

  // Initialize previews when opening
  useEffect(() => {
    if (isOpen && themeData) {
      const initial = {};
      IMAGE_FIELDS.forEach(({ key }) => {
        const url = themeData[key]
          ? process.env.REACT_APP_S3_PATH + themeData[key]
          : null;
        initial[key] = url;
      });
      setPreviews(initial);
      setFiles(
        IMAGE_FIELDS.reduce((acc, { key }) => ({ ...acc, [key]: null }), {})
      );
      setThemeName(themeData.themeName);
      setThemeDescription(themeData.themeDescription)
    }
  }, [isOpen, themeData]);

  if (!isOpen) return null;

  // Helper: get image dimensions
  const getImageDimensions = (file) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.width, height: img.height });
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });

  // Validate file against ext, size, dims
  const validateImage = async (file, { dimensions }) => {
    const ext = file.name.split(".").pop().toLowerCase();
    if (!VALID_EXT.includes(ext))
      return `Only ${VALID_EXT.join(", ")} formats allowed`;
    if (file.size > MAX_SIZE_MB * 1024 * 1024)
      return `File size exceeds ${MAX_SIZE_MB}MB limit`;
    try {
      const { width, height } = await getImageDimensions(file);
      const [reqW, reqH] = dimensions;
      if (width !== reqW || height !== reqH) {
        return `Image must be ${reqW}×${reqH}px`;
      }
    } catch {
      return "Failed to validate image dimensions";
    }
    return null;
  };

  const handleFileChange = async (field, e) => {
    const file = e.target.files[0];
    if (!file) return;
    const error = await validateImage(file, field);
    if (error) {
      await Swal.fire({ title: "Invalid Image", text: error, icon: "error" });
      e.target.value = "";
      setFiles((prev) => ({ ...prev, [field.key]: null }));
      return;
    }
    setFiles((prev) => ({ ...prev, [field.key]: file }));
    setPreviews((prev) => ({
      ...prev,
      [field.key]: URL.createObjectURL(file),
    }));
  };

  const handleUpdate = async () => {
  // require at least one file selected
  // if (!Object.values(files).some(f => f)) {
  //   await Swal.fire({
  //     title: "Error",
  //     text: "Select at least one image to update",
  //     icon: "error",
  //   });
  //   return;
  // }


  const extraData = {
      themeName,
      themeDescription
    };

  // build FormData with only the chosen files
  const formData = new FormData();
  formData.append("themeName", currentTheme);
  formData.append("extraData", JSON.stringify(extraData));
  IMAGE_FIELDS.forEach(({ key }) => {
    if (files[key]) {
      formData.append(key, files[key]);
    }
  });

  try {
    const res = await fetch(
      `${process.env.REACT_APP_BACKEND_URL}/updateThemeMedia`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
        body: formData,
      }
    );
    if (!res.ok) throw new Error();
    await Swal.fire({
      title: "Success",
      text: "Images updated",
      icon: "success",
    });
    setTimeout(function(){
      window.location.reload();
    });
    onClose();
  } catch {
    await Swal.fire({
      title: "Error",
      text: "Failed to update images",
      icon: "error",
    });
  }
};

  return (
    <>
      <div className="ut-modal-backdrop" onClick={onClose} />
      <div className="ut-modal">
        <h2 className="ut-title">Update Theme</h2>
        <p className="ut-theme-name">{themeData.themeName}</p>
        <div className="form-group">
          <label>Theme Name</label>
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
              setErrors((prev) => ({ ...prev, themeName: null }));
            }}
            placeholder="Enter theme name"
          />
          {errors.themeName && (
            <span className="error">{errors.themeName}</span>
          )}
          <div className='code'>* Max length 150 characters.</div> 
        </div>
        <div className="ut-image-upload-group">
          <div className="ut-file-upload-container">
            {IMAGE_FIELDS.map((field) => (
              <div className="ut-file-upload-wrapper" key={field.key}>
                <label className="ut-label">{field.label}</label>
                <div
                  className="ut-file-icon-container"
                  onClick={() => fileInputs.current[field.key].click()}
                >
                  {previews[field.key] ? (
                    <img
                      src={previews[field.key]}
                      alt={`${field.label} preview`}
                      className="ut-thumb-preview"
                    />
                  ) : (
                    <i className="fas fa-upload ut-file-icon" />
                  )}
                </div>
                <input
                  ref={(el) => (fileInputs.current[field.key] = el)}
                  type="file"
                  accept="image/jpeg,image/png"
                  className="ut-file-upload-input"
                  onChange={(e) => handleFileChange(field, e)}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="ut-modal-actions">
          <button className="ut-cancel-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="ut-update-btn" onClick={handleUpdate}>
            Update
          </button>
        </div>
      </div>
    </>
  );
}

export default UpdateThemeImages;
