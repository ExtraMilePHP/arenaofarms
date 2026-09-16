import * as THREE from "three";

/**
 * Dark, minimal cinematic backdrop — used for the "enters the arena" title
 * moments (app splash + pre-battle intro). Slowly rotating faceted shards,
 * drifting embers, a single dramatic rim light, and subtle pointer parallax.
 * No text is rendered here — the DOM overlay handles crisp typography while
 * this scene supplies the 3D atmosphere behind it.
 */
export default class CinematicScene {
  constructor(container, { accentColor = "#ff4d4d" } = {}) {
    this.container = container;
    this.accent = new THREE.Color(accentColor);

    this.width = container.clientWidth || 1;
    this.height = container.clientHeight || 1;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x05040a, 0.07);

    this.camera = new THREE.PerspectiveCamera(42, this.width / this.height, 0.1, 60);
    this.camera.position.set(0, 0, 8);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(this.width, this.height);
    this.renderer.setClearColor(0x05040a, 1);
    container.appendChild(this.renderer.domElement);

    this._buildScene();

    this.clock = new THREE.Clock();
    this.pointer = { x: 0, y: 0 };
    this.impact = 0;

    this._onPointerMove = this._onPointerMove.bind(this);
    window.addEventListener("pointermove", this._onPointerMove);
    this._onResize = this._onResize.bind(this);
    window.addEventListener("resize", this._onResize);

    this._animate = this._animate.bind(this);
    this._raf = requestAnimationFrame(this._animate);
  }

  _buildScene() {
    const scene = this.scene;

    this.ambient = new THREE.AmbientLight(0x1a1424, 1.1);
    scene.add(this.ambient);

    // single dramatic rim light — the scene's key light
    this.rim = new THREE.PointLight(this.accent, 14, 20, 2);
    this.rim.position.set(-3.5, 1.5, -2);
    scene.add(this.rim);

    this.fill = new THREE.DirectionalLight(0x8a7bff, 0.18);
    this.fill.position.set(2, 3, 4);
    scene.add(this.fill);

    // rotating faceted emblem shards — dark, near-silhouette, glowing edges
    this.shardGroup = new THREE.Group();
    const shardMat = new THREE.MeshStandardMaterial({
      color: 0x0c0912,
      roughness: 0.35,
      metalness: 0.7,
      emissive: this.accent,
      emissiveIntensity: 0.18,
      flatShading: true,
    });
    const geo = new THREE.IcosahedronGeometry(2.6, 0);
    this.shard = new THREE.Mesh(geo, shardMat);
    this.shardGroup.add(this.shard);

    const ringGeo = new THREE.TorusGeometry(3.4, 0.015, 8, 90);
    const ringMat = new THREE.MeshBasicMaterial({ color: this.accent, transparent: true, opacity: 0.35 });
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.rotation.x = Math.PI / 2.3;
    this.shardGroup.add(this.ring);

    this.shardGroup.position.set(0, 0, -3.5);
    scene.add(this.shardGroup);

    // drifting embers
    const count = 220;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 12;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 8;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 10 - 1;
    }
    const emberGeo = new THREE.BufferGeometry();
    emberGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const emberMat = new THREE.PointsMaterial({
      color: this.accent,
      size: 0.045,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.embers = new THREE.Points(emberGeo, emberMat);
    scene.add(this.embers);
  }

  _onPointerMove(e) {
    const x = ("touches" in e && e.touches[0] ? e.touches[0].clientX : e.clientX) || 0;
    const y = ("touches" in e && e.touches[0] ? e.touches[0].clientY : e.clientY) || 0;
    this.pointer.x = (x / window.innerWidth) * 2 - 1;
    this.pointer.y = (y / window.innerHeight) * 2 - 1;
  }

  _onResize() {
    if (!this.container) return;
    this.width = this.container.clientWidth || 1;
    this.height = this.container.clientHeight || 1;
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height);
  }

  /** A brief bright flash + shake — call as the intro hands off to the next screen. */
  triggerImpact() {
    this.impact = 1;
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener("pointermove", this._onPointerMove);
    window.removeEventListener("resize", this._onResize);
    this.renderer.dispose();
    if (this.renderer.domElement && this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }

  _animate() {
    this._raf = requestAnimationFrame(this._animate);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;

    this.shardGroup.rotation.y += dt * 0.12;
    this.shardGroup.rotation.x = Math.sin(t * 0.2) * 0.08;
    this.ring.rotation.z += dt * 0.06;

    // embers drift upward and gently sway, wrapping back to the bottom
    const pos = this.embers.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) + dt * (0.25 + (i % 5) * 0.05);
      let x = pos.getX(i) + Math.sin(t * 0.6 + i) * dt * 0.06;
      if (y > 4.2) y = -4.2;
      pos.setY(i, y);
      pos.setX(i, x);
    }
    pos.needsUpdate = true;

    // subtle pointer parallax on the camera
    const targetX = this.pointer.x * 0.5;
    const targetY = -this.pointer.y * 0.3;
    this.camera.position.x += (targetX - this.camera.position.x) * Math.min(dt * 2.5, 1);
    this.camera.position.y += (targetY - this.camera.position.y) * Math.min(dt * 2.5, 1);
    this.camera.lookAt(0, 0, -3.5);

    // impact flash + kick decay
    if (this.impact > 0.001) {
      this.rim.intensity = 14 + this.impact * 60;
      this.ambient.intensity = 1.1 + this.impact * 3;
      this.camera.position.z = 8 - this.impact * 1.2;
      this.impact *= 0.86;
    } else {
      this.rim.intensity = 14 + Math.sin(t * 1.4) * 2;
      this.ambient.intensity = 1.1;
    }

    this.renderer.render(this.scene, this.camera);
  }
}
