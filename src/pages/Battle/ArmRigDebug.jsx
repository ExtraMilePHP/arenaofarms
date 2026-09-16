import React, { useEffect, useRef } from "react";
import ArmRigDebugScene from "../../three/armRig/ArmRigDebugScene";

/**
 * TEMPORARY debug route — /arena/armdebug
 *
 * Mounts the rigged-arm inspector scene: loads riggedarm.glb (unmodified),
 * logs the skeleton + bone->body mapping to the console, and shows a slider
 * panel for verifying the arm-wrestling forearm fold and per-bone rotations.
 *
 * Remove this file + its <Route> in src/index.js once the rig is verified.
 */
export default function ArmRigDebug() {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    const scene = new ArmRigDebugScene(ref.current);
    return () => scene.dispose();
  }, []);

  return (
    <div
      ref={ref}
      style={{ position: "fixed", inset: 0, background: "#0d1017" }}
    />
  );
}
