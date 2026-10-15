import * as THREE from 'three';
import { createHelicopter } from './helicopter.js';

// ============================================================
// ROOFTOP EXTRACTION CINEMATIC (end of Level 3)
//
// Mirror image of scene/dropoff.js: a scripted multi-shot sequence that owns
// the camera, but instead of building its own stage it plays on the live
// rooftop. A helicopter descends to the helipad, drops a rope ladder, the
// player runs over, climbs it, and is carried off while the bird accelerates
// away — guards frozen mid-pursuit, heads craned up after it — then the
// MISSION COMPLETE sign fades in and we hand back to main.js.
//
//   createExtraction(opts) -> { start(), update(dt), skip(), active, dispose() }
//
// opts: { scene, camera, player, guards, anchors, onSubtitle, onSign,
//         onFadeOut, onHandoff }
//   anchors  { exitPos: Vector3, padCenter: Vector3, roofY: number }
//   guards   array of live pursuer guard objects ({ group, body, mixer, actions })
// ============================================================

const T_LADDER = 1.5;      // ladder starts unrolling
const T_DESCEND = 2.8;     // helicopter settles into the hover
const T_RUN = 5.2;         // player reaches the ladder and grabs it
const T_LIFT = 7.5;        // his weight is on the ropes; the bird rises gently
const T_FLYOFF = 8.6;      // bird commits to departure WHILE he is still climbing
const T_CLIMB = 9.6;       // climb nears the cabin sill (aboard-ish)
const T_TUCK = 12.2;       // player disappears into the cabin
const T_SIGN = 10.4;       // MISSION COMPLETE fades in
const T_FADE = 13.6;       // fade-to-black begins
const TOTAL = 14.4;        // hand-off back to main.js

const HOVER_Y = 5.6;       // airframe height above the roof while hovering
const LADDER_LEN = 5.2;
// Hover lift/drift accumulated by the moment the bird departs, so the fly-off
// branch of heliTarget starts exactly where the hover left off (no jump).
const LIFT_AT_FLY = (T_FLYOFF - T_LIFT) * 0.5;
const DRIFT_AT_FLY = (T_FLYOFF - T_LIFT) * 0.25;

function smoothstep(x) { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); }

// ---- axis-free bone aiming -------------------------------------------------
// Rotates a bone so the direction toward its first child bone points along a
// world-space target. Axis-free on purpose: Mixamo bone axes differ per rig,
// so deriving the delta from the current world direction never guesses wrong.
const _bw = new THREE.Vector3();
const _cw = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _qd = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _ql = new THREE.Quaternion();
function aimBone(bone, targetWorldDir, weight = 1) {
  if (!bone) return;
  const child = bone.children.find((c) => c.isBone);
  if (!child) return;
  bone.updateWorldMatrix(true, false);
  _bw.setFromMatrixPosition(bone.matrixWorld);
  _cw.setFromMatrixPosition(child.matrixWorld);
  _dir.subVectors(_cw, _bw);
  if (_dir.lengthSq() < 1e-8) return;
  _dir.normalize();
  _qd.setFromUnitVectors(_dir, targetWorldDir);
  if (weight < 1) _qd.slerp(_ql.identity(), 1 - weight);
  bone.parent.getWorldQuaternion(_qp);
  _ql.copy(_qp).invert().multiply(_qd).multiply(_qp);
  bone.quaternion.premultiply(_ql);
}

export function createExtraction(opts) {
  const { scene, camera, player, guards = [], anchors, onSubtitle, onSign, onFadeOut, onHandoff } = opts;
  const { exitPos, padCenter, roofY } = anchors;

  // ---- the bird + its ladder ------------------------------------------------
  const heli = createHelicopter();
  scene.add(heli.group);

  // ---- cinematic lighting ---------------------------------------------------
  // The rooftop's night fixtures are tuned for gameplay (dim + moody). A cutscene
  // plays from pulled-back angles where that reads as near-black, so we lift the
  // whole roof with a cool "moon + city glow" fill and hang a warm key light that
  // tracks the action (the player on the ladder). Same approach the drop-off
  // exterior uses: these lights are owned by the cinematic and removed on
  // dispose(), leaving the live level's own lighting untouched.
  const cineAmbient = new THREE.AmbientLight(0x4a5f80, 1.35);
  const cineHemi = new THREE.HemisphereLight(0x6f8fc0, 0x2a3348, 1.2);
  const moon = new THREE.DirectionalLight(0xd6e4ff, 1.2);
  moon.position.set(padCenter.x - 10, roofY + 22, padCenter.z - 12);
  moon.target.position.copy(padCenter);
  const padFill = new THREE.PointLight(0xbcd2ff, 26, 26, 2);
  padFill.position.set(padCenter.x, roofY + 3.2, padCenter.z);
  const followLight = new THREE.PointLight(0xffd9a0, 26, 18, 2);   // warm key on the climber
  followLight.position.set(padCenter.x, roofY + 3, padCenter.z);
  // A fill that rides with the camera (a cinematic "headlight"). The bird, ladder
  // and climber are dark shapes; from side angles they vanish against the night
  // sky, so lighting them from the viewing direction keeps every shot readable.
  const camLight = new THREE.PointLight(0xdfe8ff, 90, 80, 1.5);
  scene.add(cineAmbient, cineHemi, moon, moon.target, padFill, followLight, camLight);

  // Give the sky a touch of tone (and a little depth fog) so silhouettes read
  // against it instead of pure black; restored on dispose().
  const savedBg = scene.background;
  const savedFog = scene.fog;
  scene.background = new THREE.Color(0x101a2a);
  scene.fog = new THREE.Fog(0x101a2a, 25, 80);

  const ladder = new THREE.Group();
  ladder.position.set(0, -0.5, -1.0);          // hangs from the open cabin door
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0x9c8a63, roughness: 0.9 });
  const rungMat = new THREE.MeshStandardMaterial({ color: 0xb8c0c8, metalness: 0.4, roughness: 0.5 });
  [-0.26, 0.26].forEach((x) => {
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, LADDER_LEN, 6), ropeMat);
    rope.position.set(x, -LADDER_LEN / 2, 0);
    ladder.add(rope);
  });
  for (let y = 0.35; y < LADDER_LEN; y += 0.38) {
    const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.52, 8), rungMat);
    rung.rotation.z = Math.PI / 2;
    rung.position.set(0, -y, 0);
    ladder.add(rung);
  }
  ladder.scale.y = 0.04;                        // rolled up inside the door
  heli.group.add(ladder);

  // ---- player rig bones used for the hang/climb pose ------------------------
  const bone = (n) => player.model.getObjectByName(n);
  const bones = {
    lArm: bone('LeftArm'), rArm: bone('RightArm'),
    lFore: bone('LeftForeArm'), rFore: bone('RightForeArm'),
    lUp: bone('LeftUpLeg'), rUp: bone('RightUpLeg'),
    lLeg: bone('LeftLeg'), rLeg: bone('RightLeg'),
  };
  // If the Mixamo ladder-climb clip (anim_climbladder.fbx, registered as
  // 'Climb' in main.js) is present we drive the ascent with it; the hand-
  // authored hang/climb pose below is the fallback when it is missing.
  const hasClimbClip = !!player.actions.Climb;
  const guardBones = guards.map((g) => ({
    g,
    head: g.body ? g.body.getObjectByName('Head') : null,
    neck: g.body ? g.body.getObjectByName('Neck') : null,
    idled: false,
  }));

  // ---- scratch --------------------------------------------------------------
  const heliPos = new THREE.Vector3();
  const heliPrev = new THREE.Vector3();
  const heliVel = new THREE.Vector3();
  const look = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _f = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);
  const _down = new THREE.Vector3(0, -1, 0);
  const _side = new THREE.Vector3();
  const _tgt = new THREE.Vector3();
  const _lw = new THREE.Vector3();
  const _lo = new THREE.Vector3();   // offset scratch for lookTarget (must NOT alias _a/_b)

  let t = 0;
  let active = false;
  let signed = false;
  let fadedOut = false;
  let handedOff = false;
  let grabbed = false;
  let tucked = false;
  let turnFrom = 0;   // run-facing yaw at the grab, blended into the ladder turn

  // ---- helicopter flight path ------------------------------------------------
  function heliTarget(out, time) {
    if (time < T_DESCEND) {
      // sweeps in from the front-right while descending onto the pad
      const k = smoothstep(time / T_DESCEND);
      out.set(
        THREE.MathUtils.lerp(padCenter.x + 11, padCenter.x, k),
        THREE.MathUtils.lerp(roofY + 19, roofY + HOVER_Y, k),
        THREE.MathUtils.lerp(padCenter.z - 9, padCenter.z, k),
      );
    } else if (time < T_FLYOFF) {
      // hover: slow bob + a breath of drift, then a gentle lift as the player
      // puts weight on the ladder
      const lift = time < T_LIFT ? 0 : (time - T_LIFT) * 0.5;
      out.set(
        padCenter.x + Math.sin(time * 0.7) * 0.15,
        roofY + HOVER_Y + Math.sin(time * 1.7) * 0.12 + lift,
        padCenter.z + Math.sin(time * 0.5 + 1.2) * 0.15 + (time < T_LIFT ? 0 : (time - T_LIFT) * 0.25),
      );
    } else {
      // fly-off: the bird leaves BEFORE he tops out, so the last stretch of
      // ladder is climbed in the air — quadratic acceleration away over the
      // roof edge while the hover sway dies out behind it
      const u = time - T_FLYOFF;
      const bob = Math.exp(-u * 0.8);
      out.set(
        padCenter.x + Math.sin(time * 0.7) * 0.15 * bob + u * 0.35,
        roofY + HOVER_Y + LIFT_AT_FLY + Math.sin(time * 1.7) * 0.12 * bob + u * 1.3 + u * u * 0.85,
        padCenter.z + DRIFT_AT_FLY + Math.sin(time * 0.5 + 1.2) * 0.15 * bob + u * 1.6 + u * u * 2.1,
      );
    }
    return out;
  }

  // ---- player ----------------------------------------------------------------
  const grabGround = new THREE.Vector3();   // where the ladder foot meets the roof
  function updatePlayer(dt) {
    if (t < T_RUN) {
      // stand at the stair mouth, then sprint across to the ladder foot
      if (t < T_DESCEND) {
        player.group.position.copy(exitPos);
        player.group.rotation.y = Math.atan2(padCenter.x - exitPos.x, padCenter.z - exitPos.z);
        player.playAction('Idle');
      } else {
        const k = smoothstep((t - T_DESCEND) / (T_RUN - T_DESCEND));
        heliTarget(_a, t);
        grabGround.set(_a.x, roofY, _a.z - 1.05);
        player.group.position.lerpVectors(exitPos, grabGround, k);
        player.group.position.y = roofY;
        player.group.rotation.y = Math.atan2(grabGround.x - exitPos.x, grabGround.z - exitPos.z);
        player.playAction(k > 0.9 ? 'Walking' : 'Run');
      }
      return;
    }

    if (!grabbed) {
      grabbed = true;
      turnFrom = player.group.rotation.y;   // sprint facing; blend out of it below
      // Real ladder-climb cycle when available; otherwise Idle as the base pose
      // for the procedural climb layered on below.
      player.playAction(hasClimbClip ? 'Climb' : 'Idle');
    }

    // feet climb from the ladder foot to the door sill — the top of the climb
    // lands AFTER T_FLYOFF on purpose, so the final rungs are climbed in the air
    const c = smoothstep((t - T_RUN) / (T_CLIMB + 1.4 - T_RUN));
    const feetLocal = -LADDER_LEN + 0.35 + c * (LADDER_LEN - 1.5);
    ladder.updateWorldMatrix(true, false);
    _lw.set(0, feetLocal, -0.42);
    ladder.localToWorld(_lw);
    player.group.position.copy(_lw);

    // Face the ladder plane (its local +Z points back into the ropes). The
    // Mixamo climb cycle is authored facing the OPPOSITE way to our GLB
    // locomotion clips, so with the clip playing the group needs an extra 180°
    // or he climbs with his back to the ropes; blend the turn over the first
    // moments at the ladder so it reads as turning in to grab, not a snap.
    _f.set(0, 0, 1).applyQuaternion(ladder.getWorldQuaternion(_qd)).setY(0).normalize();
    let yaw = Math.atan2(_f.x, _f.z);
    if (hasClimbClip) yaw += Math.PI;
    const tk = smoothstep((t - T_RUN) / 0.45);
    let dyaw = yaw - turnFrom;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    player.group.rotation.y = turnFrom + dyaw * tk;

    if (t >= T_TUCK) {
      if (!tucked) { tucked = true; player.model.visible = false; }
      return;
    }

    // The Climb clip already animates the arms/legs, so leave the rig to the
    // mixer. Only fall through to the procedural hang pose when it's missing.
    if (hasClimbClip) return;

    // ---- hang/climb pose: alternating reach, tucked knees -------------------
    const amp = t < T_CLIMB ? 1 : 0.45;      // settles into a hold once aboard-ish
    const ph = (t - T_RUN) * 1.15 * Math.PI * 2;
    const reach = 0.5 + 0.5 * Math.sin(ph);
    const other = 1 - reach;
    _side.crossVectors(_f, _up).normalize(); // player's right, world space

    _tgt.copy(_up).addScaledVector(_f, 0.12 + 0.42 * reach * amp).addScaledVector(_side, -0.18).normalize();
    aimBone(bones.lArm, _tgt, 0.9);
    _tgt.copy(_up).addScaledVector(_f, 0.12 + 0.42 * other * amp).addScaledVector(_side, 0.18).normalize();
    aimBone(bones.rArm, _tgt, 0.9);
    _tgt.copy(_up).multiplyScalar(0.9).addScaledVector(_f, 0.55).normalize();
    aimBone(bones.lFore, _tgt, 0.9);
    aimBone(bones.rFore, _tgt, 0.9);
    _tgt.copy(_down).addScaledVector(_f, -0.25).addScaledVector(_up, 0.45 * other * amp).normalize();
    aimBone(bones.lUp, _tgt, 0.85);
    _tgt.copy(_down).addScaledVector(_f, -0.25).addScaledVector(_up, 0.45 * reach * amp).normalize();
    aimBone(bones.rUp, _tgt, 0.85);
    _tgt.copy(_down).addScaledVector(_f, -(0.3 + 0.5 * other * amp)).normalize();
    aimBone(bones.lLeg, _tgt, 0.85);
    _tgt.copy(_down).addScaledVector(_f, -(0.3 + 0.5 * reach * amp)).normalize();
    aimBone(bones.rLeg, _tgt, 0.85);
  }

  // ---- guards: freeze mid-pursuit, face the bird, crane their heads ----------
  function updateGuards(dt) {
    heliTarget(_a, t);
    for (const gb of guardBones) {
      const g = gb.g;
      if (!gb.idled) {
        gb.idled = true;
        const idle = g.actions && g.actions.Idle;
        if (idle && g.current !== idle) {
          if (g.current) g.current.fadeOut(0.3);
          idle.reset().fadeIn(0.3).play();
          g.current = idle;
        }
      }
      g.mixer?.update(dt);
      const p = g.group.position;
      const dx = _a.x - p.x, dz = _a.z - p.z;
      if (dx * dx + dz * dz > 1e-4) g.group.rotation.y = Math.atan2(dx, dz);
      _tgt.set(_a.x, _a.y + 0.6, _a.z).sub(p).setY(Math.max(1.2, _a.y + 0.6 - (p.y + 1.6))).normalize();
      // aim from the guard's head height toward the airframe
      _tgt.set(dx, Math.max(1.5, _a.y - p.y), dz).normalize();
      aimBone(gb.neck, _tgt, 0.5);
      aimBone(gb.head, _tgt, 0.8);
    }
  }

  // ---- camera: one continuous key-framed path -------------------------------
  // Keys interpolate with smoothstep; look targets are dynamic (the bird and
  // the player move), so each key stores a selector instead of a fixed point.
  const LOOK_HELI = 0, LOOK_PLAYER = 1, LOOK_GRAB = 2;
  // Camera path. Two constraints learned from the live roof: a pair of 3 m lamp
  // posts stand at padCenter.x ± 5 (z = padCenter.z - 4), and the 1.2 m parapet
  // rings the roof — so every key stays within ~±2.6 of the pad's centre line
  // (between the posts) and at least ~2.2 above the deck (over the parapet),
  // shooting north at the pad. The fly-off keys pull back south and climb so the
  // bird, lifting and heading +z, stays framed.
  const keys = [
    { t: 0.0,      pos: [padCenter.x + 0.5, roofY + 2.6, padCenter.z - 6.5], look: LOOK_HELI, off: 0.6 },
    { t: T_DESCEND, pos: [padCenter.x - 1.5, roofY + 2.4, padCenter.z - 6.0], look: LOOK_HELI, off: 0.3 },
    { t: T_RUN,    pos: [padCenter.x + 2.6, roofY + 2.2, padCenter.z - 5.2], look: LOOK_GRAB, off: 1.0 },
    { t: 7.4,      pos: [padCenter.x + 2.2, roofY + 2.8, padCenter.z - 5.6], look: LOOK_PLAYER, off: 1.1 },
    { t: T_CLIMB,  pos: [padCenter.x - 2.4, roofY + 3.6, padCenter.z - 6.4], look: LOOK_PLAYER, off: 1.5 },
    { t: T_TUCK,   pos: [padCenter.x - 1.2, roofY + 4.8, padCenter.z - 8.0], look: LOOK_HELI, off: 0.9 },
    { t: TOTAL,    pos: [padCenter.x + 0.0, roofY + 6.0, padCenter.z - 9.5], look: LOOK_HELI, off: 1.4 },
  ];
  function lookTarget(sel, off, out) {
    // NB: `_lo` is a dedicated scratch. Reusing _a/_b here would clobber the very
    // vector updateCamera passes as `out` for the second key, collapsing the look
    // target toward the origin and swinging the camera off the action.
    if (sel === LOOK_HELI) return out.copy(heliPos).add(_lo.set(0, off, 0));
    if (sel === LOOK_GRAB) return out.set(grabGround.x, roofY + off, grabGround.z);
    return out.copy(player.group.position).add(_lo.set(0, off, 0));
  }
  function updateCamera() {
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1].t) i++;
    const k0 = keys[i], k1 = keys[i + 1];
    const k = smoothstep((t - k0.t) / Math.max(1e-4, k1.t - k0.t));
    camPos.set(
      THREE.MathUtils.lerp(k0.pos[0], k1.pos[0], k),
      THREE.MathUtils.lerp(k0.pos[1], k1.pos[1], k),
      THREE.MathUtils.lerp(k0.pos[2], k1.pos[2], k),
    );
    lookTarget(k0.look, k0.off, _a);
    lookTarget(k1.look, k1.off, _b);
    look.lerpVectors(_a, _b, k);
    camera.position.copy(camPos);
    camera.lookAt(look);
  }

  // ---- loop -------------------------------------------------------------------
  function update(dt) {
    if (!active) return;
    t += dt;

    heliTarget(heliPos, t);
    heliVel.subVectors(heliPos, heliPrev).divideScalar(Math.max(dt, 1e-4));
    heliPrev.copy(heliPos);
    heli.group.position.copy(heliPos);
    heli.update(dt, heliVel);

    // ladder unrolls, then trails/pendulums behind the airframe once it moves
    const unroll = smoothstep((t - T_LADDER) / 1.1);
    ladder.scale.y = 0.04 + 0.96 * unroll;
    const u = Math.max(0, t - T_FLYOFF);
    const pend = Math.min(1, u);
    ladder.rotation.x = Math.sin(t * 1.3) * 0.035 - Math.min(0.34, u * u * 0.05) - Math.sin(u * 2.0) * 0.05 * pend;
    ladder.rotation.z = Math.sin(t * 0.9 + 1.2) * 0.03 + Math.sin(u * 1.7 + 0.6) * 0.04 * pend;

    updatePlayer(dt);
    updateGuards(dt);
    updateCamera();
    camLight.position.copy(camera.position);   // headlight follows the shot

    // warm key light rides just above/behind the operative so the climb on the
    // ladder stays lit even as the bird (and its own landing light) pulls away
    followLight.position.set(
      player.group.position.x + 2.2,
      player.group.position.y + 3.0,
      player.group.position.z + 2.2,
    );

    if (!signed && t >= T_SIGN) { signed = true; if (onSign) onSign(); }
    if (!fadedOut && t >= T_FADE) { fadedOut = true; if (onFadeOut) onFadeOut(); }
    if (!handedOff && t >= TOTAL) { handedOff = true; active = false; if (onHandoff) onHandoff(); }
  }

  function start() {
    t = 0; active = true; signed = false; fadedOut = false; handedOff = false;
    grabbed = false; tucked = false;
    player.model.visible = true;
    heliTarget(heliPos, 0); heliPrev.copy(heliPos);
    heli.group.position.copy(heliPos);
    if (onSubtitle) onSubtitle('Roof clear — extraction bird inbound, grab the ladder!', 4200);
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
    scene.remove(heli.group);
    heli.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose && m.dispose());
      }
    });
    // pull the cinematic lighting back out — the live level keeps its own
    [cineAmbient, cineHemi, moon, moon.target, padFill, followLight, camLight].forEach((l) => scene.remove(l));
    scene.background = savedBg;
    scene.fog = savedFog;
    player.model.visible = true;
    player.group.position.copy(exitPos);
    player.group.position.y = roofY;
    player.playAction('Idle');
  }

  return {
    start, update, skip, dispose,
    get active() { return active; },
  };
}
