import * as THREE from 'three';

// ============================================================
// PROCEDURAL BLACK SEDAN
//
// No car model ships with the project, so the drop-off vehicle is built here
// from extruded side-profiles + primitives, shaded with physical materials:
// clearcoat black paint, tinted glass, chrome trim, emissive lamps and real
// spotlight headlight beams. It's authored facing +X (length along X, width
// along Z) so it can drive along a road parallel to the building's front.
//
//   createSedan()  ->  { group, wheels, update(dt, speed), setLights(on),
//                        headlightL, headlightR }
// ============================================================

// Extrude a 2D side-profile ([x, y] points, x = along the car's length) into
// a solid of the given width, centred on Z, with soft bevelled edges so the
// silhouette catches highlights like sheet metal rather than a flat cut-out.
function extrudeProfile(points, width, { bevel = 0.05, curveSegments = 8 } = {}) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: 0,
    bevelSegments: 4,
    curveSegments,
  });
  geo.translate(0, 0, -width / 2);
  geo.computeVertexNormals();
  return geo;
}

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function createSedan() {
  const group = new THREE.Group();
  group.name = 'Sedan';

  // ---- materials ----------------------------------------------------------
  const paint = new THREE.MeshPhysicalMaterial({
    color: 0x05070b, metalness: 0.55, roughness: 0.28,
    clearcoat: 1.0, clearcoatRoughness: 0.05, envMapIntensity: 1.5,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x0a1622, metalness: 0.0, roughness: 0.06,
    transparent: true, opacity: 0.62, envMapIntensity: 2.2, clearcoat: 1.0,
    side: THREE.DoubleSide,
  });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd7dee7, metalness: 1.0, roughness: 0.13, envMapIntensity: 1.6 });
  const darkTrim = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, metalness: 0.4, roughness: 0.6 });
  const tire = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, metalness: 0.0, roughness: 0.92 });
  // Wheel faces are deliberately semi-metallic: a full metal (chrome) reads as
  // black at night with no environment light, which hid the spoke rotation.
  const wheelFace = new THREE.MeshStandardMaterial({ color: 0xb9c2cc, metalness: 0.35, roughness: 0.42 });
  const headLens = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeaf4ff, emissiveIntensity: 4.0, roughness: 0.2 });
  const tailLens = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2b2b, emissiveIntensity: 3.0, roughness: 0.3 });
  const amberLens = new THREE.MeshStandardMaterial({ color: 0x221100, emissive: 0xffa52b, emissiveIntensity: 2.0, roughness: 0.4 });

  // ---- body (beltline and below) -----------------------------------------
  const bodyProfile = [
    [-2.30, 0.34], [-2.35, 0.58], [-2.31, 0.90], [-2.05, 1.02], [-1.30, 1.06],
    [0.55, 1.08], [1.55, 1.00], [2.14, 0.92], [2.33, 0.74], [2.36, 0.48], [2.24, 0.34],
  ];
  const body = new THREE.Mesh(extrudeProfile(bodyProfile, 1.84), paint);
  body.castShadow = true; body.receiveShadow = true;
  group.add(body);

  // ---- greenhouse (glass cabin sitting on the beltline) -------------------
  const cabinProfile = [
    [-1.28, 1.05], [-1.04, 1.40], [0.12, 1.42], [0.56, 1.07],
  ];
  const cabin = new THREE.Mesh(extrudeProfile(cabinProfile, 1.62, { bevel: 0.03 }), glass);
  cabin.castShadow = false; cabin.receiveShadow = false;
  group.add(cabin);

  // Painted roof cap over the glass, and thin pillars to frame the windows.
  const roof = box(1.28, 0.07, 1.56, paint, -0.46, 1.42, 0);
  group.add(roof);
  group.add(box(0.10, 0.40, 1.5, paint, -1.14, 1.23, 0));  // C-pillar
  group.add(box(0.10, 0.40, 1.5, paint, 0.34, 1.24, 0));   // A-pillar
  group.add(box(1.5, 0.06, 0.06, darkTrim, -0.4, 1.06, 0.80)); // beltline trim L
  group.add(box(1.5, 0.06, 0.06, darkTrim, -0.4, 1.06, -0.80)); // beltline trim R

  // ---- bumpers, grille, chrome -------------------------------------------
  group.add(box(0.16, 0.26, 1.78, darkTrim, 2.30, 0.50, 0));   // front bumper
  group.add(box(0.16, 0.26, 1.78, darkTrim, -2.30, 0.52, 0));  // rear bumper
  group.add(box(0.05, 0.20, 1.20, chrome, 2.34, 0.72, 0));     // grille bar
  group.add(box(0.06, 0.14, 1.30, darkTrim, 2.33, 0.60, 0));   // grille mesh
  group.add(box(0.04, 0.05, 1.70, chrome, 2.20, 0.94, 0));     // hood chrome strip
  group.add(box(1.9, 0.03, 0.04, chrome, 0.1, 0.42, 0.92));    // side sill L
  group.add(box(1.9, 0.03, 0.04, chrome, 0.1, 0.42, -0.92));   // side sill R
  // door shut lines
  [-0.9, 0.1].forEach((x) => {
    group.add(box(0.02, 0.5, 0.02, darkTrim, x, 0.75, 0.925));
    group.add(box(0.02, 0.5, 0.02, darkTrim, x, 0.75, -0.925));
  });
  // door handles
  [0.55, -0.45].forEach((x) => {
    group.add(box(0.16, 0.04, 0.05, chrome, x, 0.86, 0.93));
    group.add(box(0.16, 0.04, 0.05, chrome, x, 0.86, -0.93));
  });
  // side mirrors
  group.add(box(0.16, 0.10, 0.10, paint, 0.52, 1.05, 0.95));
  group.add(box(0.16, 0.10, 0.10, paint, 0.52, 1.05, -0.95));
  // exhaust tips
  group.add(box(0.12, 0.08, 0.16, chrome, -2.34, 0.42, 0.55));
  group.add(box(0.12, 0.08, 0.16, chrome, -2.34, 0.42, -0.55));

  // ---- lamps --------------------------------------------------------------
  const headlights = [];
  [0.62, -0.62].forEach((z) => {
    const lens = box(0.10, 0.16, 0.34, headLens, 2.30, 0.78, z);
    group.add(lens); headlights.push(lens);
    const spot = new THREE.SpotLight(0xdfeaff, 12, 26, Math.PI / 7, 0.45, 1.4);
    spot.position.set(2.25, 0.78, z);
    spot.target.position.set(14, 0.1, z * 1.6);
    group.add(spot); group.add(spot.target);
    if (z > 0) group.userData.spotR = spot; else group.userData.spotL = spot;
  });
  const taillights = [];
  [0.66, -0.66].forEach((z) => {
    const t = box(0.08, 0.14, 0.34, tailLens, -2.32, 0.80, z);
    group.add(t); taillights.push(t);
  });
  [0.80, -0.80].forEach((z) => group.add(box(0.06, 0.08, 0.16, amberLens, 2.28, 0.60, z))); // indicators

  // ---- wheels -------------------------------------------------------------
  // Open five-spoke faces (thin ring + spokes over a dark brake disc) instead
  // of a solid symmetric rim cylinder, so the spin is actually readable on
  // screen; a fixed caliper behind the spokes gives a static reference.
  const wheels = [];
  function makeWheel(x, z) {
    const face = z > 0 ? 0.14 : -0.14;
    const holder = new THREE.Group();
    holder.position.set(x, 0.36, z);
    const tireGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 28);
    tireGeo.rotateX(Math.PI / 2); // axle along Z
    const tireMesh = new THREE.Mesh(tireGeo, tire);
    tireMesh.castShadow = true; tireMesh.receiveShadow = true;
    holder.add(tireMesh);
    // dark brake disc fills the face so spokes read against it
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.06, 24), darkTrim);
    disc.rotation.x = Math.PI / 2; disc.position.z = face * 0.6;
    holder.add(disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 10, 24), wheelFace);
    ring.position.z = face;
    holder.add(ring);
    for (let i = 0; i < 5; i++) {
      // chunky light spokes: at night a thin dark spoke never reads as turning
      const spoke = box(0.08, 0.42, 0.05, wheelFace, 0, 0, 0);
      spoke.rotation.z = (i / 5) * Math.PI * 2;
      spoke.position.z = face;
      holder.add(spoke);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.30, 12), wheelFace);
    hub.rotation.x = Math.PI / 2;
    holder.add(hub);
    group.add(holder);
    wheels.push(holder);
    // static caliper just inboard of the spinning face
    group.add(box(0.10, 0.16, 0.05, darkTrim, x, 0.52, z > 0 ? 0.09 : -0.09));
    return holder;
  }
  makeWheel(1.42, 0.86); makeWheel(1.42, -0.86);
  makeWheel(-1.44, 0.86); makeWheel(-1.44, -0.86);

  // ---- state --------------------------------------------------------------
  let lightsOn = true;
  function setLights(on) {
    lightsOn = on;
    group.userData.spotL.intensity = on ? 12 : 0;
    group.userData.spotR.intensity = on ? 12 : 0;
    headLens.emissiveIntensity = on ? 4.0 : 0.4;
    headLens.emissive.setHex(on ? 0xeaf4ff : 0x223044);
  }
  setLights(true);

  // Spin the wheels to match road speed (m/s). Wheel radius 0.36 m. Also add a
  // touch of suspension travel (bob while rolling, nose-dive under braking) so
  // the car sits on its springs instead of gliding over the asphalt.
  let prevSpeed = 0;
  let pitch = 0;
  let bobPhase = 0;
  function update(dt, speed = 0) {
    const spin = (speed / 0.36) * dt;
    wheels.forEach((w) => { w.rotation.z -= spin; });

    const accel = (speed - prevSpeed) / Math.max(dt, 1e-4);
    prevSpeed = speed;
    bobPhase += dt * (3 + speed * 0.8);
    const bob = speed > 0.2 ? Math.sin(bobPhase) * 0.004 * Math.min(speed / 8, 1) : 0;
    const pitchTarget = THREE.MathUtils.clamp(-accel * 0.006, -0.025, 0.025);
    pitch += (pitchTarget - pitch) * Math.min(1, dt * 6);
    group.position.y = bob;
    group.rotation.z = pitch;

    // subtle brake-light surge handled by caller via setBrake; keep tail glow steady here
    tailLens.emissiveIntensity = lightsOn ? 3.0 : 1.2;
  }

  function setBrake(on) {
    tailLens.emissiveIntensity = on ? 6.0 : (lightsOn ? 3.0 : 1.2);
    tailLens.emissive.setHex(on ? 0xff5544 : 0xff2b2b);
  }

  return { group, wheels, update, setLights, setBrake, headlightL: group.userData.spotL, headlightR: group.userData.spotR };
}
