import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import ArmWrestleRig, { ARM_BONES } from "./armRig/ArmWrestleRig";
import ArmWrestleController from "./armRig/ArmWrestleController";

// Wrestling ring the whole arena sits inside -- a Sketchfab boxing-ring GLB
// (canvas, apron, corner posts, coloured ropes), served from public/ so it
// isn't bundled into the JS chunk.
const RING_MODEL_URL = `${process.env.PUBLIC_URL || ""}/models/boxing_ring.glb`;

// Clasped-forearms centrepiece -- rigged (an auto-rig, "UniRigArmature",
// 14 bones: Bone_000/001 at the clasp, each arm chain descending to its
// elbow (Bone_005 left / Bone_011 right, the lowest point) then back up to
// the shoulder). If it ships a baked pose clip it's scrubbed by the meter;
// otherwise the whole model is rocked about its elbow line at runtime.
// Served from public/ so it isn't bundled into the JS chunk.
const ARMS_MODEL_URL = `${process.env.PUBLIC_URL || ""}/models/riggedarm.glb`;

/**
 * 3D arm-wrestling visual — the hand.glb clasped-forearms model on a table
 * inside an imported wrestling-ring FBX (see _loadRing), over the CSS
 * gradient backdrop.
 *
 * The model is held at a fixed anchor on the elbows' own axis and pitched
 * about it (armsPivot). The pitch is SIGNED by the meter: the player tapping
 * ahead folds the clasped fists DOWN toward the FRONT of the table, the AI
 * ahead folds them DOWN toward the BACK -- each pins onto its own side --
 * while the elbows stay planted. If hand.glb ships a baked pose clip that
 * clip is scrubbed by the meter instead, for a true per-side forearm-only
 * fold. See _animate.
 *
 * There is no fallback mesh -- until the GLB loads the arena is shown empty,
 * and taps only register once its meshes are in. It also stays hidden
 * (setArmsVisible/Battle.jsx) through the ready/fight/start beat, revealed
 * only once the camera has settled front-on for play.
 */
export default class ArmWrestleScene {
  constructor(container, { playerColor = "#3ea6ff", opponentColor = "#ff4d4d" } = {}) {
    this.container = container;
    this.playerColor = new THREE.Color(playerColor);
    this.opponentColor = new THREE.Color(opponentColor);

    this.width = container.clientWidth || 1;
    this.height = container.clientHeight || 1;
    this.sceneScale = this._computeSceneScale(this.width);
    this.desktopUpShift = this.width < 768 ? 0 : -0.08;

    this.scene = new THREE.Scene();
    // light blue haze, not a dark fog — the vivid gradient backdrop comes
    // from the CSS behind the (transparent) canvas
    this.scene.fog = new THREE.FogExp2(0x1c4f73, 0.02);

    this.camera = new THREE.PerspectiveCamera(40, this.width / this.height, 0.1, 100);
    // raised + angled DOWN toward the clasp so the arm reads clearly above
    // the ring ropes instead of tangling with them (see armLift below)
    // backed off so the whole clasp reads without distortion, and dropped to a
    // near-level height aimed up at the clasp -- this pushes the elbows / upper
    // arms down past the bottom edge so only the forearms + clashing fists are
    // on screen (user: "upper arm should go down, we can't see it")
    this.baseCameraZ = this._computeCameraZ(this.width, this.height);
    this.baseCameraY = 2.15;
    this.cameraLookY = 1.5;
    this.camera.position.set(0, this.baseCameraY, this.baseCameraZ);
    this.camera.lookAt(0, this.cameraLookY, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(this.width, this.height);
    // transparent — the vivid gradient + glow backdrop is painted in CSS
    // behind the canvas (see .aoa-battle in arena.css)
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);

    // how far the whole arm + table sit above their old height -- lifts the
    // arm clear of the ring ropes. Used by _buildScene (table) and the
    // armsAnchor below so the arm still rests on the table.
    this.armLift = 0.3;
    this._buildScene();

    this.clock = new THREE.Clock();
    this.shakeIntensity = 0;
    this.tapPulse = 0;
    this.meter = 0; // -100..100
    this.displayMeter = 0;
    this.resultMode = null; // 'win' | 'lose' | null
    this.fallProgress = 0; // 0..1 "slam" progress once a result triggers
    // how far the whole planted arm is lowered at the pin so the clasped
    // fists actually land flat on the table -- measured once in
    // _seatArmOnTable and applied over fallProgress in _animate. The fold
    // angle itself is kept well short of the shear point (see maxArmFold);
    // the last few cm of table contact come from dropping the model, not
    // from over-bending the forearm/elbow seam.
    this._pinDrop = 0;
    this.fallDir = 0; // which side is being pinned down (+1 opponent, -1 player)
    this.claspPos = this.claspBase.clone(); // tracked each frame; used as the win-burst origin
    this.particles = null;
    this.particleVelocities = null;
    this.particleLife = 0;

    // hand.glb, populated once it loads (see _loadArmsModel)
    this.armsGroup = null;
    this.armsModel = null;
    this.armsTapMeshes = null;
    this.tapTargets = [];
    // hidden until Battle.jsx calls setArmsVisible(true) -- kept out of
    // view for the whole ready/fight/start beat while the camera is still
    // orbiting, and only revealed once it's settled front-on for play
    this.armsVisible = false;
    // fixed pivot the model rocks around -- sits on the elbow/table line
    // (final value is derived from the elbow bones in _loadArmsModel; this
    // is the base position it's built from)
    this.armsAnchor = new THREE.Vector3(
      0,
      (this.elbowLeft.y + this.elbowRight.y) / 2 + 0.32 + this.armLift + this.desktopUpShift,
      (this.elbowLeft.z + this.elbowRight.z) / 2 + 0.15
    );
    this.armsBaseRoll = 0;
    // turned well round so the two arms line up front-to-back (they read as one
    // line into the shot) and the near upper arm/shoulder faces the camera.
    // Held just short of a full 90deg -- at 90 the elbow line points straight
    // at the camera and the forearm fold rolls the fists sideways instead of
    // folding them down toward the table.
    this.armsBaseYaw = Math.PI / 2.6; // ~69 deg
    // Full forearm bend = the 100% meter position. Kept at ~55° rather than a
    // full ~82° fold: past ~60° the single forearm->elbow joint has to absorb
    // the entire rotation and the skin shears badly across the clasp ("melted
    // fists/wrist" — see the reference bug image). 55° still reads as a decisive
    // arm-wrestling pin with the fists laid over toward the table.
    // ~64°: kept clearly SHORT of the angle where the forearm->elbow skin
    // seam starts to shear ("melted fists/fingers" — see the reference bug
    // image). It won't reach the table on its own at this angle; the final
    // table contact comes from _pinDrop (the whole planted model is lowered
    // as the pin completes, see _seatArmOnTable + _animate) rather than from
    // bending the elbow further.
    this.maxArmFold = Math.PI / 2.8; // ~64°
    this._loadArmsModel();

    // slow 360 showcase orbit (on during intro/countdown, settles to a
    // front-on view once the fight starts) + tap-to-punch on the fist itself
    this.orbitAngle = 0;
    this.orbitSpeed = (Math.PI * 2) / 11; // one full revolution ~11s
    this.showcase = false;
    this.tappable = false;
    this.onTap = null;
    this.raycaster = new THREE.Raycaster();
    this.pointerNDC = new THREE.Vector2();

    // manual mouse/touch drag-to-look-around, layered on top of the auto orbit
    this.manualAngle = 0;
    this.dragging = false;
    this.dragPointerId = null;
    this.dragLastX = 0;

    this._animate = this._animate.bind(this);
    this._raf = requestAnimationFrame(this._animate);

    this._onResize = this._onResize.bind(this);
    window.addEventListener("resize", this._onResize);

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this.renderer.domElement.addEventListener("pointerdown", this._onPointerDown);
    this.renderer.domElement.addEventListener("pointermove", this._onPointerMove);
    window.addEventListener("pointerup", this._onPointerUp);
    window.addEventListener("pointercancel", this._onPointerUp);
  }

  _buildScene() {
    const scene = this.scene;

    // Lighting — cool blue-teal wash matching the CSS gradient backdrop.
    // NOTE: modern three.js (r155+) always uses physically-correct light
    // units (candela for point/spot lights), so old "legacy" intensity
    // values read as barely lit -- a neutral white key light and boosted
    // point/spot intensities keep the arms' texture readable instead of a
    // near-black silhouette.
    this.ambient = new THREE.AmbientLight(0x2a4a66, 1.4);
    scene.add(this.ambient);

    this.playerLight = new THREE.PointLight(this.playerColor, 55, 12);
    this.playerLight.position.set(-2.6, 2.6, 2.4);
    scene.add(this.playerLight);

    this.opponentLight = new THREE.PointLight(this.opponentColor, 55, 12);
    this.opponentLight.position.set(2.6, 2.6, 2.4);
    scene.add(this.opponentLight);

    this.rimLight = new THREE.DirectionalLight(0xffffff, 2.2);
    this.rimLight.position.set(0, 4, -3);
    scene.add(this.rimLight);

    // neutral white key light so the arms' actual texture reads through,
    // rather than only the cool blue-teal ambient + colored rim lights
    // tinting it dark and muddy
    this.keyLight = new THREE.PointLight(0xfff2e0, 60, 14);
    this.keyLight.position.set(0, 4, 3.2);
    scene.add(this.keyLight);

    const topLight = new THREE.SpotLight(0xffffff, 25, 12, Math.PI / 4, 0.6);
    topLight.position.set(0, 5, 1.5);
    topLight.target.position.set(0, 1.2, 0);
    scene.add(topLight, topLight.target);

    // ---- Anchors ----
    // Elbows feed the table + ring placement maths below; the clasp is the
    // (tracked, not rendered) moving fist point used as the win-burst origin.
    this.elbowLeft = new THREE.Vector3(-0.95, 0.22, 0.05);
    this.elbowRight = new THREE.Vector3(0.95, 0.22, 0.05);
    this.claspBase = new THREE.Vector3(0, 1.55, 0.35);
    this.maxLean = 1.05;

    // Floor level everything else (ring posts, table legs) plants into --
    // defined up front so nothing above it floats above/through it. The
    // ring's own scale (1.85, applied to ringGroup below) stretches
    // anything local-space defined inside it, so the posts' local geometry
    // is sized to *pre-compensate* for that scale-up and land exactly on
    // this world-space floor once the group's scale is applied.
    const floorY = -0.55;

    // ---- Wrestling ring (imported FBX) framing the arena ----
    // Loaded async (see _loadRing); until it's in, the arena just shows the
    // table on the CSS backdrop. The full ring (all four sides of rope)
    // stays visible -- the raised arm + downward camera keep the near ropes
    // below the arm rather than crossing it.
    this.frontRopeGroup = null;
    this.ringModel = null;
    this._loadRing();

    // Table the elbows plant on -- grounds the arena instead of the arms
    // floating over open air. Raised to sit right under where the arms
    // model's own base actually lands (armsAnchor's y, derived from the
    // same elbow anchors below) instead of well below it -- the old
    // tableTopY (-0.05) left a visible gap between the table surface and
    // the arms resting on it, so the arms read as hovering. The padded top
    // is now a neutral warm tone (matching the table body) instead of the
    // ring-accent cyan/blue, which was reading as a mismatched flat blue
    // patch sitting inside the arena rather than part of the table.
    const tableWidth = 3.2;
    const tableDepth = 1.55;
    const tableThickness = 0.5;
    // the arm model's lowest geometry (elbow undersides) sits at
    // armsAnchor.y (= elbowMid + 0.32 + armLift). Put the table top a touch
    // BELOW that so the elbows rest firmly on the surface instead of the
    // bottom of the arm punching down through it.
    const tableTopY =
      (this.elbowLeft.y + this.elbowRight.y) / 2 + 0.32 + this.armLift + 0.03 + this.desktopUpShift;
    const tableCenterZ = (this.elbowLeft.z + this.elbowRight.z) / 2 + 0.15;
    this.tableCenterZ = tableCenterZ; // used to cull the ring's near side
    // stashed for the arms' rotation clamp in _animate -- see
    // _clampLeanForTable, which uses this so the bend motion can never
    // dip the model's geometry into the table regardless of angle
    this.tableTopY = tableTopY;

    const tableGeo = new THREE.BoxGeometry(tableWidth, tableThickness, tableDepth);
    const tableMat = new THREE.MeshStandardMaterial({
      color: 0x1c1526,
      roughness: 0.45,
      metalness: 0.35,
      emissive: 0x110a1a,
    });
    this.table = new THREE.Mesh(tableGeo, tableMat);
    this.table.scale.setScalar(this.sceneScale);
    this.table.position.set(0, tableTopY - tableThickness / 2, tableCenterZ);
    scene.add(this.table);

    const padGeo = new THREE.BoxGeometry(tableWidth - 0.25, 0.06, tableDepth - 0.25);
    const padMat = new THREE.MeshStandardMaterial({
      color: 0x241a2e,
      roughness: 0.4,
      metalness: 0.2,
      emissive: 0x160f1e,
      emissiveIntensity: 0.25,
    });
    this.tablePad = new THREE.Mesh(padGeo, padMat);
    this.tablePad.scale.setScalar(this.sceneScale);
    this.tablePad.position.set(0, tableTopY + 0.03, tableCenterZ);
    scene.add(this.tablePad);

    // legs run all the way down from the table's underside to the actual
    // floor level instead of a fixed-length stub that could hang short of
    // (or punch through) the floor once the table's height changed above
    const tableBottomY = tableTopY - tableThickness;
    // table sits on the ring canvas (~y0.5); short legs, hidden below it
    const legHeight = 0.85;
    const legGeo = new THREE.CylinderGeometry(0.07, 0.09, legHeight, 8);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x0f0a16, roughness: 0.6, metalness: 0.25 });
    // kept so _alignTableToPin() can shift the whole table (top, pad, legs)
    // together once the arm model has loaded and its full-fold fist height
    // is known -- the pin must land flat ON the surface.
    this.tableThickness = tableThickness;
    this.tableLegs = [];
    [
      [tableWidth / 2 - 0.25, tableDepth / 2 - 0.25],
      [-(tableWidth / 2 - 0.25), tableDepth / 2 - 0.25],
      [tableWidth / 2 - 0.25, -(tableDepth / 2 - 0.25)],
      [-(tableWidth / 2 - 0.25), -(tableDepth / 2 - 0.25)],
    ].forEach(([x, z]) => {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(x, tableBottomY - legHeight / 2, tableCenterZ + z);
      scene.add(leg);
      this.tableLegs.push(leg);
    });

    // faint ground disc still sits under everything as a catch-all floor for
    // when the camera swings low during the showcase orbit -- the ring's own
    // platform is the main "ground" now, so this is smaller/dimmer than the
    // old one.
    const discGeo = new THREE.CircleGeometry(9, 40);
    const discMat = new THREE.MeshStandardMaterial({
      color: 0x0d2033,
      roughness: 0.85,
      metalness: 0.1,
      transparent: true,
      opacity: 0.6,
    });
    this.disc = new THREE.Mesh(discGeo, discMat);
    this.disc.rotation.x = -Math.PI / 2;
    this.disc.position.y = floorY - 0.02;
    scene.add(this.disc);
    this.floorY = floorY;
  }

  /**
   * Loads the boxing-ring GLB (Sketchfab, ~8 units across, base at local
   * y=0, keeps its own textured materials), scales it to enclose the arena
   * and drops it so the canvas sits near the floor and pushed back a little
   * so the near ropes frame around/below the raised arm rather than across
   * it. Its front half is clipped away during play (see _setRingFrontHidden).
   */
  _loadRing() {
    new GLTFLoader().load(
      RING_MODEL_URL,
      (gltf) => {
        const obj = gltf.scene;
        const box = new THREE.Box3().setFromObject(obj);
        const center = box.getCenter(new THREE.Vector3());
        obj.position.set(-center.x, -box.min.y, -center.z); // centre X/Z, base at 0

        obj.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = false;
          o.receiveShadow = false;
        });

        // centred, base planted on the floor, scaled to fill the top-down
        // shot -- the table sits on the canvas and all four rope walls stay
        // in frame around it.
        const group = new THREE.Group();
        group.add(obj);
        group.scale.setScalar(0.86 * this.sceneScale);
        group.position.set(0, 0, 0);
        group.updateMatrixWorld(true);
        const wbox = new THREE.Box3().setFromObject(group);
        group.position.y += this.floorY - wbox.min.y;
        group.updateMatrixWorld(true);

        this.ringModel = group;
        this.scene.add(group);
      },
      undefined,
      (err) => console.warn("ArmWrestleScene: failed to load boxing_ring.glb", err)
    );
  }

  /** kept for setShowcase; the ring is positioned so nothing needs hiding. */
  _setRingFrontHidden() {}

  /**
   * Loads hand.glb (rigged, UniRigArmature). If it carries a baked pose clip
   * that clip is scrubbed by the meter in _animate; otherwise the whole
   * model is rocked about its elbow line (armsPivot) each frame. Uniform
   * scale + a recenter put the model's base at its own local origin, then
   * the group origin is lifted onto the elbow line so lean rotations pivot
   * at the elbows rather than the base.
   */
  _loadArmsModel() {
    // The clasped-forearms rig (riggedarm.glb, 14 bones). Body mapping was
    // verified name-independently from rest positions + skin-weight centroids
    // (see src/three/armRig/skeletonInspector.js and the /arena/armdebug tool):
    //   Bone_001            = clasp / wrists hub
    //   Bone_007 / Bone_013 = left / right hand + wrist
    //   Bone_006 / Bone_012 = left / right forearm
    //   Bone_005 / Bone_011 = left / right ELBOW  (the fixed pivot)
    //   Bone_004 / Bone_010 = left / right upper arm
    //   Bone_003 / Bone_009 = left / right shoulder
    // ArmWrestleRig.setForearmFold() swings Bone_001's whole subtree about the
    // world elbow-line while re-pinning Bone_005/Bone_011 to their bind pose,
    // so the elbows + upper arms stay planted and only the forearms + clasped
    // fists rotate -- the arm-wrestling motion. The GLB itself is untouched.
    this.armRig = new ArmWrestleRig();
    this.armRig
      .load(ARMS_MODEL_URL)
      .then(() => {
        const model = this.armRig.model;

        const rawSize = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
        const targetWidth = 2.45 * this.sceneScale;
        const s = targetWidth / (rawSize.x || 1);
        model.scale.setScalar(s);
        model.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.set(-center.x, -box.min.y, -center.z);

        const meshes = [];
        model.traverse((obj) => {
          if (obj.isMesh) meshes.push(obj);
        });

        // Drop the whole rig onto the table anchor; forearm motion is bone-
        // driven now, so armsGroup only positions the model -- it is never
        // rotated for the wrestle itself.
        this.armsGroup = this.armRig.group;
        this.armsGroup.position.copy(this.armsAnchor);
        this.armsGroup.rotation.set(0, this.armsBaseYaw, this.armsBaseRoll);
        this.armsGroup.visible = this.armsVisible;
        this.scene.add(this.armsGroup);

        this.armsModel = model;
        this.armsTapMeshes = meshes;
        this.tapTargets = meshes;

        // hand bone used purely to track the moving fist point for the win burst
        this._handBoneL = this.armRig.getBone(ARM_BONES.left.hand);

        // Reusable arm-wrestling controller. maxAngle = full pin either way;
        // the meter drives `force` directly each frame (see _animate). Built
        // to slot straight into multiplayer PvP: one controller per client,
        // fed either local taps or the authoritative synced value.
        this.armRig.setMaxFold?.(this.maxArmFold ?? Math.PI / 2.2);
        this.armController = new ArmWrestleController(this.armRig, {
          side: "right", // + meter (player ahead) folds the clasp toward the opponent's side
          maxAngle: this.maxArmFold ?? Math.PI / 2.2,
          smoothing: 9,
        });

        this._seatArmOnTable();
        this._buildSideTints();
      })
      .catch((err) => console.warn("ArmWrestleScene: failed to load riggedarm.glb", err));
  }

  /**
   * Once the rig is loaded, seat the RESTING arm on top of the table instead
   * of sunk into it (the raw anchor maths left the elbows/forearms a few cm
   * below the surface -- see the reference screenshot), then nudge the table
   * up by at most a hair so a fully-folded fist just meets the surface.
   *
   * The wrestle motion itself is untouched: only Bone_001/005/011 are driven
   * (see ArmWrestleRig.DRIVEN_BONES), the pivot is the elbow midpoint, and the
   * wrists/fingers/forearms are held rigid -- this only shifts where the whole
   * planted model and the table sit vertically.
   */
  _seatArmOnTable() {
    if (!this.armsModel || !this.armsGroup) return;

    this.armsGroup.position.copy(this.armsAnchor);
    this.armsGroup.updateMatrixWorld(true);

    // 1) lift the arm so its lowest resting geometry clears the table top
    const restBox = new THREE.Box3().setFromObject(this.armsModel);
    const clearance = 0.04;
    const sink = this.tableTopY + clearance - restBox.min.y; // >0 => arm is in the table
    if (sink > 0.001) {
      this._armSeatLift = (this._armSeatLift || 0) + sink;
      this.armsAnchor.y += sink;
      this.armsGroup.position.copy(this.armsAnchor);
      this.armsGroup.updateMatrixWorld(true);
    }

    // 2) measure how far the fully-folded clasped fist still sits ABOVE the
    //    table, and stash it as _pinDrop. At the pin the whole planted model
    //    is lowered by this much (see _animate's resultMode branch) so the
    //    fists land flat on the surface -- WITHOUT folding the elbow past the
    //    point where the skin shears. Capped so a bad measurement can't
    //    yank the arm through the floor.
    if (this._handBoneL && this.armRig) {
      const prevFold = this.armRig.getForearmFold?.() ?? 0;
      this.armRig.setForearmFold(this.maxArmFold);
      this.armsGroup.updateMatrixWorld(true);
      const fist = new THREE.Vector3();
      this._handBoneL.getWorldPosition(fist);
      this.armRig.setForearmFold(prevFold);
      this.armsGroup.updateMatrixWorld(true);

      // leave the fists resting ON the surface, not pushed through it -- the
      // offset is the fist's half-thickness plus a little slack so the elbows
      // never sink into the table on the drop (user: "arms go inside table").
      const contactOffset = 0.16;
      // keep this tiny -- the user does NOT want the whole arm shoved down flat
      // at the finish (it was sinking through the table). A couple of cm of
      // settle is plenty; the fold angle already reads as a pin on its own.
      this._pinDrop = Math.max(0, Math.min(fist.y - contactOffset - this.tableTopY, 0.05));
    }
  }


  /**
   * Faint translucent colored "sleeves" hugging each forearm (elbow -> clasp):
   * the player color on the LEFT arm, the opponent color on the RIGHT, so it's
   * obvious at a glance which arm is yours. Purely cosmetic -- they're tracked
   * to the bones every frame in _updateSideTints so they follow the fold.
   */
  _buildSideTints() {
    if (!this.armRig) return;
    const hub = this.armRig.getBone(ARM_BONES.claspHub);
    const elbowL = this.armRig.getBone(ARM_BONES.left.elbow);
    const elbowR = this.armRig.getBone(ARM_BONES.right.elbow);
    if (!hub || !elbowL || !elbowR) return;

    const make = (color) => {
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.17, 0.13, 1, 14, 1, true),
        mat
      );
      mesh.visible = this.armsVisible;
      mesh.renderOrder = 2;
      this.scene.add(mesh);
      return mesh;
    };

    this._sideTints = [
      { mesh: make(this.playerColor), from: elbowL, to: hub },
      { mesh: make(this.opponentColor), from: elbowR, to: hub },
    ];
    this._tintA = new THREE.Vector3();
    this._tintB = new THREE.Vector3();
    this._tintUp = new THREE.Vector3(0, 1, 0);
  }

  _updateSideTints() {
    if (!this._sideTints) return;
    for (const t of this._sideTints) {
      t.mesh.visible = this.armsVisible;
      if (!this.armsVisible) continue;
      t.from.getWorldPosition(this._tintA);
      t.to.getWorldPosition(this._tintB);
      const dir = this._tintB.clone().sub(this._tintA);
      const len = dir.length() || 1;
      dir.normalize();
      t.mesh.position.copy(this._tintA).add(this._tintB).multiplyScalar(0.5);
      t.mesh.quaternion.setFromUnitVectors(this._tintUp, dir);
      t.mesh.scale.set(1, len * 0.92, 1);
    }
  }

  /** Called every frame from React with the current meter (-100..100). */
  setMeter(meter) {
    this.meter = Math.max(-100, Math.min(100, meter));
  }

  /** Registers the function to call when the player taps directly on the clasped arms. */
  setTapCallback(fn) {
    this.onTap = fn;
  }

  /** Enables/disables tapping the 3D arms themselves (only during active play). */
  setTappable(tappable) {
    this.tappable = tappable;
    if (!tappable) this.renderer.domElement.style.cursor = "default";
  }

  /** Enables/disables the slow 360 showcase orbit around the arena. */
  setShowcase(showcase) {
    this.showcase = showcase;
    this._setRingFrontHidden(!showcase);
  }

  /**
   * Shows/hides the loaded arms model. Kept hidden through the whole
   * ready/fight/start beat (while the camera is still doing its showcase
   * orbit) and revealed only once React calls this with `true` -- meant to
   * line up with the camera having settled front-on, not mid-spin.
   */
  setArmsVisible(visible) {
    this.armsVisible = visible;
    if (this.armsGroup) this.armsGroup.visible = visible;
  }

  _updatePointer(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  _onPointerDown(e) {
    if (this.tappable && this.onTap) {
      this._updatePointer(e);
      this.raycaster.setFromCamera(this.pointerNDC, this.camera);
      const hits = this.raycaster.intersectObjects(this.tapTargets, false);
      if (hits.length) {
        this.onTap();
        return;
      }
    }
    // not a tap on the arms — start a manual look-around drag instead
    this.dragging = true;
    this.dragPointerId = e.pointerId;
    this.dragLastX = e.clientX;
    this.renderer.domElement.setPointerCapture?.(e.pointerId);
  }

  _onPointerMove(e) {
    if (this.dragging) {
      const dx = e.clientX - this.dragLastX;
      this.dragLastX = e.clientX;
      this.manualAngle += dx * 0.006;
      return;
    }
    if (!this.tappable) return;
    this._updatePointer(e);
    this.raycaster.setFromCamera(this.pointerNDC, this.camera);
    const hits = this.raycaster.intersectObjects(this.tapTargets, false);
    this.renderer.domElement.style.cursor = hits.length ? "pointer" : "default";
  }

  _onPointerUp(e) {
    if (!this.dragging || this.dragPointerId !== e.pointerId) return;
    this.dragging = false;
    this.dragPointerId = null;
    this.renderer.domElement.releasePointerCapture?.(e.pointerId);
  }

  /** Call on every tap to trigger shake / glow feedback. */
  pulseTap(strength = 1) {
    this.shakeIntensity = Math.min(this.shakeIntensity + 0.05 * strength, 0.35);
    this.tapPulse = 1;
  }

  triggerWin() {
    this.resultMode = "win";
    this.fallProgress = 0;
    // use the true meter (what actually tripped the threshold), not the
    // lagging displayMeter which may still be near 0
    this.fallDir = Math.sign(this.meter) || Math.sign(this.displayMeter) || 1;
    this.shakeIntensity = Math.max(this.shakeIntensity, 0.3);
    this._spawnBurst(this.playerColor);
  }

  triggerLose() {
    this.resultMode = "lose";
    this.fallProgress = 0;
    this.fallDir = Math.sign(this.meter) || Math.sign(this.displayMeter) || -1;
    this.shakeIntensity = Math.max(this.shakeIntensity, 0.3);
  }

  /**
   * True once the post-result arm-slam has actually reached the table --
   * Battle.jsx waits for this (with a safety cap) before dropping the dark
   * result overlay, so the pin is never hidden mid-fall.
   */
  isPinComplete() {
    if (!this.resultMode) return false;
    // authority is the ACTUAL forearm angle -- the round result shows only
    // once the arm is fully bent onto the table, not when a proxy meter says so
    const fullyBent = this.armController
      ? this.armController.isPinned
      : Math.abs(this.displayMeter) > 96;
    return this.fallProgress >= 1 && fullyBent;
  }

  reset() {
    this.resultMode = null;
    this.fallProgress = 0;
    this.fallDir = 0;
    this.shakeIntensity = 0;
    this.tapPulse = 0;
    this.meter = 0;
    this.displayMeter = 0;
    this.armController?.reset();
    if (this.particles) {
      this.scene.remove(this.particles);
      this.particles.geometry.dispose();
      this.particles.material.dispose();
      this.particles = null;
    }
  }

  _spawnBurst(color) {
    const count = 140;
    const positions = new Float32Array(count * 3);
    const velocities = [];
    for (let i = 0; i < count; i++) {
      positions[i * 3] = this.claspPos.x;
      positions[i * 3 + 1] = this.claspPos.y;
      positions[i * 3 + 2] = this.claspPos.z;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const speed = 1.5 + Math.random() * 2.5;
      velocities.push(
        new THREE.Vector3(
          Math.sin(phi) * Math.cos(theta) * speed,
          Math.abs(Math.cos(phi)) * speed + 1.5,
          Math.sin(phi) * Math.sin(theta) * speed
        )
      );
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color,
      size: 0.09,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.particles = new THREE.Points(geo, mat);
    this.scene.add(this.particles);
    this.particleVelocities = velocities;
    this.particleLife = 1.4;
  }

  // Mobile viewports are narrow AND tall (portrait), so the same vertical
  // FOV crops in tighter on the sides than it does on a wide desktop window
  // -- the arm/table end up reading much larger relative to the screen. Scale
  // the model down and back the camera off further the narrower the aspect
  // ratio gets, instead of just a flat "mobile vs desktop" split.
  _computeSceneScale(width) {
    return width < 768 ? 0.62 : 0.9;
  }

  _computeCameraZ(width, height) {
    if (width >= 768) return 4.2;
    const aspect = width / (height || 1);
    // 0.5 = a typical tall phone (e.g. 390x844); back off further the
    // narrower/taller it gets, capped so it never runs away on odd sizes
    const narrowBoost = Math.max(0, 0.62 - aspect) * 3.2;
    return Math.min(6.4, 5.0 + narrowBoost);
  }

  _onResize() {
    if (!this.container) return;
    const prevScale = this.sceneScale;
    this.width = this.container.clientWidth || 1;
    this.height = this.container.clientHeight || 1;
    this.sceneScale = this._computeSceneScale(this.width);
    this.baseCameraZ = this._computeCameraZ(this.width, this.height);
    this.desktopUpShift = this.width < 768 ? 0 : -0.14;
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height);

    if (this.table) {
      this.table.scale.setScalar(this.sceneScale);
      const baseY = this.table.position.y;
      this.table.position.y = baseY + (this.sceneScale - prevScale) * 0.2;
    }
    if (this.tablePad) {
      this.tablePad.scale.setScalar(this.sceneScale);
    }
    if (this.ringModel) {
      this.ringModel.scale.setScalar(0.86 * this.sceneScale);
    }
    if (this.armsGroup && this.armsAnchor) {
      this.armsAnchor.y =
        (this.elbowLeft.y + this.elbowRight.y) / 2 + 0.32 + this.armLift +
        this.desktopUpShift + (this._armSeatLift || 0);
      this.armsGroup.position.copy(this.armsAnchor);
    }
  }

  _animate() {
    this._raf = requestAnimationFrame(this._animate);
    const dt = Math.min(this.clock.getDelta(), 0.05);

    // smooth the meter for visual lean so it never snaps. Once a round has
    // been decided, drive the visible lean HARD to the fully-pinned value
    // for the losing side -- the meter can trip the win threshold while the
    // smoothed lean is still catching up, and the arm must actually reach
    // the table before the result overlay drops (see isPinComplete()).
    if (this.resultMode) {
      const pinned = (this.fallDir || 1) * 100;
      this.displayMeter += (pinned - this.displayMeter) * Math.min(dt * 9, 1);
    } else {
      this.displayMeter += (this.meter - this.displayMeter) * Math.min(dt * 6, 1);
    }

    // continuous tug-of-war sway stays on x (screen-parallel, so it just
    // slides the clasp left/right and always stays safely inside the camera
    // frustum). Only the win/lose "fall" below moves along z instead.
    const lean = (this.displayMeter / 100) * this.maxLean;
    const claspPos = this.claspBase.clone();
    // the clasp folds forward + down and leans toward the losing side as
    // the meter swings; tracked here only as the win-burst origin
    claspPos.x += (lean / this.maxLean) * 0.5;
    claspPos.y -= Math.abs(lean) * 0.45;
    claspPos.z += Math.abs(lean) * 0.30;
    claspPos.y += Math.sin(this.clock.elapsedTime * 2) * 0.02; // idle breathing
    this.claspPos = claspPos;

    // Forearm fold is bone-driven by ArmWrestleController: the clasped fists
    // swing about the world elbow-line while Bone_005/Bone_011 (the elbows)
    // and the upper arms stay pinned to their bind pose -- player ahead folds
    // the clasp toward the opponent's (right) side, AI ahead toward the
    // player's (left) side. See src/three/armRig/.
    if (this.armController) {
      // The meter drives the controller's signed force directly (-1..1), so
      // the forearm fold tracks the HUD bar 1:1 and the round ends the instant
      // the fist touches down (|meter| == WIN_LIMIT). Once a result is in, lock
      // the controller to the winning side so it slams fully to the table.
      if (this.resultMode) {
        this.fallProgress = Math.min(1, this.fallProgress + dt / 0.28);
        const dir = this.fallDir || Math.sign(this.displayMeter) || 1;
        this.armController.lock(dir >= 0 ? "right" : "left");
      } else if (!this.armController._locked) {
        // Battle.jsx latches the controller (lock) once the meter tops out so
        // the fold always finishes onto the table -- don't fight that here.
        this.armController.setForce(this.displayMeter / 100);
      }
      this.armController.update(dt);

      // keep the model planted; the fold is entirely bone-driven
      this.armsGroup.position.copy(this.armsAnchor);
      this.armsGroup.rotation.set(0, this.armsBaseYaw, this.armsBaseRoll);

      // at the pin, lower the whole planted arm so the clasped fists come
      // down flat onto the table (the fold angle alone stops short of the
      // surface to keep the wrist/finger seam from shearing -- see
      // maxArmFold / _seatArmOnTable). Eased in over the same fallProgress
      // that drives the slam, so the arm meets the table exactly as the
      // round is decided and the HUD bar reads 100%.
      if (this.resultMode && this._pinDrop) {
        this.armsGroup.position.y -= this._pinDrop * this.fallProgress;
      }

      // track the clasped-fist point for the win burst
      if (this._handBoneL) {
        this._handBoneL.getWorldPosition(this.claspPos);
      }

      // keep the player/opponent forearm color sleeves on the bones
      this._updateSideTints();
    }

    // dominance-based lighting/brightness -- kept to a much smaller swing
    // than before. At full dominance the old 45->100 range let the colored
    // point light overpower the neutral key/rim lights entirely, washing
    // one whole side of the arm into a flat solid blue/red patch instead
    // of readable skin. This still brightens the winning side's light
    // slightly, just nowhere near enough to blot out the model's own color.
    const dominance = this.displayMeter / 100; // -1..1
    this.playerLight.intensity = 50 + Math.max(0, dominance) * 18;
    this.opponentLight.intensity = 50 + Math.max(0, -dominance) * 18;

    // close-match tension: slight extra shake near center (no more rapid
    // pulsing zoom here -- that constant in/out wobble while tapping/near a
    // close match was the zoom animation this was about removing)
    const closeness = 1 - Math.min(Math.abs(this.displayMeter) / 22, 1); // 1 at center, 0 past +-22
    // camera distance stays fixed during play -- the previous lean-based
    // zoom-in (shrinking targetRadius as the meter leaned further) read as
    // the screen slowly zooming in the longer a match went on, which is the
    // zoom this was about removing. leanProgress is still used below for the
    // drift/recenter bias, just no longer feeds the camera radius.
    const leanProgress = Math.min(Math.abs(this.displayMeter) / 100, 1); // 0..1
    this.camRadius = this.baseCameraZ;

    // slow 360 showcase orbit while idle; eases back to a front-on view once play starts
    if (this.showcase) {
      this.orbitAngle += dt * this.orbitSpeed;
    } else {
      let a = ((this.orbitAngle + Math.PI) % (Math.PI * 2)) - Math.PI;
      this.orbitAngle = a - a * Math.min(dt * 2.2, 1);
    }

    // horizontal drift toward the winning side, expressed as a small angular
    // bias -- also continuous with leanProgress now, so the camera recenters
    // on the arm as it sways instead of only reacting once someone's close to winning
    const targetDriftX = Math.sign(this.displayMeter) * leanProgress * 0.6;
    this.driftX = this.driftX ?? 0;
    this.driftX += (targetDriftX - this.driftX) * Math.min(dt * 2.5, 1);

    // manual mouse/touch drag look-around -- the angle the player drags to is
    // KEPT once they let go (no easing back to center), so the arena stays
    // where they left it instead of snapping back to front-on every time.

    const totalAngle = this.orbitAngle + this.manualAngle + Math.atan2(this.driftX, this.camRadius);

    this.camera.position.x = Math.sin(totalAngle) * this.camRadius;
    this.camera.position.z = Math.cos(totalAngle) * this.camRadius;

    // decay shake / tap glow
    this.shakeIntensity *= 0.9;
    this.tapPulse *= 0.85;
    if (this.shakeIntensity > 0.001) {
      this.camera.position.y = this.baseCameraY + (Math.random() - 0.5) * this.shakeIntensity + closeness * Math.sin(this.clock.elapsedTime * 30) * 0.01;
      this.camera.rotation.z = (Math.random() - 0.5) * this.shakeIntensity * 0.05;
    } else {
      this.camera.rotation.z *= 0.8;
      this.camera.position.y += (this.baseCameraY - this.camera.position.y) * 0.1;
    }

    this.camera.lookAt(0, this.cameraLookY, 0);

    // result mode overrides
    if (this.resultMode === "lose") {
      this.ambient.intensity = Math.max(0.25, this.ambient.intensity - dt * 0.4);
    } else {
      this.ambient.intensity += (0.7 - this.ambient.intensity) * dt * 2;
    }

    // particle burst update
    if (this.particles) {
      this.particleLife -= dt;
      const pos = this.particles.geometry.attributes.position;
      for (let i = 0; i < this.particleVelocities.length; i++) {
        const v = this.particleVelocities[i];
        v.y -= dt * 3; // gravity
        pos.array[i * 3] += v.x * dt;
        pos.array[i * 3 + 1] += v.y * dt;
        pos.array[i * 3 + 2] += v.z * dt;
      }
      pos.needsUpdate = true;
      this.particles.material.opacity = Math.max(0, this.particleLife / 1.4);
      if (this.particleLife <= 0) {
        this.scene.remove(this.particles);
        this.particles.geometry.dispose();
        this.particles.material.dispose();
        this.particles = null;
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener("resize", this._onResize);
    this.renderer.domElement.removeEventListener("pointerdown", this._onPointerDown);
    this.renderer.domElement.removeEventListener("pointermove", this._onPointerMove);
    window.removeEventListener("pointerup", this._onPointerUp);
    window.removeEventListener("pointercancel", this._onPointerUp);
    this._sideTints?.forEach((t) => {
      this.scene.remove(t.mesh);
      t.mesh.geometry.dispose();
      t.mesh.material.dispose();
    });
    this._sideTints = null;
    this.armRig?.dispose();
    this.armRig = null;
    this.armController = null;
    if (this.ringModel) {
      this.ringModel.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry?.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((mat) => mat?.dispose());
      });
    }
    this.renderer.dispose();
    if (this.renderer.domElement && this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
