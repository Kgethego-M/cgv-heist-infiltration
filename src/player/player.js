import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();

// Loaded once. Only one player exists, so unlike guards.js we don't need
// SkeletonUtils.clone() here — there's nothing to duplicate.
export async function loadPlayerModel(url = './assets/models/player_character.glb') {
  const gltf = await loader.loadAsync(url);
  console.log('Player model animations found:', gltf.animations.map(c => c.name));
  return gltf;
}

// If your character walks backwards or sideways relative to the camera once
// this is in-game, rotate this by Math.PI (or +/- Math.PI / 2) — Mixamo
// exports don't all agree on which way "forward" faces.
const MODEL_YAW_OFFSET = 0;

export class Player {
  constructor(scene, gltf) {
    this.group = new THREE.Group();
    this.group.name = 'Player';

    this.model = gltf.scene;
    this.model.rotation.y = MODEL_YAW_OFFSET;
    this.group.add(this.model);

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    gltf.animations.forEach((clip) => {
      this.actions[clip.name] = this.mixer.clipAction(clip);
    });
    this.currentAction = null;

  this.playAction('Idle');

    scene.add(this.group);
  }

  playAction(name, fadeTime = 0.2) {
    const next = this.actions[name];
    if (!next) return; // name mismatch — check the console log from loadPlayerModel
    if (this.currentAction === next && !next.paused) return;

    if (this.currentAction) this.currentAction.fadeOut(fadeTime);
    next.reset().fadeIn(fadeTime).play();
    next.paused = false;
    this.currentAction = next;
  }

  // Freezes the current pose rather than looping — used for the Idle stand-in.
  freezeIdle() {
    if (!this.currentAction) return;
    this.currentAction.paused = true;
    this.currentAction.time = 0;
  }

  update(dt) {
    this.mixer.update(dt);
  }
}
