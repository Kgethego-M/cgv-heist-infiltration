// ============================================================
// PUZZLES — small DOM overlays used by Level 3's locks and clue terminals.
// Each puzzle is parameterised so the same code gives an easy lock and a
// much harder clue version (longer sequence, more wires, longer code).
//
// onUiChange(open, relock) is the same handoff main.js already uses for
// Level 2's puzzles (it frees the mouse while a puzzle is open and pauses
// the world). Esc closes any puzzle without solving it.
// ============================================================

const COLORS = [
  { name: 'red', hex: '#ff4d4d' },
  { name: 'blue', hex: '#4da3ff' },
  { name: 'green', hex: '#4dff88' },
  { name: 'yellow', hex: '#ffd84d' },
  { name: 'purple', hex: '#c58bff' },
  { name: 'orange', hex: '#ff9a3d' },
  { name: 'cyan', hex: '#4dfff0' },
  { name: 'pink', hex: '#ff8bd0' },
];

const CSS = `
#pz-overlay{position:fixed;inset:0;z-index:60;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.72)}
#pz-panel{min-width:320px;max-width:460px;padding:22px 26px;background:#10151a;border:1px solid #3a5a70;border-radius:10px;
  font:14px/1.5 monospace;color:#cfe8f5;box-shadow:0 0 40px rgba(60,140,200,.25);text-align:center;user-select:none}
#pz-panel h3{margin:0 0 4px;font-size:15px;letter-spacing:.14em;color:#7fd0ff}
#pz-panel .sub{margin:0 0 14px;font-size:12px;opacity:.75}
#pz-panel .status{min-height:20px;margin:10px 0 4px;font-size:13px;color:#ffd27a}
#pz-panel .status.ok{color:#6dff9a}#pz-panel .status.bad{color:#ff7a7a}
#pz-panel button{font:inherit;cursor:pointer;color:#cfe8f5;background:#16303f;border:1px solid #3a6a88;border-radius:6px;padding:8px 12px}
#pz-panel button:hover{background:#1d4a61}
#pz-panel .pz-x{margin-top:10px;background:transparent;border-color:#445;opacity:.7}
.pz-screen{height:38px;line-height:38px;margin:0 auto 10px;width:230px;background:#050a0e;border:1px solid #2c4a5e;
  letter-spacing:.5em;font-size:20px;color:#7fffb0}
.pz-pad-grid{display:grid;grid-template-columns:repeat(3,64px);gap:8px;justify-content:center}
.pz-cols{display:flex;justify-content:center;gap:70px}
.pz-col{display:flex;flex-direction:column;gap:8px}
.pz-wire{width:90px;height:34px;border-radius:6px;border:2px solid #0008 !important;color:#000 !important;font-weight:bold}
.pz-wire.sel{outline:3px solid #fff}.pz-wire.done{opacity:.35;cursor:default}
.pz-simon{display:grid;grid-template-columns:repeat(2,110px);gap:12px;justify-content:center;margin:8px 0}
.pz-simon button.pz-pad{height:86px;border-radius:12px;opacity:.5;border:2px solid #0008}
.pz-simon button.pz-pad.lit{opacity:1;filter:brightness(1.6);box-shadow:0 0 22px currentColor}
.pz-shake{animation:pzshake .35s}
@keyframes pzshake{25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}
`;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function createPuzzleUI(onUiChange = () => {}) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const overlay = el('div'); overlay.id = 'pz-overlay';
  const panel = el('div'); panel.id = 'pz-panel';
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  let open = false, keyHandler = null, timers = [];
  const later = (fn, ms) => { timers.push(setTimeout(fn, ms)); };

  function show(title, sub, build) {
    panel.innerHTML = '';
    panel.appendChild(el('h3', '', title));
    panel.appendChild(el('p', 'sub', sub));
    build(panel);
    const x = el('button', 'pz-x', 'Close  [Esc]');
    x.addEventListener('click', () => close(true));
    panel.appendChild(x);
    overlay.style.display = 'flex';
    open = true;
    onUiChange(true, false);
  }

  function close(relock = true) {
    if (!open) return;
    overlay.style.display = 'none';
    panel.innerHTML = '';
    if (keyHandler) window.removeEventListener('keydown', keyHandler, true);
    keyHandler = null;
    timers.forEach(clearTimeout); timers = [];
    open = false;
    onUiChange(false, relock);
  }

  function listenKeys(fn) {
    keyHandler = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); return; }
      if (fn) fn(e);
    };
    window.addEventListener('keydown', keyHandler, true);
  }

  function finish(status, onSolve) {
    status.textContent = '✔ ACCESS GRANTED';
    status.className = 'status ok';
    later(() => { close(true); onSolve(); }, 700);
  }

  // ---------- keypad ----------
  // opts: { title, sub, code: '4729', onSolve }
  function keypad({ title = 'KEYPAD', sub, code, onSolve }) {
    const n = code.length;
    let entered = '';
    let status, screen;
    const update = () => { screen.textContent = entered.padEnd(n, '•').split('').join(' '); };
    const press = (d) => { if (entered.length < n) { entered += d; update(); } };
    const clear = () => { entered = ''; update(); };
    const submit = () => {
      if (entered === code) { finish(status, onSolve); return; }
      status.textContent = '✖ ACCESS DENIED';
      status.className = 'status bad';
      panel.classList.remove('pz-shake'); void panel.offsetWidth; panel.classList.add('pz-shake');
      clear();
    };
    show(title, sub || `Enter the ${n}-digit code.`, (p) => {
      screen = el('div', 'pz-screen'); p.appendChild(screen);
      const grid = el('div', 'pz-pad-grid');
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK'].forEach((k) => {
        const b = el('button', 'pz-key', k);
        b.dataset.key = k;
        b.addEventListener('click', () => (k === 'C' ? clear() : k === 'OK' ? submit() : press(k)));
        grid.appendChild(b);
      });
      p.appendChild(grid);
      status = el('div', 'status'); p.appendChild(status);
      update();
    });
    listenKeys((e) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') { entered = entered.slice(0, -1); update(); }
      else if (e.key === 'Enter') submit();
    });
  }

  // ---------- wires ----------
  // opts: { title, count, onSolve } — match each coloured wire on the left to its twin on the right
  function wires({ title = 'WIRING', sub, count = 4, onSolve }) {
    const picks = COLORS.slice(0, count);
    let right;
    do { right = shuffle([...picks]); } while (right.every((c, i) => c === picks[i]));
    let sel = null, matched = 0, status;
    show(title, sub || 'Click a wire on the left, then its twin on the right.', (p) => {
      const cols = el('div', 'pz-cols');
      const L = el('div', 'pz-col'), R = el('div', 'pz-col');
      const mk = (c, side) => {
        const b = el('button', `pz-wire pz-${side}`, '');
        b.style.background = c.hex;
        b.dataset.color = c.name;
        return b;
      };
      picks.forEach((c) => {
        const b = mk(c, 'left');
        b.addEventListener('click', () => {
          if (b.classList.contains('done')) return;
          panel.querySelectorAll('.pz-left.sel').forEach((n) => n.classList.remove('sel'));
          sel = b; b.classList.add('sel');
        });
        L.appendChild(b);
      });
      right.forEach((c) => {
        const b = mk(c, 'right');
        b.addEventListener('click', () => {
          if (!sel || b.classList.contains('done')) return;
          if (sel.dataset.color === b.dataset.color) {
            sel.classList.remove('sel'); sel.classList.add('done'); b.classList.add('done');
            sel = null; matched++;
            status.textContent = `${matched}/${count} connected`;
            status.className = 'status';
            if (matched === count) finish(status, onSolve);
          } else {
            status.textContent = '✖ WRONG PAIR';
            status.className = 'status bad';
            sel.classList.remove('sel'); sel = null;
          }
        });
        R.appendChild(b);
      });
      cols.append(L, R); p.appendChild(cols);
      status = el('div', 'status', `0/${count} connected`); p.appendChild(status);
    });
    listenKeys();
  }

  // ---------- memory sequence ----------
  // opts: { title, length, onSolve } — watch the pads light up, then repeat the order
  function simon({ title = 'SEQUENCE LOCK', sub, length = 4, onSolve }) {
    const pads = COLORS.slice(0, 4);
    const sequence = Array.from({ length }, () => Math.floor(Math.random() * 4));
    let input = [], accepting = false, status;
    const padEls = [];
    const flash = (i, ms) => {
      padEls[i].classList.add('lit');
      later(() => padEls[i].classList.remove('lit'), ms);
    };
    const playback = () => {
      accepting = false; input = [];
      status.textContent = 'WATCH…'; status.className = 'status';
      sequence.forEach((v, k) => later(() => flash(v, 520), 700 + k * 800));
      later(() => { accepting = true; status.textContent = 'YOUR TURN'; }, 700 + sequence.length * 800);
    };
    show(title, sub || `Repeat the ${length}-step sequence.`, (p) => {
      const grid = el('div', 'pz-simon');
      pads.forEach((c, i) => {
        const b = el('button', 'pz-pad', '');
        b.style.background = c.hex; b.style.color = c.hex;
        b.dataset.i = String(i);
        b.addEventListener('click', () => {
          if (!accepting) return;
          flash(i, 200);
          if (sequence[input.length] !== i) {
            status.textContent = '✖ WRONG — WATCH AGAIN'; status.className = 'status bad';
            accepting = false;
            later(playback, 900);
            return;
          }
          input.push(i);
          if (input.length === sequence.length) { accepting = false; finish(status, onSolve); }
        });
        padEls.push(b); grid.appendChild(b);
      });
      p.appendChild(grid);
      status = el('div', 'status'); p.appendChild(status);
      const again = el('button', '', '↻ Replay');
      again.addEventListener('click', () => { if (accepting) playback(); });
      p.appendChild(again);
    });
    listenKeys();
    playback();
    return { sequence };
  }

  return {
    isOpen: () => open,
    close,
    keypad, wires, simon,
    dispose() { close(false); style.remove(); overlay.remove(); },
  };
}
