import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// ============================================================
// MIXAMO RETARGETING
//
// Every rigged asset in this project comes from Mixamo, but each download
// gets its own bone namespace: the player GLB is `mixamorig10:Hips`, the
// guard GLB is `mixamorig:Hips`, and the loose animation FBX files (punch /
// die / pickup) are `mixamorig9`. THREE.PropertyBinding matches tracks to
// bones by EXACT node name, so an FBX clip can't drive a character until
// those prefixes agree.
//
// IMPORTANT: the two loaders normalise the namespace separator differently.
// GLTFLoader keeps the colon (`mixamorig10:Hips`), but FBXLoader strips it,
// so the same bone arrives from an FBX as `mixamorig9Hips` (no colon). The
// prefix regex must therefore treat the colon as OPTIONAL or the FBX tracks
// never get renamed and silently fail to bind (leaving the character stuck
// in its rest T-pose).
//
// TWO MORE WRINKLES on the GLB side, both from GLTFLoader.createUniqueName:
//  1. It runs PropertyBinding.sanitizeNodeName first, which DELETES the colon,
//     so the runtime bone is actually `mixamorig10Hips` (no colon).
//  2. These GLBs bake in several duplicate armatures sharing every bone name
//     (see dedupeSkeletons below), so createUniqueName disambiguates them by
//     appending `_N` — the kept armature's hips ends up `mixamorig10Hips_3`.
// After dedupeSkeletons leaves a single skeleton we must therefore strip BOTH
// the `mixamorigN[:]?` prefix AND the trailing `_N` suffix, or the bone is
// named `Hips_3` and no clip track (which says `Hips`) can ever find it.
//
// The fix: canonicalise every bone to its bare Mixamo base name (`Hips`,
// `Spine`, `LeftArm`, ...) on the character's bones, the character's own
// clips, and the imported FBX clips alike. This is safe because Mixamo base
// names never contain `_N` (Spine1 / Neck1 have digits but no underscore) and
// dedupe guarantees the base names are unique again.
//
// Mixamo also authors in centimetres while our GLBs are in metres, so the
// imported Hips position track (~90) would launch the character into the
// sky. We measure each rig's rest Hips height and rescale the FBX clip's
// position tracks to match the target character automatically.
// ============================================================

const fbxLoader = new FBXLoader();
// Colon is optional: GLTFLoader keeps it (`mixamorig10:Hips`), FBXLoader
// drops it (`mixamorig9Hips`). Both must normalise to the base bone name.
const PREFIX_RE = /^mixamorig\d*:?/;
// GLTFLoader.createUniqueName appends `_N` to duplicate node names (one per
// baked-in armature). After dedupeSkeletons only one skeleton survives, so the
// suffix is pure noise and must be stripped to recover the base bone name.
const SUFFIX_RE = /_\d+$/;

// Manual override for the auto-computed scale, in case a clip ever needs a
// nudge. 1.0 = trust the auto measurement. Logged to the console on load.
export const RETARGET_SCALE_OVERRIDE = 1.0;

// Strip the Mixamo namespace prefix AND any GLTFLoader `_N` dedup suffix from
// a single node name, leaving the bare base bone name (`Hips`, `Spine`, ...).
export function stripPrefix(name) {
  return typeof name === 'string'
    ? name.replace(PREFIX_RE, '').replace(SUFFIX_RE, '')
    : name;
}

// A KeyframeTrack name is `<nodeName>.<property>`. sanitiseNodeName strips any
// `.` from node names, so the first `.` cleanly separates the two. Normalise
// only the node portion (and only when it is a Mixamo bone) so the track
// addresses the same bare base name the bone now carries.
function stripTrackNode(trackName) {
  const dot = trackName.indexOf('.');
  const node = dot < 0 ? trackName : trackName.slice(0, dot);
  if (!PREFIX_RE.test(node)) return trackName;   // leave non-Mixamo tracks alone
  const rest = dot < 0 ? '' : trackName.slice(dot);
  return stripPrefix(node) + rest;
}

// Rename every bone on `root` and every track on `clips` so they share the
// same un-prefixed bone names. Run this once per rig at load time (before
// any AnimationMixer binds), so character clips and imported clips agree.
export function normalizeRig(root, clips = []) {
  if (root && typeof root.traverse === 'function') {
    root.traverse((obj) => {
      if (obj.name && PREFIX_RE.test(obj.name)) obj.name = stripPrefix(obj.name);
    });
  }
  clips.forEach((clip) => {
    if (!clip || !clip.tracks) return;
    clip.tracks.forEach((track) => {
      if (track.name) track.name = stripTrackNode(track.name);
    });
  });
}

// These Mixamo -> Blender -> GLB exports bake SEVERAL duplicate armatures into
// one file (here: one per source animation — Armature, Armature.001, Crawl,
// LowWalk, Run, WallWalk), but only a single armature actually drives the
// visible SkinnedMeshes. Every duplicate shares the same bone names, so
// THREE.PropertyBinding resolves a track like `Hips.quaternion` to the FIRST
// match in traversal order — usually a boneless leftover armature no mesh is
// skinned to. The clip then "binds" without any warning yet deforms nothing,
// so the character appears frozen in its rest pose. Dropping every top-level
// subtree that contains neither a SkinnedMesh nor a bone one is skinned to
// leaves exactly one skeleton, so all clips (built-in and imported) bind to the
// bones the visible mesh actually uses.
export function dedupeSkeletons(root) {
  if (!root || !root.children || !root.children.length) return root;

  // Every bone object a visible SkinnedMesh is actually weighted to.
  const usedBones = new Set();
  let skinnedCount = 0;
  root.traverse((o) => {
    if (o.isSkinnedMesh && o.skeleton) {
      skinnedCount += 1;
      o.skeleton.bones.forEach((b) => usedBones.add(b));
    }
  });
  if (skinnedCount === 0) return root;   // nothing to disambiguate

  const subtreeIsUsed = (node) => {
    let used = false;
    node.traverse((o) => { if (!used && (o.isSkinnedMesh || usedBones.has(o))) used = true; });
    return used;
  };

  let removed = 0;
  for (let i = root.children.length - 1; i >= 0; i--) {
    const child = root.children[i];
    if (!subtreeIsUsed(child)) { root.remove(child); removed += 1; }
  }
  if (removed) console.log(`[rig] removed ${removed} duplicate armature(s); kept ${root.children.length}`);
  return root;
}

// Scratch objects reused across every retarget (no per-clip allocation).
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

// The imported FBX and the target character are the same Mixamo skeleton in
// the same units (centimetres at the bone level), but their HIPS bone lives in
// a different local frame: the loose FBX is Y-up (Hips rest rotation =
// identity, Hips position ~[0, 96, 0]) while our GLBs were exported through
// Blender, which puts the armature under an R_x(+90°) root and counter-rotates
// the Hips by R_x(-90°) so its rest position is ~[0, 0, -96] (height on -Z).
//
// The Hips is the ONLY bone whose frame differs — it's the one directly under
// the re-oriented root. Every bone below it (Spine, arms, legs, head) shares
// the standard Mixamo local frame, so their rotation tracks transfer verbatim
// and Mixamo authors them rotation-only anyway (no position channels).
//
// So to retarget we only touch the two Hips tracks:
//   position   -> rotate by `rotFix` (FBX frame -> target frame) and rescale
//                 from the FBX hip height to the target hip height (~0.995).
//   quaternion -> premultiply by `rotFix` so the torso leans/turns correctly.
// `rotFix` is derived from the two Hips rest rotations, so it stays correct
// even if an export ever flips the convention.
function retargetHips(clip, srcRig, dstRig) {
  const src = srcRig && srcRig.getObjectByName ? srcRig.getObjectByName('Hips') : null;
  const dst = dstRig && dstRig.getObjectByName ? dstRig.getObjectByName('Hips') : null;
  if (!src || !dst) {
    console.warn('[rig] could not find a Hips bone on both rigs — skipping hips retarget');
    return 1;
  }

  // Rotation that carries the FBX Hips local frame into the target Hips frame.
  const rotFix = dst.quaternion.clone().multiply(src.quaternion.clone().invert());

  // Both hip heights are bone-local magnitudes, so their ratio is the exact
  // motion scale (immune to the armature's 0.01 unit conversion, which sits
  // above the Hips and never touches these track values).
  const srcLen = src.position.length();
  const dstLen = dst.position.length();
  const scale = (srcLen > 1e-4 && dstLen > 1e-4)
    ? (dstLen / srcLen) * RETARGET_SCALE_OVERRIDE
    : RETARGET_SCALE_OVERRIDE;

  clip.tracks.forEach((track) => {
    const dot = track.name.indexOf('.');
    if (dot < 0) return;
    if (track.name.slice(0, dot) !== 'Hips') return;   // only the Hips needs fixing
    const prop = track.name.slice(dot + 1);
    const v = track.values;
    if (prop === 'position') {
      for (let i = 0; i < v.length; i += 3) {
        _v.set(v[i], v[i + 1], v[i + 2]).applyQuaternion(rotFix).multiplyScalar(scale);
        v[i] = _v.x; v[i + 1] = _v.y; v[i + 2] = _v.z;
      }
    } else if (prop === 'quaternion') {
      for (let i = 0; i < v.length; i += 4) {
        _q.set(v[i], v[i + 1], v[i + 2], v[i + 3]).premultiply(rotFix);
        v[i] = _q.x; v[i + 1] = _q.y; v[i + 2] = _q.z; v[i + 3] = _q.w;
      }
    }
  });

  return scale;
}

// Load a Mixamo motion-only FBX and return its clip, retargeted to drive
// `targetRig` (a normalized character model). `clipName` is what the caller
// registers it under in that character's action map.
export async function loadRetargetedClip(url, targetRig, clipName) {
  const fbx = await fbxLoader.loadAsync(url);
  fbx.updateMatrixWorld(true);

  const clip = (fbx.animations && fbx.animations[0]) || null;
  if (!clip) {
    console.warn(`[rig] ${url} contained no animation`);
    return null;
  }

  // Normalize the FBX skeleton + clip so its Hips can be found by base name
  // and so every track addresses the target's bones by base name.
  normalizeRig(fbx, fbx.animations);

  const scale = retargetHips(clip, fbx, targetRig);

  clip.name = clipName;
  console.log(`[rig] ${clipName} retargeted: hipsScale=${scale.toFixed(4)} tracks=${clip.tracks.length} dur=${clip.duration.toFixed(2)}s`);
  return clip;
}
