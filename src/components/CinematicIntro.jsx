import React, { useEffect, useRef, useState } from "react";
import CinematicScene from "../three/CinematicScene";
import "./cinematicIntro.css";

/**
 * Full-screen "enters the arena" cinematic beat — dark 3D backdrop (three.js)
 * behind bold, pseudo-extruded title typography. Auto-advances after
 * `autoAdvanceMs`, or the viewer can tap/press any key to skip ahead.
 */
export default function CinematicIntro({
  eyebrow,
  title,
  subtitle,
  accentColor = "#ff4d4d",
  autoAdvanceMs = 2800,
  onDone,
}) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const doneRef = useRef(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    sceneRef.current = new CinematicScene(containerRef.current, { accentColor });
    return () => sceneRef.current?.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    sceneRef.current?.triggerImpact();
    setLeaving(true);
    setTimeout(() => onDone && onDone(), 420);
  };

  useEffect(() => {
    const t = setTimeout(finish, autoAdvanceMs);
    const onKey = () => finish();
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`aoa-cine ${leaving ? "aoa-cine-leaving" : ""}`}
      onPointerDown={finish}
      style={{ "--aoa-cine-accent": accentColor }}
    >
      <div className="aoa-cine-canvas" ref={containerRef} />
      <div className="aoa-cine-vignette" />
      <div className="aoa-cine-content">
        {eyebrow && <div className="aoa-cine-eyebrow">{eyebrow}</div>}
        <div className="aoa-cine-title">{title}</div>
        {subtitle && <div className="aoa-cine-subtitle">{subtitle}</div>}
      </div>
      <div className="aoa-cine-skip">Tap to continue</div>
    </div>
  );
}
