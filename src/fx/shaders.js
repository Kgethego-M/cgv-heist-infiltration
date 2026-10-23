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

// ------------------------------------------------------------- holo screen
// Glitchy holographic terminal screen for Level 2's hack terminal and monitors.
// Vertex: subtle wobble. Fragment: scanlines, RGB glitch bands, data-stream columns.
// uGlitch (0..1) driven by game state — spikes while hacking, calm when idle.
const HOLO_SCREEN_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uGlitch;
  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  void main() {
    vUv = uv;
    vec3 p = position;
    float jitter = step(0.97, fract(sin(floor(uTime * 12.0) * 43.17) * 173.3));
    p.x += jitter * uGlitch * 0.04 * sin(p.y * 50.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vViewPos = -mv.xyz;
    vNormalV = normalMatrix * normal;
    gl_Position = projectionMatrix * mv;
  }
`;
const HOLO_SCREEN_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uGlitch;
  uniform vec3  uColor;
  varying vec2  vUv;
  varying vec3  vNormalV;
  varying vec3  vViewPos;

  float hash(float n) { return fract(sin(n) * 43758.5453); }
  float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec2 uv = vUv;
    float scan = 0.85 + 0.15 * sin(uv.y * 220.0 + uTime * 3.0);
    float band = step(0.985, hash(floor(uv.y * 40.0) + floor(uTime * 8.0))) * uGlitch;
    uv.x += band * 0.15 * sin(uTime * 200.0);
    float col = hash2(vec2(floor(uv.x * 24.0), floor(uv.y * 16.0 - uTime * 4.0)));
    float stream = step(0.82, col) * 0.35;
    float crt = 1.0 - 0.4 * pow(length(uv - 0.5) * 1.4, 2.0);
    float flick = 0.92 + 0.08 * sin(uTime * 60.0 + hash(floor(uTime * 15.0)) * 6.28);
    float fres = pow(1.0 - abs(dot(normalize(vNormalV), normalize(vViewPos))), 1.5);
    vec3 col3 = uColor * (0.6 + stream + 0.4 * scan) * flick * crt;
    col3 += uColor * fres * 0.3;
    col3 += vec3(1.0) * band * 0.5;
    float a = (0.7 + 0.3 * scan) * crt;
    gl_FragColor = vec4(col3, clamp(a, 0.0, 1.0));
  }
`;
export function createHoloScreenMaterial({ color = 0x33ffcc, glitch = 0.1 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: fxTime, uGlitch: { value: glitch }, uColor: { value: new THREE.Color(color) },
    },
    vertexShader: HOLO_SCREEN_VERT, fragmentShader: HOLO_SCREEN_FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}

// ------------------------------------------------------------- server LED
// Animated blinking LED strip for server racks (Level 2).
// uActivity (0..1) drives how many LEDs are lit (idle = few, alert = all flashing).
const SERVER_LED_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SERVER_LED_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uActivity;
  uniform vec3  uColor;
  varying vec2  vUv;

  float hash(float n) { return fract(sin(n) * 43758.5453); }

  void main() {
    float cellX = floor(vUv.x * 16.0);
    float cellY = floor(vUv.y * 8.0);
    float cellId = cellX + cellY * 16.0;
    float blink = step(0.5, hash(cellId) + 0.5 * sin(uTime * (2.0 + hash(cellId + 7.0) * 6.0) + cellId));
    float activity = mix(0.3, 1.0, uActivity);
    float on = blink * step(hash(cellId + 3.0), activity);
    float glow = 0.4 + 0.6 * on;
    vec3 col = uColor * glow;
    float a = 0.15 + 0.85 * on;
    gl_FragColor = vec4(col, a);
  }
`;
export function createServerLedMaterial({ color = 0x33ff66, activity = 0.3 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: fxTime, uActivity: { value: activity }, uColor: { value: new THREE.Color(color) },
    },
    vertexShader: SERVER_LED_VERT, fragmentShader: SERVER_LED_FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}

// ------------------------------------------------------------- pressure plate
// Pulsing pressure plate for Level 3's trap corridor.
// uActive: 0 = idle (dim pulse), 1 = triggered (bright flash + fast pulse).
const PLATE_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uActive;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = position;
    p.y += sin(uTime * (2.0 + 8.0 * uActive)) * 0.005 * (1.0 + uActive);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const PLATE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uActive;
  uniform vec3  uColor;
  uniform vec3  uAlertColor;
  varying vec2  vUv;

  void main() {
    vec2 c = vUv - 0.5;
    float r = length(c) * 2.0;
    float ring = smoothstep(0.9, 0.7, r);
    float pulse = 0.5 + 0.5 * sin(uTime * (3.0 + 12.0 * uActive));
    float inner = smoothstep(0.5, 0.1, r);
    vec3 col = mix(uColor, uAlertColor, uActive);
    float glow = ring * (0.4 + 0.6 * pulse) + inner * 0.3 * pulse;
    float edge = smoothstep(1.0, 0.85, r);
    float a = edge * (0.5 + 0.5 * pulse);
    gl_FragColor = vec4(col * (0.6 + glow * 1.5), clamp(a, 0.0, 1.0));
  }
`;
export function createPressurePlateMaterial({ color = 0xffaa00, alertColor = 0xff2222 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: fxTime,
      uActive: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uAlertColor: { value: new THREE.Color(alertColor) },
    },
    vertexShader: PLATE_VERT, fragmentShader: PLATE_FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

// ------------------------------------------------------------- alarm pulse
// Wall-mounted alarm pulse effect for Level 1.
// uAlarm: 0 = off, 1 = full alarm. Drives red pulse across the surface.
const ALARM_PULSE_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalV;
  void main() {
    vUv = uv;
    vNormalV = normalMatrix * normal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const ALARM_PULSE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uAlarm;
  uniform vec3  uColor;
  varying vec2  vUv;
  varying vec3  vNormalV;

  void main() {
    float pulse = 0.5 + 0.5 * sin(uTime * 6.0);
    float wave = 0.5 + 0.5 * sin(vUv.y * 12.0 - uTime * 4.0);
    float intensity = uAlarm * pulse * wave;
    float edge = pow(1.0 - abs(dot(normalize(vNormalV), vec3(0.0, 0.0, 1.0))), 1.5);
    vec3 col = uColor * intensity * (0.6 + edge * 0.4);
    float a = intensity * 0.7;
    gl_FragColor = vec4(col, clamp(a, 0.0, 0.85));
  }
`;
export function createAlarmPulseMaterial({ color = 0xff1111 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: fxTime, uAlarm: { value: 0 }, uColor: { value: new THREE.Color(color) },
    },
    vertexShader: ALARM_PULSE_VERT, fragmentShader: ALARM_PULSE_FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

// ------------------------------------------------------------- vault floor
// Procedural tile floor for Level 3's vault room. uPathFlash (0..1) lights the
// safe path; uAlarmFlash (0..1) turns wrong tiles red.
const VAULT_FLOOR_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const VAULT_FLOOR_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uPathFlash;
  uniform float uAlarmFlash;
  uniform vec3  uSafeColor;
  uniform vec3  uDangerColor;
  uniform vec3  uBaseColor;
  varying vec2  vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec2 tile = fract(vUv * 8.0);  
    float edge = smoothstep(0.0, 0.06, tile.x) * smoothstep(0.0, 0.06, tile.y)
               * smoothstep(0.0, 0.06, 1.0 - tile.x) * smoothstep(0.0, 0.06, 1.0 - tile.y);
    vec3 base = uBaseColor * (0.7 + 0.3 * edge);
    float pathPulse = 0.6 + 0.4 * sin(uTime * 5.0);
    vec3 safe = uSafeColor * uPathFlash * pathPulse * edge;
    float dangerPulse = 0.5 + 0.5 * sin(uTime * 18.0);
    vec3 danger = uDangerColor * uAlarmFlash * dangerPulse;
    vec3 col = base + safe + danger;
    gl_FragColor = vec4(col, 1.0);
  }
`;
export function createVaultFloorMaterial({
  baseColor = 0x1a1a22, safeColor = 0x33ff88, dangerColor = 0xff2222,
} = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: fxTime,
      uPathFlash: { value: 0 },
      uAlarmFlash: { value: 0 },
      uBaseColor: { value: new THREE.Color(baseColor) },
      uSafeColor: { value: new THREE.Color(safeColor) },
      uDangerColor: { value: new THREE.Color(dangerColor) },
    },
    vertexShader: VAULT_FLOOR_VERT, fragmentShader: VAULT_FLOOR_FRAG,
    transparent: false,
  });
}

// ------------------------------------------------------------- force field
// Transparent energy barrier with fresnel edge glow and ripple.
// uOpacity (0..1) drives overall visibility; uPulse adds a breathing effect.
const FORCE_FIELD_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uPulse;
  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  void main() {
    vUv = uv;
    vec3 p = position;
    p += normal * sin(p.y * 8.0 + uTime * 3.0) * 0.02 * (1.0 + uPulse);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vViewPos = -mv.xyz;
    vNormalV = normalMatrix * normal;
    gl_Position = projectionMatrix * mv;
  }
`;
const FORCE_FIELD_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform float uPulse;
  uniform vec3  uColor;
  varying vec2  vUv;
  varying vec3  vNormalV;
  varying vec3  vViewPos;

  void main() {
    float fres = pow(1.0 - abs(dot(normalize(vNormalV), normalize(vViewPos))), 2.5);
    float hex = 0.5 + 0.5 * sin(vUv.x * 40.0 + vUv.y * 40.0 + uTime * 2.0);
    float pulse = 0.7 + 0.3 * sin(uTime * (2.0 + 4.0 * uPulse));
    float scanline = 0.9 + 0.1 * sin(vUv.y * 150.0 + uTime * 5.0);
    vec3 col = uColor * (0.4 + fres * 0.6 + hex * 0.2) * pulse * scanline;
    float a = uOpacity * (0.15 + fres * 0.7 + hex * 0.15) * pulse;
    gl_FragColor = vec4(col, clamp(a, 0.0, 0.85));
  }
`;
export function createForceFieldMaterial({ color = 0x4488ff, opacity = 0.35 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: fxTime, uOpacity: { value: opacity }, uPulse: { value: 0 },
      uColor: { value: new THREE.Color(color) },
    },
    vertexShader: FORCE_FIELD_VERT, fragmentShader: FORCE_FIELD_FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

// ------------------------------------------------------------- data stream
// Vertical scrolling data columns for server-room accent panels (Level 2).
// uSpeed drives scroll rate, uBrightness controls overall glow intensity.
const DATA_STREAM_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const DATA_STREAM_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uSpeed;
  uniform float uBrightness;
  uniform vec3  uColor;
  varying vec2  vUv;

  float hash(float n) { return fract(sin(n) * 43758.5453); }
  float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec2 uv = vUv;
    // Scrolling columns of varying height
    float col = floor(uv.x * 32.0);
    float colHash = hash(col);
    float scroll = fract(uv.y * 6.0 - uTime * uSpeed * (0.5 + colHash * 1.5) + colHash * 100.0);
    float cell = floor(uv.y * 6.0 - uTime * uSpeed * (0.5 + colHash * 1.5) + colHash * 100.0);
    float cellHash = hash2(vec2(col, cell));
    // Characters appear as lit cells in the column
    float charOn = step(0.55, cellHash) * step(scroll, 0.7 + 0.3 * cellHash);
    // Occasional bright "data burst" rows
    float burst = step(0.97, hash(floor(uTime * 4.0) + col));
    float intensity = charOn * (0.4 + 0.6 * hash(cellHash * 17.0)) + burst * 0.5;
    intensity *= uBrightness;
    // Edge fade so the panel has soft borders
    float edgeFade = smoothstep(0.0, 0.08, uv.x) * smoothstep(1.0, 0.92, uv.x)
                   * smoothstep(0.0, 0.05, uv.y) * smoothstep(1.0, 0.95, uv.y);
    vec3 col3 = uColor * intensity * edgeFade;
    float a = intensity * edgeFade * 0.85;
    gl_FragColor = vec4(col3, clamp(a, 0.0, 1.0));
  }
`;
export function createDataStreamMaterial({ color = 0x33ff99, speed = 1.2, brightness = 0.8 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: fxTime, uSpeed: { value: speed }, uBrightness: { value: brightness },
      uColor: { value: new THREE.Color(color) },
    },
    vertexShader: DATA_STREAM_VERT, fragmentShader: DATA_STREAM_FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}

// ------------------------------------------------------------- emergency light
// Rotating emergency beacon strip for corridors (all levels during alarm).
// uAlarm (0..1) transitions from dim standby to full rotating red sweep.
const EMERGENCY_LIGHT_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalV;
  void main() {
    vUv = uv;
    vNormalV = normalMatrix * normal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const EMERGENCY_LIGHT_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uAlarm;
  uniform vec3  uColor;
  varying vec2  vUv;
  varying vec3  vNormalV;

  void main() {
    // Rotating sweep: a bright band that spins across the strip
    float sweep = sin(vUv.x * 12.5664 - uTime * 8.0);
    float beam = smoothstep(0.3, 1.0, sweep) * uAlarm;
    // Standby dim pulse when alarm is off
    float standby = (1.0 - uAlarm) * (0.08 + 0.04 * sin(uTime * 2.0));
    // Hot-spot at the centre of each fixture
    float centre = exp(-pow((vUv.y - 0.5) * 3.0, 2.0));
    float intensity = beam * centre + standby;
    // Fresnel-like edge glow
    float edge = pow(1.0 - abs(dot(normalize(vNormalV), vec3(0.0, 0.0, 1.0))), 1.8);
    vec3 col = uColor * intensity * (0.7 + edge * 0.3);
    float a = intensity * (0.5 + edge * 0.5);
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  }
`;
export function createEmergencyLightMaterial({ color = 0xff2200 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: fxTime, uAlarm: { value: 0 }, uColor: { value: new THREE.Color(color) },
    },
    vertexShader: EMERGENCY_LIGHT_VERT, fragmentShader: EMERGENCY_LIGHT_FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

// ============================================================
// TECH GLOW PASS  (post-processing, used by main.js's EffectComposer)
//
// A bright, clean full-screen effect that gives the game a polished
// "high-tech heist" look WITHOUT darkening the scene:
//   - Subtle horizontal scanlines (digital/tech feel)
//   - Gentle colour grading (slight cool-blue tint)
//   - Soft glow approximation (bright areas bloom slightly)
//   - Very light chromatic aberration at edges (stylish, not distracting)
//   - NO vignette, NO grain — visibility stays high
// uTime is advanced by main.js each frame (animates the scanline drift).
// ============================================================
export const CinematicGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uScanlines: { value: 0.0 } /* scanlines OFF (was 0.04) */,    // scanline intensity (0 = off, 0.1 = strong)
    uGlow: { value: 0.12 },         // soft glow strength
    uAberration: { value: 0.0008 }, // very subtle RGB fringing
    uTint: { value: 0.06 },         // cool-blue colour grade strength
    uBrightness: { value: 1.04 },   // slight brightness boost
    uGamma: { value: 1.0 },         // shadow lift for the Settings brightness slider (1 = off)
  },
  vertexShader: /* glsl */ `
    varying vec2 vUvG;
    void main() {
      vUvG = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uScanlines;
    uniform float uGlow;
    uniform float uAberration;
    uniform float uTint;
    uniform float uBrightness;
    uniform float uGamma;
    varying vec2 vUvG;

    void main() {
      vec2 uv = vUvG;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);

      // Chromatic aberration — very subtle, only at extreme edges
      vec2 off = c * uAberration * r2 * 4.0;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;

      // Brightness boost — lifts the whole image slightly
      col *= uBrightness;

      // Soft glow approximation — sample neighbours and add bright parts
      // (cheap single-pass bloom without a real blur)
      vec3 glow = vec3(0.0);
      float gs = 0.003; // glow sample distance
      glow += texture2D(tDiffuse, uv + vec2(gs, 0.0)).rgb;
      glow += texture2D(tDiffuse, uv - vec2(gs, 0.0)).rgb;
      glow += texture2D(tDiffuse, uv + vec2(0.0, gs)).rgb;
      glow += texture2D(tDiffuse, uv - vec2(0.0, gs)).rgb;
      glow *= 0.25;
      // Only add glow where the scene is already bright
      float lum = dot(glow, vec3(0.299, 0.587, 0.114));
      col += glow * smoothstep(0.35, 0.8, lum) * uGlow;

      // Cool-blue colour grade — shifts shadows slightly blue, highlights warm
      vec3 coolTint = vec3(0.92, 0.96, 1.08);
      col = mix(col, col * coolTint, uTint);

      // Subtle scanlines — horizontal lines that drift slowly
      float scan = sin(uv.y * 800.0 + uTime * 1.5) * 0.5 + 0.5;
      col -= scan * uScanlines * 0.5;

      // Gentle vignette — VERY soft, just frames the image without darkening
      float vig = 1.0 - r2 * 0.3;
      col *= mix(1.0, vig, 0.25);

      col = pow(max(col, vec3(0.0)), vec3(1.0 / uGamma));   // shadow lift (the Settings brightness slider)
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};
