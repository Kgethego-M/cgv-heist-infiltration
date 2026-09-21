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
    this._isDisguised = false;

    this.playAction('Idle');
    scene.add(this.group);
  }

  // Swap player model to guard model (or back)
    setDisguised(disguised) {
    if (this._isDisguised === disguised) return;
    this._isDisguised = disguised;

    this.model.traverse((child) => {
      if (child.isMesh && child.material) {
        if (disguised) {
          if (!child.material._origColor) child.material._origColor = child.material.color.clone();
          if (!child.material._origMap) child.material._origMap = child.material.map || null;
          if (!child.material._origEmissive) child.material._origEmissive = child.material.emissive ? child.material.emissive.clone() : null;
          if (!child.material._origEmissiveIntensity) child.material._origEmissiveIntensity = child.material.emissiveIntensity ?? 0;
          if (!child.material._origNormalMap) child.material._origNormalMap = child.material.normalMap || null;
          child.material.map = null;
          child.material.normalMap = null;
          child.material.color.setHex(0x2b3a67);
          child.material.emissive = new THREE.Color(0x3d5a99);
          child.material.emissiveIntensity = 0.6;
          child.material.needsUpdate = true;
        } else {
          if (child.material._origColor) child.material.color.copy(child.material._origColor);
          if (child.material._origMap !== undefined) child.material.map = child.material._origMap;
          if (child.material._origEmissive) child.material.emissive.copy(child.material._origEmissive);
          if (child.material._origEmissiveIntensity !== undefined) child.material.emissiveIntensity = child.material._origEmissiveIntensity;
          if (child.material._origNormalMap !== undefined) child.material.normalMap = child.material._origNormalMap;
          child.material.needsUpdate = true;
        }
      }
    });
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