import * as THREE from 'three';
import { createLevel1, ELEVATOR_IDLE_COLOR, ELEVATOR_ALARM_COLOR, ROOM_SCALE } from './levels/level1.js';
import { createLevel2 } from './levels/level2.js';
import { createLevel3 } from './levels/level3.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GuardA, GuardB, loadGuardModel, attachGuardClip } from './ai/guards.js';
import { Player, loadPlayerModel, attachPlayerClip } from './player/player.js';
import { loadEarpieceAudio, playLine } from './audio/earpiece.js';
import { fxTime } from './fx/shaders.js';
import { createDropoff } from './scene/dropoff.js';
import { startMusic, setMusicLevel, setMusicIntensity } from './audio/music.js';
import './audio/volume.js';   // - / + keys set the master volume
import { setChannelVolume, getChannelVolume } from './audio/volume.js';
import {
  resumeAudioContext, playTakedownThud, playKeyPickup, playKeycardPickup,
  playDoorUnlock, playDoorDenied, playElevatorDing, playWinSting, playLoseSting,
  startAlarmKlaxon, stopAlarmKlaxon, startHeartbeat, stopHeartbeat, playFootstep,
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
// True while the opening drop-off cinematic owns the camera. Declared up here
// (like missionUiOpen) because the unlock handler below can fire during the
// top-level await, and the cinematic deliberately runs with the pointer
// unlocked so the mouse-look "click to look" blocker must stay hidden.
let dropoffActive = false;
// True while the pause overlay owns the screen (pointer unlocked on purpose).
// Declared up here with the other UI-state flags so the unlock handler below
// can suppress the "click to look around" blocker while paused / in a menu.
let paused = false;
let settingsOpen = false;
let inMenu = true;   // main menu owns the screen (also declared-early for the unlock handler)
let modelsReady = false;    // player/guards loaded — New Game becomes clickable
let sessionStarted = false; // a mission run exists — main menu shows Continue
controls.addEventListener('unlock', () => {
  // Losing pointer lock mid-game (Esc, alt-tab, etc.) now opens the PAUSE menu
  // instead of the old "click to look around" blocker, so the player always
  // lands on real UI they can act on. Menu / cinematic / puzzle / end states
  // are unaffected, and pauseGame() is a no-op if we're already paused.
  if (missionUiOpen || dropoffActive || paused || inMenu) return;
  if (game.levelComplete || endScreenVisible()) return;
  pauseGame();
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
let playerBusy = false; // locked while a scripted action (takedown / pickup) plays
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  keys[k] = true;
  // During the opening cinematic any key skips straight to gameplay.
  if (dropoffActive) { if (!e.repeat) skipDropoff(); return; }
  if (missionUiOpen) return; // puzzle UI owns the keyboard
  if (k === 'escape' && !e.repeat) { handleEscape(); return; }
  // P is the dedicated pause key (Esc also works, via the pointer-lock unlock
  // handler). Toggling here means P both pauses and resumes.
  if (k === 'p' && !e.repeat && !settingsOpen) {
    if (paused) resumeGame(); else pauseGame();
    return;
  }
  if (paused || settingsOpen) return;   // pause / settings overlay owns the keyboard
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

    showLine(reason === 'partner_found' ? 'alarmPartnerFound' : reason === 'vault' ? 'l3Theft' : 'alarmSpotted');
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
    ambient: { color: 0x2a2a34, intensity: 0.5 },     // was 0x14141a / 0.2 - too dark now that the wing has mazes and a tile vault
    background: 0x050508,
    light: { color: 0xffb060, intensity: 7, distance: 9 },   // was 4 / 6
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
  clearAlarm: () => clearAlarm(),                          // level 3 checkpoint reload: alarm off again
  // sliding doors: `colliders` is main's own list (copied from the level at load), so doors are added/removed here
  removeCollider: (m) => { const i = colliders.indexOf(m); if (i >= 0) colliders.splice(i, 1); },
  addCollider: (m) => { if (!colliders.includes(m)) colliders.push(m); },
  line: (key, ms) => showLine(key, ms),                    // earpiece voice line + caption
  sfx: {
    pickup: () => playKeycardPickup(),
    unlock: () => playDoorUnlock(),
    denied: () => playDoorDenied(),
  },
};
// Undo game.triggerAlarm (klaxon, heartbeat, red lights). Level 3 uses this when a checkpoint
// from before the theft is reloaded.
function clearAlarm() {
  game.alarmActive = false;
  game.alarmReason = null;
  game.escapeTimeRemaining = null;
  stopAlarmKlaxon();
  stopHeartbeat();
  beaconLight.intensity = 0;
  elevatorIndicatorMat.emissive.setHex(ELEVATOR_IDLE_COLOR);
  const cfg = LEVEL_CONFIG[currentLevel];
  if (cfg) {
    ambient.color.setHex(cfg.ambient.color);
    ambient.intensity = cfg.ambient.intensity;
    scene.background.setHex(cfg.background);
  }
}
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
  playerBusy = false;      // a retry mid-action must not stay rooted
  clearTimers();           // drop any pending choreography beats from the last attempt
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
  const baseY = player.group.position.y;   // levels with stairs (level 3): test relative to the floor you're standing on
  
  for (let [ox, oz] of offsets) {
    for (let h of heights) {
      _testPoint.set(x + ox, baseY + h, z + oz);
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

// Retarget the loose Mixamo FBX clips onto each rig. The guard's Die clip must
// be attached to the shared template BEFORE any guard is constructed (they
// snapshot the template's clip list); the player's Punch/Pickup go on after.
await attachGuardClip('./assets/models/anim_die.fbx', 'Die');

const player = new Player(scene, playerGltf);
player.group.position.copy(PLAYER_SPAWN);
await attachPlayerClip(player, './assets/models/anim_punch.fbx', 'Punch');
await attachPlayerClip(player, './assets/models/anim_pickup.fbx', 'Pickup');

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

// Menu is ready once the player actually exists — enable New Game now.
// (refreshMenuItems() is invoked by the menu controller further down, once its
// element refs exist; calling it here would hit their temporal dead zone.)
modelsReady = true;

// First-load menu backdrop pose. The menu camera sits BEHIND the player, and at
// PLAYER_SPAWN that put it outside the lobby's north wall (a black backdrop), so
// for the pre-session menu we stand the player on open lobby floor facing +z —
// a guard patrol waypoint, therefore guaranteed clear. A live session keeps the
// player's real position (quit-to-menu / continue), and starting a mission
// resets to PLAYER_SPAWN anyway.
if (!sessionStarted) {
  player.group.position.set(2.5, 0, 3.5);
  player.group.rotation.y = 0;
  setGuardsVisible(false);   // clean backdrop: no frozen bind-pose guards behind the menu
}

// MENU CAMERA — a slow, gently-swaying shot from BEHIND the idle player, so the
// main menu's backdrop is the character standing in-frame (back view) exactly
// like the reference art. Reuses the same scene/player/renderer, no mini-scene.
const MENU_CAM_DIST = 3.1;
const MENU_CAM_HEIGHT = 1.55;
const _menuLookTarget = new THREE.Vector3();
const _menuBehind = new THREE.Vector3();

function updateMenuCamera(elapsed) {
  const ry = player.group.rotation.y;
  // player's forward on the ground plane; behind = the opposite direction
  const fwdX = Math.sin(ry), fwdZ = Math.cos(ry);
  const sway = Math.sin(elapsed * 0.18) * 0.16;          // barely-there drift = alive, not static
  const bx = -fwdX, bz = -fwdZ;
  const cos = Math.cos(sway), sin = Math.sin(sway);
  _menuBehind.set(bx * cos - bz * sin, 0, bx * sin + bz * cos);
  camera.position.set(
    player.group.position.x + _menuBehind.x * MENU_CAM_DIST,
    player.group.position.y + MENU_CAM_HEIGHT,
    player.group.position.z + _menuBehind.z * MENU_CAM_DIST
  );
  // Aim to the player's screen-LEFT so the body sits right-of-centre, leaving
  // room for the title / options column on the left like the reference.
  // (screen-right for a camera behind the player is (-fwdZ, 0, fwdX).)
  _menuLookTarget.set(
    player.group.position.x + fwdZ * 1.2,
    player.group.position.y + 1.15,
    player.group.position.z - fwdX * 1.2
  );
  camera.lookAt(_menuLookTarget);
}

// ---- OPENING DROP-OFF CINEMATIC -------------------------------------------
// Replaces the old static intro flythrough: a black sedan pulls up outside the
// building, the player steps out and walks to the entrance, then we fade to
// black and hand control back at the interior spawn. Skippable with any key or
// a click (keydown handler + canvas listener below). The exterior stage, the
// car and the camera choreography all live in scene/dropoff.js.
const fadeEl = document.getElementById('fade');
const skipHintEl = document.getElementById('skipHint');
let dropoff = null;
let savedCameraMode = null;

function setFade(opacity, ms = 500) {
  if (!fadeEl) return;
  fadeEl.style.transition = `opacity ${ms}ms ease`;
  fadeEl.style.opacity = String(opacity);
}

// Force the action visible in third person, remembering the player's choice so
// it can be restored afterwards. Null-guarded so nested calls don't clobber.
function forceThirdPerson() {
  if (savedCameraMode === null) savedCameraMode = cameraMode;
  cameraMode = CAMERA_MODE.THIRD;
  player.model.visible = true;
}
function restoreCameraMode() {
  if (savedCameraMode !== null) cameraMode = savedCameraMode;
  savedCameraMode = null;
  player.model.visible = cameraMode === CAMERA_MODE.THIRD;
}

function beginDropoff() {
  dropoffActive = true;
  setFade(0, 0);                       // start clear
  forceThirdPerson();
  root.visible = false;                // hide the interior for the exterior shot
  setGuardsVisible(false);
  blocker.style.display = 'none';      // the Start click already locked the pointer; keep the overlay away
  dropoff = createDropoff({
    scene, camera, player,
    spawn: PLAYER_SPAWN,
    onSubtitle: (txt, ms) => showSubtitle(txt, ms),
    onFadeOut: () => setFade(1, 550),
    onHandoff: () => finishDropoff(),
  });
  dropoff.start();
  if (skipHintEl) skipHintEl.style.display = 'block';
}

function finishDropoff() {
  if (skipHintEl) skipHintEl.style.display = 'none';
  if (dropoff) { dropoff.dispose(); dropoff = null; }
  dropoffActive = false;
  root.visible = true;
  setGuardsVisible(true);
  player.group.position.copy(PLAYER_SPAWN);
  player.group.rotation.y = 0;
  camera.rotation.set(0, Math.PI, 0);
  restoreCameraMode();
  if (!controls.isLocked) controls.lock();   // normally still locked from the Start click
  setFade(0, 750);                     // fade back in over the interior
  showLine('levelStart', 6000);
}

function skipDropoff() {
  if (dropoff) dropoff.skip();         // fires onFadeOut + onHandoff -> finishDropoff
  else finishDropoff();
}
// A click also skips (but not the same click that pressed Start — that lands on
// the menu button, not the canvas).
renderer.domElement.addEventListener('click', () => { if (dropoffActive) skipDropoff(); });

// ---- MAIN MENU / PAUSE / SETTINGS CONTROLLER ------------------------------
// Zelda-style vertical option lists. The main menu's backdrop is the live 3D
// scene (idle player from behind); the pause overlay's backdrop is the frozen
// gameplay frame (we simply stop updating the world and keep rendering it).
const menuContinueEl = document.getElementById('menuContinue');
const menuNewGameEl = document.getElementById('menuNewGame');
const menuSettingsEl = document.getElementById('menuSettings');
const pauseOverlayEl = document.getElementById('pauseOverlay');
const pauseResumeEl = document.getElementById('pauseResume');
const pauseSettingsEl = document.getElementById('pauseSettings');
const pauseQuitEl = document.getElementById('pauseQuit');
const settingsPanelEl = document.getElementById('settingsPanel');
const settingsBackEl = document.getElementById('settingsBack');
const menuCreditsEl = document.getElementById('menuCredits');
const creditsPanelEl = document.getElementById('creditsPanel');
const creditsBackEl = document.getElementById('creditsBack');
const pauseBtnEl = document.getElementById('pauseBtn');
const controlsPanelEl = document.getElementById('controlsPanel');
const minimapEl = document.getElementById('minimap');
const volSliders = {
  master: document.getElementById('volMaster'),
  music: document.getElementById('volMusic'),
  sfx: document.getElementById('volSfx'),
};
const volVals = {
  master: document.getElementById('volMasterVal'),
  music: document.getElementById('volMusicVal'),
  sfx: document.getElementById('volSfxVal'),
};

const MENU_ITEMS = () => [menuContinueEl, menuNewGameEl, menuSettingsEl, menuCreditsEl].filter((b) => !b.hidden && !b.disabled);
const PAUSE_ITEMS = () => [pauseResumeEl, pauseSettingsEl, pauseQuitEl];
let menuIndex = 0, pauseIndex = 0;

function paintSelection(items, index) {
  items.forEach((b, i) => b.classList.toggle('selected', i === index));
}
function refreshMenuItems() {
  menuContinueEl.hidden = !sessionStarted;
  menuNewGameEl.disabled = !modelsReady;
  menuNewGameEl.style.opacity = modelsReady ? '' : '0.4';
  const items = MENU_ITEMS();
  menuIndex = Math.max(0, Math.min(menuIndex, items.length - 1));
  paintSelection(items, menuIndex);
}
function showMainMenu() {
  mainMenuEl.style.display = 'flex';
  pauseOverlayEl.style.display = 'none';
  settingsPanelEl.style.display = 'none'; creditsPanelEl.style.display = 'none';
  settingsOpen = false;
  setGuardsVisible(false);   // menu backdrop = the player alone, like the reference
  refreshMenuItems();
}
function hideMenus() {
  mainMenuEl.style.display = 'none';
  pauseOverlayEl.style.display = 'none';
  settingsPanelEl.style.display = 'none'; creditsPanelEl.style.display = 'none';
  settingsOpen = false;
}

function newGame() {
  resumeAudioContext();
  if (sessionStarted) { location.reload(); return; }   // a run already exists: start clean
  sessionStarted = true;
  hideMenus();
  inMenu = false;
  controls.lock();            // this click is the gesture for pointer lock + audio
  startMusic(currentLevel);
  beginDropoff();
}
function continueGame() {
  if (!sessionStarted) return;
  hideMenus();
  inMenu = false;
  paused = false;
  setGuardsVisible(true);    // bring the world back when resuming a session
  controls.lock();            // click gesture => re-lock is allowed
  resumeAudioContext();
}
function pauseGame() {
  if (paused || inMenu || dropoffActive || missionUiOpen || endScreenVisible() || game.levelComplete) return;
  paused = true;
  for (const k in keys) keys[k] = false;   // don't resume mid-stride
  controls.unlock();
  pauseOverlayEl.style.display = 'flex';
  pauseIndex = 0;
  paintSelection(PAUSE_ITEMS(), pauseIndex);
}
function resumeGame() {
  if (!paused) return;
  paused = false;
  pauseOverlayEl.style.display = 'none';
  settingsPanelEl.style.display = 'none'; creditsPanelEl.style.display = 'none';
  settingsOpen = false;
  controls.lock();            // called from the Resume click => valid gesture
  setTimeout(() => {
    if (controls.isLocked || paused || inMenu || missionUiOpen || dropoffActive) return;
    // Lock was refused (e.g. a resume path that grants no pointer-lock
    // activation). Drop back into the pause menu rather than the bare
    // "click to look around" blocker, so the player can click Resume — a real
    // gesture — to re-lock.
    paused = true;
    pauseOverlayEl.style.display = 'flex';
  }, 300);
}
function quitToMenu() {
  paused = false;
  pauseOverlayEl.style.display = 'none';
  settingsPanelEl.style.display = 'none'; creditsPanelEl.style.display = 'none';
  settingsOpen = false;
  inMenu = true;
  sessionStarted = true;
  controls.unlock();
  showMainMenu();             // Continue now offered; world stays frozen behind
}

function syncSliders() {
  for (const ch of ['master', 'music', 'sfx']) {
    const v = Math.round(getChannelVolume(ch) * 100);
    volSliders[ch].value = String(v);
    volVals[ch].textContent = v + '%';
  }
}
function openSettings() {
  settingsOpen = true;
  syncSliders();
  settingsPanelEl.style.display = 'flex';
}
function closeSettings() {
  settingsOpen = false;
  settingsPanelEl.style.display = 'none'; creditsPanelEl.style.display = 'none';
}

// Credits reuse the settings 'modal' flag, so the pause/menu keys and the HUD are already locked out while it is open.
// startCreditsRoll(): measure the text, set how far and how long it scrolls, and restart the animation from the top.
function startCreditsRoll() {
  const roll = document.getElementById('creditsRoll');
  roll.classList.remove('playing', 'paused');
  const vh = window.innerHeight;
  const h = roll.scrollHeight;
  roll.style.setProperty('--roll-from', vh + 'px');
  const to = Math.round(vh * 0.5 - h);                                         // stop with "Thank you for playing" held mid-screen
  roll.style.setProperty('--roll-to', to + 'px');
  roll.style.setProperty('--roll-dur', Math.max(20, (vh - to) / 55) + 's');   // about 55 px per second
  void roll.offsetWidth;                                                       // force a restart
  roll.classList.add('playing');
}
function toggleCreditsPause() {
  document.getElementById('creditsRoll').classList.toggle('paused');
}
function openCredits() {
  settingsOpen = true;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();   // so SPACE can't re-press the Credits button
  creditsPanelEl.style.display = 'flex';
  startCreditsRoll();
}
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && creditsPanelEl.style.display === 'flex') { e.preventDefault(); toggleCreditsPause(); }
});

function handleEscape() {
  if (settingsOpen) { closeSettings(); return; }
  // Already paused (or in a state where pause doesn't apply): Esc does nothing
  // here — resuming needs a real gesture for pointer lock, so use P or click
  // Resume. The pointer-lock unlock handler is what opened the pause menu.
  if (paused || inMenu || dropoffActive || missionUiOpen) return;
  pauseGame();
}

// Menu / pause keyboard navigation (arrows or W/S to move, Enter/Space to pick).
window.addEventListener('keydown', (e) => {
  if (settingsOpen || e.repeat) return;
  const k = e.key.toLowerCase();
  const nav = (items, getIndex, setIndex) => {
    if (k === 'arrowdown' || k === 's') { setIndex((getIndex() + 1) % items.length); paintSelection(items, getIndex()); }
    else if (k === 'arrowup' || k === 'w') { setIndex((getIndex() - 1 + items.length) % items.length); paintSelection(items, getIndex()); }
    else if (k === 'enter' || k === ' ') { items[getIndex()].click(); }
  };
  if (inMenu) { const it = MENU_ITEMS(); nav(it, () => menuIndex, (i) => { menuIndex = i; }); }
  else if (paused) { const it = PAUSE_ITEMS(); nav(it, () => pauseIndex, (i) => { pauseIndex = i; }); }
});

// Mouse: hover selects, click activates.
function bindList(items, getIndex, setIndex) {
  items().forEach((b, i) => {
    b.addEventListener('mouseenter', () => { setIndex(i); paintSelection(items(), getIndex()); });
  });
}
bindList(MENU_ITEMS, () => menuIndex, (i) => { menuIndex = i; });
bindList(PAUSE_ITEMS, () => pauseIndex, (i) => { pauseIndex = i; });
menuContinueEl.addEventListener('click', continueGame);
menuNewGameEl.addEventListener('click', newGame);
menuSettingsEl.addEventListener('click', openSettings);
menuCreditsEl.addEventListener('click', openCredits);
creditsBackEl.addEventListener('click', closeSettings);
pauseResumeEl.addEventListener('click', resumeGame);
pauseSettingsEl.addEventListener('click', openSettings);
pauseQuitEl.addEventListener('click', quitToMenu);
settingsBackEl.addEventListener('click', closeSettings);
pauseBtnEl.addEventListener('click', pauseGame);

// Settings sliders + SFX preview ("hear it before you commit").
for (const ch of ['master', 'music', 'sfx']) {
  volSliders[ch].addEventListener('input', () => {
    const v = Number(volSliders[ch].value) / 100;
    setChannelVolume(ch, v);
    volVals[ch].textContent = Math.round(v * 100) + '%';
  });
}
document.getElementById('prevFootstep').addEventListener('click', () => {
  resumeAudioContext();
  playFootstep({ gain: 0.07, pan: -1 });
  setTimeout(() => playFootstep({ gain: 0.07, pan: 1 }), 320);
  setTimeout(() => playFootstep({ gain: 0.07, pan: -1 }), 640);
});
document.getElementById('prevKey').addEventListener('click', () => { resumeAudioContext(); playKeyPickup(); });
document.getElementById('prevDoor').addEventListener('click', () => { resumeAudioContext(); playDoorUnlock(); });

refreshMenuItems();

// ---- Scripted-action choreography (takedown / pickup) ---------------------
// A tiny elapsed-time scheduler so impact sounds and follow-up beats line up
// with the animation without blocking the render loop.
const _timers = [];
function after(delay, fn) { _timers.push({ at: clock.elapsedTime + delay, fn }); }
function updateTimers() {
  const now = clock.elapsedTime;
  for (let i = _timers.length - 1; i >= 0; i--) {
    if (now >= _timers[i].at) { const fn = _timers[i].fn; _timers.splice(i, 1); fn(); }
  }
}
function clearTimers() { _timers.length = 0; }

function faceTarget(target) {
  const dx = target.x - player.group.position.x;
  const dz = target.z - player.group.position.z;
  if (dx * dx + dz * dz > 1e-4) player.group.rotation.y = Math.atan2(dx, dz);
}

// Two punches, then the guard drops (Die animation). Movement stays locked and
// the camera swings to third person so the whole beat is visible.
function startTakedown() {
  if (playerBusy || guardA.down) return;
  playerBusy = true;
  forceThirdPerson();
  faceTarget(guardA.group.position);
  guardA.facePoint(player.group.position);
  const punchDur = player.clipDuration('Punch') || 0.7;
  const impactAt = punchDur * 0.42;
  let punches = 0;
  const swing = () => {
    after(impactAt, () => playTakedownThud());
    player.playOneShot('Punch', () => {
      punches += 1;
      if (punches < 2) { swing(); return; }
      guardA.takeDown();               // retargeted Die clip, clamped on the fallen frame
      showLine('takedown', 4500);
      keyMesh.visible = true;          // key drops beside the body
      after(0.55, () => { restoreCameraMode(); playerBusy = false; });
    });
  };
  swing();
}

// Kneel-and-take (Pickup animation) for the guard's key or the desk access card.
function startPickup(kind) {
  if (playerBusy) return;
  playerBusy = true;
  forceThirdPerson();
  faceTarget(kind === 'key' ? keyMesh.position : keycardMesh.position);
  const dur = player.clipDuration('Pickup') || 1.0;
  player.playOneShot('Pickup', () => { restoreCameraMode(); playerBusy = false; });
  after(dur * 0.5, () => {
    if (kind === 'key') {
      guardA.takeKey();
      playKeyPickup();
      keyMesh.visible = false;
      showSubtitle('Key acquired \u2014 use it to unlock the manager\'s office.', 3000);
    } else {
      game.hasKeycard = true;
      keycardMesh.visible = false;
      playKeycardPickup();
      showLine('keycardPickup');
    }
  });
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
  if (playerBusy) return; // mid takedown / pickup — ignore new interactions
  const pos = player.group.position;
  // Guard A: two-punch takedown, then kneel to take the key.
  if (guardA.horizDistanceTo(pos) <= guardA.interactDistance) {
    if (!guardA.down) { startTakedown(); return; }
    if (!guardA.hasKey) { startPickup('key'); return; }
  }
  if (nearOfficeDoor()) { tryUnlockOfficeDoor(); return; }
  if (!game.hasKeycard && distanceXZ(pos, keycardMesh.position) <= KEYCARD_INTERACT_DISTANCE) {
    startPickup('card'); // kneel-and-take animation for the access card too
  }
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

  playerBusy = false;      // clear any mid-takedown/pickup lock from the failed attempt
  clearTimers();
  restoreCameraMode();     // in case a retry lands while an action had forced third person

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

// Footstep cadence. We accumulate a gait phase while the player actually moves
// and fire one alternating footstep per full cycle, so the steps land exactly on
// the walk/run animation's pace. Gains are deliberately low — the building is
// meant to be quiet — and crouch/crawl are softer and slower than a sprint.
let gaitPhase = 0;
let gaitFoot = 1;
const GAIT = {
  Walking: { rate: 1.9, gain: 0.055, bright: 700 },
  Sprint:  { rate: 2.7, gain: 0.085, bright: 950 },
  LowWalk: { rate: 1.4, gain: 0.035, bright: 520 },
  Crawl:   { rate: 1.1, gain: 0.028, bright: 420 },
};

function updateMovement(dt) {
  // While a scripted action (takedown / pickup) plays, the mixer owns the
  // animation and the player is rooted — don't touch position or clips here.
  if (playerBusy) return;
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
      const g = GAIT[clip];
      if (g) {
        gaitPhase += dt * g.rate;
        if (gaitPhase >= 1) {
          gaitPhase -= 1;
          gaitFoot = -gaitFoot;
          playFootstep({ gain: g.gain, pan: gaitFoot, bright: g.bright });
        }
      }
    } else {
      player.playAction('Idle');
      gaitPhase = 0;
    }
  } else {
    player.playAction('Idle');
    gaitPhase = 0;
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
    player.playAction('Idle');   // menu backdrop = the character standing, back view
    player.update(dt);
  } else if (dropoffActive) {
    if (dropoff) dropoff.update(dt);   // cinematic owns camera + car + player
    player.update(dt);
  } else if (paused) {
    // Pause overlay up: freeze the world exactly where it was. We skip every
    // update (movement, guards, mixer, timers) but still render, so the frame
    // behind the overlay is precisely the moment the player paused.
  } else if (missionUiOpen) {
    // puzzle overlay open: world is paused, player just idles
    player.playAction('Idle');
    player.update(dt);
  } else if (!game.levelComplete && !endScreenVisible()) {
    updateMovement(dt);
    if (levelHandle && levelHandle.getFloorHeight) {   // level 3: stairs up to the roof, tiles that collapse
      const pp = player.group.position;
      pp.y += (levelHandle.getFloorHeight(pp.x, pp.z) - pp.y) * Math.min(1, dt * 14);
    }
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

  if (!inMenu && !paused) updateTimers();   // fire scheduled beats (impact sounds, item grants)

    const promptText = (inMenu || paused || dropoffActive || game.levelComplete || endScreenVisible()) ? null : getInteractPrompt();
  promptEl.textContent = promptText || '';
  promptEl.style.display = promptText ? 'block' : 'none';

  if (!inMenu && !paused) { updateElevatorDoors(dt); updateOfficeDoor(dt); }

  if (game.alarmActive && !game.levelComplete) {
    // A sharper curve than plain sine, exponent < 1 snaps through the
    // middle faster and lingers near the extremes, closer to a strobe than
    // a smooth breathing pulse.
    const pulse = Math.pow(Math.abs(Math.sin(elapsed * 6)), 0.35);
    ambient.intensity = 0.35 + pulse * 0.55;
  }
  updateAlarmBeacon(elapsed);
  // soundtrack reacts to the game: calm -> tense as alarms / guard detection rise
  if (!inMenu && !paused) setMusicIntensity(game.alarmActive ? 1 : ((levelHandle && levelHandle.threat) || 0));

  // Pause button only during live gameplay (hidden in menus / cinematic / puzzles / end).
  const gameplayLive = !inMenu && !paused && !dropoffActive && !missionUiOpen && !game.levelComplete && !endScreenVisible();
  pauseBtnEl.style.display = gameplayLive ? 'block' : 'none';
  // The HUD (controls list + minimap) belongs to live gameplay only — keep the
  // menu / pause / cinematic frames clean like the reference art.
  const hudLive = gameplayLive && !settingsOpen;
  controlsPanelEl.style.display = hudLive ? 'block' : 'none';
  minimapEl.style.display = hudLive ? 'block' : 'none';

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
