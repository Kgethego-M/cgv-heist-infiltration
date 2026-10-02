import { setMasterVolume, getMasterVolume } from './sfx.js';
import { setEarpieceVolume } from './earpiece.js';

// ============================================================
// PLAYER VOLUME CONTROL
//   -  /  +  (the "=" key, or the number pad) turn ALL game audio down / up in 10% steps:
//   music, sound effects and the earpiece voice lines. A bar on screen shows the level,
//   and the choice is remembered (localStorage) for next time. M still toggles the music alone.
// 100% is the loudness the game was tuned at, so the control only turns things down.
// ============================================================

const KEY = 'heistVolume';
const STEP = 0.1;

let vol = 1;
try {
  const saved = parseFloat(localStorage.getItem(KEY));
  if (Number.isFinite(saved)) vol = Math.max(0, Math.min(1, saved));
} catch (e) { /* storage can be blocked; just use the default */ }
apply();

function apply() {
  setMasterVolume(vol);        // synthesised SFX + music
  setEarpieceVolume(vol);      // recorded voice lines
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

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;           // leave browser zoom (Cmd +/-) alone
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') changeVolume(-STEP);
    else if (e.code === 'Equal' || e.code === 'NumpadAdd') changeVolume(STEP);
  });
}
