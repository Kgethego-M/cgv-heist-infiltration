import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { normalizeRig, loadRetargetedClip, dedupeSkeletons } from '../animation/rig.js';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

export async function loadPlayerModel(url = './assets/models/player_character.glb') {
  const gltf = await loader.loadAsync(url);
  console.log('Player model animations found:', gltf.animations.map(c => c.name));
  // This GLB ships several duplicate armatures; keep only the one the visible
  // meshes are skinned to, or animation tracks bind to an invisible skeleton.
  dedupeSkeletons(gltf.scene);
  // Strip the `mixamorigN:` bone namespace so loose Mixamo FBX clips (punch /
  // pickup) can be retargeted onto this rig by base bone name. See rig.js.
  normalizeRig(gltf.scene, gltf.animations);
  return gltf;
}

// Imports one motion-only Mixamo FBX and registers it on the player's mixer
// under `name`, rescaled from the FBX's centimetre rig to the player's metre
// rig. Returns the clip so callers can read its duration for choreography.
export async function attachPlayerClip(player, url, name) {
  const clip = await loadRetargetedClip(url, player.model, name);
  if (clip) player.addClip(name, clip);
  return clip;
}

const MODEL_YAW_OFFSET = 0;

export class Player {
  constructor(scene, gltf, renderer = null) {
    this.group = new THREE.Group();
    this.group.name = 'Player';

    this.model = gltf.scene;
    this.model.rotation.y = MODEL_YAW_OFFSET;
    this._stabilizeModel(renderer);
    this.group.add(this.model);

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    gltf.animations.forEach((clip) => {
      this.actions[clip.name] = this.mixer.clipAction(clip);
    });
    this.currentAction = null;
    this._oneShot = null;      // { action, onDone } for the clip currently playing once

    // Looping locomotion clips fire no 'finished' event; one-shot action clips
    // (punch / pickup) do, and that's how the choreography in main.js advances.
    this.mixer.addEventListener('finished', (e) => {
      const os = this._oneShot;
      if (os && e.action === os.action) {
        this._oneShot = null;
        if (os.onDone) os.onDone();
      }
    });

    this.playAction('Idle');
    scene.add(this.group);
  }

  // Register an externally loaded clip (see attachPlayerClip) so playAction /
  // playOneShot can address it by name like any built-in animation.
  addClip(name, clip) {
    if (!clip) return;
    this.actions[name] = this.mixer.clipAction(clip);
  }

  _stabilizeModel(renderer) {
    const maxAniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 4;

    this.model.traverse((obj) => {
      if (!obj.isMesh) return;

      // Skinned meshes use bind-pose bounds, so culling makes parts vanish
      obj.frustumCulled = false;

      // Ground the character in the new shadow pipeline.
      obj.castShadow = true;
      obj.receiveShadow = true;

      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((mat) => {
        if (!mat) return;

        const looksLikeHair = /hair|lash|brow|beard/i.test(mat.name + ' ' + obj.name);
        if (looksLikeHair || (mat.transparent && mat.map)) {
          mat.transparent = false;
          mat.alphaTest = 0.5;
          mat.depthWrite = true;
          mat.side = THREE.DoubleSide;
        }

        ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']
          .forEach((k) => { if (mat[k]) mat[k].anisotropy = maxAniso; });

        mat.needsUpdate = true;
      });
    });
  }

  playAction(name, fadeTime = 0.2) {
    // A one-shot action (punch / pickup) owns the mixer until it finishes —
    // locomotion calls must not stomp on it mid-swing.
    if (this._oneShot) return;
    const next = this.actions[name];
    if (!next) return;
    if (this.currentAction === next && !next.paused) return;

    if (this.currentAction) this.currentAction.fadeOut(fadeTime);
    next.reset();
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = false;
    next.fadeIn(fadeTime).play();
    next.paused = false;
    this.currentAction = next;
  }

  // Play `name` exactly once and call onDone when it ends (or immediately if
  // the clip is missing, so choreography never dead-locks on a bad name).
  playOneShot(name, onDone, fadeTime = 0.12) {
    const next = this.actions[name];
    if (!next) { if (onDone) onDone(); return; }
    if (this.currentAction && this.currentAction !== next) this.currentAction.fadeOut(fadeTime);
    this._oneShot = { action: next, onDone };
    next.reset();
    next.setLoop(THREE.LoopOnce, 1);
    next.clampWhenFinished = true;
    next.fadeIn(fadeTime).play();
    next.paused = false;
    this.currentAction = next;
  }

  // Duration in seconds of a registered clip (0 if unknown) — used to time
  // impact sounds and follow-up beats against the animation.
  clipDuration(name) {
    const a = this.actions[name];
    return a && a.getClip ? a.getClip().duration : 0;
  }

  get busy() { return !!this._oneShot; }

  freezeIdle() {
    if (!this.currentAction) return;
    this.currentAction.paused = true;
    this.currentAction.time = 0;
  }

  update(dt) {
    this.mixer?.update(dt);
  }
}