import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isGoals, matchKey, roundRobin, standings } from '../src/index.ts';

describe('roundRobin', () => {
  for (const n of [2, 3, 4, 5, 6, 10]) {
    it(`${n} команд: каждая с каждой ровно один раз, в туре никто не играет дважды`, () => {
      const matches = roundRobin(n);
      assert.equal(matches.length, (n * (n - 1)) / 2);
      assert.equal(new Set(matches.map((m) => matchKey(m.teamA, m.teamB))).size, matches.length);
      assert.ok(matches.every((m) => m.teamA < m.teamB && m.teamA >= 1 && m.teamB <= n));
      const rounds = new Set(matches.map((m) => m.round));
      assert.equal(rounds.size, n % 2 === 0 ? n - 1 : n);
      for (const r of rounds) {
        const teams = matches.filter((m) => m.round === r).flatMap((m) => [m.teamA, m.teamB]);
        assert.equal(new Set(teams).size, teams.length, `тур ${r}`);
      }
    });
  }

  it('меньше двух команд — матчей нет', () => {
    assert.deepEqual(roundRobin(1), []);
  });

  it('4 команды: 3 тура по 2 матча', () => {
    assert.deepEqual(
      roundRobin(4).map((m) => `${m.round}:${m.teamA}-${m.teamB}`),
      ['1:1-4', '1:2-3', '2:1-3', '2:2-4', '3:1-2', '3:3-4'],
    );
  });
});

describe('standings', () => {
  it('3 очка за победу, 1 за ничью; порядок: очки, разница, забитые, номер', () => {
    const rows = standings(
      [1, 2, 3, 4],
      [
        { teamA: 1, teamB: 2, goalsA: 2, goalsB: 0 }, // 1 победила
        { teamA: 3, teamB: 4, goalsA: 1, goalsB: 1 }, // ничья
        { teamA: 1, teamB: 3, goalsA: 0, goalsB: 1 }, // 3 победила
        { teamA: 2, teamB: 4, goalsA: 3, goalsB: 0 }, // 2 победила
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
    const rows = standings([1, 2], [{ teamA: 1, teamB: 5, goalsA: 3, goalsB: 0 }]);
    assert.deepEqual(
      rows.map((r) => [r.teamNo, r.played, r.points]),
      [
        [1, 0, 0],
        [2, 0, 0],
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
