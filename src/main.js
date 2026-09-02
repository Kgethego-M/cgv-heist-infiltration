import * as THREE from 'three';
import { createLevel1 } from './levels/level1.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

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

// 4. Pointer lock controls — needs the renderer's DOM element, so it must be
// created AFTER the renderer above, not before
const controls = new PointerLockControls(camera, renderer.domElement);

const blocker = document.getElementById('blocker');

blocker.addEventListener('click', () => {
  controls.lock();
});

controls.addEventListener('lock', () => {
  blocker.style.display = 'none';
});

controls.addEventListener('unlock', () => {
  blocker.style.display = 'flex'; // shown again if the player hits Escape
});

// Dim ambient light — just enough that nothing is pure black
const ambient = new THREE.AmbientLight(0x1a1a2e, 0.6);
scene.add(ambient);

const pointLight = new THREE.PointLight(0x00ff66, 20, 15);
pointLight.position.set(0, 3, 0);
scene.add(pointLight);

// Handle window resizing so the game isn't stretched
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Track which keys are currently held down ---
const keys = {};
window.addEventListener('keydown', (e) => { keys[e.key.toLowerCase()] = true; });
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

// Build Level 1 (Lobby, Corridor, Offices) — see src/levels/level1.js
createLevel1(scene);

// Move the camera to the player spawn point in the Lobby
camera.position.set(-4, 1.6, -1.5);

function updateMovement() {
  const speed = 0.05;
  if (keys['w']) controls.moveForward(speed);
  if (keys['s']) controls.moveForward(-speed);
  if (keys['a']) controls.moveRight(-speed);
  if (keys['d']) controls.moveRight(speed);
}

// Animation loop — runs every frame
function animate() {
  requestAnimationFrame(animate);
  updateMovement();
  renderer.render(scene, camera);
}
animate();