import {
  setMasterVolume, getMasterVolume,
  setSfxVolume, getSfxVolume,
  setMusicVolume, getMusicVolume,
} from './sfx.js';
import { setEarpieceVolume } from './earpiece.js';

// ============================================================
// PLAYER VOLUME CONTROL
//   -  /  +  (the "=" key, or the number pad) turn the MASTER volume down / up in 10%
//     steps; a bar on screen shows the level. M still toggles the music alone.
//   - Settings (main menu + pause) exposes three sliders — Master, Music and Sound
//     Effects (footsteps / keys / doors) — via setChannelVolume() below.
// Every choice is remembered (localStorage) for next time. 100% is the loudness the
// game was tuned at, so the controls only turn things down.
// ============================================================

const KEY = 'heistVolume';          // master (legacy key, kept so old saves still load)
const KEY_MUSIC = 'heistVolumeMusic';
const KEY_SFX = 'heistVolumeSfx';
const STEP = 0.1;

function load(k, fallback) {
  try {
    const saved = parseFloat(localStorage.getItem(k));
    if (Number.isFinite(saved)) return Math.max(0, Math.min(1, saved));
  } catch (e) { /* storage can be blocked; just use the default */ }
  return fallback;
}

let vol = load(KEY, 1);
let musicVol = load(KEY_MUSIC, 1);
let sfxVol = load(KEY_SFX, 1);
apply();

function apply() {
  setMasterVolume(vol);        // everything
  setMusicVolume(musicVol);    // procedural score
  setSfxVolume(sfxVol);        // footsteps / keys / doors / stings
  setEarpieceVolume(vol);      // recorded voice lines follow master
}

// 'master' | 'music' | 'sfx' -> 0..1. Used by the Settings sliders.
export function setChannelVolume(channel, v) {
  const clamped = Math.max(0, Math.min(1, v));
  if (channel === 'music') { musicVol = clamped; try { localStorage.setItem(KEY_MUSIC, String(musicVol)); } catch (e) {} }
  else if (channel === 'sfx') { sfxVol = clamped; try { localStorage.setItem(KEY_SFX, String(sfxVol)); } catch (e) {} }
  else { vol = clamped; try { localStorage.setItem(KEY, String(vol)); } catch (e) {} }
  apply();
}
export function getChannelVolume(channel) {
  if (channel === 'music') return musicVol;
  if (channel === 'sfx') return sfxVol;
  return vol;
}

let toastEl = null, toastTimer = null;
function toast() {
  if (typeof document === 'undefined') return;
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.style.cssText = 'position:fixed;left:50%;top:54px;transform:translateX(-50%);z-index:50;padding:6px 14px;' +
      'background:rgba(0,0,0,0.7);color:#eee;font:13px monospace;border-radius:6px;pointer-events:none;display:none;white-space:pre;';
    document.body.appendChild(toastEl);
  }
  const filled = Math.round(vol * 10);
  toastEl.textContent = 'Volume  ' + '█'.repeat(filled) + '░'.repeat(10 - filled) + '  ' + Math.round(vol * 100) + '%' + (vol === 0 ? '  (muted)' : '');
  toastEl.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.style.display = 'none'; }, 1500);
}

export function changeVolume(delta) {
  vol = Math.max(0, Math.min(1, Math.round((vol + delta) * 10) / 10));
  apply();
  try { localStorage.setItem(KEY, String(vol)); } catch (e) { /* ignore */ }
  toast();
  return vol;
}
export function getVolume() { return vol; }
export { getMasterVolume, getSfxVolume, getMusicVolume };

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;           // leave browser zoom (Cmd +/-) alone
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') changeVolume(-STEP);
    else if (e.code === 'Equal' || e.code === 'NumpadAdd') changeVolume(STEP);
  });
}
