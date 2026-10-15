import * as THREE from 'three';

// ============================================================
// PROCEDURAL EXTRACTION HELICOPTER
//
// Built the same way as scene/sedan.js: primitives + physical materials,
// lit by the game's own technique (emissive lenses + a couple of PointLights,
// no shadow maps, no post-processing). Authored nose-along-+Z so pitch/roll
// map directly to rotation.x / rotation.z while it flies off over the roof.
//
//   createHelicopter() -> { group, rotor, update(dt, vel), setRotorSpeed(x) }
//
// update() spins main + tail rotors, fades in the rotor-blur disc with spin-up,
// blinks the nav/anti-collision lights, and leans the airframe into its
// velocity vector so translation never looks like a sliding box.
// ============================================================

export function createHelicopter() {
  const group = new THREE.Group();
  group.name = 'Helicopter';

  // ---- materials ----------------------------------------------------------
  // Semi-metallic paint: pure metal reads black under the roof's night
  // lighting (same trap the sedan's chrome wheels fell into).
  const paint = new THREE.MeshStandardMaterial({ color: 0x24352c, metalness: 0.45, roughness: 0.42 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x101418, metalness: 0.5, roughness: 0.55 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x0a1622, metalness: 0.1, roughness: 0.08, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
  });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8d97a3, metalness: 0.5, roughness: 0.35 });
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x14181c, metalness: 0.3, roughness: 0.6 });
  const navRed = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2222, emissiveIntensity: 3 });
  const navGreen = new THREE.MeshStandardMaterial({ color: 0x003300, emissive: 0x22ff44, emissiveIntensity: 3 });
  const navWhite = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffffff, emissiveIntensity: 3 });
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff3322, emissiveIntensity: 4 });
  const cabinLightMat = new THREE.MeshStandardMaterial({ color: 0x332200, emissive: 0xffcc77, emissiveIntensity: 1.6 });

  // ---- fuselage -----------------------------------------------------------
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), paint);
  body.scale.set(0.95, 0.92, 1.65);
  group.add(body);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), dark);
  belly.scale.set(0.8, 0.55, 1.3); belly.position.set(0, -0.45, 0.1);
  group.add(belly);
  // cockpit glass bubble on the nose
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.82, 20, 14), glass);
  canopy.scale.set(0.85, 0.75, 1.05); canopy.position.set(0, 0.12, 1.05);
  group.add(canopy);
  // open cabin door on the -Z side (the rope ladder hangs from here): a dark
  // recess plus a warm interior glow so the doorway reads at night
  const doorRecess = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.95, 0.1), dark);
  doorRecess.position.set(0, -0.05, -0.92);
  group.add(doorRecess);
  const doorGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.85), cabinLightMat);
  doorGlow.position.set(0, -0.05, -0.98);
  group.add(doorGlow);

  // ---- tail ---------------------------------------------------------------
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.3, 3.4, 12), paint);
  boom.rotation.x = Math.PI / 2; boom.position.set(0, 0.12, -2.5);
  group.add(boom);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.6), paint);
  fin.position.set(0, 0.55, -4.05);
  group.add(fin);
  const tailPlane = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.42), paint);
  tailPlane.position.set(0, 0.1, -3.6);
  group.add(tailPlane);

  // ---- skids --------------------------------------------------------------
  [-0.72, 0.72].forEach((x) => {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.1, 10), steel);
    rail.rotation.x = Math.PI / 2; rail.position.set(x, -1.28, 0.15);
    group.add(rail);
    [0.9, -0.6].forEach((z) => {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.06), dark);
      strut.position.set(x * 0.82, -1.05, z);
      strut.rotation.z = x > 0 ? -0.25 : 0.25;
      group.add(strut);
    });
  });

  // ---- main rotor ---------------------------------------------------------
  const rotor = new THREE.Group();
  rotor.position.y = 1.02;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.3, 12), steel);
  rotor.add(hub);
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.025, 3.1), bladeMat);
    blade.position.z = 1.68;
    const arm = new THREE.Group();
    arm.rotation.y = (i / 4) * Math.PI * 2;
    arm.add(blade);
    rotor.add(arm);
  }
  group.add(rotor);
  // translucent blur disc: sells the spin at distance without motion blur
  const blurMat = new THREE.MeshStandardMaterial({
    color: 0x99a4ad, transparent: true, opacity: 0.0, roughness: 0.9, side: THREE.DoubleSide, depthWrite: false,
  });
  const blurDisc = new THREE.Mesh(new THREE.CircleGeometry(3.2, 40), blurMat);
  blurDisc.rotation.x = -Math.PI / 2; blurDisc.position.y = 1.02;
  group.add(blurDisc);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.35, 10), steel);
  mast.position.y = 0.9;
  group.add(mast);

  // ---- tail rotor ---------------------------------------------------------
  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.22, 0.55, -4.05);
  for (let i = 0; i < 2; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.0, 0.09), bladeMat);
    const arm = new THREE.Group();
    arm.rotation.x = (i / 2) * Math.PI * 2;
    arm.add(b);
    tailRotor.add(arm);
  }
  group.add(tailRotor);

  // ---- lights -------------------------------------------------------------
  const navL = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), navRed);
  navL.position.set(-0.98, 0.05, 0.2); group.add(navL);
  const navR = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), navGreen);
  navR.position.set(0.98, 0.05, 0.2); group.add(navR);
  const navT = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), navWhite);
  navT.position.set(0, 0.55, -4.3); group.add(navT);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), beaconMat);
  beacon.position.set(0, -0.95, -0.4); group.add(beacon);
  // one landing light pool under the nose + a faint cabin spill: the roof
  // already has its own fixtures, so these stay small and local
  const landing = new THREE.PointLight(0xffe0b0, 14, 20);
  landing.position.set(0, -1.1, 1.4); group.add(landing);
  const cabinSpill = new THREE.PointLight(0xffcc77, 5, 9);
  cabinSpill.position.set(0, -0.4, -1.3); group.add(cabinSpill);

  // ---- state --------------------------------------------------------------
  let rotorPhase = 0;
  let spin = 0;             // 0..1 spin-up factor (blur disc + thump rate follow it)
  let rotorTarget = 1;      // setRotorSpeed(0) winds the disc down on skip/dispose
  let clock = 0;

  // vel: world velocity Vector3 of the airframe (drives the lean)
  function update(dt, vel) {
    clock += dt;
    spin += (rotorTarget - spin) * Math.min(1, dt * 1.6);
    rotorPhase += dt * (6 + 34 * spin);
    rotor.rotation.y = rotorPhase;
    tailRotor.rotation.x = rotorPhase * 1.8;
    blurMat.opacity = 0.13 * spin;

    // lean into the velocity vector: nose-down pitching forward (+Z), roll for
    // sideways drift — kept gentle so hover still reads as hover
    const vx = vel ? vel.x : 0, vz = vel ? vel.z : 0;
    const pitch = THREE.MathUtils.clamp(-vz * 0.028, -0.3, 0.3);
    const roll = THREE.MathUtils.clamp(vx * 0.032, -0.3, 0.3);
    group.rotation.x += (pitch - group.rotation.x) * Math.min(1, dt * 3);
    group.rotation.z += (roll - group.rotation.z) * Math.min(1, dt * 3);

    // anti-collision beacon: hard double-flash every ~1.1 s; tail strobe white
    const bt = clock % 1.1;
    const on = bt < 0.07 || (bt > 0.16 && bt < 0.23);
    beaconMat.emissiveIntensity = on ? 6 : 0.4;
    navWhite.emissiveIntensity = (clock % 1.7) < 0.08 ? 5 : 0.5;
  }

  function setRotorSpeed(target) { rotorTarget = THREE.MathUtils.clamp(target, 0, 1); }

  return { group, rotor, update, setRotorSpeed };
}
