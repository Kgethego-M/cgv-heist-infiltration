import * as THREE from 'three';
import { createLevel1, ELEVATOR_IDLE_COLOR, ELEVATOR_ALARM_COLOR, ROOM_SCALE } from './levels/level1.js';
import { createLevel2 } from './levels/level2.js';
import { createLevel3 } from './levels/level3.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GuardA, GuardB, loadGuardModel } from './ai/guards.js';
import { Player, loadPlayerModel } from './player/player.js';
import { loadEarpieceAudio, playLine } from './audio/earpiece.js';
import { fxTime } from './fx/shaders.js';
import { startMusic, setMusicLevel, setMusicIntensity } from './audio/music.js';
import './audio/volume.js';   // - / + keys set the master volume
import {
  resumeAudioContext, playTakedownThud, playKeyPickup, playKeycardPickup,
  playDoorUnlock, playDoorDenied, playElevatorDing, playWinSting, playLoseSting,
  startAlarmKlaxon, stopAlarmKlaxon, startHeartbeat, stopHeartbeat,
} from './audio/sfx.js';

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
blocker.addEventListener('click', () => {
  controls.lock();
  resumeAudioContext();
});

controls.addEventListener('lock', () => {
  blocker.style.display = 'none';
});
// Level 2 puzzle overlays (wire puzzle, safe keypad) need a free mouse. While one is
// open we unlock the pointer on purpose, so the "click to look around" blocker
// must stay hidden. Declared here (not further down) because the top-level await
// below means events can fire before later declarations run.
let missionUiOpen = false;
controls.addEventListener('unlock', () => {
  if (!missionUiOpen) blocker.style.display = 'flex';
});
function setMissionUiOpen(open, relock) {
  missionUiOpen = open;
  if (open) {
    controls.unlock();
    return;
  }
  if (relock) {
    controls.lock();
    // If the browser refuses the re-lock, fall back to the normal blocker.
    setTimeout(() => { if (!controls.isLocked && !missionUiOpen) blocker.style.display = 'flex'; }, 300);
  } else {
    blocker.style.display = 'flex';
  }
}

// Lights
// No hemisphere light — real ceiling fixtures (level1.js) are what light
// the level now, same as a real office. Kept small and dim as a base so
// unlit corners aren't pure black, not as the main light source.
const ambient = new THREE.AmbientLight(0x1a1a2e, 0.25);
scene.add(ambient);

// One PointLight per ceiling fixture — positions come straight from
// level1.js so the light always lines up with its visible panel exactly.
// Placed slightly below the fixture mesh, angled to spread downward.
// Every light added here is tracked so it can be removed when the level
// changes (levels 1-3 all occupy the same world space, so only one is ever
// loaded at a time).
const levelLights = [];
function addCeilingLights(positions, { color = 0xfff4e0, intensity = 6, distance = 7 } = {}) {
  positions.forEach((pos) => {
    const light = new THREE.PointLight(color, intensity, distance);
    light.position.set(pos.x, pos.y - 0.3, pos.z);
    scene.add(light);
    levelLights.push(light);
  });
}
// Level 1's rooms are ROOM_SCALE times bigger, so its ceiling lights need a
// longer reach (and a bit more punch) to still overlap. Levels 2/3 pass their
// own settings from LEVEL_CONFIG and are unaffected.
const LEVEL1_LIGHT = { intensity: 6 * ROOM_SCALE, distance: 7 * ROOM_SCALE };
function clearCeilingLights() {
  levelLights.forEach((l) => scene.remove(l));
  levelLights.length = 0;
}

// Resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- Alarm beacon ---------------------------------------------------------
// A single rotating security beacon, positioned roughly central between the
// three rooms (Lobby z≈0, Corridor z≈8, Offices z≈16) so it's visible from
// wherever the alarm catches the player. Off (intensity 0) until the alarm
// fires; updateAlarmBeacon() runs every frame and resetLevel() snaps it back
// off between attempts.
const BEACON_BASE = new THREE.Vector3(0, 3.7, 8 * ROOM_SCALE);
const BEACON_SWEEP_RADIUS = 3 * ROOM_SCALE;
const BEACON_SWEEP_SPEED = 3.2; // radians/sec
const BEACON_FLASH_SPEED = 5.5;
const beaconLight = new THREE.PointLight(ELEVATOR_ALARM_COLOR, 0, 9 * ROOM_SCALE);
beaconLight.position.copy(BEACON_BASE);
scene.add(beaconLight);

function updateAlarmBeacon(elapsed) {
  if (!game.alarmActive || game.levelComplete) {
    if (beaconLight.intensity !== 0) beaconLight.intensity = 0;
    return;
  }
  const angle = elapsed * BEACON_SWEEP_SPEED;
  beaconLight.position.x = BEACON_BASE.x + Math.cos(angle) * BEACON_SWEEP_RADIUS;
  beaconLight.position.z = BEACON_BASE.z + Math.sin(angle) * BEACON_SWEEP_RADIUS;
  // A hard on/off flash reads as a strobing beacon, a smooth sine reads as
  // gentle breathing, which is the opposite of what an alarm should feel like.
  beaconLight.intensity = Math.sin(elapsed * BEACON_FLASH_SPEED) > 0.4 ? 9 : 0;
}

// Keys
const keys = {};
let isProne = false; // toggled by 'c', separate from the held-down movement keys
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  keys[k] = true;
  if (missionUiOpen) return; // puzzle UI owns the keyboard
  if (k === 'e' && !e.repeat) tryInteract();
  if (k === 'v' && !e.repeat) toggleCameraMode();
  if (k === 'c' && !e.repeat) isProne = !isProne;
  if (k === 'r' && !e.repeat && endScreenVisible()) restartFromEndScreen();
});
window.addEventListener('keyup', (e) => (keys[e.key.toLowerCase()] = false));

// HUD
const promptEl = document.getElementById('prompt');
const subtitleEl = document.getElementById('subtitle');
const endScreenEl = document.getElementById('endScreen');
const endTitleEl = document.getElementById('endTitle');
const endMessageEl = document.getElementById('endMessage');
endScreenEl.addEventListener('click', restartFromEndScreen);

// MAIN MENU + INTRO — mainMenu is visible from page load (plain HTML/CSS,
// no dependency on models being loaded yet). The Start button itself only
// gets its click handler once the player/guards actually exist further
// down this file, since top-level await blocks everything after it until
// the models finish loading.
const mainMenuEl = document.getElementById('mainMenu');
const startBtn = document.getElementById('startBtn');
let inMenu = true;
let introPlaying = false;

const ESCAPE_TIME_LIMIT = 25;
const ELEVATOR_REACH_DISTANCE = 1.8;
const KEYCARD_INTERACT_DISTANCE = 1.6;
const OFFICE_DOOR_INTERACT_DISTANCE = 2.0;

const game = {
  guardADown: false,
  hasKey: false,
  hasKeycard: false,
  doorUnlocked: false,
  alarmActive: false,
  alarmReason: null,
  levelComplete: false,
  objectiveComplete: false, // levels 2+ : terminal hacked / artifact taken
  escapeTimeRemaining: null,
  alarmsRaised: 0,

  triggerAlarm(reason) {
    if (this.alarmActive) return;
    this.alarmActive = true;
    this.alarmReason = reason;
    this.escapeTimeRemaining = ESCAPE_TIME_LIMIT;
    this.alarmsRaised += 1;

    ambient.color.setHex(0x881111);
    scene.background.setHex(0x220000);
    elevatorIndicatorMat.emissive.setHex(ELEVATOR_ALARM_COLOR);

    startAlarmKlaxon();
    startHeartbeat(() => {
      // Speeds up from ~800ms between beats down to ~250ms as the escape
      // clock runs out, so the tension audibly ramps with the countdown.
      const t = this.escapeTimeRemaining ?? ESCAPE_TIME_LIMIT;
      const frac = Math.max(0, Math.min(1, t / ESCAPE_TIME_LIMIT));
      return 250 + frac * 550;
    });

    showLine(reason === 'partner_found' ? 'alarmPartnerFound' : 'alarmSpotted');
  },

    onCaught(reason = 'caught', customMessage = null) {
    if (this.levelComplete || endScreenVisible()) return;
    controls.unlock();
    stopAlarmKlaxon();
    stopHeartbeat();
    playLoseSting();
    const line = customMessage ? '' : playLine(reason === 'timeout' ? 'timeout' : 'caught');
    const message = customMessage || line || (reason === 'timeout'
      ? 'The escape window closed — security caught you at the elevator.'
      : 'A guard caught you before you reached the elevator.');
    showEndScreen(false, message);
  },

    onWin() {
    if (this.levelComplete) return;
    this.levelComplete = true;
    controls.unlock();
    if (currentLevel === 1) doorAnim.opening = true;
    stopAlarmKlaxon();
    stopHeartbeat();
    playElevatorDing();

    const secondsTaken = Math.floor((performance.now() - attemptStart) / 1000);
    const secondsLeft = Math.max(0, Math.ceil(this.escapeTimeRemaining ?? 0));
    if (currentLevel !== 1) {
      showEndScreen(true, `Cleared in ${secondsTaken}s.`);
      return;
    }
    const alarmText = this.alarmsRaised === 0
      ? 'no alarms raised — clean run'
      : `${this.alarmsRaised} alarm raised, ${secondsLeft}s left on the escape clock`;
    const winLine = playLine('elevatorWin');

    showEndScreen(true, winLine
      ? `${winLine} Cleared in ${secondsTaken}s — ${alarmText}.`
      : `Cleared in ${secondsTaken}s — ${alarmText}.`);
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

// Plays the matching earpiece clip and shows its caption together, the
// single entry point every trigger below should use instead of calling
// showSubtitle() with a hand-typed string.
function showLine(key, duration) {
  const text = playLine(key);
  if (text) showSubtitle(text, duration);
}
let attemptStart = performance.now();

let endScreenWon = false;
function showEndScreen(won, message) {
  endScreenWon = won;
  const isFinal = currentLevel === TOTAL_LEVELS;
  endTitleEl.textContent = won ? (isFinal ? 'MISSION COMPLETE' : 'LEVEL COMPLETE') : 'MISSION FAILED';
  if (won) {
    message += isFinal
      ? ' Press R or click to play again from Level 1.'
      : ` Press R or click to continue to Level ${currentLevel + 1}.`;
  }
  endMessageEl.textContent = message;
  endScreenEl.className = won ? 'win' : 'lose';
  endScreenEl.style.display = 'flex';
}

function hideEndScreen() {
  endScreenEl.style.display = 'none';
}

function endScreenVisible() {
  return endScreenEl.style.display === 'flex';
}

function restartFromEndScreen() {
  const won = endScreenWon;
  hideEndScreen();
  if (won && currentLevel < TOTAL_LEVELS) loadLevel(currentLevel + 1); // win -> next level
  else if (won) loadLevel(1);                                          // beat the last level -> back to start
  else resetLevel();                                                   // loss -> retry current level
  blocker.style.display = 'flex'; // back to "Click to look around" — existing re-lock path
}

// LEVEL
const { root, colliders, elevatorPosition, elevatorDoors, elevatorIndicatorMat, keycardMesh, keyMesh, officeDoor, lightFixturePositions } = createLevel1(scene);
addCeilingLights(lightFixturePositions, LEVEL1_LIGHT);

// ---- Level management ------------------------------------------------------
// `colliders` is shared BY REFERENCE with GuardB, checkCollision, wall-hug and
// the camera, so it is never reassigned — on a level change it is emptied and
// refilled in place. Level 1 is built once and swapped in/out of the scene;
// levels 2 and 3 are rebuilt from scratch on every load (which doubles as
// their reset).
const TOTAL_LEVELS = 3;
let currentLevel = 1;
let levelHandle = null;                 // return value of createLevel2/3 while one of those is active
const level1Colliders = [...colliders]; // snapshot incl. officeDoor, restored when returning to level 1
const level1LightPositions = lightFixturePositions;

const LEVEL_CONFIG = {
  2: {
    name: 'Server Room & Labs',
    create: createLevel2,
    ambient: { color: 0x1a2a3a, intensity: 0.3 },
    background: 0x05080c,
    // Level 2 is built with ROOM_SCALE like level 1, so its lights need the same longer reach.
    light: { color: 0xaad4ff, intensity: 5 * ROOM_SCALE, distance: 7 * ROOM_SCALE },
    minimapSize: 10 * ROOM_SCALE,
    objectiveKey: 'terminalPosition', // (level 2 now uses levelHandle.missions instead; kept for reference)
    objectiveMarker: 'marker_terminal',
    objectivePrompt: '[E] Hack terminal',
    objectiveDone: 'Terminal hacked — head for the exit elevator.',
    exitBlocked: 'Hack the terminal before you leave.',
    onObjectiveDone(marker) {
      // clone so the shared module-level material isn't tinted for future attempts
      marker.material = marker.material.clone();
      marker.material.color.setHex(0x66ff66);
      marker.material.emissive.setHex(0x66ff66);
    },
  },
  3: {
    name: 'Vault Wing',
    create: createLevel3,
    ambient: { color: 0x14141a, intensity: 0.2 },
    background: 0x050508,
    light: { color: 0xffb060, intensity: 4, distance: 6 },
    objectiveKey: 'vaultItemPosition',
    objectiveMarker: 'marker_vaultItem',
    objectivePrompt: '[E] Take the artifact',
    objectiveDone: 'Artifact secured — get out!',
    exitBlocked: "You can't leave without the artifact.",
    onObjectiveDone(marker) { marker.visible = false; },
  },
};
// Passed to createLevel2 so the level can drive subtitles, sounds, the pointer-lock
// handoff for puzzle UIs, and mark the level objective complete.
const missionHooks = {
  game,                                                   // shared state (alarm, escape clock) for level update loops
  triggerAlarm: (reason) => game.triggerAlarm(reason),
  onCaught: (reason, message) => game.onCaught(reason, message),
  onSubtitle: (text, ms) => showSubtitle(text, ms),
  onUiChange: (open, relock) => setMissionUiOpen(open, relock),
  onObjectiveComplete: () => { game.objectiveComplete = true; },
  sfx: {
    pickup: () => playKeycardPickup(),
    unlock: () => playDoorUnlock(),
    denied: () => playDoorDenied(),
  },
};
const OBJECTIVE_INTERACT_DISTANCE = 2.0;
const LEVEL_EXIT_RADIUS = 1.3; // levels 2+ (level 1 uses ELEVATOR_REACH_DISTANCE)

function unloadCurrentLevel() {
  clearCeilingLights();
  beaconLight.intensity = 0;
  if (currentLevel === 1) {
    scene.remove(root);
    setGuardsVisible(false);
  } else if (levelHandle) {
    if (levelHandle.dispose) levelHandle.dispose(); // removes level 2's HUD/puzzle DOM
    missionUiOpen = false;
    scene.remove(levelHandle.root);
    levelHandle.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); // materials are shared module-level, leave them
    levelHandle = null;
  }
  colliders.length = 0;
}

function resetCommonState() {
  game.alarmActive = false;
  game.alarmReason = null;
  game.levelComplete = false;
  game.objectiveComplete = false;
  game.escapeTimeRemaining = null;
  game.alarmsRaised = 0;
  isProne = false;
  isWallHugging = false;
  lastNoCardWarn = 0;
  stopAlarmKlaxon();
  stopHeartbeat();
  beaconLight.position.copy(BEACON_BASE);
  clearTimeout(subtitleTimer);
  subtitleEl.style.display = 'none';
  promptEl.style.display = 'none';
  attemptStart = performance.now();
}

function loadLevel(n) {
  unloadCurrentLevel();
  currentLevel = n;
  setMinimapViewSize(n === 1 ? MINIMAP_SIZE_LEVEL1 : (LEVEL_CONFIG[n]?.minimapSize ?? MINIMAP_SIZE_DEFAULT));
  resetCommonState();

  if (n === 1) {
    scene.add(root);
    addCeilingLights(level1LightPositions, LEVEL1_LIGHT);
    colliders.push(...level1Colliders);
    setGuardsVisible(true);
    resetLevel1(); // repositions player, resets guards/items/doors/ambient
    setMusicLevel(1);
    return;
  }

  const cfg = LEVEL_CONFIG[n];
  levelHandle = cfg.create(scene, missionHooks);
  colliders.push(...levelHandle.colliders);
  addCeilingLights(levelHandle.lightFixturePositions, cfg.light);
  if (levelHandle.dramaticFixturePositions) {
    addCeilingLights(levelHandle.dramaticFixturePositions, { color: 0xfff4d0, intensity: 10, distance: 6 });
  }

  ambient.color.setHex(cfg.ambient.color);
  ambient.intensity = cfg.ambient.intensity;
  scene.background.setHex(cfg.background);

  player.group.position.copy(levelHandle.entryPosition);
  player.group.rotation.y = 0;          // levels 2/3 run toward +z
  camera.rotation.set(0, Math.PI, 0);   // camera behind the player, looking +z
  showSubtitle(`Level ${n} — ${cfg.name}`, 4000);
  setMusicLevel(n);
}

function objectiveSpot() {
  return levelHandle && LEVEL_CONFIG[currentLevel] ? levelHandle[LEVEL_CONFIG[currentLevel].objectiveKey] : null;
}
function nearObjective() {
  const spot = objectiveSpot();
  return !!spot && !game.objectiveComplete && distanceXZ(player.group.position, spot) <= OBJECTIVE_INTERACT_DISTANCE;
}
function tryObjective() {
  if (!nearObjective()) return false;
  const cfg = LEVEL_CONFIG[currentLevel];
  game.objectiveComplete = true;
  playKeycardPickup();
  const marker = levelHandle.root.getObjectByName(cfg.objectiveMarker);
  if (marker) cfg.onObjectiveDone(marker);
  showSubtitle(cfg.objectiveDone, 3500);
  return true;
}

// Elevator door animation — advances every frame regardless of
// game.levelComplete, since the whole point is that it keeps sliding open
// AFTER the level is marked complete. resetLevel() snaps it back closed.
const DOOR_OPEN_DURATION = 1.1; // seconds
const doorAnim = { opening: false, t: 0 };
function updateElevatorDoors(dt) {
  if (!doorAnim.opening) return;
  doorAnim.t = Math.min(doorAnim.t + dt / DOOR_OPEN_DURATION, 1);
  const ease = 1 - Math.pow(1 - doorAnim.t, 3); // ease-out cubic
  elevatorDoors.left.position.x = THREE.MathUtils.lerp(
    elevatorDoors.closedX.left, elevatorDoors.openX.left, ease
  );
  elevatorDoors.right.position.x = THREE.MathUtils.lerp(
    elevatorDoors.closedX.right, elevatorDoors.openX.right, ease
  );
}
function resetElevatorDoors() {
  doorAnim.opening = false;
  doorAnim.t = 0;
  elevatorDoors.left.position.x = elevatorDoors.closedX.left;
  elevatorDoors.right.position.x = elevatorDoors.closedX.right;
}

// Earpiece audio: preload doesn't need a user gesture, only .play() does,
// so this can fire immediately. Missing clips fail individually and just
// fall back to captions (see audio/earpiece.js).
loadEarpieceAudio();

// Computed once, same pattern as the wall collider boxes below, used to
// detect the player's first step into the Offices for the earpiece line.
const officesGroup = root.getObjectByName('Offices');
const officesBox = officesGroup ? new THREE.Box3().setFromObject(officesGroup) : null;


// Wall collision via raycasting — computed after first render so world matrices are current.
const PLAYER_RADIUS = 0.35;
const _collisionRaycaster = new THREE.Raycaster();
const _collisionDir = new THREE.Vector3();
const _collisionOrigin = new THREE.Vector3();
let colliderMeshes = [];
// Level 1 has a lot more solid props now, and building a fresh Box3 for every
// collider on every test point (54 points x 2 axes x every frame) gets slow.
// Level 1 colliders don't move while they're in the list (the office door is
// removed from it before it slides, and reset puts it back where it started),
// so their boxes are computed once. Levels 2/3 aren't cached, since I can't
// see whether anything in them moves.
const _boxCache = new WeakMap();
const _testPoint = new THREE.Vector3();
function colliderBox(mesh) {
  /* level3-cache */ // level 3 colliders are static, so they use the same cache as level 1
  let box = _boxCache.get(mesh);
  if (!box) {
    box = new THREE.Box3().setFromObject(mesh);
    _boxCache.set(mesh, box);
  }
  return box;
}
function checkCollision(x, z) {
  // Check a circle of points around (x, z) to account for player body radius
  const offsets = [
    [0, 0],
    [PLAYER_RADIUS, 0], [-PLAYER_RADIUS, 0],
    [0, PLAYER_RADIUS], [0, -PLAYER_RADIUS],
    [PLAYER_RADIUS * 0.7, PLAYER_RADIUS * 0.7],
    [PLAYER_RADIUS * 0.7, -PLAYER_RADIUS * 0.7],
    [-PLAYER_RADIUS * 0.7, PLAYER_RADIUS * 0.7],
    [-PLAYER_RADIUS * 0.7, -PLAYER_RADIUS * 0.7],
  ];
  const heights = [0.3, 0.9, 1.5];
  
  for (let [ox, oz] of offsets) {
    for (let h of heights) {
      _testPoint.set(x + ox, h, z + oz);
      for (let i = 0; i < colliders.length; i++) {
        if (colliderBox(colliders[i]).containsPoint(_testPoint)) return true;
      }
    }
  }
  return false;
}
// Same position relative to the cover pillar as before (1.3m behind it), just at its scaled location.
const PLAYER_SPAWN = new THREE.Vector3(-4 * ROOM_SCALE, 0, -3 * ROOM_SCALE - 1.3);

// PLAYER + GUARDS
const [, playerGltf] = await Promise.all([
  loadGuardModel(),
  loadPlayerModel(),
]);

const player = new Player(scene, playerGltf);
player.group.position.copy(PLAYER_SPAWN);

// Anything the guard constructors add to the scene is captured here so the
// guards can be hidden while levels 2/3 are loaded (they only exist in level 1).
const _sceneBeforeGuards = new Set(scene.children);
const guardA = new GuardA(scene, game, new THREE.Vector3(-2.5 * ROOM_SCALE, 0, 3 * ROOM_SCALE));

// Original loop scaled by ROOM_SCALE, except waypoint 2: the old spot (4, 3)
// is now inside the waiting area (armchair / coffee table), so it's pulled
// in to a clear patch of floor. Index 3 is still the "check partner" stop,
// 2.25m from Guard A as before (scaled).
const S = ROOM_SCALE;
const waypoints = [
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(4 * S, 0, -3 * S),
  new THREE.Vector3(2.5, 0, 3.5),
  new THREE.Vector3(-1 * S, 0, 3 * S),
  new THREE.Vector3(0, 0, 8 * S),
  new THREE.Vector3(0, 0, 10.2 * S),
  new THREE.Vector3(0, 0, 8 * S),
];
const guardB = new GuardB(scene, waypoints, colliders, game, { partnerCheckIndex: 3, checkCollision });
const guardObjects = scene.children.filter((c) => !_sceneBeforeGuards.has(c));
function setGuardsVisible(v) { guardObjects.forEach((o) => { o.visible = v; }); }

// Menu is ready once the player actually exists — enable Start now.
startBtn.disabled = false;
startBtn.style.opacity = '1';
startBtn.textContent = 'Start Mission';
startBtn.addEventListener('click', () => {
  mainMenuEl.style.display = 'none';
  inMenu = false;
  controls.lock(); // this click is the required user gesture for both pointer lock and audio
  startMusic(currentLevel);
  resumeAudioContext();
  playIntroSequence();
});

// MENU CAMERA — slow orbit around the player while the menu is up. Reuses
// the same scene/player/renderer, no separate mini-scene needed.
const MENU_ORBIT_RADIUS = 2.5;
const MENU_ORBIT_SPEED = 0.3;
const _menuLookTarget = new THREE.Vector3();

function updateMenuCamera(elapsed) {
  const angle = elapsed * MENU_ORBIT_SPEED;
  camera.position.set(
    player.group.position.x + Math.sin(angle) * MENU_ORBIT_RADIUS,
    player.group.position.y + 1.5,
    player.group.position.z + Math.cos(angle) * MENU_ORBIT_RADIUS
  );
  _menuLookTarget.copy(player.group.position);
  _menuLookTarget.y += 1.0;
  camera.lookAt(_menuLookTarget);
}

// INTRO — a short scripted flythrough from the entrance down into the
// Lobby, handing off to the player right as the "you're in" earpiece line
// plays. Tune the start/end points by eye once you see it in-game.
const INTRO_DURATION = 4;
let introStartTime = 0;
const introCamStart = new THREE.Vector3(10 * ROOM_SCALE, 8, -10 * ROOM_SCALE);
const introCamEnd = new THREE.Vector3(-2 * ROOM_SCALE, 3, -1 * ROOM_SCALE);
const introLookStart = new THREE.Vector3(0, 0, 0);
const introLookEnd = new THREE.Vector3(PLAYER_SPAWN.x, 1, PLAYER_SPAWN.z + 0.3);
const _introLook = new THREE.Vector3();

function playIntroSequence() {
  introPlaying = true;
  introStartTime = clock.elapsedTime;
}

function updateIntro(elapsed) {
  const t = Math.min((elapsed - introStartTime) / INTRO_DURATION, 1);
  const eased = t * t * (3 - 2 * t); // smoothstep
  camera.position.lerpVectors(introCamStart, introCamEnd, eased);
  _introLook.lerpVectors(introLookStart, introLookEnd, eased);
  camera.lookAt(_introLook);
  if (t >= 1) {
    introPlaying = false;
    showLine('levelStart', 6000);
  }
}

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
// ---- Manager's office door ----------------------------------------------
const OFFICE_DOOR_CLOSED_X = officeDoor.position.x; // read from level1.js so it follows ROOM_SCALE
const OFFICE_DOOR_OPEN_X = OFFICE_DOOR_CLOSED_X + 1.7; // door is 1.5 m wide now, so it slides further to clear the opening // slides along the inside of the wall beside the doorway
const OFFICE_DOOR_SLIDE_TIME = 0.6; // seconds
let officeDoorUnlocked = false;
const officeDoorAnim = { opening: false, t: 0 };
// Distance checks use the CLOSED position so the prompt doesn't drift as the door slides.
const officeDoorSpot = { x: OFFICE_DOOR_CLOSED_X, z: officeDoor.position.z };

function nearOfficeDoor() {
  return !officeDoorUnlocked && distanceXZ(player.group.position, officeDoorSpot) <= OFFICE_DOOR_INTERACT_DISTANCE;
}

function updateOfficeDoor(dt) {
  if (!officeDoorAnim.opening) return;
  officeDoorAnim.t = Math.min(officeDoorAnim.t + dt / OFFICE_DOOR_SLIDE_TIME, 1);
  const ease = 1 - Math.pow(1 - officeDoorAnim.t, 3); // ease-out cubic
  officeDoor.position.x = OFFICE_DOOR_CLOSED_X + (OFFICE_DOOR_OPEN_X - OFFICE_DOOR_CLOSED_X) * ease;
  if (officeDoorAnim.t >= 1) officeDoorAnim.opening = false;
}

function tryUnlockOfficeDoor() {
  if (!nearOfficeDoor()) return false;
  if (!game.hasKey) {
    playDoorDenied();
    showSubtitle('Locked. One of the guards should be carrying the key.', 2500);
    return true;
  }

  officeDoorUnlocked = true;
  game.doorUnlocked = true;
  officeDoorAnim.opening = true;
  officeDoorAnim.t = 0;
  playDoorUnlock();

  // Only the door is a collider that has to go — the walls around the
  // doorway stay solid, so nothing needs restoring except the door on reset.
  const idx = colliders.indexOf(officeDoor);
  if (idx > -1) colliders.splice(idx, 1);

  showSubtitle('Office unlocked.', 2000);
  return true;
}

 function tryPickupKeycard() {
  if (game.hasKeycard) return false;
  if (distanceXZ(player.group.position, keycardMesh.position) > KEYCARD_INTERACT_DISTANCE) return false;

  game.hasKeycard = true;
  keycardMesh.visible = false;
  playKeycardPickup();
  showLine('keycardPickup');
  return true;
 }
function tryInteract() {
  if (currentLevel !== 1) {
    if (levelHandle && levelHandle.missions) levelHandle.missions.interact(player.group.position);
    else tryObjective();
    return;
  }
  const guardAWasDown = guardA.down;
  const hadKey = game.hasKey;
  if (guardA.tryInteract(player.group.position)) {
    if (!guardAWasDown && guardA.down) {
      playTakedownThud();
      showLine('takedown', 4500);
      keyMesh.visible = true; // key shows beside the body
    }
    if (!hadKey && game.hasKey) {
      playKeyPickup();
      keyMesh.visible = false;
      showSubtitle('Key acquired \u2014 use it to unlock the manager\'s office.', 3000);
    }
    return;
  }
  if (tryUnlockOfficeDoor()) return;
  tryPickupKeycard();
}
const GUARD_A_LINGER_RANGE = 4 * ROOM_SCALE;
const GUARD_A_LINGER_TIME = 1.2; // seconds of continuous proximity before the line fires
let guardALingerTimer = 0;
let hasWarnedGuardAPartner = false;

function checkGuardAProximity(dt) {
  if (hasWarnedGuardAPartner || guardA.down) return;

  if (guardA.horizDistanceTo(player.group.position) <= GUARD_A_LINGER_RANGE) {
    guardALingerTimer += dt;
    if (guardALingerTimer >= GUARD_A_LINGER_TIME) {
      hasWarnedGuardAPartner = true;
      showLine('lingeringNearGuardA', 5000);
    }
  } else {
    guardALingerTimer = 0; // wandered off, needs to linger again rather than just tick up forever
  }
}

let hasEnteredOffices = false;
function checkOfficesEntry() {
  if (hasEnteredOffices || !officesBox) return;
  if (officesBox.containsPoint(player.group.position)) {
    hasEnteredOffices = true;
    showLine('enterOffices', 5000);
  }
}

function getInteractPrompt() {
  if (currentLevel !== 1) {
    if (levelHandle && levelHandle.missions) return levelHandle.missions.getPrompt(player.group.position);
    return nearObjective() ? LEVEL_CONFIG[currentLevel].objectivePrompt : null;
  }
  const guardPrompt = guardA.getPrompt(player.group.position);
  if (guardPrompt) return guardPrompt;
  if (nearOfficeDoor()) {
    return game.hasKey ? '[E] Unlock office' : 'Locked \u2014 you need a key';
  }
  if (!game.hasKeycard && distanceXZ(player.group.position, keycardMesh.position) <= KEYCARD_INTERACT_DISTANCE) {
    return '[E] Pick up access card';
  }
  return null;
}

let lastNoCardWarn = 0;
function checkLevelExit(elapsed) {
  if (game.levelComplete || !levelHandle) return;
  if (distanceXZ(player.group.position, levelHandle.exitPosition) > LEVEL_EXIT_RADIUS) return;
  if (game.objectiveComplete) {
    game.onWin();
  } else if (elapsed - lastNoCardWarn > 2.5) {
    lastNoCardWarn = elapsed;
    showSubtitle(LEVEL_CONFIG[currentLevel].exitBlocked, 2500);
  }
}

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
    showLine('elevatorNoCard', 2500);
  }
}

// Restart whichever level is active (used after a loss).
function resetLevel() {
  if (currentLevel === 1) resetLevel1();
  else loadLevel(currentLevel);
}

function resetLevel1() {
  game.guardADown = false;
  game.hasKey = false;
  game.doorUnlocked = false;
  officeDoorUnlocked = false;
  officeDoorAnim.opening = false;
  officeDoorAnim.t = 0;
  officeDoor.position.x = OFFICE_DOOR_CLOSED_X;
  if (!colliders.includes(officeDoor)) colliders.push(officeDoor);
  game.hasKeycard = false;
  game.alarmActive = false;
  game.alarmReason = null;
  game.levelComplete = false;
  game.escapeTimeRemaining = null;

  // Per-attempt earpiece flags. hasPlayedIntro is deliberately NOT reset
  // here, so the "you're in, stay low" line only plays once per session,
  // not on every retry.
  guardALingerTimer = 0;
  hasWarnedGuardAPartner = false;
  hasEnteredOffices = false;

  stopAlarmKlaxon();
  stopHeartbeat();
  beaconLight.intensity = 0;
  beaconLight.position.copy(BEACON_BASE);

  guardA.reset();
  guardB.reset();
  player.group.position.copy(PLAYER_SPAWN);
  keycardMesh.visible = true;
  keyMesh.visible = false; // only appears once Guard A is down

  ambient.color.setHex(0x1a1a2e);
  ambient.intensity = 0.6;
  scene.background.setHex(0x0a0a0a);
  elevatorIndicatorMat.emissive.setHex(ELEVATOR_IDLE_COLOR);
  resetElevatorDoors();
  clearTimeout(subtitleTimer);
  subtitleEl.style.display = 'none';
  promptEl.style.display = 'none';

  game.alarmsRaised = 0;
  attemptStart = performance.now();
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
    isWallHugging = false;
  }

  camera.getWorldDirection(_camForward);
  _camForward.y = 0;
  _camForward.normalize();
  _camRight.set(-_camForward.z, 0, _camForward.x);

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

    const prevX = player.group.position.x;
    const prevZ = player.group.position.z;

    const nextX = prevX + _moveDir.x * speed * dt;
    const nextZ = prevZ + _moveDir.z * speed * dt;
    const xBlocked = checkCollision(nextX, prevZ);
    const zBlocked = checkCollision(player.group.position.x, nextZ);
    
    // If either direction is blocked, don't move at all (no wall sliding through furniture)
    if (!xBlocked && !zBlocked) {
      player.group.position.x = nextX;
      player.group.position.z = nextZ;
    }

    const actuallyMoved = player.group.position.x !== prevX || player.group.position.z !== prevZ;

    if (actuallyMoved) {
      player.group.rotation.y = Math.atan2(_moveDir.x, _moveDir.z);
      const clip = isProne ? 'Crawl' : isCrouching ? 'LowWalk' : isSprinting ? 'Sprint' : 'Walking';
      player.playAction(clip);
    } else {
      player.playAction('Idle');
    }
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
      const safeDist = Math.max(hits[0].distance - 0.2, 1.3);
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

const MINIMAP_SIZE_DEFAULT = 10;                          // levels 2/3 (unscaled)
const MINIMAP_SIZE_LEVEL1 = 10 * ROOM_SCALE;             // keeps the same amount of Level 1 on screen
const minimapCamera = new THREE.OrthographicCamera(
  -MINIMAP_SIZE_LEVEL1, MINIMAP_SIZE_LEVEL1, MINIMAP_SIZE_LEVEL1, -MINIMAP_SIZE_LEVEL1, 0.1, 100
);
function setMinimapViewSize(size) {
  minimapCamera.left = -size;
  minimapCamera.right = size;
  minimapCamera.top = size;
  minimapCamera.bottom = -size;
  minimapCamera.updateProjectionMatrix();
}
minimapCamera.position.set(0, 30, 0);
minimapCamera.rotation.x = -Math.PI / 2;

function updateMinimap() {
  minimapCamera.position.x = player.group.position.x;
  minimapCamera.position.z = player.group.position.z;
  minimapRenderer.render(scene, minimapCamera);
}

// Player stance for Level 3's lasers and guards: lower = harder to hit / spot.
function currentStance() {
  if (isProne) return 'prone';
  if (keys['control']) return 'crouch';
  if (keys['shift']) return 'sprint';
  return 'stand';
}

// MAIN LOOP
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;
  fxTime.value = elapsed; // drives every custom shader's time uniform

    if (inMenu) {
    updateMenuCamera(elapsed);
    player.update(dt);
  } else if (introPlaying) {
    updateIntro(elapsed);
    player.update(dt);
  } else if (missionUiOpen) {
    // puzzle overlay open: world is paused, player just idles
    player.playAction('Idle');
    player.update(dt);
  } else if (!game.levelComplete && !endScreenVisible()) {
    updateMovement(dt);
    updateCamera();
    player.update(dt);
    if (currentLevel === 1) {
      guardA.update(dt);
      guardB.update(dt, player.group.position);
      checkGuardAProximity(dt);
      checkOfficesEntry();
      checkElevator(dt, elapsed);
    } else {
      if (levelHandle && levelHandle.missions) {
        levelHandle.missions.update(dt, elapsed, player.group.position, !!keys['e']);
      }
      if (levelHandle && levelHandle.update) {
        levelHandle.update(dt, elapsed, player.group.position, currentStance());
      }
      checkLevelExit(elapsed);
    }
  }

    const promptText = (inMenu || introPlaying || game.levelComplete || endScreenVisible()) ? null : getInteractPrompt();
  promptEl.textContent = promptText || '';
  promptEl.style.display = promptText ? 'block' : 'none';

  if (!inMenu) { updateElevatorDoors(dt); updateOfficeDoor(dt); }

  if (game.alarmActive && !game.levelComplete) {
    // A sharper curve than plain sine, exponent < 1 snaps through the
    // middle faster and lingers near the extremes, closer to a strobe than
    // a smooth breathing pulse.
    const pulse = Math.pow(Math.abs(Math.sin(elapsed * 6)), 0.35);
    ambient.intensity = 0.35 + pulse * 0.55;
  }
  updateAlarmBeacon(elapsed);
  // soundtrack reacts to the game: calm -> tense as alarms / guard detection rise
  if (!inMenu) setMusicIntensity(game.alarmActive ? 1 : ((levelHandle && levelHandle.threat) || 0));

  renderer.render(scene, camera);
  updateMinimap();
}
animate();

// ---- QA level jump (only active when the page is opened with ?debug) -------------
// Click Start Mission, wait until you can move, then press 1, 2 or 3.
if (new URLSearchParams(location.search).has('debug')) {
  window.addEventListener('keydown', (e) => {
    if (e.repeat || inMenu) return;
    if (e.key === '1' || e.key === '2' || e.key === '3') {
      loadLevel(Number(e.key));
      console.log('[debug] jumped to level', e.key);
    }
  });
}
