import * as THREE from 'three';

// Shared placeholder materials — swap these for real materials/textures later,
// this is deliberately plain so it's obviously "blockout, not final"
const floorMat = new THREE.MeshStandardMaterial({ color: 0x555555 });
const wallMat = new THREE.MeshStandardMaterial({ color: 0x333344 });
const markerMat = {
  guard: new THREE.MeshStandardMaterial({ color: 0xff3333, emissive: 0xff3333, emissiveIntensity: 0.4 }),
  player: new THREE.MeshStandardMaterial({ color: 0x33ff66, emissive: 0x33ff66, emissiveIntensity: 0.4 }),
  item: new THREE.MeshStandardMaterial({ color: 0xffcc00, emissive: 0xffcc00, emissiveIntensity: 0.5 }),
  furniture: new THREE.MeshStandardMaterial({ color: 0x8866aa }), // placeholder desks/cover
  elevator: new THREE.MeshStandardMaterial({ color: 0x00ccff, emissive: 0x00ccff, emissiveIntensity: 0.45 }),
};

const ceilingMat = new THREE.MeshStandardMaterial({ color: 0x3a3a4a });
// Fixture panels are lit from WITHIN (emissive) so they read as light sources
// even before the matching real PointLight (added in main.js) reaches them.
const fixtureMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xfff4e0,
  emissiveIntensity: 1.4,
});

function makeFloor(width, depth, x, z) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(x, 0, z);
  return floor;
}

// A wall segment. Walls are just thin boxes — easy to swap for real geometry later.
function makeWall(width, height, thickness, x, y, z, rotationY = 0) {
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, thickness),
    wallMat
  );
  wall.position.set(x, y, z);
  wall.rotation.y = rotationY;
  return wall;
}

// Ceiling plane — rotated the OPPOSITE way from the floor so its visible
// face points down into the room, not up and out of the building.
function makeCeiling(width, depth, x, y, z) {
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(x, y, z);
  return ceiling;
}

// A flush-mounted rectangular light panel, same orientation as the ceiling
// it's embedded in. Purely visual — main.js adds a matching real PointLight
// at the same (x, z) position, just slightly below the ceiling itself.
function makeLightFixture(x, y, z, width = 1.2, depth = 1.2) {
  const fixture = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), fixtureMat);
  fixture.rotation.x = Math.PI / 2;
  fixture.position.set(x, y - 0.02, z); // tiny offset so it doesn't z-fight the ceiling
  fixture.name = 'light_fixture';
  return fixture;
}

function makeMarker(type, x, y, z, size = 0.4) {
  const marker = new THREE.Mesh(new THREE.SphereGeometry(size, 12, 12), markerMat[type]);
  marker.position.set(x, y, z);
  marker.name = `marker_${type}`; // makes it easy to find/remove later via scene.getObjectByName
  return marker;
}

export function createLevel1(scene) {
  const level1 = new THREE.Group();
  level1.name = 'Level1';

  const CEILING_HEIGHT = 4;
  const lightFixturePositions = []; // main.js adds a real PointLight at each

  // ============ LOBBY ============
  // Room footprint: x from -6 to 6, z from -5 to 5. Wall height 4.
  const lobby = new THREE.Group();
  lobby.name = 'Lobby';

  lobby.add(makeFloor(12, 10, 0, 0));

  // Back wall has a 3m gap in the middle for the corridor doorway
  lobby.add(makeWall(4.5, 4, 0.2, -3.75, 2, 5));   // back-left segment
  lobby.add(makeWall(4.5, 4, 0.2, 3.75, 2, 5));    // back-right segment
  lobby.add(makeWall(10, 4, 0.2, 0, 2, -5));       // front wall (entrance side)
  lobby.add(makeWall(10, 4, 0.2, -6, 2, 0, Math.PI / 2)); // left wall
  lobby.add(makeWall(10, 4, 0.2, 6, 2, 0, Math.PI / 2));  // right wall

  // PLACEHOLDER: reception desk — replace this box with a real desk model
  const receptionDesk = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 0.8), markerMat.furniture);
  receptionDesk.position.set(-3, 0.5, 3.5);
  receptionDesk.name = 'placeholder_receptionDesk';
  lobby.add(receptionDesk);

  // PLACEHOLDER: two cover pillars near player spawn
  const pillar1 = new THREE.Mesh(new THREE.BoxGeometry(1,4,1), markerMat.furniture);
  pillar1.position.set(-4, 2, -3);
  pillar1.name = 'placeholder_pillar';
  lobby.add(pillar1);

  
  // Player spawn / hiding spot, behind pillar1
  lobby.add(makeMarker('player', -4, 0.4, -3.8, 0.3));

  // PLACEHOLDER: extraction elevator — front-right corner of the Lobby, away
  // from spawn/reception so it doesn't crowd the sneak-in path. Position is
  // returned below so main.js can do the win-check distance test without
  // hardcoding a duplicate copy of these coordinates.
  const ELEVATOR_POS = new THREE.Vector3(5, 0, -4);
  const elevatorPad = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 2), markerMat.elevator);
  elevatorPad.position.set(ELEVATOR_POS.x, 0.05, ELEVATOR_POS.z);
  elevatorPad.name = 'marker_elevator';
  lobby.add(elevatorPad);

  // Door panel just behind the pad, flush with the front wall — purely
  // visual, not a collider (elevator marker material is excluded from the
  // collider traversal below, same as every other marker).
  const elevatorDoor = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 0.15), markerMat.elevator);
  elevatorDoor.position.set(ELEVATOR_POS.x, 1.5, ELEVATOR_POS.z - 1);
  elevatorDoor.name = 'marker_elevator_door';
  lobby.add(elevatorDoor);

  lobby.add(makeCeiling(12, 10, 0, CEILING_HEIGHT, 0));
  [[-3, -2.5], [3, -2.5], [-3, 2.5], [3, 2.5]].forEach(([x, z]) => {
    lobby.add(makeLightFixture(x, CEILING_HEIGHT, z));
    lightFixturePositions.push(new THREE.Vector3(x, CEILING_HEIGHT, z));
  });

  level1.add(lobby);

  // ============ CORRIDOR ============
  // Connects Lobby (ends at z=5) to Offices (starts at z=11). Width 3, so it lines
  // up with the gap left in the Lobby's back wall.
  const corridor = new THREE.Group();
  corridor.name = 'Corridor';

  corridor.add(makeFloor(3, 6, 0, 8));
  corridor.add(makeWall(6, 4, 0.2, -1.5, 2, 8, Math.PI / 2)); // left wall
  corridor.add(makeWall(6, 4, 0.2, 1.5, 2, 8, Math.PI / 2));  // right wall

  corridor.add(makeCeiling(3, 6, 0, CEILING_HEIGHT, 8));
  [[0, 6.5], [0, 9.5]].forEach(([x, z]) => {
    corridor.add(makeLightFixture(x, CEILING_HEIGHT, z, 1.2, 1.2));
    lightFixturePositions.push(new THREE.Vector3(x, CEILING_HEIGHT, z));
  });

  level1.add(corridor);

  // ============ OFFICES ============
  // Room footprint: x from -7 to 7, z from 11 to 21. Wall height 4.
  const offices = new THREE.Group();
  offices.name = 'Offices';

  offices.add(makeFloor(14, 10, 0, 16));

  offices.add(makeWall(5.5, 4, 0.2, -4.25, 2, 11));  // front-left (corridor side gap)
  offices.add(makeWall(5.5, 4, 0.2, 4.25, 2, 11));   // front-right
  offices.add(makeWall(14, 4, 0.2, 0, 2, 21));       // back wall
  offices.add(makeWall(10, 4, 0.2, -7, 2, 16, Math.PI / 2)); // left wall
  offices.add(makeWall(10, 4, 0.2, 7, 2, 16, Math.PI / 2));  // right wall

  // PLACEHOLDER: a few cubicle blocks scattered through the main office area
  const cubiclePositions = [
    [-4, 14], [-1, 14], [2, 14],
    [-4, 18], [-1, 18],
  ];
  cubiclePositions.forEach(([x, z]) => {
    const cubicle = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 1.5), markerMat.furniture);
    cubicle.position.set(x, 0.6, z);
    cubicle.name = 'placeholder_cubicle';
    offices.add(cubicle);
  });

  // Manager's office — small enclosed room in the back-right corner, with a
  // doorway gap on its left side facing into the main office area
  const mgrOffice = new THREE.Group();
  mgrOffice.name = 'ManagerOffice';
  mgrOffice.add(makeWall(4, 4, 0.2, 5, 2, 17, Math.PI / 2));       // back wall of mgr office
  mgrOffice.add(makeWall(4, 4, 0.2, 6.9, 2, 19, 0));               // right-side wall
  mgrOffice.add(makeWall(2, 4, 0.2, 4, 2, 21, 0));                 // partial front wall (leaves doorway gap)

  // PLACEHOLDER: manager's desk with the keycard on top
  const mgrDesk = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.8), markerMat.furniture);
  mgrDesk.position.set(5, 0.45, 19);
  mgrDesk.name = 'placeholder_managerDesk';
  mgrOffice.add(mgrDesk);

  const keycardMesh = makeMarker('item', 5, 1.0, 19, 0.25); // the keycard itself
  mgrOffice.add(keycardMesh);

  offices.add(makeCeiling(14, 10, 0, CEILING_HEIGHT, 16));
  [[-4, 13], [-1, 13], [2, 13], [-4, 19], [-1, 19]].forEach(([x, z]) => {
    offices.add(makeLightFixture(x, CEILING_HEIGHT, z));
    lightFixturePositions.push(new THREE.Vector3(x, CEILING_HEIGHT, z));
  });
  // Manager's Office gets its own single fixture, matching the accent
  // light already set up for that room in main.js.
  mgrOffice.add(makeLightFixture(5, CEILING_HEIGHT, 19, 1.4, 1.4));
  lightFixturePositions.push(new THREE.Vector3(5, CEILING_HEIGHT, 19));

  offices.add(mgrOffice);
  level1.add(offices);

    // Everything that can block Guard B's line of sight. All walls share wallMat
  // and all placeholder furniture shares markerMat.furniture, so one traversal
  // collects them. The guard/player/keycard markers use the other materials,
  // so they are excluded automatically (markers must NOT block vision).
  const colliders = [];
  level1.traverse((obj) => {
    if (obj.isMesh && (obj.material === wallMat || obj.material === markerMat.furniture)) {
      colliders.push(obj);
    }
  });

  scene.add(level1);
  return {
    root: level1,
    colliders,
    elevatorPosition: ELEVATOR_POS,
    keycardMesh,
    lightFixturePositions,
  };
}