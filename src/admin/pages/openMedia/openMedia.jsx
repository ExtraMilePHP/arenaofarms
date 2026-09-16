import React from 'react';
import './OpenMedia.css';

const OpenMedia = ({ mediaUrl, onClose }) => {
  const isVideo = /\.(mp4|webm|ogg)$/i.test(mediaUrl);
  const isAudio = /\.(mp3|wav|m4a|aac|ogg)$/i.test(mediaUrl);

  return (
    <div className="open-media-overlay">
      <div className="open-media-content">
        <button className="open-media-close" onClick={onClose}>×</button>
        <div className="open-media-body">
          {isVideo ? (
            <video src={mediaUrl} controls />
          ) : isAudio ? (
            <audio src={mediaUrl} controls />
          ) : (
            <img src={mediaUrl} alt="media" />
          )}
        </div>
      </div>
    </div>
  );
};

export default OpenMedia;
