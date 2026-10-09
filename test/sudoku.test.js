import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../public/js/sudoku.js';

const CLASSIC = '53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79';

const isValidSolution = (grid) =>
  S.UNITS.every((unit) => new Set(unit.map((i) => grid[i])).size === 9 && unit.every((i) => grid[i] >= 1 && grid[i] <= 9));

test('geometry: every cell has 20 peers and 3 units', () => {
  for (let i = 0; i < 81; i++) {
    assert.equal(S.PEERS[i].length, 20);
    for (const u of S.CELL_UNITS[i]) assert.ok(S.UNITS[u].includes(i));
  }
});

test('parse and format round-trip', () => {
  const grid = S.parsePuzzle(CLASSIC);
  assert.equal(grid.length, 81);
  assert.equal(S.formatPuzzle(grid), CLASSIC);
  assert.equal(S.parsePuzzle('123'), null);
});

test('solver finds the unique solution of a classic puzzle', () => {
  const { count, solution } = S.solve(S.parsePuzzle(CLASSIC));
  assert.equal(count, 1);
  assert.ok(isValidSolution(solution));
});

test('solver detects multiple solutions and contradictions', () => {
  assert.equal(S.solve(new Array(81).fill(0)).count, 2);
  const bad = new Array(81).fill(0);
  bad[0] = bad[1] = 5;
  assert.equal(S.solve(bad).count, 0);
});

test('logical solver solves the classic puzzle with singles only', () => {
  const result = S.logicalSolve(S.parsePuzzle(CLASSIC));
  assert.ok(result.solved);
  assert.ok(result.level <= 2);
  assert.deepEqual(result.grid, S.solve(S.parsePuzzle(CLASSIC)).solution);
});

for (const difficulty of Object.keys(S.DIFFICULTIES)) {
  test(`generates ${difficulty} puzzles that match their grade`, () => {
    for (let seed = 1; seed <= 5; seed++) {
      const p = S.generate(difficulty, { seed });
      assert.equal(p.difficulty, difficulty);
      assert.ok(S.hasUniqueSolution(p.puzzle), 'unique solution');
      assert.ok(isValidSolution(p.solution));
      p.puzzle.forEach((d, i) => d && assert.equal(d, p.solution[i]));
      assert.ok(p.givens >= S.DIFFICULTIES[difficulty].minGivens);
      const graded = S.grade(p.puzzle);
      assert.equal(graded.difficulty, difficulty);
      assert.deepEqual(graded.grid, p.solution);
    }
  });
}

test('generation is reproducible from a seed', () => {
  assert.deepEqual(S.generate('hard', { seed: 42 }).puzzle, S.generate('hard', { seed: 42 }).puzzle);
});

test('hint steps never eliminate the true digit', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const { puzzle, solution } = S.generate('expert', { seed });
    const grid = puzzle.slice();
    const cand = S.candidatesFor(grid);
    let step;
    while ((step = S.findStep(grid, cand))) {
      if (step.place) assert.equal(step.place.digit, solution[step.place.cell], step.technique);
      for (const [i, m] of step.eliminate || []) assert.equal(m & S.bit(solution[i]), 0, step.technique);
      assert.ok(step.text.length > 0);
      S.applyStep(grid, cand, step);
    }
    assert.deepEqual(grid, solution);
  }
});
