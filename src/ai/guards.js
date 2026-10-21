import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { normalizeRig, loadRetargetedClip, dedupeSkeletons } from '../animation/rig.js';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
let guardTemplate = null; // { scene, animations } — loaded ONCE, shared by all guards

// Call this once and await it BEFORE creating any GuardA/GuardB instances.
// Path is relative (no leading "/") — required for the LAMP server's
// subdirectory hosting, same reason as vite.config.js's base: './'.
export async function loadGuardModel(url = './assets/models/guard_character.glb') {
  if (guardTemplate) return guardTemplate;
  const gltf = await loader.loadAsync(url);
  // This GLB ships several duplicate armatures; keep only the one the visible
  // meshes are skinned to, or animation tracks bind to an invisible skeleton.
  dedupeSkeletons(gltf.scene);
  // Strip the `mixamorigN:` bone namespace so loose Mixamo FBX clips (die)
  // retarget onto the guard rig by base bone name. See animation/rig.js.
  normalizeRig(gltf.scene, gltf.animations);
  guardTemplate = { scene: gltf.scene, animations: gltf.animations };

  // Print the exact clip names your file actually exported — Blender/Mixamo
  // naming has been inconsistent this whole project, so check this against
  // what the code below expects (Idle / Walk / Run) rather than assuming.
  console.log('Guard model animations found:', gltf.animations.map(c => c.name));

  return guardTemplate;
}

// Imports one motion-only Mixamo FBX and adds it to the SHARED guard template
// so every guard cloned afterwards gets it in its action map. MUST be awaited
// before constructing GuardA/GuardB (makeGuardBody snapshots the clip list).
export async function attachGuardClip(url, name) {
  if (!guardTemplate) throw new Error('attachGuardClip called before loadGuardModel()');
  const clip = await loadRetargetedClip(url, guardTemplate.scene, name);
  if (clip) guardTemplate.animations.push(clip);
  return clip;
}

// Returns the loaded guard template so other systems can clone the guard model. Returns null if not loaded yet.
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
  body.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
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

// GUARD A — stationary at the reception desk. Takedown target; carries the
// key to the Manager's Office.
export class GuardA {
  constructor(scene, game, position, options = {}) {
    this.game = game;
    this.down = false;
    this.hasKey = false;
    this.idleTime = 0;
    this.interactDistance = 1.8;
    // Yaw snapped to at the instant the Die clip starts. That clip carries the
    // body ~0.88 m forward along the rig's local +Z, so this facing alone
    // decides where the corpse lands. Null = keep baseRotation (see takeDown).
    this.fallYaw = options.fallYaw ?? null;

    this.group = new THREE.Group();
    this.group.name = 'GuardA';

    const { body, mixer, actions } = makeGuardBody();
    this.body = body;
    this.mixer = mixer;
    this.actions = actions;
    this.currentAction = null;
    this.group.add(this.body);

    this.group.position.copy(position);
    // faceRotation overrides the default "face the origin" calculation so the
    // guard can be turned to face away from the player's approach direction.
    this.baseRotation = options.faceRotation ?? Math.atan2(-position.x, -position.z);
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

  // Turn to face a world position (used so the guard meets the player's punch
  // head-on before the death animation plays, instead of staring at the desk).
  facePoint(pos) {
    const dx = pos.x - this.group.position.x;
    const dz = pos.z - this.group.position.z;
    if (dx * dx + dz * dz > 1e-4) this.group.rotation.y = Math.atan2(dx, dz);
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
    // Stop the idle sway. NOTE: this also overrides the facePoint() that
    // startTakedown() applied for the punches — deliberate, because the Die
    // clip throws the body forward along wherever he is facing, and facing the
    // player (who approaches from the open lobby) would drive him back into
    // the reception desk. fallYaw is chosen against the level geometry.
    this.group.rotation.y = this.fallYaw ?? this.baseRotation;

    const die = this.actions && this.actions['Die'];
    if (die && this.mixer) {
      // Play the retargeted Mixamo death clip once and clamp on the final
      // (fallen) frame so the body stays down. The mixer keeps ticking in
      // update() while `down`, which is what holds the clamped pose.
      if (this.currentAction && this.currentAction !== die) this.currentAction.fadeOut(0.12);
      die.reset();
      die.setLoop(THREE.LoopOnce, 1);
      die.clampWhenFinished = true;
      die.fadeIn(0.05).play();
      this.currentAction = die;
      return;
    }

    // Fallback (FBX failed to load): tip the body flat, as before. Guard A
    // faces away from the reception desk, so +90° lays him out into the open
    // floor rather than back into the desk.
    if (this.body) {
      this.body.rotation.x = Math.PI / 2;
      this.body.position.y = 0.3; // lower so it sits on floor
    }
    if (this.mixer) this.mixer.stopAllAction();
  }

   takeKey() {
    this.hasKey = true;
    this.game.hasKey = true;
  }

    reset() {
    this.down = false;
    this.hasKey = false; // without this, the key can never be taken again after a retry
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
// Enhanced: better wall avoidance (turns when stuck), confused state with
// "?" marker when player hides unseen, and cupboard investigation.
export class GuardB {
  constructor(scene, waypoints, colliders, game, options = {}) {
    this.waypoints = waypoints;
    this.colliders = colliders;
    this.game = game;
    this.partnerCheckIndex = options.partnerCheckIndex ?? -1;
    this.cupboardPosition = options.cupboardPosition || null;
    this.managerDoorPosition = options.managerDoorPosition || null;
    this.checkCollision = options.checkCollision || (() => false);

    this.state = 'patrol';
    this.speed = 0.65;
    this.chaseSpeed = 2.4;
    this.pauseTime = 2;
    this.index = 0;
    this.pauseTimer = 0;

    this.visionRange = 9;
    this.visionHalfAngle = THREE.MathUtils.degToRad(50);
    this.closeRange = 2.5;
    this.checkInterval = 0.1;
    this.checkTimer = 0;
    this.catchDistance = 1.2;

    // True from the frame the guard visually confirms the player stepping
    // into the cupboard until the player exits or the level resets.
    this.sawPlayerHide = false;
    // Set when the guard enters the "confused" search state (player hid
    // unseen). Drives the "?" marker above the head.
    this.isConfused = false;
    this.confusedTimer = 0;
    this.confusedDuration = 8; // seconds of milling about before resuming patrol

    this._stuckTime = 0;
    this._turnCooldown = 0;

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

    // Question-mark sprite above the head (confused state indicator)
    this.questionMark = this._makeQuestionMark();
    this.questionMark.visible = false;
    this.group.add(this.questionMark);

    this.group.position.copy(waypoints[0]);
    this.faceWaypoint(1);
    scene.add(this.group);

    if (this.mixer) playAction(this, 'Idle');
  }

  _makeQuestionMark() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffee33';
    ctx.font = 'bold 56px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', 32, 30);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.5, 0.5, 1);
    sprite.position.set(0, 2.4, 0);
    sprite.name = 'guardQuestionMark';
    return sprite;
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
    this._turnCooldown = Math.max(0, this._turnCooldown - dt);

    // If the player is hidden and the guard did NOT see them enter,
    // the guard cannot spot them — skip vision checks entirely.
    const playerInvisible = this.game.playerHidden;

    // Alarm escalation: if the alarm is active and the guard isn't already
    // chasing, confused, or heading to the office, start the chase.
    if (this.state !== 'chase' && this.state !== 'confused' && this.state !== 'goToOffice' && this.game.alarmActive) {
      this.state = 'chase';
    }

    // If the player just hid and the guard saw it, investigate the cupboard
    if (this.game.isHidden && this.sawPlayerHide && this.state !== 'investigateCupboard') {
      this.state = 'investigateCupboard';
    }

    // goToOffice: player hid unseen, guard runs to the manager's office then becomes confused
    if (this.state === 'goToOffice') {
      if (this.mixer) playAction(this, 'Run');
      const target = this.managerDoorPosition || this.cupboardPosition || this.waypoints[this.waypoints.length - 1];
      const dist = this._moveToward(target, this.chaseSpeed, dt);
      if (dist < 1.5) {
        this.state = 'confused';
        this.isConfused = true;
        this.confusedTimer = this.confusedDuration;
      }
      return;
    }

    // Confused state: player hid unseen, guard reached the area but lost them
    if (this.state === 'confused') {
      if (this.mixer) playAction(this, 'Idle');
      this.questionMark.visible = true;
      this.confusedTimer -= dt;
      // Slowly look around (yaw oscillation)
      this.group.rotation.y += Math.sin(this.confusedTimer * 2) * 0.02;
      if (this.confusedTimer <= 0) {
        this.isConfused = false;
        this.questionMark.visible = false;
        this.state = 'patrol';
        this.index = (this.index + 1) % this.waypoints.length;
      }
      return;
    }

    // Investigate cupboard: run to the cupboard position and catch the player
    if (this.state === 'investigateCupboard') {
      if (this.mixer) playAction(this, 'Run');
      if (this.cupboardPosition) {
        const dist = this._moveToward(this.cupboardPosition, this.chaseSpeed, dt);
        if (dist < 1.0) {
          // Reached the cupboard — catch the hidden player
          this.game.onCaught('cupboard_found', 'The guard found you in the cupboard!');
          return;
        }
      }
      return;
    }

    if (this.state === 'chase') {
      if (this.mixer) playAction(this, 'Run');
      this.updateChase(dt, playerPos);
      return;
    }

    // Vision check — only if the player is visible
    this.checkTimer += dt;
    if (this.checkTimer >= this.checkInterval) {
      this.checkTimer = 0;
      if (!playerInvisible && this.canSeePlayer(playerPos)) {
        // Check if the player is at the cupboard (hiding)
        if (this.game.isHidden) {
          this.sawPlayerHide = true;
        }
        this.game.triggerAlarm('player_spotted');
        return;
      }
    }

    // If the player just entered the cupboard and we can currently see them
    // (they haven't fully disappeared yet), record that we saw them hide.
    if (this.game.isHidden && !playerInvisible && !this.sawPlayerHide) {
      if (this.canSeePlayer(playerPos)) {
        this.sawPlayerHide = true;
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
        // Fully wedged — turn 90 degrees to find a clear direction
        if (this._turnCooldown <= 0) {
          this.group.rotation.y += (Math.random() > 0.5 ? 1 : -1) * Math.PI / 2;
          this._turnCooldown = 0.6;
          this._stuckTime = 0;
        }
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

  _moveToward(target, speed, dt) {
    this._dir.set(target.x - this.group.position.x, 0, target.z - this.group.position.z);
    const dist = this._dir.length();
    if (dist < 0.1) return dist;
    this._dir.normalize();
    const step = speed * dt;
    const nextX = this.group.position.x + this._dir.x * step;
    const nextZ = this.group.position.z + this._dir.z * step;
    const blockedX = this.checkCollision(nextX, this.group.position.z);
    const blockedZ = this.checkCollision(this.group.position.x, nextZ);
    if (!blockedX) this.group.position.x = nextX;
    if (!blockedZ) this.group.position.z = nextZ;

    this._stuckTime = (blockedX && blockedZ) ? this._stuckTime + dt : 0;
    if (this._stuckTime > 0.4 && this._turnCooldown <= 0) {
      this.group.rotation.y += (Math.random() > 0.5 ? 1 : -1) * Math.PI / 2;
      this._turnCooldown = 0.6;
      this._stuckTime = 0;
    }

    this.group.rotation.y = Math.atan2(this._dir.x, this._dir.z);
    return dist;
  }

  arriveAtWaypoint() {
    if (this.index === this.partnerCheckIndex && this.game.guardADown) {
      this.game.triggerAlarm('partner_found');
    }
    // If the player just hid and we didn't see it, head to the office confused
    if (this.game.playerHidden && !this.sawPlayerHide) {
      this.state = 'goToOffice';
      return;
    }
    this.state = 'pause';
    this.pauseTimer = this.pauseTime;
  }

  canSeePlayer(playerPos) {
    // If the player is successfully hidden (guard didn't see them enter), skip
    if (this.game.playerHidden) return false;

    this._toPlayer.subVectors(playerPos, this.group.position);
    this._toPlayer.y = 0;
    const dist = this._toPlayer.length();
    const withinRange = dist < this.visionRange;
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
    // If the player is hidden and the guard didn't see them hide,
    // lose the chase and head to the office to search
    if (this.game.playerHidden && !this.sawPlayerHide) {
      this.state = 'goToOffice';
      return;
    }

    const dist = this._moveToward(playerPos, this.chaseSpeed, dt);
    if (dist < this.catchDistance) {
      this.game.onCaught();
    }
  }

  reset() {
    this.state = 'patrol';
    this.index = 0;
    this.pauseTimer = 0;
    this.checkTimer = 0;
    this._stuckTime = 0;
    this._turnCooldown = 0;
    this.sawPlayerHide = false;
    this.isConfused = false;
    this.confusedTimer = 0;
    this.questionMark.visible = false;
    this.group.position.copy(this.waypoints[0]);
    this.faceWaypoint(1);
    if (this.mixer) playAction(this, 'Idle');
  }
}