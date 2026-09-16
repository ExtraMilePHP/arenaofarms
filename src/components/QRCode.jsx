import React from "react";

/** Lightweight QR code image — no extra bundle weight, renders via a public QR image API. */
export default function QRCode({ value, size = 168 }) {
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${encodeURIComponent(
    value
  )}`;
  return (
    <img
      className="aoa-qr"
      src={src}
      width={size}
      height={size}
      alt="Scan to join lobby"
      loading="lazy"
    />
  );
}
