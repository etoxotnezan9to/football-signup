import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeRating, gatheringWinner, percent, type MatchResult } from '../src/index.ts';

const m = (teamA: number, teamB: number, goalsA: number, goalsB: number, leg = 1): MatchResult => ({
  teamA,
  teamB,
  leg,
  goalsA,
  goalsB,
});

describe('gatheringWinner', () => {
  it('первое место таблицы; при полном равенстве с вторым победителя нет; без счёта — нет', () => {
    assert.equal(gatheringWinner([1, 2], [m(1, 2, 2, 1)]), 1);
    assert.equal(gatheringWinner([1, 2], [m(1, 2, 1, 1)]), null);
    assert.equal(gatheringWinner([1, 2], []), null);
    // равные очки, но лучше разница
    assert.equal(gatheringWinner([1, 2, 3], [m(1, 2, 3, 0), m(2, 3, 1, 0), m(1, 3, 0, 1)]), 1);
  });
});

describe('computeRating', () => {
  it('матчи команды игрока, сборы, победы в сборах и очки по нескольким сборам', () => {
    const rows = computeRating([
      {
        // сбор 1: команда 1 (игроки 10, 11) выиграла обе встречи у команды 2 (игрок 20)
        teamNos: [1, 2],
        players: [
          { userId: 10, teamNo: 1 },
          { userId: 11, teamNo: 1 },
          { userId: 20, teamNo: 2 },
        ],
        results: [m(1, 2, 2, 0, 1), m(1, 2, 1, 0, 2)],
      },
      {
        // сбор 2: 10 и 20 вместе в команде 2, ничья и победа над командой 1 (игрок 11)
        teamNos: [1, 2],
        players: [
          { userId: 11, teamNo: 1 },
          { userId: 10, teamNo: 2 },
          { userId: 20, teamNo: 2 },
        ],
        results: [m(1, 2, 1, 1, 1), m(1, 2, 0, 3, 2)],
      },
      {
        // сбор без счёта не учитывается
        teamNos: [1, 2],
        players: [{ userId: 30, teamNo: 1 }],
        results: [],
      },
    ]);
    assert.deepEqual(
      rows.map((r) => [r.userId, r.matches, r.gatherings, r.points]),
      [
        [10, { played: 4, won: 3, drawn: 1, lost: 0 }, { played: 2, won: 2 }, 2],
        [11, { played: 4, won: 2, drawn: 1, lost: 1 }, { played: 2, won: 1 }, 1],
        [20, { played: 4, won: 1, drawn: 1, lost: 2 }, { played: 2, won: 1 }, 1],
      ],
    );
  });

  it('при равных очках выше тот, у кого больше доля побед в матчах', () => {
    const rows = computeRating([
      {
        teamNos: [1, 2, 3],
        players: [
          { userId: 1, teamNo: 1 },
          { userId: 2, teamNo: 2 },
          { userId: 3, teamNo: 3 },
        ],
        // команда 3 побеждает обе, команды 1 и 2 сыграли вничью между собой
        results: [m(1, 2, 0, 0), m(1, 3, 0, 1), m(2, 3, 0, 2)],
      },
    ]);
    assert.deepEqual(
      rows.map((r) => r.userId),
      [3, 1, 2],
    );
    assert.equal(rows[0]!.points, 1);
  });

  it('счёт команд, которых нет в сборе, и игроки вне команд не учитываются', () => {
    const rows = computeRating([
      {
        teamNos: [1, 2],
        players: [
          { userId: 1, teamNo: 1 },
          { userId: 9, teamNo: 3 },
        ],
        results: [m(1, 3, 5, 0), m(1, 2, 0, 1)],
      },
    ]);
    assert.deepEqual(
      rows.map((r) => [r.userId, r.matches.played, r.matches.lost]),
      [[1, 1, 1]],
    );
  });
});

describe('лучший игрок сбора', () => {
  const game = (bestPlayerId: number | null) => ({
    teamNos: [1, 2],
    players: [
      { userId: 1, teamNo: 1 },
      { userId: 2, teamNo: 1 },
      { userId: 3, teamNo: 2 },
    ],
    results: [m(1, 2, 2, 0)], // команда 1 выиграла сбор
    bestPlayerId,
  });
  const points = (rows: ReturnType<typeof computeRating>) =>
    Object.fromEntries(rows.map((r) => [r.userId, [r.points, r.bestPlayer]]));

  it('2 очка вместо очка за победу команды, а не вдобавок', () => {
    assert.deepEqual(points(computeRating([game(1)])), { 1: [2, 1], 2: [1, 0], 3: [0, 0] });
  });

  it('лучший игрок проигравшей команды тоже получает 2 очка', () => {
    assert.deepEqual(points(computeRating([game(3)])), { 1: [1, 0], 2: [1, 0], 3: [2, 1] });
  });

  it('выбор игрока, которого нет в командах сбора, не учитывается', () => {
    assert.deepEqual(points(computeRating([game(99)])), { 1: [1, 0], 2: [1, 0], 3: [0, 0] });
  });
});

describe('percent', () => {
  it('округляет и не делит на ноль', () => {
    assert.equal(percent(1, 3), 33);
    assert.equal(percent(2, 3), 67);
    assert.equal(percent(0, 0), 0);
  });
});
