// Sound effects, synthesised with the Web Audio API instead of shipped as
// files. Same reasoning as the procedural textures in level1.js: nothing to
// record, nothing to credit, and it behaves identically wherever this gets
// deployed. Only the earpiece VOICE lines need real recordings, everything
// here is short tones/noise bursts built in code.

let ctx = null;
let master = null;            // EVERY sound (effects + music) goes through this one gain node
let sfxBus = null;            // footsteps / keys / doors / stings — the "Sound Effects" slider
let musicBus = null;          // the procedural score — the "Music" slider
let masterVolume = 1;         // 0..1, set by the player with the - / + keys (see volume.js)
let sfxVolume = 1;            // 0..1, "Sound Effects" in Settings
let musicVolume = 1;          // 0..1, "Music" in Settings
function getCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = masterVolume * masterVolume;     // squared: closer to how loudness is perceived
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();  sfxBus.gain.value = sfxVolume;   sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = musicVolume; musicBus.connect(master);
  }
  return ctx;
}
export function getMasterNode() { getCtx(); return master; }
export function getSfxNode() { getCtx(); return sfxBus; }
export function getMusicNode() { getCtx(); return musicBus; }
export function setMasterVolume(v) {
  masterVolume = Math.max(0, Math.min(1, v));
  if (master) master.gain.value = masterVolume * masterVolume;
}
export function getMasterVolume() { return masterVolume; }
export function setSfxVolume(v) {
  sfxVolume = Math.max(0, Math.min(1, v));
  if (sfxBus) sfxBus.gain.value = sfxVolume;
}
export function getSfxVolume() { return sfxVolume; }
export function setMusicVolume(v) {
  musicVolume = Math.max(0, Math.min(1, v));
  if (musicBus) musicBus.gain.value = musicVolume;
}
export function getMusicVolume() { return musicVolume; }
export function getAudioContext() { return getCtx(); }

// Call this from the same click that unlocks pointer lock, same reasoning
// as loadEarpieceAudio(): a fresh AudioContext starts 'suspended' until a
// user gesture resumes it. Safe to call more than once.
export function resumeAudioContext() {
  const ac = getCtx();
  if (ac.state === 'suspended') ac.resume().catch(() => {});
}

function playTone({ freq = 440, duration = 0.15, type = 'sine', gain = 0.2, freqEnd = null, delay = 0 }) {
  const ac = getCtx();
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t0 + duration);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g).connect(getSfxNode());
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

// Short filtered noise burst, decaying to silence, used for thuds/clicks
// that a pure tone can't sell on its own.
function playNoiseBurst({ duration = 0.08, gain = 0.15, filterFreq = 1200, delay = 0 }) {
  const ac = getCtx();
  const t0 = ac.currentTime + delay;
  const bufferSize = Math.max(1, Math.floor(ac.sampleRate * duration));
  const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize); // linear decay
  }
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = filterFreq;
  const g = ac.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(getSfxNode());
  src.start(t0);
}

// ---- One-shot event sounds ------------------------------------------------

// Footstep: a soft, muffled thump. The building is meant to be quiet, so these
// sit well below the event stings. `gain` scales with stance (sprint louder than
// a crouch), `pan` alternates -1/+1 for left/right, and `bright` opens the
// lowpass a touch so a sprint reads as quicker heel-strikes than a crawl.
export function playFootstep({ gain = 0.06, pan = 0, bright = 700 } = {}) {
  const ac = getCtx();
  const t0 = ac.currentTime;
  const bufferSize = Math.max(1, Math.floor(ac.sampleRate * 0.09));
  const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    const env = Math.pow(1 - i / bufferSize, 2.2);          // fast attack, quick decay
    data[i] = (Math.random() * 2 - 1) * env;
  }
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = bright;
  const body = ac.createOscillator();                       // a little low thud under the noise
  body.type = 'sine';
  body.frequency.setValueAtTime(120, t0);
  body.frequency.exponentialRampToValueAtTime(60, t0 + 0.07);
  const bg = ac.createGain();
  bg.gain.setValueAtTime(gain * 0.8, t0);
  bg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
  const g = ac.createGain();
  g.gain.value = gain;
  let tail = g;
  if (ac.createStereoPanner) {                              // alternate feet left/right
    const p = ac.createStereoPanner(); p.pan.value = pan * 0.35;
    g.connect(p); tail = p;
  }
  src.connect(lp).connect(g);
  body.connect(bg).connect(tail);
  tail.connect(getSfxNode());
  src.start(t0);
  body.start(t0); body.stop(t0 + 0.1);
}

export function playTakedownThud() {
  playTone({ freq: 90, freqEnd: 42, duration: 0.22, type: 'sine', gain: 0.35 });
  playNoiseBurst({ duration: 0.12, gain: 0.22, filterFreq: 350 });
}

export function playKeyPickup() {
  playTone({ freq: 660, duration: 0.08, type: 'square', gain: 0.15 });
  playTone({ freq: 990, duration: 0.1, type: 'square', gain: 0.15, delay: 0.08 });
}

export function playKeycardPickup() {
  playTone({ freq: 880, duration: 0.09, type: 'triangle', gain: 0.2 });
  playTone({ freq: 1320, duration: 0.14, type: 'triangle', gain: 0.2, delay: 0.09 });
}

export function playDoorUnlock() {
  playNoiseBurst({ duration: 0.05, gain: 0.25, filterFreq: 2200 });
  playTone({ freq: 300, duration: 0.07, type: 'square', gain: 0.15, delay: 0.05 });
}

export function playDoorDenied() {
  playTone({ freq: 220, duration: 0.14, type: 'square', gain: 0.12 });
  playTone({ freq: 175, duration: 0.16, type: 'square', gain: 0.12, delay: 0.12 });
}

export function playElevatorDing() {
  playTone({ freq: 1046.5, duration: 0.6, type: 'sine', gain: 0.25 }); // C6
  playTone({ freq: 1318.5, duration: 0.7, type: 'sine', gain: 0.2, delay: 0.15 }); // E6
}

export function playWinSting() {
  [523, 659, 784, 1046].forEach((f, i) =>
    playTone({ freq: f, duration: 0.3, type: 'triangle', gain: 0.18, delay: i * 0.1 })
  );
}

export function playLoseSting() {
  [400, 320, 240].forEach((f, i) =>
    playTone({ freq: f, duration: 0.35, type: 'sawtooth', gain: 0.16, delay: i * 0.12 })
  );
}

// ---- Looping alarm klaxon -------------------------------------------------
// Two alternating tones, same cadence as a generic security siren. Started
// on triggerAlarm(), stopped on reset/win/caught.

let klaxonInterval = null;
export function startAlarmKlaxon() {
  if (klaxonInterval) return; // already running, don't stack intervals
  let high = true;
  const cycle = () => {
    playTone({ freq: high ? 740 : 520, duration: 0.5, type: 'sawtooth', gain: 0.1 });
    high = !high;
  };
  cycle();
  klaxonInterval = setInterval(cycle, 500);
}
export function stopAlarmKlaxon() {
  clearInterval(klaxonInterval);
  klaxonInterval = null;
}

// ---- Anticipation heartbeat -------------------------------------------------
// Low double-thump, tempo controlled by the caller (main.js speeds it up as
// the escape timer runs down) instead of a fixed interval here.

let heartbeatTimeout = null;
export function startHeartbeat(getIntervalMs) {
  stopHeartbeat();
  const beat = () => {
    playTone({ freq: 58, duration: 0.09, type: 'sine', gain: 0.3 });
    playTone({ freq: 52, duration: 0.08, type: 'sine', gain: 0.2, delay: 0.15 });
    heartbeatTimeout = setTimeout(beat, getIntervalMs());
  };
  beat();
}
export function stopHeartbeat() {
  clearTimeout(heartbeatTimeout);
  heartbeatTimeout = null;
}

// ---- Extraction helicopter rotor loop ---------------------------------------
// A looping lowpassed-noise rumble (the wash of air) plus a blade-pass "thump"
// made by modulating a low sine with a ~13 Hz LFO. Both spin up over ~2s when
// started so the bird sounds like it's already working as it settles onto the
// pad. Runs through the SFX bus so the Effects slider still governs it.
let rotorNodes = null;
export function startRotorLoop() {
  if (rotorNodes) return; // already running
  const ac = getCtx();
  const t0 = ac.currentTime;

  // rumble: 2 s of noise looped through a lowpass
  const len = Math.floor(ac.sampleRate * 2);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;      // brown-ish: smoother, lower
    d[i] = last * 3.2;
  }
  const rumbleSrc = ac.createBufferSource();
  rumbleSrc.buffer = buf; rumbleSrc.loop = true;
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
  const rumbleGain = ac.createGain(); rumbleGain.gain.value = 0.0001;
  rumbleSrc.connect(lp).connect(rumbleGain).connect(getSfxNode());

  // blade thump: low sine pulsed by an LFO
  const thumpOsc = ac.createOscillator(); thumpOsc.type = 'sine'; thumpOsc.frequency.value = 54;
  const thumpGain = ac.createGain(); thumpGain.gain.value = 0.0;
  const lfo = ac.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 4;
  const lfoDepth = ac.createGain(); lfoDepth.gain.value = 0.18;
  lfo.connect(lfoDepth).connect(thumpGain.gain);
  thumpOsc.connect(thumpGain).connect(getSfxNode());

  rumbleSrc.start(t0); thumpOsc.start(t0); lfo.start(t0);
  // spin-up
  rumbleGain.gain.linearRampToValueAtTime(0.5, t0 + 2.0);
  lfo.frequency.linearRampToValueAtTime(13, t0 + 2.2);

  rotorNodes = { rumbleSrc, thumpOsc, lfo, rumbleGain, thumpGain, lfoDepth };
}
export function stopRotorLoop(fade = 1.0) {
  if (!rotorNodes) return;
  const ac = getCtx();
  const t0 = ac.currentTime;
  const { rumbleSrc, thumpOsc, lfo, rumbleGain, thumpGain, lfoDepth } = rotorNodes;
  rotorNodes = null;
  const f = Math.max(0.05, fade);
  rumbleGain.gain.cancelScheduledValues(t0);
  rumbleGain.gain.setValueAtTime(rumbleGain.gain.value, t0);
  rumbleGain.gain.linearRampToValueAtTime(0.0001, t0 + f);
  lfoDepth.gain.cancelScheduledValues(t0);
  lfoDepth.gain.setValueAtTime(lfoDepth.gain.value, t0);
  lfoDepth.gain.linearRampToValueAtTime(0.0001, t0 + f);
  [rumbleSrc, thumpOsc, lfo].forEach((n) => { try { n.stop(t0 + f + 0.05); } catch (e) {} });
}

// ---- Mission-complete celebration -------------------------------------------
// Routed through the MUSIC bus (it's a score sting, not an effect): an
// ascending major fanfare, a warm sustained brass-ish chord underneath, and a
// shimmering cymbal swell. Played the instant the MISSION COMPLETE sign lands.
function playBusTone(bus, { freq = 440, duration = 0.3, type = 'sine', gain = 0.2, freqEnd = null, delay = 0 }) {
  const ac = getCtx();
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator(); osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t0 + duration);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g).connect(bus);
  osc.start(t0); osc.stop(t0 + duration + 0.03);
}
function playCymbal(bus, { duration = 1.4, gain = 0.14, delay = 0 } = {}) {
  const ac = getCtx();
  const t0 = ac.currentTime + delay;
  const len = Math.max(1, Math.floor(ac.sampleRate * duration));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const env = Math.pow(1 - i / len, 1.6);            // shimmer in, long decay
    d[i] = (Math.random() * 2 - 1) * env;
  }
  const src = ac.createBufferSource(); src.buffer = buf;
  const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4200;
  const g = ac.createGain(); g.gain.value = gain;
  src.connect(hp).connect(g).connect(bus);
  src.start(t0);
}
export function playMissionComplete() {
  const bus = getMusicNode();
  // ascending C-major fanfare (bells)
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
    playBusTone(bus, { freq: f, duration: 0.9, type: 'triangle', gain: 0.16, delay: i * 0.13 })
  );
  // sustained brass-ish C-major chord swelling underneath
  [261.63, 329.63, 392.0, 523.25].forEach((f) =>
    playBusTone(bus, { freq: f, duration: 2.4, type: 'sawtooth', gain: 0.05, delay: 0.45 })
  );
  // top sparkle octave hit + cymbal
  playBusTone(bus, { freq: 1567.98, duration: 1.2, type: 'sine', gain: 0.09, delay: 0.52 });
  playCymbal(bus, { duration: 1.8, gain: 0.13, delay: 0.4 });
}