import * as THREE from 'three';
import { ROOM_SCALE } from './level1.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
// The same shared guard model Level 1 uses. Adjust this path if guards.js lives elsewhere.
import { getGuardTemplate, loadGuardModel } from '../ai/guards.js';

// ============================================================
// LEVEL 2 — Server Room & Labs
// Elevator Landing -> Server Maze (cameras + lasers, Camera Control Room
// off the east wall) -> Terminal Room (safe + hack terminal) -> Exit Elevator.
//
// Same conventions as level1.js: horizontal footprints are multiplied by
// ROOM_SCALE, wall/ceiling HEIGHT and prop sizes are not. The level is one
// sealed shell — every room shares its walls with the next one and the
// only openings are the doorways.
//
// MISSIONS (all playable, driven by the `missions` object returned below):
//   1. Find the safe code   — sticky note on a server rack in the maze
//   2. Open the safe        — keypad puzzle, gives the access badge
//   3. (Optional) Cameras   — wire puzzle in the Camera Control Room
//   4. Hack the terminal    — hold E, needs the badge
//   5. Reach the exit elevator
// ============================================================

const S = ROOM_SCALE;
const CEILING_HEIGHT = 4;
const WALL_T = 0.2;
const DOOR_W = 3.5;      // every doorway, world units
const DOOR_H = 2.6;      // lintel sits above this
const CONE_LEN = 8;      // camera vision cone length / base radius (shared by the
const CONE_R = 2.4;      // visual cone AND the detection maths so they always match)
const CAM_SWEEP = 0.85;  // radians each camera swings either side of its mount direction

// Security tuning — everything you'd want to tweak in one place.
const SEC = {
  CAMERA_TIME: 3,        // "seconds" of exposure before a camera escalates...
  CAM_SEEN_RATE: 1.5,    // ...gained per real second while a cone is actually on you
  CAM_ZONE_RATE: 0.5,    // ...and per second while you're in its area but the cone is elsewhere
  LASER_COOLDOWN: 3,     // seconds before the same laser can trip again
  MAX_LEVEL: 5,
  MAX_GUARDS: 10,        // total guards alive at once
  BASE_SPEED: 2.2,       // guard run speed at security level 1
  SPEED_PER_LEVEL: 0.2,  // extra speed per further level
};

// ---------- materials (shared, module-level) ----------
const floorMat = new THREE.MeshStandardMaterial({ color: 0x3a4148 });
const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a3238 });
const ceilingMat = new THREE.MeshStandardMaterial({ color: 0x232a30 });
const lightFrameMat = new THREE.MeshStandardMaterial({ color: 0x1b2026, roughness: 0.5, metalness: 0.4 });
const fixtureMat = new THREE.MeshStandardMaterial({
  color: 0xcfe8ff, emissive: 0xaad4ff, emissiveIntensity: 1.3,
});
const rackMat = new THREE.MeshStandardMaterial({ color: 0x14181c, metalness: 0.4, roughness: 0.6 });
const ledMat = new THREE.MeshStandardMaterial({ color: 0x33ff66, emissive: 0x33ff66, emissiveIntensity: 1 });
const metalMat = new THREE.MeshStandardMaterial({ color: 0x8a9098, metalness: 0.7, roughness: 0.35 });
const frameMat = new THREE.MeshStandardMaterial({ color: 0x20262c, metalness: 0.5, roughness: 0.5 });
const cavityMat = new THREE.MeshStandardMaterial({ color: 0x050607 });
const markerMat = {
  laser: new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff2222, emissiveIntensity: 1.5 }),
  terminal: new THREE.MeshStandardMaterial({ color: 0x33ffcc, emissive: 0x33ffcc, emissiveIntensity: 0.5 }),
  wirePanel: new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xffaa00, emissiveIntensity: 0.5 }),
  safe: new THREE.MeshStandardMaterial({ color: 0x33ff99, emissive: 0x33ff99, emissiveIntensity: 0.5 }),
};
const WIRE_COLORS = [0xff3b3b, 0x3b8bff, 0xffe03b, 0x3bff6a, 0xd63bff];

// ---------- geometry helpers ----------
function makeFloor(width, depth, x, z) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(x, 0, z);
  floor.name = 'floor';
  return floor;
}

function makeCeiling(width, depth, x, y, z) {
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(x, y, z);
  ceiling.name = 'ceiling';
  return ceiling;
}

// Flush ceiling panel with a trim frame (same look as level1). main.js adds
// the matching real PointLight from lightFixturePositions.
function makeLightFixture(x, y, z, width = 1.2, depth = 1.2) {
  const fixture = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), fixtureMat);
  fixture.rotation.x = Math.PI / 2;
  fixture.position.set(x, y - 0.02, z);
  fixture.name = 'light_fixture';
  const t = 0.06;
  [[0, -depth / 2, width + t, t], [0, depth / 2, width + t, t],
   [-width / 2, 0, t, depth + t], [width / 2, 0, t, depth + t]].forEach(([bx, by, bw, bd]) => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, bd, t), lightFrameMat);
    bar.position.set(bx, by, 0.02);
    bar.name = 'light_frame';
    fixture.add(bar);
  });
  return fixture;
}

function makeWall(width, height, thickness, x, y, z, rotationY = 0) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(width, height, thickness), wallMat);
  wall.position.set(x, y, z);
  wall.rotation.y = rotationY;
  return wall;
}

// A wall running along X at a fixed z, optionally with a doorway (gap = centre x).
// The doorway gets a lintel so the opening reads as a door, not a missing wall.
function wallAlongX(group, z, x0, x1, gapCenter = null) {
  if (gapCenter === null) {
    group.add(makeWall(x1 - x0, CEILING_HEIGHT, WALL_T, (x0 + x1) / 2, CEILING_HEIGHT / 2, z));
    return;
  }
  const g0 = gapCenter - DOOR_W / 2, g1 = gapCenter + DOOR_W / 2;
  group.add(makeWall(g0 - x0, CEILING_HEIGHT, WALL_T, (x0 + g0) / 2, CEILING_HEIGHT / 2, z));
  group.add(makeWall(x1 - g1, CEILING_HEIGHT, WALL_T, (g1 + x1) / 2, CEILING_HEIGHT / 2, z));
  const lh = CEILING_HEIGHT - DOOR_H;
  group.add(makeWall(DOOR_W, lh, WALL_T, gapCenter, DOOR_H + lh / 2, z));
}

// A wall running along Z at a fixed x. The outer ends are pushed out by half
// a wall thickness so corners close with no notch.
function wallAlongZ(group, x, z0, z1, gapCenter = null) {
  const e = WALL_T / 2;
  const a = z0 - e, b = z1 + e;
  if (gapCenter === null) {
    group.add(makeWall(b - a, CEILING_HEIGHT, WALL_T, x, CEILING_HEIGHT / 2, (a + b) / 2, Math.PI / 2));
    return;
  }
  const g0 = gapCenter - DOOR_W / 2, g1 = gapCenter + DOOR_W / 2;
  group.add(makeWall(g0 - a, CEILING_HEIGHT, WALL_T, x, CEILING_HEIGHT / 2, (a + g0) / 2, Math.PI / 2));
  group.add(makeWall(b - g1, CEILING_HEIGHT, WALL_T, x, CEILING_HEIGHT / 2, (g1 + b) / 2, Math.PI / 2));
  const lh = CEILING_HEIGHT - DOOR_H;
  group.add(makeWall(DOOR_W, lh, WALL_T, x, DOOR_H + lh / 2, gapCenter, Math.PI / 2));
}

// ---------- props ----------
function makeNoteTexture(code) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffe866';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#6b5a00';
  ctx.font = 'bold 18px "Comic Sans MS", cursive, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('safe code:', 64, 38);
  ctx.font = 'bold 34px "Comic Sans MS", cursive, sans-serif';
  ctx.fillText(code.split('').join(' '), 64, 84);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.strokeRect(4, 4, 120, 120);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Server rack. Rotated so its 1.2m side runs along Z (forms aisle rows) and
// its LED face points `faceDir` (+1 = toward +x, -1 = toward -x).
function makeServerRack(x, z, faceDir = 1) {
  const rack = new THREE.Group();
  rack.name = 'furniture_serverRack';
  rack.position.set(x, 0, z);
  rack.rotation.y = faceDir > 0 ? Math.PI / 2 : -Math.PI / 2;

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.8), rackMat);
  body.position.set(0, 1.1, 0);
  body.name = 'collider_serverRack';
  rack.add(body);

  for (let i = 0; i < 4; i++) {
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.02), ledMat);
    led.position.set(-0.4 + i * 0.25, 1.8, 0.41);
    rack.add(led);
  }
  return rack;
}

// Wall-mounted sweeping camera. Yaw/pitch live on `head`, which update()
// swings side to side. The translucent cone is the readable "vision cone".
function makeCamera(x, y, z, baseYaw, phase, lensMat, coneMat) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = baseYaw;
  group.name = 'marker_cameraMount';

  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.25), rackMat);
  bracket.position.set(0, 0, 0.05);
  group.add(bracket);

  const head = new THREE.Group();
  head.rotation.order = 'YXZ';
  head.rotation.x = 0.3; // angled down so the cone sweeps the floor, not the ceiling
  head.position.set(0, -0.12, 0.15);
  group.add(head);

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.4), rackMat);
  body.position.set(0, 0, 0.15);
  head.add(body);

  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), lensMat);
  lens.position.set(0, 0, 0.36);
  lens.name = 'marker_camera';
  head.add(lens);

  const cone = new THREE.Mesh(new THREE.ConeGeometry(CONE_R, CONE_LEN, 20, 1, true), coneMat);
  cone.rotation.x = -Math.PI / 2;        // apex at the lens, opening toward +z
  cone.position.set(0, 0, 0.36 + CONE_LEN / 2);
  cone.name = 'marker_cameraCone';
  head.add(cone);

  return { group, head, cone, lens, phase, seen: false };
}

function makeLaserGate(x, y, z, width, rotationY = 0, mat = markerMat.laser) {
  const laser = new THREE.Mesh(new THREE.BoxGeometry(width, 0.03, 0.03), mat);
  laser.position.set(x, y, z);
  laser.rotation.y = rotationY;
  laser.name = 'marker_laser';
  return laser;
}

function makeWirePuzzlePanel(x, y, z, rotationY, backingMat) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = rotationY;
  group.name = 'marker_wirePuzzle';

  const backing = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.0, 0.08), backingMat);
  backing.name = 'collider_wirePanel';
  group.add(backing);

  WIRE_COLORS.forEach((color, i) => {
    const wireMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8 });
    const yPos = 0.35 - i * 0.18;
    const leftEnd = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), wireMat);
    leftEnd.position.set(-0.55, yPos, 0.05);
    leftEnd.name = `marker_wireEnd_${i}`;
    group.add(leftEnd);
    const rightSocket = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), wireMat);
    rightSocket.position.set(0.55, yPos, 0.05);
    rightSocket.name = `marker_wireSocket_${i}`;
    group.add(rightSocket);
  });
  return group;
}

// Safe with a hinged door. `pivot` swings open when the code is right.
function makeSafe(x, z, rotationY, keypadMat) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = rotationY;
  group.name = 'marker_safe';

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.8), rackMat);
  body.position.set(0, 0.55, 0);
  body.name = 'collider_safe';
  group.add(body);

  const cavity = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.02), cavityMat);
  cavity.position.set(0, 0.55, 0.405);
  group.add(cavity);

  const pivot = new THREE.Group();
  pivot.position.set(-0.45, 0, 0.4); // hinge on the left edge of the front face
  group.add(pivot);

  const door = new THREE.Mesh(new THREE.BoxGeometry(0.86, 1.06, 0.06), metalMat);
  door.position.set(0.43, 0.55, 0.03);
  pivot.add(door);

  const keypad = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.02), keypadMat);
  keypad.position.set(0.22, 0.1, 0.04);
  keypad.name = 'marker_safeKeypad';
  door.add(keypad);

  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.05), frameMat);
  handle.position.set(-0.2, 0, 0.05);
  door.add(handle);

  return { group, pivot };
}

// Elevator door set on a wall. Local +z faces into the room; origin is on
// the room-side wall face. Doors slide into the side jambs when opened.
function makeElevator(x, z, rotationY, indicatorMat) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = rotationY;
  group.name = 'elevator_exit';

  const jambL = new THREE.Mesh(new THREE.BoxGeometry(0.7, 3.0, 0.3), frameMat);
  jambL.position.set(-1.25, 1.5, 0.15);
  const jambR = jambL.clone();
  jambR.position.x = 1.25;
  const head = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.4, 0.3), frameMat);
  head.position.set(0, 2.8, 0.15);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.6, 0.02), cavityMat);
  cab.position.set(0, 1.3, 0.01);
  group.add(jambL, jambR, head, cab);

  const doorL = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.6, 0.06), metalMat);
  doorL.position.set(-0.45, 1.3, 0.06);
  const doorR = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.6, 0.06), metalMat);
  doorR.position.set(0.45, 1.3, 0.06);
  group.add(doorL, doorR);

  const indicator = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.04), indicatorMat);
  indicator.position.set(0, 2.8, 0.32);
  indicator.name = 'elevator_indicator';
  group.add(indicator);

  return { group, doorL, doorR, closedX: 0.45, openX: 1.15 };
}

// ============================================================
// MISSION UI — plain DOM, injected/removed by the level itself so no
// index.html changes are needed.
// ============================================================
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
const cssColor = (hex) => '#' + hex.toString(16).padStart(6, '0');
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const UI_CSS = `
#l2-tracker{position:fixed;top:14px;left:14px;z-index:20;min-width:230px;max-width:290px;padding:10px 14px;
  background:rgba(6,14,22,.72);border:1px solid rgba(120,200,255,.35);border-radius:6px;
  font:13px/1.45 monospace;color:#cfe8ff;pointer-events:none}
#l2-tracker h4{margin:0 0 6px;font-size:11px;letter-spacing:.15em;color:#7fc8ff}
#l2-tracker .it{display:flex;gap:8px}
#l2-tracker .it.done{color:#6dff9a;text-decoration:line-through;opacity:.8}
#l2-tracker .it.opt{color:#ffd27a}
#l2-tracker .it.done.opt{color:#6dff9a}
#l2-tracker .code{margin-left:22px;color:#fff3a0;font-weight:bold;letter-spacing:.2em}
#l2-hold{position:fixed;left:50%;top:62%;transform:translateX(-50%);z-index:20;width:260px;display:none;
  font:12px monospace;color:#7fffd4;text-align:center;pointer-events:none}
#l2-hold .bar{margin-top:4px;height:10px;border:1px solid #33ffcc;background:rgba(0,0,0,.6)}
#l2-hold .fill{height:100%;width:0;background:#33ffcc}
#l2-overlay{position:fixed;inset:0;z-index:1000;display:none;align-items:center;justify-content:center;
  background:rgba(0,0,0,.66);font-family:monospace;color:#cfe8ff}
#l2-panel{background:#0b141c;border:1px solid #3a7ca8;border-radius:8px;padding:22px 28px;min-width:380px;
  box-shadow:0 0 40px rgba(60,160,255,.25);text-align:center}
#l2-panel h2{margin:0 0 6px;font-size:16px;letter-spacing:.18em;color:#7fc8ff}
#l2-panel p{margin:0 0 14px;font-size:12px;opacity:.8}
#l2-panel .status{min-height:18px;margin:12px 0 4px;font-size:13px}
#l2-panel .ok{color:#6dff9a}#l2-panel .bad{color:#ff6b6b}
#l2-panel button.close{margin-top:8px;padding:7px 18px;background:#14303f;color:#cfe8ff;border:1px solid #3a7ca8;
  border-radius:4px;font:13px monospace;cursor:pointer}
#l2-panel button.close:hover{background:#1d4a61}
.l2-wires{position:relative;display:flex;justify-content:space-between;width:420px;height:290px;margin:0 auto;padding:0 10px;box-sizing:border-box}
.l2-wires svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.l2-col{display:flex;flex-direction:column;justify-content:space-between;z-index:1}
.l2-node{width:34px;height:34px;border-radius:50%;border:3px solid #0b141c;outline:2px solid #456;cursor:pointer}
.l2-node.sel{outline:3px solid #fff;transform:scale(1.15)}
.l2-node.lock{cursor:default;outline:2px solid #6dff9a}
.l2-shake{animation:l2shake .35s}
@keyframes l2shake{25%{transform:translateX(-7px)}75%{transform:translateX(7px)}}
.l2-disp{font-size:30px;letter-spacing:.4em;padding:10px 0 10px .4em;margin:0 auto 12px;width:210px;background:#000;
  border:1px solid #3a7ca8;color:#7fffd4;min-height:38px}
.l2-disp.bad{color:#ff6b6b;border-color:#ff6b6b}.l2-disp.ok{color:#6dff9a;border-color:#6dff9a}
.l2-pad{display:grid;grid-template-columns:repeat(3,62px);gap:8px;justify-content:center}
.l2-pad button{height:46px;background:#14303f;color:#cfe8ff;border:1px solid #3a7ca8;border-radius:4px;font:18px monospace;cursor:pointer}
.l2-pad button:hover{background:#1d4a61}
#l2-detect{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:20;width:300px;display:none;
  font:12px monospace;color:#ff9a7a;text-align:center;pointer-events:none}
#l2-detect .bar{margin-top:4px;height:10px;border:1px solid #ff5533;background:rgba(0,0,0,.6)}
#l2-detect .fill{height:100%;width:0;background:#ff5533}
#l2-sec{position:fixed;top:14px;right:14px;z-index:20;display:none;padding:8px 14px;background:rgba(30,6,6,.72);
  border:1px solid rgba(255,90,70,.45);border-radius:6px;font:13px monospace;letter-spacing:.12em;color:#ffb0a0;pointer-events:none}
`;

function createMissionUI(onUiChange, localSecHud = true) {
  const style = document.createElement('style');
  style.textContent = UI_CSS;
  document.head.appendChild(style);

  const tracker = el('div'); tracker.id = 'l2-tracker';
  const hold = el('div'); hold.id = 'l2-hold';
  const holdLabel = el('div', '', 'HACKING…');
  const holdBar = el('div', 'bar'); const holdFill = el('div', 'fill');
  holdBar.appendChild(holdFill); hold.append(holdLabel, holdBar);
  const overlay = el('div'); overlay.id = 'l2-overlay';
  const panel = el('div'); panel.id = 'l2-panel';
  overlay.appendChild(panel);
  const detect = el('div'); detect.id = 'l2-detect';
  const detectBar = el('div', 'bar'); const detectFill = el('div', 'fill');
  detectBar.appendChild(detectFill);
  detect.append(el('div', '', '⚠ CAMERA LOCK — LEAVE ITS VIEW'), detectBar);
  const sec = el('div'); sec.id = 'l2-sec';
  document.body.append(tracker, hold, overlay, detect, sec);

  let open = false;
  let keyHandler = null;
  let timers = [];

  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }

  function show(build) {
    panel.innerHTML = '';
    build(panel);
    overlay.style.display = 'flex';
    open = true;
    onUiChange(true, false);
  }
  function close(relock) {
    if (!open) return;
    overlay.style.display = 'none';
    panel.innerHTML = '';
    if (keyHandler) window.removeEventListener('keydown', keyHandler, true);
    keyHandler = null;
    timers.forEach(clearTimeout); timers = [];
    open = false;
    onUiChange(false, relock);
  }
  function listenKeys(fn) {
    keyHandler = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); return; }
      fn(e);
    };
    window.addEventListener('keydown', keyHandler, true);
  }

  return {
    isOpen: () => open,
    close,

    setTracker(items) {
      tracker.innerHTML = '';
      tracker.appendChild(el('h4', '', 'OBJECTIVES'));
      items.forEach((it) => {
        const row = el('div', 'it' + (it.done ? ' done' : '') + (it.optional ? ' opt' : ''));
        row.append(el('span', '', it.done ? '✔' : '▫'), el('span', '', it.text));
        tracker.appendChild(row);
        if (it.sub) tracker.appendChild(el('div', 'code', it.sub));
      });
    },

    setHold(frac) {
      if (frac === null) { hold.style.display = 'none'; return; }
      hold.style.display = 'block';
      holdFill.style.width = Math.round(frac * 100) + '%';
    },

    // camera-detection meter (null hides it)
    setDetect(frac) {
      if (frac === null) { detect.style.display = 'none'; return; }
      detect.style.display = 'block';
      detectFill.style.width = Math.round(frac * 100) + '%';
    },

    // local security-level badge; pass localSecurityHud:false in hooks if main.js draws its own
    setSecurity(level) {
      if (!localSecHud) return;
      sec.style.display = level > 0 ? 'block' : 'none';
      sec.textContent = 'SECURITY LEVEL ' + level;
    },

    // ---- wire puzzle ----
    showWires(onSolved) {
      const n = WIRE_COLORS.length;
      let order;
      do { order = shuffle([...Array(n).keys()]); } while (order.every((v, i) => v === i));
      const conn = Array(n).fill(null);   // left wire i -> right slot j
      const locked = Array(n).fill(false);
      let sel = null, busy = false, solved = false;
      let leftNodes, rightNodes, svg, wrap, status, closeBtn;

      const redraw = () => {
        svg.innerHTML = '';
        const wr = wrap.getBoundingClientRect();
        const ctr = (b) => { const r = b.getBoundingClientRect(); return [r.left + r.width / 2 - wr.left, r.top + r.height / 2 - wr.top]; };
        conn.forEach((j, i) => {
          if (j === null) return;
          const [x1, y1] = ctr(leftNodes[i]); const [x2, y2] = ctr(rightNodes[j]);
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          const mx = (x1 + x2) / 2;
          line.setAttribute('d', `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`);
          line.setAttribute('stroke', cssColor(WIRE_COLORS[i]));
          line.setAttribute('stroke-width', '6');
          line.setAttribute('stroke-linecap', 'round');
          line.setAttribute('fill', 'none');
          svg.appendChild(line);
        });
        leftNodes.forEach((b, i) => {
          b.className = 'l2-node' + (sel === i ? ' sel' : '') + (locked[i] ? ' lock' : '');
        });
        rightNodes.forEach((b, j) => {
          const i = conn.indexOf(j);
          b.className = 'l2-node' + (i !== -1 && locked[i] ? ' lock' : '');
        });
      };

      const verify = () => {
        const wrong = [];
        conn.forEach((j, i) => { if (!locked[i] && order[j] !== i) wrong.push(i); });
        if (wrong.length === 0) {
          conn.forEach((_, i) => { locked[i] = true; });
          solved = true;
          status.className = 'status ok';
          status.textContent = 'CIRCUIT COMPLETE — cameras offline.';
          redraw();
          closeBtn.textContent = 'Continue';
          onSolved();
          return;
        }
        busy = true;
        conn.forEach((j, i) => { if (!wrong.includes(i)) locked[i] = true; });
        status.className = 'status bad';
        status.textContent = `SHORT CIRCUIT — ${n - wrong.length}/${n} wires correct. Rewire the rest.`;
        wrap.classList.remove('l2-shake'); void wrap.offsetWidth; wrap.classList.add('l2-shake');
        redraw();
        later(() => { wrong.forEach((i) => { conn[i] = null; }); busy = false; redraw(); }, 650);
      };

      show((p) => {
        p.append(el('h2', '', 'CAMERA CONTROL — WIRING'),
          el('p', '', 'Click a wire on the left, then the socket of the same colour on the right.'));
        wrap = el('div', 'l2-wires');
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const lc = el('div', 'l2-col'); const rc = el('div', 'l2-col');
        leftNodes = WIRE_COLORS.map((c, i) => {
          const b = el('button', 'l2-node'); b.style.background = cssColor(c);
          b.onclick = () => {
            if (busy || solved || locked[i]) return;
            conn[i] = null; sel = i; redraw();
          };
          lc.appendChild(b); return b;
        });
        rightNodes = order.map((wi, j) => {
          const b = el('button', 'l2-node'); b.style.background = cssColor(WIRE_COLORS[wi]);
          b.onclick = () => {
            if (busy || solved || sel === null) return;
            const prev = conn.indexOf(j);
            if (prev !== -1) { if (locked[prev]) return; conn[prev] = null; }
            conn[sel] = j; sel = null;
            redraw();
            if (conn.every((v) => v !== null)) verify();
          };
          rc.appendChild(b); return b;
        });
        wrap.append(svg, lc, rc);
        status = el('div', 'status');
        closeBtn = el('button', 'close', 'Close  [Esc]');
        closeBtn.onclick = () => close(true);
        p.append(wrap, status, closeBtn);
      });
      requestAnimationFrame(redraw);
      listenKeys(() => {});
    },

    // ---- safe keypad ----
    showKeypad(code, onOpen) {
      let entry = '', done = false, busy = false;
      let disp, status, closeBtn;

      const refresh = (cls = '') => {
        disp.className = 'l2-disp ' + cls;
        disp.textContent = entry.padEnd(4, '·');
      };
      const press = (d) => {
        if (done || busy || entry.length >= 4) return;
        entry += d; refresh();
      };
      const submit = () => {
        if (done || busy) return;
        if (entry === code) {
          done = true; refresh('ok');
          status.className = 'status ok'; status.textContent = 'ACCESS GRANTED — safe unlocked.';
          closeBtn.textContent = 'Continue';
          onOpen();
        } else {
          busy = true; refresh('bad');
          status.className = 'status bad'; status.textContent = 'ACCESS DENIED';
          later(() => { entry = ''; busy = false; status.textContent = ''; refresh(); }, 700);
        }
      };

      show((p) => {
        p.append(el('h2', '', 'SAFE — KEYPAD'), el('p', '', 'Enter the 4-digit code.'));
        disp = el('div', 'l2-disp'); p.appendChild(disp);
        const pad = el('div', 'l2-pad');
        ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '↵'].forEach((k) => {
          const b = el('button', '', k);
          b.onclick = () => {
            if (k === 'C') { if (!done && !busy) { entry = ''; refresh(); } }
            else if (k === '↵') submit();
            else press(k);
          };
          pad.appendChild(b);
        });
        status = el('div', 'status');
        closeBtn = el('button', 'close', 'Close  [Esc]');
        closeBtn.onclick = () => close(true);
        p.append(pad, status, closeBtn);
        refresh();
      });
      listenKeys((e) => {
        if (/^[0-9]$/.test(e.key)) press(e.key);
        else if (e.key === 'Backspace') { if (!done && !busy) { entry = entry.slice(0, -1); refresh(); } }
        else if (e.key === 'Enter') { if (done) close(true); else submit(); }
      });
    },

    dispose() {
      close(false);
      timers.forEach(clearTimeout);
      style.remove(); tracker.remove(); hold.remove(); overlay.remove(); detect.remove(); sec.remove();
    },
  };
}

// ============================================================
// SECURITY FORCE — guards that stream in from the entry elevator and hunt
// the player. The server maze is full of racks, so straight-line steering
// (like Level 1's GuardB) would wedge on them. Instead we rasterise the
// level's own colliders into a grid and every guard follows ONE shared
// flow field (Dijkstra outward from the player's cell).
// ============================================================
const NAV_CELL = 0.5;
const GUARD_RADIUS = 0.4;     // obstacles are inflated by this so guards don't clip
const CATCH_DIST = 1.0;
const GUARD_SEP = 0.8;        // guards push apart below this distance
const SPAWN_INTERVAL = 0.9;   // seconds between guards stepping out of the lift
const FIRST_SPAWN_DELAY = 0.8;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

class NavGrid {
  constructor(colliders, b) {
    const cell = NAV_CELL, r = GUARD_RADIUS;
    this.cell = cell; this.x0 = b.x0; this.z0 = b.z0;
    this.nx = Math.ceil((b.x1 - b.x0) / cell);
    this.nz = Math.ceil((b.z1 - b.z0) / cell);
    const n = this.nx * this.nz;
    this.blocked = new Uint8Array(n);
    this.dist = new Float32Array(n);
    this.heapD = new Float32Array(n * 8 + 8);
    this.heapI = new Int32Array(n * 8 + 8);
    this.heapN = 0;
    this._popD = 0;

    const box = new THREE.Box3();
    for (const m of colliders) {
      box.setFromObject(m);
      if (box.min.y > 1.4 || box.max.y < 0.3) continue;   // door lintels etc. don't block walking
      const i0 = Math.max(0, Math.floor((box.min.x - r - this.x0) / cell));
      const i1 = Math.min(this.nx - 1, Math.floor((box.max.x + r - this.x0) / cell));
      const j0 = Math.max(0, Math.floor((box.min.z - r - this.z0) / cell));
      const j1 = Math.min(this.nz - 1, Math.floor((box.max.z + r - this.z0) / cell));
      for (let j = j0; j <= j1; j++) {
        const cz = this.z0 + (j + 0.5) * cell;
        if (cz < box.min.z - r || cz > box.max.z + r) continue;
        for (let i = i0; i <= i1; i++) {
          const cx = this.x0 + (i + 0.5) * cell;
          if (cx < box.min.x - r || cx > box.max.x + r) continue;
          this.blocked[j * this.nx + i] = 1;
        }
      }
    }
  }

  idx(x, z) {
    const i = Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.x0) / this.cell)));
    const j = Math.min(this.nz - 1, Math.max(0, Math.floor((z - this.z0) / this.cell)));
    return j * this.nx + i;
  }
  cx(idx) { return this.x0 + ((idx % this.nx) + 0.5) * this.cell; }
  cz(idx) { return this.z0 + (Math.floor(idx / this.nx) + 0.5) * this.cell; }
  isBlockedAt(x, z) { return this.blocked[this.idx(x, z)] === 1; }

  // If the cell is inside an obstacle's padding (player hugging a rack), use the closest free one.
  nearestFree(idx) {
    if (!this.blocked[idx]) return idx;
    const i0 = idx % this.nx, j0 = Math.floor(idx / this.nx);
    for (let r = 1; r <= 6; r++) {
      let best = -1, bestD = Infinity;
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = i0 + di, j = j0 + dj;
          if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
          const k = j * this.nx + i;
          if (this.blocked[k]) continue;
          const d = di * di + dj * dj;
          if (d < bestD) { bestD = d; best = k; }
        }
      }
      if (best !== -1) return best;
    }
    return idx;
  }

  _push(d, i) {
    let n = this.heapN++;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (this.heapD[p] <= d) break;
      this.heapD[n] = this.heapD[p]; this.heapI[n] = this.heapI[p];
      n = p;
    }
    this.heapD[n] = d; this.heapI[n] = i;
  }
  _pop() {
    const topI = this.heapI[0];
    this._popD = this.heapD[0];
    const n = --this.heapN;
    if (n > 0) {
      const d = this.heapD[n], i = this.heapI[n];
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= n) break;
        if (c + 1 < n && this.heapD[c + 1] < this.heapD[c]) c++;
        if (this.heapD[c] >= d) break;
        this.heapD[k] = this.heapD[c]; this.heapI[k] = this.heapI[c];
        k = c;
      }
      this.heapD[k] = d; this.heapI[k] = i;
    }
    return topI;
  }

  // Distance-to-player for every walkable cell (8-connected, no corner cutting).
  computeField(x, z) {
    const goal = this.nearestFree(this.idx(x, z));
    const { nx, nz, blocked: bl, dist } = this;
    dist.fill(Infinity);
    this.heapN = 0;
    dist[goal] = 0;
    this._push(0, goal);
    while (this.heapN > 0) {
      const cur = this._pop();
      const d = this._popD;
      if (d > dist[cur]) continue;
      const ci = cur % nx, cj = (cur / nx) | 0;
      for (let k = 0; k < 8; k++) {
        const ni = ci + DIRS[k][0], nj = cj + DIRS[k][1];
        if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
        const n = nj * nx + ni;
        if (bl[n]) continue;
        const diag = DIRS[k][0] !== 0 && DIRS[k][1] !== 0;
        if (diag && (bl[cj * nx + ni] || bl[nj * nx + ci])) continue;
        const nd = d + (diag ? 1.4142 : 1);
        if (nd < dist[n]) { dist[n] = nd; this._push(nd, n); }
      }
    }
  }

  stepDown(idx) {
    const { nx, nz, blocked: bl, dist } = this;
    const ci = idx % nx, cj = (idx / nx) | 0;
    let best = idx, bestD = dist[idx];
    for (let k = 0; k < 8; k++) {
      const ni = ci + DIRS[k][0], nj = cj + DIRS[k][1];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
      const n = nj * nx + ni;
      if (bl[n]) continue;
      const diag = DIRS[k][0] !== 0 && DIRS[k][1] !== 0;
      if (diag && (bl[cj * nx + ni] || bl[nj * nx + ci])) continue;
      if (dist[n] < bestD) { bestD = dist[n]; best = n; }
    }
    return best;
  }

  // Clear walking line between two points? (samples the grid, ignores the two end cells)
  los(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const steps = Math.ceil(Math.hypot(dx, dz) / (this.cell * 0.5));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (this.blocked[this.idx(ax + dx * t, az + dz * t)]) return false;
    }
    return true;
  }

  // Next point to walk toward: follow the flow field, but skip ahead along it
  // as far as there's a clear line so movement isn't a staircase.
  nextTarget(x, z, out, lookahead = 6) {
    let cur = this.nearestFree(this.idx(x, z));
    if (!isFinite(this.dist[cur])) return false;
    let found = false;
    for (let k = 0; k < lookahead; k++) {
      const nxt = this.stepDown(cur);
      if (nxt === cur) break;
      const px = this.cx(nxt), pz = this.cz(nxt);
      if (found && !this.los(x, z, px, pz)) break;
      out.x = px; out.z = pz; found = true; cur = nxt;
    }
    return found;
  }
}

function turnToward(cur, target, maxStep) {
  let d = target - cur;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return cur + Math.max(-maxStep, Math.min(maxStep, d));
}

// One animatable guard body. Uses the shared GLTF template from Level 1's
// guards.js when main.js hands it over; otherwise a red capsule stand-in.
function makeGuardVisual(template) {
  if (!template) {
    const geo = new THREE.CapsuleGeometry(0.3, 1.2, 4, 12);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a1f1f, emissive: 0xff3333, emissiveIntensity: 0.5 });
    const body = new THREE.Mesh(geo, mat);
    body.position.y = 0.9;
    return { body, mixer: null, actions: {}, dispose() { geo.dispose(); mat.dispose(); } };
  }
  const body = SkeletonUtils.clone(template.scene);
  const mixer = new THREE.AnimationMixer(body);
  const actions = {};
  template.animations.forEach((clip) => { actions[clip.name] = mixer.clipAction(clip); });
  return { body, mixer, actions, dispose() { mixer.stopAllAction(); mixer.uncacheRoot(body); } };
}

function createGuardForce({ scene, nav, getTemplate, spawnPoints }) {
  const guards = [];
  const tgt = { x: 0, z: 0 };
  let queue = 0, spawnTimer = 0, spawnGrace = 0, spawnIdx = 0;
  let fieldAge = 99, lastCell = -1;

  function setAction(g, name) {
    const next = g.actions[name];
    if (!next || g.current === next) return;
    if (g.current) g.current.fadeOut(0.25);
    next.reset().fadeIn(0.25).play();
    g.current = next;
  }

  function spawnOne() {
    const sp = spawnPoints[spawnIdx++ % spawnPoints.length];
    const vis = makeGuardVisual(getTemplate());
    const group = new THREE.Group();
    group.name = 'SecurityGuard';
    group.add(vis.body);
    const free = nav.nearestFree(nav.idx(sp.x, sp.z));
    group.position.set(nav.isBlockedAt(sp.x, sp.z) ? nav.cx(free) : sp.x, 0, nav.isBlockedAt(sp.x, sp.z) ? nav.cz(free) : sp.z);
    group.rotation.y = 0; // out of the lift, facing into the level (+z)
    scene.add(group);
    const g = { group, ...vis, current: null };
    setAction(g, 'Idle');
    guards.push(g);
  }

  return {
    get count() { return guards.length + queue; },
    isSpawning: () => queue > 0 || spawnGrace > 0,

    // Ask for n more guards (capped by SEC.MAX_GUARDS). Returns how many were accepted.
    request(n) {
      const add = Math.max(0, Math.min(n, SEC.MAX_GUARDS - guards.length - queue));
      if (add > 0) {
        if (queue === 0) spawnTimer = FIRST_SPAWN_DELAY;
        queue += add;
      }
      return add;
    },

    update(dt, player, speed, onCatch) {
      if (queue > 0) {
        spawnTimer -= dt;
        if (spawnTimer <= 0) { spawnOne(); queue--; spawnTimer = SPAWN_INTERVAL; spawnGrace = 1.4; }
      } else {
        spawnGrace = Math.max(0, spawnGrace - dt);
      }
      if (!guards.length) return;

      fieldAge += dt;
      const pc = nav.idx(player.x, player.z);
      if ((pc !== lastCell && fieldAge > 0.15) || fieldAge > 0.5) {
        nav.computeField(player.x, player.z);
        lastCell = pc; fieldAge = 0;
      }

      for (const g of guards) {
        g.mixer?.update(dt);
        const p = g.group.position;
        const d = Math.hypot(player.x - p.x, player.z - p.z);
        if (d < CATCH_DIST) { onCatch(); return; }

        let tx = player.x, tz = player.z;
        if (!nav.los(p.x, p.z, player.x, player.z) && nav.nextTarget(p.x, p.z, tgt)) { tx = tgt.x; tz = tgt.z; }

        const mx = tx - p.x, mz = tz - p.z, ml = Math.hypot(mx, mz);
        let moving = false;
        if (ml > 0.05) {
          const step = Math.min(speed * dt, ml);
          p.x += (mx / ml) * step; p.z += (mz / ml) * step;
          g.group.rotation.y = turnToward(g.group.rotation.y, Math.atan2(mx, mz), 10 * dt);
          moving = true;
        }
        setAction(g, moving ? (g.actions.Run ? 'Run' : 'Walk') : 'Idle');
      }

      // soft separation so a crowd spreads out to "fill the room" instead of stacking
      for (let a = 0; a < guards.length; a++) {
        for (let b = a + 1; b < guards.length; b++) {
          const pa = guards[a].group.position, pb = guards[b].group.position;
          let dx = pa.x - pb.x, dz = pa.z - pb.z;
          let d = Math.hypot(dx, dz);
          if (d >= GUARD_SEP) continue;
          if (d < 0.001) { dx = Math.random() - 0.5; dz = Math.random() - 0.5; d = Math.hypot(dx, dz); }
          const push = (GUARD_SEP - d) * 0.25;
          const ux = (dx / d) * push, uz = (dz / d) * push;
          if (!nav.isBlockedAt(pa.x + ux, pa.z + uz)) { pa.x += ux; pa.z += uz; }
          if (!nav.isBlockedAt(pb.x - ux, pb.z - uz)) { pb.x -= ux; pb.z -= uz; }
        }
      }
    },

    dispose() {
      guards.forEach((g) => { scene.remove(g.group); g.dispose(); });
      guards.length = 0; queue = 0;
    },
  };
}

// ============================================================
// LEVEL
// ============================================================
export function createLevel2(scene, hooks = {}) {
  const H = {
    onSubtitle: () => {},
    onUiChange: () => {},
    onObjectiveComplete: () => {},
    // --- security hooks (wire these to Level 1's alarm / fail flow in main.js) ---
    triggerAlarm: () => {},          // (reason) — same thing Level 1's game.triggerAlarm does
    onSecurityIncrease: () => {},    // (level, reason) — 1..SEC.MAX_LEVEL
    onCaught: () => {},              // a guard reached the player -> fail the level
    getGuardTemplate,                // defaults to guards.js's shared model; override only if needed
    localSecurityHud: true,          // set false if main.js draws its own security HUD
    sfx: {},
    ...hooks,
  };
  const sfx = (name) => { try { H.sfx[name]?.(); } catch (e) { /* audio is optional */ } };

  // Make sure the guard model is loading (no-op if Level 1 already loaded it).
  // Guards only spawn after a trigger, well after this finishes.
  if (!H.getGuardTemplate()) loadGuardModel().catch((e) => console.warn('Guard model failed to load:', e));

  const level2 = new THREE.Group();
  level2.name = 'Level2';
  const lightFixturePositions = [];
  const disposables = []; // per-attempt materials/textures to free on dispose
  const track = (o) => { disposables.push(o); return o; };

  const addLight = (group, x, z, w, d) => {
    group.add(makeLightFixture(x, CEILING_HEIGHT, z, w, d));
    lightFixturePositions.push(new THREE.Vector3(x, CEILING_HEIGHT, z));
  };

  // ---------- layout (world units; unscaled numbers x S like level1) ----------
  const L = {
    landing: { x0: -4 * S, x1: 4 * S, z0: -3 * S, z1: 3 * S },
    maze:    { x0: -6 * S, x1: 6 * S, z0: 3 * S,  z1: 19 * S },
    term:    { x0: -4 * S, x1: 4 * S, z0: 19 * S, z1: 27 * S },
    ctrl:    { x0: 6 * S,  x1: 10 * S, z0: 12.5 * S - 2.25, z1: 12.5 * S + 2.25 },
  };
  const ctrlZ = (L.ctrl.z0 + L.ctrl.z1) / 2;
  const cx = (r) => (r.x0 + r.x1) / 2, cz = (r) => (r.z0 + r.z1) / 2;
  const w = (r) => r.x1 - r.x0, d = (r) => r.z1 - r.z0;

  // ============ ELEVATOR LANDING (start) ============
  const landing = new THREE.Group();
  landing.name = 'ElevatorLanding';
  const R1 = L.landing;
  landing.add(makeFloor(w(R1), d(R1), cx(R1), cz(R1)));
  landing.add(makeCeiling(w(R1), d(R1), cx(R1), CEILING_HEIGHT, cz(R1)));
  wallAlongX(landing, R1.z0, R1.x0, R1.x1);                 // front wall (entry elevator)
  wallAlongZ(landing, R1.x0, R1.z0, R1.z1);
  wallAlongZ(landing, R1.x1, R1.z0, R1.z1);
  // back wall z=R1.z1 is the maze's front wall — built once, in the maze
  [[-3, -1.5], [3, -1.5], [-3, 1.5], [3, 1.5]].forEach(([x, z]) => addLight(landing, x * S, z * S));

  const entryIndicatorMat = track(new THREE.MeshStandardMaterial({ color: 0x33ff88, emissive: 0x33ff88, emissiveIntensity: 1 }));
  const entryElevator = makeElevator(0, R1.z0 + WALL_T / 2, 0, entryIndicatorMat);
  landing.add(entryElevator.group);
  level2.add(landing);

  // ============ SERVER MAZE ============
  const maze = new THREE.Group();
  maze.name = 'ServerMaze';
  const R2 = L.maze;
  maze.add(makeFloor(w(R2), d(R2), cx(R2), cz(R2)));
  maze.add(makeCeiling(w(R2), d(R2), cx(R2), CEILING_HEIGHT, cz(R2)));
  wallAlongX(maze, R2.z0, R2.x0, R2.x1, 0);                 // front: doorway to the landing
  wallAlongX(maze, R2.z1, R2.x0, R2.x1, 0);                 // back: doorway to the terminal room
  wallAlongZ(maze, R2.x0, R2.z0, R2.z1);
  wallAlongZ(maze, R2.x1, R2.z0, R2.z1, ctrlZ);             // east wall: doorway to the Camera Control Room

  [[-5.5, 9], [5.5, 9], [0, 12.5], [-5.5, 16.5], [5.5, 16.5], [0, 20.5], [-5.5, 24], [5.5, 24]]
    .forEach(([x, z]) => addLight(maze, x, z, 1.4, 1.4));

  // Rack rows. Inner rows (x = ±3.5) in three blocks with cross-aisles
  // between; shorter outer rows make side paths. Racks face the aisle.
  const rackRow = (x, zStart, count, face) => {
    for (let i = 0; i < count; i++) maze.add(makeServerRack(x, zStart + i * 1.25, face));
  };
  [7.5, 14, 20.5].forEach((z0) => { rackRow(-3.5, z0, 3, 1); rackRow(3.5, z0, 3, -1); });
  rackRow(-7, 10, 2, 1); rackRow(-7, 17, 2, 1); rackRow(-7, 23.5, 2, 1);
  rackRow(7, 8, 2, -1);

  // Sticky note on the first inner-left rack (+x face), in the maze's first aisle.
  const NOTE_RACK = { x: -3.5, z: 7.5 };
  const safeCode = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  const noteTex = track(makeNoteTexture(safeCode));
  const noteMat = track(noteTex
    ? new THREE.MeshStandardMaterial({ map: noteTex, emissive: 0xffe866, emissiveMap: noteTex, emissiveIntensity: 0.35 })
    : new THREE.MeshStandardMaterial({ color: 0xffe866, emissive: 0xffe866, emissiveIntensity: 0.4 }));
  const note = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), noteMat);
  note.name = 'marker_stickyNote';
  note.rotation.y = Math.PI / 2;                            // faces +x, into the aisle
  note.position.set(NOTE_RACK.x + 0.41, 1.45, NOTE_RACK.z - 0.3);
  maze.add(note);
  const NOTE_SPOT = new THREE.Vector3(NOTE_RACK.x + 0.41, 0, NOTE_RACK.z - 0.3);

  // Cameras — on the side walls, sweeping across the aisles.
  const lensMat = track(new THREE.MeshStandardMaterial({ color: 0xff3333, emissive: 0xff3333, emissiveIntensity: 0.6 }));
  const coneMat = track(new THREE.MeshBasicMaterial({
    color: 0xff3333, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false,
  }));
  const camDefs = [
    { x: R2.x0 + WALL_T / 2 + 0.05, z: 9,  yaw: Math.PI / 2,  phase: 0 },
    { x: R2.x1 - WALL_T / 2 - 0.05, z: 13, yaw: -Math.PI / 2, phase: 2.1 },
    { x: R2.x0 + WALL_T / 2 + 0.05, z: 22, yaw: Math.PI / 2,  phase: 4.2 },
  ];
  const cameras = camDefs.map((c) => {
    // each camera gets its own cone material so only the camera that sees you lights up
    const cam = makeCamera(c.x, 3.3, c.z, c.yaw, c.phase, lensMat, track(coneMat.clone()));
    maze.add(cam.group);
    return cam;
  });
  const cameraMarkers = camDefs.map((c) => new THREE.Vector3(c.x, 3.3, c.z));

  // Laser gates — span the centre aisle between the inner rack rows.
  // Each gate gets its own cloned material (markerMat.laser is shared with other
  // levels) so a tripped beam can flash without lighting every laser in the game.
  const laserGates = [8.75, 15.25].map((z) => {
    const mat = track(markerMat.laser.clone());
    const mesh = makeLaserGate(0, 1.0, z, 6.2, 0, mat);
    maze.add(mesh);
    return { mesh, mat, z, halfW: 3.1, cooldown: 0, flash: 0 };
  });
  level2.add(maze);

  // ============ CAMERA CONTROL ROOM (optional branch, east of the maze) ============
  const ctrl = new THREE.Group();
  ctrl.name = 'CameraControlRoom';
  const R3 = L.ctrl;
  ctrl.add(makeFloor(w(R3), d(R3), cx(R3), cz(R3)));
  ctrl.add(makeCeiling(w(R3), d(R3), cx(R3), CEILING_HEIGHT, cz(R3)));
  wallAlongX(ctrl, R3.z0, R3.x0, R3.x1);
  wallAlongX(ctrl, R3.z1, R3.x0, R3.x1);
  wallAlongZ(ctrl, R3.x1, R3.z0, R3.z1);
  addLight(ctrl, cx(R3), cz(R3), 1.2, 1.2);

  const panelMat = track(markerMat.wirePanel.clone());
  const PANEL_POS = new THREE.Vector3(R3.x1 - WALL_T / 2 - 0.05, 1.4, ctrlZ);
  const wirePanel = makeWirePuzzlePanel(PANEL_POS.x, PANEL_POS.y, PANEL_POS.z, -Math.PI / 2, panelMat);
  ctrl.add(wirePanel);
  level2.add(ctrl);

  // ============ TERMINAL ROOM ============
  const term = new THREE.Group();
  term.name = 'TerminalRoom';
  const R4 = L.term;
  term.add(makeFloor(w(R4), d(R4), cx(R4), cz(R4)));
  term.add(makeCeiling(w(R4), d(R4), cx(R4), CEILING_HEIGHT, cz(R4)));
  wallAlongZ(term, R4.x0, R4.z0, R4.z1);
  wallAlongZ(term, R4.x1, R4.z0, R4.z1);
  wallAlongX(term, R4.z1, R4.x0, R4.x1);                    // back wall
  // front wall z=R4.z0 is the maze's back wall
  [[-3, 22], [3, 22], [-3, 25], [3, 25]].forEach(([x, z]) => addLight(term, x * S, z * S));

  const DESK_Z = R4.z1 - 1.1;
  const desk = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 0.6), rackMat);
  desk.position.set(0, 0.45, DESK_Z);
  desk.name = 'collider_terminalDesk';
  term.add(desk);

  const monitorMat = track(new THREE.MeshStandardMaterial({ color: 0xff6644, emissive: 0xff6644, emissiveIntensity: 0.9 }));
  const monitor = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.05), monitorMat);
  monitor.position.set(0, 1.2, DESK_Z + 0.15);
  monitor.name = 'marker_terminalScreen';
  term.add(monitor);

  const terminalMat = track(markerMat.terminal.clone());
  const terminalMarker = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), terminalMat);
  terminalMarker.position.set(0, 1.65, DESK_Z + 0.15);
  terminalMarker.name = 'marker_terminal';
  term.add(terminalMarker);
  const TERMINAL_SPOT = new THREE.Vector3(0, 0, DESK_Z);

  // Safe — back-left corner, door facing into the room.
  const keypadMat = track(markerMat.safe.clone());
  keypadMat.color.setHex(0xff4444); keypadMat.emissive.setHex(0xff4444);
  const SAFE_POS = new THREE.Vector3(R4.x0 + 0.6, 0, R4.z1 - 3);
  const safe = makeSafe(SAFE_POS.x, SAFE_POS.z, Math.PI / 2, keypadMat);
  term.add(safe.group);

  // Exit elevator on the east wall; pad sits well away from the desk so
  // hacking can't trip the exit.
  const exitIndicatorMat = track(new THREE.MeshStandardMaterial({ color: 0xff3333, emissive: 0xff3333, emissiveIntensity: 1 }));
  const exitZ = cz(R4) - 1;
  const exitElevator = makeElevator(R4.x1 - WALL_T / 2, exitZ, -Math.PI / 2, exitIndicatorMat);
  term.add(exitElevator.group);
  const EXIT_POS = new THREE.Vector3(R4.x1 - 1.6, 0, exitZ);
  const exitPad = new THREE.Mesh(new THREE.BoxGeometry(2, 0.05, 2), track(new THREE.MeshStandardMaterial({
    color: 0x00ccff, emissive: 0x00ccff, emissiveIntensity: 0.45,
  })));
  exitPad.position.set(EXIT_POS.x, 0.03, EXIT_POS.z);
  exitPad.name = 'marker_exit';
  term.add(exitPad);
  level2.add(term);

  // Two small accent lights so the interactive spots read in the dark.
  const panelGlow = new THREE.PointLight(0xffaa00, 2.5, 5);
  panelGlow.position.set(PANEL_POS.x - 1.4, 2.0, ctrlZ);
  ctrl.add(panelGlow);
  const termGlow = new THREE.PointLight(0x33ffcc, 2.5, 5);
  termGlow.position.set(0, 2.0, DESK_Z - 1.2);
  term.add(termGlow);

  // ---------- colliders ----------
  const colliders = [];
  level2.traverse((obj) => {
    if (!obj.isMesh) return;
    if (obj.material === wallMat || obj.name.startsWith('collider_')) colliders.push(obj);
  });
  scene.add(level2);

  // Security guards: nav grid built from the colliders above (walls, racks, desk, safe).
  level2.updateMatrixWorld(true);
  const nav = new NavGrid(colliders, {
    x0: Math.min(L.landing.x0, L.maze.x0, L.term.x0) - 1, x1: L.ctrl.x1 + 1,
    z0: L.landing.z0 - 1, z1: L.term.z1 + 1,
  });
  const force = createGuardForce({
    scene: level2, nav, getTemplate: () => H.getGuardTemplate(),
    spawnPoints: [-1.2, 0, 1.2].map((x) => new THREE.Vector3(x, 0, R1.z0 + 1.8)), // just inside the entry elevator
  });

  // ============================================================
  // MISSION STATE + LOGIC
  // ============================================================
  const state = {
    noteRead: false, safeOpen: false, hasBadge: false,
    wiresSolved: false, hacked: false, hackProgress: 0,
    securityLevel: 0, alarmRaised: false, caught: false,
  };
  const HACK_TIME = 3.5;       // seconds of holding E
  const SAFE_SWING = { t: 0 }; // 0..1
  const DOOR_ANIM = { t: 0 };

  const ui = createMissionUI((open, relock) => H.onUiChange(open, relock), H.localSecurityHud !== false);

  function refreshTracker() {
    ui.setTracker([
      { text: 'Find the safe code', done: state.noteRead, sub: state.noteRead ? safeCode.split('').join(' ') : null },
      { text: 'Open the safe (access badge)', done: state.safeOpen },
      { text: 'Optional: disable the cameras', done: state.wiresSolved, optional: true },
      { text: 'Hack the terminal (hold E)', done: state.hacked },
      { text: 'Reach the exit elevator', done: false },
    ]);
  }
  refreshTracker();

  function refreshWorld() {
    // cameras
    const off = state.wiresSolved;
    lensMat.color.setHex(off ? 0x222222 : 0xff3333);
    lensMat.emissive.setHex(off ? 0x000000 : 0xff3333);
    cameras.forEach((c) => { c.cone.visible = !off; });
    panelMat.color.setHex(off ? 0x33ff99 : 0xffaa00);
    panelMat.emissive.setHex(off ? 0x33ff99 : 0xffaa00);
    panelGlow.color.setHex(off ? 0x33ff99 : 0xffaa00);
    // safe
    keypadMat.color.setHex(state.safeOpen ? 0x33ff99 : 0xff4444);
    keypadMat.emissive.setHex(state.safeOpen ? 0x33ff99 : 0xff4444);
    // terminal
    const c = state.hacked ? 0x66ff66 : state.hasBadge ? 0x33ffcc : 0xff6644;
    monitorMat.color.setHex(c); monitorMat.emissive.setHex(c);
    terminalMat.color.setHex(state.hacked ? 0x66ff66 : 0x33ffcc);
    terminalMat.emissive.setHex(state.hacked ? 0x66ff66 : 0x33ffcc);
    // exit elevator
    exitIndicatorMat.color.setHex(state.hacked ? 0x33ff88 : 0xff3333);
    exitIndicatorMat.emissive.setHex(state.hacked ? 0x33ff88 : 0xff3333);
  }
  refreshWorld();

  const dist = (p, s) => Math.hypot(p.x - s.x, p.z - s.z);

  const interactables = [
    {
      id: 'note', spot: NOTE_SPOT, range: 1.9,
      prompt: () => '[E] Read sticky note',
      action: () => {
        state.noteRead = true;
        sfx('pickup');
        H.onSubtitle(`Sticky note: "safe code — ${safeCode}". Better remember that.`, 5000);
        refreshTracker();
      },
    },
    {
      id: 'wires', spot: PANEL_POS, range: 2.4,
      prompt: () => (state.wiresSolved ? null : '[E] Rewire camera circuit'),
      action: () => {
        ui.showWires(() => {
          state.wiresSolved = true;
          sfx('unlock');
          refreshWorld(); refreshTracker();
          H.onSubtitle('Cameras offline.', 3000);
        });
      },
    },
    {
      id: 'safe', spot: SAFE_POS, range: 2.2,
      prompt: () => (state.safeOpen ? null : '[E] Open safe'),
      action: () => {
        ui.showKeypad(safeCode, () => {
          state.safeOpen = true; state.hasBadge = true;
          sfx('unlock');
          refreshWorld(); refreshTracker();
          H.onSubtitle('Safe open — access badge acquired. The terminal will accept it.', 4500);
        });
      },
    },
    {
      id: 'terminal', spot: TERMINAL_SPOT, range: 2.4,
      prompt: () => {
        if (state.hacked) return null;
        return state.hasBadge ? '[Hold E] Hack terminal' : 'Terminal locked — access badge required';
      },
      action: () => {
        if (!state.hasBadge && !state.hacked) {
          sfx('denied');
          H.onSubtitle('Access denied. You need a badge — maybe the safe has one.', 3500);
        }
      },
    },
  ];

  function nearest(pos) {
    let best = null, bestD = Infinity;
    for (const it of interactables) {
      const dd = dist(pos, it.spot);
      if (dd <= it.range && it.prompt() !== null && dd < bestD) { best = it; bestD = dd; }
    }
    return best;
  }

  // ============================================================
  // SECURITY: camera detection, laser tripwires, escalation, guards
  // ============================================================
  const camRay = new THREE.Raycaster();
  const _lens = new THREE.Vector3(), _axis = new THREE.Vector3();
  const _sample = new THREE.Vector3(), _toSample = new THREE.Vector3();
  const CAM_SAMPLE_Y = [0.4, 1.0, 1.6];   // feet / chest / head — any visible point counts
  const CONE_SLOPE = CONE_R / CONE_LEN;
  let camCheckTimer = 0, camExposure = 0, entryDoorT = 0;

  // Is the player inside this camera's actual cone AND not hidden behind a rack/wall?
  function cameraSees(cam, pos) {
    cam.head.updateWorldMatrix(true, false);
    cam.lens.getWorldPosition(_lens);
    _axis.set(0, 0, 1).transformDirection(cam.head.matrixWorld);
    for (const y of CAM_SAMPLE_Y) {
      _sample.set(pos.x, y, pos.z);
      _toSample.subVectors(_sample, _lens);
      const t = _toSample.dot(_axis);
      if (t < 0.3 || t > CONE_LEN) continue;
      const radial = Math.sqrt(Math.max(0, _toSample.lengthSq() - t * t));
      if (radial > t * CONE_SLOPE) continue;
      const distance = _toSample.length();
      _toSample.normalize();
      camRay.set(_lens, _toSample);
      camRay.far = distance - 0.05;
      if (camRay.intersectObjects(colliders, false).length === 0) return true;
    }
    return false;
  }

  // Is the player anywhere inside this camera's swept coverage fan (and in line of
  // sight)? Used so lingering in a camera's area keeps the timer from draining
  // between sweeps, even while the cone itself is pointing elsewhere.
  const CAM_FAN_HALF = CAM_SWEEP + Math.atan(CONE_SLOPE);
  function cameraCovers(cam, pos) {
    const gp = cam.group.position;
    const dx = pos.x - gp.x, dz = pos.z - gp.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.3 || d > CONE_LEN - 1) return false;
    const yaw = cam.group.rotation.y;
    const cosA = (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / d;
    if (Math.acos(Math.max(-1, Math.min(1, cosA))) > CAM_FAN_HALF) return false;
    cam.lens.getWorldPosition(_lens);
    _sample.set(pos.x, 1.0, pos.z);
    _toSample.subVectors(_sample, _lens);
    const distance = _toSample.length();
    _toSample.normalize();
    camRay.set(_lens, _toSample);
    camRay.far = distance - 0.05;
    return camRay.intersectObjects(colliders, false).length === 0;
  }

  function escalate(reason) {
    if (state.caught) return;
    state.securityLevel = Math.min(SEC.MAX_LEVEL, state.securityLevel + 1);
    ui.setSecurity(state.securityLevel);
    if (!state.alarmRaised) {           // the alarm itself goes off once, like Level 1
      state.alarmRaised = true;
      sfx('alarm');
      H.triggerAlarm(reason);
    }
    H.onSecurityIncrease(state.securityLevel, reason);
    force.request(state.securityLevel + 1);   // 2, 3, 4... guards per escalation (capped)
    const what = reason === 'laser_tripped' ? 'Laser tripped' : 'Camera lock';
    H.onSubtitle(state.securityLevel === 1
      ? `${what} — alarm! Security is coming up from the lift.`
      : `${what} — security level ${state.securityLevel}. More guards inbound.`, 3500);
  }

  function onCatch() {
    if (state.caught) return;
    state.caught = true;
    ui.close(false);
    ui.setHold(null);
    H.onSubtitle('Caught by security.', 3000);
    H.onCaught();
  }

  function securityUpdate(dt, pos) {
    if (state.caught) return;

    // --- cameras: 3s continuously (or cumulatively) in a cone escalates ---
    if (!state.wiresSolved) {
      camCheckTimer -= dt;
      if (camCheckTimer <= 0) {
        camCheckTimer = 0.1;
        cameras.forEach((c) => { c.seen = cameraSees(c, pos); c.zone = c.seen || cameraCovers(c, pos); });
      }
      // builds fast while a cone is on you, slowly while you linger in a camera's
      // area, and drains once you've actually left it
      if (cameras.some((c) => c.seen)) camExposure += dt * SEC.CAM_SEEN_RATE;
      else if (cameras.some((c) => c.zone)) camExposure += dt * SEC.CAM_ZONE_RATE;
      else camExposure = Math.max(0, camExposure - dt);
      if (camExposure >= SEC.CAMERA_TIME) { camExposure = 0; escalate('camera_spotted'); }
    } else {
      camExposure = 0;
      cameras.forEach((c) => { c.seen = false; c.zone = false; });
    }
    const frac = Math.min(1, camExposure / SEC.CAMERA_TIME);
    cameras.forEach((c) => {
      c.cone.material.opacity = 0.12 + (c.seen ? 0.28 * frac : 0);
      c.cone.material.color.setHex(c.seen ? 0xff8800 : 0xff3333);
    });
    ui.setDetect(frac > 0 ? frac : null);

    // --- lasers: touching a beam trips the alarm ---
    laserGates.forEach((g) => {
      g.cooldown = Math.max(0, g.cooldown - dt);
      g.flash = Math.max(0, g.flash - dt);
      g.mat.emissiveIntensity = 1.5 + 5 * (g.flash / 0.6);
      if (g.cooldown <= 0 && Math.abs(pos.z - g.z) < 0.3 && Math.abs(pos.x) < g.halfW + 0.2) {
        g.cooldown = SEC.LASER_COOLDOWN;
        g.flash = 0.6;
        escalate('laser_tripped');
      }
    });

    // --- guards + the entry elevator opening to let them out ---
    const speed = SEC.BASE_SPEED + SEC.SPEED_PER_LEVEL * Math.max(0, state.securityLevel - 1);
    force.update(dt, pos, speed, onCatch);
    const want = force.isSpawning() ? 1 : 0;
    entryDoorT += Math.sign(want - entryDoorT) * Math.min(Math.abs(want - entryDoorT), dt / 0.9);
    const e = entryDoorT * entryDoorT * (3 - 2 * entryDoorT);
    entryElevator.doorL.position.x = -THREE.MathUtils.lerp(entryElevator.closedX, entryElevator.openX, e);
    entryElevator.doorR.position.x = THREE.MathUtils.lerp(entryElevator.closedX, entryElevator.openX, e);
  }

  const missions = {
    isUiOpen: () => ui.isOpen(),
    getPrompt(pos) {
      const it = nearest(pos);
      return it ? it.prompt() : null;
    },
    interact(pos) {
      if (ui.isOpen()) return false;
      const it = nearest(pos);
      if (!it) return false;
      it.action();
      return true;
    },
    update(dt, elapsed, pos, eHeld) {
      // cameras sweep until the wire puzzle is solved
      if (!state.wiresSolved) {
        cameras.forEach((c) => { c.head.rotation.y = Math.sin(elapsed * 0.6 + c.phase) * CAM_SWEEP; });
      }

      securityUpdate(dt, pos);

      // safe door swing
      if (state.safeOpen && SAFE_SWING.t < 1) {
        SAFE_SWING.t = Math.min(1, SAFE_SWING.t + dt / 0.9);
        safe.pivot.rotation.y = -2.0 * (1 - Math.pow(1 - SAFE_SWING.t, 3));
      }

      // hold-to-hack
      const atTerminal = dist(pos, TERMINAL_SPOT) <= 2.4;
      if (!state.hacked && state.hasBadge && atTerminal && eHeld && !ui.isOpen()) {
        state.hackProgress = Math.min(1, state.hackProgress + dt / HACK_TIME);
        ui.setHold(state.hackProgress);
        monitorMat.emissiveIntensity = 0.6 + 0.4 * Math.abs(Math.sin(elapsed * 14)); // flicker while hacking
        if (state.hackProgress >= 1) {
          state.hacked = true;
          monitorMat.emissiveIntensity = 0.9;
          ui.setHold(null);
          sfx('pickup');
          refreshWorld(); refreshTracker();
          H.onSubtitle('Terminal hacked — head for the exit elevator.', 4000);
          H.onObjectiveComplete();
        }
      } else if (state.hackProgress > 0 && !state.hacked) {
        state.hackProgress = Math.max(0, state.hackProgress - dt * 1.5);
        monitorMat.emissiveIntensity = 0.9;
        ui.setHold(state.hackProgress > 0 ? state.hackProgress : null);
      }

      // exit elevator doors open once the hack is done
      if (state.hacked && DOOR_ANIM.t < 1) {
        DOOR_ANIM.t = Math.min(1, DOOR_ANIM.t + dt / 1.1);
        const e = 1 - Math.pow(1 - DOOR_ANIM.t, 3);
        exitElevator.doorL.position.x = -THREE.MathUtils.lerp(exitElevator.closedX, exitElevator.openX, e);
        exitElevator.doorR.position.x = THREE.MathUtils.lerp(exitElevator.closedX, exitElevator.openX, e);
      }
    },
  };

  function dispose() {
    force.dispose();
    ui.dispose();
    disposables.forEach((o) => { if (o && o.dispose) o.dispose(); });
  }

  return {
    root: level2,
    colliders,
    lightFixturePositions,
    entryPosition: new THREE.Vector3(0, 0, R1.z0 + 2),
    exitPosition: EXIT_POS,
    terminalPosition: TERMINAL_SPOT.clone().setY(1.05),
    cameraMarkers,
    cameras,
    missions,
    state,        // read-only view for other systems (e.g. future Security Level code)
    safeCode,
    getSecurityLevel: () => state.securityLevel,
    dispose,
  };
}