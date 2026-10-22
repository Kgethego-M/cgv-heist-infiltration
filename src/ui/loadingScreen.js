// Loading screen. Imported FIRST in main.js (right after three) so it sees every asset the game loads.
// Shows real progress (loaded / total assets seen by three.js's default loading manager) and fades away once the
// game starts drawing frames. main.js only starts its render loop after every model is loaded and the menu is built,
// so the first frames mean "ready". (The New Game button exists from the start, so it is not a usable signal.)
// A 30 s safety net removes the screen even if something never finishes.
import * as THREE from 'three';

const CSS = `
#loadingScreen{position:fixed;inset:0;z-index:100000;display:flex;flex-direction:column;align-items:center;justify-content:center;
  background:radial-gradient(ellipse at center,#0d1a24 0%,#04070b 72%);color:#e8e2d0;
  font-family:Georgia,'Times New Roman',serif;transition:opacity .45s ease}
#loadingScreen.done{opacity:0;pointer-events:none}
#loadingScreen .ls-kicker{letter-spacing:.35em;font-size:12px;opacity:.7;text-transform:uppercase}
#loadingScreen .ls-title{font-size:44px;font-weight:bold;letter-spacing:.08em;margin:6px 0 2px}
#loadingScreen .ls-sub{letter-spacing:.55em;font-size:15px;opacity:.85;margin-bottom:36px}
#loadingScreen .ls-bar{width:min(360px,70vw);height:4px;background:rgba(232,226,208,.15);border-radius:2px;overflow:hidden}
#loadingScreen .ls-fill{height:100%;width:0%;background:#e8e2d0;transition:width .25s ease}
#loadingScreen .ls-fill.indet{width:35%;animation:ls-slide 1.1s ease-in-out infinite}
@keyframes ls-slide{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}
#loadingScreen .ls-text{margin-top:14px;font:12px monospace;letter-spacing:.2em;opacity:.7}
`;

let total = 0;
let loaded = 0;
let shown = 0;
let finished = false;

// Count assets without touching the loaders: wrap the default manager's itemStart / itemEnd.
const mgr = THREE.DefaultLoadingManager;
const origStart = mgr.itemStart;
const origEnd = mgr.itemEnd;
mgr.itemStart = function (url) { total++; return origStart.call(mgr, url); };
mgr.itemEnd = function (url) { loaded++; return origEnd.call(mgr, url); };

// Count frames the page asks for. main.js starts its render loop only when everything is ready.
let frames = 0;
const rafOrig = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = function (cb) { frames++; return rafOrig(cb); };

const style = document.createElement('style');
style.id = 'loadingScreenStyle';
style.textContent = CSS;
document.head.appendChild(style);

const root = document.createElement('div');
root.id = 'loadingScreen';
root.setAttribute('role', 'progressbar');
root.setAttribute('aria-label', 'Loading');
root.innerHTML =
  '<div class="ls-kicker">A stealth operation</div>' +
  '<div class="ls-title">HEIST</div>' +
  '<div class="ls-sub">INFILTRATION</div>' +
  '<div class="ls-bar"><div class="ls-fill indet"></div></div>' +
  '<div class="ls-text">LOADING</div>';
document.body.appendChild(root);
const fill = root.querySelector('.ls-fill');
const text = root.querySelector('.ls-text');

function finish() {
  if (finished) return;
  finished = true;
  clearInterval(timer);
  fill.classList.remove('indet');
  fill.style.width = '100%';
  text.textContent = 'READY';
  root.classList.add('done');
  setTimeout(() => { root.remove(); style.remove(); }, 600);
}

const timer = setInterval(() => {
  if (finished) return;
  const now = performance.now();
  if (total > 0) {
    shown = Math.max(shown, Math.min(loaded / total, 0.95));    // never goes backwards; the last 5% is the final set-up
    fill.classList.remove('indet');
    fill.style.width = Math.round(shown * 100) + '%';
    text.textContent = 'LOADING  ' + Math.round(shown * 100) + '%';
    root.setAttribute('aria-valuenow', String(Math.round(shown * 100)));
  }
  // ready = the render loop is running AND most assets are in (so a stray early frame can't hide it too soon)
  if ((frames >= 3 && (total === 0 || shown >= 0.9) && now > 500) || now > 30000) finish();
}, 100);
