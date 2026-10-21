import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isGoals, matchKey, matchPairs, standings } from '../src/index.ts';

describe('matchPairs', () => {
  for (const n of [2, 3, 4, 10]) {
    it(`${n} команд: каждая пара ровно один раз, teamA < teamB`, () => {
      const pairs = matchPairs(n);
      assert.equal(pairs.length, (n * (n - 1)) / 2);
      assert.equal(new Set(pairs.map((p) => matchKey(p.teamA, p.teamB, 1))).size, pairs.length);
      assert.ok(pairs.every((p) => p.teamA < p.teamB && p.teamA >= 1 && p.teamB <= n));
    });
  }

  it('порядок: 1–2, 1–3, 2–3; меньше двух команд — пар нет', () => {
    assert.deepEqual(
      matchPairs(3).map((p) => `${p.teamA}-${p.teamB}`),
      ['1-2', '1-3', '2-3'],
    );
    assert.deepEqual(matchPairs(1), []);
  });

  it('ключ встречи не зависит от порядка команд и различает встречи', () => {
    assert.equal(matchKey(2, 1, 1), matchKey(1, 2, 1));
    assert.notEqual(matchKey(1, 2, 1), matchKey(1, 2, 2));
  });
});

describe('standings', () => {
  it('3 очка за победу, 1 за ничью; порядок: очки, разница, забитые, номер', () => {
    const rows = standings(
      [1, 2, 3, 4],
      [
        { teamA: 1, teamB: 2, leg: 1, goalsA: 2, goalsB: 0 }, // 1 победила
        { teamA: 3, teamB: 4, leg: 1, goalsA: 1, goalsB: 1 }, // ничья
        { teamA: 1, teamB: 3, leg: 1, goalsA: 0, goalsB: 1 }, // 3 победила
        { teamA: 2, teamB: 4, leg: 1, goalsA: 3, goalsB: 0 }, // 2 победила
      ],
    );
    assert.deepEqual(
      rows.map((r) => [r.teamNo, r.played, r.won, r.drawn, r.lost, r.goalsFor, r.goalsAgainst, r.goalDiff, r.points]),
      [
        [3, 2, 1, 1, 0, 2, 1, 1, 4], // 4 очка
        [2, 2, 1, 0, 1, 3, 2, 1, 3], // 3 очка, разница +1, забито 3
        [1, 2, 1, 0, 1, 2, 1, 1, 3], // 3 очка, разница +1, забито 2
        [4, 2, 0, 1, 1, 1, 4, -3, 1],
      ],
    );
  });

  it('команды без матчей — с нулями; счёт с неизвестной командой не учитывается', () => {
    const rows = standings([1, 2], [{ teamA: 1, teamB: 5, leg: 1, goalsA: 3, goalsB: 0 }]);
    assert.deepEqual(
      rows.map((r) => [r.teamNo, r.played, r.points]),
      [
        [1, 0, 0],
        [2, 0, 0],
      ],
    );
  });
});

describe('встречи в таблице', () => {
  it('каждая встреча пары — отдельный матч', () => {
    const rows = standings(
      [1, 2],
      [
        { teamA: 1, teamB: 2, leg: 1, goalsA: 2, goalsB: 1 },
        { teamA: 1, teamB: 2, leg: 2, goalsA: 0, goalsB: 0 },
      ],
    );
    assert.deepEqual(
      rows.map((r) => [r.teamNo, r.played, r.won, r.drawn, r.lost, r.points]),
      [
        [1, 2, 1, 1, 0, 4],
        [2, 2, 0, 1, 1, 1],
      ],
    );
  });
});

describe('isGoals', () => {
  it('целые 0..99', () => {
    for (const v of [0, 7, 99]) assert.ok(isGoals(v));
    for (const v of [-1, 100, 1.5, '2', null]) assert.ok(!isGoals(v), String(v));
  });
});
