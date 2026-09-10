import * as THREE from 'three';
import { createLevel1 } from './levels/level1.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GuardA, GuardB, loadGuardModel } from './ai/guards.js';

// 1. Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0a);

// 2. Camera — currently the camera IS the player
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

// 4. Pointer lock controls
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
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  keys[k] = true;
  if (k === 'e' && !e.repeat) tryInteract();
});
window.addEventListener('keyup', (e) => (keys[e.key.toLowerCase()] = false));

// HUD
const promptEl = document.getElementById('prompt');
const subtitleEl = document.getElementById('subtitle');

// How long the player has to reach the elevator once the alarm triggers.
// Doc flags this as "tune after playtesting once real distance is measurable"
// — 25s is a starting guess for the Offices-back-corner -> Lobby-elevator run.
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
      ? '"His partner found the body — they know you’re in the building. Elevator, now!"'
      : '"You’ve been spotted — they know you’re in the building. Elevator, now!"';

    showSubtitle(alarmSubtitle);
  },

  onCaught(reason = 'caught') {
    resetLevel();
    const line = reason === 'timeout'
      ? '"Too slow — they’ve got you. Resetting the mission."'
      : '"You’ve been caught — resetting the mission."';
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

const PLAYER_SPAWN = new THREE.Vector3(-4, 1.6, -3.8);
camera.position.copy(PLAYER_SPAWN);
camera.rotation.y = Math.PI;

// GUARDS — model must finish loading before we create either guard, since
// makeGuardBody() reads the shared template synchronously. Top-level await
// works here because this file is loaded as an ES module (type="module").
await loadGuardModel(); // uses the default path: ./assets/models/guard_character.glb

const guardA = new GuardA(scene, game, new THREE.Vector3(-2.5, 0, 3));

const waypoints = [
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(4, 0, -3),
  new THREE.Vector3(4, 0, 3),
  new THREE.Vector3(-1, 0, 3),  // check Guard A here
  new THREE.Vector3(0, 0, 8),   // middle of Corridor
  new THREE.Vector3(0, 0, 10.2), // end of Corridor, before Offices
  new THREE.Vector3(0, 0, 8),   // walks back through Corridor
];
const guardB = new GuardB(scene, waypoints, colliders, game, { partnerCheckIndex: 3 });

// Shared horizontal-distance helper — same pattern as GuardA.horizDistanceTo,
// used here for the keycard and elevator proximity checks.
const _distTmp = new THREE.Vector3();
function distanceXZ(a, b) {
  _distTmp.set(b.x - a.x, 0, b.z - a.z);
  return _distTmp.length();
}

function tryPickupKeycard() {
  if (game.hasKeycard) return false;
  if (distanceXZ(camera.position, keycardMesh.position) > KEYCARD_INTERACT_DISTANCE) return false;

  game.hasKeycard = true;
  keycardMesh.visible = false;
  showSubtitle('"That’s it — now get out before that guard finishes his loop."');
  return true;
}

function tryInteract() {
  if (guardA.tryInteract(camera.position)) return;
  tryPickupKeycard();
}

// Combines the takedown/loot prompt with the keycard prompt so promptEl only
// ever needs one text at a time — guard prompt takes priority since it can
// only ever be relevant right next to Guard A, never overlapping the keycard.
function getInteractPrompt() {
  const guardPrompt = guardA.getPrompt(camera.position);
  if (guardPrompt) return guardPrompt;
  if (!game.hasKeycard && distanceXZ(camera.position, keycardMesh.position) <= KEYCARD_INTERACT_DISTANCE) {
    return '[E] Pick up keycard';
  }
  return null;
}

// Ticks the escape timer once the alarm is active, and checks whether the
// player has reached the elevator — win with the keycard, a "no card, no
// ride" nudge without it, or a timeout loss if the clock runs out first.
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

  if (distanceXZ(camera.position, elevatorPosition) > ELEVATOR_REACH_DISTANCE) return;

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
  camera.position.copy(PLAYER_SPAWN);
  keycardMesh.visible = true;

  ambient.color.setHex(0x1a1a2e);
  ambient.intensity = 0.6;
  scene.background.setHex(0x0a0a0a);
  clearTimeout(subtitleTimer);
  subtitleEl.style.display = 'none';
  promptEl.style.display = 'none';
}

// MOVEMENT
const PLAYER_SPEED = 3;
function updateMovement(dt) {
  if (keys['w']) controls.moveForward(PLAYER_SPEED * dt);
  if (keys['s']) controls.moveForward(-PLAYER_SPEED * dt);
  if (keys['a']) controls.moveRight(-PLAYER_SPEED * dt);
  if (keys['d']) controls.moveRight(PLAYER_SPEED * dt);
}

// MAIN LOOP
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  if (!game.levelComplete) {
    updateMovement(dt);
    guardA.update(dt);
    guardB.update(dt, camera.position);
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
