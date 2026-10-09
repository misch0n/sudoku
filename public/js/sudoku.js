// Sudoku engine: board geometry, a fast backtracking solver, a human-style
// logical solver (used for grading and hints), and a puzzle generator.
// Grids are flat arrays of 81 numbers, 0 meaning empty. Candidate sets are
// 9-bit masks where bit (d - 1) stands for digit d.

export const ALL = 0x1ff;

export const rowOf = (i) => (i / 9) | 0;
export const colOf = (i) => i % 9;
export const boxOf = (i) => ((rowOf(i) / 3) | 0) * 3 + ((colOf(i) / 3) | 0);
export const bit = (d) => 1 << (d - 1);

// Units 0-8 are rows, 9-17 columns, 18-26 boxes.
export const UNITS = [];
for (let r = 0; r < 9; r++) UNITS.push(Array.from({ length: 9 }, (_, c) => r * 9 + c));
for (let c = 0; c < 9; c++) UNITS.push(Array.from({ length: 9 }, (_, r) => r * 9 + c));
for (let b = 0; b < 9; b++) {
  const r0 = ((b / 3) | 0) * 3;
  const c0 = (b % 3) * 3;
  UNITS.push(Array.from({ length: 9 }, (_, k) => (r0 + ((k / 3) | 0)) * 9 + c0 + (k % 3)));
}

export const CELL_UNITS = Array.from({ length: 81 }, (_, i) => [rowOf(i), 9 + colOf(i), 18 + boxOf(i)]);

export const PEERS = Array.from({ length: 81 }, (_, i) => {
  const set = new Set();
  for (const u of CELL_UNITS[i]) for (const j of UNITS[u]) if (j !== i) set.add(j);
  return [...set];
});

export function popcount(mask) {
  let n = 0;
  while (mask) {
    mask &= mask - 1;
    n++;
  }
  return n;
}

export function digitsOf(mask) {
  const out = [];
  for (let d = 1; d <= 9; d++) if (mask & bit(d)) out.push(d);
  return out;
}

const lowestDigit = (mask) => 32 - Math.clz32(mask & -mask);

export function unitName(u) {
  if (u < 9) return `row ${u + 1}`;
  if (u < 18) return `column ${u - 8}`;
  return `box ${u - 17}`;
}

export const cellName = (i) => `R${rowOf(i) + 1}C${colOf(i) + 1}`;

// ---------------------------------------------------------------------------
// Randomness (seeded so a puzzle can be reproduced from its seed)

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randomSeed = () => (Math.random() * 2 ** 32) >>> 0;

function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------------------------------------------------------------------------
// Backtracking solver

/**
 * Counts solutions up to `limit`. With `rand`, digits are tried in random
 * order, which turns the solver into a generator of random full grids.
 */
export function solve(grid, { limit = 2, rand = null } = {}) {
  const g = Array.from(grid);
  const rows = new Uint16Array(9);
  const cols = new Uint16Array(9);
  const boxes = new Uint16Array(9);
  for (let i = 0; i < 81; i++) {
    const d = g[i];
    if (!d) continue;
    const m = bit(d);
    const r = rowOf(i), c = colOf(i), b = boxOf(i);
    if ((rows[r] | cols[c] | boxes[b]) & m) return { count: 0, solution: null };
    rows[r] |= m;
    cols[c] |= m;
    boxes[b] |= m;
  }

  let count = 0;
  let solution = null;

  const search = () => {
    let best = -1;
    let bestMask = 0;
    let bestCount = 10;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const mask = ALL & ~(rows[rowOf(i)] | cols[colOf(i)] | boxes[boxOf(i)]);
      const n = popcount(mask);
      if (n === 0) return false;
      if (n < bestCount) {
        best = i;
        bestMask = mask;
        bestCount = n;
        if (n === 1) break;
      }
    }
    if (best === -1) {
      count++;
      if (!solution) solution = g.slice();
      return count >= limit;
    }
    const digits = digitsOf(bestMask);
    if (rand) shuffle(digits, rand);
    const r = rowOf(best), c = colOf(best), b = boxOf(best);
    for (const d of digits) {
      const m = bit(d);
      g[best] = d;
      rows[r] |= m;
      cols[c] |= m;
      boxes[b] |= m;
      const done = search();
      g[best] = 0;
      rows[r] &= ~m;
      cols[c] &= ~m;
      boxes[b] &= ~m;
      if (done) return true;
    }
    return false;
  };

  search();
  return { count, solution };
}

export const hasUniqueSolution = (grid) => solve(grid, { limit: 2 }).count === 1;

// ---------------------------------------------------------------------------
// Logical solver. Each technique has a level; a puzzle's difficulty is the
// hardest level needed to solve it without guessing.

export const LEVELS = {
  1: 'Singles in a row, column or box',
  2: 'Naked singles',
  3: 'Locked candidates, pairs and triples',
  4: 'X-Wing, Swordfish and Y-Wing',
  5: 'Beyond the built-in techniques',
};

export function candidatesFor(grid) {
  const cand = new Uint16Array(81);
  for (let i = 0; i < 81; i++) {
    if (grid[i]) continue;
    let used = 0;
    for (const j of PEERS[i]) if (grid[j]) used |= bit(grid[j]);
    cand[i] = ALL & ~used;
  }
  return cand;
}

function* combinations(items, n, start = 0, acc = []) {
  if (acc.length === n) {
    yield acc.slice();
    return;
  }
  for (let k = start; k <= items.length - (n - acc.length); k++) {
    acc.push(items[k]);
    yield* combinations(items, n, k + 1, acc);
    acc.pop();
  }
}

function findFullHouse(grid) {
  for (let u = 0; u < 27; u++) {
    const empty = UNITS[u].filter((i) => !grid[i]);
    if (empty.length !== 1) continue;
    let used = 0;
    for (const i of UNITS[u]) if (grid[i]) used |= bit(grid[i]);
    const cell = empty[0];
    const digit = lowestDigit(ALL & ~used);
    return {
      technique: 'Full house', level: 1, place: { cell, digit }, unit: u, cells: [cell],
      text: `${cellName(cell)} is the last empty cell in ${unitName(u)}, so it must be ${digit}.`,
    };
  }
  return null;
}

// Boxes first: that is where people usually look for them.
const HIDDEN_SINGLE_ORDER = [18, 19, 20, 21, 22, 23, 24, 25, 26, ...Array(18).keys()];

function findHiddenSingle(grid, cand) {
  for (const u of HIDDEN_SINGLE_ORDER) {
    for (let d = 1; d <= 9; d++) {
      const m = bit(d);
      let spot = -1;
      let n = 0;
      for (const i of UNITS[u]) {
        if (grid[i] === d) { n = -1; break; }
        if (!grid[i] && cand[i] & m) { spot = i; n++; }
      }
      if (n !== 1) continue;
      return {
        technique: 'Hidden single', level: 1, place: { cell: spot, digit: d }, unit: u, cells: [spot],
        text: `In ${unitName(u)}, ${d} can only go in ${cellName(spot)}.`,
      };
    }
  }
  return null;
}

function findNakedSingle(grid, cand) {
  for (let i = 0; i < 81; i++) {
    if (grid[i] || popcount(cand[i]) !== 1) continue;
    const digit = lowestDigit(cand[i]);
    return {
      technique: 'Naked single', level: 2, place: { cell: i, digit }, unit: null, cells: [i, ...PEERS[i].filter((j) => grid[j])],
      text: `${cellName(i)} sees every digit except ${digit} in its row, column and box.`,
    };
  }
  return null;
}

// Collects eliminations as [cell, mask] pairs, skipping no-ops.
function elims(pairs) {
  return pairs.filter(([, m]) => m);
}

function findLockedCandidates(grid, cand) {
  for (let d = 1; d <= 9; d++) {
    const m = bit(d);
    // Pointing: within a box, d is confined to one row or column.
    for (let b = 18; b < 27; b++) {
      const spots = UNITS[b].filter((i) => !grid[i] && cand[i] & m);
      if (spots.length < 2) continue;
      for (const [lineOf, base] of [[rowOf, 0], [colOf, 9]]) {
        const line = lineOf(spots[0]);
        if (!spots.every((i) => lineOf(i) === line)) continue;
        const eliminate = elims(UNITS[base + line].filter((i) => boxOf(i) !== b - 18 && !grid[i]).map((i) => [i, cand[i] & m]));
        if (eliminate.length) {
          return {
            technique: 'Pointing candidates', level: 3, eliminate, unit: b, cells: spots,
            text: `In ${unitName(b)}, ${d} must be in ${unitName(base + line)}, so ${d} can be removed from the rest of ${unitName(base + line)}.`,
          };
        }
      }
    }
    // Claiming: within a row or column, d is confined to one box.
    for (let u = 0; u < 18; u++) {
      const spots = UNITS[u].filter((i) => !grid[i] && cand[i] & m);
      if (spots.length < 2) continue;
      const b = boxOf(spots[0]);
      if (!spots.every((i) => boxOf(i) === b)) continue;
      const eliminate = elims(UNITS[18 + b].filter((i) => !UNITS[u].includes(i) && !grid[i]).map((i) => [i, cand[i] & m]));
      if (eliminate.length) {
        return {
          technique: 'Claiming candidates', level: 3, eliminate, unit: u, cells: spots,
          text: `In ${unitName(u)}, ${d} must be inside ${unitName(18 + b)}, so ${d} can be removed from the rest of that box.`,
        };
      }
    }
  }
  return null;
}

function findNakedSubset(grid, cand, n) {
  const name = n === 2 ? 'Naked pair' : 'Naked triple';
  for (let u = 0; u < 27; u++) {
    const empty = UNITS[u].filter((i) => !grid[i]);
    const small = empty.filter((i) => popcount(cand[i]) <= n);
    if (small.length < n || empty.length <= n) continue;
    for (const combo of combinations(small, n)) {
      let union = 0;
      for (const i of combo) union |= cand[i];
      if (popcount(union) !== n) continue;
      const eliminate = elims(empty.filter((i) => !combo.includes(i)).map((i) => [i, cand[i] & union]));
      if (eliminate.length) {
        return {
          technique: name, level: 3, eliminate, unit: u, cells: combo,
          text: `${combo.map(cellName).join(', ')} in ${unitName(u)} can only hold ${digitsOf(union).join(', ')}, so those digits can be removed from the rest of ${unitName(u)}.`,
        };
      }
    }
  }
  return null;
}

function findHiddenSubset(grid, cand, n) {
  const name = n === 2 ? 'Hidden pair' : 'Hidden triple';
  for (let u = 0; u < 27; u++) {
    const empty = UNITS[u].filter((i) => !grid[i]);
    if (empty.length <= n) continue;
    const placed = UNITS[u].reduce((acc, i) => (grid[i] ? acc | bit(grid[i]) : acc), 0);
    const digits = digitsOf(ALL & ~placed).filter((d) => {
      const k = empty.filter((i) => cand[i] & bit(d)).length;
      return k >= 2 && k <= n;
    });
    for (const combo of combinations(digits, n)) {
      const mask = combo.reduce((acc, d) => acc | bit(d), 0);
      const spots = empty.filter((i) => cand[i] & mask);
      if (spots.length !== n) continue;
      const eliminate = elims(spots.map((i) => [i, cand[i] & ~mask]));
      if (eliminate.length) {
        return {
          technique: name, level: 3, eliminate, unit: u, cells: spots,
          text: `In ${unitName(u)}, ${combo.join(', ')} can only go in ${spots.map(cellName).join(', ')}, so other candidates can be removed from those cells.`,
        };
      }
    }
  }
  return null;
}

function findFish(grid, cand, n) {
  const name = n === 2 ? 'X-Wing' : 'Swordfish';
  for (let d = 1; d <= 9; d++) {
    const m = bit(d);
    for (const [base, cross, crossOf] of [[0, 9, colOf], [9, 0, rowOf]]) {
      const lines = [];
      for (let k = 0; k < 9; k++) {
        const spots = UNITS[base + k].filter((i) => !grid[i] && cand[i] & m);
        if (spots.length >= 2 && spots.length <= n) lines.push({ k, spots });
      }
      for (const combo of combinations(lines, n)) {
        const covers = new Set(combo.flatMap((l) => l.spots.map(crossOf)));
        if (covers.size !== n) continue;
        const inFish = new Set(combo.flatMap((l) => l.spots));
        const eliminate = elims([...covers].flatMap((c) =>
          UNITS[cross + c].filter((i) => !grid[i] && !inFish.has(i)).map((i) => [i, cand[i] & m])));
        if (eliminate.length) {
          const kind = base === 0 ? 'rows' : 'columns';
          const other = base === 0 ? 'columns' : 'rows';
          return {
            technique: name, level: 4, eliminate, unit: null, cells: [...inFish],
            text: `In ${kind} ${combo.map((l) => l.k + 1).join(', ')}, ${d} is confined to the same ${n} ${other}, so ${d} can be removed from the rest of those ${other}.`,
          };
        }
      }
    }
  }
  return null;
}

function findYWing(grid, cand) {
  const sees = (a, b) => PEERS[a].includes(b);
  const pairs = [];
  for (let i = 0; i < 81; i++) if (!grid[i] && popcount(cand[i]) === 2) pairs.push(i);
  for (const pivot of pairs) {
    const [a, b] = digitsOf(cand[pivot]);
    const wings = pairs.filter((i) => i !== pivot && sees(pivot, i));
    for (const x of wings) {
      if (!(cand[x] & bit(a)) || cand[x] & bit(b)) continue;
      const c = lowestDigit(cand[x] & ~bit(a));
      for (const y of wings) {
        if (y === x || cand[y] !== (bit(b) | bit(c))) continue;
        const eliminate = elims(PEERS[x].filter((i) => i !== y && i !== pivot && !grid[i] && sees(i, y)).map((i) => [i, cand[i] & bit(c)]));
        if (eliminate.length) {
          return {
            technique: 'Y-Wing', level: 4, eliminate, unit: null, cells: [pivot, x, y],
            text: `${cellName(pivot)} is ${a} or ${b}. Either way, ${cellName(x)} or ${cellName(y)} must be ${c}, so ${c} can be removed from cells that see both.`,
          };
        }
      }
    }
  }
  return null;
}

const FINDERS = [
  (g) => findFullHouse(g),
  (g, c) => findHiddenSingle(g, c),
  (g, c) => findNakedSingle(g, c),
  (g, c) => findLockedCandidates(g, c),
  (g, c) => findNakedSubset(g, c, 2),
  (g, c) => findHiddenSubset(g, c, 2),
  (g, c) => findNakedSubset(g, c, 3),
  (g, c) => findHiddenSubset(g, c, 3),
  (g, c) => findFish(g, c, 2),
  (g, c) => findYWing(g, c),
  (g, c) => findFish(g, c, 3),
];

/** Returns the easiest logical step available, or null if stuck. */
export function findStep(grid, cand) {
  for (const find of FINDERS) {
    const step = find(grid, cand);
    if (step) return step;
  }
  return null;
}

export function applyStep(grid, cand, step) {
  if (step.place) {
    const { cell, digit } = step.place;
    grid[cell] = digit;
    cand[cell] = 0;
    for (const j of PEERS[cell]) cand[j] &= ~bit(digit);
  }
  if (step.eliminate) for (const [i, m] of step.eliminate) cand[i] &= ~m;
}

/**
 * Solves as a person would, easiest technique first. `level` is the hardest
 * technique needed; 5 means the built-in techniques got stuck.
 */
export function logicalSolve(puzzle, { maxLevel = 5 } = {}) {
  const grid = Array.from(puzzle);
  const cand = candidatesFor(grid);
  let level = 0;
  const techniques = {};
  for (;;) {
    if (grid.every(Boolean)) return { solved: true, level, techniques, grid };
    const step = findStep(grid, cand);
    if (!step) return { solved: false, level: 5, techniques, grid };
    level = Math.max(level, step.level);
    if (level > maxLevel) return { solved: false, level, techniques, grid };
    techniques[step.technique] = (techniques[step.technique] || 0) + 1;
    applyStep(grid, cand, step);
  }
}

// ---------------------------------------------------------------------------
// Difficulty and generation

export const DIFFICULTIES = {
  easy: { label: 'Easy', level: 1, minGivens: 36, blurb: 'Every step is a single hiding in a row, column or box.' },
  medium: { label: 'Medium', level: 2, minGivens: 30, blurb: 'You will need to spot cells with only one possible digit.' },
  hard: { label: 'Hard', level: 3, minGivens: 0, blurb: 'Notes help: locked candidates, pairs and triples.' },
  expert: { label: 'Expert', level: 4, minGivens: 0, blurb: 'X-Wings, Swordfish and Y-Wings. Never guessing.' },
};

export function difficultyForLevel(level) {
  return Object.keys(DIFFICULTIES).find((k) => DIFFICULTIES[k].level === level) || 'beyond';
}

export function grade(puzzle) {
  const result = logicalSolve(puzzle);
  return { ...result, difficulty: difficultyForLevel(result.level) };
}

function carve(target, rand) {
  const solution = solve(new Array(81).fill(0), { limit: 1, rand }).solution;
  const puzzle = solution.slice();
  let givens = 81;
  // Remove cells in rotationally symmetric pairs, like a printed puzzle.
  const order = shuffle([...Array(41).keys()], rand);
  for (const i of order) {
    const j = 80 - i;
    const removed = i === j ? 1 : 2;
    if (givens - removed < target.minGivens) continue;
    puzzle[i] = puzzle[j] = 0;
    if (hasUniqueSolution(puzzle) && logicalSolve(puzzle, { maxLevel: target.level }).solved) {
      givens -= removed;
    } else {
      puzzle[i] = solution[i];
      puzzle[j] = solution[j];
    }
  }
  return { puzzle, solution, level: logicalSolve(puzzle).level, givens };
}

/**
 * Generates a puzzle whose hardest required technique matches the
 * difficulty. Gives up after `timeBudget` ms and returns the closest match.
 */
export function generate(difficulty, { seed = randomSeed(), timeBudget = 4000 } = {}) {
  const target = DIFFICULTIES[difficulty];
  if (!target) throw new Error(`Unknown difficulty: ${difficulty}`);
  const rand = mulberry32(seed);
  const start = Date.now();
  let best = null;
  for (let attempts = 1; ; attempts++) {
    const candidate = carve(target, rand);
    if (!best || Math.abs(candidate.level - target.level) < Math.abs(best.level - target.level)) best = candidate;
    if (best.level === target.level || Date.now() - start > timeBudget) {
      return { ...best, difficulty: difficultyForLevel(best.level), requested: difficulty, seed, attempts };
    }
  }
}

// ---------------------------------------------------------------------------
// Puzzle strings: 81 characters, digits for givens and 0 or . for blanks.

export function parsePuzzle(text) {
  const chars = String(text).replace(/[^0-9.]/g, '');
  if (chars.length !== 81) return null;
  return [...chars].map((ch) => (ch === '.' ? 0 : Number(ch)));
}

export const formatPuzzle = (grid) => grid.map((d) => d || '.').join('');
