import { getAudioContext, getMasterNode } from './sfx.js';

// ============================================================
// PROCEDURAL MUSIC (Web Audio API: no audio files, so nothing to download or credit)
//
// Every level has its own key, tempo and timbre, so the soundtrack changes with the level:
//   L1 lobby   - slow, low minor pad + sparse pulse        (patient, quiet)
//   L2 servers - cooler, faster, with a high triangle arp  (mechanical)
//   L3 vault   - lowest pad, driving pulse, minor 2nd      (dread)
// setMusicIntensity(0..1) opens the filter and speeds the pulse. main.js drives it from the alarm /
// guard-detection state, so the score reacts to what the player is doing.
// ============================================================

// NOTE: laptop speakers cannot reproduce much below ~150 Hz, so the pad lives at root x 4 (about 165-590 Hz)
// with one quieter "body" note at root x 2. (An earlier version sat at 40-55 Hz and was effectively silent.)
const LEVELS = {
  1: { root: 55.0, ratios: [1, 1.2, 1.5, 2.0],    bpm: 62, wave: 'sawtooth', cutoff: 1100, arp: false },
  2: { root: 49.0, ratios: [1, 1.5, 2.25, 3.0],   bpm: 76, wave: 'sawtooth', cutoff: 1500, arp: true  },
  3: { root: 41.2, ratios: [1, 1.0595, 1.5, 2.0], bpm: 84, wave: 'square',   cutoff: 900,  arp: true  },
};

let bus = null, filter = null, lfo = null, nodes = [], timer = null, limiter = null;
let level = 1, intensity = 0, nextBeat = 0, beatIdx = 0, running = false, noiseBuf = null;

function noise(ac) {
  if (noiseBuf) return noiseBuf;
  noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.2), ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

function buildPad() {
  const ac = getAudioContext();
  const cfg = LEVELS[level];
  nodes.forEach((n) => { try { if (n.stop) n.stop(); n.disconnect(); } catch (e) { /* already stopped */ } });
  nodes = [];
  cfg.ratios.forEach((r) => {
    [-7, 7].forEach((detune) => {            // two detuned oscillators per note = slow beating, an "alive" pad
      const o = ac.createOscillator();
      o.type = cfg.wave;
      o.frequency.value = cfg.root * 4 * r;
      o.detune.value = detune;
      const g = ac.createGain();
      g.gain.value = cfg.wave === 'square' ? 0.032 : 0.05;
      o.connect(g).connect(filter);
      o.start();
      nodes.push(o, g);
    });
  });
  const body = ac.createOscillator(), bg = ac.createGain();      // one quieter note an octave lower for weight
  body.type = 'sine'; body.frequency.value = cfg.root * 2; bg.gain.value = 0.07;
  body.connect(bg).connect(filter); body.start(); nodes.push(body, bg);
}

function schedule() {
  const ac = getAudioContext();
  const cfg = LEVELS[level];
  const beat = 60 / (cfg.bpm * (1 + intensity * 0.7));
  while (nextBeat < ac.currentTime + 0.15) {
    const t = nextBeat;
    const k = ac.createOscillator(), kg = ac.createGain();           // kick
    k.frequency.setValueAtTime(190, t);
    k.frequency.exponentialRampToValueAtTime(70, t + 0.1);
    kg.gain.setValueAtTime(0.38 + intensity * 0.22, t);
    kg.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    k.connect(kg).connect(bus);
    k.start(t); k.stop(t + 0.22);
    const c = ac.createBufferSource(), cg = ac.createGain(), cf = ac.createBiquadFilter();   // click: audible on any speaker
    c.buffer = noise(ac); cf.type = 'bandpass'; cf.frequency.value = 1800;
    cg.gain.setValueAtTime(0.10, t); cg.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    c.connect(cf).connect(cg).connect(bus);
    c.start(t); c.stop(t + 0.04);
    if (intensity > 0.4) {                                           // off-beat hat when tense
      const n = ac.createBufferSource(), ng = ac.createGain(), hp = ac.createBiquadFilter();
      n.buffer = noise(ac); hp.type = 'highpass'; hp.frequency.value = 6000;
      ng.gain.setValueAtTime(0.05 * intensity, t + beat / 2);
      ng.gain.exponentialRampToValueAtTime(0.001, t + beat / 2 + 0.05);
      n.connect(hp).connect(ng).connect(bus);
      n.start(t + beat / 2); n.stop(t + beat / 2 + 0.06);
    }
    if (cfg.arp && beatIdx % 2 === 0) {                              // arp note every other beat
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'triangle';
      o.frequency.value = cfg.root * 8 * cfg.ratios[(beatIdx / 2) % cfg.ratios.length];
      g.gain.setValueAtTime(0.09, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + beat * 0.9);
      o.connect(g).connect(bus);
      o.start(t); o.stop(t + beat);
    }
    beatIdx++;
    nextBeat += beat;
  }
}

export function startMusic(lvl = 1) {
  const ac = getAudioContext();
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  level = lvl;
  if (!running) {
    bus = ac.createGain(); bus.gain.value = 0;
    filter = ac.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = 2;
    limiter = ac.createDynamicsCompressor();             // keeps peaks from clipping when everything is loud
    limiter.threshold.value = -12; limiter.ratio.value = 8;
    filter.connect(bus); bus.connect(limiter); limiter.connect(getMasterNode());
    lfo = ac.createOscillator(); const lg = ac.createGain();
    lfo.frequency.value = 0.08; lg.gain.value = 140;                 // slow filter sweep
    lfo.connect(lg).connect(filter.frequency); lfo.start();
    running = true;
    nextBeat = ac.currentTime + 0.1; beatIdx = 0;
    timer = setInterval(schedule, 40);
  }
  filter.frequency.value = LEVELS[level].cutoff;
  buildPad();
  bus.gain.cancelScheduledValues(ac.currentTime);
  bus.gain.linearRampToValueAtTime(1.35, ac.currentTime + 2.5);       // fade in (the limiter above catches any peaks)
}

export function setMusicLevel(lvl) {
  if (!running || lvl === level) return;
  level = lvl;
  filter.frequency.value = LEVELS[level].cutoff;
  buildPad();
}

// 0 = calm, 1 = full alarm. Eased so changes are heard as swells, not jumps.
export function setMusicIntensity(x) {
  intensity += (Math.max(0, Math.min(1, x)) - intensity) * 0.05;
  if (running) filter.frequency.value = LEVELS[level].cutoff * (1 + intensity * 2.5);
}

export function stopMusic() {
  if (!running) return;
  clearInterval(timer);
  const ac = getAudioContext();
  bus.gain.linearRampToValueAtTime(0, ac.currentTime + 0.8);
  nodes.forEach((n) => { try { if (n.stop) n.stop(ac.currentTime + 1); } catch (e) { /* ignore */ } });
  try { lfo.stop(ac.currentTime + 1); } catch (e) { /* ignore */ }
  nodes = []; running = false;
}
