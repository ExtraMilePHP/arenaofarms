import * as THREE from "three";
/** @typedef {import("./ArmWrestleRig").default} ArmWrestleRig */

/**
 * ArmWrestleController
 * --------------------
 * Reusable, framework-agnostic controller that turns "taps" into arm-wrestling
 * forearm motion on an {@link ArmWrestleRig}.
 *
 *   tap()            -> adds an impulse to `force`
 *   force            -> decays toward 0 over time (opponent pushing back)
 *   force            -> maps to a TARGET forearm angle
 *   update(dt)       -> smoothly interpolates the rendered angle toward target
 *                       and pushes it to the rig
 *
 * Sign / side:
 *   `side: "right"` (default) — your taps fold the clasp toward the opponent's
 *   (right) side; a negative net force folds it toward your (left) side.
 *   `side: "left"` mirrors that. This is the only handedness knob multiplayer
 *   PvP needs: run one controller per client with its own `side`.
 *
 * Multiplayer note: `setForce()` / `setTarget01()` let an authoritative netcode
 * value drive the arm directly, bypassing local tap accumulation — so the same
 * controller works for the local player (tap-driven) and the remote opponent
 * (state-driven).
 */
export default class ArmWrestleController {
  /**
   * @param {ArmWrestleRig} rig
   * @param {object} [cfg]
   * @param {"left"|"right"} [cfg.side="right"]     which way a positive force folds
   * @param {number} [cfg.maxAngle=Math.PI/2.2]     max forearm rotation (radians) each way
   * @param {number} [cfg.tapImpulse=0.12]          force added per tap (0..1 scale)
   * @param {number} [cfg.decayPerSecond=0.35]      how fast force bleeds back to 0
   * @param {number} [cfg.smoothing=10]             angle lerp rate (higher = snappier)
   * @param {number} [cfg.maxForce=1]               clamp for accumulated force
   * @param {number} [cfg.restToward=0]             force the arm eases to with no input (-1..1)
   */
  constructor(rig, cfg = {}) {
    this.rig = rig;
    this.cfg = {
      side: "right",
      maxAngle: Math.PI / 2.2,
      tapImpulse: 0.12,
      decayPerSecond: 0.35,
      smoothing: 10,
      maxForce: 1,
      restToward: 0,
      ...cfg,
    };

    this.force = 0; // -maxForce..maxForce  (signed tug-of-war value)
    this.targetAngle = 0; // radians
    this.angle = 0; // rendered radians (what the rig shows)
    this._sideSign = this.cfg.side === "left" ? -1 : 1;
    this._locked = false; // when true, tap() is ignored (round over)
  }

  /** Register a tap/click. `strength` scales the impulse (e.g. combo multiplier). */
  tap(strength = 1) {
    if (this._locked) return;
    this.force = THREE.MathUtils.clamp(
      this.force + this.cfg.tapImpulse * strength * this._sideSign,
      -this.cfg.maxForce,
      this.cfg.maxForce
    );
  }

  /** Directly set the signed force (-1..1), e.g. from netcode / an AI opponent. */
  setForce(f) {
    this.force = THREE.MathUtils.clamp(f, -this.cfg.maxForce, this.cfg.maxForce);
  }

  /** Drive the arm from a normalized position: 0 = your side pinned, 1 = their side pinned, 0.5 = center. */
  setTarget01(t) {
    const signed = (THREE.MathUtils.clamp(t, 0, 1) - 0.5) * 2;
    this.force = signed * this.cfg.maxForce;
  }

  /** 0 = your side pinned, 1 = opponent side pinned (handy for a HUD meter). */
  get position01() {
    return THREE.MathUtils.clamp(this.angle / this.cfg.maxAngle / 2 + 0.5, 0, 1);
  }

  /** True once the forearm has reached (near) full rotation either way. */
  get isPinned() {
    return Math.abs(this.angle) >= this.cfg.maxAngle * 0.985;
  }

  /** Lock further taps and optionally slam to a final side ("left"|"right"). */
  lock(toSide) {
    this._locked = true;
    if (toSide) {
      const sign = toSide === "left" ? -1 : 1;
      this.force = sign * this.cfg.maxForce;
    }
  }

  reset() {
    this.force = 0;
    this.targetAngle = 0;
    this.angle = 0;
    this._locked = false;
    this.rig.setForearmFold(0);
  }

  setMaxAngle(rad) {
    this.cfg.maxAngle = rad;
  }

  /**
   * Advance the simulation. Call once per frame.
   * @param {number} dt seconds since last frame
   */
  update(dt) {
    if (!this.rig?.loaded) return;

    // force decays toward its resting bias (0 by default) unless locked
    if (!this._locked) {
      const rest = this.cfg.restToward * this.cfg.maxForce;
      const k = 1 - Math.exp(-this.cfg.decayPerSecond * dt * 3);
      this.force += (rest - this.force) * k;
    }

    // force -> target angle (linear map, clamped to ±maxAngle)
    const f = THREE.MathUtils.clamp(this.force / this.cfg.maxForce, -1, 1);
    this.targetAngle = f * this.cfg.maxAngle;

    // smooth (frame-rate independent) interpolation of the rendered angle
    const s = 1 - Math.exp(-this.cfg.smoothing * dt);
    this.angle += (this.targetAngle - this.angle) * s;

    this.rig.setForearmFold(this.angle);
  }
}
