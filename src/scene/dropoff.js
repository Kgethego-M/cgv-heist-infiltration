import * as THREE from 'three';
import { createSedan } from './sedan.js';

// ============================================================
// OPENING DROP-OFF CINEMATIC
//
// A self-contained night-exterior "stage" (road, sidewalk, lit building
// facade, street lamps, distant skyline, fog) plus the black sedan and a
// scripted multi-shot camera. It hides the interior level for the duration,
// plays the arrival, then hands control back to main.js with a fade-to-black.
//
//   createDropoff(opts) -> { start(), update(dt), skip(), active, dispose() }
//
// opts: { scene, camera, player, spawn, onFadeOut, onHandoff, onSubtitle }
//   spawn       interior player spawn the hand-off fades back into
//   onFadeOut   called once near the end — main starts the fade to black
//   onHandoff   called once at the end — main restores gameplay
//   onSubtitle  (text, ms) show an earpiece caption during the scene
// ============================================================

const BUILDING_FRONT_Z = -7.5;   // matches level1's lobby front wall
const ROAD_Z = -13.0;            // street centre-line the car drives along
const SIDEWALK_Z = -10.0;
const SIDEWALK_TOP = 0.16;       // sidewalk slab top — where feet must rest
const ENTRANCE_X = -1.5;         // decorative entrance doors on the facade
const START_X = 36;              // car enters from screen-right
const STOP_X = -2.0;             // pulls up beside the entrance
const T_STOP = 4.6;              // seconds until the car is parked
const T_FADE = 8.2;              // fade-to-black begins
const TOTAL = 8.9;               // hand-off to gameplay

function smoothstep(x) { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); }

// ---- procedural textures ---------------------------------------------------
function makeFacadeTexture(cols, rows, litChance) {
  const c = document.createElement('canvas');
  c.width = cols * 32; c.height = rows * 32;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b0e15'; ctx.fillRect(0, 0, c.width, c.height);
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x = col * 32 + 6, y = r * 32 + 6;
      const lit = Math.random() < litChance;
      if (lit) {
        const warm = Math.random() < 0.75;
        ctx.fillStyle = warm ? '#ffd9a0' : '#bfe0ff';
        ctx.globalAlpha = 0.5 + Math.random() * 0.5;
      } else {
        ctx.fillStyle = '#141a26'; ctx.globalAlpha = 1;
      }
      ctx.fillRect(x, y, 20, 22);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#05070c'; ctx.lineWidth = 2; ctx.strokeRect(x, y, 20, 22);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeAsphaltTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#15171b'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const v = 18 + Math.floor(Math.random() * 34);
    ctx.fillStyle = `rgba(${v},${v + 1},${v + 3},0.5)`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 6);
  return tex;
}

export function createDropoff(opts) {
  const { scene, camera, player, onFadeOut, onHandoff, onSubtitle } = opts;

  const stage = new THREE.Group();
  stage.name = 'DropoffStage';
  const lights = [];
  const disposables = [];

  // ---- saved scene state we temporarily override ---------------------------
  const saved = {
    background: scene.background ? scene.background.clone() : null,
    fog: scene.fog,
  };

  // ---- ground: road + sidewalk --------------------------------------------
  const asphaltTex = makeAsphaltTexture(); disposables.push(asphaltTex);
  const roadMat = new THREE.MeshStandardMaterial({ map: asphaltTex, color: 0x9aa0aa, roughness: 0.96, metalness: 0.0 });
  const road = new THREE.Mesh(new THREE.PlaneGeometry(90, 8), roadMat);
  road.rotation.x = -Math.PI / 2; road.position.set(0, 0.0, ROAD_Z);
  road.receiveShadow = true; stage.add(road);

  // dashed centre line
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xd8c98a, emissive: 0x2a2410, roughness: 0.8 });
  for (let x = -42; x <= 42; x += 5) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.18), lineMat);
    dash.rotation.x = -Math.PI / 2; dash.position.set(x, 0.012, ROAD_Z);
    stage.add(dash);
  }

  const walkMat = new THREE.MeshStandardMaterial({ color: 0x33363c, roughness: 0.92 });
  const sidewalk = new THREE.Mesh(new THREE.BoxGeometry(90, 0.16, 4.6), walkMat);
  sidewalk.position.set(0, 0.08, SIDEWALK_Z); sidewalk.receiveShadow = true;
  stage.add(sidewalk);

  // ---- building facade (stands in for the hidden interior) -----------------
  const facadeTex = makeFacadeTexture(16, 12, 0.34); disposables.push(facadeTex);
  const facadeMat = new THREE.MeshStandardMaterial({
    color: 0x2a2e38, roughness: 0.85, metalness: 0.05,
    emissiveMap: facadeTex, emissive: 0xffffff, emissiveIntensity: 1.15, map: facadeTex,
  });
  const facade = new THREE.Mesh(new THREE.BoxGeometry(24, 15, 1.2), facadeMat);
  facade.position.set(0, 7.5, BUILDING_FRONT_Z + 0.6);
  facade.receiveShadow = true; facade.castShadow = true;
  stage.add(facade);

  // side returns so the building has depth from an angle
  const sideMat = new THREE.MeshStandardMaterial({ color: 0x22252d, roughness: 0.9 });
  [-1, 1].forEach((s) => {
    const side = new THREE.Mesh(new THREE.BoxGeometry(1.2, 15, 10), sideMat);
    side.position.set(s * 12, 7.5, BUILDING_FRONT_Z + 5.5);
    stage.add(side);
  });

  // glowing entrance + canopy + sign
  const entranceMat = new THREE.MeshStandardMaterial({ color: 0x0a1a2a, emissive: 0x66b7ff, emissiveIntensity: 2.0, roughness: 0.4, side: THREE.DoubleSide });
  const entrance = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.4), entranceMat);
  entrance.position.set(ENTRANCE_X, 1.7, BUILDING_FRONT_Z - 0.02);
  stage.add(entrance);
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.24, 1.6), new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.6, metalness: 0.3 }));
  canopy.position.set(ENTRANCE_X, 3.6, BUILDING_FRONT_Z - 0.7); canopy.castShadow = true;
  stage.add(canopy);
  const signLight = new THREE.PointLight(0x88ccff, 10, 14); signLight.position.set(ENTRANCE_X, 3.2, BUILDING_FRONT_Z - 1.4);
  stage.add(signLight); lights.push(signLight);

  // ---- distant skyline -----------------------------------------------------
  const skyTex = makeFacadeTexture(10, 16, 0.22); disposables.push(skyTex);
  const skyMat = new THREE.MeshStandardMaterial({ color: 0x0c0f16, emissiveMap: skyTex, emissive: 0xffffff, emissiveIntensity: 0.55, map: skyTex, roughness: 1 });
  for (let i = 0; i < 12; i++) {
    const w = 5 + Math.random() * 7, h = 8 + Math.random() * 22;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), skyMat);
    const side = i % 2 === 0 ? -1 : 1;
    b.position.set(side * (22 + Math.random() * 30), h / 2, ROAD_Z - 12 - Math.random() * 24);
    stage.add(b);
  }

  // ---- street lamps --------------------------------------------------------
  // Lit the same way the game lights its ceiling fixtures: an emissive lens
  // mesh plus a warm PointLight at the same spot. No spotlights, no shadows.
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.6, metalness: 0.5 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffe6b0, emissive: 0xffd79a, emissiveIntensity: 4.5 });
  [-16, -9, -1, 8, 16].forEach((x) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 6.2, 10), poleMat);
    pole.position.set(x, 3.1, SIDEWALK_Z - 1.4); stage.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.1), poleMat);
    arm.position.set(x + 0.6, 6.1, SIDEWALK_Z - 1.4); stage.add(arm);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.36), lampMat);
    head.position.set(x + 1.2, 6.0, SIDEWALK_Z - 1.4); stage.add(head);
    const lamp = new THREE.PointLight(0xffd79a, 20, 24);
    lamp.position.set(x + 1.2, 5.8, SIDEWALK_Z - 1.0);
    stage.add(lamp); lights.push(lamp);
  });

  // ---- base fill -----------------------------------------------------------
  // Same technique as the game's AmbientLight: a dim base so unlit corners
  // aren't pure black, plus one broad cool "city glow" point light overhead so
  // the night street reads lit (there ARE street lights) without going daytime.
  const ambient = new THREE.AmbientLight(0x2c3c66, 1.15);
  stage.add(ambient); lights.push(ambient);
  const cityGlow = new THREE.PointLight(0x3a4c78, 14, 70);
  cityGlow.position.set(0, 14, ROAD_Z + 6);
  stage.add(cityGlow); lights.push(cityGlow);

  // ---- the car -------------------------------------------------------------
  const sedan = createSedan();
  sedan.group.rotation.y = Math.PI;   // model faces +X; flip so it drives toward -X
  sedan.group.position.set(START_X, 0, ROAD_Z);
  stage.add(sedan.group);

  scene.add(stage);

  // ---- scene atmosphere overrides -----------------------------------------
  scene.background = new THREE.Color(0x0e1522);
  scene.fog = new THREE.FogExp2(0x0e1522, 0.012);

  // ---- player placement during the walk-out --------------------------------
  // Feet rest ON the sidewalk slab (top y=0.16), not at road level, otherwise
  // the legs sink into the concrete when the player steps out of the car.
  const doorPos = new THREE.Vector3(STOP_X + 0.1, SIDEWALK_TOP, ROAD_Z + 1.5);
  const entrancePos = new THREE.Vector3(ENTRANCE_X, SIDEWALK_TOP, BUILDING_FRONT_Z - 1.0);
  player.model.visible = true;
  player.group.position.copy(doorPos);
  player.group.rotation.y = 0; // faces +Z (toward the building)
  player.group.visible = false;

  // ---- camera scratch ------------------------------------------------------
  const _pos = new THREE.Vector3();
  const _look = new THREE.Vector3();
  const focusPoint = new THREE.Vector3();  // current look target, read by main for DoF focus
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _c = new THREE.Vector3();
  const _d = new THREE.Vector3();

  function carX(t) {
    if (t >= T_STOP) return STOP_X;
    const u = t / T_STOP;
    const e = 1 - Math.pow(1 - u, 2.3); // decelerating approach
    return THREE.MathUtils.lerp(START_X, STOP_X, e);
  }

  let t = 0;
  let active = false;
  let fadedOut = false;
  let handedOff = false;
  let prevCarX = START_X;

  function updateCamera() {
    const cx = carX(t);
    // NOTE: the street is at z < BUILDING_FRONT_Z (-7.5). Every camera position
    // must stay on the STREET side (z <= ~-8.2) or it clips inside the facade
    // slab and films the building's back wall.
    if (t < 3.0) {
      // low 3/4 tracking shot from the street side
      _pos.set(cx + 5.2, 1.05, ROAD_Z + 4.2);
      _look.set(cx - 0.5, 0.85, ROAD_Z);
    } else if (t < 5.0) {
      // arc around to the passenger door as the car brakes to a stop
      const k = smoothstep((t - 3.0) / 2.0);
      _a.set(carX(3.0) + 5.2, 1.05, ROAD_Z + 4.2);
      _b.set(STOP_X + 3.4, 1.35, ROAD_Z + 3.4);
      _pos.lerpVectors(_a, _b, k);
      _c.set(carX(3.0) - 0.5, 0.85, ROAD_Z);
      _d.set(STOP_X, 0.95, ROAD_Z + 0.6);
      _look.lerpVectors(_c, _d, k);
    } else if (t < 7.0) {
      // player steps out; camera pulls back into the street and rises to frame
      // player + facade together
      const k = smoothstep((t - 5.0) / 2.0);
      _a.set(STOP_X + 3.4, 1.35, ROAD_Z + 3.4);
      _b.set(STOP_X + 1.6, 2.6, ROAD_Z - 2.6);
      _pos.lerpVectors(_a, _b, k);
      _c.set(STOP_X, 0.95, ROAD_Z + 0.6);
      _d.set(STOP_X + 0.2, 1.3, ROAD_Z + 2.0);
      _look.lerpVectors(_c, _d, k);
    } else {
      // player walks to the entrance; camera drifts along the street and up,
      // keeping the lit entrance + player in frame, then we cut
      const k = smoothstep((t - 7.0) / (T_FADE - 7.0));
      _a.set(STOP_X + 1.6, 2.6, ROAD_Z - 2.6);
      _b.set(ENTRANCE_X + 2.6, 3.2, ROAD_Z - 1.0);
      _pos.lerpVectors(_a, _b, k);
      _c.set(STOP_X + 0.2, 1.3, ROAD_Z + 2.0);
      _d.set(ENTRANCE_X, 1.7, BUILDING_FRONT_Z - 0.6);
      _look.lerpVectors(_c, _d, k);
    }
    camera.position.copy(_pos);
    camera.lookAt(_look);
    focusPoint.copy(_look);
  }

  function updatePlayer() {
    if (t < 5.0) { player.group.visible = false; return; }
    player.group.visible = true;
    // step out beside the door (5.0-5.8), then walk to the entrance (5.8-8.2)
    if (t < 5.8) {
      player.group.position.copy(doorPos);
      player.playAction('Idle');
    } else {
      const k = smoothstep((t - 5.8) / (T_FADE - 5.8));
      player.group.position.lerpVectors(doorPos, entrancePos, k);
      player.playAction(k > 0.02 && k < 0.995 ? 'Walking' : 'Idle');
    }
    player.group.rotation.y = 0;
  }

  function update(dt) {
    if (!active) return;
    t += dt;

    const cx = carX(t);
    const speed = Math.abs(prevCarX - cx) / Math.max(dt, 1e-4);
    prevCarX = cx;
    sedan.group.position.x = cx;
    sedan.setBrake(t > 3.0 && t < T_STOP + 0.4);
    sedan.update(dt, speed);

    updatePlayer();
    updateCamera();

    if (!fadedOut && t >= T_FADE) { fadedOut = true; if (onFadeOut) onFadeOut(); }
    if (!handedOff && t >= TOTAL) { handedOff = true; active = false; if (onHandoff) onHandoff(); }
  }

  function start() {
    t = 0; prevCarX = START_X; active = true; fadedOut = false; handedOff = false;
    if (onSubtitle) onSubtitle('Insertion point secured — you\'re on the clock.', 4200);
    updateCamera();
  }

  function skip() {
    if (!active) return;
    active = false;
    if (!fadedOut) { fadedOut = true; if (onFadeOut) onFadeOut(); }
    if (!handedOff) { handedOff = true; if (onHandoff) onHandoff(); }
  }

  function dispose() {
    active = false;
    scene.remove(stage);
    stage.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose && m.dispose());
      }
    });
    disposables.forEach((d) => d.dispose && d.dispose());
    scene.background = saved.background;
    scene.fog = saved.fog;
    player.group.visible = true;
  }

  return {
    start, update, skip, dispose, focusPoint,
    get active() { return active; },
  };
}
