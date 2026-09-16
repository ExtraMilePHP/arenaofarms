import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import ArmWrestleRig, { ARM_BONES } from "./ArmWrestleRig";
import ArmWrestleController from "./ArmWrestleController";
import { inspectSkeleton } from "./skeletonInspector";
import DebugPanel from "./DebugPanel";

/**
 * TEMPORARY debug scene for verifying the rigged-arm GLB.
 *
 *  - loads the GLB with GLTFLoader (unmodified)
 *  - logs the full skeleton hierarchy + all 14 bones + skin-weight body mapping
 *  - draws SkeletonHelper + an explicit ELBOW-LINE axis (the fixed pivot)
 *  - slider panel:
 *      • "Forearm fold about elbow line" — the real arm-wrestling motion
 *        (elbows + upper arms stay frozen; verify visually)
 *      • per-bone X/Y/Z rotation sliders for the candidate arm bones,
 *        Bone_004 / Bone_005 / Bone_010 / Bone_011 first
 *      • a live ArmWrestleController demo driven by a TAP button
 *
 * Route it at /arena/armdebug (see src/pages/Battle/ArmRigDebug.jsx). Delete the
 * route + this file once the rig is confirmed — nothing else imports it.
 */
export default class ArmRigDebugScene {
  constructor(container) {
    this.container = container;
    this.w = container.clientWidth || window.innerWidth;
    this.h = container.clientHeight || window.innerHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1017);

    this.camera = new THREE.PerspectiveCamera(45, this.w / this.h, 0.01, 100);
    this.camera.position.set(0, 1.4, 4.2);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(this.w, this.h);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.0, 0);

    // lighting
    this.scene.add(new THREE.HemisphereLight(0xbcd6ff, 0x202832, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2, 4, 3);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.8);
    fill.position.set(-3, 2, -2);
    this.scene.add(fill);
    this.scene.add(new THREE.GridHelper(6, 12, 0x334, 0x223));

    this.clock = new THREE.Clock();
    this.rig = new ArmWrestleRig();
    this.controller = null;
    this.panel = null;
    this._raf = null;
    this._useController = false;

    this._onResize = this._onResize.bind(this);
    window.addEventListener("resize", this._onResize);

    this.rig.load().then(() => this._onRigReady()).catch((e) => {
      console.error("[ArmRigDebugScene] failed to load riggedarm.glb", e);
    });

    this._animate();
  }

  _onRigReady() {
    // fit + center the model
    const box = new THREE.Box3().setFromObject(this.rig.model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = 2.6 / (size.x || 1);
    this.rig.group.scale.setScalar(s);
    this.rig.group.position.set(-center.x * s, -box.min.y * s, -center.z * s);
    this.scene.add(this.rig.group);

    // ---- 1. inspect + log the skeleton (name-independent body mapping) ----
    const { report } = inspectSkeleton(this.rig.model);
    console.log("\n=== BONE -> BODY MAPPING (from rest position + skin-weight centroid) ===");
    console.table(
      report.map((r) => ({
        bone: r.name,
        parent: r.parent,
        deformsVerts: r.influence?.count ?? 0,
        centroidX: r.influence ? +r.influence.centroid.x.toFixed(2) : null,
        centroidY: r.influence ? +r.influence.centroid.y.toFixed(2) : null,
      }))
    );

    // ---- helpers ----
    this.skeletonHelper = new THREE.SkeletonHelper(this.rig.model);
    this.skeletonHelper.material.linewidth = 2;
    this.scene.add(this.skeletonHelper);

    this._addElbowAxisHelper();

    // ---- 2. controller (live demo) ----
    this.controller = new ArmWrestleController(this.rig, {
      side: "right",
      maxAngle: Math.PI / 2.2,
    });

    // ---- 3. slider panel ----
    this._buildPanel();
  }

  _addElbowAxisHelper() {
    const line = this.rig.getElbowLine(); // model-space (bind pose)
    if (!line) return;
    // helper is parented to rig.model, so model-space coords are used directly
    const p = line.pivot.clone();
    const a = line.axis.clone();
    const half = (line.span / 2) * 1.15;
    const geo = new THREE.BufferGeometry().setFromPoints([
      p.clone().addScaledVector(a, -half),
      p.clone().addScaledVector(a, half),
    ]);
    this.elbowAxis = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: 0xffcc33 })
    );
    this.rig.model.add(this.elbowAxis);

    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffcc33 })
    );
    dot.position.copy(p);
    this.rig.model.add(dot);
  }

  _buildPanel() {
    const panel = new DebugPanel({ title: "ARM RIG — DEBUG" });
    this.panel = panel;

    panel.note("Yellow line = elbow-line pivot (kept fixed).");

    panel.section("Arm-wrestling motion");
    const foldRow = panel.slider("Forearm fold about elbow", {
      min: -1.6, max: 1.6, step: 0.001, value: 0,
      onChange: (v) => {
        this._useController = false;
        this.rig.setForearmFold(v);
      },
    });

    panel.section("Live controller demo (tap)");
    panel.checkbox("Drive with ArmWrestleController", false, (on) => {
      this._useController = on;
      if (!on) this.rig.setForearmFold(foldRow.input.valueAsNumber || 0);
    });
    panel.button("TAP → right", () => {
      this._useController = true;
      this.controller.setForce(this.controller.force + this.controller.cfg.tapImpulse * 1.5);
    });
    panel.button("TAP → left", () => {
      this._useController = true;
      this.controller.setForce(this.controller.force - this.controller.cfg.tapImpulse * 1.5);
    });
    panel.button("Reset controller", () => this.controller.reset());
    panel.slider("maxAngle (rad)", {
      min: 0.2, max: 1.6, value: Math.PI / 2.2,
      onChange: (v) => this.controller.setMaxAngle(v),
    });

    panel.section("Per-bone rotation (verify by name-independent test)");
    panel.note(
      "Hands, wrists, fingers and both forearms are ONE rigid piece with the " +
        "clasp — they are never articulated (would splay/kink and look broken). " +
        "Only these joints are exposed:"
    );
    // Deliberately NO hand/wrist/forearm/clasp-top sliders here.
    const candidates = [
      "Bone_005", "Bone_011", // L / R elbow  (asked-for)
      "Bone_004", "Bone_010", // L / R upper arm  (asked-for)
      "Bone_003", "Bone_009", // L / R shoulder
    ];
    candidates.forEach((name) => {
      const bone = this.rig.getBone(name);
      if (!bone) return;
      panel.section(`${name} — ${this._bodyLabel(name)}`);
      ["x", "y", "z"].forEach((ax) => {
        const base = bone.rotation[ax];
        panel.slider(`rot.${ax}`, {
          min: base - Math.PI, max: base + Math.PI, value: base,
          onChange: (v) => {
            this._useController = false;
            this.rig.setBoneEuler(name, ax, v);
          },
        });
      });
    });

    panel.section("");
    panel.button("RESET ALL POSE", () => {
      this._useController = false;
      this.rig.resetPose();
      this.rig.model.updateMatrixWorld(true);
    });
    panel.checkbox("Show skeleton", true, (on) => (this.skeletonHelper.visible = on));
  }

  _bodyLabel(name) {
    const L = ARM_BONES.left, R = ARM_BONES.right;
    const map = {
      [ARM_BONES.claspHub]: "clasp / wrists hub",
      [L.hand]: "LEFT hand/wrist", [L.forearm]: "LEFT forearm",
      [L.elbow]: "LEFT elbow (pivot)", [L.upperArm]: "LEFT upper arm",
      [L.shoulder]: "LEFT shoulder",
      [R.hand]: "RIGHT hand/wrist", [R.forearm]: "RIGHT forearm",
      [R.elbow]: "RIGHT elbow (pivot)", [R.upperArm]: "RIGHT upper arm",
      [R.shoulder]: "RIGHT shoulder",
    };
    return map[name] || "?";
  }

  _animate() {
    this._raf = requestAnimationFrame(() => this._animate());
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this._useController && this.controller) this.controller.update(dt);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  _onResize() {
    this.w = this.container.clientWidth || window.innerWidth;
    this.h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.w, this.h);
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener("resize", this._onResize);
    this.panel?.dispose();
    this.controls.dispose();
    this.rig.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
