// Run stats (DEBRIEF) on the end-of-mission screens. Read-only: it watches the game's existing `game` object
// each frame (see main.js) and adds a small block to #endScreen when it appears. No gameplay code is touched.
const run = { seconds: 0, alarms: 0, takedowns: 0, caught: 0 };
let lastT = null;
let lastAlarms = 0;
let lastDown = false;
let lastLevel = 0;
let finished = false;       // the last run ended with MISSION COMPLETE
let wrapped = false;
let block = null;
let observer = null;

const CSS = `
#runStats{margin-top:22px;padding:14px 24px;border:1px solid rgba(207,227,255,.22);border-radius:6px;
  background:rgba(8,14,22,.55);min-width:min(520px,86vw)}
#runStats .rs-head{font-size:12px;letter-spacing:.3em;color:#7fa6c8;margin-bottom:10px}
#runStats .rs-grid{display:flex;gap:28px;justify-content:center;flex-wrap:wrap}
#runStats .rs-cell{display:flex;flex-direction:column;align-items:center;min-width:84px}
#runStats .rs-cell b{font:600 26px Georgia,'Times New Roman',serif;color:#eef6ff}
#runStats .rs-cell span{font-size:11px;letter-spacing:.2em;color:#8fa3bb;text-transform:uppercase;margin-top:4px}
`;

function reset() {
  run.seconds = 0; run.alarms = 0; run.takedowns = 0; run.caught = 0;
  lastAlarms = 0; lastDown = false; finished = false;
}

const fmt = (s) => {
  const t = Math.round(s);                 // nearest second (rounding down would show 0:39 for 39.999...)
  return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
};

function endScreenShowing() {
  const e = document.getElementById('endScreen');
  return !!e && e.style.display === 'flex';
}

function removeBlock() { if (block) { block.remove(); block = null; } }

function render() {
  const msg = document.getElementById('endMessage');
  const end = document.getElementById('endScreen');
  if (!msg || !end) return;
  removeBlock();
  const title = (document.getElementById('endTitle') || {}).textContent || '';
  const finalWin = title === 'MISSION COMPLETE';
  const cell = (value, label) => '<div class="rs-cell"><b>' + value + '</b><span>' + label + '</span></div>';
  block = document.createElement('div');
  block.id = 'runStats';
  block.innerHTML =
    '<div class="rs-head">' + (finalWin ? 'DEBRIEF' : 'RUN SO FAR') + '</div>' +
    '<div class="rs-grid">' +
      cell(fmt(run.seconds), 'Time') +
      cell(run.alarms, run.alarms === 1 ? 'Alarm' : 'Alarms') +
      cell(run.takedowns, run.takedowns === 1 ? 'Takedown' : 'Takedowns') +
      cell(run.caught, 'Times caught') +
    '</div>';
  msg.after(block);
  if (finalWin) finished = true;         // the next time Level 1 is played, a fresh run starts
}

function ensureObserver() {
  if (observer) return;
  const end = document.getElementById('endScreen');
  if (!end) return;
  const style = document.createElement('style');
  style.id = 'runStatsStyle';
  style.textContent = CSS;
  document.head.appendChild(style);
  observer = new MutationObserver(() => { if (endScreenShowing()) render(); else removeBlock(); });
  observer.observe(end, { attributes: true, attributeFilter: ['style', 'class'] });
}

/** Call once per frame. info = { live: gameplay is running (not paused / in a menu), level: current level number } */
export function updateRunStats(game, info) {
  ensureObserver();
  // Count "times caught": wrap game.onCaught once. Ignore calls while the end screen is already up (several guards
  // can catch you in the same frame) or after the level was won.
  if (!wrapped && typeof game.onCaught === 'function') {
    wrapped = true;
    const orig = game.onCaught;
    game.onCaught = function (...args) {
      if (!this.levelComplete && !endScreenShowing()) run.caught++;
      return orig.apply(this, args);
    };
  }

  const now = performance.now();
  const dt = lastT === null ? 0 : (now - lastT) / 1000;
  lastT = now;

  // A new run starts when Level 1 is played again after a finished run, or after coming back from a later level.
  if (info.live && info.level === 1 && (finished || lastLevel > 1)) reset();
  if (info.live) {
    lastLevel = info.level;
    if (dt < 0.5) run.seconds += dt;     // a long gap (tab in the background) is not playing time
  }

  // game.alarmsRaised is zeroed on every retry, so add up its increases instead of reading it directly.
  const a = game.alarmsRaised || 0;
  if (a > lastAlarms) run.alarms += a - lastAlarms;
  lastAlarms = a;

  const down = !!game.guardADown;
  if (down && !lastDown) run.takedowns++;
  lastDown = down;
}
