import * as THREE from 'three';
import { createLevel1 } from './levels/level1.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GuardA, GuardB, loadGuardModel } from './ai/guards.js';
import { Player, loadPlayerModel } from './player/player.js';

// 1. Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0a);

// 2. Camera — now a THIRD-PERSON follow camera, not the player itself.
// PointerLockControls still owns its rotation (mouse look), but we take over
// its POSITION every frame instead of letting moveForward/moveRight touch it.
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

// 3. Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// 4. Pointer lock controls — we only use this for mouse-look rotation now.
// We deliberately never call controls.moveForward/moveRight; movement below
// is computed manually so it can drive the PLAYER, with the camera following.
const controls = new PointerLockControls(camera, renderer.domElement);
const blocker = document.getElementById('blocker');
blocker.addEventListener('click', () => controls.lock());
controls.addEventListener('lock', () => (blocker.style.display = 'none'));
controls.addEventListener('unlock', () => (blocker.style.display = 'flex'));

// Lights
const ambient = new THREE.AmbientLight(0x1a1a2e, 0.6);
scene.add(ambient);
const pointLight = new THREE.PointLight(0x00ff66, 20, 15);
pointLight.position.set(0, 3, 0);
scene.add(pointLight);

// Resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Keys — added Shift (sprint) and Ctrl (crouch) on top of the existing set.
const keys = {};
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  keys[k] = true;
  if (k === 'e' && !e.repeat) tryInteract();
  if (k === 'v' && !e.repeat) toggleCameraMode();
});
window.addEventListener('keyup', (e) => (keys[e.key.toLowerCase()] = false));

// HUD
const promptEl = document.getElementById('prompt');
const subtitleEl = document.getElementById('subtitle');

const ESCAPE_TIME_LIMIT = 25;
const ELEVATOR_REACH_DISTANCE = 1.8;
const KEYCARD_INTERACT_DISTANCE = 1.6;

const game = {
  guardADown: false,
  hasDisguise: false,
  hasKeycard: false,
  alarmActive: false,
  alarmReason: null,
  levelComplete: false,
  escapeTimeRemaining: null,

  triggerAlarm(reason) {
    if (this.alarmActive) return;
    this.alarmActive = true;
    this.alarmReason = reason;
    this.escapeTimeRemaining = ESCAPE_TIME_LIMIT;

    ambient.color.setHex(0x881111);
    scene.background.setHex(0x220000);

    const alarmSubtitle = reason === 'partner_found'
      ? '"His partner found the body — they know you\u2019re in the building. Elevator, now!"'
      : '"You\u2019ve been spotted — they know you\u2019re in the building. Elevator, now!"';

    showSubtitle(alarmSubtitle);
  },

  onCaught(reason = 'caught') {
    resetLevel();
    const line = reason === 'timeout'
      ? '"Too slow — they\u2019ve got you. Resetting the mission."'
      : '"You\u2019ve been caught — resetting the mission."';
    showSubtitle(line);
  },

  onWin() {
    if (this.levelComplete) return;
    this.levelComplete = true;
    controls.unlock();
    showSubtitle('"Doors are open — go, go!" Level complete.', 8000);
  },
};

let subtitleTimer = null;
function showSubtitle(text, duration = 4000) {
  subtitleEl.textContent = text;
  subtitleEl.style.display = 'block';
  clearTimeout(subtitleTimer);
  subtitleTimer = setTimeout(() => {
    subtitleEl.style.display = 'none';
  }, duration);
}

// LEVEL
const { colliders, elevatorPosition, keycardMesh } = createLevel1(scene);

// Wall collision — one bounding box per collider, computed ONCE here (not
// per frame) and expanded by the player's radius so we can just test a
// single point against it later, rather than doing box-vs-box math every frame.
const PLAYER_RADIUS = 0.4;
const _testPoint = new THREE.Vector3();
const colliderBoxes = colliders.map((mesh) => {
  const box = new THREE.Box3().setFromObject(mesh);
  box.expandByScalar(PLAYER_RADIUS);
  return box;
});

function checkCollision(x, z) {
  _testPoint.set(x, 0.9, z);
  for (let i = 0; i < colliderBoxes.length; i++) {
    if (colliderBoxes[i].containsPoint(_testPoint)) return true;
  }
  return false;
}

const PLAYER_SPAWN = new THREE.Vector3(-4, 0, -4.3); // floor-level now, not eye height

// GUARDS + PLAYER — both models must finish loading before use. Loading them
// together (Promise.all) rather than one after another saves a little time.
const [guardGltfLoaded, playerGltf] = await Promise.all([
  loadGuardModel(),
  loadPlayerModel(),
]);

const player = new Player(scene, playerGltf);
player.group.position.copy(PLAYER_SPAWN);

const guardA = new GuardA(scene, game, new THREE.Vector3(-2.5, 0, 3));

const waypoints = [
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(4, 0, -3),
  new THREE.Vector3(4, 0, 3),
  new THREE.Vector3(-1, 0, 3),
  new THREE.Vector3(0, 0, 8),
  new THREE.Vector3(0, 0, 10.2),
  new THREE.Vector3(0, 0, 8),
];
const guardB = new GuardB(scene, waypoints, colliders, game, { partnerCheckIndex: 3 });

// CAMERA MODES — 'V' toggles between them. Both reuse the same player
// position/rotation; only the offset (and whether the model is visible) changes.
const CAMERA_MODE = { FIRST: 'first', THIRD: 'third' };
let cameraMode = CAMERA_MODE.THIRD;
const THIRD_PERSON_OFFSET = new THREE.Vector3(0, 2.2, 4.5); // behind & above, local
const FIRST_PERSON_OFFSET = new THREE.Vector3(0, 1.6, 0.15); // just in front of the head

function toggleCameraMode() {
  cameraMode = cameraMode === CAMERA_MODE.THIRD ? CAMERA_MODE.FIRST : CAMERA_MODE.THIRD;
  player.model.visible = cameraMode === CAMERA_MODE.THIRD; // hide own body in first-person
}
player.model.visible = cameraMode === CAMERA_MODE.THIRD;

// Reused every frame — never allocate inside animate()
const _camForward = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _moveDir = new THREE.Vector3();
const _desiredCamPos = new THREE.Vector3();
const _yawEuler = new THREE.Euler(0, 0, 0, 'YXZ');

const _distTmp = new THREE.Vector3();
function distanceXZ(a, b) {
  _distTmp.set(b.x - a.x, 0, b.z - a.z);
  return _distTmp.length();
}

function tryPickupKeycard() {
  if (game.hasKeycard) return false;
  if (distanceXZ(player.group.position, keycardMesh.position) > KEYCARD_INTERACT_DISTANCE) return false;

  game.hasKeycard = true;
  keycardMesh.visible = false;
  showSubtitle('"That\u2019s it — now get out before that guard finishes his loop."');
  return true;
}

function tryInteract() {
  if (guardA.tryInteract(player.group.position)) return;
  tryPickupKeycard();
}

function getInteractPrompt() {
  const guardPrompt = guardA.getPrompt(player.group.position);
  if (guardPrompt) return guardPrompt;
  if (!game.hasKeycard && distanceXZ(player.group.position, keycardMesh.position) <= KEYCARD_INTERACT_DISTANCE) {
    return '[E] Pick up keycard';
  }
  return null;
}

let lastNoCardWarn = 0;
function checkElevator(dt, elapsed) {
  if (game.levelComplete) return;

  if (game.alarmActive && game.escapeTimeRemaining !== null) {
    game.escapeTimeRemaining -= dt;
    if (game.escapeTimeRemaining <= 0) {
      game.escapeTimeRemaining = 0;
      game.onCaught('timeout');
      return;
    }
  }

  if (distanceXZ(player.group.position, elevatorPosition) > ELEVATOR_REACH_DISTANCE) return;

  if (game.hasKeycard) {
    game.onWin();
  } else if (elapsed - lastNoCardWarn > 2.5) {
    lastNoCardWarn = elapsed;
    showSubtitle('"No card, no ride. Find it, fast!"', 2500);
  }
}

function resetLevel() {
  game.guardADown = false;
  game.hasDisguise = false;
  game.hasKeycard = false;
  game.alarmActive = false;
  game.alarmReason = null;
  game.levelComplete = false;
  game.escapeTimeRemaining = null;

  guardA.reset();
  guardB.reset();
  player.group.position.copy(PLAYER_SPAWN);
  keycardMesh.visible = true;

  ambient.color.setHex(0x1a1a2e);
  ambient.intensity = 0.6;
  scene.background.setHex(0x0a0a0a);
  clearTimeout(subtitleTimer);
  subtitleEl.style.display = 'none';
  promptEl.style.display = 'none';
}

// MOVEMENT — now moves the PLAYER, not the camera. Speed varies by state:
// crouching is slower and stealthier, sprinting is faster but louder/riskier
// (worth wiring sprint into guard detection range later, as a stretch goal).
const WALK_SPEED = 3;
const SPRINT_SPEED = 5;
const CROUCH_SPEED = 1.5;

function updateMovement(dt) {
  // Camera's current facing, projected onto the ground plane — this is what
  // "forward" means for movement, regardless of how far the camera has
  // orbited behind the player.
  camera.getWorldDirection(_camForward);
  _camForward.y = 0;
  _camForward.normalize();
  _camRight.set(-_camForward.z, 0, _camForward.x); // 90°, matches guards.js's convention

  _moveDir.set(0, 0, 0);
  if (keys['w']) _moveDir.add(_camForward);
  if (keys['s']) _moveDir.sub(_camForward);
  if (keys['a']) _moveDir.sub(_camRight);
  if (keys['d']) _moveDir.add(_camRight);

  const isMoving = _moveDir.lengthSq() > 0;
  const isCrouching = keys['control'];
  const isSprinting = keys['shift'] && !isCrouching;

  if (isMoving) {
    _moveDir.normalize();
    const speed = isCrouching ? CROUCH_SPEED : isSprinting ? SPRINT_SPEED : WALK_SPEED;

    // Checking X and Z separately (not as one combined move) lets the player
    // slide along a wall instead of getting fully stopped when approaching
    // it at an angle.
    const nextX = player.group.position.x + _moveDir.x * speed * dt;
    const nextZ = player.group.position.z + _moveDir.z * speed * dt;
    if (!checkCollision(nextX, player.group.position.z)) player.group.position.x = nextX;
    if (!checkCollision(player.group.position.x, nextZ)) player.group.position.z = nextZ;

    player.group.rotation.y = Math.atan2(_moveDir.x, _moveDir.z);

    player.playAction(isCrouching ? 'LowWalk' : isSprinting ? 'Sprint' : 'Walking');
  } else {
    player.playAction('Idle');
  }
}

function updateCamera() {
  _yawEuler.setFromQuaternion(camera.quaternion, 'YXZ');
  const yaw = _yawEuler.y;

  const offset = cameraMode === CAMERA_MODE.THIRD ? THIRD_PERSON_OFFSET : FIRST_PERSON_OFFSET;
  _desiredCamPos.copy(offset).applyEuler(new THREE.Euler(0, yaw, 0));
  _desiredCamPos.add(player.group.position);

  camera.position.copy(_desiredCamPos);
}

// MAIN LOOP
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  if (!game.levelComplete) {
    updateMovement(dt);
    updateCamera();
    player.update(dt);
    guardA.update(dt);
    guardB.update(dt, player.group.position);
    checkElevator(dt, elapsed);
  }

  const promptText = game.levelComplete ? null : getInteractPrompt();
  promptEl.textContent = promptText || '';
  promptEl.style.display = promptText ? 'block' : 'none';

  if (game.alarmActive && !game.levelComplete) {
    ambient.intensity = 0.4 + Math.abs(Math.sin(elapsed * 6)) * 0.5;
  }

  renderer.render(scene, camera);
}
animate();
