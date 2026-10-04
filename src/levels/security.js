import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
// The ONE place that knows where guards.js lives — adjust this path if it differs.
import { getGuardTemplate, loadGuardModel, GuardB } from '../ai/guards.js';

export { getGuardTemplate, GuardB };

// Kicks off loading the shared guard model if nothing has loaded it yet (no-op otherwise).
export function ensureGuardModel(getTemplate = getGuardTemplate) {
  if (!getTemplate()) loadGuardModel().catch((e) => console.warn('Guard model failed to load:', e));
}

// Security tuning (shared by every level) — everything you'd want to tweak in one place.
export const SEC = {
  CAMERA_TIME: 3,        // "seconds" of exposure before a camera escalates...
  CAM_SEEN_RATE: 1.5,    // ...gained per real second while a cone is actually on you
  CAM_ZONE_RATE: 0.5,    // ...and per second while you're in its area but the cone is elsewhere
  LASER_COOLDOWN: 3,     // seconds before the same laser can trip again
  PLATE_COOLDOWN: 4,     // seconds before the same pressure plate can trip again
  MAX_LEVEL: 5,
  MAX_GUARDS: 10,        // total guards alive at once
  BASE_SPEED: 2.2,       // guard run speed at security level 1
  SPEED_PER_LEVEL: 0.2,  // extra speed per further level
};

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

export class NavGrid {
  // opts.floorHeight(x, z) lets multi-storey levels tell the grid which colliders are
  // "wall height" relative to the floor they stand on (upper-floor walls start above 1.4m).
  constructor(colliders, b, opts = {}) {
    const cell = NAV_CELL;
    this.cell = cell; this.x0 = b.x0; this.z0 = b.z0;
    this.nx = Math.ceil((b.x1 - b.x0) / cell);
    this.nz = Math.ceil((b.z1 - b.z0) / cell);
    const n = this.nx * this.nz;
    this.floorHeight = opts.floorHeight || null;
    this.blocked = new Uint8Array(n);
    this.dist = new Float32Array(n);
    this.heapD = new Float32Array(n * 8 + 8);
    this.heapI = new Int32Array(n * 8 + 8);
    this.heapN = 0;
    this._popD = 0;
    this.rebuild(colliders);
  }

  // Re-rasterise obstacles in place (call after a door opens/closes).
  rebuild(colliders) {
    const cell = this.cell, r = GUARD_RADIUS;
    this.blocked.fill(0);
    const box = new THREE.Box3();
    for (const m of colliders) {
      box.setFromObject(m);
      const base = this.floorHeight ? this.floorHeight((box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2) : 0;
      if (box.min.y - base > 1.4 || box.max.y - base < 0.3) continue;   // door lintels etc. don't block walking
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

export function createGuardForce({
  scene, nav, getTemplate, spawnPoints,
  pickSpawn = null,       // (player, index) -> Vector3 : overrides spawnPoints (e.g. "farthest hatch from the player")
  floorHeight = null,     // (x, z) -> y : lets guards climb stairs
  colliders = null,       // used for guard line-of-sight and bullet impacts
  shoot = null,           // { range, interval, damage, speed, spread } — omit for melee-only guards
  onPlayerHit = null,     // (damage) -> void
  onShot = null,          // () -> void (sound hook)
  manageField = true,     // false: the level calls nav.computeField itself (shared with its own guards)
}) {
  const guards = [];
  const bullets = [];
  const tgt = { x: 0, z: 0 };
  const cfg = shoot ? { range: 16, interval: 1.4, damage: 10, speed: 26, spread: 0.06, ...shoot } : null;
  const ray = new THREE.Raycaster();
  const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _t = new THREE.Vector3();
  const bulletGeo = new THREE.SphereGeometry(0.07, 8, 8);
  const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffd36a });
  let queue = 0, spawnTimer = 0, spawnGrace = 0, spawnIdx = 0;
  let fieldAge = 99, lastCell = -1;
  let shootOn = !!shoot;

  function setAction(g, name) {
    const next = g.actions[name];
    if (!next || g.current === next) return;
    if (g.current) g.current.fadeOut(0.25);
    next.reset().fadeIn(0.25).play();
    g.current = next;
  }

  function spawnOne(player) {
    const sp = pickSpawn ? pickSpawn(player, spawnIdx++) : spawnPoints[spawnIdx++ % spawnPoints.length];
    const vis = makeGuardVisual(getTemplate());
    const group = new THREE.Group();
    group.name = 'SecurityGuard';
    group.add(vis.body);
    const blockedHere = nav.isBlockedAt(sp.x, sp.z);
    const free = nav.nearestFree(nav.idx(sp.x, sp.z));
    group.position.set(blockedHere ? nav.cx(free) : sp.x, 0, blockedHere ? nav.cz(free) : sp.z);
    if (floorHeight) group.position.y = floorHeight(group.position.x, group.position.z);
    group.rotation.y = 0;
    scene.add(group);
    const g = { group, ...vis, current: null, shootTimer: 0.5 + Math.random() * (cfg ? cfg.interval : 1) };
    setAction(g, 'Idle');
    guards.push(g);
  }

  function fire(g, from, to) {
    _o.set(from.x, from.y + 1.5, from.z);
    _d.subVectors(to, _o);
    const dist = _d.length();
    _d.normalize();
    // spread widens with range so point-blank shots are lethal but long ones can be dodged
    const sp = cfg.spread * (0.5 + dist / cfg.range);
    _d.x += (Math.random() - 0.5) * 2 * sp;
    _d.y += (Math.random() - 0.5) * sp;
    _d.z += (Math.random() - 0.5) * 2 * sp;
    _d.normalize();
    const mesh = new THREE.Mesh(bulletGeo, bulletMat);
    mesh.position.copy(_o).addScaledVector(_d, 0.5);
    scene.add(mesh);
    bullets.push({ mesh, dir: _d.clone(), life: 2.2 });
    if (onShot) onShot();
  }

  function updateBullets(dt, player, playerH) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.life -= dt;
      let dead = b.life <= 0;
      if (!dead) {
        const step = cfg.speed * dt;
        if (colliders) {
          ray.set(b.mesh.position, b.dir);
          ray.far = step;
          if (ray.intersectObjects(colliders, false).length) dead = true;
        }
        if (!dead) {
          b.mesh.position.addScaledVector(b.dir, step);
          const px = b.mesh.position.x - player.x, pz = b.mesh.position.z - player.z;
          const py = b.mesh.position.y - (player.y || 0);
          if (px * px + pz * pz < 0.55 * 0.55 && py > 0.05 && py < playerH) {
            dead = true;
            if (onPlayerHit) onPlayerHit(cfg.damage);
          }
        }
      }
      if (dead) { scene.remove(b.mesh); bullets.splice(i, 1); }
    }
  }

  return {
    get count() { return guards.length + queue; },
    get guardList() { return guards; },
    get bulletCount() { return bullets.length; },
    isSpawning: () => queue > 0 || spawnGrace > 0,
    setShooting(on) { shootOn = !!on && !!cfg; },   // guards only open fire while this is on

    // Ask for n more guards (capped by SEC.MAX_GUARDS). Returns how many were accepted.
    request(n, delay = FIRST_SPAWN_DELAY) {
      const add = Math.max(0, Math.min(n, SEC.MAX_GUARDS - guards.length - queue));
      if (add > 0) {
        if (queue === 0) spawnTimer = delay;
        queue += add;
      }
      return add;
    },

    // Remove every guard and bullet (checkpoint respawn).
    clear() {
      guards.forEach((g) => { scene.remove(g.group); g.dispose(); });
      guards.length = 0;
      bullets.forEach((b) => scene.remove(b.mesh));
      bullets.length = 0;
      queue = 0; spawnGrace = 0; lastCell = -1; fieldAge = 99;
    },

    // playerH = how tall the player is right now (crouching/crawling dodges high shots)
    update(dt, player, speed, onCatch, playerH = 1.9) {
      if (queue > 0) {
        spawnTimer -= dt;
        if (spawnTimer <= 0) { spawnOne(player); queue--; spawnTimer = SPAWN_INTERVAL; spawnGrace = 1.4; }
      } else {
        spawnGrace = Math.max(0, spawnGrace - dt);
      }
      if (cfg) updateBullets(dt, player, playerH);
      if (!guards.length) return;

      if (manageField) {
        fieldAge += dt;
        const pc = nav.idx(player.x, player.z);
        if ((pc !== lastCell && fieldAge > 0.15) || fieldAge > 0.5) {
          nav.computeField(player.x, player.z);
          lastCell = pc; fieldAge = 0;
        }
      }

      for (const g of guards) {
        g.mixer?.update(dt);
        const p = g.group.position;
        const d = Math.hypot(player.x - p.x, player.z - p.z);
        if (d < CATCH_DIST && Math.abs((player.y || 0) - p.y) < 1.2) { onCatch(); return; }

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
        if (floorHeight) p.y += (floorHeight(p.x, p.z) - p.y) * Math.min(1, dt * 14);
        setAction(g, moving ? (g.actions.Run ? 'Run' : 'Walk') : 'Idle');

        // shooting: needs range + a clear line from the muzzle to the player's chest
        if (cfg && shootOn) {
          g.shootTimer -= dt;
          if (g.shootTimer <= 0 && d < cfg.range) {
            _o.set(p.x, p.y + 1.5, p.z);
            _t.set(player.x, (player.y || 0) + Math.min(1.1, playerH * 0.6), player.z);
            _d.subVectors(_t, _o);
            const dist = _d.length();
            _d.normalize();
            ray.set(_o, _d);
            ray.far = Math.max(0, dist - 0.3);
            const clear = !colliders || ray.intersectObjects(colliders, false).length === 0;
            if (clear) { fire(g, p, _t); g.shootTimer = cfg.interval * (0.7 + Math.random() * 0.6); }
            else g.shootTimer = 0.25;   // no line yet — look again shortly
          }
        }
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
      this.clear();
      bulletGeo.dispose(); bulletMat.dispose();
    },
  };
}
