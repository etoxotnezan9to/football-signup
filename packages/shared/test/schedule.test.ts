import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_MEETINGS,
  MAX_TEAMS,
  MIN_TEAMS,
  allMatches,
  defaultMatchOrder,
  isMatchPermutation,
  matchKey,
  matchOrder,
  moveItem,
  scheduleStats,
  scheduleFairness,
  encodeMatchOrder,
  decodeMatchOrder,
  type MatchSlot,
} from '../src/index.ts';
import { MATCH_ORDERS } from '../src/match-orders.generated.ts';

const keys = (order: readonly MatchSlot[]) => order.map((m) => matchKey(m.teamA, m.teamB, m.leg));
const pairs = (order: readonly MatchSlot[]) => order.map((m) => `${m.teamA}${m.teamB}`).join(' ');

describe('порядок встреч по умолчанию', () => {
  it('для любого числа команд и встреч — все встречи по разу, встречи пары по возрастанию', () => {
    for (let n = MIN_TEAMS; n <= MAX_TEAMS; n++) {
      for (let m = 1; m <= MAX_MEETINGS; m++) {
        const order = defaultMatchOrder(n, m);
        assert.ok(isMatchPermutation(keys(order), allMatches(n, m)), `${n} команд, ${m} встреч`);
        const lastLeg = new Map<string, number>();
        for (const x of order) {
          const pair = `${x.teamA}-${x.teamB}`;
          assert.equal(x.leg, (lastLeg.get(pair) ?? 0) + 1);
          lastLeg.set(pair, x.leg);
        }
      }
    }
  });

  it('3 команды: не больше 2 матчей подряд, никто не ждёт 2 встречи подряд', () => {
    assert.equal(pairs(defaultMatchOrder(3, 2)), '12 13 23 12 13 23');
    assert.deepEqual(scheduleStats(defaultMatchOrder(3, 5), 3), { maxPlayStreak: 2, maxWaitStreak: 1 });
  });

  it('4 команды: 2 подряд и 2 ожидания (меньше нельзя: тогда играли бы только 1–2 и 3–4)', () => {
    for (let m = 1; m <= MAX_MEETINGS; m++) {
      assert.deepEqual(scheduleStats(defaultMatchOrder(4, m), 4), { maxPlayStreak: 2, maxWaitStreak: 2 }, `${m} встреч`);
    }
  });

  it('5 и больше команд: никто не играет два матча подряд, ожидание не больше нижней границы + 1', () => {
    for (let n = 5; n <= MAX_TEAMS; n++) {
      const s = scheduleStats(defaultMatchOrder(n, 2), n);
      assert.equal(s.maxPlayStreak, 1, `${n} команд`);
      assert.ok(s.maxWaitStreak <= Math.ceil(n / 2), `${n} команд: ждут ${s.maxWaitStreak}`);
    }
    assert.deepEqual(scheduleStats(defaultMatchOrder(5, 3), 5), { maxPlayStreak: 1, maxWaitStreak: 2 });
  });

  it('две команды: все встречи подряд', () => {
    assert.equal(pairs(defaultMatchOrder(2, 3)), '12 12 12');
  });

  it('повторные встречи пары идут после круга остальных пар', () => {
    const order = defaultMatchOrder(4, 2);
    assert.deepEqual(
      order.slice(0, 6).map((x) => x.leg),
      [1, 1, 1, 1, 1, 1],
    );
  });
});

describe('равенство команд', () => {
  it('таблица готовых порядков есть для всех сочетаний команд и встреч', () => {
    for (let n = 3; n <= MAX_TEAMS; n++) {
      for (let m = 1; m <= MAX_MEETINGS; m++) assert.ok(MATCH_ORDERS[`${n}:${m}`], `${n}:${m}`);
    }
  });

  it('4 команды от 2 встреч: у всех команд одинаковые серии игр и перерывы', () => {
    for (let m = 2; m <= MAX_MEETINGS; m++) {
      assert.deepEqual(scheduleFairness(defaultMatchOrder(4, m), 4), { streakSpread: 0, waitSpread: 0, profiles: 0 }, `${m} встреч`);
    }
  });

  it('5 и больше команд: у всех одинаковое число матчей подряд и перерывов между матчами', () => {
    for (let n = 5; n <= MAX_TEAMS; n++) {
      for (let m = 1; m <= MAX_MEETINGS; m++) {
        assert.equal(scheduleFairness(defaultMatchOrder(n, m), n).streakSpread, 0, `${n} команд, ${m} встреч`);
      }
    }
  });

  it('3 команды и 4 команды с одной встречей: без ухудшения серий разница не больше одной серии', () => {
    for (let m = 1; m <= MAX_MEETINGS; m++) assert.ok(scheduleFairness(defaultMatchOrder(3, m), 3).streakSpread <= 1);
    assert.ok(scheduleFairness(defaultMatchOrder(4, 1), 4).streakSpread <= 1);
  });

  it('scheduleFairness: серии, перерывы и наборы длин', () => {
    const order: MatchSlot[] = [
      { teamA: 1, teamB: 2, leg: 1 },
      { teamA: 1, teamB: 3, leg: 1 },
      { teamA: 2, teamB: 3, leg: 1 },
    ];
    // 1: серия из двух; 2: две серии с перерывом 1; 3: серия из двух
    assert.deepEqual(scheduleFairness(order, 3), { streakSpread: 1, waitSpread: 1, profiles: 1 });
  });

  it('кодирование таблицы: номера команд до 10, встречи пары по порядку', () => {
    const order: MatchSlot[] = [
      { teamA: 1, teamB: 10, leg: 1 },
      { teamA: 2, teamB: 3, leg: 1 },
      { teamA: 1, teamB: 10, leg: 2 },
    ];
    assert.equal(encodeMatchOrder(order), '1a231a');
    assert.deepEqual(decodeMatchOrder('1a231a'), order);
  });
});

describe('scheduleStats', () => {
  it('ожидание до первого матча считается, после последнего — нет', () => {
    const order: MatchSlot[] = [
      { teamA: 1, teamB: 2, leg: 1 },
      { teamA: 1, teamB: 2, leg: 2 },
      { teamA: 1, teamB: 3, leg: 1 },
    ];
    // 3 ждёт 2 встречи до первого матча; 2 после своего последнего не ждёт; 1 играет 3 подряд
    assert.deepEqual(scheduleStats(order, 3), { maxPlayStreak: 3, maxWaitStreak: 2 });
  });
});

describe('matchOrder и moveItem', () => {
  it('сохранённый порядок берётся, только если в нём ровно все встречи', () => {
    const custom = ['2-3-1', '1-3-1', '1-2-1'];
    assert.deepEqual(matchOrder(3, 1, custom), {
      matches: [
        { teamA: 2, teamB: 3, leg: 1 },
        { teamA: 1, teamB: 3, leg: 1 },
        { teamA: 1, teamB: 2, leg: 1 },
      ],
      custom: true,
    });
    // после смены числа встреч или команд — порядок по умолчанию
    assert.equal(matchOrder(3, 2, custom).custom, false);
    assert.equal(matchOrder(3, 1, ['1-2-1', '1-2-1', '2-3-1']).custom, false);
    assert.equal(matchOrder(3, 1, null).custom, false);
  });

  it('перенос элемента вверх и вниз', () => {
    assert.deepEqual(moveItem(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd']);
    assert.deepEqual(moveItem(['a', 'b', 'c', 'd'], 3, 1), ['a', 'd', 'b', 'c']);
    assert.deepEqual(moveItem(['a', 'b'], 5, 0), ['a', 'b']);
  });
});
