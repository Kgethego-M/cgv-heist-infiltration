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

    // Store original player model data for restoring after disguise
    this._originalModel = gltf.scene;
    this._originalModel.rotation.y = MODEL_YAW_OFFSET;
    this._originalAnimations = gltf.animations;

    this.model = this._originalModel;
    this.group.add(this.model);

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    this._setupActions(this._originalAnimations);

    this._isDisguised = false;
    this._guardMixer = null;
    this._guardActions = {};

    this.playAction('Idle');
    scene.add(this.group);
  }

  _setupActions(animations) {
    this.actions = {};
    animations.forEach((clip) => {
      this.actions[clip.name] = this.mixer.clipAction(clip);
    });
  }

  // Swap player model to guard model (or back)
  setDisguised(disguised, guardTemplate) {
    if (this._isDisguised === disguised) return;
    this._isDisguised = disguised;

    // Remove current model
    this.group.remove(this.model);
    if (this.mixer) this.mixer.stopAllAction();

    if (disguised && guardTemplate) {
      // Clone guard model
      this.model = SkeletonUtils.clone(guardTemplate.scene);
      this.model.rotation.y = MODEL_YAW_OFFSET;
      this.group.add(this.model);

      // Set up guard animations
      this._guardMixer = new THREE.AnimationMixer(this.model);
      this._guardActions = {};
      guardTemplate.animations.forEach((clip) => {
        this._guardActions[clip.name] = this._guardMixer.clipAction(clip);
      });
      this.mixer = this._guardMixer;
      this.actions = this._guardActions;
    } else {
      // Restore original player model
      this.model = this._originalModel;
      this.group.add(this.model);

      this.mixer = new THREE.AnimationMixer(this.model);
      this._setupActions(this._originalAnimations);
      this.actions = this.actions; // already set by _setupActions
    }

    this.currentAction = null;
    this.playAction('Idle');
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