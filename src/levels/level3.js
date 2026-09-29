import * as THREE from 'three';

// ============================================================
// LEVEL 3 — Vault Wing
// Checkpoint (tight guards) -> Trap Corridor (lasers + pressure plates) ->
// Antechamber (calm beat) -> Vault (final objective + escape). See the
// Level 3 floor plan diagram for the intended flow. Blockout, not final art.
// ============================================================

const floorMat = new THREE.MeshStandardMaterial({ color: 0x1c1c22 }); // darker than L1/L2
const wallMat = new THREE.MeshStandardMaterial({ color: 0x15151a });
const ceilingMat = new THREE.MeshStandardMaterial({ color: 0x101014 });
const fixtureMat = new THREE.MeshStandardMaterial({
  color: 0xffe0b0, emissive: 0xffb060, emissiveIntensity: 1.1,
}); // dimmer, warmer — tense checkpoint/corridor tone
const vaultFixtureMat = new THREE.MeshStandardMaterial({
  color: 0xffffff, emissive: 0xfff4d0, emissiveIntensity: 2.0,
}); // the one bright, dramatic light — reserved for the vault item itself
const metalMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, metalness: 0.6, roughness: 0.4 });
const markerMat = {
  guard: new THREE.MeshStandardMaterial({ color: 0xff3333, emissive: 0xff3333, emissiveIntensity: 0.5 }),
  laser: new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff2222, emissiveIntensity: 1.5 }),
  plate: new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xffaa00, emissiveIntensity: 0.6 }),
  vaultItem: new THREE.MeshStandardMaterial({ color: 0xffcc00, emissive: 0xffcc00, emissiveIntensity: 0.8 }),
  exit: new THREE.MeshStandardMaterial({ color: 0x00ccff, emissive: 0x00ccff, emissiveIntensity: 0.45 }),
};

function makeFloor(width, depth, x, z) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(x, 0, z);
  return floor;
}

function makeCeiling(width, depth, x, y, z) {
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(x, y, z);
  return ceiling;
}

function makeLightFixture(x, y, z, width = 1.0, depth = 1.0, dramatic = false) {
  const fixture = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), dramatic ? vaultFixtureMat : fixtureMat);
  fixture.rotation.x = Math.PI / 2;
  fixture.position.set(x, y - 0.02, z);
  fixture.name = 'light_fixture';
  return fixture;
}

function makeWall(width, height, thickness, x, y, z, rotationY = 0) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(width, height, thickness), wallMat);
  wall.position.set(x, y, z);
  wall.rotation.y = rotationY;
  return wall;
}

// PLACEHOLDER — a guard spawn point. No real AI wired up for Level 3 yet;
// this just marks where the tightest-security guards should start. Reuse
// the GuardA/GuardB classes from Level 1's ai/guards.js when you get there.
function makeGuardMarker(x, z) {
  const marker = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12), markerMat.guard);
  marker.position.set(x, 0.4, z);
  marker.name = 'marker_guardSpawn';
  return marker;
}

// PLACEHOLDER — a laser gate, same idea as Level 2's, but these should end
// up on a timing cycle (on/off) rather than static once implemented.
function makeLaserGate(x, y, z, width, rotationY = 0) {
  const laser = new THREE.Mesh(new THREE.BoxGeometry(width, 0.03, 0.03), markerMat.laser);
  laser.position.set(x, y, z);
  laser.rotation.y = rotationY;
  laser.name = 'marker_laser';
  return laser;
}

// PLACEHOLDER — a floor pressure plate the player needs to step around.
function makePressurePlate(x, z) {
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.8), markerMat.plate);
  plate.position.set(x, 0.03, z);
  plate.name = 'marker_pressurePlate';
  return plate;
}

export function createLevel3(scene) {
  const level3 = new THREE.Group();
  level3.name = 'Level3';
  const lightFixturePositions = [];
  const dramaticFixturePositions = []; // the vault's own bright fixture, lit separately
  const CEILING_HEIGHT = 4;

  // ============ CHECKPOINT (start) ============
  // Footprint: x -4 to 4, z -4 to 4.
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

  // Two guard spawn markers — tightest security starts right at the door
  checkpoint.add(makeGuardMarker(-1.5, 1));
  checkpoint.add(makeGuardMarker(1.5, 1));
  const guardSpawnMarkers = [new THREE.Vector3(-1.5, 0, 1), new THREE.Vector3(1.5, 0, 1)];

  const entryMarker = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 2), markerMat.exit);
  entryMarker.position.set(0, 0.05, -2.5);
  entryMarker.name = 'marker_entry';
  checkpoint.add(entryMarker);

  level3.add(checkpoint);

  // ============ TRAP CORRIDOR ============
  // Footprint: x -2.5 to 2.5, z 6 to 22 — long and narrow, matching the plan.
  const corridor = new THREE.Group();
  corridor.name = 'TrapCorridor';

  corridor.add(makeFloor(5, 16, 0, 14));
  corridor.add(makeWall(16, 4, 0.2, -2.5, 2, 14, Math.PI / 2));
  corridor.add(makeWall(16, 4, 0.2, 2.5, 2, 14, Math.PI / 2));
  corridor.add(makeCeiling(5, 16, 0, CEILING_HEIGHT, 14));
  [[0, 8], [0, 14], [0, 20]].forEach(([x, z]) => {
    corridor.add(makeLightFixture(x, CEILING_HEIGHT, z));
    lightFixturePositions.push(new THREE.Vector3(x, CEILING_HEIGHT, z));
  });

  // Laser gates on a (future) timing cycle — spaced so the player has to
  // actually wait/time their run, not just walk through in one line.
  corridor.add(makeLaserGate(0, 1.0, 9, 4));
  corridor.add(makeLaserGate(0, 1.0, 14, 4));
  corridor.add(makeLaserGate(0, 1.0, 19, 4));

  // Pressure plates offset to the sides, forcing a weave between the
  // laser timing AND the floor hazards rather than one or the other.
  corridor.add(makePressurePlate(-1.5, 11));
  corridor.add(makePressurePlate(1.5, 16));

  const trapMarkers = {
    lasers: [new THREE.Vector3(0, 1.0, 9), new THREE.Vector3(0, 1.0, 14), new THREE.Vector3(0, 1.0, 19)],
    plates: [new THREE.Vector3(-1.5, 0, 11), new THREE.Vector3(1.5, 0, 16)],
  };

  level3.add(corridor);

  // ============ ANTECHAMBER (calm beat) ============
  // Footprint: x -3 to 3, z 24 to 30. Deliberately close to empty — a
  // breathing moment before the vault, per the design doc.
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

  level3.add(antechamber);

  // ============ VAULT (final objective + exit) ============
  // Footprint: x -4 to 4, z 32 to 40.
  const vault = new THREE.Group();
  vault.name = 'Vault';

  vault.add(makeFloor(8, 8, 0, 36));
  vault.add(makeWall(2, 4, 0.2, -2, 2, 32));
  vault.add(makeWall(2, 4, 0.2, 2, 2, 32));
  vault.add(makeWall(8, 4, 0.2, 0, 2, 40));
  vault.add(makeWall(8, 4, 0.2, -4, 2, 36, Math.PI / 2));
  vault.add(makeWall(8, 4, 0.2, 4, 2, 36, Math.PI / 2));
  vault.add(makeCeiling(8, 8, 0, CEILING_HEIGHT, 36));
  // Corner fill lights, dim — the vault should read as dark except for
  // the one dramatic light directly over the item itself.
  [[-3, 34], [3, 34], [-3, 38], [3, 38]].forEach(([x, z]) => {
    vault.add(makeLightFixture(x, CEILING_HEIGHT, z, 0.8, 0.8));
    lightFixturePositions.push(new THREE.Vector3(x, CEILING_HEIGHT, z));
  });
  // The dramatic centre spotlight, directly over the pedestal
  vault.add(makeLightFixture(0, CEILING_HEIGHT, 35, 1.5, 1.5, true));
  dramaticFixturePositions.push(new THREE.Vector3(0, CEILING_HEIGHT, 35));

  // Pedestal + the final objective item
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 1.0, 16), metalMat);
  pedestal.position.set(0, 0.5, 35);
  pedestal.name = 'collider_pedestal';
  vault.add(pedestal);

  const vaultItem = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), markerMat.vaultItem);
  vaultItem.position.set(0, 1.2, 35);
  vaultItem.name = 'marker_vaultItem';
  vault.add(vaultItem);

  // Exit — extraction point, back the way you came or a separate escape
  // route depending on what the team decides; placeholder pad for now.
  const exitPad = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 2), markerMat.exit);
  exitPad.position.set(0, 0.05, 39);
  exitPad.name = 'marker_exit';
  vault.add(exitPad);
  const EXIT_POS = new THREE.Vector3(0, 0, 39);

  level3.add(vault);

  // Colliders: walls + anything tagged collider_ (currently just the
  // pedestal — add more as real furniture/obstacles get built in).
  const colliders = [];
  level3.traverse((obj) => {
    if (!obj.isMesh) return;
    const isWall = obj.material === wallMat;
    const isTaggedCollider = obj.name.startsWith('collider_');
    if (isWall || isTaggedCollider) colliders.push(obj);
  });

  scene.add(level3);
  return {
    root: level3,
    colliders,
    lightFixturePositions,
    dramaticFixturePositions,
    entryPosition: new THREE.Vector3(0, 0, -2.5),
    exitPosition: EXIT_POS,
    vaultItemPosition: new THREE.Vector3(0, 1.2, 35),
    guardSpawnMarkers,
    trapMarkers,
  };
}
