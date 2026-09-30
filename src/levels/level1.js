import * as THREE from 'three';

// ---- ROOM SCALE ----------------------------------------------------------
// Horizontal multiplier applied to every room footprint, wall position,
// doorway, furniture position and light fixture. Wall/ceiling HEIGHT and
// the size of props (desks, monitors, doors, elevator) are NOT scaled, so
// the rooms get bigger without the furniture turning into giant props.
// 1 = original layout. main.js must use the same factor for any hardcoded
// coordinates (spawn, guard positions, patrol waypoints, etc).
export const ROOM_SCALE = 1.5;
const S = ROOM_SCALE;
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
const lightFrameMat = new THREE.MeshStandardMaterial({ color: 0x2b2b33, roughness: 0.5, metalness: 0.4 });
// Fixture panels are lit from WITHIN (emissive) so they read as light sources
// even before the matching real PointLight (added in main.js) reaches them.
const fixtureMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xfff4e0,
  emissiveIntensity: 1.4,
});

function makeFloor(width, depth, x, z, material = floorMat) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
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
  // Trim frame: four thin bars around the panel. Children of the plane, so
  // they're in its local space (local x = world x, local y = world z).
  const t = 0.06;
  [[0, -depth / 2, width + t, t], [0, depth / 2, width + t, t],
   [-width / 2, 0, t, depth + t], [width / 2, 0, t, depth + t]].forEach(([bx, by, bw, bd]) => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, bd, t), lightFrameMat);
    bar.position.set(bx, by, 0.02);
    bar.name = 'light_frame';
    bar.userData.noCollide = true;
    fixture.add(bar);
  });
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

  const dx = -3 * S, dz = 3.5 * S;
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 0.8), markerMat.furniture);
  body.position.set(dx, 0.5, dz);
  body.name = 'collider_receptionDesk';
  desk.add(body);

  const top = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.05, 0.95), woodMat);
  top.position.set(dx, 1.03, dz);
  desk.add(top);

  const stand = new THREE.Mesh(MONITOR_STAND_GEOM, darkPlasticMat);
  stand.position.set(dx - 0.45, 1.14, dz + 0.05);
  desk.add(stand);

  const screen = new THREE.Mesh(MONITOR_GEOM, darkPlasticMat);
  screen.position.set(dx - 0.45, 1.38, dz + 0.05);
  desk.add(screen);

  // Teal front panel on the visitor side (-z) so it reads as a reception counter
  desk.add(box(2.0, 0.7, 0.04, accentMat, dx, 0.47, dz - 0.42));
  // Desk accessories
  desk.add(box(0.2, 0.06, 0.16, darkPlasticMat, dx + 0.3, 1.08, dz + 0.1));            // phone
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.03, 16), metalMat);
  bell.position.set(dx - 0.05, 1.07, dz - 0.25); desk.add(bell);                        // service bell
  const penCup = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.1, 12), darkPlasticMat);
  penCup.position.set(dx + 0.85, 1.11, dz - 0.2); desk.add(penCup);
  const plaque = box(0.3, 0.08, 0.02, metalMat, dx + 0.35, 1.09, dz - 0.36);
  plaque.rotation.x = -0.4; desk.add(plaque);                                           // name plaque
  desk.add(box(0.22, 0.012, 0.3, paperMat, dx - 0.75, 1.06, dz + 0.1));                 // paperwork

  // Desk lamp — emissive shade + a small warm real light
  const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.02, 16), metalMat);
  lampBase.position.set(dx + 0.7, 1.07, dz + 0.22); desk.add(lampBase);
  const lampArm = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.35, 8), metalMat);
  lampArm.position.set(dx + 0.7, 1.25, dz + 0.22); desk.add(lampArm);
  const lampShade = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.12, 16, 1, true), warmShadeMat);
  lampShade.position.set(dx + 0.7, 1.45, dz + 0.22);
  lampShade.name = 'light_desk_shade'; lampShade.userData.noCollide = true; desk.add(lampShade);
  const deskLight = new THREE.PointLight(0xffd9a0, 1.2, 4);
  deskLight.position.set(dx + 0.7, 1.35, dz + 0.22); desk.add(deskLight);

  // Receptionist's chair, behind the desk (wall side)
  const cz = dz + 0.95;
  desk.add(box(0.55, 0.08, 0.55, darkPlasticMat, dx, 0.5, cz));
  desk.add(box(0.55, 0.6, 0.08, darkPlasticMat, dx, 0.85, cz + 0.27));
  const chairPost = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 8), metalMat);
  chairPost.position.set(dx, 0.25, cz); desk.add(chairPost);
  desk.add(box(0.6, 0.03, 0.06, metalMat, dx, 0.03, cz));
  desk.add(box(0.06, 0.03, 0.6, metalMat, dx, 0.03, cz));

  return desk;
}
function makeCoverPillar() {
  const pillar = new THREE.Group();
  pillar.name = 'furniture_pillar';

  // UNCHANGED box — this is the spawn hiding spot's cover; guard vision,
  // player collision and the spawn-safety test all depend on it being here.
  const px = -4 * S, pz = -3 * S;
  const core = new THREE.Mesh(new THREE.BoxGeometry(1, 4, 1), markerMat.furniture);
  core.position.set(px, 2, pz);
  core.name = 'collider_pillar';
  pillar.add(core);

  const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.25, 1.1), metalMat);
  base.position.set(px, 0.125, pz);
  pillar.add(base);

  const capital = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.15, 1.1), metalMat);
  capital.position.set(px, 3.92, pz);
  pillar.add(capital);

  return pillar;
}

function makeCubicle(x, z, variant = 0) {
  const cubicle = new THREE.Group();
  cubicle.name = 'furniture_cubicle';

  // UNCHANGED main block — the collider that blocks Guard B's sight.
  const desk = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 1.5), markerMat.furniture);
  desk.position.set(x, 0.6, z);
  desk.name = 'collider_cubicle';
  cubicle.add(desk);

  // fabric partitions rising from the block, with a metal trim strip on top
  const panelA = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 0.05), fabricMat);
  panelA.position.set(x, 1.65, z - 0.7);
  cubicle.add(panelA);
  const panelB = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 1.5), fabricMat);
  panelB.position.set(x - 0.7, 1.65, z);
  cubicle.add(panelB);
  cubicle.add(decor(box(1.5, 0.03, 0.07, metalMat, x, 2.11, z - 0.7)));
  cubicle.add(decor(box(0.07, 0.03, 1.5, metalMat, x - 0.7, 2.11, z)));

  // monitor with a glowing desktop on the face (user sits on the +z side)
  const stand = new THREE.Mesh(MONITOR_STAND_GEOM, darkPlasticMat);
  stand.position.set(x + 0.25, 1.29, z);
  cubicle.add(decor(stand));
  const screen = new THREE.Mesh(MONITOR_GEOM, darkPlasticMat);
  screen.position.set(x + 0.25, 1.53, z);
  cubicle.add(decor(screen));
  const glow = new THREE.Mesh(SCREEN_GLOW_GEOM, screenMat);
  glow.position.set(x + 0.25, 1.53, z + 0.022);
  glow.name = 'light_screen';
  cubicle.add(decor(glow));
  const keyboard = new THREE.Mesh(KEYBOARD_GEOM, darkPlasticMat);
  keyboard.position.set(x + 0.2, 1.21, z + 0.45);
  cubicle.add(decor(keyboard));
  cubicle.add(decor(box(0.07, 0.03, 0.11, darkPlasticMat, x + 0.55, 1.215, z + 0.45))); // mouse

  // desk clutter — varies a little per cubicle so the room doesn't look cloned
  const mugColors = [0xc0392b, 0x2c7fb8, 0xf2c14e, 0x3a9d5d, 0xeeeeee];
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.09, 12),
    new THREE.MeshStandardMaterial({ color: mugColors[variant % mugColors.length], roughness: 0.5 }));
  mug.position.set(x - 0.4, 1.245, z + 0.3);
  cubicle.add(decor(mug));
  const papers = box(0.22, 0.012, 0.3, paperMat, x - 0.35, 1.206, z + 0.0);
  papers.rotation.y = 0.25 * ((variant % 3) - 1);
  cubicle.add(decor(papers));
  cubicle.add(decor(box(0.16, 0.05, 0.2, darkPlasticMat, x + 0.6, 1.225, z + 0.15))); // desk phone
  if (variant % 2 === 0) { // tiny desk plant
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.08, 10), potMat);
    pot.position.set(x + 0.6, 1.24, z - 0.35);
    cubicle.add(decor(pot));
    const tuft = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), leafMat);
    tuft.position.set(x + 0.6, 1.32, z - 0.35);
    cubicle.add(decor(tuft));
  } else { // framed photo
    const photo = box(0.12, 0.09, 0.015, darkWoodMat, x + 0.6, 1.25, z - 0.35);
    photo.rotation.y = -0.3;
    cubicle.add(decor(photo));
  }

  // sticky notes on the partition
  [[0.3, 1.9, stickyMats[0]], [0.12, 1.78, stickyMats[1]], [-0.35, 1.85, stickyMats[2]]].forEach(([ox, oy, m], i) => {
    const note = new THREE.Mesh(STICKY_GEOM, m);
    note.position.set(x + ox, oy, z - 0.672);
    note.rotation.z = (i - 1) * 0.12 + (variant % 3) * 0.05;
    cubicle.add(decor(note));
  });

  // office chair, pulled out behind the desk (seat/base are soft, post + back block)
  const chair = new THREE.Group();
  chair.position.set(x, 0, z + 1.25);
  chair.rotation.y = 0.35 * (((variant * 7) % 5) - 2) / 2;
  const cSeat = box(0.5, 0.08, 0.5, darkPlasticMat, 0, 0.48, 0);
  chair.add(decor(cSeat));
  const cBack = box(0.5, 0.55, 0.07, darkPlasticMat, 0, 0.85, 0.25);
  chair.add(cBack);
  const cPost = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.42, 8), metalMat);
  cPost.position.set(0, 0.23, 0);
  chair.add(cPost);
  chair.add(decor(box(0.6, 0.03, 0.07, metalMat, 0, 0.03, 0)));
  const cBase2 = box(0.07, 0.03, 0.6, metalMat, 0, 0.03, 0);
  chair.add(decor(cBase2));
  cubicle.add(chair);

  return cubicle;
}

// The Manager's desk. Everything is positioned from MGR so it follows the
// room if ROOM_SCALE changes. The keycard is placed on it by createLevel1.
function makeManagerDesk() {
  const desk = new THREE.Group();
  desk.name = 'furniture_managerDesk';
  const dx = MGR.cx, dz = MGR.deskZ;

  // Main body — the solid collider under the keycard (bigger executive desk now).
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 1.0), markerMat.furniture);
  body.position.set(dx, 0.45, dz);
  body.name = 'collider_managerDesk';
  desk.add(body);

  desk.add(box(2.55, 0.05, 1.12, woodMat, dx, 0.93, dz));                           // wood top
  desk.add(decor(box(2.3, 0.7, 0.03, darkWoodMat, dx, 0.45, dz - 0.515)));           // front modesty panel
  desk.add(decor(box(0.9, 0.012, 0.5, execLeatherMat, dx + 0.05, 0.962, dz + 0.1))); // leather desk pad

  // Laptop (screen faces the manager's chair on the +z side)
  desk.add(decor(box(0.42, 0.025, 0.3, metalMat, dx - 0.7, 0.98, dz + 0.12)));
  const lid = box(0.42, 0.3, 0.02, darkPlasticMat, dx - 0.7, 1.12, dz - 0.03);
  lid.rotation.x = -0.3;
  const lidGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.26), screenMat);
  lidGlow.position.z = 0.011;
  lidGlow.name = 'light_laptop_screen';
  lid.add(decor(lidGlow));
  desk.add(decor(lid));

  // Desktop monitor + keyboard
  const mStand = new THREE.Mesh(MONITOR_STAND_GEOM, darkPlasticMat);
  mStand.position.set(dx + 0.6, 1.045, dz - 0.15);
  desk.add(decor(mStand));
  const mScreen = box(0.62, 0.38, 0.04, darkPlasticMat, dx + 0.6, 1.325, dz - 0.15);
  desk.add(decor(mScreen));
  const mGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.32), screenMat);
  mGlow.position.set(dx + 0.6, 1.325, dz - 0.15 + 0.021);
  mGlow.name = 'light_monitor_screen';
  desk.add(decor(mGlow));
  const kb = new THREE.Mesh(KEYBOARD_GEOM, darkPlasticMat);
  kb.position.set(dx + 0.55, 0.972, dz + 0.28);
  desk.add(decor(kb));

  // Accessories
  desk.add(decor(box(0.2, 0.06, 0.16, darkPlasticMat, dx - 1.0, 0.985, dz + 0.2)));   // phone
  const plate = box(0.4, 0.07, 0.03, metalMat, dx - 0.25, 0.995, dz - 0.38);
  plate.rotation.x = 0.4;
  desk.add(decor(plate));                                                              // name plate
  const stack = box(0.22, 0.03, 0.3, paperMat, dx - 0.25, 0.975, dz + 0.25);
  stack.rotation.y = 0.2;
  desk.add(decor(stack));                                                              // paperwork
  const penCup = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.1, 12), darkPlasticMat);
  penCup.position.set(dx + 1.0, 1.005, dz + 0.2);
  desk.add(decor(penCup));
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.09, 12),
    new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.4 }));
  cup.position.set(dx + 0.95, 1.0, dz - 0.3);
  desk.add(decor(cup));

  // Brass desk lamp with a real warm light
  const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.02, 16), metalMat);
  lampBase.position.set(dx - 1.0, 0.97, dz - 0.3);
  desk.add(decor(lampBase));
  const lampArm = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.36, 8), metalMat);
  lampArm.position.set(dx - 1.0, 1.15, dz - 0.3);
  desk.add(decor(lampArm));
  const lampShade = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.13, 16, 1, true), warmShadeMat);
  lampShade.position.set(dx - 1.0, 1.36, dz - 0.3);
  lampShade.name = 'light_mgr_desk_shade';
  desk.add(decor(lampShade));
  const lampLight = new THREE.PointLight(0xffd9a0, 1.0, 4);
  lampLight.position.set(dx - 1.0, 1.3, dz - 0.3);
  desk.add(lampLight);

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

// ---- RECEPTION DRESSING --------------------------------------------------
// Everything below is decoration for the Lobby. Anything soft/flat/wall-mounted
// is flagged userData.noCollide so createLevel1's collider traversal skips it
// (you can't walk "into" a rug or a picture frame).
function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}
const decor = (o) => { o.userData.noCollide = true; return o; };
function canvasWH(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function srgbTex(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeTileMap() {
  const ctx = makeCanvas().getContext('2d');
  ctx.fillStyle = '#8f8a80'; ctx.fillRect(0, 0, 256, 256); // grout
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const v = (i + j) % 2 ? 205 : 192;
    ctx.fillStyle = `rgb(${v},${v - 3},${v - 10})`;
    ctx.fillRect(i * 128 + 2, j * 128 + 2, 124, 124);
    ctx.strokeStyle = 'rgba(110,104,94,0.14)';
    for (let k = 0; k < 3; k++) { // faint marble veining
      ctx.beginPath();
      ctx.moveTo(i * 128 + 2 + Math.random() * 124, j * 128 + 2);
      ctx.quadraticCurveTo(i * 128 + Math.random() * 124, j * 128 + 64, i * 128 + 2 + Math.random() * 124, j * 128 + 126);
      ctx.stroke();
    }
  }
  const tex = srgbTex(ctx.canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set((12 * S) / 2.4, (10 * S) / 2.4); // one canvas = 2x2 tiles = 2.4m
  return tex;
}

function makeLogoMap() {
  const ctx = canvasWH(1024, 256).getContext('2d');
  ctx.fillStyle = '#16202b'; ctx.fillRect(0, 0, 1024, 256);
  ctx.fillStyle = '#22a6a6';
  ctx.beginPath(); // hexagon mark
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 3 * i + Math.PI / 6;
    ctx.lineTo(130 + 78 * Math.cos(a), 128 + 78 * Math.sin(a));
  }
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#16202b'; ctx.font = 'bold 90px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('N', 130, 134);
  ctx.textAlign = 'left'; ctx.fillStyle = '#eef3f7'; ctx.font = 'bold 118px sans-serif';
  ctx.fillText('NOVATEK', 250, 112);
  ctx.fillStyle = '#22a6a6'; ctx.font = '48px sans-serif';
  ctx.fillText('I N D U S T R I E S', 256, 200);
  return srgbTex(ctx.canvas);
}

function makeDirectoryMap() {
  const ctx = canvasWH(256, 341).getContext('2d');
  ctx.fillStyle = '#1b2530'; ctx.fillRect(0, 0, 256, 341);
  ctx.fillStyle = '#22a6a6'; ctx.fillRect(0, 0, 256, 54);
  ctx.fillStyle = '#eef3f7'; ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('DIRECTORY', 128, 28);
  ctx.textAlign = 'left'; ctx.font = '20px monospace';
  [['LOBBY', 'RECEPTION'], ['OFFICES', 'MANAGEMENT'], ['LEVEL 2', 'SERVER ROOM'], ['LEVEL 3', 'VAULT WING']].forEach(([a, b], i) => {
    ctx.fillStyle = '#22a6a6'; ctx.fillText(a, 18, 100 + i * 62);
    ctx.fillStyle = '#c9d3dc'; ctx.fillText(b, 18, 124 + i * 62);
  });
  return srgbTex(ctx.canvas);
}

function makeArtMap(variant) {
  const ctx = canvasWH(384, 256).getContext('2d');
  if (variant === 0) { // sunset + hills
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#2b3a67'); g.addColorStop(0.6, '#e07a5f'); g.addColorStop(1, '#f2cc8f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 384, 256);
    ctx.fillStyle = '#f4f1de'; ctx.beginPath(); ctx.arc(250, 120, 38, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3d405b'; ctx.beginPath(); ctx.moveTo(0, 256); ctx.lineTo(0, 190);
    ctx.quadraticCurveTo(120, 140, 230, 200); ctx.quadraticCurveTo(320, 170, 384, 200); ctx.lineTo(384, 256); ctx.fill();
  } else { // geometric blocks
    ctx.fillStyle = '#f4f1de'; ctx.fillRect(0, 0, 384, 256);
    [['#22a6a6', 30, 30, 140, 190], ['#e07a5f', 190, 60, 160, 90], ['#3d405b', 190, 160, 80, 60], ['#f2cc8f', 280, 160, 70, 60]].forEach(([c, x, y, w, h]) => {
      ctx.fillStyle = c; ctx.fillRect(x, y, w, h);
    });
  }
  return srgbTex(ctx.canvas);
}

function makeClockMap() {
  const ctx = makeCanvas().getContext('2d');
  ctx.fillStyle = '#f4f4f0'; ctx.beginPath(); ctx.arc(128, 128, 124, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#222'; ctx.lineWidth = 6;
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    ctx.beginPath();
    ctx.moveTo(128 + 100 * Math.sin(a), 128 - 100 * Math.cos(a));
    ctx.lineTo(128 + 118 * Math.sin(a), 128 - 118 * Math.cos(a));
    ctx.stroke();
  }
  ctx.lineWidth = 9; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(128, 128); ctx.lineTo(128 - 52, 128 - 30); ctx.stroke(); // hour
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(128, 128); ctx.lineTo(128 + 50, 128 - 78); ctx.stroke(); // minute
  return srgbTex(ctx.canvas);
}

function makeRugMap() {
  const ctx = canvasWH(256, 192).getContext('2d');
  ctx.fillStyle = '#34495e'; ctx.fillRect(0, 0, 256, 192);
  ctx.strokeStyle = '#c9a66b'; ctx.lineWidth = 6; ctx.strokeRect(12, 12, 232, 168);
  ctx.lineWidth = 2; ctx.strokeRect(24, 24, 208, 144);
  ctx.fillStyle = '#3f5b73';
  for (let x = 48; x < 230; x += 40) for (let y = 48; y < 160; y += 40) {
    ctx.beginPath(); ctx.moveTo(x, y - 14); ctx.lineTo(x + 14, y); ctx.lineTo(x, y + 14); ctx.lineTo(x - 14, y); ctx.closePath(); ctx.fill();
  }
  return srgbTex(ctx.canvas);
}

// Dressing-only materials
const lobbyFloorMat = new THREE.MeshStandardMaterial({ map: makeTileMap(), roughness: 0.25, metalness: 0.05 });
const accentMat = new THREE.MeshStandardMaterial({ color: 0x1f7a7a, roughness: 0.4 });
const paperMat = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.9 });
const warmShadeMat = new THREE.MeshStandardMaterial({
  color: 0xfff0d0, emissive: 0xffd9a0, emissiveIntensity: 1.0, side: THREE.DoubleSide,
});
const leatherMat = new THREE.MeshStandardMaterial({ color: 0x2f4858, roughness: 0.55 });
const cushionMat = new THREE.MeshStandardMaterial({ color: 0x3b5a6e, roughness: 0.85 });
const darkWoodMat = new THREE.MeshStandardMaterial({ color: 0x3b2a1c, roughness: 0.6 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x9cc3dd, transparent: true, opacity: 0.25, roughness: 0.05 });
const potMat = new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.4 });
const soilMat = new THREE.MeshStandardMaterial({ color: 0x2a1d14, roughness: 1 });
const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f7d3a, roughness: 0.8, flatShading: true });
const skirtMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.5 });
const coolerMat = new THREE.MeshStandardMaterial({ color: 0xe6eaee, roughness: 0.4 });
const jugMat = new THREE.MeshStandardMaterial({ color: 0x6fb7ff, transparent: true, opacity: 0.55, roughness: 0.1 });
const exitSignMat = new THREE.MeshStandardMaterial({ color: 0x0a3d1a, emissive: 0x3dff7a, emissiveIntensity: 1.2 });
const logoMap = makeLogoMap();
const signMat = new THREE.MeshStandardMaterial({ map: logoMap, emissiveMap: logoMap, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.5 });
const directoryMat = new THREE.MeshStandardMaterial({ map: makeDirectoryMap(), roughness: 0.5 });
const clockMat = new THREE.MeshStandardMaterial({ map: makeClockMap(), roughness: 0.4 });
const rugMat = new THREE.MeshStandardMaterial({ map: makeRugMap(), roughness: 1 });
const artMats = [0, 1].map((v) => new THREE.MeshStandardMaterial({ map: makeArtMap(v), roughness: 0.6 }));

// Sofa / armchair. Front faces local +z; rotate with rotY (use multiples of PI/2
// so each part's bounding box stays axis-aligned for collisions).
function makeCouch(x, z, rotY, width = 2.0) {
  const g = new THREE.Group();
  g.name = 'furniture_couch';
  g.position.set(x, 0, z);
  g.rotation.y = rotY;

  const base = box(width, 0.42, 0.9, leatherMat, 0, 0.31, 0);
  base.name = 'collider_couch';
  g.add(base);
  g.add(box(width, 0.55, 0.2, leatherMat, 0, 0.795, -0.35));        // back
  [-1, 1].forEach((sx) => g.add(box(0.2, 0.3, 0.9, leatherMat, sx * (width / 2 - 0.1), 0.67, 0))); // arms
  const n = width > 1.4 ? 2 : 1;
  const inner = width - 0.4, cw = inner / n;
  for (let i = 0; i < n; i++) {
    const cx = -inner / 2 + cw * (i + 0.5);
    g.add(box(cw - 0.02, 0.14, 0.62, cushionMat, cx, 0.59, 0.1));   // seat cushion
    const bc = box(cw - 0.02, 0.4, 0.14, cushionMat, cx, 0.86, -0.17); // back cushion
    bc.rotation.x = -0.15;
    g.add(bc);
  }
  [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([sx, sz]) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 8), metalMat);
    leg.position.set(sx * (width / 2 - 0.08), 0.05, sz * 0.38);
    g.add(leg);
  });
  return g;
}

function makeCoffeeTable(x, z) {
  const g = new THREE.Group();
  g.name = 'furniture_coffeeTable';
  const top = box(1.1, 0.05, 0.6, darkWoodMat, x, 0.44, z);
  top.name = 'collider_coffeeTable';
  g.add(top);
  g.add(box(0.95, 0.03, 0.48, darkWoodMat, x, 0.16, z)); // lower shelf
  [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([sx, sz]) => g.add(box(0.05, 0.42, 0.05, metalMat, x + sx * 0.5, 0.21, z + sz * 0.25)));
  // magazines + a small vase
  const mag1 = box(0.26, 0.012, 0.34, new THREE.MeshStandardMaterial({ color: 0xc0392b }), x - 0.25, 0.476, z);
  mag1.rotation.y = 0.2; g.add(mag1);
  const mag2 = box(0.26, 0.012, 0.34, new THREE.MeshStandardMaterial({ color: 0x2c7fb8 }), x - 0.2, 0.488, z + 0.03);
  mag2.rotation.y = -0.15; g.add(mag2);
  const vase = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.18, 12), potMat);
  vase.position.set(x + 0.3, 0.565, z); g.add(vase);
  const sprig = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 0), leafMat);
  sprig.position.set(x + 0.3, 0.72, z); g.add(decor(sprig));
  return g;
}

function makePlant(x, z, scale = 1) {
  const g = new THREE.Group();
  g.name = 'furniture_plant';
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.28 * scale, 0.22 * scale, 0.55 * scale, 16), potMat);
  pot.position.set(x, 0.275 * scale, z);
  pot.name = 'collider_plantPot';
  g.add(pot);
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.26 * scale, 0.26 * scale, 0.02, 16), soilMat);
  soil.position.set(x, 0.56 * scale, z);
  g.add(decor(soil));
  [[0, 0.95, 0, 0.32], [0.18, 1.2, 0.1, 0.26], [-0.16, 1.15, -0.08, 0.27], [0.05, 1.45, -0.05, 0.22], [-0.08, 0.8, 0.17, 0.22]].forEach(([ox, oy, oz, r]) => {
    const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(r * scale, 0), leafMat);
    leaves.position.set(x + ox * scale, oy * scale, z + oz * scale);
    g.add(decor(leaves)); // foliage is soft — the pot is the collider
  });
  return g;
}

function makeWaterCooler(x, z) {
  const g = new THREE.Group();
  g.name = 'furniture_waterCooler';
  const body = box(0.36, 0.95, 0.36, coolerMat, x, 0.475, z);
  body.name = 'collider_waterCooler';
  g.add(body);
  const jug = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.4, 16), jugMat);
  jug.position.set(x, 1.15, z);
  g.add(jug);
  g.add(decor(box(0.06, 0.04, 0.05, new THREE.MeshStandardMaterial({ color: 0x3377cc }), x + 0.1, 0.85, z + 0.19)));
  g.add(decor(box(0.06, 0.04, 0.05, new THREE.MeshStandardMaterial({ color: 0xcc3333 }), x - 0.1, 0.85, z + 0.19)));
  return g;
}

function makeFramedArt(x, y, z, rotY, w, h, variant) {
  const g = new THREE.Group();
  g.name = 'decor_art';
  g.position.set(x, y, z);
  g.rotation.y = rotY; // local +z is the picture's front
  g.add(decor(box(w, h, 0.04, darkWoodMat, 0, 0, 0)));
  const pic = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.12, h - 0.12), artMats[variant]);
  pic.position.z = 0.021;
  g.add(decor(pic));
  return g;
}

function makeWallClock(x, y, z) {
  const g = new THREE.Group();
  g.name = 'decor_clock';
  g.position.set(x, y, z);
  g.rotation.y = Math.PI; // faces -z, into the Lobby
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 24), metalMat);
  rim.rotation.x = Math.PI / 2;
  g.add(decor(rim));
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.25, 24), clockMat);
  face.position.z = 0.021;
  g.add(decor(face));
  return g;
}

function makeFloorLamp(x, z, withLight = true) {
  const g = new THREE.Group();
  g.name = 'furniture_floorLamp';
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.04, 16), metalMat);
  base.position.set(x, 0.02, z);
  g.add(base);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 8), metalMat);
  pole.position.set(x, 0.79, z);
  g.add(decor(pole));
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.24, 0.32, 20, 1, true), warmShadeMat);
  shade.position.set(x, 1.66, z);
  shade.name = 'light_floorLamp_shade';
  g.add(decor(shade));
  if (withLight) {
    const glow = new THREE.PointLight(0xffd9a0, 2.5, 7);
    glow.position.set(x, 1.6, z);
    g.add(glow);
  }
  return g;
}

function makeEntranceDoors(x, z) {
  const g = new THREE.Group();
  g.name = 'decor_entrance';
  g.position.set(x, 0, z);
  g.add(box(0.1, 2.6, 0.12, metalMat, -1.25, 1.3, 0));
  g.add(box(0.1, 2.6, 0.12, metalMat, 1.25, 1.3, 0));
  g.add(box(2.6, 0.1, 0.12, metalMat, 0, 2.6, 0));
  g.add(box(0.06, 2.5, 0.12, metalMat, 0, 1.3, 0)); // centre mullion
  [-0.6, 0.6].forEach((px) => g.add(decor(box(1.1, 2.45, 0.03, glassMat, px, 1.27, 0))));
  [-0.15, 0.15].forEach((px) => { // push bars
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.7, 8), metalMat);
    bar.position.set(px, 1.1, 0.07);
    g.add(decor(bar));
  });
  const sign = box(0.5, 0.18, 0.06, exitSignMat, 0, 2.85, 0.06);
  sign.name = 'light_exit_sign';
  g.add(decor(sign));
  return g;
}

function addLobbyDressing(lobby) {
  const g = new THREE.Group();
  g.name = 'LobbyDressing';

  // ---- wall dressing (inner faces: back wall z=7.4, front z=-7.4, sides x=+-8.9)
  const backZ = 5 * S - 0.1, frontZ = -5 * S + 0.1, sideX = 6 * S - 0.1;

  // Company sign above the reception desk (desk is at x = -3*S)
  const signBack = box(3.8, 1.1, 0.06, darkWoodMat, -3 * S, 2.7, backZ - 0.03);
  g.add(decor(signBack));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), signMat);
  sign.position.set(-3 * S, 2.7, backZ - 0.07);
  sign.rotation.y = Math.PI; // faces -z
  g.add(decor(sign));

  g.add(makeWallClock(-3 * S - 2.6, 2.9, backZ - 0.03));

  // Directory board beside the corridor opening
  g.add(decor(box(1.0, 1.3, 0.05, metalMat, 3.2, 1.7, backZ - 0.025)));
  const dir = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.2), directoryMat);
  dir.position.set(3.2, 1.7, backZ - 0.06);
  dir.rotation.y = Math.PI;
  g.add(decor(dir));

  // Framed art on the side walls
  g.add(makeFramedArt(-sideX, 2.1, -2.0, Math.PI / 2, 1.4, 0.95, 0));
  g.add(makeFramedArt(-sideX, 2.1, 2.0, Math.PI / 2, 1.4, 0.95, 1));
  g.add(makeFramedArt(sideX, 2.1, 3.5, -Math.PI / 2, 1.8, 1.1, 0));

  // Decorative entrance doors (the Lobby's front wall)
  g.add(makeEntranceDoors(-1.5, frontZ + 0.06));

  // Skirting boards along the Lobby walls
  const skirt = (w, d, x, z) => g.add(decor(box(w, 0.14, d, skirtMat, x, 0.07, z)));
  skirt(0.05, 10 * S - 0.3, -sideX + 0.03, 0);
  skirt(0.05, 10 * S - 0.3, sideX - 0.03, 0);
  skirt(12 * S - 0.3, 0.05, 0, frontZ + 0.03);
  skirt(4.5 * S, 0.05, -3.75 * S, backZ - 0.03);
  skirt(4.5 * S, 0.05, 3.75 * S, backZ - 0.03);

  // ---- waiting area (east side, off the direct corridor -> elevator line)
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 3.2), rugMat);
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(6.3, 0.012, 4.4);
  rug.name = 'floor_rug';
  g.add(decor(rug));
  g.add(makeCouch(sideX - 0.5, 3.4, -Math.PI / 2));   // against the east wall, facing west
  g.add(makeCouch(5.5, backZ - 0.5, Math.PI));          // against the back wall, facing the room
  g.add(makeCouch(4.2, 4.3, Math.PI / 2, 0.95));        // armchair, facing east
  g.add(makeCoffeeTable(6.2, 4.6));

  // ---- greenery + amenities
  g.add(makePlant(-sideX + 0.5, backZ - 0.7, 1.2));   // back-left corner
  g.add(makePlant(sideX - 0.5, backZ - 0.7, 1.2));    // back-right corner
  g.add(makePlant(3.4, frontZ + 0.6, 1.0));           // between entrance and elevator
  g.add(makeWaterCooler(-sideX + 0.4, 2.0));

  // ---- lighting extras (real lights; main.js still adds the ceiling lights)
  g.add(makeFloorLamp(7.6, backZ - 0.55));

  // Spot wash on the company sign
  const washTarget = new THREE.Object3D();
  washTarget.position.set(-3 * S, 2.7, backZ);
  g.add(washTarget);
  const wash = new THREE.SpotLight(0xfff4e0, 6, 9, Math.PI / 6, 0.5);
  wash.position.set(-3 * S, 3.85, backZ - 2.8);
  wash.target = washTarget;
  g.add(wash);

  // Cool "daylight" spill through the entrance glass
  const daylight = new THREE.PointLight(0xbfd8ff, 2, 10);
  daylight.position.set(-1.5, 2.4, frontZ + 1.0);
  g.add(daylight);

  lobby.add(g);
}

// ---- OFFICES + MANAGER'S OFFICE DRESSING ----------------------------------
// The Manager's Office is now a 6S x 6S room (9 x 9 m at S = 1.5, up from
// 4S x 4S) in the back-right corner of the Offices. MGR holds its geometry
// so the walls, desk, light fixtures and furniture all agree.
const MGR = {
  w: 1 * S, e: 7 * S, n: 21 * S, door: 15 * S,   // wall centre-lines (west, east, north, door wall)
  cx: 4 * S, cz: 18 * S,                          // room centre
  deskZ: 18 * S + 1.5,                            // executive desk, toward the north wall
};

const SCREEN_GLOW_GEOM = new THREE.PlaneGeometry(0.46, 0.27);
const STICKY_GEOM = new THREE.PlaneGeometry(0.1, 0.1);
const BOOK_GEOMS = [0.22, 0.27, 0.31].map((h) => new THREE.BoxGeometry(0.06, h, 0.22));

function makeCarpetMap() {
  const ctx = makeCanvas().getContext('2d');
  ctx.fillStyle = '#56606e'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 7000; i++) {
    const v = 70 + Math.floor(Math.random() * 40);
    ctx.fillStyle = `rgba(${v},${v + 6},${v + 18},0.25)`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.05)'; // alternate carpet tiles
  ctx.fillRect(0, 0, 128, 128); ctx.fillRect(128, 128, 128, 128);
  ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, 128, 128); ctx.strokeRect(128, 0, 128, 128);
  ctx.strokeRect(0, 128, 128, 128); ctx.strokeRect(128, 128, 128, 128);
  const tex = srgbTex(ctx.canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set((14 * S) / 2, (10 * S) / 2); // canvas = 2 x 2 one-metre tiles
  return tex;
}

function makeParquetMap() {
  const ctx = makeCanvas().getContext('2d');
  ctx.fillStyle = '#5a3b22'; ctx.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 8; row++) {
    let x = -((row * 53) % 64);
    while (x < 256) {
      const len = 64;
      const v = 105 + Math.floor(Math.random() * 35);
      ctx.fillStyle = `rgb(${v + 30},${Math.floor(v * 0.68)},${Math.floor(v * 0.4)})`;
      ctx.fillRect(x + 1, row * 32 + 1, len - 2, 30);
      ctx.strokeStyle = 'rgba(60,35,15,0.25)';
      for (let g = 0; g < 3; g++) {
        ctx.beginPath();
        ctx.moveTo(x + 2, row * 32 + 6 + g * 9 + Math.random() * 3);
        ctx.lineTo(x + len - 2, row * 32 + 6 + g * 9 + Math.random() * 3);
        ctx.stroke();
      }
      x += len;
    }
  }
  const tex = srgbTex(ctx.canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set((6 * S) / 2, (6 * S) / 2);
  return tex;
}

function makeScreenMap() {
  const ctx = canvasWH(256, 160).getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 256, 160);
  g.addColorStop(0, '#1d4f91'); g.addColorStop(1, '#0f2a4d');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 160);
  ctx.fillStyle = '#e8eef5'; ctx.fillRect(16, 16, 120, 90);
  ctx.fillStyle = '#2a7de1'; ctx.fillRect(16, 16, 120, 12);
  ctx.fillStyle = '#9fb3c8';
  for (let i = 0; i < 6; i++) ctx.fillRect(24, 38 + i * 11, 70 + (i % 3) * 14, 5);
  ctx.fillStyle = '#f5f7fa'; ctx.fillRect(150, 40, 90, 60);
  ctx.fillStyle = '#22a6a6'; ctx.fillRect(158, 78, 14, 16); ctx.fillRect(178, 62, 14, 32); ctx.fillRect(198, 70, 14, 24);
  ctx.fillStyle = '#10161f'; ctx.fillRect(0, 140, 256, 20); // taskbar
  return srgbTex(ctx.canvas);
}

function makeWhiteboardMap() {
  const ctx = canvasWH(512, 280).getContext('2d');
  ctx.fillStyle = '#f7f8f6'; ctx.fillRect(0, 0, 512, 280);
  ctx.fillStyle = '#1b4fa8'; ctx.font = 'bold 34px sans-serif'; ctx.fillText('Q3 TARGETS', 24, 50);
  ctx.strokeStyle = '#1b4fa8'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(24, 62); ctx.lineTo(250, 62); ctx.stroke();
  ctx.fillStyle = '#333'; ctx.font = '22px sans-serif';
  ['- onboard new clients', '- security audit (!!)', '- move to floor 2', '- budget review Fri'].forEach((t, i) => ctx.fillText(t, 28, 100 + i * 34));
  ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 4; // little bar chart
  ctx.beginPath(); ctx.moveTo(300, 240); ctx.lineTo(300, 90); ctx.lineTo(480, 240); ctx.stroke();
  ctx.strokeStyle = '#2c7fb8';
  ctx.beginPath(); ctx.moveTo(300, 240); ctx.lineTo(490, 240); ctx.stroke();
  [[320, 170], [360, 140], [400, 150], [440, 110]].forEach(([x, y]) => { ctx.fillStyle = '#2c7fb8'; ctx.fillRect(x, y, 22, 240 - y); });
  return srgbTex(ctx.canvas);
}

function makeCityWindowMap() {
  const ctx = canvasWH(512, 288).getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 288);
  g.addColorStop(0, '#070b1c'); g.addColorStop(0.7, '#1c2447'); g.addColorStop(1, '#38406b');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 288);
  ctx.fillStyle = '#f0f0dd'; ctx.beginPath(); ctx.arc(410, 60, 20, 0, Math.PI * 2); ctx.fill(); // moon
  for (let i = 0; i < 40; i++) { ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(Math.random() * 512, Math.random() * 120, 2, 2); }
  [['#10162b', 120, 0.7], ['#0a0f20', 70, 1.0]].forEach(([c, minH, scale], layer) => {
    let x = -20;
    while (x < 512) {
      const w = 40 + Math.random() * 50, h = minH + Math.random() * 110 * scale;
      ctx.fillStyle = c; ctx.fillRect(x, 288 - h, w, h);
      for (let wy = 288 - h + 10; wy < 280; wy += 16) for (let wx = x + 6; wx < x + w - 8; wx += 12) {
        if (Math.random() < (layer ? 0.35 : 0.22)) {
          ctx.fillStyle = Math.random() < 0.8 ? '#ffd98a' : '#9fd4ff';
          ctx.fillRect(wx, wy, 6, 8);
        }
      }
      x += w + 4;
    }
  });
  return srgbTex(ctx.canvas);
}

function makeVendingMap() {
  const ctx = canvasWH(256, 384).getContext('2d');
  ctx.fillStyle = '#0d1320'; ctx.fillRect(0, 0, 256, 384);
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('SNACKS & DRINKS', 128, 34);
  const cols = ['#d94a38', '#f2b134', '#3a9d5d', '#2c7fb8', '#9b59b6', '#eeeeee'];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
    ctx.fillStyle = cols[(r * 3 + c) % cols.length];
    ctx.fillRect(20 + c * 44, 56 + r * 62, 32, 44);
  }
  return srgbTex(ctx.canvas);
}

// Dressing materials
const officeFloorMat = new THREE.MeshStandardMaterial({ map: makeCarpetMap(), roughness: 0.95 });
const parquetMat = new THREE.MeshStandardMaterial({ map: makeParquetMap(), roughness: 0.35 });
const screenMap = makeScreenMap();
const screenMat = new THREE.MeshStandardMaterial({ map: screenMap, emissiveMap: screenMap, emissive: 0xffffff, emissiveIntensity: 0.85, roughness: 0.3 });
const whiteboardMat = new THREE.MeshStandardMaterial({ map: makeWhiteboardMap(), roughness: 0.3 });
const cityMap = makeCityWindowMap();
const cityMat = new THREE.MeshStandardMaterial({ map: cityMap, emissiveMap: cityMap, emissive: 0xffffff, emissiveIntensity: 0.65, roughness: 0.4 });
const vendingMap = makeVendingMap();
const vendingGlowMat = new THREE.MeshStandardMaterial({ map: vendingMap, emissiveMap: vendingMap, emissive: 0xffffff, emissiveIntensity: 0.8 });
const vendingBodyMat = new THREE.MeshStandardMaterial({ color: 0xa82a2a, roughness: 0.4, metalness: 0.2 });
const execLeatherMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1f, roughness: 0.45 });
const filingMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.45, metalness: 0.35 });
const filingDrawerMat = new THREE.MeshStandardMaterial({ color: 0x848d95, roughness: 0.45, metalness: 0.35 });
const copierMat = new THREE.MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.5 });
const binMat = new THREE.MeshStandardMaterial({ color: 0x2d6cdf, roughness: 0.6 });
const corkMat = new THREE.MeshStandardMaterial({ color: 0xb98b58, roughness: 0.9 });
const globeMat = new THREE.MeshStandardMaterial({ color: 0x2c6fa8, roughness: 0.4 });
const stickyMats = [0xffe76a, 0xff9ec2, 0x7fe0f0].map((c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.15, roughness: 0.9 }));
const bookMats = [0xcc3333, 0x3366cc, 0x33aa33, 0xcc9933, 0x9933cc, 0x2a2a2a, 0xe8e0d0].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));

// Collision-only box: invisible but still a collider (raycasts and Box3 ignore
// `visible`). Used where the visible model is open, e.g. a bookcase.
function invisibleCollider(w, h, d, x, y, z, name) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), darkPlasticMat);
  m.position.set(x, y, z);
  m.name = name;
  m.visible = false;
  return m;
}

function makeCityWindow(x, y, z, rotY, w, h) {
  const g = new THREE.Group();
  g.name = 'decor_window';
  g.position.set(x, y, z);
  g.rotation.y = rotY; // local +z points into the room
  g.add(decor(box(w + 0.14, h + 0.14, 0.08, metalMat, 0, 0, 0)));   // frame
  const view = new THREE.Mesh(new THREE.PlaneGeometry(w, h), cityMat);
  view.position.z = 0.041;
  g.add(decor(view));
  g.add(decor(box(0.05, h, 0.05, metalMat, 0, 0, 0.05)));            // mullions
  g.add(decor(box(w, 0.05, 0.05, metalMat, 0, 0, 0.05)));
  g.add(decor(box(w + 0.3, 0.05, 0.2, metalMat, 0, -h / 2 - 0.08, 0.1))); // sill
  return g;
}

function makeFilingCabinet(x, z, rotY) {
  const g = new THREE.Group();
  g.name = 'furniture_filingCabinet';
  g.position.set(x, 0, z);
  g.rotation.y = rotY; // front faces local +z
  const body = box(0.6, 1.3, 0.5, filingMat, 0, 0.65, 0);
  body.name = 'collider_filingCabinet';
  g.add(body);
  [0.25, 0.65, 1.05].forEach((y) => {
    g.add(decor(box(0.54, 0.36, 0.02, filingDrawerMat, 0, y, 0.26)));
    g.add(decor(box(0.2, 0.03, 0.03, metalMat, 0, y + 0.1, 0.29)));
  });
  return g;
}

function makeCopier(x, z, rotY) {
  const g = new THREE.Group();
  g.name = 'furniture_copier';
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  const body = box(0.9, 0.95, 0.7, copierMat, 0, 0.475, 0);
  body.name = 'collider_copier';
  g.add(body);
  g.add(decor(box(0.92, 0.08, 0.72, darkPlasticMat, 0, 1.0, 0)));        // scanner lid
  const panel = box(0.4, 0.04, 0.18, darkPlasticMat, 0.2, 1.06, 0.22);
  panel.rotation.x = -0.3;
  g.add(decor(panel));
  const panelGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.1), screenMat);
  panelGlow.rotation.x = -Math.PI / 2 - 0.3;
  panelGlow.position.set(0.2, 1.085, 0.22);
  panelGlow.name = 'light_copier_screen';
  g.add(decor(panelGlow));
  g.add(decor(box(0.6, 0.05, 0.3, darkPlasticMat, -0.1, 0.72, 0.5)));    // paper tray
  g.add(decor(box(0.3, 0.02, 0.22, paperMat, -0.1, 0.75, 0.5)));
  return g;
}

function makeRecycleBin(x, z) {
  const g = new THREE.Group();
  g.name = 'furniture_bin';
  const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.19, 0.7, 14), binMat);
  bin.position.set(x, 0.35, z);
  bin.name = 'collider_bin';
  g.add(bin);
  g.add(decor(box(0.3, 0.03, 0.1, darkPlasticMat, x, 0.72, z)));
  return g;
}

function makeVendingMachine(x, z, rotY) {
  const g = new THREE.Group();
  g.name = 'furniture_vending';
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  const body = box(0.9, 1.9, 0.8, vendingBodyMat, 0, 0.95, 0);
  body.name = 'collider_vending';
  g.add(body);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 1.3), vendingGlowMat);
  face.position.set(-0.04, 1.12, 0.401);
  face.name = 'light_vending_glow';
  g.add(decor(face));
  g.add(decor(box(0.5, 0.14, 0.04, darkPlasticMat, -0.04, 0.3, 0.41)));  // dispense slot
  g.add(decor(box(0.1, 0.4, 0.04, darkPlasticMat, 0.36, 1.0, 0.41)));     // keypad strip
  return g;
}

function makeBookcase(x, z, rotY, width = 1.6) {
  const g = new THREE.Group();
  g.name = 'furniture_bookcase';
  g.position.set(x, 0, z);
  g.rotation.y = rotY; // front faces local +z
  g.add(invisibleCollider(width, 2.2, 0.35, 0, 1.1, 0, 'collider_bookcase'));
  [-1, 1].forEach((sx) => g.add(decor(box(0.04, 2.2, 0.35, darkWoodMat, sx * (width / 2 - 0.02), 1.1, 0))));
  g.add(decor(box(width, 0.04, 0.35, darkWoodMat, 0, 2.2, 0)));
  g.add(decor(box(width, 0.12, 0.35, darkWoodMat, 0, 0.06, 0)));
  g.add(decor(box(width, 2.2, 0.02, darkWoodMat, 0, 1.1, -0.165)));
  let seed = Math.floor(x * 13 + z * 7) + 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  [0.4, 0.85, 1.3, 1.75].forEach((sy) => {
    g.add(decor(box(width - 0.08, 0.03, 0.33, darkWoodMat, 0, sy, 0)));
    let bx = -width / 2 + 0.07;
    while (bx < width / 2 - 0.2) {
      if (rnd() < 0.12) { bx += 0.12; continue; } // small gaps
      const gi = Math.floor(rnd() * 3);
      const h = [0.22, 0.27, 0.31][gi];
      const book = new THREE.Mesh(BOOK_GEOMS[gi], bookMats[Math.floor(rnd() * bookMats.length)]);
      book.position.set(bx, sy + 0.015 + h / 2, -0.02 + rnd() * 0.03);
      g.add(decor(book));
      bx += 0.065;
      if (rnd() < 0.08) break; // shelf only partly full
    }
  });
  return g;
}

function makeVisitorChair(x, z, rotY) {
  const g = new THREE.Group();
  g.name = 'furniture_visitorChair';
  g.position.set(x, 0, z);
  g.rotation.y = rotY; // front faces local +z
  g.add(decor(box(0.5, 0.06, 0.48, cushionMat, 0, 0.45, 0)));
  g.add(box(0.5, 0.45, 0.05, cushionMat, 0, 0.78, -0.22));
  [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([sx, sz]) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.45, 8), metalMat);
    leg.position.set(sx * 0.21, 0.225, sz * 0.2);
    g.add(leg);
  });
  return g;
}

function makeExecChair(x, z, rotY) {
  const g = new THREE.Group();
  g.name = 'furniture_execChair';
  g.position.set(x, 0, z);
  g.rotation.y = rotY; // front faces local +z
  g.add(decor(box(0.62, 0.12, 0.6, execLeatherMat, 0, 0.52, 0)));
  const back = box(0.6, 0.85, 0.12, execLeatherMat, 0, 1.0, -0.3);
  back.rotation.x = -0.1;
  back.name = 'collider_execChairBack';
  g.add(back);
  g.add(decor(box(0.3, 0.2, 0.1, execLeatherMat, 0, 1.5, -0.33)));        // headrest
  [-1, 1].forEach((sx) => {
    g.add(decor(box(0.06, 0.04, 0.4, darkPlasticMat, sx * 0.33, 0.72, -0.05))); // armrests
    g.add(decor(box(0.05, 0.2, 0.05, darkPlasticMat, sx * 0.33, 0.62, -0.05)));
  });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.42, 8), metalMat);
  post.position.set(0, 0.27, 0);
  post.name = 'collider_execChairPost';
  g.add(post);
  [0, Math.PI / 3, -Math.PI / 3].forEach((r) => {
    const bar = box(0.7, 0.03, 0.07, darkPlasticMat, 0, 0.06, 0);
    bar.rotation.y = r;
    g.add(decor(bar));
  });
  return g;
}

function makeNoticeBoard(x, y, z) {
  const g = new THREE.Group();
  g.name = 'decor_noticeBoard';
  g.position.set(x, y, z); // faces +z (into the Offices)
  g.add(decor(box(1.7, 1.1, 0.04, darkWoodMat, 0, 0, 0)));
  g.add(decor(box(1.58, 0.98, 0.02, corkMat, 0, 0, 0.02)));
  [[-0.5, 0.2, 0.3, 0.22, 0.1], [-0.1, 0.25, 0.25, 0.3, -0.08], [0.35, 0.15, 0.3, 0.22, 0.05], [-0.4, -0.22, 0.26, 0.3, -0.05], [0.1, -0.2, 0.3, 0.24, 0.1], [0.5, -0.25, 0.22, 0.28, -0.1]].forEach(([px, py, pw, ph, rz], i) => {
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), i % 3 === 0 ? stickyMats[0] : paperMat);
    sheet.position.set(px, py, 0.032);
    sheet.rotation.z = rz;
    g.add(decor(sheet));
  });
  return g;
}

function addOfficeDressing(offices) {
  const g = new THREE.Group();
  g.name = 'OfficesDressing';

  // inner wall faces: left x=-10.4, right x=10.4, front z=16.6, back z=31.4
  const L = -7 * S + 0.1, R = 7 * S - 0.1, F = 11 * S + 0.1, B = 21 * S - 0.1;

  // ---- wall dressing ----
  const skirt = (w, d, x, z) => g.add(decor(box(w, 0.14, d, skirtMat, x, 0.07, z)));
  const band = (w, d, x, z) => g.add(decor(box(w, 0.08, d, accentMat, x, 1.15, z)));
  skirt(0.05, B - F, L + 0.03, (F + B) / 2);           band(0.03, B - F, L + 0.015, (F + B) / 2);
  { const len = (MGR.door - 0.1) - F, mid = F + len / 2; skirt(0.05, len, R - 0.03, mid); band(0.03, len, R - 0.015, mid); }
  const backLen = (MGR.w + 0.1) - L;                    // back wall, west of the Manager's Office
  skirt(backLen, 0.05, L + backLen / 2, B - 0.03);      band(backLen, 0.03, L + backLen / 2, B - 0.015);
  [[-6.325], [6.325]].forEach(([cx]) => { skirt(8.15, 0.05, cx, F + 0.03); band(8.15, 0.03, cx, F + 0.015); });

  // windows to the night city (left + back walls)
  g.add(makeCityWindow(L, 2.3, 26.0, Math.PI / 2, 2.2, 1.4));
  g.add(makeCityWindow(L, 2.3, 29.5, Math.PI / 2, 2.2, 1.4));
  g.add(makeCityWindow(-8.6, 2.3, B, Math.PI, 2.2, 1.4));

  // whiteboard + clock on the back wall
  g.add(decor(box(2.52, 1.42, 0.05, metalMat, -5.2, 1.95, B - 0.025)));
  const wb = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.3), whiteboardMat);
  wb.position.set(-5.2, 1.95, B - 0.055);
  wb.rotation.y = Math.PI;
  g.add(decor(wb));
  g.add(decor(box(1.0, 0.04, 0.1, metalMat, -5.2, 1.22, B - 0.1)));
  g.add(makeWallClock(-2.6, 2.9, B - 0.03));

  // front wall: company sign above the waiting couch, notice board on the left
  g.add(decor(box(3.2, 0.95, 0.06, darkWoodMat, 6.5, 2.7, F + 0.03)));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.75), signMat);
  sign.position.set(6.5, 2.7, F + 0.065);
  g.add(decor(sign));
  g.add(makeNoticeBoard(-6.0, 1.9, F + 0.02));
  g.add(makeFramedArt(-6.0, 3.0, F + 0.02, 0, 1.0, 0.5, 1));

  // ---- waiting corner by the entrance ----
  g.add(makeCouch(6.5, F + 0.8, 0));
  g.add(makePlant(3.3, F + 0.7, 1.1));
  g.add(makePlant(-3.3, F + 0.7, 1.1));

  // ---- break area on the east wall ----
  g.add(makeWaterCooler(R - 0.25, 17.5));
  g.add(makeVendingMachine(R - 0.45, 19.6, -Math.PI / 2));
  g.add(makeFramedArt(R - 0.03, 2.1, 21.3, -Math.PI / 2, 1.4, 0.95, 1));

  // ---- west wall: copier corner + filing ----
  g.add(makeCopier(L + 0.45, 18.0, Math.PI / 2));
  g.add(makeRecycleBin(L + 0.4, 19.5));
  [22.0, 22.6, 23.2].forEach((z) => g.add(makeFilingCabinet(L + 0.3, z, Math.PI / 2)));

  // ---- greenery ----
  g.add(makePlant(L + 0.5, B - 0.8, 1.2));
  g.add(makePlant(MGR.w - 1.0, B - 0.8, 1.3));

  offices.add(g);
}

function addManagerDressing(mgr) {
  const g = new THREE.Group();
  g.name = 'ManagerDressing';

  const iw = MGR.w + 0.1, ie = MGR.e - 0.1, inn = MGR.n - 0.1, idoor = MGR.door + 0.1; // inner faces
  const cx = MGR.cx, cz = MGR.cz;
  const roomW = ie - iw, roomD = inn - idoor;

  // wood wainscot on the west, east and north walls (not the door wall: the door slides along it)
  g.add(decor(box(0.03, 1.0, roomD, darkWoodMat, iw + 0.015, 0.5, (idoor + inn) / 2)));
  g.add(decor(box(0.03, 1.0, roomD, darkWoodMat, ie - 0.015, 0.5, (idoor + inn) / 2)));
  g.add(decor(box(roomW, 1.0, 0.03, darkWoodMat, cx, 0.5, inn - 0.015)));
  const skirtM = (w, d, x, z) => g.add(decor(box(w, 0.14, d, skirtMat, x, 0.07, z)));
  skirtM(0.05, roomD, iw + 0.03, (idoor + inn) / 2);
  skirtM(0.05, roomD, ie - 0.03, (idoor + inn) / 2);
  skirtM(roomW, 0.05, cx, inn - 0.03);

  // parquet is the room's floor (lifted 1 cm to sit above the office carpet) + rug under the desk area
  const parquet = makeFloor(roomW, roomD, cx, cz, parquetMat);
  parquet.position.y = 0.01;
  g.add(parquet);
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 3.4), rugMat);
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(cx, 0.022, MGR.deskZ - 0.9);
  rug.name = 'floor_rug';
  g.add(decor(rug));

  // big window behind the desk
  g.add(makeCityWindow(cx, 2.35, inn, Math.PI, 3.6, 1.7));

  // desk seating
  g.add(makeExecChair(cx, MGR.deskZ + 1.35, Math.PI));             // manager, facing the door
  g.add(makeVisitorChair(cx - 0.9, MGR.deskZ - 1.5, 0));           // visitors, facing the desk
  g.add(makeVisitorChair(cx + 0.9, MGR.deskZ - 1.5, 0));

  // bookcases either side of the window
  g.add(makeBookcase(iw + 1.6, inn - 0.2, Math.PI));
  g.add(makeBookcase(ie - 1.6, inn - 0.2, Math.PI));

  // lounge corner on the west wall
  g.add(makeCouch(iw + 0.5, cz, Math.PI / 2));                      // back to the wall, facing east
  g.add(makeCoffeeTable(iw + 2.05, cz));
  g.add(makeCouch(iw + 2.05, cz - 2.0, 0, 0.95));                   // armchair facing the table
  g.add(makeFramedArt(iw + 0.03, 2.2, cz - 1.0, Math.PI / 2, 1.3, 0.9, 0));
  g.add(makeFramedArt(iw + 0.03, 2.2, cz + 1.0, Math.PI / 2, 1.3, 0.9, 1));
  g.add(makeFloorLamp(iw + 0.4, cz + 2.0, false));                  // emissive only (light budget)

  // credenza + drinks station on the east wall
  const cred = box(0.5, 0.85, 2.4, darkWoodMat, ie - 0.3, 0.425, cz);
  cred.name = 'collider_credenza';
  g.add(cred);
  g.add(decor(box(0.56, 0.04, 2.5, woodMat, ie - 0.3, 0.87, cz)));
  g.add(decor(box(0.3, 0.35, 0.3, darkPlasticMat, ie - 0.3, 1.065, cz - 0.7)));            // coffee machine
  g.add(decor(box(0.05, 0.05, 0.02, new THREE.MeshStandardMaterial({ color: 0xff3030, emissive: 0xff3030, emissiveIntensity: 1 }), ie - 0.42, 1.12, cz - 0.7)));
  [0.05, 0.25].forEach((dz) => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.08, 10), potMat);
    c.position.set(ie - 0.3, 0.93, cz - 0.2 + dz);
    g.add(decor(c));
  });
  const globeStand = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.03, 16), metalMat);
  globeStand.position.set(ie - 0.3, 0.905, cz + 0.8);
  g.add(decor(globeStand));
  const globe = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), globeMat);
  globe.position.set(ie - 0.3, 1.13, cz + 0.8);
  g.add(decor(globe));
  g.add(makeFramedArt(ie - 0.03, 2.1, cz, -Math.PI / 2, 1.8, 1.1, 0));

  // door wall, inside: a framed piece to the west of the door
  g.add(makeFramedArt(iw + 1.6, 2.2, idoor + 0.03, 0, 1.2, 0.8, 1));

  // plants in the corners
  g.add(makePlant(iw + 0.4, inn - 0.45, 1.2));
  g.add(makePlant(ie - 0.4, idoor + 0.6, 1.1));

  mgr.add(g);
}

export function createLevel1(scene) {
  const level1 = new THREE.Group();
  level1.name = 'Level1';

  const CEILING_HEIGHT = 4;

  // Soft sky/ground fill for the whole level so shadows under furniture
  // aren't pitch black. Lower HEMI_INTENSITY if main.js already has ambient.
  const HEMI_INTENSITY = 0.15;
  const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x665c52, HEMI_INTENSITY);
  hemi.name = 'level1_hemi';
  level1.add(hemi);
  const lightFixturePositions = []; // main.js adds a real PointLight at each

  // ============ LOBBY ============
  // Room footprint: x from -6 to 6, z from -5 to 5. Wall height 4.
  const lobby = new THREE.Group();
  lobby.name = 'Lobby';

  lobby.add(makeFloor(12 * S, 10 * S, 0, 0, lobbyFloorMat));

  // Back wall has a 3m gap in the middle for the corridor doorway
  lobby.add(makeWall(4.5 * S, 4, 0.2, -3.75 * S, 2, 5 * S));   // back-left segment
  lobby.add(makeWall(4.5 * S, 4, 0.2, 3.75 * S, 2, 5 * S));    // back-right segment
  lobby.add(makeWall(12 * S, 4, 0.2, 0, 2, -5 * S));           // front wall (entrance side)
  lobby.add(makeWall(10 * S, 4, 0.2, -6 * S, 2, 0, Math.PI / 2)); // left wall
  lobby.add(makeWall(10 * S, 4, 0.2, 6 * S, 2, 0, Math.PI / 2));  // right wall

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
  const ELEVATOR_POS = new THREE.Vector3(5 * S, 0, -5 * S + 1); // stays 1m off the front wall
  const elevator = makeElevator(ELEVATOR_POS);
  lobby.add(elevator.group);

  // Key mesh — hidden until Guard A is taken down, then it shows beside the body.
  const keyMat = new THREE.MeshStandardMaterial({
    color: 0xd4a017, emissive: 0xd4a017, emissiveIntensity: 0.5, metalness: 0.8, roughness: 0.2,
  });
  const keyMesh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.04, 0.08), keyMat);
  keyMesh.position.set(-2.2 * S, 0.15, 3.3 * S);
  keyMesh.name = 'keyMesh';
  keyMesh.visible = false;
  lobby.add(keyMesh);

  lobby.add(makeCeiling(12 * S, 10 * S, 0, CEILING_HEIGHT, 0));
  [[-3, -2.5], [3, -2.5], [-3, 2.5], [3, 2.5]].map(([x, z]) => [x * S, z * S]).forEach(([x, z]) => {
    lobby.add(makeLightFixture(x, CEILING_HEIGHT, z));
    lightFixturePositions.push(new THREE.Vector3(x, CEILING_HEIGHT, z));
  });

  addLobbyDressing(lobby);
  level1.add(lobby);

  // ============ CORRIDOR ============
  // Connects Lobby (ends at z=5) to Offices (starts at z=11). Width 3, so it lines
  // up with the gap left in the Lobby's back wall.
  const corridor = new THREE.Group();
  corridor.name = 'Corridor';

  corridor.add(makeFloor(3 * S, 6 * S, 0, 8 * S));
  corridor.add(makeWall(6 * S, 4, 0.2, -1.5 * S, 2, 8 * S, Math.PI / 2)); // left wall
  corridor.add(makeWall(6 * S, 4, 0.2, 1.5 * S, 2, 8 * S, Math.PI / 2));  // right wall

  corridor.add(makeCeiling(3 * S, 6 * S, 0, CEILING_HEIGHT, 8 * S));
  [[0, 6.5], [0, 9.5]].map(([x, z]) => [x * S, z * S]).forEach(([x, z]) => {
    corridor.add(makeLightFixture(x, CEILING_HEIGHT, z, 1.2, 1.2));
    lightFixturePositions.push(new THREE.Vector3(x, CEILING_HEIGHT, z));
  });

  level1.add(corridor);

  // ============ OFFICES ============
  // Room footprint (at ROOM_SCALE 1.5): x -10.5..10.5, z 16.5..31.5. Wall height 4.
  // The Manager's Office fills the back-right corner; the open-plan cubicles
  // are in the west part. Furniture inside is laid out in metres for S = 1.5.
  const offices = new THREE.Group();
  offices.name = 'Offices';

  offices.add(makeFloor(14 * S, 10 * S, 0, 16 * S, officeFloorMat));

  offices.add(makeWall(5.5 * S, 4, 0.2, -4.25 * S, 2, 11 * S));  // front-left (corridor side gap)
  offices.add(makeWall(5.5 * S, 4, 0.2, 4.25 * S, 2, 11 * S));   // front-right
  offices.add(makeWall(14 * S, 4, 0.2, 0, 2, 21 * S));           // back wall
  offices.add(makeWall(10 * S, 4, 0.2, -7 * S, 2, 16 * S, Math.PI / 2)); // left wall
  offices.add(makeWall(10 * S, 4, 0.2, 7 * S, 2, 16 * S, Math.PI / 2));  // right wall

  // Open-plan cubicle grid: 3 columns x 3 rows, with aisles to walk and hide in
  const cubicleXs = [-7.5, -4.5, -1.5];
  const cubicleZs = [20.5, 24.5, 28.5];
  let cubicleIndex = 0;
  cubicleZs.forEach((z) => cubicleXs.forEach((x) => offices.add(makeCubicle(x, z, cubicleIndex++))));
  addOfficeDressing(offices);

  // Manager's office — fully enclosed 6S x 6S room with lighter walls.
  const mgrOffice = new THREE.Group();
  mgrOffice.name = 'ManagerOffice';

  // Interior: x MGR.w..MGR.e, z MGR.door..MGR.n. The east and north sides are the
  // Offices' own outer walls, so only the west wall and the door wall are new.
  // The door wall has a 1.0m gap centred on MGR.cx, closed by the sliding door.
  const MX = MGR.cx, MZ_DOOR = MGR.door, MX_W = MGR.w, MX_E = MGR.e;
  const segW = (MX - 0.5) - MX_W; // west edge -> door gap
  mgrOffice.add(makeOfficeWall(6 * S, 4, 0.2, MX_W, 2, MGR.cz, Math.PI / 2)); // west wall
  mgrOffice.add(makeOfficeWall(segW, 4, 0.2, MX_W + segW / 2, 2, MZ_DOOR));   // door wall, left of door
  mgrOffice.add(makeOfficeWall(segW, 4, 0.2, MX_E - segW / 2, 2, MZ_DOOR));   // door wall, right of door
  mgrOffice.add(makeOfficeWall(1.2, 1.6, 0.2, MX, 3.2, MZ_DOOR));             // lintel above the door

  // Door frame posts either side of the gap
  const doorFrameMat = new THREE.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.7 });
  const frameLeft = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.4, 0.15), doorFrameMat);
  frameLeft.position.set(MX - 0.55, 1.2, MZ_DOOR);
  mgrOffice.add(frameLeft);
  const frameRight = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.4, 0.15), doorFrameMat);
  frameRight.position.set(MX + 0.55, 1.2, MZ_DOOR);
  mgrOffice.add(frameRight);

  // Sliding door. It sits against the room-side face of the wall so that when
  // main.js slides it +x it runs along the inside of the right-hand wall
  // segment instead of clipping through it. The handle is a CHILD of the door
  // so it travels with it (a door and its handle are one moving assembly).
  const officeDoorMat = new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.6 });
  const officeDoor = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.4, 0.08), officeDoorMat);
  officeDoor.position.set(MX, 1.2, MZ_DOOR + 0.14);
  officeDoor.name = 'officeDoor';
  mgrOffice.add(officeDoor);

  const handleMat = new THREE.MeshStandardMaterial({ color: 0xccaa00, metalness: 0.8, roughness: 0.2 });
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.06), handleMat);
  handle.position.set(0.35, 0, -0.06); // door-local: on the Offices-facing side
  handle.name = 'doorHandle';
  officeDoor.add(handle);

  mgrOffice.add(makeManagerDesk());
  addManagerDressing(mgrOffice);

  // Ceiling + two recessed fixtures (main.js adds a real light at each)
  mgrOffice.add(makeCeiling(6 * S, 6 * S, MGR.cx, CEILING_HEIGHT, MGR.cz));
  [[MGR.cx - 2.2, MGR.cz + 0.5], [MGR.cx + 2.2, MGR.cz + 0.5]].forEach(([x, z]) => {
    mgrOffice.add(makeLightFixture(x, CEILING_HEIGHT, z, 1.4, 1.4));
    lightFixturePositions.push(new THREE.Vector3(x, CEILING_HEIGHT, z));
  });

  // The keycard — resting on the desk, in front of the desk pad
  const keycardMesh = makeKeycard(MGR.cx + 0.35, 0.974, MGR.deskZ - 0.28);
  mgrOffice.add(keycardMesh);

  offices.add(makeCeiling(14 * S, 10 * S, 0, CEILING_HEIGHT, 16 * S));
  [[-6, 19], [0, 19], [6, 19], [-4.5, 22.5], [-4.5, 26.5], [-4.5, 30]].forEach(([x, z]) => {
    offices.add(makeLightFixture(x, CEILING_HEIGHT, z));
    lightFixturePositions.push(new THREE.Vector3(x, CEILING_HEIGHT, z));
  });

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
  if (obj.userData && obj.userData.noCollide) return; // rugs, wall art, trim, leaves...
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
    roomScale: S,
  };

}