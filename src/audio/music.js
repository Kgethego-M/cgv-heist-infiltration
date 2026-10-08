import { getAudioContext, getMusicNode } from './sfx.js';

// ============================================================
// PROCEDURAL SCORE — a smooth, suspense-building bed (Web Audio, no files)
//
// The old soundtrack was a percussive pad + kick/hat groove. This replaces it
// with an ambient tension bed that slowly BUILDS instead of looping a beat:
//   - a low detuned drone that breathes under a slow filter sweep
//   - sparse, long-decaying minor "bell" notes that appear every few seconds
//   - a soft sub pulse whose rate and level rise with tension
//   - a filtered-noise riser that swells as `intensity` climbs toward alarm
// There are no drums and no clicks — everything is sustained and eased, so the
// score reads as dread rather than rhythm. setMusicIntensity(0..1) is still
// driven by main.js from the alarm / guard-detection state.
//
// Each level keeps its own root so the bed darkens as you go deeper, but the
// timbre and behaviour are the same smooth suspense voice everywhere.
// ============================================================

const LEVELS = {
  1: { root: 55.0,  scale: [0, 3, 7, 10, 12] },   // minor pentatonic offsets (semitones)
  2: { root: 49.0,  scale: [0, 3, 7, 10, 12] },
  3: { root: 41.2,  scale: [0, 1, 3, 7, 10] },   // add the minor 2nd for dread
};

let bus = null, filter = null, nodes = [], timer = null, limiter = null;
let swellLfo = null, swellGain = null, riserSrc = null, riserGain = null, riserFilter = null;
let pulseGain = null;
let level = 1, intensity = 0, running = false, noiseBuf = null;
let nextNote = 0, nextPulse = 0, pulsePhase = 0;

function noise(ac) {
  if (noiseBuf) return noiseBuf;
  noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 1.5), ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

const semi = (n) => Math.pow(2, n / 12);

// The sustained drone: two detuned triangles per chord tone + a quiet sine an
// octave down for weight, all breathing through one slow gain LFO.
function buildDrone() {
  const ac = getAudioContext();
  const cfg = LEVELS[level];
  nodes.forEach((n) => { try { if (n.stop) n.stop(); n.disconnect(); } catch (e) { /* already stopped */ } });
  nodes = [];
  [0, 7].forEach((interval) => {                    // root + fifth
    [-6, 6].forEach((detune) => {
      const o = ac.createOscillator();
      o.type = 'triangle';
      o.frequency.value = cfg.root * 2 * semi(interval);
      o.detune.value = detune;
      const g = ac.createGain();
      g.gain.value = 0.045;
      o.connect(g).connect(filter);
      o.start();
      nodes.push(o, g);
    });
  });
  const body = ac.createOscillator(), bg = ac.createGain();
  body.type = 'sine'; body.frequency.value = cfg.root; bg.gain.value = 0.06;
  body.connect(bg).connect(filter); body.start(); nodes.push(body, bg);
}

// One long-decaying bell note from the level's minor scale. Sparse and soft.
function bell(t) {
  const ac = getAudioContext();
  const cfg = LEVELS[level];
  const deg = cfg.scale[Math.floor(Math.random() * cfg.scale.length)];
  const f = cfg.root * 8 * semi(deg);
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = 'sine';
  o.frequency.value = f;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.05 + intensity * 0.03, t + 0.4);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
  o.connect(g).connect(bus);
  o.start(t); o.stop(t + 3.4);
  // a faint detuned twin an octave up = shimmer / unease
  const o2 = ac.createOscillator(), g2 = ac.createGain();
  o2.type = 'sine'; o2.frequency.value = f * 2 * semi(1);   // +1 semitone = minor 2nd rub
  g2.gain.setValueAtTime(0.0001, t);
  g2.gain.linearRampToValueAtTime(0.014 + intensity * 0.012, t + 0.5);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
  o2.connect(g2).connect(bus);
  o2.start(t); o2.stop(t + 2.8);
}

// Soft sub pulse. Rate and level both rise with tension so the bed "builds".
function pulse(t) {
  const ac = getAudioContext();
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(cfgRoot() * 1.0, t);
  o.frequency.exponentialRampToValueAtTime(cfgRoot() * 0.5, t + 0.5);
  const lvl = 0.05 + intensity * 0.10;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(lvl, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
  o.connect(g).connect(pulseGain);
  o.start(t); o.stop(t + 0.7);
}
function cfgRoot() { return LEVELS[level].root; }

function schedule() {
  const ac = getAudioContext();
  const now = ac.currentTime;
  // sparse bells: every 3.5-6s when calm, tightening toward ~2s under alarm
  if (nextNote < now + 0.2) {
    bell(nextNote);
    nextNote += 3.5 - intensity * 1.6 + Math.random() * 2.0;
  }
  // sub pulse: slow when calm (≈0.5 Hz), faster as tension builds
  const pulseInterval = 2.0 - intensity * 1.2;
  while (nextPulse < now + 0.2) {
    pulse(nextPulse);
    nextPulse += pulseInterval;
  }
  // riser + filter open with intensity (eased in setMusicIntensity)
  if (riserGain) riserGain.gain.setTargetAtTime(0.010 + intensity * 0.05, now, 1.2);
  if (filter) filter.frequency.setTargetAtTime(500 + intensity * 2200, now, 1.0);
  if (pulseGain) pulseGain.gain.setTargetAtTime(0.5 + intensity * 0.8, now, 0.8);
  pulsePhase += 0.04;
}

export function startMusic(lvl = 1) {
  const ac = getAudioContext();
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  level = lvl;
  if (!running) {
    bus = ac.createGain(); bus.gain.value = 0;
    filter = ac.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = 1.2;
    limiter = ac.createDynamicsCompressor();
    limiter.threshold.value = -14; limiter.ratio.value = 6;
    pulseGain = ac.createGain(); pulseGain.gain.value = 0.5;
    filter.connect(bus); pulseGain.connect(bus);
    bus.connect(limiter); limiter.connect(getMusicNode());

    // slow breathing swell on the whole bed
    swellLfo = ac.createOscillator(); swellGain = ac.createGain();
    swellLfo.frequency.value = 0.06; swellGain.gain.value = 0;   // depth applied to filter below
    swellLfo.connect(swellGain).connect(filter.frequency); swellLfo.start();

    // filtered-noise riser (air / dread), level set by intensity in schedule()
    riserSrc = ac.createBufferSource(); riserSrc.buffer = noise(ac); riserSrc.loop = true;
    riserFilter = ac.createBiquadFilter(); riserFilter.type = 'bandpass'; riserFilter.Q.value = 0.8;
    riserFilter.frequency.value = 900;
    riserGain = ac.createGain(); riserGain.gain.value = 0.0;
    riserSrc.connect(riserFilter).connect(riserGain).connect(bus);
    riserSrc.start();

    running = true;
    nextNote = ac.currentTime + 1.5;
    nextPulse = ac.currentTime + 0.2;
    timer = setInterval(schedule, 60);
  }
  swellGain.gain.value = 120;                       // filter sweep depth (Hz)
  buildDrone();
  bus.gain.cancelScheduledValues(ac.currentTime);
  bus.gain.linearRampToValueAtTime(1.15, ac.currentTime + 3.0);   // long, smooth fade-in
}

export function setMusicLevel(lvl) {
  if (!running || lvl === level) return;
  level = lvl;
  buildDrone();
}

// 0 = calm, 1 = full alarm. Eased inside schedule() so changes are heard as
// slow swells (filter open, riser up, pulse faster), never as jumps.
export function setMusicIntensity(x) {
  intensity += (Math.max(0, Math.min(1, x)) - intensity) * 0.04;
}

export function stopMusic() {
  if (!running) return;
  clearInterval(timer);
  const ac = getAudioContext();
  bus.gain.linearRampToValueAtTime(0, ac.currentTime + 1.0);
  nodes.forEach((n) => { try { if (n.stop) n.stop(ac.currentTime + 1.2); } catch (e) { /* ignore */ } });
  try { swellLfo.stop(ac.currentTime + 1.2); } catch (e) { /* ignore */ }
  try { riserSrc.stop(ac.currentTime + 1.2); } catch (e) { /* ignore */ }
  nodes = []; running = false;
}
