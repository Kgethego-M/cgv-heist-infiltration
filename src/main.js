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

const game = {
  guardADown: false,
  hasDisguise: false,
  hasKeycard: false,
  alarmActive: false,
  alarmReason: null,

  triggerAlarm(reason) {
    if (this.alarmActive) return;
    this.alarmActive = true;
    this.alarmReason = reason;
    ambient.color.setHex(0x881111);
    scene.background.setHex(0x220000);
    showSubtitle('"His partner just found him — they know you\'re in the building. Elevator, now, go go go!"');
  },

  onCaught() {
    resetLevel();
    showSubtitle('"You\'re made — get out of there, we\'re resetting."');
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
const { colliders } = createLevel1(scene);

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
  new THREE.Vector3(-1, 0, 3),
];
const guardB = new GuardB(scene, waypoints, colliders, game, { partnerCheckIndex: 3 });

function tryInteract() {
  if (guardA.tryInteract(camera.position)) return;
}

function resetLevel() {
  game.guardADown = false;
  game.hasDisguise = false;
  game.hasKeycard = false;
  game.alarmActive = false;
  game.alarmReason = null;

  guardA.reset();
  guardB.reset();
  camera.position.copy(PLAYER_SPAWN);

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

  updateMovement(dt);

  guardA.update(dt);
  guardB.update(dt, camera.position);

  const promptText = guardA.getPrompt(camera.position);
  promptEl.textContent = promptText || '';
  promptEl.style.display = promptText ? 'block' : 'none';

  if (game.alarmActive) {
    ambient.intensity = 0.4 + Math.abs(Math.sin(elapsed * 6)) * 0.5;
  }

  renderer.render(scene, camera);
}
animate();
