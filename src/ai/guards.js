import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
let guardTemplate = null; // { scene, animations } — loaded ONCE, shared by all guards

// Call this once and await it BEFORE creating any GuardA/GuardB instances.
// Path is relative (no leading "/") — required for the LAMP server's
// subdirectory hosting, same reason as vite.config.js's base: './'.
export async function loadGuardModel(url = './assets/models/guard_character.glb') {
  if (guardTemplate) return guardTemplate;
  const gltf = await loader.loadAsync(url);
  guardTemplate = { scene: gltf.scene, animations: gltf.animations };

  // Print the exact clip names your file actually exported — Blender/Mixamo
  // naming has been inconsistent this whole project, so check this against
  // what the code below expects (Idle / Walk / Run) rather than assuming.
  console.log('Guard model animations found:', gltf.animations.map(c => c.name));

  return guardTemplate;
}
// Returns the loaded guard template so other systems (e.g. player disguise)
// can clone the guard model. Returns null if not loaded yet.
export function getGuardTemplate() {
  return guardTemplate;
}
// Builds one independent, animatable copy of the shared template.
// Falls back to the old placeholder capsule if the model hasn't loaded yet,
// so a missing/failed load doesn't silently crash guard creation.
function makeGuardBody() {
  if (!guardTemplate) {
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.3, 1.2, 4, 12),
      new THREE.MeshStandardMaterial({
        color: 0x2b3a67,
        emissive: 0x3d5a99,
        emissiveIntensity: 0.6,
      })
    );
    body.position.y = 0.9;
    return { body, mixer: null, actions: {} };
  }

  const body = SkeletonUtils.clone(guardTemplate.scene);
  const mixer = new THREE.AnimationMixer(body);
  const actions = {};
  guardTemplate.animations.forEach((clip) => {
    actions[clip.name] = mixer.clipAction(clip);
  });
  return { body, mixer, actions };
}

// Crossfades from whatever's currently playing to a new named clip.
// Shared by both guard classes — attach as a method via Object.assign below,
// or just copy this pattern if you split the files later.
function playAction(entity, name, fadeTime = 0.25) {
  const next = entity.actions[name];
  if (!next) return; // clip not found — likely a naming mismatch, check the console log above
  if (entity.currentAction === next) return; // already playing, don't restart it

  if (entity.currentAction) entity.currentAction.fadeOut(fadeTime);
  next.reset().fadeIn(fadeTime).play();
  entity.currentAction = next;
}

// GUARD A — stationary at the reception desk. Takedown + uniform loot target.
export class GuardA {
  constructor(scene, game, position) {
    this.game = game;
    this.down = false;
    this.hasKey = false;
    this.idleTime = 0;
    this.interactDistance = 1.8;

    this.group = new THREE.Group();
    this.group.name = 'GuardA';

    const { body, mixer, actions } = makeGuardBody();
    this.body = body;
    this.mixer = mixer;
    this.actions = actions;
    this.currentAction = null;
    this.group.add(this.body);

    this.group.position.copy(position);
    this.baseRotation = Math.atan2(-position.x, -position.z);
    this.group.rotation.y = this.baseRotation;
    scene.add(this.group);

    if (this.mixer) playAction(this, 'Idle');

    this._tmp = new THREE.Vector3();
  }

  horizDistanceTo(playerPos) {
    this._tmp.subVectors(playerPos, this.group.position);
    this._tmp.y = 0;
    return this._tmp.length();
  }

  update(dt) {
    this.mixer?.update(dt);
    if (this.down) return;

    // Manual idle sway is now only a fallback for the placeholder capsule —
    // the real model's Idle animation already handles this once it's loaded.
    if (!this.mixer) {
      this.idleTime += dt;
      this.group.rotation.y = this.baseRotation + Math.sin(this.idleTime * 0.5) * 0.15;
    }
  }

   getPrompt(playerPos) {
    if (this.horizDistanceTo(playerPos) > this.interactDistance) return null;
    if (!this.down) return '[E] Take down guard';
    if (!this.hasKey) return '[E] Take key';
    return null;
  }

  tryInteract(playerPos) {
    if (this.horizDistanceTo(playerPos) > this.interactDistance) return false;
    if (!this.down) { this.takeDown(); return true; }
    if (!this.hasKey) { this.takeKey(); return true; }
    return false;
  }

  takeDown() {
    this.down = true;
    this.game.guardADown = true;
    // Stop idle sway and rotation
    this.group.rotation.y = this.baseRotation;
    // Rotate the body mesh itself to lie flat on the ground
    if (this.body) {
      this.body.rotation.x = -Math.PI / 2; // tip forward onto front
      this.body.position.y = 0.3; // lower so it sits on floor
    }
    // Also stop any playing animation
    if (this.mixer) {
      this.mixer.stopAllAction();
    }
  }

   takeKey() {
    this.hasKey = true;
    this.game.hasKey = true;
  }

    reset() {
    this.down = false;
    this.looted = false;
    this.idleTime = 0;
    this.group.rotation.z = 0;
    this.group.rotation.y = this.baseRotation;
    // Reset body mesh — GLTF model origin is at feet, not center
    if (this.body) {
      this.body.rotation.x = 0;
      this.body.rotation.y = 0;
      this.body.rotation.z = 0;
      this.body.position.set(0, 0, 0);
    }
    // Restart idle animation
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.currentAction = null;
      playAction(this, 'Idle');
    }
  }
}

// GUARD B — patrols, sees the player, raises the alarm, then chases.
export class GuardB {
  constructor(scene, waypoints, colliders, game, options = {}) {
    this.waypoints = waypoints;
    this.colliders = colliders;
    this.game = game;
    this.partnerCheckIndex = options.partnerCheckIndex ?? -1;
    // Reuses the exact same collision system as the player (same colliders,
    // same boxes) rather than duplicating it here. Falls back to "never
    // blocked" if main.js doesn't pass one, so nothing breaks if omitted.
    this.checkCollision = options.checkCollision || (() => false);

    this.state = 'patrol';
    this.speed = 0.65;
    this.chaseSpeed = 2.4;
    this.pauseTime = 2;
    this.index = 0;
    this.pauseTimer = 0;

    this.visionRange = 9;
    this.visionRangeDisguised = 4;
    this.visionHalfAngle = THREE.MathUtils.degToRad(50);
    this.closeRange = 2.5;
    this.checkInterval = 0.1;
    this.checkTimer = 0;
    this.catchDistance = 1.2;

    // Stuck-recovery: straight-line steering has no pathfinding, so he can
    // wedge against a wall corner or furniture edge. Not real navigation —
    // just a fallback so he doesn't freeze in place when that happens.
    this._stuckTime = 0;

    this._dir = new THREE.Vector3();
    this._toPlayer = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._eye = new THREE.Vector3();
    this.raycaster = new THREE.Raycaster();

    this.group = new THREE.Group();
    this.group.name = 'GuardB';

    const { body, mixer, actions } = makeGuardBody();
    this.body = body;
    this.mixer = mixer;
    this.actions = actions;
    this.currentAction = null;
    this.group.add(this.body);

    this.group.position.copy(waypoints[0]);
    this.faceWaypoint(1);
    scene.add(this.group);

    if (this.mixer) playAction(this, 'Idle');
  }

  faceWaypoint(i) {
    const target = this.waypoints[i % this.waypoints.length];
    this._dir.subVectors(target, this.group.position);
    this._dir.y = 0;
    if (this._dir.lengthSq() > 0) {
      this.group.rotation.y = Math.atan2(this._dir.x, this._dir.z);
    }
  }

  update(dt, playerPos) {
    this.mixer?.update(dt);

    if (this.state !== 'chase' && this.game.alarmActive) {
      this.state = 'chase';
    }
    if (this.state === 'chase') {
      if (this.mixer) playAction(this, 'Run');
      this.updateChase(dt, playerPos);
      return;
    }

    this.checkTimer += dt;
    if (this.checkTimer >= this.checkInterval) {
      this.checkTimer = 0;
      if (this.canSeePlayer(playerPos)) {
        this.game.triggerAlarm('player_spotted');
        return;
      }
    }

    if (this.state === 'pause') {
      if (this.mixer) playAction(this, 'Idle');
      this.pauseTimer -= dt;
      if (this.pauseTimer <= 0) {
        this.index = (this.index + 1) % this.waypoints.length;
        this.state = 'patrol';
      }
      return;
    }

    if (this.mixer) playAction(this, 'Walk');
    this._dir.subVectors(this.waypoints[this.index], this.group.position);
    this._dir.y = 0;
    if (this._dir.length() > 0.15) {
      this._dir.normalize();
      const step = this.speed * dt;
      const nextX = this.group.position.x + this._dir.x * step;
      const nextZ = this.group.position.z + this._dir.z * step;
      const blockedX = this.checkCollision(nextX, this.group.position.z);
      const blockedZ = this.checkCollision(this.group.position.x, nextZ);
      if (!blockedX) this.group.position.x = nextX;
      if (!blockedZ) this.group.position.z = nextZ;

      this._stuckTime = (blockedX && blockedZ) ? this._stuckTime + dt : 0;
      if (this._stuckTime > 0.4) {
        // Fully wedged — sidestep 90° from his intended direction until clear
        const perpX = this._dir.z;
        const perpZ = -this._dir.x;
        const sideX = this.group.position.x + perpX * step;
        const sideZ = this.group.position.z + perpZ * step;
        if (!this.checkCollision(sideX, this.group.position.z)) this.group.position.x = sideX;
        if (!this.checkCollision(this.group.position.x, sideZ)) this.group.position.z = sideZ;
      }

      this.group.rotation.y = Math.atan2(this._dir.x, this._dir.z);
    } else {
      this.arriveAtWaypoint();
    }
  }

  arriveAtWaypoint() {
    if (this.index === this.partnerCheckIndex && this.game.guardADown) {
      this.game.triggerAlarm('partner_found');
    }
    this.state = 'pause';
    this.pauseTimer = this.pauseTime;
  }

  canSeePlayer(playerPos) {
    this._toPlayer.subVectors(playerPos, this.group.position);
    this._toPlayer.y = 0;
    const dist = this._toPlayer.length();
    const range = this.game.hasDisguise ? this.visionRangeDisguised : this.visionRange;
    const withinRange = dist < range;
    const tooClose = dist < this.closeRange;
    if (!withinRange && !tooClose) return false;

    this._toPlayer.normalize();

    this._forward.set(Math.sin(this.group.rotation.y), 0, Math.cos(this.group.rotation.y));
    const inCone = this._forward.dot(this._toPlayer) > Math.cos(this.visionHalfAngle);
    if (!inCone && !tooClose) return false;

    this._eye.set(this.group.position.x, 1.6, this.group.position.z);
    this.raycaster.set(this._eye, this._toPlayer);
    this.raycaster.far = dist;
    return this.raycaster.intersectObjects(this.colliders, false).length === 0;
  }

  updateChase(dt, playerPos) {
    this._dir.subVectors(playerPos, this.group.position);
    this._dir.y = 0;
    const dist = this._dir.length();
    if (dist < this.catchDistance) {
      this.game.onCaught();
      return;
    }
    this._dir.normalize();
    const step = this.chaseSpeed * dt;
    const nextX = this.group.position.x + this._dir.x * step;
    const nextZ = this.group.position.z + this._dir.z * step;
    const blockedX = this.checkCollision(nextX, this.group.position.z);
    const blockedZ = this.checkCollision(this.group.position.x, nextZ);
    if (!blockedX) this.group.position.x = nextX;
    if (!blockedZ) this.group.position.z = nextZ;

    this._stuckTime = (blockedX && blockedZ) ? this._stuckTime + dt : 0;
    if (this._stuckTime > 0.4) {
      const perpX = this._dir.z;
      const perpZ = -this._dir.x;
      const sideX = this.group.position.x + perpX * step;
      const sideZ = this.group.position.z + perpZ * step;
      if (!this.checkCollision(sideX, this.group.position.z)) this.group.position.x = sideX;
      if (!this.checkCollision(this.group.position.x, sideZ)) this.group.position.z = sideZ;
    }

    this.group.rotation.y = Math.atan2(this._dir.x, this._dir.z);
  }

  reset() {
    this.state = 'patrol';
    this.index = 0;
    this.pauseTimer = 0;
    this.checkTimer = 0;
    this._stuckTime = 0;
    this.group.position.copy(this.waypoints[0]);
    this.faceWaypoint(1);
    if (this.mixer) playAction(this, 'Idle');
  }
}