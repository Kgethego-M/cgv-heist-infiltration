import * as THREE from 'three';

// ============================================================
// CUSTOM SHADERS (written by our team)
//
// Both materials are THREE.ShaderMaterial with our OWN vertex and fragment
// stage. They share one time uniform (`fxTime`) that main.js advances every
// frame, so the effects are "alive" without per-frame allocation.
//
//   createVisionConeMaterial  Level 2 security-camera cones
//       vertex   : ripple displacement travelling down the cone
//       fragment : scan rings moving outward + fresnel edge glow + fade by distance
//       uniforms : uTime (time), uOpacity + uColor (driven by game state:
//                  level2.js raises them as the camera starts to see you)
//
//   createLaserMaterial       Level 3 laser gates
//       vertex   : tiny heat-shimmer wobble
//       fragment : hot core + glow, energy pulses running along the beam,
//                  electrical flicker, dashed "warning" line while the beam is off
//       uniforms : uTime, uPeriod/uOnTime/uPhase (the on/off cycle is computed
//                  from time, so JS can compute the same state for hit-testing)
// ============================================================

// Shared by every shader below. main.js sets fxTime.value = elapsed each frame.
export const fxTime = { value: 0 };

// ------------------------------------------------------------- vision cone
const CONE_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uFlip;      // 1 = ConeGeometry (uv.y runs base->apex), 0 = flat fan (uv.y runs apex->far edge)
  varying float vAlong;     // 0 at the lens, 1 at the far end of the cone
  varying vec3  vNormalV;
  varying vec3  vViewPos;

  void main() {
    vAlong = mix(uv.y, 1.0 - uv.y, uFlip);

    // Vertex displacement: a slow ripple travelling down the cone, stronger
    // toward the far end, so the cone reads as an energy field, not a rigid mesh.
    vec3 p = position + normal * sin(dot(position, vec3(3.0)) + uTime * 2.5) * 0.035 * vAlong;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vViewPos = -mv.xyz;
    vNormalV = normalMatrix * normal;
    gl_Position = projectionMatrix * mv;
  }
`;

const CONE_FRAG = /* glsl */ `
  uniform vec3  uColor;
  uniform float uOpacity;   // game state: 0.12 idle, rises as the camera detects the player
  uniform float uTime;
  varying float vAlong;
  varying vec3  vNormalV;
  varying vec3  vViewPos;

  void main() {
    float fade  = pow(1.0 - vAlong, 1.2);                                   // bright at the lens, thins out
    float rings = 0.5 + 0.5 * sin(vAlong * 38.0 - uTime * 5.0);             // scan rings travelling outward
    float rim   = pow(1.0 - abs(dot(normalize(vNormalV), normalize(vViewPos))), 2.0); // fresnel edge glow

    float a = uOpacity * 2.6 * ((0.30 + 0.70 * fade) * (0.60 + 0.40 * rings) + rim * 0.22);
    gl_FragColor = vec4(uColor, clamp(a, 0.0, 0.85));
  }
`;

/**
 * Drop-in replacement for the MeshBasicMaterial that level2.js used for camera cones.
 * It still exposes `.opacity` and `.color`, so level2's existing detection code
 * (material.opacity = ..., material.color.setHex(...)) keeps working untouched.
 */
export function createVisionConeMaterial({ color = 0xff3333, opacity = 0.12, flip = true } = {}) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: fxTime,
      uFlip: { value: flip ? 1 : 0 },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
    },
    vertexShader: CONE_VERT,
    fragmentShader: CONE_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  Object.defineProperty(mat, 'opacity', {
    configurable: true,
    get() { return mat.uniforms.uOpacity.value; },
    set(v) { mat.uniforms.uOpacity.value = v; },
  });
  mat.color = mat.uniforms.uColor.value;
  return mat;
}

// ------------------------------------------------------------------- laser
const LASER_VERT = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = position;
    p.y += sin(uv.x * 40.0 + uTime * 30.0) * 0.006;       // heat shimmer across the beam's thickness
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const LASER_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uPeriod;    // length of one on/off cycle (seconds)
  uniform float uOnTime;    // how long the beam is lethal each cycle
  uniform float uPhase;     // offset so gates are not in sync
  uniform vec3  uColor;
  varying vec2  vUv;

  float hash(float n) { return fract(sin(n) * 43758.5453); }

  void main() {
    // Same formula JS will use for hit-testing:  c = (t + phase) mod period;  lethal if c < onTime
    float c = mod(uTime + uPhase, uPeriod);
    float on = c < uOnTime ? 1.0 : 0.0;
    float edge = smoothstep(0.0, 0.1, c) * smoothstep(0.0, 0.15, uOnTime - c);   // soft fade in/out
    float warn = (c > uPeriod - 0.7) ? (0.18 + 0.12 * sin(uTime * 30.0)) : 0.0;  // flicker just before it fires
    float strength = on * edge + warn;

    float d = abs(vUv.y - 0.5) * 2.0;                       // 0 on the beam axis, 1 at the quad edge
    float core  = exp(-d * d * 28.0);
    float glow  = exp(-d * d * 4.0) * 0.45;
    float pulse = 0.75 + 0.25 * sin(vUv.x * 60.0 - uTime * 18.0);   // energy packets running along the beam
    float flick = 0.88 + 0.12 * hash(floor(uTime * 60.0));          // electrical flicker

    vec3 col = mix(uColor, vec3(1.0), core * 0.8);
    float lethal = (core + glow) * pulse * flick * strength;
    // while the beam is down, a faint dashed line shows where it will come back
    float dashes = (1.0 - on) * step(0.5, fract(vUv.x * 24.0 - uTime * 0.5)) * exp(-d * d * 30.0) * 0.20;

    gl_FragColor = vec4(col, clamp(lethal + dashes, 0.0, 1.0));
  }
`;

export function createLaserMaterial({ color = 0xff2222, period = 4.0, onTime = 2.2, phase = 0.0 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: fxTime,
      uPeriod: { value: period },
      uOnTime: { value: onTime },
      uPhase: { value: phase },
      uColor: { value: new THREE.Color(color) },
    },
    vertexShader: LASER_VERT,
    fragmentShader: LASER_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

// ------------------------------------------------------------- guard vision fan
/** A flat sector on the floor, apex at the origin, opening toward +z. uv.y = distance fraction (0 apex -> 1 far edge). */
export function createFanGeometry(range, halfAngle, segments = 20) {
  const pos = [0, 0, 0];
  const uvs = [0.5, 0];
  for (let i = 0; i <= segments; i++) {
    const a = -halfAngle + (2 * halfAngle * i) / segments;
    pos.push(Math.sin(a) * range, 0, Math.cos(a) * range);
    uvs.push(i / segments, 1);
  }
  const idx = [];
  for (let i = 1; i <= segments; i++) idx.push(0, i, i + 1);
  const normals = [];
  for (let i = 0; i < pos.length / 3; i++) normals.push(0, 1, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setIndex(idx);
  return g;
}

// ------------------------------------------------------------------ hologram
// Level 3 artifact: vertex displacement + fresnel + scanlines. uPulse (0..1) is driven by game state
// (it turns the artifact from gold to alarm-red once the vault alarm trips).
const HOLO_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uPulse;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  varying float vY;
  void main() {
    vec3 p = position;
    float wob = sin(p.y * 9.0 + uTime * 3.0) * 0.5 + sin(p.x * 7.0 - uTime * 2.0) * 0.5;
    p += normal * wob * (0.025 + 0.03 * uPulse);       // the crystal "breathes" along its normals
    vY = p.y;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vViewPos = -mv.xyz;
    vNormalV = normalMatrix * normal;
    gl_Position = projectionMatrix * mv;
  }
`;
const HOLO_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uPulse;
  uniform vec3  uColor;
  varying vec3  vNormalV;
  varying vec3  vViewPos;
  varying float vY;
  void main() {
    float fres = pow(1.0 - abs(dot(normalize(vNormalV), normalize(vViewPos))), 2.2);
    float scan = 0.5 + 0.5 * sin(vY * 70.0 - uTime * 6.0);            // scanlines sliding up the crystal
    float beat = 0.8 + 0.2 * sin(uTime * (3.0 + 8.0 * uPulse));
    vec3 col = mix(uColor, vec3(1.0, 0.25, 0.2), uPulse);
    float a = (0.35 + 0.65 * fres) * (0.7 + 0.3 * scan) * beat;
    gl_FragColor = vec4(col * (0.8 + 1.2 * fres), clamp(a, 0.0, 1.0));
  }
`;
export function createHologramMaterial(color = 0xffcc33) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: fxTime, uPulse: { value: 0 }, uColor: { value: new THREE.Color(color) } },
    vertexShader: HOLO_VERT,
    fragmentShader: HOLO_FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
}
