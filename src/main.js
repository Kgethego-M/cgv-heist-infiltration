import * as THREE from 'three';
import { createLevel1 } from './levels/level1.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GuardA, GuardB } from './ai/guards.js';

// 1. Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0a);

// 2. Camera — currently the camera IS the player (first-person stand-in until
// the character model exists; guards take the player position as an argument
// every frame, so swapping in playerModel.position later changes nothing here)
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

// 4. Pointer lock controls — created after the renderer
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

// Keys — E is one-shot (!e.repeat stops a held key firing the takedown
// AND the uniform loot in a single press)
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


// Guard AI sets these flags; Elevator/UI, Audio and Character owners read them
// and plug into the hooks. Keep these names stable — the whole team depends
// on them (Level 1 doc, section 6).
const game = {
  guardADown: false,
  hasDisguise: false,
  hasKeycard: false, // the Offices owner's pickup sets this — one state object for all
  alarmActive: false,
  alarmReason: null,

  triggerAlarm(reason) {
    if (this.alarmActive) return; // one alarm system, fires exactly once
    this.alarmActive = true;
    this.alarmReason = reason;
    // TEMPORARY feedback so guard AI is testable — Elevator/UI owner replaces
    // with the real red light / siren / escape timer.
    ambient.color.setHex(0x881111);
    scene.background.setHex(0x220000);
    showSubtitle('"His partner just found him — they know you\'re in the building. Elevator, now, go go go!"');
  },

  onCaught() {
    // Lose state — restart with no page refresh (final checklist item in the brief)
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

// LEVEL + GUARDS
const { colliders } = createLevel1(scene);

const PLAYER_SPAWN = new THREE.Vector3(-4, 1.6, -3.8);
camera.position.copy(PLAYER_SPAWN);
camera.rotation.y = Math.PI;

// Guard A — idle at the reception desk
const guardA = new GuardA(scene, game, new THREE.Vector3(-2.5, 0, 3));

// Guard B — patrol loop. Waypoints 1-3 are the original blockout markers.
// Waypoint 4 is the "check partner" stop next to Guard A's spot (beat 7) —
// added per the level doc; tell the team if you move any of these.
const waypoints = [
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(4, 0, -3),
  new THREE.Vector3(4, 0, 3),
  new THREE.Vector3(-1, 0, 3),
];
const guardB = new GuardB(scene, waypoints, colliders, game, { partnerCheckIndex: 3 });


function tryInteract() {
  if (guardA.tryInteract(camera.position)) return;
  // Keycard pickup + elevator win/lose plug in here (Offices / Elevator owners)
}

//RESET (no page refresh) 
function resetLevel() {
  game.guardADown = false;
  game.hasDisguise = false;
  game.hasKeycard = false;
  game.alarmActive = false;
  game.alarmReason = null;

  guardA.reset();
  guardB.reset();
  camera.position.copy(PLAYER_SPAWN);

  // Undo the temporary alarm visuals
  ambient.color.setHex(0x1a1a2e);
  ambient.intensity = 0.6;
  scene.background.setHex(0x0a0a0a);
  clearTimeout(subtitleTimer);
  subtitleEl.style.display = 'none';
  promptEl.style.display = 'none';
}

//  MOVEMENT 
const PLAYER_SPEED = 3; // m/s — now frame-rate independent via dt (was 0.05/frame)
function updateMovement(dt) {
  if (keys['w']) controls.moveForward(PLAYER_SPEED * dt);
  if (keys['s']) controls.moveForward(-PLAYER_SPEED * dt);
  if (keys['a']) controls.moveRight(-PLAYER_SPEED * dt);
  if (keys['d']) controls.moveRight(PLAYER_SPEED * dt);
}

//  MAIN LOOP 
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05); // clamp: no huge jump after tab-out
  const elapsed = clock.elapsedTime;

  updateMovement(dt);

  guardA.update(dt);
  guardB.update(dt, camera.position);

  // Interaction prompt
  const promptText = guardA.getPrompt(camera.position);
  promptEl.textContent = promptText || '';
  promptEl.style.display = promptText ? 'block' : 'none';

  // TEMPORARY alarm pulse — Elevator/UI owner replaces with the real effect
  if (game.alarmActive) {
    ambient.intensity = 0.4 + Math.abs(Math.sin(elapsed * 6)) * 0.5;
  }

  renderer.render(scene, camera);
}
animate();