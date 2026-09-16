import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * ArmWrestleRig
 * -------------
 * Thin, reusable wrapper around the rigged-arm GLB (`public/models/riggedarm.glb`,
 * Blender auto-rig "UniRigArmature", 14 bones, no baked clips).
 *
 * The GLB is a pair of CLASPED forearms. Its bone chain is rooted at the clasp
 * and runs OUTWARD to each shoulder:
 *
 *   Bone_001 (clasp / wrists hub)
 *     ├─ Bone_007  L wrist/hand   ─ Bone_006  L forearm ─ Bone_005  L ELBOW ─ Bone_004  L upper arm ─ Bone_003  L shoulder ─ Bone_002 (tip)
 *     └─ Bone_013  R wrist/hand   ─ Bone_012  R forearm ─ Bone_011  R ELBOW ─ Bone_010  R upper arm ─ Bone_009  R shoulder ─ Bone_008 (tip)
 *
 * (Mapping verified from rest-pose world positions AND per-bone skin-weight
 * centroids — see skeletonInspector.js — not from bone names.)
 *
 * Because the chain is rooted at the clasp, no single bone's local rotation can
 * "fold the forearm while keeping the elbow planted": the elbow bones are
 * DOWNSTREAM of the forearm. So `setForearmFold()` does it geometrically:
 *
 *   1. Rotate the clasp hub (Bone_001) by `angle` about the world-space line
 *      through both elbows (elbow-line axis), composed on its world matrix so
 *      the pivot is the elbow midpoint — not the bone's own head.
 *   2. Re-pin each elbow bone (Bone_005 / Bone_011) to its exact bind world
 *      matrix, which freezes the elbow position AND everything below it
 *      (upper arm + shoulder stay put).
 *
 * Net result: elbows fixed, upper arms fixed, forearms + wrists + clasped hands
 * swing together about the elbow line — the arm-wrestling motion.
 *
 * Does NOT modify the GLB file. Does NOT add itself to a scene — call `.group`.
 */

const DEFAULT_URL = `${process.env.PUBLIC_URL || ""}/models/riggedarm.glb`;

export const ARM_BONES = {
  claspHub: "Bone_001",
  left: {
    hand: "Bone_007",
    forearm: "Bone_006",
    elbow: "Bone_005",
    upperArm: "Bone_004",
    shoulder: "Bone_003",
    tip: "Bone_002",
  },
  right: {
    hand: "Bone_013",
    forearm: "Bone_012",
    elbow: "Bone_011",
    upperArm: "Bone_010",
    shoulder: "Bone_009",
    tip: "Bone_008",
  },
  root: "Bone_000",
};

/**
 * Bones that must stay RIGID with the clasp and are never articulated — the
 * hands, wrists, and BOTH FOREARMS. Everything from the clasped fists down to
 * (but not including) the elbow rotates as ONE solid block about the elbow
 * line. Leaving the forearm bones (Bone_006 / Bone_012) out of this set was
 * the "melted wrist/fingers" bug: the hub rotated them, then the elbow bones
 * below got re-pinned to bind, shearing the skin across the whole forearm and
 * smearing the clasp geometry. With the forearms rigid, the only skin
 * deformation left is right at the elbow joint (Bone_006 -> Bone_005), which
 * is where an elbow is meant to bend and sits near the model's hidden edge.
 */
export const RIGID_CLASP_BONES = [
  "Bone_000",
  "Bone_007",
  "Bone_013",
  "Bone_006",
  "Bone_012",
];

/** The only bones setForearmFold() ever writes a local transform to. */
export const DRIVEN_BONES = ["Bone_001", "Bone_005", "Bone_011"];

/**
 * Sign for the two-bone rig's fold about the elbow line. + should fold the
 * clasp toward -Z (camera / front), matching the 14-bone rig's convention.
 * Flip if a re-export inverts the arm's forward axis.
 */
const TWO_BONE_FOLD_SIGN = -1;

export default class ArmWrestleRig {
  constructor() {
    /** @type {THREE.Group} add this to your scene */
    this.group = new THREE.Group();
    this.group.name = "ArmWrestleRig";

    this.model = null;
    this.skinnedMesh = null;
    this.skeleton = null;
    /** @type {Record<string, THREE.Bone>} */
    this.bones = {};
    this.animations = [];
    this.loaded = false;
    this._onLoad = [];

    // bind-pose snapshots used by setForearmFold()
    this._bind = null;

    // Keep the clasp rigid while allowing the arm-wrestling range. ~64° is the
    // working cap: short of the angle where the forearm->elbow seam shears
    // ("melted fists"). The fists don't reach the table at this angle on their
    // own -- ArmWrestleScene lowers the whole planted arm (_pinDrop) for the
    // final table contact. Callers tune this via setMaxFold().
    this.maxFold = Math.PI / 2.8;

    // current fold state (radians), applied every frame via _applyFold()
    this._fold = 0;
  }

  /** @param {string} [url] @returns {Promise<ArmWrestleRig>} */
  load(url = DEFAULT_URL) {
    return new Promise((resolve, reject) => {
      new GLTFLoader().load(
        url,
        (gltf) => {
          this._ingest(gltf);
          resolve(this);
          this._onLoad.forEach((fn) => fn(this));
          this._onLoad.length = 0;
        },
        undefined,
        reject
      );
    });
  }

  /** register a callback for when loading finishes (or fires now if already loaded) */
  onLoad(fn) {
    if (this.loaded) fn(this);
    else this._onLoad.push(fn);
    return this;
  }

  _ingest(gltf) {
    this.model = gltf.scene;
    this.animations = gltf.animations || [];

    this.model.traverse((o) => {
      if (o.isSkinnedMesh && !this.skinnedMesh) this.skinnedMesh = o;
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false; // clasp can swing outside the original bounds
      }
    });
    if (!this.skinnedMesh) throw new Error("ArmWrestleRig: GLB has no SkinnedMesh");

    this.skeleton = this.skinnedMesh.skeleton;
    this.skeleton.bones.forEach((b) => (this.bones[b.name] = b));

    // The arm GLB has shipped in several rigs over the project's history:
    //   • a multi-bone clasp chain (clasp hub at the top, each arm running
    //     out+down to the elbow then up to the shoulder) — geometric hub fold
    //   • a 2-bone rig (Elbow_L / Elbow_R) — rigid per-elbow bend
    // _detectKeyBones() finds the hub + both elbows by geometry (bone names
    // have been renumbered between exports); if it can't, fall back to a
    // 2-bone bend.
    this._keyBones = this._detectKeyBones();
    this._twoBone = !this._keyBones;

    this.group.add(this.model);
    if (this._twoBone) {
      this._snapshotBindTwoBone();
    } else {
      this._rigidifyHandSkinWeights();
      this._snapshotBind();
    }
    this.loaded = true;
  }

  /**
   * Bind snapshot for the 2-bone rig (Elbow_L / Elbow_R). Each bone's HEAD is
   * the elbow joint and its skinned region is that arm's forearm + fist, so the
   * fold is applied as a LOCAL rotation of each elbow bone about its own head —
   * the forearm bends AT THE ELBOW, the elbow itself stays put. Both bones turn
   * by the same angle about the shared elbow-line direction, so the clasped
   * fists stay together.
   */
  _snapshotBindTwoBone() {
    let bL = this.bones.Elbow_L || this.bones.elbow_L || null;
    let bR = this.bones.Elbow_R || this.bones.elbow_R || null;
    if (!bL || !bR) {
      const byX = [...this.skeleton.bones].sort(
        (a, c) =>
          a.getWorldPosition(new THREE.Vector3()).x -
          c.getWorldPosition(new THREE.Vector3()).x
      );
      bL = byX[0];
      bR = byX[byX.length - 1];
    }

    this.skeleton.pose();
    this.model.updateMatrixWorld(true);

    const mInv = new THREE.Matrix4().copy(this.model.matrixWorld).invert();
    const toModel = (m) => new THREE.Matrix4().multiplyMatrices(mInv, m);

    const bLModel = toModel(bL.matrixWorld);
    const bRModel = toModel(bR.matrixWorld);
    const pL = new THREE.Vector3().setFromMatrixPosition(bLModel);
    const pR = new THREE.Vector3().setFromMatrixPosition(bRModel);

    // Elbow-line direction (model space, L->R) and the same direction expressed
    // in EACH bone's own local frame -- the axis its forearm bends around.
    const axisModel = pR.clone().sub(pL).normalize();
    const localAxis = [bL, bR].map((bone) => {
      const q = new THREE.Quaternion();
      bone.getWorldQuaternion(q); // bind orientation
      const mRot = new THREE.Quaternion().setFromRotationMatrix(this.model.matrixWorld);
      // world axis = mRot * axisModel ; local axis = q^-1 * worldAxis
      const worldAxis = axisModel.clone().applyQuaternion(mRot);
      return worldAxis.applyQuaternion(q.clone().invert()).normalize();
    });
    const bindQuat = [bL.quaternion.clone(), bR.quaternion.clone()];

    // Clasp-tracking proxy: a child of the left elbow bone sitting at the
    // clasped-fist point, so ArmWrestleScene's fist/burst tracking (which asks
    // for the "hand" bone) follows the fold. Placed near the top-centre of the
    // mesh's own bounds.
    const geom = this.skinnedMesh.geometry;
    geom.computeBoundingBox();
    const bb = geom.boundingBox;
    const claspModel = new THREE.Vector3(
      (bb.min.x + bb.max.x) / 2,
      bb.min.y + (bb.max.y - bb.min.y) * 0.88,
      (bb.min.z + bb.max.z) / 2
    );
    const clasp = new THREE.Object3D();
    clasp.name = "ClaspProxy";
    clasp.position.copy(
      claspModel.clone().applyMatrix4(bLModel.clone().invert())
    );
    bL.add(clasp);

    this._bind = {
      mode: "twoBone",
      bones: [bL, bR],
      boneRest: [trs(bL), trs(bR)],
      bindQuat, // per-bone rest local quaternion
      localAxis, // per-bone elbow-bend axis, in that bone's local frame
      axis: axisModel, // elbow-line, L->R (model space) -- for getElbowLine()
      pivot: pL.clone().add(pR).multiplyScalar(0.5),
      elbowSpan: pR.distanceTo(pL),
      clasp,
    };
  }

  /**
   * Find the clasp hub + the two ELBOW bones from geometry, not bone names —
   * the arm GLB has been re-exported repeatedly with the bones renumbered.
   *
   *  • elbows  = the lowest-Y bone on each side of x=0 (the elbow is the
   *              bottom of each arm's clasp→shoulder chain)
   *  • hub     = the lowest common ancestor of the two elbow bones (the fork
   *              where the clasp splits into the two arms)
   *
   * Returns `null` if the skeleton doesn't look like the clasped-arms rig, in
   * which case the caller falls back to ARM_BONES.
   */
  _detectKeyBones() {
    const bones = this.skeleton.bones;
    if (bones.length < 4) return null;

    const bindPos = new Map(
      bones.map((b, i) => [
        b,
        new THREE.Vector3().setFromMatrixPosition(
          new THREE.Matrix4().copy(this.skeleton.boneInverses[i]).invert()
        ),
      ])
    );
    const left = bones.filter((b) => bindPos.get(b).x < -0.05);
    const right = bones.filter((b) => bindPos.get(b).x > 0.05);
    if (!left.length || !right.length) return null;

    const lowest = (arr) =>
      arr.reduce((m, b) => (bindPos.get(b).y < bindPos.get(m).y ? b : m));
    const elbowL = lowest(left);
    const elbowR = lowest(right);

    const isBone = (o) => !!o && (o.isBone || o.type === "Bone");
    const ancestors = new Set();
    for (let c = elbowL; isBone(c); c = c.parent) ancestors.add(c);
    let hub = null;
    for (let c = elbowR; isBone(c); c = c.parent) {
      if (ancestors.has(c)) { hub = c; break; }
    }
    if (!hub || hub === elbowL || hub === elbowR) return null;

    return { hub, elbowL, elbowR };
  }

  /**
   * The exported mesh has a few wrist/finger vertices blended with the elbow
   * bones. Re-pin those influences to the rigid clasp side of the joint so the
   * elbow can move without shearing the hand or fingers.
   */
  _rigidifyHandSkinWeights() {
    const indices = this.skinnedMesh?.geometry?.getAttribute("skinIndex");
    const weights = this.skinnedMesh?.geometry?.getAttribute("skinWeight");
    if (!indices || !weights) return;

    const boneIndex = new Map(this.skeleton.bones.map((bone, index) => [bone, index]));
    const keys = this._keyBones || {};
    const elbowIndices = new Set(
      [keys.elbowL, keys.elbowR]
        .filter(Boolean)
        .map((bone) => boneIndex.get(bone))
    );
    // "hand" side = the rigid clasp block: the hub and every bone between it and
    // the elbows (i.e. the hub subtree minus each elbow and its descendants).
    const handBones = new Set();
    if (keys.hub) {
      const elbowSubtrees = new Set();
      [keys.elbowL, keys.elbowR].filter(Boolean).forEach((e) =>
        e.traverse((b) => elbowSubtrees.add(b))
      );
      keys.hub.traverse((b) => {
        if (!elbowSubtrees.has(b)) handBones.add(b);
      });
    }

    const handIndices = new Set(
      Array.from(handBones)
        .map((bone) => boneIndex.get(bone))
        .filter((index) => index !== undefined)
    );

    for (let vertex = 0; vertex < indices.count; vertex += 1) {
      const vertexBones = [
        indices.getX(vertex),
        indices.getY(vertex),
        indices.getZ(vertex),
        indices.getW(vertex),
      ];
      const vertexWeights = [
        weights.getX(vertex),
        weights.getY(vertex),
        weights.getZ(vertex),
        weights.getW(vertex),
      ];
      const handWeight = vertexBones.reduce(
        (sum, bone, slot) => sum + (handIndices.has(bone) ? vertexWeights[slot] : 0),
        0
      );
      if (handWeight < 0.05) continue;

      const allowed = vertexBones.map((bone, slot) => (
        elbowIndices.has(bone) ? 0 : vertexWeights[slot]
      ));
      const total = allowed.reduce((sum, weight) => sum + weight, 0);
      if (total > 0) {
        allowed.forEach((weight, slot) => {
          weights.setComponent(vertex, slot, weight / total);
        });
        continue;
      }

      const handSlots = vertexBones
        .map((bone, slot) => (handIndices.has(bone) ? slot : -1))
        .filter((slot) => slot >= 0);
      const dominant = handSlots.length
        ? handSlots.reduce((best, slot) => (
          vertexWeights[slot] > vertexWeights[best] ? slot : best
        ), handSlots[0])
        : vertexWeights.indexOf(Math.max(...vertexWeights));
      allowed[dominant] = 1;
      allowed.forEach((weight, slot) => weights.setComponent(vertex, slot, weight));
    }
    weights.needsUpdate = true;
  }

  /**
   * Capture everything setForearmFold() needs from the untouched bind pose,
   * expressed in the ARMATURE's own space (`this.model`) — NOT world — so the
   * math stays correct after the caller scales / repositions `this.group`.
   */
  _snapshotBind() {
    const k = this._keyBones || {};
    const hub = k.hub || this.bones[ARM_BONES.claspHub];
    const elbowL = k.elbowL || this.bones[ARM_BONES.left.elbow];
    const elbowR = k.elbowR || this.bones[ARM_BONES.right.elbow];

    this.skeleton.pose();
    this.model.updateMatrixWorld(true);

    const mInv = new THREE.Matrix4().copy(this.model.matrixWorld).invert();
    const toModel = (m) => new THREE.Matrix4().multiplyMatrices(mInv, m);

    const hubModel = toModel(hub.matrixWorld);
    const elbowLModel = toModel(elbowL.matrixWorld);
    const elbowRModel = toModel(elbowR.matrixWorld);

    const pL = new THREE.Vector3().setFromMatrixPosition(elbowLModel);
    const pR = new THREE.Vector3().setFromMatrixPosition(elbowRModel);

    // Freeze every authored local transform except the clasp hub and elbows.
    // This also covers unnamed finger/knuckle bones and prevents any imported
    // IK, animation, or procedural pass from changing the hand shape.
    const driven = new Set([hub, elbowL, elbowR]);
    const rigidBones = new Set(
      this.skeleton.bones.filter((bone) => !driven.has(bone))
    );

    this._bind = {
      hub,
      elbowL,
      elbowR,
      axis: pR.clone().sub(pL).normalize(), // elbow-line (model space), L->R
      pivot: pL.clone().add(pR).multiplyScalar(0.5), // elbow midpoint (model space)
      hubModel,
      hubParentModel: toModel(hub.parent.matrixWorld), // fixed (hub's ancestors never move)
      elbowLModel,
      elbowRModel,
      hubRest: trs(hub),
      elbowLRest: trs(elbowL),
      elbowRRest: trs(elbowR),
      elbowSpan: pR.distanceTo(pL),
      // bind LOCAL transforms of the rigid-clasp bones — reasserted after every
      // fold so hands/wrists/fingers can never drift or bend.
      rigidRest: Array.from(rigidBones).map((b) => ({ bone: b, rest: trs(b) })),
    };
  }

  /** Force the hands/wrists/knuckles back to their exact bind local transform. */
  _enforceRigidClasp() {
    this._bind?.rigidRest.forEach(({ bone, rest }) => applyTRS(bone, rest));
  }

  /** Elbow-line info in `this.model`'s local space (after load). */
  getElbowLine() {
    if (!this._bind) return null;
    return {
      axis: this._bind.axis.clone(),
      pivot: this._bind.pivot.clone(),
      span: this._bind.elbowSpan,
      space: this.model, // multiply by this.model.matrixWorld for world space
    };
  }

  /**
   * Fold the clasped forearms about the elbow line.
   * @param {number} angle radians. + folds the clasp toward -Z (camera/front),
   *                        - folds it toward +Z (back). 0 = rest.
   */
  setForearmFold(angle) {
    this._fold = THREE.MathUtils.clamp(angle, -this.maxFold, this.maxFold);
    this._applyFold();
  }

  setMaxFold(rad) {
    this.maxFold = Math.abs(rad) || this.maxFold;
    this.setForearmFold(this._fold);
  }

  getForearmFold() {
    return this._fold;
  }

  /** Restore the exact bind pose. */
  resetPose() {
    this._fold = 0;
    if (!this._bind) return;
    if (this._bind.mode === "twoBone") {
      this._bind.bones.forEach((bone, i) => applyTRS(bone, this._bind.boneRest[i]));
      this.model.updateMatrixWorld(true);
      return;
    }
    applyTRS(this._bind.hub, this._bind.hubRest);
    applyTRS(this._bind.elbowL, this._bind.elbowLRest);
    applyTRS(this._bind.elbowR, this._bind.elbowRRest);
    this._enforceRigidClasp();
    this.model.updateMatrixWorld(true);
  }

  _applyFold() {
    const b = this._bind;
    if (!b) return;

    if (b.mode === "twoBone") {
      this._applyFoldTwoBone(b);
      return;
    }

    // R (in model space) = translate(pivot) * rotate(axis, angle) * translate(-pivot)
    const R = new THREE.Matrix4()
      .makeTranslation(b.pivot.x, b.pivot.y, b.pivot.z)
      .multiply(new THREE.Matrix4().makeRotationAxis(b.axis, this._fold))
      .multiply(new THREE.Matrix4().makeTranslation(-b.pivot.x, -b.pivot.y, -b.pivot.z));

    // 1) clasp hub: desired model-space matrix = R * bindModel, back to local.
    const hubTarget = R.clone().multiply(b.hubModel);
    const hubLocal = _inv.copy(b.hubParentModel).invert().multiply(hubTarget);
    hubLocal.decompose(b.hub.position, b.hub.quaternion, b.hub.scale);

    // 2) the clasp block (hands + wrists + BOTH forearms) is rigid — reassert
    //    its bind LOCAL transforms so the hub's rotation carries it as one
    //    solid piece with zero internal shear. Must happen BEFORE the elbow
    //    re-pin below, since that re-pin is relative to the forearm parents.
    this._enforceRigidClasp();

    // propagate so the elbow bones' parents (the now-rotated forearms) update
    this.model.updateMatrixWorld(true);
    const mInv = _mInv.copy(this.model.matrixWorld).invert();

    // 3) re-pin each elbow bone to its BIND model-space matrix -> elbow +
    //    upper arm + shoulder all frozen exactly where the rig authored them.
    //    All the fold's skin deformation is now concentrated at this one
    //    joint (forearm -> elbow), which is what a real elbow does.
    pinBoneToModel(b.elbowL, b.elbowLModel, mInv);
    pinBoneToModel(b.elbowR, b.elbowRModel, mInv);

    b.elbowL.updateMatrixWorld(true);
    b.elbowR.updateMatrixWorld(true);

    // 4) final belt-and-braces: reassert the rigid clasp LOCAL transforms one
    //    more time. The elbow re-pin above only writes to Bone_005/011, but
    //    this guarantees the hands/wrists/fingers/forearms can never end a
    //    frame in anything but their exact bind local pose, at any fold angle.
    this._enforceRigidClasp();
  }

  /**
   * Bend each forearm about its own elbow: local rotation of each elbow bone
   * around the elbow-line axis (in that bone's frame), composed onto its rest
   * orientation. The bone head (the elbow) does not move.
   */
  _applyFoldTwoBone(b) {
    const angle = this._fold * TWO_BONE_FOLD_SIGN;
    b.bones.forEach((bone, i) => {
      const q = new THREE.Quaternion().setFromAxisAngle(b.localAxis[i], angle);
      bone.quaternion.copy(b.bindQuat[i]).multiply(q);
    });
    this.model.updateMatrixWorld(true);
  }

  /**
   * Directly set one bone's local Euler rotation — for the debug panel only.
   * Refuses the rigid-clasp bones (hands/wrists/knuckles) so they can never be
   * bent into a weird pose.
   * @param {string} name @param {'x'|'y'|'z'} axis @param {number} rad
   * @returns {boolean} whether it was applied
   */
  setBoneEuler(name, axis, rad) {
    if (RIGID_CLASP_BONES.includes(name)) {
      console.warn(`[ArmWrestleRig] "${name}" is a rigid-clasp bone — not articulating it.`);
      return false;
    }
    const bone = this.bones[name];
    if (bone) bone.rotation[axis] = rad;
    return !!bone;
  }

  getBone(name) {
    if (this._bind?.mode === "twoBone") {
      if (name === ARM_BONES.left.elbow) return this._bind.bones[0];
      if (name === ARM_BONES.right.elbow) return this._bind.bones[1];
      // hand / wrist / clasp-hub lookups all track the clasped fists
      if (
        name === ARM_BONES.left.hand ||
        name === ARM_BONES.right.hand ||
        name === ARM_BONES.claspHub
      ) {
        return this._bind.clasp;
      }
    }
    // Multi-bone rig: fist/burst tracking asks for a "hand" bone. The bone
    // names drift between exports, so route hand/clasp lookups to the detected
    // clasp hub (the clasped fists) and elbow lookups to the detected elbows.
    if (this._keyBones && !this._twoBone) {
      if (name === ARM_BONES.left.elbow) return this._keyBones.elbowL;
      if (name === ARM_BONES.right.elbow) return this._keyBones.elbowR;
      if (
        name === ARM_BONES.left.hand ||
        name === ARM_BONES.right.hand ||
        name === ARM_BONES.claspHub
      ) {
        return this._keyBones.hub;
      }
    }
    return this.bones[name] || null;
  }

  dispose() {
    this.skinnedMesh?.geometry?.dispose();
    const mats = this.skinnedMesh
      ? Array.isArray(this.skinnedMesh.material)
        ? this.skinnedMesh.material
        : [this.skinnedMesh.material]
      : [];
    mats.forEach((m) => {
      m.map?.dispose();
      m.normalMap?.dispose();
      m.roughnessMap?.dispose();
      m.metalnessMap?.dispose();
      m.dispose();
    });
    this.group.parent?.remove(this.group);
  }
}

// ---- helpers ----------------------------------------------------------------

function trs(obj) {
  return {
    position: obj.position.clone(),
    quaternion: obj.quaternion.clone(),
    scale: obj.scale.clone(),
  };
}
function applyTRS(obj, t) {
  obj.position.copy(t.position);
  obj.quaternion.copy(t.quaternion);
  obj.scale.copy(t.scale);
}

/**
 * Force `bone` so its matrix in `model` space equals `targetModel`.
 * @param {THREE.Bone} bone
 * @param {THREE.Matrix4} targetModel   desired bone matrix, in model space
 * @param {THREE.Matrix4} modelInv      inverse of model.matrixWorld (current)
 */
const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _mInv = new THREE.Matrix4();
function pinBoneToModel(bone, targetModel, modelInv) {
  // parent matrix in model space = modelInv * parent.matrixWorld
  const parentModel = _m.copy(modelInv).multiply(bone.parent.matrixWorld);
  const local = parentModel.invert().multiply(targetModel);
  local.decompose(bone.position, bone.quaternion, bone.scale);
}
