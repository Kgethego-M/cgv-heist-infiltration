import * as THREE from 'three';
import { createLevel1 } from './levels/level1.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GuardA, GuardB, loadGuardModel } from './ai/guards.js';
import { Player, loadPlayerModel } from './player/player.js';

// 1. Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0a);

// 2. Camera — third-person follow camera, position driven manually each frame
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

// 4. Pointer lock controls — mouse-look rotation only, we never call
// controls.moveForward/moveRight
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

// Keys
const keys = {};
let isProne = false; // toggled by 'c', separate from the held-down movement keys
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  keys[k] = true;
  if (k === 'e' && !e.repeat) tryInteract();
  if (k === 'v' && !e.repeat) toggleCameraMode();
  if (k === 'c' && !e.repeat) isProne = !isProne;
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

// Wall collision — one expanded bounding box per collider, computed ONCE.
const PLAYER_RADIUS = 0.35; // slightly tighter than before — 0.4 felt too generous
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

const PLAYER_SPAWN = new THREE.Vector3(-4, 0, -4.3);

// PLAYER + GUARDS
const [, playerGltf] = await Promise.all([
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

// CAMERA MODES
const CAMERA_MODE = { FIRST: 'first', THIRD: 'third' };
let cameraMode = CAMERA_MODE.THIRD;
const THIRD_PERSON_OFFSET = new THREE.Vector3(0, 2.2, 4.5);
const FIRST_PERSON_OFFSET = new THREE.Vector3(0, 1.6, 0.15);

function toggleCameraMode() {
  cameraMode = cameraMode === CAMERA_MODE.THIRD ? CAMERA_MODE.FIRST : CAMERA_MODE.THIRD;
  player.model.visible = cameraMode === CAMERA_MODE.THIRD;
}
player.model.visible = cameraMode === CAMERA_MODE.THIRD;

// Reused every frame
const _camForward = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _moveDir = new THREE.Vector3();
const _desiredCamPos = new THREE.Vector3();
const _yawEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _camPivot = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _camRaycaster = new THREE.Raycaster();

// WALL HUG — hold Q facing a wall to snap your back against it, then
// strafe with A/D to slide along it.
const WALL_HUG_RANGE = 1.2;
const WALL_HUG_OFFSET = 0.4;
const WALL_HUG_SPEED = 1.2;
const _wallRayOrigin = new THREE.Vector3();
const _wallForward = new THREE.Vector3();
const _wallNormal = new THREE.Vector3();
const _wallRight = new THREE.Vector3();
const _wallRaycaster = new THREE.Raycaster();
let isWallHugging = false;

function updateWallHug(dt) {
  if (!isWallHugging) {
    camera.getWorldDirection(_wallForward);
    _wallForward.y = 0;
    _wallForward.normalize();

    _wallRayOrigin.copy(player.group.position);
    _wallRayOrigin.y = 1.2;
    _wallRaycaster.set(_wallRayOrigin, _wallForward);
    _wallRaycaster.far = WALL_HUG_RANGE;
    const hits = _wallRaycaster.intersectObjects(colliders, false);
    if (hits.length === 0) return; // nothing to hug — holding Q does nothing here

    _wallNormal.copy(hits[0].face.normal).transformDirection(hits[0].object.matrixWorld);
    isWallHugging = true;

    player.group.position.copy(hits[0].point).addScaledVector(_wallNormal, WALL_HUG_OFFSET);
    player.group.rotation.y = Math.atan2(_wallNormal.x, _wallNormal.z);
  }

  _wallRight.set(_wallNormal.z, 0, -_wallNormal.x);
  let strafe = 0;
  if (keys['d']) strafe += 1;
  if (keys['a']) strafe -= 1;

  if (strafe !== 0) {
    const nextX = player.group.position.x + _wallRight.x * strafe * WALL_HUG_SPEED * dt;
    const nextZ = player.group.position.z + _wallRight.z * strafe * WALL_HUG_SPEED * dt;
    if (!checkCollision(nextX, player.group.position.z)) player.group.position.x = nextX;
    if (!checkCollision(player.group.position.x, nextZ)) player.group.position.z = nextZ;
  }

  player.playAction('WallWalk');
}

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

// MOVEMENT
const WALK_SPEED = 3;
const SPRINT_SPEED = 5;
const CROUCH_SPEED = 1.5;
const PRONE_SPEED = 0.8;

function updateMovement(dt) {
  if (keys['q']) {
    updateWallHug(dt);
    return;
  } else if (isWallHugging) {
    isWallHugging = false; // Q released — resume normal movement next frame
  }

  camera.getWorldDirection(_camForward);
  _camForward.y = 0;
  _camForward.normalize();
  _camRight.set(-_camForward.z, 0, _camForward.x); // fixed: was inverted before

  _moveDir.set(0, 0, 0);
  if (keys['w']) _moveDir.add(_camForward);
  if (keys['s']) _moveDir.sub(_camForward);
  if (keys['a']) _moveDir.sub(_camRight);
  if (keys['d']) _moveDir.add(_camRight);

  const isMoving = _moveDir.lengthSq() > 0;
  const isCrouching = keys['control'] && !isProne;
  const isSprinting = keys['shift'] && !isCrouching && !isProne;

  if (isMoving) {
    _moveDir.normalize();
    const speed = isProne ? PRONE_SPEED : isCrouching ? CROUCH_SPEED : isSprinting ? SPRINT_SPEED : WALK_SPEED;

    const nextX = player.group.position.x + _moveDir.x * speed * dt;
    const nextZ = player.group.position.z + _moveDir.z * speed * dt;
    if (!checkCollision(nextX, player.group.position.z)) player.group.position.x = nextX;
    if (!checkCollision(player.group.position.x, nextZ)) player.group.position.z = nextZ;

    player.group.rotation.y = Math.atan2(_moveDir.x, _moveDir.z);

    const clip = isProne ? 'Crawl' : isCrouching ? 'LowWalk' : isSprinting ? 'Sprint' : 'Walking';
    player.playAction(clip);
  } else {
    player.playAction('Idle');
  }
}

// Camera collision: raycast from a chest-height pivot toward the desired
// third-person position; pull the camera in front of any wall it would
// otherwise end up outside of.
function updateCamera() {
  _yawEuler.setFromQuaternion(camera.quaternion, 'YXZ');
  const yaw = _yawEuler.y;

  const offset = cameraMode === CAMERA_MODE.THIRD ? THIRD_PERSON_OFFSET : FIRST_PERSON_OFFSET;
  _desiredCamPos.copy(offset).applyEuler(new THREE.Euler(0, yaw, 0));
  _desiredCamPos.add(player.group.position);

  if (cameraMode === CAMERA_MODE.THIRD) {
    _camPivot.copy(player.group.position);
    _camPivot.y += 1.5;

    _camDir.subVectors(_desiredCamPos, _camPivot);
    const camDist = _camDir.length();
    _camDir.normalize();

    _camRaycaster.set(_camPivot, _camDir);
    _camRaycaster.far = camDist;
    const hits = _camRaycaster.intersectObjects(colliders, false);
    if (hits.length > 0) {
      const safeDist = Math.max(hits[0].distance - 0.2, 0.3);
      _desiredCamPos.copy(_camPivot).addScaledVector(_camDir, safeDist);
    }
  }

  camera.position.copy(_desiredCamPos);
}

// MINIMAP — second small renderer, top-down orthographic, follows the
// player's X/Z each frame. North-up (doesn't rotate with the player) —
// simpler, and plenty readable for a level this size.
const minimapCanvas = document.getElementById('minimap');
const minimapRenderer = new THREE.WebGLRenderer({ canvas: minimapCanvas, antialias: true, alpha: true });
minimapRenderer.setSize(180, 180);

const MINIMAP_VIEW_SIZE = 10;
const minimapCamera = new THREE.OrthographicCamera(
  -MINIMAP_VIEW_SIZE, MINIMAP_VIEW_SIZE, MINIMAP_VIEW_SIZE, -MINIMAP_VIEW_SIZE, 0.1, 100
);
minimapCamera.position.set(0, 30, 0);
minimapCamera.rotation.x = -Math.PI / 2;

function updateMinimap() {
  minimapCamera.position.x = player.group.position.x;
  minimapCamera.position.z = player.group.position.z;
  minimapRenderer.render(scene, minimapCamera);
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
  updateMinimap();
}
animate();
