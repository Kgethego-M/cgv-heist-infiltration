import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

export async function loadPlayerModel(url = './assets/models/player_character.glb') {
  const gltf = await loader.loadAsync(url);
  console.log('Player model animations found:', gltf.animations.map(c => c.name));
  return gltf;
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

    this.playAction('Idle');
    scene.add(this.group);
  }

  _stabilizeModel(renderer) {
    const maxAniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 4;

    this.model.traverse((obj) => {
      if (!obj.isMesh) return;

      // Skinned meshes use bind-pose bounds, so culling makes parts vanish
      obj.frustumCulled = false;

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