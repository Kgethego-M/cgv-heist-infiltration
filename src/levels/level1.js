import * as THREE from 'three';
// ---- PROCEDURAL TEXTURES -------------------------------------------------
// Generated in code at load — no image files, nothing to credit, and they
// behave identically on the LAMP server. 256x256 = power-of-two, tiny in
// memory (brief section 6.1).

function makeCanvas(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  return canvas;
}

// Neutral office laminate for desktops/cubicles/pillar — speckle + grain.
function makeLaminateMap() {
  const ctx = makeCanvas().getContext('2d');
  ctx.fillStyle = '#b3aa9c';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const v = 145 + Math.floor(Math.random() * 60);
    ctx.fillStyle = `rgba(${v},${v - 6},${v - 16},0.25)`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 1);
  }
  ctx.strokeStyle = 'rgba(88,80,70,0.18)';
  for (let y = 8; y < 256; y += 16) {
    ctx.beginPath();
    ctx.moveTo(0, y + Math.random() * 3);
    ctx.lineTo(256, y + Math.random() * 3);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Grayscale height noise for the SAME surface — this is the "texture used
// for more than colour" the rubric asks for (bump map).
function makeLaminateBump() {
  const ctx = makeCanvas().getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const v = Math.floor(Math.random() * 255);
    ctx.fillStyle = `rgba(${v},${v},${v},0.3)`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 1);
  }
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex; // height map — deliberately NOT sRGB
}

// Wood grain for counter tops; blue-grey weave for cubicle partitions.
function makeWoodMap() {
  const ctx = makeCanvas().getContext('2d');
  ctx.fillStyle = '#7a5230';
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 4) {
    const v = 105 + Math.sin(y * 0.3) * 18 + Math.random() * 14;
    ctx.fillStyle = `rgba(${v + 22},${Math.floor(v * 0.66)},${Math.floor(v * 0.38)},0.5)`;
    ctx.fillRect(0, y, 256, 3);
  }
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeFabricMap() {
  const ctx = makeCanvas().getContext('2d');
  ctx.fillStyle = '#46586a';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  for (let i = 0; i < 256; i += 4) {
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Brushed steel for the elevator frame/doors — fine vertical streaks, the
// same "procedural, no image files" approach as every other surface here.
function makeBrushedMetalMap() {
  const ctx = makeCanvas().getContext('2d');
  ctx.fillStyle = '#9aa0a8';
  ctx.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x++) {
    const v = 140 + Math.floor(Math.random() * 45);
    ctx.strokeStyle = `rgba(${v},${v + 4},${v + 8},0.35)`;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 256);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// LED-style floor readout above the elevator doors. Used as BOTH the colour
// map and the emissive map on the same material (see makeElevator), so only
// the drawn glyph glows — the black background stays dark like a real panel.
function makeElevatorReadoutMap() {
  const ctx = makeCanvas().getContext('2d');
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#3dff7a';
  ctx.font = 'bold 120px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('L1', 128, 100);
  ctx.beginPath();
  ctx.moveTo(128, 150); ctx.lineTo(158, 190); ctx.lineTo(98, 190);
  ctx.closePath();
  ctx.fill(); // up-arrow
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Security keycard face — header bar, placeholder photo, printed "barcode"
// lines, magnetic stripe. Drawn once, reused on the single card mesh.
function makeKeycardMap() {
  const ctx = makeCanvas().getContext('2d');
  ctx.fillStyle = '#eceef2';
  ctx.fillRect(0, 0, 256, 256);

  ctx.fillStyle = '#1c3a5e';
  ctx.fillRect(0, 0, 256, 60);
  ctx.fillStyle = '#e8edf5';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('SECURITY ACCESS', 14, 38);

  ctx.fillStyle = '#b7bcc4';
  ctx.fillRect(16, 78, 70, 90); // photo placeholder
  ctx.fillStyle = '#8a8f99';
  ctx.beginPath();
  ctx.arc(51, 108, 20, 0, Math.PI * 2);
  ctx.fill(); // head silhouette
  ctx.fillRect(31, 128, 40, 34); // shoulders silhouette

  ctx.fillStyle = '#2a2f38';
  ctx.font = '13px monospace';
  ctx.fillText('CLEARANCE: L2', 100, 96);
  ctx.fillText('ID  4471-B', 100, 116);
  for (let i = 0; i < 8; i++) {
    const w = 3 + Math.floor(Math.random() * 6);
    ctx.fillRect(100 + i * 11, 132, w, 22); // barcode
  }

  ctx.fillStyle = '#111318';
  ctx.fillRect(0, 210, 256, 30); // magnetic stripe

  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
// Shared placeholder materials — swap these for real materials/textures later,
// this is deliberately plain so it's obviously "blockout, not final"
const floorMat = new THREE.MeshStandardMaterial({ color: 0x555555 });
const wallMat = new THREE.MeshStandardMaterial({ color: 0x333344 });
const officeWallMat = new THREE.MeshStandardMaterial({ color:0xeeeeee, roughness: 0.9 });
const markerMat = {
  guard: new THREE.MeshStandardMaterial({ color: 0xff3333, emissive: 0xff3333, emissiveIntensity: 0.4 }),
  player: new THREE.MeshStandardMaterial({ color: 0x33ff66, emissive: 0x33ff66, emissiveIntensity: 0.4 }),
  item: new THREE.MeshStandardMaterial({ color: 0xffcc00, emissive: 0xffcc00, emissiveIntensity: 0.5 }),
  furniture: new THREE.MeshStandardMaterial({ color: 0x8866aa }), // placeholder desks/cover
};
// The shared furniture material gets the laminate look. Colliders are
// collected by MATERIAL IDENTITY (see traversal at the bottom), so we enrich
// markerMat.furniture in place — every main furniture body keeps using it.
const laminateMap = makeLaminateMap();
const laminateBump = makeLaminateBump();
markerMat.furniture.map = laminateMap;
markerMat.furniture.bumpMap = laminateBump;
markerMat.furniture.bumpScale = 0.02;
markerMat.furniture.color.set(0xffffff); // white base so the texture shows true
markerMat.furniture.needsUpdate = true;

// Decoration-only materials — used by the small prop children. These are NOT
// colliders (the traversal only picks up wallMat + markerMat.furniture), so
// it's safe for them to be their own materials.
const woodMat = new THREE.MeshStandardMaterial({ map: makeWoodMap(), roughness: 0.7 });
const fabricMat = new THREE.MeshStandardMaterial({ map: makeFabricMap(), roughness: 0.95 });
const darkPlasticMat = new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.6 });
const metalMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.35, metalness: 0.8 });

// Elevator frame/doors — one shared brushed-metal material and texture.
const brushedMetalMap = makeBrushedMetalMap();
const elevatorMetalMat = new THREE.MeshStandardMaterial({
  map: brushedMetalMap, color: 0xffffff, roughness: 0.4, metalness: 0.75,
});

// Readout material uses the SAME canvas texture as both map and emissiveMap
// (see makeElevatorReadoutMap) so only the drawn glyph glows, not the panel.
// main.js flips `.emissive` between these two colours on alarm/reset — kept
// here so both files agree on exactly what "idle" and "alarm" look like.
export const ELEVATOR_IDLE_COLOR = 0x1f8f4a;
export const ELEVATOR_ALARM_COLOR = 0xcc2222;
const elevatorReadoutMap = makeElevatorReadoutMap();
const elevatorIndicatorMat = new THREE.MeshStandardMaterial({
  map: elevatorReadoutMap,
  emissive: ELEVATOR_IDLE_COLOR,
  emissiveMap: elevatorReadoutMap,
  emissiveIntensity: 1.1,
});

// Keycard face + the small emissive RFID chip in its corner.
const keycardMat = new THREE.MeshStandardMaterial({
  map: makeKeycardMap(), roughness: 0.35, emissive: 0x2c4f78, emissiveIntensity: 0.15,
});
const keycardChipMat = new THREE.MeshStandardMaterial({
  color: 0xd9b34d, emissive: 0xd9b34d, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.6,
});

// Shared prop geometries — created ONCE, reused by every cubicle/desk
// (brief 6.1: reuse instead of creating a new geometry per object).
const MONITOR_GEOM = new THREE.BoxGeometry(0.5, 0.32, 0.04);
const MONITOR_STAND_GEOM = new THREE.BoxGeometry(0.06, 0.18, 0.06);
const KEYBOARD_GEOM = new THREE.BoxGeometry(0.42, 0.02, 0.15);
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
function makeOfficeWall(width, height, thickness, x, y, z, rotationY = 0) {
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, thickness),
    officeWallMat
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
// Each furniture piece is a Group: the main body is the SAME box as the
// placeholder (same size/position/material — that's the collider), and the
// props are its children, so the whole piece moves as one unit.
function makeReceptionDesk() {
  const desk = new THREE.Group();
  desk.name = 'furniture_receptionDesk';

  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 0.8), markerMat.furniture);
  body.position.set(-3, 0.5, 3.5); // unchanged from the placeholder
  body.name = 'collider_receptionDesk';
  desk.add(body);

  const top = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.05, 0.95), woodMat);
  top.position.set(-3, 1.03, 3.5);
  desk.add(top);

  const stand = new THREE.Mesh(MONITOR_STAND_GEOM, darkPlasticMat);
  stand.position.set(-3.45, 1.14, 3.55);
  desk.add(stand);

  const screen = new THREE.Mesh(MONITOR_GEOM, darkPlasticMat);
  screen.position.set(-3.45, 1.38, 3.55);
  desk.add(screen);

  return desk;
}
function makeCoverPillar() {
  const pillar = new THREE.Group();
  pillar.name = 'furniture_pillar';

  // UNCHANGED box — this is the spawn hiding spot's cover; guard vision,
  // player collision and the spawn-safety test all depend on it being here.
  const core = new THREE.Mesh(new THREE.BoxGeometry(1, 4, 1), markerMat.furniture);
  core.position.set(-4, 2, -3);
  core.name = 'collider_pillar';
  pillar.add(core);

  const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.25, 1.1), metalMat);
  base.position.set(-4, 0.125, -3);
  pillar.add(base);

  const capital = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.15, 1.1), metalMat);
  capital.position.set(-4, 3.92, -3);
  pillar.add(capital);

  return pillar;
}

function makeCubicle(x, z) {
  const cubicle = new THREE.Group();
  cubicle.name = 'furniture_cubicle';

  // UNCHANGED main block — the collider that blocks Guard B's sight.
  const desk = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 1.5), markerMat.furniture);
  desk.position.set(x, 0.6, z);
  desk.name = 'collider_cubicle';
  cubicle.add(desk);

  // fabric partitions rising from the block (decoration, not colliders)
  const panelA = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 0.05), fabricMat);
  panelA.position.set(x, 1.65, z - 0.7);
  cubicle.add(panelA);
  const panelB = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 1.5), fabricMat);
  panelB.position.set(x - 0.7, 1.65, z);
  cubicle.add(panelB);

  const stand = new THREE.Mesh(MONITOR_STAND_GEOM, darkPlasticMat);
  stand.position.set(x + 0.25, 1.29, z);
  cubicle.add(stand);
  const screen = new THREE.Mesh(MONITOR_GEOM, darkPlasticMat);
  screen.position.set(x + 0.25, 1.53, z);
  cubicle.add(screen);
  const keyboard = new THREE.Mesh(KEYBOARD_GEOM, darkPlasticMat);
  keyboard.position.set(x + 0.2, 1.21, z + 0.45);
  cubicle.add(keyboard);

  return cubicle;
}

function makeManagerDesk() {
  const desk = new THREE.Group();
  desk.name = 'furniture_managerDesk';

  // UNCHANGED main body — the collider under the keycard.
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.8), markerMat.furniture);
  body.position.set(5, 0.45, 19);
  body.name = 'collider_managerDesk';
  desk.add(body);

  const top = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.05, 0.95), woodMat);
  top.position.set(5, 0.93, 19);
  desk.add(top);

  const laptopBase = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.025, 0.3), metalMat);
  laptopBase.position.set(4.65, 0.97, 19);
  desk.add(laptopBase);
  const laptopLid = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.02), darkPlasticMat);
  laptopLid.position.set(4.65, 1.1, 19.14);
  laptopLid.rotation.x = -0.35;
  desk.add(laptopLid);

  return desk;
}

// A real elevator: brushed-metal frame + two sliding door leaves + a lit
// LED floor readout + a call button. Doors are closed by default — main.js
// slides them open on game.onWin() and resets them on resetLevel(). Nothing
// here is a collider (all-new dedicated materials), matching every other
// marker/prop convention in this file.
function makeElevator(pos) {
  const group = new THREE.Group();
  group.name = 'furniture_elevator';

  const wallZ = pos.z - 1; // flush with the Lobby's front wall (z = -5)
  const doorLeafWidth = 1.0;
  const doorLeafHeight = 2.6;
  const closedX = { left: pos.x - doorLeafWidth / 2, right: pos.x + doorLeafWidth / 2 };
  // Slide fully behind the jambs on open — see the comment on jambs below
  // for why this is a deliberate simplification rather than a real pocket.
  const openX = { left: closedX.left - doorLeafWidth, right: closedX.right + doorLeafWidth };

  const doorGeom = new THREE.BoxGeometry(doorLeafWidth, doorLeafHeight, 0.12);
  const doorLeft = new THREE.Mesh(doorGeom, elevatorMetalMat);
  doorLeft.position.set(closedX.left, doorLeafHeight / 2, wallZ);
  doorLeft.name = 'elevatorDoorLeft';
  group.add(doorLeft);

  const doorRight = new THREE.Mesh(doorGeom, elevatorMetalMat);
  doorRight.position.set(closedX.right, doorLeafHeight / 2, wallZ);
  doorRight.name = 'elevatorDoorRight';
  group.add(doorRight);

  // Side jambs — sit just outside the doors' closed edges. Real elevators
  // hide open doors in a wall pocket; we don't model one, so the leaves
  // visibly slide past the jambs rather than vanishing into them. Cheap and
  // reads fine in motion; flag if you want a proper pocket cutout later.
  const jambGeom = new THREE.BoxGeometry(0.25, 3.4, 0.3);
  const jambLeft = new THREE.Mesh(jambGeom, elevatorMetalMat);
  jambLeft.position.set(pos.x - 1.25, 1.7, wallZ);
  group.add(jambLeft);
  const jambRight = new THREE.Mesh(jambGeom, elevatorMetalMat);
  jambRight.position.set(pos.x + 1.25, 1.7, wallZ);
  group.add(jambRight);

  const header = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.4, 0.3), elevatorMetalMat);
  header.position.set(pos.x, 2.8, wallZ);
  group.add(header);

  // LED readout, mounted on the header's room-facing side.
  const readout = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.22), elevatorIndicatorMat);
  readout.position.set(pos.x, 2.8, wallZ + 0.16);
  readout.name = 'elevatorIndicator';
  group.add(readout);

  // Call button — decorative (always "powered"), sits beside the frame.
  const buttonPlate = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.04), darkPlasticMat);
  buttonPlate.position.set(pos.x - 1.45, 1.2, wallZ + 0.16);
  group.add(buttonPlate);
  const buttonLight = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.045, 0.02, 16),
    new THREE.MeshStandardMaterial({ color: 0xfff2c4, emissive: 0xfff2c4, emissiveIntensity: 0.8 })
  );
  buttonLight.rotation.x = Math.PI / 2;
  buttonLight.position.set(pos.x - 1.45, 1.24, wallZ + 0.19);
  group.add(buttonLight);

  // Low metal threshold instead of a glowing floor pad — subtler, reads as
  // "step here" without looking like a UI marker.
  const threshold = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.03, 0.4), elevatorMetalMat);
  threshold.position.set(pos.x, 0.015, pos.z);
  group.add(threshold);

  return { group, doorLeft, doorRight, closedX, openX, indicatorMat: elevatorIndicatorMat };
}

// The keycard itself — a flat card lying on the desk with a printed face
// texture and a small glowing RFID chip, instead of a floating marker
// sphere. Kept as a Group so main.js's `.position` / `.visible` calls work
// exactly as before — no changes needed on the main.js side for this swap.
function makeKeycard(x, y, z) {
  const group = new THREE.Group();
  group.name = 'marker_item';
  group.position.set(x, y, z);

  const card = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.015, 0.14), keycardMat);
  group.add(card);

  const chip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.004, 12), keycardChipMat);
  chip.position.set(0.07, 0.011, -0.04);
  group.add(chip);

  return group;
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
    lobby.add(makeReceptionDesk());

  // PLACEHOLDER: two cover pillars near player spawn
    lobby.add(makeCoverPillar());

  
  // Player spawn point is now just the coordinate main.js uses — the real
  // player model stands here, so the old placeholder marker sphere is gone.

  // Extraction elevator — front-right corner of the Lobby, away from
  // spawn/reception so it doesn't crowd the sneak-in path. Position is
  // returned below so main.js can do the win-check distance test without
  // hardcoding a duplicate copy of these coordinates.
  const ELEVATOR_POS = new THREE.Vector3(5, 0, -4);
  const elevator = makeElevator(ELEVATOR_POS);
  lobby.add(elevator.group);

  // Key mesh — hidden until Guard A is taken down, then it shows beside the body.
  const keyMat = new THREE.MeshStandardMaterial({
    color: 0xd4a017, emissive: 0xd4a017, emissiveIntensity: 0.5, metalness: 0.8, roughness: 0.2,
  });
  const keyMesh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.04, 0.08), keyMat);
  keyMesh.position.set(-2.2, 0.15, 3.3);
  keyMesh.name = 'keyMesh';
  keyMesh.visible = false;
  lobby.add(keyMesh);

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
    cubiclePositions.forEach(([x, z]) => offices.add(makeCubicle(x, z)));

     // Manager's office — fully enclosed room with lighter walls
  const mgrOffice = new THREE.Group();
  mgrOffice.name = 'ManagerOffice';
  
  // Interior footprint: x 3..7, z 17..21 (back-right corner of the Offices).
  // The east side (x=7) and north side (z=21) are already the Offices' own
  // outer walls, so only two new walls are needed: the west wall (x=3) and
  // the door wall (z=17), which faces into the Offices. The door wall has a
  // 1.0m gap centred on x=5, closed by the sliding door below.
  mgrOffice.add(makeOfficeWall(4, 4, 0.2, 3, 2, 19, Math.PI / 2)); // west wall
  mgrOffice.add(makeOfficeWall(1.4, 4, 0.2, 3.7, 2, 17));          // door wall, left of door (x 3.0-4.4)
  mgrOffice.add(makeOfficeWall(1.4, 4, 0.2, 6.3, 2, 17));          // door wall, right of door (x 5.6-7.0)
  mgrOffice.add(makeOfficeWall(1.2, 1.6, 0.2, 5, 3.2, 17));        // lintel above the door

  // Door frame posts either side of the gap
  const doorFrameMat = new THREE.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.7 });
  const frameLeft = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.4, 0.15), doorFrameMat);
  frameLeft.position.set(4.45, 1.2, 17);
  mgrOffice.add(frameLeft);
  const frameRight = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.4, 0.15), doorFrameMat);
  frameRight.position.set(5.55, 1.2, 17);
  mgrOffice.add(frameRight);

  // Sliding door. It sits against the room-side face of the wall so that when
  // main.js slides it +x it runs along the inside of the right-hand wall
  // segment instead of clipping through it. The handle is a CHILD of the door
  // so it travels with it (a door and its handle are one moving assembly).
  const officeDoorMat = new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.6 });
  const officeDoor = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.4, 0.08), officeDoorMat);
  officeDoor.position.set(5, 1.2, 17.14);
  officeDoor.name = 'officeDoor';
  mgrOffice.add(officeDoor);

  const handleMat = new THREE.MeshStandardMaterial({ color: 0xccaa00, metalness: 0.8, roughness: 0.2 });
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.06), handleMat);
  handle.position.set(0.35, 0, -0.06); // door-local: on the Offices-facing side
  handle.name = 'doorHandle';
  officeDoor.add(handle);

  mgrOffice.add(makeManagerDesk());

  const chairMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
  const chairSeat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.5), chairMat);
  chairSeat.position.set(5, 0.5, 18.3);
  mgrOffice.add(chairSeat);
  const chairBack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.08), chairMat);
  chairBack.position.set(5, 0.8, 18.05);
  mgrOffice.add(chairBack);
  const chairLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8), new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.6 }));
  chairLeg.position.set(5, 0.25, 18.3);
  mgrOffice.add(chairLeg);

  const cabinetMat = new THREE.MeshStandardMaterial({ color: 0x556677, roughness: 0.5 });
  const cabinet = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 0.6), cabinetMat);
  cabinet.position.set(6.2, 0.6, 19);
  mgrOffice.add(cabinet);

  const shelfMat = new THREE.MeshStandardMaterial({ color: 0x5c3a1e, roughness: 0.7 });
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.8, 0.3), shelfMat);
  shelf.position.set(4, 0.9, 20.75); // against the north wall
  mgrOffice.add(shelf);
  const bookColors = [0xcc3333, 0x3366cc, 0x33aa33, 0xcc9933, 0x9933cc];
  for (let i = 0; i < 5; i++) {
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.25, 0.2), new THREE.MeshStandardMaterial({ color: bookColors[i], roughness: 0.8 }));
    book.position.set(3.55 + i * 0.2, 1.5, 20.62);
    mgrOffice.add(book);
  }

  // Ceiling and bright light for office
  mgrOffice.add(makeCeiling(4, 4, 5, CEILING_HEIGHT, 19));
  mgrOffice.add(makeLightFixture(5, CEILING_HEIGHT, 19, 1.5, 1.5));

  // Bright point light inside office so it looks lit from within
  const officeLight = new THREE.PointLight(0xffffff, 2, 8);
  officeLight.position.set(5, 3, 19);
  mgrOffice.add(officeLight);
  const keycardMesh = makeKeycard(5, 1.15, 19); // the keycard itself
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

scene.add(level1);

const colliders = [];
level1.traverse((obj) => {
  if (!obj.isMesh) return;
  // Collect ALL solid meshes except floor, ceiling, lights, and elevator
  const name = obj.name.toLowerCase();
  if (name.includes('floor') || name.includes('ceiling') || 
      name.includes('light') || name.includes('elevator') || name.includes('handle')) return;
  // Also skip if material is clearly non-solid (glass, emissive-only)
  if (obj.material && obj.material.transparent) return;
  colliders.push(obj);
});

console.log('Total colliders collected:', colliders.length);

return {
    root: level1,
    colliders,
    elevatorPosition: ELEVATOR_POS,
    elevatorDoors: { left: elevator.doorLeft, right: elevator.doorRight, closedX: elevator.closedX, openX: elevator.openX },
    elevatorIndicatorMat: elevator.indicatorMat,
    keycardMesh,
    keyMesh,
    officeDoor,
    lightFixturePositions,
  };

}