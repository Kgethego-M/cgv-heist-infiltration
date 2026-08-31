import * as THREE from 'three';

// 1. Scene — the container for everything
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0a);

// 2. Camera — perspective camera: fov, aspect ratio, near clip, far clip
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.z = 5;

// 3. Renderer — draws the scene from the camera's point of view
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// 4. A simple lit cube (using a material that reacts to light, not just flat colour)
const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshStandardMaterial({ color: 0x2266ff });
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);


const floorGeometry = new THREE.PlaneGeometry(20, 20);
const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.rotation.x = -Math.PI / 2;   // lay it flat
floor.position.y = -1;
scene.add(floor);

const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x222233 });

// Back wall
const backWall = new THREE.Mesh(new THREE.PlaneGeometry(20, 6), wallMaterial);
backWall.position.set(0, 2, -10);
scene.add(backWall);

// Left wall
const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(20, 6), wallMaterial);
leftWall.rotation.y = Math.PI / 2;
leftWall.position.set(-10, 2, 0);
scene.add(leftWall);

// Right wall
const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(20, 6), wallMaterial);
rightWall.rotation.y = -Math.PI / 2;
rightWall.position.set(10, 2, 0);
scene.add(rightWall);

// Dim ambient light — just enough that nothing is pure black
const ambient = new THREE.AmbientLight(0x1a1a2e, 0.6);
scene.add(ambient);

// A coloured point light — gives the "restricted facility" feel instead of
// flat even lighting. Try green (0x00ff66) for a "security" tone, or
// amber (0xff8800) for a "warm office" tone — swap the colour to whatever
// fits your concept.
const pointLight = new THREE.PointLight(0x00ff66, 15, 15);
pointLight.position.set(0, 3, 0);
scene.add(pointLight);

// 6. Handle window resizing so the game isn't stretched
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Track which keys are currently held down ---
const keys = {};
window.addEventListener('keydown', (e) => { keys[e.key.toLowerCase()] = true; });
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

const moveSpeed = 0.05;

const itemGeometry = new THREE.SphereGeometry(0.3, 16, 16);
const itemMaterial = new THREE.MeshStandardMaterial({
  color: 0xffcc00,
  emissive: 0xffcc00,
  emissiveIntensity: 0.5
});
const objectiveItem = new THREE.Mesh(itemGeometry, itemMaterial);
objectiveItem.position.set(3, -0.5, -3);
scene.add(objectiveItem);


function updateMovement() {
  if (keys['w']) camera.position.z -= moveSpeed;
  if (keys['s']) camera.position.z += moveSpeed;
  if (keys['a']) camera.position.x -= moveSpeed;
  if (keys['d']) camera.position.x += moveSpeed;
}

// 7. Animation loop — runs every frame
function animate() {
  requestAnimationFrame(animate);
  updateMovement(); 
  cube.rotation.x += 0.01;
  cube.rotation.y += 0.01;
  renderer.render(scene, camera);
}
animate();

