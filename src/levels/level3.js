import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { getGuardTemplate } from '../ai/guards.js';
import {
  createLaserMaterial, createHologramMaterial, createVisionConeMaterial, createFanGeometry,
} from '../fx/shaders.js';
import { SEC, NavGrid, createGuardForce } from './security.js';
import { createPuzzleUI } from './puzzles.js';

// ============================================================
// LEVEL 3 - Vault Wing
// What this level does that the others don't:
//   Level 1 = human patrol timing + disguise.   Level 2 = cameras + puzzles.
//   Level 3 = BODY-STANCE STEALTH against physical traps. Laser gates sit at different
//   heights and switch on and off, so standing / crouching / crawling decides which beams
//   can hit you. Guards see less far when you stay low, pressure plates wake the whole
//   wing, and lifting the artifact springs a final alarm - then you have to ESCAPE.
//
//   Checkpoint (sweeping guards) -> Trap Corridor (lasers + plates) ->
//   Clue Hall (3 locks + 3 clue terminals) -> Vault (the tile floor, artifact in the middle)
//   -> Escape maze (2 floors + stairs, guards chase and SHOOT) -> Rooftop (your squad).
//
// THE VAULT
//   Three locks in the Clue Hall open the vault door. The moment it opens the safe path across
//   the tile floor FLASHES ONCE. Missed it? Solve the three (much harder) archive terminals -
//   each one flashes the path again, and after all three it stays lit. A wrong tile sends you
//   back to the start of the tile room; the 3rd wrong step collapses the floor.
//
// CHECKPOINTS
//   Level start, Clue Hall entry, escape start, stairwell. Dying (caught, shot, laser, collapse)
//   reloads the last one with puzzle progress and the stolen item as they were when you reached it.
//
// STAIRS
//   The returned getFloorHeight(x, z) tells main.js how high the floor is. The escape wing is a
//   snake that climbs - floors never sit on top of each other in plan view - so the 2D guard
//   pathfinding works on every floor.
// ============================================================

const floorMat = new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.35, metalness: 0.25 });
const wallMat = new THREE.MeshStandardMaterial({ color: 0x15151a });
const ceilingMat = new THREE.MeshStandardMaterial({ color: 0x101014 });
const fixtureMat = new THREE.MeshStandardMaterial({ color: 0xffe0b0, emissive: 0xffb060, emissiveIntensity: 1.1 });
const vaultFixtureMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d0, emissiveIntensity: 2.0 });
const metalMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, metalness: 0.6, roughness: 0.4 });
const coverMat = new THREE.MeshStandardMaterial({ color: 0x24242c, metalness: 0.4, roughness: 0.5 });
const plateMatBase = new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xffaa00, emissiveIntensity: 0.6 });
const exitMat = new THREE.MeshStandardMaterial({ color: 0x00ccff, emissive: 0x00ccff, emissiveIntensity: 0.9 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x6fb8ff, transparent: true, opacity: 0.16, roughness: 0.1, metalness: 0.2 });
const stairMat = new THREE.MeshStandardMaterial({ color: 0x3c3c46, roughness: 0.8 });
const roofMat = new THREE.MeshStandardMaterial({ color: 0x40434d, roughness: 0.9 });
const noteMat = new THREE.MeshStandardMaterial({ color: 0xfff08a, emissive: 0xffe45a, emissiveIntensity: 0.5, side: THREE.DoubleSide });

// ---- tuning --------------------------------------------------------------
// Player height per stance: a beam at height y hits you if y < this.
const STANCE_HEIGHT = { stand: 1.8, sprint: 1.8, crouch: 1.15, prone: 0.4 };
// How far guards can see you per stance, as a fraction of their full range.
const STANCE_VISIBILITY = { stand: 1.0, sprint: 1.35, crouch: 0.65, prone: 0.4 };
// How fast the detection meter fills per stance: sprinting is loud, crawling is quiet.
// (Without this, dashing through at the right moment beats creeping, which defeats the stance mechanic.)
const STANCE_NOTICE = { stand: 1.0, sprint: 2.0, crouch: 0.6, prone: 0.4 };

const GUARD = {
  RANGE: 7.5,
  HALF_ANGLE: THREE.MathUtils.degToRad(40),
  SEE_RATE: 2.2,     // detection meter fills in ~0.45 s: Level 3 guards react fast
  DECAY: 1.2,
  CLOSE: 1.3,        // inside this you are noticed regardless of facing
  CHASE_SPEED: 4.2,
  CATCH: 0.9,
};

// Laser gates across the corridor (the beam is lethal while ((t + phase) mod period) < onTime;
// the shader draws exactly the same cycle from the same clock).
//   gate 1: one HIGH beam   -> crouch under it any time, or time it standing
//   gate 2: one MID beam    -> crawl under it any time, or time it
//   gate 3: floor+mid+high  -> no stance gets under, pure timing
const LASER_DEFS = [
  { z: 9,  ys: [1.5],            period: 4.0, onTime: 2.2, phase: 0.0 },
  { z: 14, ys: [1.0],            period: 3.4, onTime: 1.9, phase: 1.1 },
  { z: 19, ys: [0.25, 0.8, 1.4], period: 5.0, onTime: 2.6, phase: 2.3 },
];
const PLATES = [{ x: -1.5, z: 11 }, { x: 1.5, z: 16 }, { x: -1.4, z: 21.5 }];
const PLATE_RADIUS = 0.6;

// ---- vault tile floor ----
const T_COLS = 5, T_ROWS = 7, TILE = 1.3, TILE_BOX = 1.2;
const VZ0 = 30, VZ1 = 44;                     // vault front wall (door + windows) / back wall (exit door)
const TZ0 = 32, TZ1 = TZ0 + T_ROWS * TILE;    // tile field (front lobby 30..32, back lobby after TZ1)
const TX0 = -T_COLS * TILE / 2;
const PED_C = Math.floor(T_COLS / 2), PED_R = Math.floor(T_ROWS / 2);
const PIT_Y = -2.5;
const MAX_WRONG = 3;                          // the Nth wrong step collapses the floor
const FLASH_TIME = 5.5;
const STEAL_TIME = 2.5;
const DOOR_W = 2, DOOR_H = 2.6, WALL_T = 0.2, CEILING_HEIGHT = 4;

// ---- escape wing ----
const MAZE_CELL = 3, MAZE_COLS = 5, MAZE_ROWS = 6;
const MAZE_W = MAZE_COLS * MAZE_CELL, MAZE_D = MAZE_ROWS * MAZE_CELL;     // 15 x 18
const RISE = 0.2, TREAD = 0.4, STAIR_STEPS = 22;
const FLOOR_H = RISE * STAIR_STEPS;           // 4.4 - one flight
const STAIR_RUN = TREAD * STAIR_STEPS;        // 8.8
const STAIR_W = MAZE_CELL;
const R_EXIT = 4;                             // maze row the stairs leave from
const MAX_HP = 100;
const FORCE_SPEED = 3.4;                      // reinforcements: faster than a walk (3), slower than a sprint (5)
const WAVE_EVERY = 16;                        // seconds between extra guards during the escape

function makeFloor(width, depth, x, z, y = 0, mat = floorMat) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), mat);
  m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); return m;
}
function makeCeiling(width, depth, x, y, z) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), ceilingMat);
  m.rotation.x = Math.PI / 2; m.position.set(x, y, z); return m;
}
function makeLightFixture(x, y, z, width = 1.0, depth = 1.0, dramatic = false) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), dramatic ? vaultFixtureMat : fixtureMat);
  m.rotation.x = Math.PI / 2; m.position.set(x, y - 0.02, z); m.name = 'light_fixture'; return m;
}
function makeWall(width, height, thickness, x, y, z, rotationY = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(width, height, thickness), wallMat);
  m.position.set(x, y, z); m.rotation.y = rotationY; return m;
}
function makeCover(x, z, w = 0.9, d = 0.9, h = 2.4) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), coverMat);
  m.position.set(x, h / 2, z); m.name = 'collider_cover'; return m;
}
function makeBox(w, h, d, x, y, z, mat, name = '') {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (name) m.name = name;
  return m;
}
// One wall segment (xa..xb at fixed z) with a glass window in it.
function windowSegment(group, z, xa, xb) {
  const H = CEILING_HEIGHT, pil = 0.3, mid = (xa + xb) / 2, inner = (xb - xa) - 2 * pil;
  group.add(makeWall(pil, H, WALL_T, xa + pil / 2, H / 2, z));
  group.add(makeWall(pil, H, WALL_T, xb - pil / 2, H / 2, z));
  group.add(makeWall(inner, 0.9, WALL_T, mid, 0.45, z));                       // sill
  group.add(makeWall(inner, H - 3.0, WALL_T, mid, 3.0 + (H - 3.0) / 2, z));    // head
  group.add(makeBox(inner, 2.1, 0.06, mid, 0.9 + 1.05, z, glassMat, 'collider_glass'));
}
function makeNote(x, y, z, rotY) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.4), noteMat);
  m.position.set(x, y, z); m.rotation.y = rotY; m.name = 'marker_note'; return m;
}
// Wall console: solid base (collider) + glowing screen. Local +z faces into the room.
function makeConsole(x, z, rotY, screenMat) {
  const g = new THREE.Group();
  g.position.set(x, 0, z); g.rotation.y = rotY; g.name = 'console';
  g.add(makeBox(0.9, 1.1, 0.5, 0, 0.55, 0.25, metalMat, 'collider_console'));
  const screen = makeBox(0.72, 0.46, 0.05, 0, 1.3, 0.3, screenMat);
  screen.rotation.x = -0.35;
  g.add(screen);
  return g;
}

const _beamGeo = new THREE.PlaneGeometry(1, 0.55);
const _emitterGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
const _stripGeo = new THREE.PlaneGeometry(4.9, 0.4);   // glowing floor strip under each gate: the danger zone
const _plateGeo = new THREE.BoxGeometry(0.8, 0.05, 0.8);
const _fanGeo = createFanGeometry(GUARD.RANGE, GUARD.HALF_ANGLE, 20);
const _from = new THREE.Vector3(), _to = new THREE.Vector3(), _dir = new THREE.Vector3();
const _tgt = { x: 0, z: 0 };

// ---------- seeded randomness ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- safe path across the tile floor ----------
// Two legs: start row -> the tile just north of the pedestal -> far row. Random per-tile
// weights make the Dijkstra route wind around instead of going straight.
function generateSafePath(rng) {
  const key = (c, r) => c + ',' + r;
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function route(from, isGoal, blocked) {
    const w = new Map();
    for (let c = 0; c < T_COLS; c++) for (let r = 0; r < T_ROWS; r++) w.set(key(c, r), 1 + rng() * 4);
    const dist = new Map([[key(from.c, from.r), 0]]);
    const prev = new Map();
    const open = [[0, from.c, from.r]];
    while (open.length) {
      open.sort((a, b) => a[0] - b[0]);
      const [d, c, r] = open.shift();
      if (d > dist.get(key(c, r))) continue;
      if (isGoal(c, r)) {
        const path = [{ c, r }];
        let k = key(c, r);
        while (prev.has(k)) { const p = prev.get(k); path.unshift(p); k = key(p.c, p.r); }
        return path;
      }
      for (const [dc, dr] of N4) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= T_COLS || nr >= T_ROWS || blocked.has(key(nc, nr))) continue;
        const nd = d + w.get(key(nc, nr));
        if (nd < (dist.get(key(nc, nr)) ?? Infinity)) { dist.set(key(nc, nr), nd); prev.set(key(nc, nr), { c, r }); open.push([nd, nc, nr]); }
      }
    }
    return null;
  }
  let best = null;
  for (let attempt = 0; attempt < 300; attempt++) {
    const start = { c: 1 + Math.floor(rng() * (T_COLS - 2)), r: 0 };
    const pedestal = new Set([key(PED_C, PED_R)]);
    const leg1 = route(start, (c, r) => c === PED_C && r === PED_R - 1, pedestal);
    if (!leg1) continue;
    const used = new Set([...pedestal, ...leg1.slice(0, -1).map((t) => key(t.c, t.r))]);
    const leg2 = route({ c: PED_C, r: PED_R - 1 }, (c, r) => r === T_ROWS - 1, used);
    if (!leg2) continue;
    const full = [...leg1, ...leg2.slice(1)];
    if (!best || full.length > best.length) best = full;
    if (full.length >= 13) break;
  }
  return best;
}

// ---------- escape mazes ----------
function generateMaze(cols, rows, rng, openings) {
  const vW = Array.from({ length: cols + 1 }, () => Array(rows).fill(true));  // wall at the west edge of column c
  const hW = Array.from({ length: cols }, () => Array(rows + 1).fill(true));  // wall at the south edge of row r
  const seen = Array.from({ length: cols }, () => Array(rows).fill(false));
  const stack = [[0, 0]];
  seen[0][0] = true;
  while (stack.length) {
    const [c, r] = stack[stack.length - 1];
    const nb = [];
    if (c > 0 && !seen[c - 1][r]) nb.push([c - 1, r, 'W']);
    if (c < cols - 1 && !seen[c + 1][r]) nb.push([c + 1, r, 'E']);
    if (r > 0 && !seen[c][r - 1]) nb.push([c, r - 1, 'S']);
    if (r < rows - 1 && !seen[c][r + 1]) nb.push([c, r + 1, 'N']);
    if (!nb.length) { stack.pop(); continue; }
    const [nc, nr, dir] = nb[Math.floor(rng() * nb.length)];
    if (dir === 'E') vW[c + 1][r] = false;
    if (dir === 'W') vW[c][r] = false;
    if (dir === 'N') hW[c][r + 1] = false;
    if (dir === 'S') hW[c][r] = false;
    seen[nc][nr] = true;
    stack.push([nc, nr]);
  }
  openings.forEach((o) => {
    if (o.side === 'S') hW[o.i][0] = false;
    if (o.side === 'N') hW[o.i][rows] = false;
    if (o.side === 'W') vW[0][o.i] = false;
    if (o.side === 'E') vW[cols][o.i] = false;
  });
  return { cols, rows, vW, hW };
}
const openingCell = (m, o) => (o.side === 'S' ? [o.i, 0] : o.side === 'N' ? [o.i, m.rows - 1] : o.side === 'W' ? [0, o.i] : [m.cols - 1, o.i]);

function solveMaze(m, from, to) {
  const key = (c, r) => c + ',' + r;
  const prev = new Map([[key(from[0], from[1]), null]]);
  const q = [from];
  while (q.length) {
    const [c, r] = q.shift();
    if (c === to[0] && r === to[1]) break;
    const moves = [];
    if (c > 0 && !m.vW[c][r]) moves.push([c - 1, r]);
    if (c < m.cols - 1 && !m.vW[c + 1][r]) moves.push([c + 1, r]);
    if (r > 0 && !m.hW[c][r]) moves.push([c, r - 1]);
    if (r < m.rows - 1 && !m.hW[c][r + 1]) moves.push([c, r + 1]);
    for (const n of moves) if (!prev.has(key(n[0], n[1]))) { prev.set(key(n[0], n[1]), [c, r]); q.push(n); }
  }
  const path = [];
  let cur = to;
  while (cur) { path.unshift(cur); cur = prev.get(key(cur[0], cur[1])); }
  return path;
}

// Wall boxes with runs of adjacent wall segments merged into single boxes.
function mazeWallBoxes(m, cell, x0, z0) {
  const boxes = [], T = WALL_T;
  for (let j = 0; j <= m.rows; j++) {
    let c = 0;
    while (c < m.cols) {
      if (!m.hW[c][j]) { c++; continue; }
      let c1 = c;
      while (c1 + 1 < m.cols && m.hW[c1 + 1][j]) c1++;
      boxes.push({ w: (c1 - c + 1) * cell + T, d: T, x: x0 + ((c + c1 + 1) / 2) * cell, z: z0 + j * cell });
      c = c1 + 1;
    }
  }
  for (let i = 0; i <= m.cols; i++) {
    let r = 0;
    while (r < m.rows) {
      if (!m.vW[i][r]) { r++; continue; }
      let r1 = r;
      while (r1 + 1 < m.rows && m.vW[i][r1 + 1]) r1++;
      boxes.push({ w: T, d: (r1 - r + 1) * cell + T, x: x0 + i * cell, z: z0 + ((r + r1 + 1) / 2) * cell });
      r = r1 + 1;
    }
  }
  return boxes;
}

// ---- guard (checkpoint sweepers) -------------------------------------------
// Hierarchy: guard group (position + yaw) -> character mesh + vision-fan mesh.
// The fan is a CHILD of the guard, so it turns with the guard for free (scene-graph parenting).
// Once alerted they CHASE using the shared nav flow field, so they can follow you through the
// vault, the maze and up the stairs instead of walking in a straight line into walls.
class VaultGuard {
  constructor(parent, x, z, { baseYaw = 0, sweep = 0.65, period = 6, phase = 0, template }) {
    this.baseYaw = baseYaw; this.sweep = sweep; this.period = period; this.phase = phase;
    this.home = { x, z };
    this.state = 'scan';
    this.meter = 0; this.checkTimer = Math.random() * 0.1; this.visible = false;
    this.current = null; this.actions = {}; this.mixer = null;

    this.group = new THREE.Group();
    this.group.name = 'VaultGuard';
    this.group.position.set(x, 0, z);
    this.group.rotation.y = baseYaw;

    if (template) {
      this.body = SkeletonUtils.clone(template.scene);
      this.mixer = new THREE.AnimationMixer(this.body);
      template.animations.forEach((clip) => { this.actions[clip.name] = this.mixer.clipAction(clip); });
    } else {
      this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.2, 4, 12), new THREE.MeshStandardMaterial({ color: 0x8a1f1f }));
      this.body.position.y = 0.9;
    }
    this.group.add(this.body);
    this.body.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    this.coneMat = createVisionConeMaterial({ color: 0xff3333, opacity: 0.10, flip: false });
    this.fan = new THREE.Mesh(_fanGeo, this.coneMat);
    this.fan.position.y = 0.03;
    this.fan.name = 'marker_guardFan';
    this.group.add(this.fan);

    parent.add(this.group);
    this._act('Idle');
  }

  _act(name) {
    const next = this.actions[name];
    if (!next || this.current === next) return;
    if (this.current) this.current.fadeOut(0.25);
    next.reset().fadeIn(0.25).play();
    this.current = next;
  }

  alert() { if (this.state === 'chase') return; this.state = 'chase'; this.fan.visible = false; }

  // back to the scanning post (checkpoint reload)
  reset() {
    this.state = 'scan'; this.meter = 0; this.visible = false; this.fan.visible = true;
    this.coneMat.opacity = 0.10; this.coneMat.color.setHex(0xff3333);
    this.group.position.set(this.home.x, 0, this.home.z);
    this.group.rotation.y = this.baseYaw;
    this._act('Idle');
  }

  update(dt, t, pos, stance, raycaster, colliders, onCatch, onSpot, chase) {
    if (this.mixer) this.mixer.update(dt);
    const g = this.group.position;
    const dx = pos.x - g.x, dz = pos.z - g.z;
    const dist = Math.hypot(dx, dz) || 0.0001;

    if (this.state === 'chase') {
      if (dist < GUARD.CATCH && Math.abs(pos.y - g.y) < 1.2) { onCatch(); return; }
      let tx = pos.x, tz = pos.z;
      if (!chase.nav.los(g.x, g.z, pos.x, pos.z) && chase.nav.nextTarget(g.x, g.z, _tgt)) { tx = _tgt.x; tz = _tgt.z; }
      const mx = tx - g.x, mz = tz - g.z, ml = Math.hypot(mx, mz) || 0.0001;
      const step = Math.min(GUARD.CHASE_SPEED * dt, ml);
      g.x += (mx / ml) * step; g.z += (mz / ml) * step;
      g.y += (chase.floorHeight(g.x, g.z) - g.y) * Math.min(1, dt * 14);
      let d = Math.atan2(mx, mz) - this.group.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.group.rotation.y += Math.max(-12 * dt, Math.min(12 * dt, d));
      this._act(this.actions.Run ? 'Run' : 'Walk');
      return;
    }

    // scanning: stands still, head sweeping side to side
    this.group.rotation.y = this.baseYaw + this.sweep * Math.sin((t * Math.PI * 2) / this.period + this.phase);
    this._act('Idle');

    this.checkTimer -= dt;
    if (this.checkTimer <= 0) {
      this.checkTimer = 0.1;
      const yaw = this.group.rotation.y;
      const range = GUARD.RANGE * (STANCE_VISIBILITY[stance] ?? 1);
      const cosAng = (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / dist;
      let see = dist < GUARD.CLOSE || (dist < range && cosAng > Math.cos(GUARD.HALF_ANGLE));
      if (see) {   // is a pillar or wall in the way?
        _from.set(g.x, 1.5, g.z); _to.set(pos.x, 1.0, pos.z);
        _dir.subVectors(_to, _from);
        const len = _dir.length();
        raycaster.set(_from, _dir.normalize());
        raycaster.far = len;
        if (raycaster.intersectObjects(colliders, false).length > 0) see = false;
      }
      this.visible = see;
    }
    this.meter = THREE.MathUtils.clamp(this.meter + (this.visible ? GUARD.SEE_RATE * (STANCE_NOTICE[stance] ?? 1) : -GUARD.DECAY) * dt, 0, 1.2);
    // the cone itself shows detection: red -> orange and brighter as the meter fills
    this.coneMat.opacity = 0.10 + 0.30 * Math.min(1, this.meter);
    this.coneMat.color.setHex(this.meter > 0.05 ? 0xff8800 : 0xff3333);
    if (this.meter >= 1) onSpot();
  }
}

// ============================================================
// HUD - plain DOM, injected/removed by the level itself
// ============================================================
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const UI_CSS = `
#l3-tracker{position:fixed;top:14px;left:14px;z-index:20;min-width:240px;max-width:300px;padding:10px 14px;
  background:rgba(14,10,6,.72);border:1px solid rgba(255,190,110,.35);border-radius:6px;
  font:13px/1.45 monospace;color:#ffe6c4;pointer-events:none}
#l3-tracker h4{margin:0 0 6px;font-size:11px;letter-spacing:.15em;color:#ffbe6e}
#l3-tracker .it{display:flex;gap:8px}
#l3-tracker .it.done{color:#6dff9a;text-decoration:line-through;opacity:.8}
#l3-tracker .it.opt{opacity:.8;font-size:12px}
#l3-tracker .sub{margin:0 0 4px 22px;font-size:12px;color:#9fd4ff}
#l3-hold{position:fixed;left:50%;top:62%;transform:translateX(-50%);z-index:20;width:260px;display:none;
  font:12px monospace;color:#ffd27a;text-align:center;pointer-events:none}
#l3-hold .bar{margin-top:4px;height:10px;border:1px solid #ffbe6e;background:rgba(0,0,0,.6)}
#l3-hold .fill{height:100%;width:0;background:#ffbe6e}
#l3-hp{position:fixed;left:14px;bottom:18px;z-index:20;width:200px;display:none;font:11px monospace;color:#ffb0a0;pointer-events:none}
#l3-hp .bar{margin-top:3px;height:10px;border:1px solid #ff6a5a;background:rgba(0,0,0,.6)}
#l3-hp .fill{height:100%;width:100%;background:#ff4d3d}
#l3-dmg{position:fixed;inset:0;z-index:19;pointer-events:none;opacity:0;transition:opacity .35s;
  background:radial-gradient(ellipse at center,rgba(255,0,0,0) 40%,rgba(200,0,0,.55) 100%)}
#l3-fade{position:fixed;inset:0;z-index:70;pointer-events:none;background:#000;opacity:0;transition:opacity .8s}
#l3-map{position:fixed;top:14px;right:14px;z-index:20;display:none;padding:8px;background:rgba(6,12,18,.82);
  border:1px solid rgba(110,200,255,.4);border-radius:6px;font:11px monospace;color:#9fd4ff;pointer-events:none;text-align:center}
#l3-map canvas{display:block;margin-top:4px;background:#04080c}
`;
const MAP_W = 180, MAP_H = 216;

function createHud() {
  const style = document.createElement('style');
  style.textContent = UI_CSS;
  document.head.appendChild(style);
  const tracker = el('div'); tracker.id = 'l3-tracker';
  const hold = el('div'); hold.id = 'l3-hold';
  const holdBar = el('div', 'bar'); const holdFill = el('div', 'fill');
  holdBar.appendChild(holdFill);
  hold.append(el('div', '', 'CRACKING THE CASE…'), holdBar);
  const hp = el('div'); hp.id = 'l3-hp';
  const hpBar = el('div', 'bar'); const hpFill = el('div', 'fill');
  hpBar.appendChild(hpFill);
  hp.append(el('div', '', 'HEALTH'), hpBar);
  const dmg = el('div'); dmg.id = 'l3-dmg';
  const fade = el('div'); fade.id = 'l3-fade';
  const map = el('div'); map.id = 'l3-map';
  const mapTitle = el('div', '', 'ESCAPE MAP');
  const canvas = document.createElement('canvas');
  canvas.width = MAP_W; canvas.height = MAP_H;
  map.append(mapTitle, canvas);
  document.body.append(tracker, hold, hp, dmg, fade, map);
  let dmgTimer = null, fadeTimer = null;
  let ctx = null;
  try { ctx = canvas.getContext ? canvas.getContext('2d') : null; } catch (e) { ctx = null; }

  return {
    ctx,
    setTracker(items) {
      tracker.innerHTML = '';
      tracker.appendChild(el('h4', '', 'OBJECTIVES'));
      items.forEach((it) => {
        const row = el('div', 'it' + (it.done ? ' done' : '') + (it.optional ? ' opt' : ''));
        row.append(el('span', '', it.done ? '✔' : it.optional ? '◦' : '▫'), el('span', '', it.text));
        tracker.appendChild(row);
        if (it.sub) tracker.appendChild(el('div', 'sub', it.sub));
      });
    },
    setHold(frac) {
      if (frac === null) { hold.style.display = 'none'; return; }
      hold.style.display = 'block';
      holdFill.style.width = Math.round(frac * 100) + '%';
    },
    setHealth(frac, show) {
      hp.style.display = show ? 'block' : 'none';
      hpFill.style.width = Math.max(0, Math.round(frac * 100)) + '%';
    },
    hitFlash() {
      dmg.style.opacity = '1';
      clearTimeout(dmgTimer);
      dmgTimer = setTimeout(() => { dmg.style.opacity = '0'; }, 160);
    },
    fadeFromBlack() {
      fade.style.transition = 'none'; fade.style.opacity = '1';
      clearTimeout(fadeTimer);
      fadeTimer = setTimeout(() => { fade.style.transition = 'opacity .8s'; fade.style.opacity = '0'; }, 60);
    },
    setMapVisible(v, title) { map.style.display = v ? 'block' : 'none'; if (title) mapTitle.textContent = title; },
    dispose() {
      clearTimeout(dmgTimer); clearTimeout(fadeTimer);
      style.remove(); tracker.remove(); hold.remove(); hp.remove(); dmg.remove(); fade.remove(); map.remove();
    },
  };
}

// ============================================================
// LEVEL
// ============================================================
export function createLevel3(scene, hooks = {}) {
  const H = {
    game: { alarmActive: false, objectiveComplete: false, escapeTimeRemaining: null },
    onSubtitle: () => {}, onCaught: () => {}, triggerAlarm: () => {}, sfx: {},
    clearAlarm: () => {},            // checkpoint reload: switch the alarm (klaxon, red lights) back off
    onObjectiveComplete: () => {},   // the artifact is stolen
    onUiChange: () => {},            // (open, relock) - puzzle overlays free the mouse / pause the world
    removeCollider: () => {},        // (mesh) - a door opened: main.js drops it from its collider list
    addCollider: () => {},           // (mesh) - a door closed again
    line: () => {},                  // (key, ms) - earpiece voice line + caption
    seed: undefined,                 // number -> repeatable layout (tests); random otherwise
    ...hooks,
  };
  const sfx = (name) => { try { H.sfx[name] && H.sfx[name](); } catch (e) { /* audio is optional */ } };
  const ownMaterials = [];
  const track = (m) => { ownMaterials.push(m); return m; };
  const rng = mulberry32(H.seed ?? Math.floor(Math.random() * 1e9));

  const level3 = new THREE.Group();
  level3.name = 'Level3';
  const lightFixturePositions = [];
  const dramaticFixturePositions = [];

  // ============ CHECKPOINT ============  x -4..4, z -4..4
  const checkpoint = new THREE.Group();
  checkpoint.name = 'Checkpoint';
  checkpoint.add(makeFloor(8, 8, 0, 0));
  checkpoint.add(makeWall(8, 4, 0.2, 0, 2, -4));
  checkpoint.add(makeWall(3, 4, 0.2, -2.5, 2, 4));
  checkpoint.add(makeWall(3, 4, 0.2, 2.5, 2, 4));
  checkpoint.add(makeWall(8, 4, 0.2, -4, 2, 0, Math.PI / 2));
  checkpoint.add(makeWall(8, 4, 0.2, 4, 2, 0, Math.PI / 2));
  checkpoint.add(makeCeiling(8, 8, 0, CEILING_HEIGHT, 0));
  [[-2, -2], [2, -2], [-2, 2], [2, 2]].forEach(([x, z]) => {
    checkpoint.add(makeLightFixture(x, CEILING_HEIGHT, z));
    lightFixturePositions.push(new THREE.Vector3(x, CEILING_HEIGHT, z));
  });
  checkpoint.add(makeCover(-1.2, -0.8));   // pillars: break line of sight behind them
  checkpoint.add(makeCover(1.4, 0.4));
  const entryMarker = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 2), exitMat);
  entryMarker.position.set(0, 0.05, -2.5);
  entryMarker.name = 'marker_entry';
  checkpoint.add(entryMarker);
  checkpoint.add(makeNote(-1.2, 1.3, -0.8 - 0.47, 0));     // the lock-keypad code, on the first pillar
  level3.add(checkpoint);

  // ============ TRAP CORRIDOR ============  x -2.5..2.5, z 4..24
  const corridor = new THREE.Group();
  corridor.name = 'TrapCorridor';
  corridor.add(makeFloor(5, 20, 0, 14));
  corridor.add(makeWall(20, 4, 0.2, -2.5, 2, 14, Math.PI / 2));
  corridor.add(makeWall(20, 4, 0.2, 2.5, 2, 14, Math.PI / 2));
  corridor.add(makeCeiling(5, 20, 0, CEILING_HEIGHT, 14));
  [[0, 7], [0, 12], [0, 17], [0, 22]].forEach(([x, z]) => {
    corridor.add(makeLightFixture(x, CEILING_HEIGHT, z));
    lightFixturePositions.push(new THREE.Vector3(x, CEILING_HEIGHT, z));
  });

  // Laser gates. Hierarchy: gate group -> beam quads (two crossed planes so the beam is visible
  // from any angle) + an emitter box on each wall. One shader material per gate.
  const lasers = LASER_DEFS.map((def) => {
    const gate = new THREE.Group();
    gate.name = 'LaserGate';
    gate.position.set(0, 0, def.z);
    const mat = track(createLaserMaterial({ color: 0xff2222, period: def.period, onTime: def.onTime, phase: def.phase }));
    // Emitters and the floor strip glow bright red only while the gate is lethal (set in update()),
    // so you can read the state of a gate from the corner of your eye, not just from the beam.
    const emitMat = track(new THREE.MeshStandardMaterial({ color: 0x2a2a30, emissive: 0xff2222, emissiveIntensity: 0.15, metalness: 0.6, roughness: 0.4 }));
    const strip = new THREE.Mesh(_stripGeo, emitMat);
    strip.rotation.x = -Math.PI / 2; strip.position.y = 0.02; strip.name = 'marker_laserStrip';
    gate.add(strip);
    def.ys.forEach((y) => {
      const beam = new THREE.Group();
      beam.position.y = y;
      const v = new THREE.Mesh(_beamGeo, mat); v.scale.x = 4.9;
      const h = new THREE.Mesh(_beamGeo, mat); h.scale.x = 4.9; h.rotation.x = Math.PI / 2;
      v.name = h.name = 'marker_laser';
      beam.add(v, h);
      gate.add(beam);
      [-2.42, 2.42].forEach((x) => {
        const e = new THREE.Mesh(_emitterGeo, emitMat);
        e.position.set(x, y, 0);
        gate.add(e);
      });
    });
    corridor.add(gate);
    return { def, emitMat };
  });

  const plates = PLATES.map((p) => {
    const mat = track(plateMatBase.clone());
    const mesh = new THREE.Mesh(_plateGeo, mat);
    mesh.position.set(p.x, 0.03, p.z);
    mesh.name = 'marker_pressurePlate';
    corridor.add(mesh);
    return { ...p, mat, tripped: false };
  });
  corridor.add(makeNote(-2.39, 1.4, 12.3, Math.PI / 2));   // the archive-keypad code, on the west wall
  level3.add(corridor);

  // ============ CLUE HALL ============  x -3..3, z 24..30
  // Three LOCKS (west wall) open the vault. Three ARCHIVE terminals (east wall) are optional
  // and much harder: each one makes the vault floor path flash again.
  const hall = new THREE.Group();
  hall.name = 'ClueHall';
  hall.add(makeFloor(6, 6, 0, 27));
  hall.add(makeWall(2, 4, 0.2, -2, 2, 24));
  hall.add(makeWall(2, 4, 0.2, 2, 2, 24));
  hall.add(makeWall(6, 4, 0.2, -3, 2, 27, Math.PI / 2));
  hall.add(makeWall(6, 4, 0.2, 3, 2, 27, Math.PI / 2));
  hall.add(makeCeiling(6, 6, 0, CEILING_HEIGHT, 27));
  hall.add(makeLightFixture(0, CEILING_HEIGHT, 27));
  lightFixturePositions.push(new THREE.Vector3(0, CEILING_HEIGHT, 27));

  const codes = {
    lock: String(1000 + Math.floor(rng() * 9000)),
    clue: String(10000 + Math.floor(rng() * 90000)),
  };
  const STATION_Z = [25.2, 27, 28.8];
  const stationDefs = [
    { id: 'L1', kind: 'lock', n: 0, puzzle: 'keypad', label: 'Lock 1 - keypad',   x: -2.9, z: STATION_Z[0], rot:  Math.PI / 2 },
    { id: 'L2', kind: 'lock', n: 1, puzzle: 'wires',  label: 'Lock 2 - wiring',   x: -2.9, z: STATION_Z[1], rot:  Math.PI / 2 },
    { id: 'L3', kind: 'lock', n: 2, puzzle: 'simon',  label: 'Lock 3 - sequence', x: -2.9, z: STATION_Z[2], rot:  Math.PI / 2 },
    { id: 'C1', kind: 'clue', n: 0, puzzle: 'keypad', label: 'Archive terminal A (keypad)',   x: 2.9, z: STATION_Z[0], rot: -Math.PI / 2 },
    { id: 'C2', kind: 'clue', n: 1, puzzle: 'wires',  label: 'Archive terminal B (wiring)',   x: 2.9, z: STATION_Z[1], rot: -Math.PI / 2 },
    { id: 'C3', kind: 'clue', n: 2, puzzle: 'simon',  label: 'Archive terminal C (sequence)', x: 2.9, z: STATION_Z[2], rot: -Math.PI / 2 },
  ];
  const stations = stationDefs.map((sd) => {
    const col = sd.kind === 'lock' ? 0xffaa33 : 0x33aaff;
    const mat = track(new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.9 }));
    hall.add(makeConsole(sd.x, sd.z, sd.rot, mat));
    return { ...sd, mat, ix: sd.x + Math.sin(sd.rot) * 0.5, iz: sd.z + Math.cos(sd.rot) * 0.5, solved: false };
  });
  // three lamps over the vault door - red until each lock is released
  const lampMats = [0, 1, 2].map(() => track(new THREE.MeshStandardMaterial({ color: 0xff3333, emissive: 0xff3333, emissiveIntensity: 1.2 })));
  lampMats.forEach((m, i) => hall.add(makeBox(0.4, 0.2, 0.08, (i - 1) * 0.7, 3.25, VZ0 - 0.16, m)));
  level3.add(hall);

  // ============ VAULT ============  x -4..4, z 30..44 - the tile floor
  const vault = new THREE.Group();
  vault.name = 'Vault';
  const tileGridW = T_COLS * TILE, tileGridD = T_ROWS * TILE;
  const stripW = 4 - tileGridW / 2;
  vault.add(makeFloor(8, TZ0 - VZ0, 0, (VZ0 + TZ0) / 2));                              // front lobby
  vault.add(makeFloor(8, VZ1 - TZ1, 0, (TZ1 + VZ1) / 2));                               // back lobby
  vault.add(makeFloor(stripW, tileGridD, 4 - stripW / 2, (TZ0 + TZ1) / 2));
  vault.add(makeFloor(stripW, tileGridD, -(4 - stripW / 2), (TZ0 + TZ1) / 2));
  vault.add(makeFloor(tileGridW, tileGridD, 0, (TZ0 + TZ1) / 2, PIT_Y, track(new THREE.MeshStandardMaterial({ color: 0x050506 }))));
  vault.add(makeCeiling(8, VZ1 - VZ0, 0, CEILING_HEIGHT, (VZ0 + VZ1) / 2));
  // front wall: doorway from the Clue Hall with a glass window either side of it
  vault.add(makeWall(1, 4, 0.2, -3.5, 2, VZ0));
  vault.add(makeWall(1, 4, 0.2, 3.5, 2, VZ0));
  windowSegment(vault, VZ0, -3, -1);
  windowSegment(vault, VZ0, 1, 3);
  vault.add(makeWall(DOOR_W, CEILING_HEIGHT - DOOR_H, 0.2, 0, DOOR_H + (CEILING_HEIGHT - DOOR_H) / 2, VZ0));
  vault.add(makeWall(VZ1 - VZ0 + 0.2, 4, 0.2, -4, 2, (VZ0 + VZ1) / 2, Math.PI / 2));
  vault.add(makeWall(VZ1 - VZ0 + 0.2, 4, 0.2, 4, 2, (VZ0 + VZ1) / 2, Math.PI / 2));
  // back wall: the emergency exit into the escape maze
  vault.add(makeWall(3, 4, 0.2, -2.5, 2, VZ1));
  vault.add(makeWall(3, 4, 0.2, 2.5, 2, VZ1));
  vault.add(makeWall(DOOR_W, CEILING_HEIGHT - DOOR_H, 0.2, 0, DOOR_H + (CEILING_HEIGHT - DOOR_H) / 2, VZ1));
  [[-3, 31.5], [3, 31.5], [-3, 42.5], [3, 42.5]].forEach(([x, z]) => {
    vault.add(makeLightFixture(x, CEILING_HEIGHT, z, 0.8, 0.8));
    lightFixturePositions.push(new THREE.Vector3(x, CEILING_HEIGHT, z));
  });
  const tileX = (c) => TX0 + (c + 0.5) * TILE;
  const tileZ = (r) => TZ0 + (r + 0.5) * TILE;
  const PED_X = tileX(PED_C), ITEM_Z = tileZ(PED_R);
  vault.add(makeLightFixture(PED_X, CEILING_HEIGHT, ITEM_Z, 1.5, 1.5, true));
  dramaticFixturePositions.push(new THREE.Vector3(PED_X, CEILING_HEIGHT, ITEM_Z));

  // tiles: only the safe path is walkable
  const tileMat = track(new THREE.MeshStandardMaterial({ color: 0x3e4152, metalness: 0.3, roughness: 0.55 }));
  const platformMat = track(new THREE.MeshStandardMaterial({ color: 0x7a8096, metalness: 0.4, roughness: 0.45 }));
  const glowMat = track(new THREE.MeshStandardMaterial({ color: 0x33f0ff, emissive: 0x33f0ff, emissiveIntensity: 1.8 }));
  const litMat = track(new THREE.MeshStandardMaterial({ color: 0x2c4a55, emissive: 0x22b5c4, emissiveIntensity: 0.45 }));
  const wrongMat = track(new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff2222, emissiveIntensity: 1.6 }));
  const tileGeo = new THREE.BoxGeometry(TILE_BOX, 0.12, TILE_BOX);
  const tiles = [];
  for (let r = 0; r < T_ROWS; r++) {
    for (let c = 0; c < T_COLS; c++) {
      const isPed = c === PED_C && r === PED_R;
      const mesh = new THREE.Mesh(tileGeo, isPed ? platformMat : tileMat);
      mesh.position.set(tileX(c), -0.06, tileZ(r));
      mesh.name = 'tile';
      vault.add(mesh);
      tiles.push({ c, r, mesh, isPed, isPath: false, redT: 0, collapsed: false, vy: 0 });
    }
  }
  const tileAt = (c, r) => tiles[r * T_COLS + c];
  const safePath = generateSafePath(rng);
  safePath.forEach((t) => { tileAt(t.c, t.r).isPath = true; });

  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 1.0, 20), metalMat);
  pedestal.position.set(PED_X, 0.5, ITEM_Z);
  pedestal.name = 'collider_pedestal';
  vault.add(pedestal);
  const holoMat = track(createHologramMaterial(0xffcc33));
  const vaultItem = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 2), holoMat);
  vaultItem.position.set(PED_X, 1.35, ITEM_Z);
  vaultItem.name = 'marker_vaultItem';
  vault.add(vaultItem);

  // THE dramatic light: a shadow-casting spot straight onto the pedestal (tight shadow frustum).
  const spotTarget = new THREE.Object3D();
  spotTarget.position.set(PED_X, 1, ITEM_Z);
  vault.add(spotTarget);
  const vaultSpot = new THREE.SpotLight(0xfff0d0, 30, 12, Math.PI / 6, 0.55, 2);
  vaultSpot.position.set(PED_X, CEILING_HEIGHT - 0.2, ITEM_Z);
  vaultSpot.target = spotTarget;
  vaultSpot.castShadow = true;
  vaultSpot.shadow.mapSize.set(1024, 1024);
  vaultSpot.shadow.camera.near = 0.5;
  vaultSpot.shadow.camera.far = 6;
  vaultSpot.shadow.bias = -0.0008;
  vault.add(vaultSpot);

  // sliding doors: the vault door (Clue Hall -> vault) and the emergency exit (vault -> maze)
  const doorMat = track(new THREE.MeshStandardMaterial({ color: 0x3a3d48, metalness: 0.7, roughness: 0.35, emissive: 0x330000, emissiveIntensity: 0.6 }));
  const doorGeo = new THREE.BoxGeometry(DOOR_W - 0.04, DOOR_H, 0.16);
  function makeSlideDoor(z) {
    const mesh = new THREE.Mesh(doorGeo, doorMat);
    mesh.position.set(0, DOOR_H / 2, z);
    mesh.name = 'collider_door';
    level3.add(mesh);
    return { mesh, t: 0, target: 0, solid: true };
  }
  const vaultDoor = makeSlideDoor(VZ0);
  const exitDoor = makeSlideDoor(VZ1);
  const TILE_START = new THREE.Vector3(0, 0, VZ0 + 1.0);
  level3.add(vault);

  // ============ ESCAPE WING ============
  // E1 (ground maze) -> S1 (stairs, +x) -> E2 (upper maze) -> S2 (stairs, +z) -> rooftop.
  // The floors sit side by side in plan view, so nothing is ever above anything else.
  const E1 = { x0: -MAZE_W / 2, x1: MAZE_W / 2, z0: VZ1, z1: VZ1 + MAZE_D, y: 0 };
  const S1 = { x0: E1.x1, x1: E1.x1 + STAIR_RUN, zc: VZ1 + (R_EXIT + 0.5) * MAZE_CELL };
  const E2 = { x0: S1.x1, x1: S1.x1 + MAZE_W, z0: VZ1, z1: VZ1 + MAZE_D, y: FLOOR_H };
  const S2 = { xc: E2.x0 + 2.5 * MAZE_CELL, z0: E2.z1, z1: E2.z1 + STAIR_RUN };
  const ROOF = { x0: E2.x0, x1: E2.x1, z0: S2.z1, z1: S2.z1 + 17.2, y: 2 * FLOOR_H };
  const inRect = (x, z, r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

  // Height of the walkable surface (stairs are stepped to match the treads). Used by guards + nav.
  function getWalkHeight(x, z) {
    if (Math.abs(z - S1.zc) <= STAIR_W / 2 && x > S1.x0 && x < S1.x1) {
      return Math.min(STAIR_STEPS, Math.floor((x - S1.x0) / TREAD) + 1) * RISE;
    }
    if (Math.abs(x - S2.xc) <= STAIR_W / 2 && z > S2.z0 && z < S2.z1) {
      return FLOOR_H + Math.min(STAIR_STEPS, Math.floor((z - S2.z0) / TREAD) + 1) * RISE;
    }
    if (inRect(x, z, E2)) return E2.y;
    if (inRect(x, z, ROOF)) return ROOF.y;
    return 0;
  }

  const escape = new THREE.Group();
  escape.name = 'EscapeWing';
  const mrng = mulberry32(Math.floor(rng() * 1e9));
  const e1Open = [{ side: 'S', i: 2 }, { side: 'E', i: R_EXIT }];
  const e2Open = [{ side: 'W', i: R_EXIT }, { side: 'N', i: 2 }];
  const maze1 = generateMaze(MAZE_COLS, MAZE_ROWS, mrng, e1Open);
  const maze2 = generateMaze(MAZE_COLS, MAZE_ROWS, mrng, e2Open);
  const route1 = solveMaze(maze1, openingCell(maze1, e1Open[0]), openingCell(maze1, e1Open[1]));
  const route2 = solveMaze(maze2, openingCell(maze2, e2Open[0]), openingCell(maze2, e2Open[1]));
  const addMaze = (m, x0, z0, y0) => {
    mazeWallBoxes(m, MAZE_CELL, x0, z0).forEach((b) => {
      escape.add(makeWall(b.w, CEILING_HEIGHT, b.d, b.x, y0 + CEILING_HEIGHT / 2, b.z));
    });
  };
  addMaze(maze1, E1.x0, E1.z0, E1.y);
  addMaze(maze2, E2.x0, E2.z0, E2.y);
  escape.add(makeFloor(MAZE_W, MAZE_D, (E1.x0 + E1.x1) / 2, (E1.z0 + E1.z1) / 2));
  escape.add(makeCeiling(MAZE_W, MAZE_D, (E1.x0 + E1.x1) / 2, E1.y + CEILING_HEIGHT, (E1.z0 + E1.z1) / 2));
  escape.add(makeFloor(MAZE_W, MAZE_D, (E2.x0 + E2.x1) / 2, (E2.z0 + E2.z1) / 2, E2.y));
  escape.add(makeCeiling(MAZE_W, MAZE_D, (E2.x0 + E2.x1) / 2, E2.y + CEILING_HEIGHT, (E2.z0 + E2.z1) / 2));

  // Lights: fixture meshes everywhere, but real PointLights come from a small pool of 4 that
  // follows the player to the nearest fixtures. (Constant light count = no shader recompiles,
  // and the level doesn't add a dozen permanent lights on top of the ones main.js creates.)
  const mazeFixtures = [];
  [[1, 1], [3, 3], [1, 5], [3, 5]].forEach(([c, r]) => {
    [E1, E2].forEach((E) => {
      const x = E.x0 + (c + 0.5) * MAZE_CELL, z = E.z0 + (r + 0.5) * MAZE_CELL, y = E.y + CEILING_HEIGHT;
      escape.add(makeLightFixture(x, y, z, 0.8, 0.8));
      mazeFixtures.push(new THREE.Vector3(x, y, z));
    });
  });

  // stairs
  const makeStairs = (axis, x, z, y0) => {
    for (let k = 0; k < STAIR_STEPS; k++) {
      const h = (k + 1) * RISE, along = (k + 0.5) * TREAD;
      escape.add(axis === 'x'
        ? makeBox(TREAD, h, STAIR_W, x + along, y0 + h / 2, z, stairMat, 'tread')
        : makeBox(STAIR_W, h, TREAD, x, y0 + h / 2, z + along, stairMat, 'tread'));
    }
    const wallH = FLOOR_H + CEILING_HEIGHT, half = STAIR_W / 2;
    [-1, 1].forEach((sd) => escape.add(axis === 'x'
      ? makeWall(STAIR_RUN + WALL_T, wallH, WALL_T, x + STAIR_RUN / 2, y0 + wallH / 2, z + sd * half)
      : makeWall(WALL_T, wallH, STAIR_RUN + WALL_T, x + sd * half, y0 + wallH / 2, z + STAIR_RUN / 2)));
    const ang = Math.atan2(FLOOR_H, STAIR_RUN), len = Math.hypot(STAIR_RUN, FLOOR_H);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(axis === 'x' ? len : STAIR_W, 0.1, axis === 'x' ? STAIR_W : len), ceilingMat);
    if (axis === 'x') { slab.position.set(x + STAIR_RUN / 2, y0 + FLOOR_H / 2 + 3.4, z); slab.rotation.z = ang; }
    else { slab.position.set(x, y0 + FLOOR_H / 2 + 3.4, z + STAIR_RUN / 2); slab.rotation.x = -ang; }
    escape.add(slab);
    mazeFixtures.push(new THREE.Vector3(axis === 'x' ? x + STAIR_RUN / 2 : x, y0 + FLOOR_H / 2 + 3.2, axis === 'x' ? z : z + STAIR_RUN / 2));
  };
  makeStairs('x', S1.x0, S1.zc, 0);
  makeStairs('z', S2.xc, S2.z0, FLOOR_H);

  // rooftop
  const roofW = ROOF.x1 - ROOF.x0, roofD = ROOF.z1 - ROOF.z0;
  escape.add(makeFloor(roofW, roofD, (ROOF.x0 + ROOF.x1) / 2, (ROOF.z0 + ROOF.z1) / 2, ROOF.y, roofMat));
  const parapet = (w, d, x, z) => escape.add(makeBox(w, 1.2, d, x, ROOF.y + 0.6, z, wallMat, 'collider_parapet'));
  parapet(roofW, 0.3, (ROOF.x0 + ROOF.x1) / 2, ROOF.z1);
  parapet(0.3, roofD, ROOF.x0, (ROOF.z0 + ROOF.z1) / 2);
  parapet(0.3, roofD, ROOF.x1, (ROOF.z0 + ROOF.z1) / 2);
  const gapL = S2.xc - STAIR_W / 2, gapR = S2.xc + STAIR_W / 2;                      // south edge, leaving the stair mouth
  parapet(gapL - ROOF.x0, 0.3, (ROOF.x0 + gapL) / 2, ROOF.z0);
  parapet(ROOF.x1 - gapR, 0.3, (gapR + ROOF.x1) / 2, ROOF.z0);
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 0.06, 32), track(new THREE.MeshStandardMaterial({ color: 0x2a2f3a, emissive: 0x1a2a40, emissiveIntensity: 0.6 })));
  pad.position.set(S2.xc, ROOF.y + 0.03, ROOF.z0 + 12);
  escape.add(pad);
  const EXIT_POS = new THREE.Vector3(S2.xc, ROOF.y, ROOF.z0 + 9);                     // beside the squad
  const exitPad = new THREE.Mesh(new THREE.BoxGeometry(2, 0.05, 2), exitMat);
  exitPad.position.set(EXIT_POS.x, ROOF.y + 0.03, EXIT_POS.z);
  exitPad.name = 'marker_exit';
  escape.add(exitPad);
  const squadMat = track(new THREE.MeshStandardMaterial({ color: 0x1f6f66, emissive: 0x2fd0c0, emissiveIntensity: 0.35 }));
  const squadGeo = new THREE.CapsuleGeometry(0.3, 1.2, 4, 12);
  [[-1.6, 2.2], [0, 3.2], [1.6, 2.2]].forEach(([dx, dz]) => {
    const m = new THREE.Mesh(squadGeo, squadMat);
    m.position.set(EXIT_POS.x + dx, ROOF.y + 0.9, EXIT_POS.z + dz);
    m.name = 'squad';
    escape.add(m);
  });
  [[-5, 8], [5, 8]].forEach(([dx, dz]) => {
    escape.add(makeBox(0.15, 3, 0.15, S2.xc + dx, ROOF.y + 1.5, ROOF.z0 + dz, metalMat));
    escape.add(makeBox(0.5, 0.2, 0.5, S2.xc + dx, ROOF.y + 3.1, ROOF.z0 + dz, fixtureMat));
    mazeFixtures.push(new THREE.Vector3(S2.xc + dx, ROOF.y + 3.1, ROOF.z0 + dz));
  });
  level3.add(escape);

  const lightPool = [0, 1, 2, 3].map(() => {
    const l = new THREE.PointLight(0xffc080, 8, 12);
    l.position.set(0, -50, 0);
    level3.add(l);
    return l;
  });
  let poolTimer = 0;
  function updateLightPool(dt, pos) {
    poolTimer -= dt;
    if (poolTimer > 0) return;
    poolTimer = 0.25;
    const sorted = mazeFixtures.map((f) => ({ f, d: Math.hypot(f.x - pos.x, f.z - pos.z) })).sort((a, b) => a.d - b.d);
    lightPool.forEach((l, i) => l.position.set(sorted[i].f.x, sorted[i].f.y - 0.3, sorted[i].f.z));
  }

  // ============ GUARDS ============
  // Two at the checkpoint, sweeping in mirror image: they look AWAY from the doorway at the same
  // moment, which is the window the player has to find. Crouch or crawl to shrink their range.
  const template = getGuardTemplate();
  const guards = [];
  const addGuard = (x, z, opts) => { const g = new VaultGuard(level3, x, z, { template, ...opts }); guards.push(g); return g; };
  addGuard(-2.6, 1.8, { baseYaw: Math.PI, sweep: 0.66, period: 6, phase: 0 });
  addGuard( 2.6, 1.8, { baseYaw: Math.PI, sweep: 0.66, period: 6, phase: Math.PI });

  // ============ colliders ============
  const colliders = [];
  level3.traverse((obj) => {
    if (!obj.isMesh) return;
    if (obj.material === wallMat || obj.name.startsWith('collider_')) colliders.push(obj);
  });
  scene.add(level3);

  // ============ navigation + reinforcements ============
  level3.updateMatrixWorld(true);
  const nav = new NavGrid(colliders, { x0: -8, x1: E2.x1 + 1, z0: -5, z1: ROOF.z1 + 1 }, { floorHeight: getWalkHeight });
  const chaseCtx = { nav, floorHeight: getWalkHeight };
  let fieldAge = 99, fieldCell = -1;
  function ensureField(pos, dt) {
    fieldAge += dt;
    const pc = nav.idx(pos.x, pos.z);
    if ((pc !== fieldCell && fieldAge > 0.15) || fieldAge > 0.5) { nav.computeField(pos.x, pos.z); fieldCell = pc; fieldAge = 0; }
  }

  // Reinforcements appear BEHIND the player. The first wave comes from the far start room, so you get a
  // real head start across the tile floor; once you're in the maze they drop in at its entry, then at the
  // top of each staircase.
  const spawnSections = [
    { when: () => true,                pts: [new THREE.Vector3(-1.2, 0, -3.2), new THREE.Vector3(1.2, 0, -3.2)] },
    { when: (p) => p.z >= VZ1 + 1,     pts: [new THREE.Vector3(0, 0, VZ1 + 1.6)] },
    { when: (p) => p.x >= E2.x0,       pts: [new THREE.Vector3(E2.x0 + 1.5, E2.y, S1.zc)] },
    { when: (p) => p.z >= S2.z0,       pts: [new THREE.Vector3(S2.xc, E2.y, E2.z1 - 1.2)] },
  ];
  const pickSpawn = (player, idx = 0) => {
    let s = 0;
    spawnSections.forEach((sec, i) => { if (sec.when(player)) s = i; });
    let pts = spawnSections[s].pts;
    // never pop a guard into the player's lap - fall back to the previous section
    while (s > 0 && Math.hypot(pts[0].x - player.x, pts[0].z - player.z) < 7) { s--; pts = spawnSections[s].pts; }
    return pts[idx % pts.length].clone();
  };

  // ============ runtime ============
  const raycaster = new THREE.Raycaster();
  const state = {
    alert: false, vaultAlarmed: false, hintShown: false, health: MAX_HP,
    pastCheckpoint: false, pastCorridor: false,
    locks: [false, false, false], clues: [false, false, false],
    vaultOpen: false, pathLit: false, wrongSteps: 0,
    hasItem: false, stealProgress: 0, noteRead: { lock: false, clue: false },
    dying: null, checkpoint: null, waveTimer: 0, roofLine: false,
  };
  let meterMax = 0;
  let firstT = null;
  let eHeld = false;
  let flashT = 0;

  const ui = createHud();
  const puzzles = createPuzzleUI((open, relock) => H.onUiChange(open, relock));

  const force = createGuardForce({
    scene: level3, nav, getTemplate: () => getGuardTemplate(), spawnPoints: [], pickSpawn,
    floorHeight: getWalkHeight, colliders,
    shoot: { range: 17, interval: 1.5, damage: 9, speed: 24, spread: 0.07 },
    onPlayerHit: (dmg) => damagePlayer(dmg),
    onShot: () => sfx('shot'),
    manageField: false,                 // this level owns the flow field (shared with the checkpoint guards)
  });
  force.setShooting(false);             // they only open fire once the artifact is stolen

  function refreshTracker() {
    const lockN = state.locks.filter(Boolean).length, clueN = state.clues.filter(Boolean).length;
    const resetsLeft = Math.max(0, MAX_WRONG - 1 - state.wrongSteps);
    ui.setTracker([
      { text: 'Get past the checkpoint guards', done: state.pastCheckpoint },
      { text: 'Cross the trap corridor', done: state.pastCorridor },
      { text: `Release the 3 vault locks (${lockN}/3)`, done: state.vaultOpen,
        sub: state.noteRead.lock ? `Note - lock keypad: ${codes.lock}` : (state.vaultOpen ? '' : 'Hint: a note was left in the first room') },
      { text: 'Cross the tile floor and steal the artifact', done: state.hasItem,
        sub: state.vaultOpen && !state.hasItem ? `Wrong-tile resets left: ${resetsLeft} - after that the floor collapses` : '' },
      { text: 'Escape to the rooftop - follow the map', done: false },
      { text: `Decode the archive terminals (${clueN}/3) - lights the safe path`, done: state.pathLit, optional: true,
        sub: state.noteRead.clue ? `Note - archive keypad: ${codes.clue}` : '' },
    ]);
  }

  function setAlert(why) {
    if (state.alert) return;
    state.alert = true;
    guards.forEach((g) => g.alert());
    H.onSubtitle(why, 3500);
  }

  // ---------- death + checkpoints ----------
  function die(reason, msg) {
    if (state.dying) return;
    state.dying = { t: reason === 'collapse' ? 1.1 : 0.25, msg };
    ui.setHold(null);
    state.stealProgress = 0;
  }
  function damagePlayer(amount) {
    if (state.dying) return;
    state.health = Math.max(0, state.health - amount);
    ui.setHealth(state.health / MAX_HP, true);
    ui.hitFlash();
    sfx('hit');
    if (state.health <= 0) die('shot', 'Security shot you down.');
  }
  function snapshotAt(p, name) {
    // Puzzle progress (locks, clues, notes, lit path) is NEVER rolled back - dying on the tile floor must not
    // make you redo the puzzles. Only the theft is: reload a checkpoint from before it and the artifact is back.
    return { name, pos: p.clone(), hasItem: state.hasItem };
  }
  const reached = { ante: false, escape: false, stairs: false };
  function saveCheckpoint(name, p, line) {
    state.checkpoint = snapshotAt(p, name);
    H.onSubtitle('Checkpoint reached.', 2500);
    sfx('unlock');
    if (line) H.line(line, 4000);
  }

  // ---------- doors ----------
  function setDoorSolid(door, solid) {
    if (door.solid === solid) return;
    door.solid = solid;
    if (solid) { if (!colliders.includes(door.mesh)) colliders.push(door.mesh); H.addCollider(door.mesh); }
    else { const i = colliders.indexOf(door.mesh); if (i >= 0) colliders.splice(i, 1); H.removeCollider(door.mesh); }
    nav.rebuild(colliders);   // guards path through (or around) it now
  }
  function setDoor(door, open, instant = false) {
    door.target = open ? 1 : 0;
    if (instant) { door.t = door.target; door.mesh.position.y = DOOR_H / 2 + door.t * DOOR_H; setDoorSolid(door, !open); }
  }
  function updateDoor(door, dt) {
    if (door.t !== door.target) {
      door.t = Math.max(0, Math.min(1, door.t + Math.sign(door.target - door.t) * dt / 1.2));
      door.mesh.position.y = DOOR_H / 2 + door.t * DOOR_H;
    }
    setDoorSolid(door, door.t < 0.7);
  }

  // ---------- tile floor ----------
  const tileCell = (x, z) => {
    const c = Math.floor((x - TX0) / TILE), r = Math.floor((z - TZ0) / TILE);
    return (c >= 0 && c < T_COLS && r >= 0 && r < T_ROWS) ? tileAt(c, r) : null;
  };
  function updateTileVisuals(dt) {
    if (flashT > 0) {
      flashT = Math.max(0, flashT - dt);
      glowMat.emissiveIntensity = flashT > 1 ? 1.8 : 1.8 * flashT;   // fades out over the last second
    }
    tiles.forEach((t) => {
      if (t.collapsed) {
        t.vy += 18 * dt; t.mesh.position.y -= t.vy * dt; t.mesh.rotation.x += dt * 1.5;
        if (t.mesh.position.y < PIT_Y - 1) t.mesh.visible = false;
        return;
      }
      t.redT = Math.max(0, t.redT - dt);
      t.mesh.material = t.isPed ? platformMat : t.redT > 0 ? wrongMat
        : (t.isPath && flashT > 0) ? glowMat : (t.isPath && state.pathLit) ? litMat : tileMat;
    });
  }
  function resetTiles() {
    tiles.forEach((t) => { t.collapsed = false; t.vy = 0; t.redT = 0; t.mesh.visible = true; t.mesh.rotation.set(0, 0, 0); t.mesh.position.y = -0.06; });
    flashT = 0;
  }
  function stepOnTile(tile, pos) {
    if (tile.isPed || tile.isPath || tile.collapsed || state.dying) return;
    state.wrongSteps++;
    tile.redT = 1.6;
    sfx('denied');
    if (state.wrongSteps >= MAX_WRONG) {
      tiles.forEach((t) => { if (!t.isPed && Math.abs(t.c - tile.c) <= 1 && Math.abs(t.r - tile.r) <= 1) t.collapsed = true; });
      H.onSubtitle('The floor gives way!', 2500);
      die('collapse', 'The floor collapsed under you.');
    } else {
      const resetsLeft = MAX_WRONG - 1 - state.wrongSteps;
      pos.set(TILE_START.x, 0, TILE_START.z);
      H.onSubtitle(resetsLeft === 0 ? 'Wrong tile - sent back. LAST CHANCE: the next wrong step collapses the floor!'
        : `Wrong tile - the floor sensors sent you back. ${resetsLeft} reset left.`, 4000);
      refreshTracker();
    }
  }
  // Floor height as the PLAYER experiences it: stairs, plus the pit where tiles have fallen away.
  function getFloorHeight(x, z) {
    const t = tileCell(x, z);
    return (t && t.collapsed) ? PIT_Y - 1 : getWalkHeight(x, z);
  }

  // ---------- puzzles: locks + clues ----------
  function openVault() {
    state.vaultOpen = true;
    setDoor(vaultDoor, true);
    sfx('unlock');
    flashT = FLASH_TIME;
    H.onSubtitle('Vault open - WATCH THE FLOOR. The safe path will flash once.', 5000);
    H.line('l3VaultOpen', 5000);
    refreshTracker();
  }
  function solveStation(st) {
    st.solved = true;
    st.mat.color.setHex(0x33ff88); st.mat.emissive.setHex(0x33ff88);
    sfx('unlock');
    if (st.kind === 'lock') {
      state.locks[st.n] = true;
      lampMats[st.n].color.setHex(0x33ff88); lampMats[st.n].emissive.setHex(0x33ff88);
      const n = state.locks.filter(Boolean).length;
      if (n === 3) openVault(); else H.onSubtitle(`Lock released (${n}/3).`, 2500);
    } else {
      state.clues[st.n] = true;
      const n = state.clues.filter(Boolean).length;
      flashT = FLASH_TIME;
      if (n === 3) { state.pathLit = true; H.onSubtitle('All archive terminals decoded - the safe path is now permanently lit.', 5000); }
      else H.onSubtitle(`Floor sensors recalibrated (${n}/3) - watch the vault floor through the window!`, 4000);
    }
    refreshTracker();
  }
  function openStation(st) {
    if (st.solved) { H.onSubtitle('Already done.', 1500); return; }
    const done = () => solveStation(st), hard = st.kind === 'clue';
    if (st.puzzle === 'keypad') {
      puzzles.keypad({
        title: st.label.toUpperCase(),
        sub: (hard ? state.noteRead.clue : state.noteRead.lock) ? undefined : 'No code on file. Someone left it on a note somewhere...',
        code: hard ? codes.clue : codes.lock, onSolve: done,
      });
    } else if (st.puzzle === 'wires') puzzles.wires({ title: st.label.toUpperCase(), count: hard ? 6 : 4, onSolve: done });
    else puzzles.simon({ title: st.label.toUpperCase(), length: hard ? 7 : 4, onSolve: done });
  }

  const notes = [
    { key: 'lock', x: -1.2, z: -1.6, msg: () => `Sticky note: "Vault lock keypad - ${codes.lock.split('').join(' ')}"` },
    { key: 'clue', x: -2.0, z: 12.3, msg: () => `Scrawled note: "Archive keypad - ${codes.clue.split('').join(' ')}"` },
  ];
  const nearXZ = (p, x, z, r) => Math.hypot(p.x - x, p.z - z) <= r;
  const PED = new THREE.Vector3(PED_X, 0, ITEM_Z);

  function stealItem() {
    state.hasItem = true;
    state.stealProgress = 0;
    vaultItem.visible = false;
    ui.setHold(null);
    sfx('pickup');
    setDoor(exitDoor, true);
    force.setShooting(true);
    ui.setHealth(state.health / MAX_HP, true);
    refreshTracker();
    H.onObjectiveComplete();      // main.js: game.objectiveComplete = true (the update loop below springs the alarm)
  }

  // ---------- reload a checkpoint ----------
  function respawn(pos) {
    const cp = state.checkpoint;
    const why = state.dying && state.dying.msg ? state.dying.msg + ' ' : '';
    force.clear();
    guards.forEach((g) => g.reset());
    resetTiles();
    plates.forEach((p) => { p.tripped = false; p.mat.color.setHex(0xffaa00); p.mat.emissive.setHex(0xffaa00); p.mat.emissiveIntensity = 0.6; });
    state.hasItem = cp.hasItem;
    state.alert = false; state.wrongSteps = 0; state.stealProgress = 0; state.health = MAX_HP; state.dying = null;
    state.vaultOpen = state.locks.every(Boolean);
    stations.forEach((st) => {
      st.solved = st.kind === 'lock' ? state.locks[st.n] : state.clues[st.n];
      const col = st.solved ? 0x33ff88 : (st.kind === 'lock' ? 0xffaa33 : 0x33aaff);
      st.mat.color.setHex(col); st.mat.emissive.setHex(col);
    });
    lampMats.forEach((m, i) => { const c = state.locks[i] ? 0x33ff88 : 0xff3333; m.color.setHex(c); m.emissive.setHex(c); });
    setDoor(vaultDoor, state.vaultOpen, true);
    setDoor(exitDoor, state.hasItem, true);
    vaultItem.visible = !state.hasItem;
    force.setShooting(state.hasItem);
    state.vaultAlarmed = state.hasItem;
    if (state.hasItem) {                       // the alarm is still ringing: guards arrive after a short head start
      H.game.escapeTimeRemaining = null;
      force.request(3, 6);
      state.waveTimer = WAVE_EVERY;
    } else {                                   // back before the theft: the vault is quiet again
      H.clearAlarm();
      H.game.objectiveComplete = false;
      vaultSpot.color.setHex(0xfff0d0); vaultSpot.intensity = 30;
    }
    ui.setHealth(1, state.hasItem);
    fieldAge = 99;
    pos.set(cp.pos.x, getWalkHeight(cp.pos.x, cp.pos.z), cp.pos.z);
    ui.fadeFromBlack();
    H.onSubtitle(`${why}Checkpoint reloaded.`, 3000);
    refreshTracker();
  }

  // ---------- escape map HUD ----------
  const mapFloors = [
    { name: 'FLOOR 1', maze: maze1, x0: E1.x0, z0: E1.z0, route: route1, open: e1Open },
    { name: 'FLOOR 2', maze: maze2, x0: E2.x0, z0: E2.z0, route: route2, open: e2Open },
  ];
  function drawMap(pos) {
    const ctx = ui.ctx;
    if (!ctx) { ui.setMapVisible(true); return; }
    const fl = (pos.x >= E2.x0 - 0.1 || pos.z >= E2.z1) ? mapFloors[1] : mapFloors[0];
    const k = MAP_W / MAZE_W, c = MAZE_CELL, m = fl.maze;
    // Top-down, north (+z) up. Looking down at the floor with +z up puts +x on the LEFT, so x is mirrored:
    // walking up the map, your right hand is on the right of the map.
    const px = (x) => (fl.x0 + MAZE_W - x) * k, pz = (z) => MAP_H - (z - fl.z0) * k;
    ctx.clearRect(0, 0, MAP_W, MAP_H);
    ctx.strokeStyle = '#4aa8d8'; ctx.lineWidth = 2; ctx.beginPath();
    for (let j = 0; j <= m.rows; j++) for (let i = 0; i < m.cols; i++) if (m.hW[i][j]) {
      ctx.moveTo(px(fl.x0 + i * c), pz(fl.z0 + j * c)); ctx.lineTo(px(fl.x0 + (i + 1) * c), pz(fl.z0 + j * c));
    }
    for (let i = 0; i <= m.cols; i++) for (let j = 0; j < m.rows; j++) if (m.vW[i][j]) {
      ctx.moveTo(px(fl.x0 + i * c), pz(fl.z0 + j * c)); ctx.lineTo(px(fl.x0 + i * c), pz(fl.z0 + (j + 1) * c));
    }
    ctx.stroke();
    ctx.strokeStyle = '#ffae3d'; ctx.lineWidth = 3; ctx.setLineDash([6, 4]); ctx.beginPath();
    const ctr = (cc, rr) => [px(fl.x0 + (cc + 0.5) * c), pz(fl.z0 + (rr + 0.5) * c)];
    const edge = (o) => {
      const [cc, rr] = openingCell(m, o), [x, y] = ctr(cc, rr), h = c * k / 2;
      return o.side === 'S' ? [x, y + h] : o.side === 'N' ? [x, y - h] : o.side === 'W' ? [x + h, y] : [x - h, y];
    };
    const [sx, sy] = edge(fl.open[0]);
    ctx.moveTo(sx, sy);
    fl.route.forEach(([cc, rr]) => { const [x, y] = ctr(cc, rr); ctx.lineTo(x, y); });
    const [ex, ey] = edge(fl.open[1]);
    ctx.lineTo(ex, ey); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#6dff9a'; ctx.beginPath(); ctx.arc(ex, ey, 5, 0, 6.3); ctx.fill();    // stairs up
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(px(pos.x), pz(pos.z), 4, 0, 6.3); ctx.fill();
    ui.setMapVisible(true, 'ESCAPE MAP - ' + fl.name);
  }
  let mapAcc = 0;

  // ---------- interaction (E) ----------
  const nearestInteractable = (pos) => {
    if (state.dying) return null;
    for (const st of stations) if (nearXZ(pos, st.ix, st.iz, 1.6)) return { type: 'station', st };
    for (const n of notes) if (nearXZ(pos, n.x, n.z, 1.7)) return { type: 'note', n };
    if (!state.hasItem && state.vaultOpen && nearXZ(pos, PED.x, PED.z, 2.2)) return { type: 'item' };
    return null;
  };
  const missions = {
    isUiOpen: () => puzzles.isOpen(),
    getPrompt(pos) {
      const it = nearestInteractable(pos);
      if (!it) return null;
      if (it.type === 'station') return it.st.solved ? null : `[E] ${it.st.label}`;
      if (it.type === 'note') return '[E] Read the note';
      return '[Hold E] Take the artifact';
    },
    interact(pos) {
      const it = nearestInteractable(pos);
      if (!it) return false;
      if (it.type === 'station') { openStation(it.st); return true; }
      if (it.type === 'note') { state.noteRead[it.n.key] = true; H.onSubtitle(it.n.msg(), 7000); refreshTracker(); return true; }
      return false;   // taking the artifact is hold-to-use, handled in update()
    },
    // main.js calls this first each frame; we only need the E-key state from it (update() does the rest)
    update(dt, elapsed, pos, held) { eHeld = !!held; },
  };

  // start of the level is checkpoint 0
  state.checkpoint = snapshotAt(new THREE.Vector3(0, 0, -2.5), 'start');
  refreshTracker();

  function update(dt, t, pos, stance = 'stand') {
    if (firstT === null) firstT = t;
    const height = STANCE_HEIGHT[stance] ?? 1.8;

    updateTileVisuals(dt);
    updateDoor(vaultDoor, dt);
    updateDoor(exitDoor, dt);
    updateLightPool(dt, pos);

    // artifact: spin + bob (the hologram pulses once the vault alarm is ringing)
    holoMat.uniforms.uPulse.value = state.vaultAlarmed ? 1 : 0;
    if (!state.hasItem) {
      vaultItem.rotation.y = t * 0.9;
      vaultItem.position.y = 1.35 + Math.sin(t * 1.6) * 0.06;
    }

    // dying: let a collapse play out, then reload the checkpoint
    if (state.dying) {
      state.dying.t -= dt;
      if (state.dying.t <= 0) respawn(pos);
      return;
    }

    // one-time hint, shown after the "Level 3" banner has gone
    if (!state.hintShown && t - firstT > 4.5) {
      state.hintShown = true;
      H.onSubtitle('Lasers: crouch (Ctrl) under high beams, crawl (C) under low ones, or wait for them to switch off.', 6000);
    }

    // progress + checkpoints
    if (!state.pastCheckpoint && pos.z > 4) { state.pastCheckpoint = true; refreshTracker(); }
    if (!state.pastCorridor && pos.z > 24) { state.pastCorridor = true; refreshTracker(); }
    if (!reached.ante && pos.z > 25.5 && pos.z < VZ0) { reached.ante = true; saveCheckpoint('ante', new THREE.Vector3(0, 0, 25.5)); }
    if (!reached.escape && state.hasItem && pos.z > VZ1 + 1.5 && pos.x < E1.x1) { reached.escape = true; saveCheckpoint('escape', new THREE.Vector3(0, 0, VZ1 + 1.8)); }
    if (!reached.stairs && state.hasItem && pos.x > E2.x0 + 1.2 && pos.z < E2.z1) {
      reached.stairs = true; saveCheckpoint('stairs', new THREE.Vector3(E2.x0 + 1.5, E2.y, S1.zc), 'l3Stairs');
    }

    // --- lasers: lethal while (t + phase) mod period < onTime (same formula the shader draws)
    for (const L of lasers) {
      const { period, onTime, phase, z, ys } = L.def;
      const c = (((t + phase) % period) + period) % period;
      const lethal = c >= 0.05 && c < onTime - 0.08;
      L.emitMat.emissiveIntensity = lethal ? 3.0 : (c > period - 0.7 ? 1.2 : 0.15);   // lit / warning / dark
      if (lethal && Math.abs(pos.z - z) < 0.28 && ys.some((y) => y < height)) {
        sfx('denied');
        die('laser', 'Laser tripwire.');
        return;
      }
    }

    // --- pressure plates wake the guards
    for (const p of plates) {
      if (p.tripped) continue;
      if (Math.hypot(pos.x - p.x, pos.z - p.z) < PLATE_RADIUS) {
        p.tripped = true;
        p.mat.color.setHex(0xff2222); p.mat.emissive.setHex(0xff2222); p.mat.emissiveIntensity = 1.4;
        sfx('denied');
        setAlert('Pressure plate! The guards are coming.');
      }
    }

    // --- the tile floor
    if (pos.z > TZ0 && pos.z < TZ1 && Math.abs(pos.x) < tileGridW / 2) {
      const tl = tileCell(pos.x, pos.z);
      if (tl) stepOnTile(tl, pos);
      if (state.dying) return;
    }

    // --- hold E to take the artifact
    const atPed = !state.hasItem && state.vaultOpen && nearXZ(pos, PED.x, PED.z, 2.2);
    if (atPed && eHeld) {
      state.stealProgress = Math.min(1, state.stealProgress + dt / STEAL_TIME);
      ui.setHold(state.stealProgress);
      if (state.stealProgress >= 1) stealItem();
    } else if (state.stealProgress > 0 && !state.hasItem) {
      state.stealProgress = Math.max(0, state.stealProgress - dt * 1.5);
      ui.setHold(state.stealProgress > 0 ? state.stealProgress : null);
    }

    // --- guards: checkpoint sweepers (and anything chasing) share one flow field to the player
    if (state.alert || force.count > 0) ensureField(pos, dt);
    meterMax = 0;
    for (const g of guards) {
      g.update(dt, t, pos, stance, raycaster, colliders,
        () => die('caught', 'A vault guard caught you.'),
        () => setAlert('Spotted! Guards are converging on you.'),
        chaseCtx);
      if (state.dying) return;
      meterMax = Math.max(meterMax, Math.min(1, g.meter));
    }

    // --- the artifact is gone: alarm, red strobe, then security floods in behind you and shoots
    if (state.hasItem && !state.vaultAlarmed) {
      state.vaultAlarmed = true;
      H.triggerAlarm('vault');
      H.game.escapeTimeRemaining = null;            // no extraction clock: the maze, the stairs and the guards are the pressure
      // (the checkpoint sweepers stay at their posts: security comes up behind you instead, see the waves below)
      H.onSubtitle('ALARM! Follow the escape map to the roof!', 4500);
      vaultSpot.color.setHex(0xff2a1a);
      force.request(3, 4);
      state.waveTimer = WAVE_EVERY;
    }
    if (state.vaultAlarmed) {
      vaultSpot.intensity = 30 + 18 * Math.max(0, Math.sin(t * 8));   // strobing red
      state.waveTimer -= dt;
      if (state.waveTimer <= 0) { force.request(1, 0.5); state.waveTimer = WAVE_EVERY; }
    }
    force.update(dt, pos, FORCE_SPEED, () => die('caught', 'Security caught you.'), height);
    if (state.dying) return;

    // --- escape map + the rooftop
    if (state.hasItem && pos.z >= VZ1) {
      mapAcc += dt;
      if (mapAcc > 0.1) { mapAcc = 0; if (pos.z < ROOF.z0) drawMap(pos); else ui.setMapVisible(false); }
    } else ui.setMapVisible(false);
    if (!state.roofLine && state.hasItem && pos.y > ROOF.y - 0.5) { state.roofLine = true; H.line('l3Roof', 5000); }
  }

  function dispose() {
    ownMaterials.forEach((m) => m.dispose());
    guards.forEach((g) => { g.coneMat.dispose(); if (g.mixer) { g.mixer.stopAllAction(); g.mixer.uncacheRoot(g.body); } });
    force.dispose();
    puzzles.dispose();
    ui.dispose();
    [tileGeo, doorGeo, squadGeo].forEach((geo) => geo.dispose());
    if (vaultSpot.shadow.map) vaultSpot.shadow.map.dispose();
    scene.remove(level3);
  }

  return {
    root: level3,
    colliders,
    lightFixturePositions,
    dramaticFixturePositions,
    entryPosition: new THREE.Vector3(0, 0, -2.5),
    exitPosition: EXIT_POS,                         // the rooftop, beside the squad
    vaultItemPosition: new THREE.Vector3(PED_X, 1.2, ITEM_Z),
    missions,                                       // puzzles, notes, hold-to-take artifact
    update,
    getFloorHeight,                                 // main.js uses this so the stairs work
    dispose,
    // 0..1 how alarmed the wing is (drives the music intensity)
    get threat() { return H.game.alarmActive ? 1 : state.alert ? 0.65 : meterMax * 0.5; },
    state,
    debug: { solveStation: (id) => solveStation(stations.find((s) => s.id === id)), safePath, codes, route1, route2, nav, force, E1, E2, S1, S2, ROOF, TILE_START, tileX, tileZ, stations, tiles, guards, vaultDoor, exitDoor, PED, colliders },
  };
}