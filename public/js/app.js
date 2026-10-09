import * as S from './sudoku.js';

// ---------------------------------------------------------------------------
// Storage

const KEYS = { game: 'sudoku.game.v1', settings: 'sudoku.settings.v1', history: 'sudoku.history.v1' };

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage can be unavailable (private mode, quota); the game still works.
    }
  },
};

const DEFAULT_SETTINGS = { feedback: 'conflicts', highlightSame: true, autoNotes: true, showTimer: true, theme: 'auto' };
const settings = { ...DEFAULT_SETTINGS, ...store.get(KEYS.settings, {}) };

// ---------------------------------------------------------------------------
// State

let game = null;
let selected = null;
let notesMode = false;
let undoStack = [];
let redoStack = [];
let hint = null;
let revealErrors = false;
let paused = false;
let autoPaused = false;
let lastTick = 0;
let justPlaced = null;

const $ = (id) => document.getElementById(id);
const boardEl = $('board');
const numpadEl = $('numpad');
const cells = [];
const numButtons = [];

const formatTime = (ms) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

const difficultyLabel = (key) => S.DIFFICULTIES[key]?.label ?? 'Fiendish';

// ---------------------------------------------------------------------------
// Game lifecycle

function startGame({ puzzle, solution, difficulty, seed = null, source = 'generated' }) {
  recordAbandoned();
  game = {
    id: Date.now().toString(36),
    puzzle,
    solution,
    values: puzzle.slice(),
    notes: new Array(81).fill(0),
    difficulty,
    seed,
    source,
    elapsed: 0,
    hints: 0,
    mistakes: 0,
    status: 'playing',
    startedAt: new Date().toISOString(),
  };
  selected = null;
  undoStack = [];
  redoStack = [];
  hint = null;
  revealErrors = false;
  notesMode = false;
  boardEl.classList.remove('solved');
  setPaused(false);
  history.replaceState(null, '', location.pathname + location.search);
  save();
  render();
}

function newGame(difficulty) {
  const p = S.generate(difficulty);
  startGame({ puzzle: p.puzzle, solution: p.solution, difficulty: p.difficulty, seed: p.seed });
  if (p.difficulty !== difficulty) toast(`Couldn't find a ${difficultyLabel(difficulty)} puzzle in time — here's a ${difficultyLabel(p.difficulty)} one.`);
}

/** Returns an error message, or null if the puzzle was started. */
function playPuzzleString(text, source = 'imported') {
  const puzzle = S.parsePuzzle(text);
  if (!puzzle) return 'That needs exactly 81 cells: digits for givens, 0 or . for blanks.';
  const { count, solution } = S.solve(puzzle, { limit: 2 });
  if (count === 0) return 'That puzzle has no solution.';
  if (count > 1) return 'That puzzle has more than one solution, so it can’t be solved by logic alone.';
  const { difficulty } = S.grade(puzzle);
  startGame({ puzzle, solution, difficulty, source });
  return null;
}

function hasProgress() {
  return game && game.status === 'playing' && game.values.some((v, i) => v !== game.puzzle[i]);
}

function recordAbandoned() {
  if (hasProgress()) addHistory('abandoned');
}

function addHistory(outcome) {
  const list = store.get(KEYS.history, []);
  list.unshift({
    id: game.id,
    date: new Date().toISOString(),
    difficulty: game.difficulty,
    puzzle: S.formatPuzzle(game.puzzle),
    time: game.elapsed,
    hints: game.hints,
    mistakes: game.mistakes,
    outcome,
  });
  store.set(KEYS.history, list.slice(0, 300));
}

function save() {
  if (game) store.set(KEYS.game, game);
}

function load() {
  const saved = store.get(KEYS.game, null);
  if (!saved || !Array.isArray(saved.values) || saved.values.length !== 81) return false;
  game = saved;
  return true;
}

// ---------------------------------------------------------------------------
// Moves

const snapshot = () => ({ values: game.values.slice(), notes: game.notes.slice(), selected });

function commit() {
  undoStack.push(snapshot());
  if (undoStack.length > 300) undoStack.shift();
  redoStack = [];
}

function restore(snap) {
  game.values = snap.values;
  game.notes = snap.notes;
  selected = snap.selected;
}

function undo() {
  if (!canPlay() || !undoStack.length) return;
  redoStack.push(snapshot());
  restore(undoStack.pop());
  afterChange();
}

function redo() {
  if (!canPlay() || !redoStack.length) return;
  undoStack.push(snapshot());
  restore(redoStack.pop());
  afterChange();
}

const canPlay = () => game && game.status === 'playing' && !paused;
const isGiven = (i) => game.puzzle[i] !== 0;

function input(d, asNote = notesMode) {
  if (!canPlay()) return;
  if (selected === null) {
    toast('Pick a cell first.');
    return;
  }
  if (isGiven(selected)) return;
  if (asNote) toggleNote(selected, d);
  else placeDigit(selected, d);
}

function placeDigit(i, d) {
  commit();
  if (game.values[i] === d) {
    // Tapping the same digit again takes it back out.
    game.values[i] = 0;
  } else {
    game.values[i] = d;
    game.notes[i] = 0;
    if (d !== game.solution[i]) game.mistakes++;
    if (settings.autoNotes) for (const j of S.PEERS[i]) game.notes[j] &= ~S.bit(d);
    justPlaced = i;
  }
  afterChange();
  checkComplete();
}

function toggleNote(i, d) {
  if (game.values[i]) {
    toast('Erase the digit first to add notes here.');
    return;
  }
  commit();
  game.notes[i] ^= S.bit(d);
  afterChange();
}

function erase() {
  if (!canPlay() || selected === null || isGiven(selected)) return;
  if (!game.values[selected] && !game.notes[selected]) return;
  commit();
  if (game.values[selected]) game.values[selected] = 0;
  else game.notes[selected] = 0;
  afterChange();
}

function afterChange() {
  hint = null;
  revealErrors = false;
  save();
  render();
}

function checkComplete() {
  if (!game.values.every(Boolean)) return;
  const wrong = wrongCells();
  if (wrong.length === 0) {
    game.status = 'solved';
    selected = null;
    tickTimer();
    addHistory('solved');
    save();
    render();
    boardEl.classList.add('solved');
    setTimeout(showSolved, 700);
  } else {
    showNotQuite(wrong.length);
  }
}

const wrongCells = () => game.values.flatMap((v, i) => (v && v !== game.solution[i] ? [i] : []));

// ---------------------------------------------------------------------------
// Hints: nudge first, then explain, then fill in.

function requestHint() {
  if (!canPlay()) return;

  if (hint && hint.stage < hint.stages) {
    hint.stage++;
    if (hint.stage === hint.stages && hint.place) {
      const { cell, digit } = hint.place;
      selected = cell;
      commit();
      game.values[cell] = digit;
      game.notes[cell] = 0;
      if (settings.autoNotes) for (const j of S.PEERS[cell]) game.notes[j] &= ~S.bit(digit);
      justPlaced = cell;
      hint = null;
      save();
      render();
      checkComplete();
      return;
    }
    render();
    return;
  }

  game.hints++;
  const wrong = wrongCells();
  if (wrong.length) {
    hint = {
      stage: 1, stages: 1, area: wrong, targets: wrong,
      title: 'Check your work',
      text: [`${wrong.length === 1 ? 'One digit doesn’t' : `${wrong.length} digits don’t`} match the solution. ${wrong.length === 1 ? 'It’s' : 'They’re'} highlighted.`],
    };
    save();
    render();
    return;
  }

  const grid = game.values.slice();
  const cand = S.candidatesFor(grid);
  const chain = [];
  let step;
  while ((step = S.findStep(grid, cand)) && !step.place) {
    chain.push(step);
    S.applyStep(grid, cand, step);
  }

  if (!step) {
    // Only reachable for imported puzzles beyond the built-in techniques.
    const cell = selected !== null && !game.values[selected] ? selected : game.values.indexOf(0);
    hint = {
      stage: 1, stages: 2, area: [cell], target: cell, place: { cell, digit: game.solution[cell] },
      title: 'No simple step here',
      text: [`This position needs techniques beyond the built-in ones. Ask again to reveal ${S.cellName(cell)}.`, ''],
    };
  } else {
    const first = chain[0] || step;
    const area = first.unit !== null && first.unit !== undefined ? S.UNITS[first.unit] : first.cells;
    hint = {
      stage: 1, stages: 3, area, target: step.place.cell, place: step.place,
      title: chain.length ? first.technique : step.technique,
      text: [nudge(first, chain.length > 0), [...chain, step].map((s) => s.text).join(' Then: '), ''],
    };
  }
  save();
  render();
}

function nudge(step, needsSetup) {
  if (needsSetup) return `A ${step.technique.toLowerCase()} unlocks the next digit. Look at the highlighted cells.`;
  const { cell, digit } = step.place;
  switch (step.technique) {
    case 'Full house': return `${cap(S.unitName(step.unit))} has just one empty cell left.`;
    case 'Hidden single': return `Look at ${S.unitName(step.unit)}: where can ${digit} go?`;
    case 'Naked single': return `One cell in ${S.unitName(18 + S.boxOf(cell))} has only one digit that fits.`;
    default: return 'Look at the highlighted cells.';
  }
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);

// ---------------------------------------------------------------------------
// Rendering

function buildBoard() {
  for (let i = 0; i < 81; i++) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `cell r${S.rowOf(i)} c${S.colOf(i)}`;
    el.style.setProperty('--d', S.rowOf(i) + S.colOf(i));
    el.setAttribute('role', 'gridcell');
    el.tabIndex = -1;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      select(i);
    });
    boardEl.append(el);
    cells.push(el);
  }
  for (let d = 1; d <= 9; d++) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'num';
    el.innerHTML = `${d}<small></small>`;
    el.addEventListener('click', () => input(d));
    numpadEl.append(el);
    numButtons.push(el);
  }
}

function select(i) {
  if (!game || paused) return;
  selected = i;
  if (hint && hint.stages === 1) hint = null;
  render();
  cells[i].focus({ preventScroll: true });
}

function errorCells() {
  const errors = new Set();
  if (!game) return errors;
  const mode = revealErrors ? 'solution' : settings.feedback;
  for (let i = 0; i < 81; i++) {
    const v = game.values[i];
    if (!v || isGiven(i)) continue;
    if (mode === 'solution' && v !== game.solution[i]) errors.add(i);
    if (mode === 'conflicts' && S.PEERS[i].some((j) => game.values[j] === v)) errors.add(i);
  }
  return errors;
}

function render() {
  if (!game) return;
  const errors = errorCells();
  const selDigit = selected !== null ? game.values[selected] : 0;
  const hintArea = new Set(hint ? hint.area : []);
  const hintTargets = new Set(hint ? (hint.targets || (hint.stage >= 2 ? [hint.target] : [])) : []);

  for (let i = 0; i < 81; i++) {
    const el = cells[i];
    const v = game.values[i];
    const classes = [];
    if (isGiven(i)) classes.push('given');
    if (selected !== null) {
      if (i === selected) classes.push('selected');
      else if (S.rowOf(i) === S.rowOf(selected) || S.colOf(i) === S.colOf(selected) || S.boxOf(i) === S.boxOf(selected)) classes.push('peer');
    }
    if (settings.highlightSame && selDigit && v === selDigit && i !== selected) classes.push('same');
    if (errors.has(i)) classes.push('error');
    if (hintArea.has(i)) classes.push('hint-area');
    if (hintTargets.has(i)) classes.push('hint-cell');
    if (i === justPlaced) classes.push('pop');

    el.className = `cell r${S.rowOf(i)} c${S.colOf(i)} ${classes.join(' ')}`;
    if (v) {
      el.innerHTML = `<span class="value">${v}</span>`;
    } else if (game.notes[i]) {
      let html = '<span class="notes">';
      for (let d = 1; d <= 9; d++) {
        const on = game.notes[i] & S.bit(d);
        html += `<span class="${on && settings.highlightSame && d === selDigit ? 'match' : ''}">${on ? d : ''}</span>`;
      }
      el.innerHTML = html + '</span>';
    } else {
      el.innerHTML = '';
    }
    const noteText = game.notes[i] ? `, notes ${S.digitsOf(game.notes[i]).join(' ')}` : '';
    el.setAttribute('aria-label', `${S.cellName(i)}, ${v ? (isGiven(i) ? `given ${v}` : v) : 'empty'}${noteText}`);
  }
  justPlaced = null;

  const counts = new Array(10).fill(0);
  for (const v of game.values) counts[v]++;
  numButtons.forEach((el, k) => {
    const d = k + 1;
    const left = 9 - counts[d];
    el.classList.toggle('done', left <= 0);
    el.classList.toggle('active', d === selDigit);
    el.querySelector('small').textContent = left > 0 ? left : '';
    el.setAttribute('aria-label', `${d}, ${left} left`);
  });
  numpadEl.classList.toggle('notes-mode', notesMode);

  $('btn-notes').setAttribute('aria-pressed', String(notesMode));
  $('notes-state').textContent = notesMode ? 'on' : 'off';
  $('btn-undo').disabled = !undoStack.length;
  $('difficulty-label').textContent = difficultyLabel(game.difficulty);

  const hintEl = $('hint-text');
  if (hint) {
    hintEl.hidden = false;
    const text = hint.text[Math.min(hint.stage, hint.text.length) - 1];
    const more = hint.stage < hint.stages ? (hint.stage === hint.stages - 1 ? ' Tap Hint again to fill it in.' : ' Tap Hint again for more.') : '';
    hintEl.innerHTML = `<b></b><span></span>`;
    hintEl.querySelector('b').textContent = hint.title;
    hintEl.querySelector('span').textContent = text + more;
  } else {
    hintEl.hidden = true;
  }

  renderTimer();
}

// ---------------------------------------------------------------------------
// Timer and pause

function tickTimer() {
  const now = performance.now();
  if (game && game.status === 'playing' && !paused && lastTick) game.elapsed += now - lastTick;
  lastTick = now;
}

function renderTimer() {
  const timer = $('timer');
  timer.hidden = !settings.showTimer || !game;
  if (!game) return;
  $('timer-text').textContent = formatTime(game.elapsed);
  $('timer-icon').setAttribute('d', paused ? 'M8 5v14l11-7z' : 'M8 5h3v14H8zM13 5h3v14h-3z');
  timer.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
  timer.disabled = game.status !== 'playing';
}

function setPaused(value) {
  tickTimer();
  paused = value;
  $('pause-cover').hidden = !paused;
  boardEl.style.visibility = paused ? 'hidden' : '';
  save();
  renderTimer();
}

setInterval(() => {
  tickTimer();
  renderTimer();
}, 500);

setInterval(save, 5000);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (game && game.status === 'playing' && !paused) {
      autoPaused = true;
      setPaused(true);
    }
  } else if (autoPaused) {
    autoPaused = false;
    setPaused(false);
  }
});

window.addEventListener('pagehide', () => {
  tickTimer();
  save();
});

// ---------------------------------------------------------------------------
// Dialogs

function openNewGame() {
  const list = $('difficulty-list');
  const best = bestTimes();
  list.innerHTML = '';
  for (const [key, d] of Object.entries(S.DIFFICULTIES)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'difficulty';
    b.innerHTML = '<div class="meta"><b></b><span class="best"></span></div><span class="blurb"></span>';
    b.querySelector('b').textContent = d.label;
    b.querySelector('.best').textContent = best[key] ? `Best ${formatTime(best[key])}` : '';
    b.querySelector('.blurb').textContent = d.blurb;
    b.addEventListener('click', () => {
      $('dlg-new').close();
      newGame(key);
    });
    list.append(b);
  }
  $('import-error').hidden = true;
  $('btn-new-cancel').hidden = !game || game.status !== 'playing';
  if (game && game.status === 'playing') setPaused(true);
  $('dlg-new').showModal();
}

$('dlg-new').addEventListener('close', () => {
  if (game && game.status === 'playing' && paused) setPaused(false);
});
$('dlg-new').addEventListener('cancel', (e) => {
  if (!game) e.preventDefault();
});

$('btn-import').addEventListener('click', () => {
  const err = playPuzzleString($('import-text').value);
  if (err) {
    $('import-error').textContent = err;
    $('import-error').hidden = false;
  } else {
    $('import-text').value = '';
    $('dlg-new').close();
    toast(`Puzzle loaded — graded ${difficultyLabel(game.difficulty)}.`);
  }
});

function resultDialog({ title, text, stats = [], actions }) {
  $('result-title').textContent = title;
  $('result-text').textContent = text;
  const dl = $('result-stats');
  dl.innerHTML = '';
  for (const [k, v] of stats) {
    const div = document.createElement('div');
    div.innerHTML = '<dt></dt><dd></dd>';
    div.querySelector('dt').textContent = k;
    div.querySelector('dd').textContent = v;
    dl.append(div);
  }
  const box = $('result-actions');
  box.innerHTML = '';
  for (const { label, primary, run } of actions) {
    const b = document.createElement('button');
    b.className = `btn${primary ? ' btn-primary' : ''}`;
    b.value = label;
    b.textContent = label;
    b.addEventListener('click', () => setTimeout(() => run?.(), 0));
    box.append(b);
  }
  $('dlg-result').showModal();
}

function showSolved() {
  const best = bestTimes()[game.difficulty];
  const isBest = best === game.elapsed && !game.hints;
  resultDialog({
    title: 'Solved!',
    text: isBest ? `A new best time for ${difficultyLabel(game.difficulty)}.` : `Nicely done on ${difficultyLabel(game.difficulty)}.`,
    stats: [['Time', formatTime(game.elapsed)], ['Hints', game.hints], ['Mistakes', game.mistakes]],
    actions: [
      { label: 'Share puzzle', run: sharePuzzle },
      { label: 'Change difficulty', run: openNewGame },
      { label: `New ${difficultyLabel(game.difficulty)} game`, primary: true, run: () => newGame(S.DIFFICULTIES[game.difficulty] ? game.difficulty : 'expert') },
    ],
  });
}

function showNotQuite(n) {
  resultDialog({
    title: 'Not quite',
    text: `The board is full, but ${n === 1 ? 'one digit doesn’t' : `${n} digits don’t`} fit yet.`,
    actions: [
      { label: 'Keep looking' },
      { label: 'Show me', primary: true, run: () => { revealErrors = true; render(); } },
    ],
  });
}

async function sharePuzzle() {
  const url = `${location.origin}${location.pathname}#p=${S.formatPuzzle(game.puzzle)}`;
  try {
    if (navigator.share) await navigator.share({ title: 'Sudoku', text: `Try this ${difficultyLabel(game.difficulty)} Sudoku`, url });
    else {
      await navigator.clipboard.writeText(url);
      toast('Link copied.');
    }
  } catch {
    // Share sheet dismissed.
  }
}

function bestTimes() {
  const best = {};
  for (const h of store.get(KEYS.history, [])) {
    if (h.outcome !== 'solved' || h.hints) continue;
    if (!best[h.difficulty] || h.time < best[h.difficulty]) best[h.difficulty] = h.time;
  }
  return best;
}

function openHistory() {
  const list = store.get(KEYS.history, []);
  const stats = $('stats');
  stats.innerHTML = '';
  for (const [key, d] of Object.entries(S.DIFFICULTIES)) {
    const games = list.filter((h) => h.difficulty === key);
    const solved = games.filter((h) => h.outcome === 'solved');
    const clean = solved.filter((h) => !h.hints);
    const avg = solved.length ? solved.reduce((a, h) => a + h.time, 0) / solved.length : 0;
    const best = clean.length ? Math.min(...clean.map((h) => h.time)) : 0;
    const el = document.createElement('div');
    el.className = 'stat';
    el.innerHTML = `<h3></h3><p>Solved <b>${solved.length}</b> / ${games.length}<br>Best <b>${best ? formatTime(best) : '–'}</b><br>Average <b>${avg ? formatTime(avg) : '–'}</b></p>`;
    el.querySelector('h3').textContent = d.label;
    stats.append(el);
  }

  const ol = $('history-list');
  ol.innerHTML = '';
  if (!list.length) {
    ol.innerHTML = '<li class="empty">Finished and abandoned games will show up here.</li>';
  }
  for (const h of list.slice(0, 100)) {
    const li = document.createElement('li');
    const when = new Date(h.date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    li.innerHTML = '<div><b></b> <span class="outcome"></span><div class="when"></div></div><span class="time"></span><button class="btn" type="button">Replay</button>';
    li.querySelector('b').textContent = difficultyLabel(h.difficulty);
    const outcome = li.querySelector('.outcome');
    outcome.textContent = h.outcome === 'solved' ? (h.hints ? `solved · ${h.hints} hint${h.hints > 1 ? 's' : ''}` : 'solved') : 'abandoned';
    outcome.className = `outcome-${h.outcome}`;
    li.querySelector('.when').textContent = when;
    li.querySelector('.time').textContent = formatTime(h.time);
    li.querySelector('button').addEventListener('click', () => {
      $('dlg-history').close();
      playPuzzleString(h.puzzle, 'replay');
    });
    ol.append(li);
  }
  if (game && game.status === 'playing') setPaused(true);
  $('dlg-history').showModal();
}

$('dlg-history').addEventListener('close', () => {
  if (game && game.status === 'playing' && paused) setPaused(false);
});

function openSettings() {
  const form = $('settings-form');
  form.feedback.value = settings.feedback;
  form.theme.value = settings.theme;
  for (const key of ['highlightSame', 'autoNotes', 'showTimer']) form[key].checked = settings[key];
  $('dlg-settings').showModal();
}

$('settings-form').addEventListener('change', (e) => {
  const { name, type, checked, value } = e.target;
  settings[name] = type === 'checkbox' ? checked : value;
  store.set(KEYS.settings, settings);
  applyTheme();
  render();
  renderTimer();
});

function applyTheme() {
  if (settings.theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = settings.theme;
}

let toastTimer = 0;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3200);
}

// ---------------------------------------------------------------------------
// Input wiring

$('btn-new').addEventListener('click', openNewGame);
$('btn-history').addEventListener('click', openHistory);
$('btn-settings').addEventListener('click', openSettings);
$('btn-undo').addEventListener('click', undo);
$('btn-erase').addEventListener('click', erase);
$('btn-hint').addEventListener('click', requestHint);
$('btn-notes').addEventListener('click', () => {
  notesMode = !notesMode;
  render();
});
$('timer').addEventListener('click', () => game && game.status === 'playing' && setPaused(!paused));
$('btn-resume').addEventListener('click', () => setPaused(false));

document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]') || !game) return;
  if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (mod && key === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
    return;
  }
  if (mod && key === 'y') {
    e.preventDefault();
    redo();
    return;
  }
  if (mod || e.altKey) return;

  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
  if (digit) {
    e.preventDefault();
    input(Number(digit[1]), notesMode !== e.shiftKey);
    return;
  }

  const moves = { arrowup: -9, arrowdown: 9, arrowleft: -1, arrowright: 1 };
  if (key in moves) {
    e.preventDefault();
    if (paused) return;
    if (selected === null) return select(40);
    const r = S.rowOf(selected), c = S.colOf(selected);
    const nr = (r + (key === 'arrowup' ? 8 : key === 'arrowdown' ? 1 : 0)) % 9;
    const nc = (c + (key === 'arrowleft' ? 8 : key === 'arrowright' ? 1 : 0)) % 9;
    select(nr * 9 + nc);
    return;
  }

  if (key === 'backspace' || key === 'delete' || key === '0') {
    e.preventDefault();
    erase();
  } else if (key === 'n') {
    notesMode = !notesMode;
    render();
  } else if (key === 'h') {
    requestHint();
  } else if (key === 'p' || key === ' ') {
    e.preventDefault();
    if (game.status === 'playing') setPaused(!paused);
  } else if (key === 'escape') {
    hint = null;
    selected = null;
    render();
  }
});

// ---------------------------------------------------------------------------
// Boot

function boot() {
  applyTheme();
  buildBoard();

  const shared = /[#&]p=([0-9.]{81})/.exec(location.hash);
  const resumed = load();

  if (shared && (!resumed || S.formatPuzzle(game.puzzle) !== shared[1])) {
    const err = playPuzzleString(shared[1], 'shared');
    if (!err) {
      toast(`Shared puzzle — graded ${difficultyLabel(game.difficulty)}.`);
      return;
    }
    toast(err);
  }

  if (resumed && game.status === 'playing') {
    render();
    if (game.values.some((v, i) => v !== game.puzzle[i])) toast(`Welcome back — your ${difficultyLabel(game.difficulty)} game is right where you left it.`);
  } else {
    if (resumed) render();
    openNewGame();
  }
}

window.addEventListener('hashchange', () => {
  const shared = /[#&]p=([0-9.]{81})/.exec(location.hash);
  if (!shared || (game && S.formatPuzzle(game.puzzle) === shared[1])) return;
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  const err = playPuzzleString(shared[1], 'shared');
  toast(err || `Shared puzzle — graded ${difficultyLabel(game.difficulty)}.`);
});

boot();
