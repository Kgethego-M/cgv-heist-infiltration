import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { getGuardTemplate } from '../ai/guards.js';
import {
  createLaserMaterial, createHologramMaterial, createVisionConeMaterial, createFanGeometry,
} from '../fx/shaders.js';

// ============================================================
// LEVEL 3 - Vault Wing
// What this level does that the others don't:
//   Level 1 = human patrol timing + disguise.   Level 2 = cameras + puzzles.
//   Level 3 = BODY-STANCE STEALTH against physical traps. Laser gates sit at different
//   heights and switch on and off, so standing / crouching / crawling decides which beams
//   can hit you. Guards see less far when you stay low, pressure plates wake the whole
//   wing, and lifting the artifact springs a final alarm and reinforcements.
//
// Checkpoint (sweeping guards) -> Trap Corridor (lasers + plates) ->
// Antechamber (calm beat) -> Vault (artifact; extraction lift by the door).
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
const DOOR_Z = [4, 24, 31];   // doorways guards route through (rooms are rectangles)

function makeFloor(width, depth, x, z) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), floorMat);
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0, z); return m;
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

const _beamGeo = new THREE.PlaneGeometry(1, 0.55);
const _emitterGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
const _stripGeo = new THREE.PlaneGeometry(4.9, 0.4);   // glowing floor strip under each gate: the danger zone
const _plateGeo = new THREE.BoxGeometry(0.8, 0.05, 0.8);
const _fanGeo = createFanGeometry(GUARD.RANGE, GUARD.HALF_ANGLE, 20);
const _from = new THREE.Vector3(), _to = new THREE.Vector3(), _dir = new THREE.Vector3();

// ---- guard -----------------------------------------------------------------
// Hierarchy: guard group (position + yaw) -> character mesh + vision-fan mesh.
// The fan is a CHILD of the guard, so it turns with the guard for free (scene-graph parenting).
class VaultGuard {
  constructor(parent, x, z, { baseYaw = 0, sweep = 0.65, period = 6, phase = 0, chase = false, template }) {
    this.baseYaw = baseYaw; this.sweep = sweep; this.period = period; this.phase = phase;
    this.state = chase ? 'chase' : 'scan';
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
    if (chase) this.fan.visible = false;

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

  update(dt, t, pos, stance, raycaster, colliders, onCatch, onSpot) {
    if (this.mixer) this.mixer.update(dt);
    const g = this.group.position;
    const dx = pos.x - g.x, dz = pos.z - g.z;
    const dist = Math.hypot(dx, dz) || 0.0001;

    if (this.state === 'chase') {
      if (dist < GUARD.CATCH) { onCatch(); return; }
      let tx = pos.x, tz = pos.z;
      if (pos.z > g.z) {
        for (const d0 of DOOR_Z) if (d0 > g.z + 0.3 && d0 < pos.z) { tx = 0; tz = d0; break; }
      } else {
        for (let i = DOOR_Z.length - 1; i >= 0; i--) { const d0 = DOOR_Z[i]; if (d0 < g.z - 0.3 && d0 > pos.z) { tx = 0; tz = d0; break; } }
      }
      const mx = tx - g.x, mz = tz - g.z, ml = Math.hypot(mx, mz) || 0.0001;
      const step = Math.min(GUARD.CHASE_SPEED * dt, ml);
      g.x += (mx / ml) * step; g.z += (mz / ml) * step;
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

// ---- level -----------------------------------------------------------------
export function createLevel3(scene, hooks = {}) {
  const H = {
    game: { alarmActive: false, objectiveComplete: false, escapeTimeRemaining: null },
    onSubtitle: () => {}, onCaught: () => {}, triggerAlarm: () => {}, sfx: {},
    ...hooks,
  };
  const ownMaterials = [];
  const track = (m) => { ownMaterials.push(m); return m; };

  const level3 = new THREE.Group();
  level3.name = 'Level3';
  const lightFixturePositions = [];
  const dramaticFixturePositions = [];
  const CEILING_HEIGHT = 4;

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
  level3.add(corridor);

  // ============ ANTECHAMBER (calm beat) ============  x -3..3, z 24..30
  const antechamber = new THREE.Group();
  antechamber.name = 'Antechamber';
  antechamber.add(makeFloor(6, 6, 0, 27));
  antechamber.add(makeWall(2, 4, 0.2, -2, 2, 24));
  antechamber.add(makeWall(2, 4, 0.2, 2, 2, 24));
  antechamber.add(makeWall(2, 4, 0.2, -2, 2, 30));
  antechamber.add(makeWall(2, 4, 0.2, 2, 2, 30));
  antechamber.add(makeWall(6, 4, 0.2, -3, 2, 27, Math.PI / 2));
  antechamber.add(makeWall(6, 4, 0.2, 3, 2, 27, Math.PI / 2));
  antechamber.add(makeCeiling(6, 6, 0, CEILING_HEIGHT, 27));
  antechamber.add(makeLightFixture(0, CEILING_HEIGHT, 27));
  lightFixturePositions.push(new THREE.Vector3(0, CEILING_HEIGHT, 27));
  antechamber.add(makeFloor(2, 2, 0, 31));            // link to the vault (closes the floor gap z 30..32)
  antechamber.add(makeWall(2, 4, 0.2, -1, 2, 31, Math.PI / 2));
  antechamber.add(makeWall(2, 4, 0.2, 1, 2, 31, Math.PI / 2));
  antechamber.add(makeCeiling(2, 2, 0, CEILING_HEIGHT, 31));
  level3.add(antechamber);

  // ============ VAULT ============  x -4..4, z 32..44
  const vault = new THREE.Group();
  vault.name = 'Vault';
  vault.add(makeFloor(8, 12, 0, 38));
  vault.add(makeWall(3, 4, 0.2, -2.5, 2, 32));
  vault.add(makeWall(3, 4, 0.2, 2.5, 2, 32));
  vault.add(makeWall(8, 4, 0.2, 0, 2, 44));
  vault.add(makeWall(12, 4, 0.2, -4, 2, 38, Math.PI / 2));
  vault.add(makeWall(12, 4, 0.2, 4, 2, 38, Math.PI / 2));
  vault.add(makeCeiling(8, 12, 0, CEILING_HEIGHT, 38));
  [[-3, 34], [3, 34], [-3, 43], [3, 43]].forEach(([x, z]) => {
    vault.add(makeLightFixture(x, CEILING_HEIGHT, z, 0.8, 0.8));
    lightFixturePositions.push(new THREE.Vector3(x, CEILING_HEIGHT, z));
  });
  const ITEM_Z = 41;
  vault.add(makeLightFixture(0, CEILING_HEIGHT, ITEM_Z, 1.5, 1.5, true));
  dramaticFixturePositions.push(new THREE.Vector3(0, CEILING_HEIGHT, ITEM_Z));

  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 1.0, 20), metalMat);
  pedestal.position.set(0, 0.5, ITEM_Z);
  pedestal.name = 'collider_pedestal';
  vault.add(pedestal);

  const holoMat = track(createHologramMaterial(0xffcc33));
  const vaultItem = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 2), holoMat);
  vaultItem.position.set(0, 1.35, ITEM_Z);
  vaultItem.name = 'marker_vaultItem';
  vault.add(vaultItem);

  // THE dramatic light: a shadow-casting spot straight onto the pedestal (tight shadow frustum).
  const spotTarget = new THREE.Object3D();
  spotTarget.position.set(0, 1, ITEM_Z);
  vault.add(spotTarget);
  const vaultSpot = new THREE.SpotLight(0xfff0d0, 30, 12, Math.PI / 6, 0.55, 2);
  vaultSpot.position.set(0, CEILING_HEIGHT - 0.2, ITEM_Z);
  vaultSpot.target = spotTarget;
  vaultSpot.castShadow = true;
  vaultSpot.shadow.mapSize.set(1024, 1024);
  vaultSpot.shadow.camera.near = 0.5;
  vaultSpot.shadow.camera.far = 6;
  vaultSpot.shadow.bias = -0.0008;
  vault.add(vaultSpot);

  // Extraction lift by the vault door. Reinforcements also come through that door,
  // so grabbing the artifact becomes a race back to it.
  const EXIT_POS = new THREE.Vector3(-2.8, 0, 34);
  const exitPad = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 2), exitMat);
  exitPad.position.set(EXIT_POS.x, 0.05, EXIT_POS.z);
  exitPad.name = 'marker_exit';
  vault.add(exitPad);
  level3.add(vault);

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

  // ============ runtime ============
  const raycaster = new THREE.Raycaster();
  const state = { alert: false, vaultAlarmed: false, reinforceTimer: -1, caught: false, hintShown: false };
  let meterMax = 0;
  let firstT = null;

  function setAlert(why) {
    if (state.alert) return;
    state.alert = true;
    guards.forEach((g) => g.alert());
    H.onSubtitle(why, 3500);
  }
  function caught(reason, msg) {
    if (state.caught) return;
    state.caught = true;
    H.onCaught(reason, msg);
  }

  function update(dt, t, pos, stance = 'stand') {
    if (state.caught) return;
    if (firstT === null) firstT = t;
    const height = STANCE_HEIGHT[stance] ?? 1.8;

    // one-time hint, shown after the "Level 3" banner has gone
    if (!state.hintShown && t - firstT > 4.5) {
      state.hintShown = true;
      H.onSubtitle('Lasers: crouch (Ctrl) under high beams, crawl (C) under low ones, or wait for them to switch off.', 6000);
    }

    // --- lasers: lethal while (t + phase) mod period < onTime (same formula the shader draws)
    for (const L of lasers) {
      const { period, onTime, phase, z, ys } = L.def;
      const c = (((t + phase) % period) + period) % period;
      const lethal = c >= 0.05 && c < onTime - 0.08;
      L.emitMat.emissiveIntensity = lethal ? 3.0 : (c > period - 0.7 ? 1.2 : 0.15);   // lit / warning / dark
      if (lethal && Math.abs(pos.z - z) < 0.28 && ys.some((y) => y < height)) {
        H.sfx.denied && H.sfx.denied();
        caught('laser', 'Laser tripwire - the wing locked down around you.');
        return;
      }
    }

    // --- pressure plates wake the guards
    for (const p of plates) {
      if (p.tripped) continue;
      if (Math.hypot(pos.x - p.x, pos.z - p.z) < PLATE_RADIUS) {
        p.tripped = true;
        p.mat.color.setHex(0xff2222); p.mat.emissive.setHex(0xff2222); p.mat.emissiveIntensity = 1.4;
        H.sfx.denied && H.sfx.denied();
        setAlert('Pressure plate! The guards are coming.');
      }
    }

    // --- guards
    meterMax = 0;
    for (const g of guards) {
      g.update(dt, t, pos, stance, raycaster, colliders,
        () => caught('caught', 'A vault guard caught you.'),
        () => setAlert('Spotted! Guards are converging on you.'));
      if (state.caught) return;
      meterMax = Math.max(meterMax, Math.min(1, g.meter));
    }

    // --- artifact: spin + alarm, red light and reinforcements through the vault door
    holoMat.uniforms.uPulse.value = state.vaultAlarmed ? 1 : 0;
    vaultItem.rotation.y = t * 0.9;
    vaultItem.position.y = 1.35 + Math.sin(t * 1.6) * 0.06;
    if (!state.vaultAlarmed && H.game.objectiveComplete) {
      state.vaultAlarmed = true;
      state.reinforceTimer = 1.8;
      H.triggerAlarm('vault');
      setAlert('ALARM! Get back to the extraction lift!');
      vaultSpot.color.setHex(0xff2a1a);
    }
    if (state.vaultAlarmed) {
      vaultSpot.intensity = 30 + 18 * Math.max(0, Math.sin(t * 8));   // strobing red
      if (state.reinforceTimer > 0) {
        state.reinforceTimer -= dt;
        if (state.reinforceTimer <= 0) {
          addGuard(-0.6, 25, { chase: true, baseYaw: 0 });
          addGuard( 0.6, 25.8, { chase: true, baseYaw: 0 });
        }
      }
    }

    // --- extraction clock (the alarm sets escapeTimeRemaining)
    if (H.game.alarmActive && H.game.escapeTimeRemaining != null) {
      H.game.escapeTimeRemaining -= dt;
      if (H.game.escapeTimeRemaining <= 0) {
        H.game.escapeTimeRemaining = 0;
        caught('timeout', 'The extraction window closed - vault security sealed the wing.');
      }
    }
  }

  function dispose() {
    ownMaterials.forEach((m) => m.dispose());
    guards.forEach((g) => { g.coneMat.dispose(); if (g.mixer) { g.mixer.stopAllAction(); g.mixer.uncacheRoot(g.body); } });
    if (vaultSpot.shadow.map) vaultSpot.shadow.map.dispose();
    scene.remove(level3);
  }

  return {
    root: level3,
    colliders,
    lightFixturePositions,
    dramaticFixturePositions,
    entryPosition: new THREE.Vector3(0, 0, -2.5),
    exitPosition: EXIT_POS,
    vaultItemPosition: new THREE.Vector3(0, 1.2, ITEM_Z),
    update,
    dispose,
    // 0..1 how alarmed the wing is (drives the music intensity)
    get threat() { return H.game.alarmActive ? 1 : state.alert ? 0.65 : meterMax * 0.5; },
  };
}
