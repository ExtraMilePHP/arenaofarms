import React, { useRef, useState } from 'react';
import Swal from 'sweetalert2';
import Switch from 'react-switch';
import { useSelector } from 'react-redux';
import { selectAdminToken } from '../../sessionSlice';
import { selectTheme } from '../../themeSlice';
import './uploadCss.css';

export default function UploadIntro({ isOpen, onClose, organizationId, sessionId }) {
  const fileInputRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [introEnabled, setIntroEnabled] = useState(false);
  const adminToken = useSelector(selectAdminToken);
  const { availableThemes, currentTheme, status, data: themeData } = useSelector((state) => state.theme);
  
  // Initialize states from themeData
  React.useEffect(() => {
    if (themeData?.intro !== undefined) {
      setIntroEnabled(themeData.intro);
    }
  }, [themeData]);
  
  if (!isOpen) return null;

  // Get existing intro file from themeData
  const existingIntroFile = themeData?.introFile;
  
  // Helper function to get file extension
  const getFileExtension = (filename) => {
    return filename?.split('.').pop()?.toLowerCase();
  };

  // Helper function to determine file type
  const getFileType = (filename) => {
    const ext = getFileExtension(filename);
    if (['jpg', 'jpeg', 'png'].includes(ext)) return 'image';
    if (['mp4'].includes(ext)) return 'video';
    if (ext === 'pdf') return 'pdf';
    return 'unknown';
  };

  // Render existing file preview
  const renderFilePreview = () => {
    if (!existingIntroFile) return null;
    
    const fileType = getFileType(existingIntroFile);
    const s3BaseUrl = process.env.REACT_APP_S3_PATH;
    const fileUrl = `${s3BaseUrl}${existingIntroFile}`;
    
    return (
      <div className="file-preview">
        <h4>Current Intro File:</h4>
        {fileType === 'image' && (
          <img 
            src={fileUrl} 
            alt="Intro preview" 
            style={{ objectFit: 'contain' }}
          />
        )}
        {fileType === 'video' && (
          <video 
            controls 
          >
            <source src={fileUrl} type={`video/${getFileExtension(existingIntroFile)}`} />
            Your browser does not support the video tag.
          </video>
        )}
        {fileType === 'pdf' && (
          <div className="pdf-preview">
            <p>📄 PDF File: {existingIntroFile.split('-').pop()}</p>
            <a href={fileUrl} target="_blank" rel="noopener noreferrer">
              View PDF
            </a>
          </div>
        )}
        {/* <p className="file-name">{existingIntroFile}</p> */}
      </div>
    );
  };

  const handleFileChange = e => {
  const file = e.target.files[0];
  if (!file) return;
  
  const allowedTypes = [
    'image/jpeg',
    'image/jpg', 
    'image/png',
    'application/pdf',
    'video/mp4'
  ];
  
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.pdf', '.mp4'];
  
  const isValidType = allowedTypes.includes(file.type);
  const isValidExtension = allowedExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
  
  if (!isValidType && !isValidExtension) {
    Swal.fire('Invalid File', 'Please select a JPG, PNG, PDF, or video file.', 'error');
    e.target.value = null;
    setSelectedFile(null);
    return;
  }
  
  // File size validation
  const fileExtension = getFileExtension(file.name);
  const fileSizeMB = file.size / (1024 * 1024);
  
  if (['jpg', 'jpeg', 'png'].includes(fileExtension)) {
    if (fileSizeMB > 2) {
      Swal.fire('File Too Large', 'Image files must be under 2 MB.', 'error');
      e.target.value = null;
      setSelectedFile(null);
      return;
    }
  } else if (fileExtension === 'pdf') {
    if (fileSizeMB > 3) {
      Swal.fire('File Too Large', 'PDF files must be under 3 MB.', 'error');
      e.target.value = null;
      setSelectedFile(null);
      return;
    }
  } else if (['mp4'].includes(fileExtension)) {
    if (fileSizeMB > 20) {
      Swal.fire('File Too Large', 'Video files must be under 20 MB.', 'error');
      e.target.value = null;
      setSelectedFile(null);
      return;
    }
  }
  
  setSelectedFile(file);
};


  const handleUpload = async () => {
  const formData = new FormData();
  
  // Always send the intro enabled state
  formData.append('introEnabled', introEnabled.toString());
  formData.append('currentTheme', currentTheme);
  formData.append('organizationId', organizationId);
  formData.append('sessionId', sessionId);
  
  // Check if selected file is a video
    const isVideo = selectedFile && ['mp4'].includes(
      selectedFile.name.split('.').pop().toLowerCase()
    );

    // For videos, don't send the file data - just the metadata
    if (selectedFile && isVideo) {
      formData.append('videoFileName', selectedFile.name);
      formData.append('videoFileType', selectedFile.type);
      formData.append('videoFileSize', selectedFile.size);
    } else if (selectedFile && !isVideo) {
      // For non-videos, send the actual file
      formData.append('csv', selectedFile);
    }

  try {
    const res = await fetch(
      `${process.env.REACT_APP_BACKEND_URL}/uploadIntro`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`
        },
        body: formData
      }
    );

    if (!res.ok) throw new Error('Upload failed');
    
    const result = await res.json();
    
    // If it's a video, we got a presigned URL - upload directly to S3
    if (result.presignedUpload && isVideo) {
      try {
        const s3UploadResponse = await fetch(result.presignedUpload.uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': selectedFile.type,
            'x-amz-acl': 'public-read'
          },
          body: selectedFile
        });
        
        console.log("s3 upload status check..",s3UploadResponse);
        if (!s3UploadResponse.ok) {
          throw new Error('S3 upload failed');
        }
        
         window.location.reload();
         onClose();

        // Swal.fire('Success', 'Video uploaded successfully!', 'success');
      // Swal.fire({
      //     title: 'Processing Video...',
      //     text: 'Please wait while your video is being compressed.',
      //     allowOutsideClick: false,
      //     didOpen: () => {
      //       Swal.showLoading();
      //     }
      //   });
      //      console.log("game folder",process.env.REACT_APP_S3_GAME_FOLDER);
      //   try {
      //     const fullPath = result.presignedUpload.key;
      //     const fileNameOnly = fullPath.split('/').pop();
      //     const compressRes = await fetch(process.env.REACT_APP_S3_COMPRESSION, {
      //       method: "POST",
      //       headers: {
      //         "Content-Type": "application/json"
      //       },
      //       body: JSON.stringify({
      //         enviroment: process.env.REACT_APP_S3_ENVIRMOENT,
      //         game: process.env.REACT_APP_S3_GAME_FOLDER,
      //         filename: fileNameOnly
      //       })
      //     });

          
      //     if (!compressRes.ok) throw new Error("Compression API failed");
      //     const compressResult = await compressRes.json();

      //     Swal.fire('Success', 'Video uploaded & compressed successfully!', 'success');
      //   } catch (compressErr) {
      //     console.error('Compression error:', compressErr);
      //     Swal.fire('Error', 'Video uploaded but compression failed.', 'error');
      //   }
      } catch (s3Error) {
        console.error('S3 upload error:', s3Error);
        Swal.fire('Error', 'Failed to upload video to S3. Please try again.', 'error');
        return;
      }
    } else {
      // Regular success for non-video files or settings-only updates
      const successMessage = selectedFile 
        ? 'Settings and file updated successfully.' 
        : 'Intro settings updated successfully.';
      
      Swal.fire('Success', successMessage, 'success');

    }
    
    // window.location.reload();
    // onClose();
  } catch (err) {
    console.error(err);
    Swal.fire('Error', 'Failed to update settings. Please try again.', 'error');
  }
};

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="csv-modal">
        <h3>Intro Settings</h3>
        
        <div className="intro-switch-container">
          <label className="intro-switch-label">
            Enable Intro
            <Switch checked={introEnabled} onChange={setIntroEnabled} />
            {/* <Switch
              onChange={setIntroEnabled}
              checked={introEnabled}
              onColor="#86d3ff"
              onHandleColor="#2693e6"
              handleDiameter={28}
              uncheckedIcon={false}
              checkedIcon={false}
              boxShadow="0px 1px 5px rgba(0, 0, 0, 0.6)"
              activeBoxShadow="0px 0px 1px 10px rgba(0, 0, 0, 0.2)"
              height={20}
              width={48}
              className="react-switch"
              id="intro-switch"
            /> */}
          </label>
        </div>

        {introEnabled && (
          <>
            <div className="csv-form-group">
              <button
                className="csv-file-btn"
                onClick={() => fileInputRef.current.click()}
              >
                Choose File
              </button>
              <span className="csv-file-name">
                {selectedFile?.name || 'No file selected'}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.pdf,.mp4"
                className="csv-file-input"
                onChange={handleFileChange}
              />
            </div>
            
            {existingIntroFile && (
              <div className="existing-file-section">
                {renderFilePreview()}
              </div>
            )}
          </>
        )}
        
        {introEnabled && (
          <div className='code'>* Allowed File formats: JPG, PNG, PDF, Video (MP4)</div>
        )}
        
        <div className="csv-actions">
          <button className="csv-cancel-btn" onClick={onClose}>
            Cancel
          </button>
          <button 
            className="csv-upload-btn" 
            onClick={handleUpload}
          >
            Save Settings
          </button>
        </div>
      </div>
    </>
  );
}