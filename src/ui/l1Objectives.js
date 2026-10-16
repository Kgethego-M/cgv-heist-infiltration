// Level 1 OBJECTIVES panel. Same look as the Level 2 / Level 3 panels.
// Read-only: it just reads Level 1's `game` state each frame (see main.js), so it needs no hooks into gameplay
// and picks up retries and resets by itself.
const CSS = `
#l1-tracker{position:fixed;top:62px;left:14px;z-index:20;min-width:230px;max-width:290px;padding:10px 14px;
  background:rgba(6,14,22,.72);border:1px solid rgba(120,200,255,.35);border-radius:6px;
  font:13px/1.45 monospace;color:#cfe8ff;pointer-events:none;display:none}
#l1-tracker h4{margin:0 0 6px;font-size:11px;letter-spacing:.15em;color:#7fc8ff}
#l1-tracker .it{display:flex;gap:8px}
#l1-tracker .it.done{color:#6dff9a;text-decoration:line-through;opacity:.8}
#l1-tracker .it.alert{color:#ff6b6b;font-weight:bold}
`;

let panel = null;
let lastKey = '';

function ensurePanel() {
  if (panel) return panel;
  const style = document.createElement('style');
  style.id = 'l1-tracker-style';
  style.textContent = CSS;
  document.head.appendChild(style);
  panel = document.createElement('div');
  panel.id = 'l1-tracker';
  document.body.appendChild(panel);
  return panel;
}

function itemsFor(g) {
  const alarm = g.alarmActive && !g.levelComplete;
  const secs = alarm && g.escapeTimeRemaining != null ? ` - ${Math.max(0, Math.ceil(g.escapeTimeRemaining))}s` : '';
  return [
    { text: 'Take down the guard at reception', done: !!g.guardADown },
    { text: 'Search his body for the office key', done: !!g.hasKey },
    { text: "Unlock the manager's office", done: !!g.doorUnlocked },
    { text: 'Take the access card', done: !!g.hasKeycard },
    { text: 'Escape to the elevator' + secs, done: !!g.levelComplete, alert: alarm },
  ];
}

/** Call once per frame. `visible` = Level 1 is the active level AND gameplay is live. */
export function updateLevel1Objectives(game, visible) {
  const el = ensurePanel();
  el.style.display = visible ? 'block' : 'none';
  if (!visible) return;
  const items = itemsFor(game);
  const key = JSON.stringify(items);
  if (key === lastKey) return;            // only touch the DOM when something changed (the countdown ticks once a second)
  lastKey = key;
  el.innerHTML = '';
  const h = document.createElement('h4');
  h.textContent = 'OBJECTIVES';
  el.appendChild(h);
  items.forEach((it) => {
    const row = document.createElement('div');
    row.className = 'it' + (it.done ? ' done' : '') + (it.alert ? ' alert' : '');
    const mark = document.createElement('span');
    mark.textContent = it.done ? '\u2714' : '\u25AB';
    const label = document.createElement('span');
    label.textContent = it.text;
    row.append(mark, label);
    el.appendChild(row);
  });
}
