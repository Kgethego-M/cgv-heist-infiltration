// Sound effects, synthesised with the Web Audio API instead of shipped as
// files. Same reasoning as the procedural textures in level1.js: nothing to
// record, nothing to credit, and it behaves identically wherever this gets
// deployed. Only the earpiece VOICE lines need real recordings, everything
// here is short tones/noise bursts built in code.

let ctx = null;
function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

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
  osc.connect(g).connect(ac.destination);
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
  src.connect(filter).connect(g).connect(ac.destination);
  src.start(t0);
}

// ---- One-shot event sounds ------------------------------------------------

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