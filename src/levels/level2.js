import * as THREE from 'three';

// ============================================================
// LEVEL 2 — Server Room & Labs
// Elevator Landing -> Server Maze (cameras + lasers) -> Terminal Room
// (hack objective) -> Exit Elevator. See the Level 2 floor plan diagram
// for the intended flow — this file is the blockout, not final art.
// ============================================================

const floorMat = new THREE.MeshStandardMaterial({ color: 0x3a4148 }); // cooler than L1
const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a3238 });
const ceilingMat = new THREE.MeshStandardMaterial({ color: 0x232a30 });
const fixtureMat = new THREE.MeshStandardMaterial({
  color: 0xcfe8ff, emissive: 0xaad4ff, emissiveIntensity: 1.3,
}); // cool blue-white, matches the "server room" tone from the plan doc
const rackMat = new THREE.MeshStandardMaterial({ color: 0x14181c, metalness: 0.4, roughness: 0.6 });
const markerMat = {
  camera: new THREE.MeshStandardMaterial({ color: 0xff3333, emissive: 0xff3333, emissiveIntensity: 0.5 }),
  laser: new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff2222, emissiveIntensity: 1.5 }),
  terminal: new THREE.MeshStandardMaterial({ color: 0x33ffcc, emissive: 0x33ffcc, emissiveIntensity: 0.5 }),
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

function makeLightFixture(x, y, z, width = 1.2, depth = 1.2) {
  const fixture = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), fixtureMat);
  fixture.rotation.x = Math.PI / 2;
  fixture.position.set(x, y - 0.02, z);
  fixture.name = 'light_fixture';
  return fixture;
}

// Walls are tagged so the shared collider filter (same convention as
// level1.js) picks them up automatically via material identity.
function makeWall(width, height, thickness, x, y, z, rotationY = 0) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(width, height, thickness), wallMat);
  wall.position.set(x, y, z);
  wall.rotation.y = rotationY;
  return wall;
}

// A server rack — the maze obstacle in the Server Maze room. Tagged
// collider_ so it blocks movement (and camera/guard sightlines later),
// same tagging convention as level1.js's furniture.
function makeServerRack(x, z, rotationY = 0) {
  const rack = new THREE.Group();
  rack.name = 'furniture_serverRack';
  rack.position.set(x, 0, z);
  rack.rotation.y = rotationY;

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.8), rackMat);
  body.position.set(0, 1.1, 0);
  body.name = 'collider_serverRack';
  rack.add(body);

  // A few glowing status lights down the front — cheap detail, cheap to add
  for (let i = 0; i < 4; i++) {
    const led = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x33ff66, emissive: 0x33ff66, emissiveIntensity: 1 })
    );
    led.position.set(-0.4 + i * 0.25, 1.8, 0.41);
    rack.add(led);
  }

  return rack;
}

// PLACEHOLDER — a mounted camera. Not wired to any detection logic yet;
// this just marks where one should go. Whoever builds the camera AI should
// read cameraMarkers (returned below) for positions rather than re-guessing
// coordinates, same pattern as guard waypoints in level1/main.js.
function makeCameraMarker(x, y, z, rotationY = 0) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = rotationY;

  const mount = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.3), rackMat);
  group.add(mount);

  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), markerMat.camera);
  lens.position.set(0, 0, 0.2);
  lens.name = 'marker_camera';
  group.add(lens);

  return group;
}

// PLACEHOLDER — a laser tripwire gate spanning a walkway. Purely visual,
// no detection logic yet. width should span the corridor/gap it's blocking.
function makeLaserGate(x, y, z, width, rotationY = 0) {
  const laser = new THREE.Mesh(new THREE.BoxGeometry(width, 0.03, 0.03), markerMat.laser);
  laser.position.set(x, y, z);
  laser.rotation.y = rotationY;
  laser.name = 'marker_laser';
  return laser;
}

export function createLevel2(scene) {
  const level2 = new THREE.Group();
  level2.name = 'Level2';
  const lightFixturePositions = [];
  const CEILING_HEIGHT = 4;

  // ============ ELEVATOR LANDING (start) ============
  // Footprint: x -4 to 4, z -4 to 4.
  const landing = new THREE.Group();
  landing.name = 'ElevatorLanding';

  landing.add(makeFloor(8, 8, 0, 0));
  landing.add(makeWall(8, 4, 0.2, 0, 2, -4));
  landing.add(makeWall(3, 4, 0.2, -2.5, 2, 4));   // back-left, gap for maze entrance
  landing.add(makeWall(3, 4, 0.2, 2.5, 2, 4));    // back-right
  landing.add(makeWall(8, 4, 0.2, -4, 2, 0, Math.PI / 2));
  landing.add(makeWall(8, 4, 0.2, 4, 2, 0, Math.PI / 2));
  landing.add(makeCeiling(8, 8, 0, CEILING_HEIGHT, 0));
  [[-2, -2], [2, -2], [-2, 2], [2, 2]].forEach(([x, z]) => {
    landing.add(makeLightFixture(x, CEILING_HEIGHT, z));
    lightFixturePositions.push(new THREE.Vector3(x, CEILING_HEIGHT, z));
  });

  // Elevator arrival marker — player spawns roughly here, same coordinate
  // convention as level1's PLAYER_SPAWN (set in main.js, not here).
  const landingMarker = new THREE.Mesh(
    new THREE.BoxGeometry(2, 0.1, 2),
    markerMat.exit
  );
  landingMarker.position.set(0, 0.05, -2.5);
  landingMarker.name = 'marker_entry';
  landing.add(landingMarker);

  level2.add(landing);

  // ============ SERVER MAZE (main hazard room) ============
  // Footprint: x -6 to 6, z 6 to 22.
  const maze = new THREE.Group();
  maze.name = 'ServerMaze';

  maze.add(makeFloor(12, 16, 0, 14));
  maze.add(makeWall(4.5, 4, 0.2, -3.75, 2, 6));   // front-left, matches landing gap
  maze.add(makeWall(4.5, 4, 0.2, 3.75, 2, 6));    // front-right
  maze.add(makeWall(3, 4, 0.2, -4.5, 2, 22));     // back-left, gap for terminal room
  maze.add(makeWall(3, 4, 0.2, 4.5, 2, 22));      // back-right
  maze.add(makeWall(16, 4, 0.2, -6, 2, 14, Math.PI / 2));
  maze.add(makeWall(16, 4, 0.2, 6, 2, 14, Math.PI / 2));
  maze.add(makeCeiling(12, 16, 0, CEILING_HEIGHT, 14));
  [[-3, 9], [3, 9], [-3, 14], [3, 14], [-3, 19], [3, 19]].forEach(([x, z]) => {
    maze.add(makeLightFixture(x, CEILING_HEIGHT, z));
    lightFixturePositions.push(new THREE.Vector3(x, CEILING_HEIGHT, z));
  });

  // Rack rows forming maze aisles — two rows of 3, leaving a centre aisle
  // and side paths. Adjust spacing once you see it in-game.
  const rackPositions = [
    [-3, 9], [-3, 12], [-3, 15],
    [3, 9], [3, 12], [3, 15],
  ];
  rackPositions.forEach(([x, z]) => maze.add(makeServerRack(x, z)));

  // Camera markers — three, watching different aisles. Positions collected
  // below for whoever builds the detection logic.
  const cameraMarkers = [
    new THREE.Vector3(-4.5, 2.6, 10),
    new THREE.Vector3(4.5, 2.6, 14),
    new THREE.Vector3(-4.5, 2.6, 18),
  ];
  maze.add(makeCameraMarker(-4.5, 2.6, 10, Math.PI / 2));
  maze.add(makeCameraMarker(4.5, 2.6, 14, -Math.PI / 2));
  maze.add(makeCameraMarker(-4.5, 2.6, 18, Math.PI / 2));

  // Laser gates — two, spanning the centre aisle at different points, so
  // the player has to weave rather than walk straight through.
  maze.add(makeLaserGate(0, 1.0, 11, 4));
  maze.add(makeLaserGate(0, 1.0, 17, 4));

  level2.add(maze);

  // ============ TERMINAL ROOM (objective) ============
  // Footprint: x -4 to 4, z 24 to 32.
  const terminalRoom = new THREE.Group();
  terminalRoom.name = 'TerminalRoom';

  terminalRoom.add(makeFloor(8, 8, 0, 28));
  terminalRoom.add(makeWall(3, 4, 0.2, -2.5, 2, 24));
  terminalRoom.add(makeWall(3, 4, 0.2, 2.5, 2, 24));
  terminalRoom.add(makeWall(8, 4, 0.2, 0, 2, 32));
  terminalRoom.add(makeWall(8, 4, 0.2, -4, 2, 28, Math.PI / 2));
  terminalRoom.add(makeWall(8, 4, 0.2, 4, 2, 28, Math.PI / 2));
  terminalRoom.add(makeCeiling(8, 8, 0, CEILING_HEIGHT, 28));
  [[-2, 26], [2, 26], [-2, 30], [2, 30]].forEach(([x, z]) => {
    terminalRoom.add(makeLightFixture(x, CEILING_HEIGHT, z));
    lightFixturePositions.push(new THREE.Vector3(x, CEILING_HEIGHT, z));
  });

  // PLACEHOLDER terminal desk + the hack objective marker on top
  const terminalDesk = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 0.6), rackMat);
  terminalDesk.position.set(0, 0.45, 30.5);
  terminalDesk.name = 'collider_terminalDesk';
  terminalRoom.add(terminalDesk);

  const terminalMarker = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), markerMat.terminal);
  terminalMarker.position.set(0, 1.05, 30.5);
  terminalMarker.name = 'marker_terminal';
  terminalRoom.add(terminalMarker);

  level2.add(terminalRoom);

  // ============ EXIT ALCOVE ============
  const exitPad = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 2), markerMat.exit);
  exitPad.position.set(2.5, 0.05, 30); // beside the desk, not behind it, so hacking doesn't instantly trigger the exit
  exitPad.name = 'marker_exit';
  terminalRoom.add(exitPad);
  const EXIT_POS = new THREE.Vector3(2.5, 0, 30);

  // Colliders: every wall segment + anything explicitly tagged collider_
  // (server racks, terminal desk) — same filter as level1.js.
  const colliders = [];
  level2.traverse((obj) => {
    if (!obj.isMesh) return;
    const isWall = obj.material === wallMat;
    const isTaggedCollider = obj.name.startsWith('collider_');
    if (isWall || isTaggedCollider) colliders.push(obj);
  });

  scene.add(level2);
  return {
    root: level2,
    colliders,
    lightFixturePositions,
    entryPosition: new THREE.Vector3(0, 0, -2.5),
    exitPosition: EXIT_POS,
    terminalPosition: new THREE.Vector3(0, 1.05, 30.5),
    cameraMarkers,
  };
}