import * as THREE from "three";

/**
 * Runtime skeleton inspector for the rigged-arm GLB.
 *
 * Logs the full bone hierarchy, every bone's rest transform, and — crucially —
 * the centroid + bounding box of the mesh vertices each bone actually deforms
 * (skin weight > `weightThreshold`). The vertex data is what lets us map a bone
 * to a body part WITHOUT trusting its name.
 *
 * Pure read-only: it never mutates the model.
 *
 * @param {THREE.Object3D} root      the loaded `gltf.scene`
 * @param {object}         [opts]
 * @param {number}         [opts.weightThreshold=0.4]
 * @param {(s:string)=>void} [opts.log=console.log]
 * @returns {{
 *   skinnedMesh: THREE.SkinnedMesh,
 *   bones: THREE.Bone[],
 *   report: Array<{name:string,index:number,parent:string|null,restWorld:THREE.Vector3,
 *                  influence:{count:number,centroid:THREE.Vector3,box:THREE.Box3}|null}>
 * }}
 */
export function inspectSkeleton(root, opts = {}) {
  const weightThreshold = opts.weightThreshold ?? 0.4;
  const log = opts.log ?? ((s) => console.log(s));

  let skinnedMesh = null;
  root.traverse((o) => {
    if (o.isSkinnedMesh && !skinnedMesh) skinnedMesh = o;
  });
  if (!skinnedMesh) {
    log("[skeletonInspector] no SkinnedMesh found");
    return { skinnedMesh: null, bones: [], report: [] };
  }

  const skeleton = skinnedMesh.skeleton;
  const bones = skeleton.bones;

  // Rest pose: bind matrices -> world rest position of every bone.
  skeleton.pose();
  root.updateMatrixWorld(true);
  const restWorld = bones.map((b) => b.getWorldPosition(new THREE.Vector3()));

  // ---- skin-weight influence per bone (the name-independent evidence) ----
  const geo = skinnedMesh.geometry;
  const pos = geo.attributes.position;
  const skinIndex = geo.attributes.skinIndex;
  const skinWeight = geo.attributes.skinWeight;
  const hasSkin2 = geo.attributes.skinIndex2 && geo.attributes.skinWeight2;

  const influence = bones.map(() => ({
    count: 0,
    centroid: new THREE.Vector3(),
    box: new THREE.Box3(),
  }));

  const v = new THREE.Vector3();
  const consider = (boneIdx, weight) => {
    if (weight <= weightThreshold) return;
    const inf = influence[boneIdx];
    inf.count++;
    inf.centroid.add(v);
    inf.box.expandByPoint(v);
  };

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // bind-space vertex -> apply the mesh's own bind matrix so centroids read
    // in the same space as restWorld above
    v.applyMatrix4(skinnedMesh.bindMatrix);
    for (let k = 0; k < 4; k++) {
      consider(skinIndex.getComponent(i, k), skinWeight.getComponent(i, k));
    }
    if (hasSkin2) {
      for (let k = 0; k < 4; k++) {
        consider(
          geo.attributes.skinIndex2.getComponent(i, k),
          geo.attributes.skinWeight2.getComponent(i, k)
        );
      }
    }
  }
  influence.forEach((inf) => {
    if (inf.count) inf.centroid.multiplyScalar(1 / inf.count);
  });

  // ---- hierarchy print ----
  const boneSet = new Set(bones);
  const nameOf = (b) => b?.name ?? "(null)";
  log("=== RIGGED-ARM SKELETON ===");
  log(`SkinnedMesh: "${skinnedMesh.name}"  bones: ${bones.length}  verts: ${pos.count}`);

  const printed = new Set();
  const printTree = (bone, depth) => {
    log("  ".repeat(depth) + `- ${bone.name}`);
    printed.add(bone);
    bone.children.forEach((c) => {
      if (boneSet.has(c)) printTree(c, depth + 1);
    });
  };
  bones.forEach((b) => {
    if (!boneSet.has(b.parent)) printTree(b, 0);
  });

  // ---- per-bone table ----
  const report = bones.map((b, i) => {
    const inf = influence[i];
    const size = inf.count ? inf.box.getSize(new THREE.Vector3()) : null;
    log(
      `#${String(i).padStart(2)} ${b.name.padEnd(10)} ` +
        `parent=${(nameOf(b.parent)).padEnd(10)} ` +
        `restWorld=[${fmt(restWorld[i])}] ` +
        (inf.count
          ? `deforms ${String(inf.count).padStart(4)} verts  centroid=[${fmt(inf.centroid)}]  size=[${fmt(size)}]`
          : `deforms 0 verts`)
    );
    return {
      name: b.name,
      index: i,
      parent: b.parent && boneSet.has(b.parent) ? b.parent.name : null,
      restWorld: restWorld[i],
      influence: inf.count
        ? { count: inf.count, centroid: inf.centroid, box: inf.box }
        : null,
    };
  });

  return { skinnedMesh, bones, report };
}

function fmt(v) {
  return v ? `${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)}` : "-";
}
