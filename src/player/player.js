import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const loader = new GLTFLoader();

export async function loadPlayerModel(url = './assets/models/player_character.glb') {
  const gltf = await loader.loadAsync(url);
  console.log('Player model animations found:', gltf.animations.map(c => c.name));
  return gltf;
}

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
    if (!next) return;
    if (this.currentAction === next && !next.paused) return;

    if (this.currentAction) this.currentAction.fadeOut(fadeTime);
    next.reset().fadeIn(fadeTime).play();
    next.paused = false;
    this.currentAction = next;
  }

  freezeIdle() {
    if (!this.currentAction) return;
    this.currentAction.paused = true;
    this.currentAction.time = 0;
  }

  update(dt) {
    this.mixer?.update(dt);
  }
}