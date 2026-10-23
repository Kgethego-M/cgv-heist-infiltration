// Display settings: Settings -> DISPLAY. Brightness slider, graphics quality (High / Low), scanlines switch.
// Saved in localStorage. main.js calls registerGraphics() once, right after it builds the post-processing chain.
// The controls are injected into the existing Settings panel from here, so index.html does not need to change.
const STORAGE_KEY = 'heist.display.v1';
const SCANLINE_STRENGTH = 0.04;          // the strength the effect was designed with (0 = off, 0.1 = strong)
const LOW_PIXEL_RATIO = 0.75;            // Low draws at 75% resolution
const GAMMA_STRENGTH = 1.1;              // how hard the slider lifts the shadows above 100%
const BRIGHTNESS_MIN = 60;
const BRIGHTNESS_MAX = 220;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const b = Number(s.brightness);
    return {
      brightness: Number.isFinite(b) && b > 0 ? clamp(Math.round(b), BRIGHTNESS_MIN, BRIGHTNESS_MAX) : 100,
      quality: s.quality === 'low' ? 'low' : 'high',
      scanlines: s.scanlines === true,
    };
  } catch (e) {
    return { brightness: 100, quality: 'high', scanlines: false };
  }
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* private mode: just don't remember */ }
}

let state = load();
let gfx = null;               // { renderer, composer, cinematicPass, scene }, handed over by main.js
let baseBrightness = 1;       // the grade pass's own brightness boost (read once, so 100% = the original look)
let appliedHigh = true;       // main.js builds the renderer in the High configuration
let ui = null;

/** Push the saved settings onto the renderer / post-processing chain. Safe to call any number of times. */
function apply() {
  if (!gfx) return;
  const { renderer, composer, cinematicPass, scene } = gfx;
  const high = state.quality === 'high';

  // 1. Quality (only when it actually changed: switching shadows makes every material recompile once)
  if (high !== appliedHigh) {
    renderer.shadowMap.enabled = high;
    const ratio = high ? 1 : LOW_PIXEL_RATIO;
    renderer.setPixelRatio(ratio);
    composer.setPixelRatio(ratio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    composer.passes.forEach((p, i) => { if (i > 0) p.enabled = high; });   // keep the RenderPass, switch the grade + output passes
    scene.traverse((o) => {
      if (!o.material) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; });
    });
    appliedHigh = high;
  }

  // 2. Brightness. High: scale the grade pass's own brightness (it works in linear light, so this is a real
  //    exposure change). Low: the grade pass is off, so use a CSS brightness filter on the canvas instead.
  const f = state.brightness / 100;
  if (high) {
    const u = cinematicPass.uniforms;
    if (u.uGamma) {
      // A plain multiply barely changes near-black areas (the Level 3 maze), so the slider mainly bends the SHADOWS with a
      // gamma curve, plus a small exposure change.
      u.uGamma.value = f >= 1 ? 1 + (f - 1) * GAMMA_STRENGTH : 1 - (1 - f) * 0.5;
      u.uBrightness.value = baseBrightness * (f >= 1 ? 1 + (f - 1) * 0.25 : f);
    } else {
      u.uBrightness.value = baseBrightness * f;               // older shader without uGamma: exposure only
    }
    renderer.domElement.style.filter = '';
  } else {
    renderer.domElement.style.filter = f === 1 ? '' : 'brightness(' + Math.pow(f, 0.6).toFixed(3) + ')';
  }

  // 3. Scanlines (part of the grade pass, so High only)
  cinematicPass.uniforms.uScanlines.value = (high && state.scanlines) ? SCANLINE_STRENGTH : 0;
}

function syncUI() {
  if (!ui) return;
  ui.slider.value = String(state.brightness);
  ui.val.textContent = state.brightness + '%';
  ui.qBtns.forEach((b) => b.classList.toggle('active', b.dataset.q === state.quality));
  ui.sBtns.forEach((b) => {
    b.classList.toggle('active', (b.dataset.s === 'on') === state.scanlines);
    b.disabled = state.quality === 'low';
  });
  refreshNote();
}

function refreshNote() {
  if (!ui) return;
  const mm = document.getElementById('mainMenu');
  const onMenu = !!mm && getComputedStyle(mm).display !== 'none';
  if (state.quality === 'low') {
    ui.note.textContent = 'Low: shadows, glow and the film grade are off, drawn at 75% resolution. Faster on older laptops.';
  } else if (onMenu) {
    ui.note.textContent = 'Brightness changes the game view, not this menu picture. To see it, pause during a mission (P), open Settings and hold the slider.';
  } else {
    ui.note.textContent = 'Hold the brightness slider and this panel fades, so you can see the game behind it.';
  }
}

function buildUI() {
  const card = document.querySelector('#settingsPanel .settings-card');
  if (!card || document.getElementById('dispSection')) return;
  const style = document.createElement('style');
  style.id = 'dispStyle';
  style.textContent =
    '.settings-card{max-height:92vh;overflow-y:auto}' +
    '.disp-sub{margin-top:20px !important;padding-top:14px;border-top:1px solid rgba(232,226,208,0.15);margin-bottom:6px !important}' +
    '.disp-btns button.active{background:rgba(232,226,208,0.30);color:#fff;border-color:rgba(232,226,208,0.75)}' +
    '.disp-btns button:disabled{opacity:.4;cursor:not-allowed}' +
    '.disp-note{font-size:12px;color:#9a937f;text-align:center;min-height:16px;margin-top:4px}' +
    '#settingsPanel{transition:background .15s}' +
    '#settingsPanel.disp-previewing{background:rgba(4,6,9,0) !important}' +
    '#settingsPanel.disp-previewing .settings-card{background:transparent !important;border-color:transparent !important;box-shadow:none !important}' +
    '#settingsPanel.disp-previewing .settings-card > *:not(#dispSection){visibility:hidden}' +
    '#settingsPanel.disp-previewing #dispSection{text-shadow:0 1px 8px #000,0 0 3px #000}';
  document.head.appendChild(style);

  const sec = document.createElement('div');
  sec.id = 'dispSection';
  sec.innerHTML =
    '<div class="sub disp-sub">DISPLAY</div>' +
    '<div class="vol-row"><label for="dispBrightness">Brightness</label>' +
    '<input type="range" id="dispBrightness" min="' + BRIGHTNESS_MIN + '" max="' + BRIGHTNESS_MAX + '" step="5" />' +
    '<span class="val" id="dispBrightnessVal"></span></div>' +
    '<div class="vol-row"><label>Graphics</label><div class="sfx-btns disp-btns">' +
    '<button type="button" data-q="high">High</button><button type="button" data-q="low">Low</button></div></div>' +
    '<div class="vol-row"><label>Scanlines</label><div class="sfx-btns disp-btns">' +
    '<button type="button" data-s="off">Off</button><button type="button" data-s="on">On</button></div></div>' +
    '<div class="disp-note" id="dispNote"></div>';
  const back = document.getElementById('settingsBack');
  if (back) card.insertBefore(sec, back); else card.appendChild(sec);

  ui = {
    slider: sec.querySelector('#dispBrightness'),
    val: sec.querySelector('#dispBrightnessVal'),
    qBtns: [...sec.querySelectorAll('[data-q]')],
    sBtns: [...sec.querySelectorAll('[data-s]')],
    note: sec.querySelector('#dispNote'),
  };
  ui.slider.addEventListener('input', () => {
    state.brightness = clamp(Number(ui.slider.value) || 100, BRIGHTNESS_MIN, BRIGHTNESS_MAX);
    ui.val.textContent = state.brightness + '%';
    apply(); save();
  });
  const panel = document.getElementById('settingsPanel');
  const startPreview = () => { if (panel) panel.classList.add('disp-previewing'); };
  const endPreview = () => { if (panel) panel.classList.remove('disp-previewing'); };
  ui.slider.addEventListener('pointerdown', startPreview);
  ui.slider.addEventListener('blur', endPreview);
  window.addEventListener('pointerup', endPreview);
  window.addEventListener('pointercancel', endPreview);
  if (panel) new MutationObserver(refreshNote).observe(panel, { attributes: true, attributeFilter: ['style'] });
  ui.qBtns.forEach((b) => b.addEventListener('click', () => { state.quality = b.dataset.q; apply(); save(); syncUI(); }));
  ui.sBtns.forEach((b) => b.addEventListener('click', () => { state.scanlines = b.dataset.s === 'on'; apply(); save(); syncUI(); }));
  syncUI();
}

buildUI();

/** Called once by main.js right after it builds the renderer and the post-processing chain. */
export function registerGraphics(g) {
  gfx = g;
  baseBrightness = g.cinematicPass.uniforms.uBrightness.value;
  appliedHigh = true;
  apply();
  syncUI();
}

export function getDisplaySettings() { return { ...state }; }
