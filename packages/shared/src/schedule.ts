// Порядок встреч сбора: каждая пара команд играет meetings раз, встречи идут одна за другой.
// Чистые функции, используются сервером и клиентом.

import { MATCH_ORDERS } from './match-orders.generated.ts';
import { matchKey, matchPairs } from './matches.ts';

/** Встреча leg (с 1) команд teamA < teamB. */
export interface MatchSlot {
  teamA: number;
  teamB: number;
  leg: number;
}

/** Самая длинная серия матчей подряд и самая длинная серия ожиданий подряд среди всех команд. */
export interface ScheduleStats {
  maxPlayStreak: number;
  maxWaitStreak: number;
}

/** Все встречи: пары команд по порядку, у каждой встречи 1..meetings. */
export function allMatches(teamsCount: number, meetings: number): MatchSlot[] {
  const out: MatchSlot[] = [];
  for (const { teamA, teamB } of matchPairs(teamsCount)) {
    for (let leg = 1; leg <= meetings; leg++) out.push({ teamA, teamB, leg });
  }
  return out;
}

/**
 * Серии для порядка встреч. Ожидание — встреча, где команда не играет, а у неё ещё будут матчи:
 * ожидание до первого матча считается, после последнего — нет (команда уже отыграла).
 */
export function scheduleStats(order: readonly MatchSlot[], teamsCount: number): ScheduleStats {
  const left = new Array<number>(teamsCount + 1).fill(0);
  for (const m of order) {
    left[m.teamA]! += 1;
    left[m.teamB]! += 1;
  }
  const play = new Array<number>(teamsCount + 1).fill(0);
  const wait = new Array<number>(teamsCount + 1).fill(0);
  let maxPlayStreak = 0;
  let maxWaitStreak = 0;
  for (const m of order) {
    for (let t = 1; t <= teamsCount; t++) {
      if (t === m.teamA || t === m.teamB) {
        left[t]! -= 1;
        play[t]! += 1;
        wait[t] = 0;
        maxPlayStreak = Math.max(maxPlayStreak, play[t]!);
      } else if (left[t]! > 0) {
        play[t] = 0;
        wait[t]! += 1;
        maxWaitStreak = Math.max(maxWaitStreak, wait[t]!);
      }
    }
  }
  return { maxPlayStreak, maxWaitStreak };
}

/**
 * Насколько неравны команды в порядке встреч (меньше — ровнее, сравнивается по полям по порядку):
 * - streakSpread — разница в числе серий игр (а значит, и матчей подряд, и перерывов между матчами);
 * - waitSpread — разница в суммарном ожидании между первым и последним матчем команды;
 * - profiles — сколько команд сверх одной отличаются набором длин серий и перерывов.
 * Ожидание до первого и после последнего матча не учитывается: кто-то обязательно начинает, а кто-то заканчивает.
 */
export interface ScheduleFairness {
  streakSpread: number;
  waitSpread: number;
  profiles: number;
}

export function scheduleFairness(order: readonly MatchSlot[], teamsCount: number): ScheduleFairness {
  const streakCounts: number[] = [];
  const waits: number[] = [];
  const profiles = new Set<string>();
  const sorted = (a: number[]) => [...a].sort((x, y) => x - y).join(',');
  for (let t = 1; t <= teamsCount; t++) {
    const idx: number[] = [];
    order.forEach((m, i) => {
      if (m.teamA === t || m.teamB === t) idx.push(i);
    });
    if (idx.length === 0) continue;
    const streaks: number[] = [];
    const gaps: number[] = [];
    let run = 1;
    for (let j = 1; j < idx.length; j++) {
      const gap = idx[j]! - idx[j - 1]! - 1;
      if (gap === 0) run += 1;
      else {
        streaks.push(run);
        gaps.push(gap);
        run = 1;
      }
    }
    streaks.push(run);
    streakCounts.push(streaks.length);
    waits.push(gaps.reduce((sum, g) => sum + g, 0));
    profiles.add(`${sorted(streaks)}|${sorted(gaps)}`);
  }
  const spread = (a: number[]) => (a.length === 0 ? 0 : Math.max(...a) - Math.min(...a));
  return { streakSpread: spread(streakCounts), waitSpread: spread(waits), profiles: Math.max(profiles.size - 1, 0) };
}

function fairer(a: ScheduleFairness, b: ScheduleFairness): boolean {
  return (a.streakSpread - b.streakSpread || a.waitSpread - b.waitSpread || a.profiles - b.profiles) < 0;
}

const isPerfect = (f: ScheduleFairness) => f.streakSpread === 0 && f.waitSpread === 0 && f.profiles === 0;

/** Сколько шагов перебора даётся на одну пару ограничений; не уложились — считаем ограничения невыполнимыми. */
const SEARCH_BUDGET = 40_000;
/** Шаги на поиск самого ровного порядка при найденных ограничениях: всего и на одну нумерацию команд */
const FAIR_BUDGET = 600_000;
const FAIR_BUDGET_PER_LABELING = 30_000;

/**
 * Перебор с возвратом: порядки встреч, где ни одна команда не играет больше maxPlay матчей подряд
 * и не ждёт больше maxWait встреч подряд. Каждый найденный порядок передаётся в onSolution; если она вернёт true,
 * перебор останавливается. Возвращает, нашёлся ли хоть один порядок за budget шагов.
 * Встречи одной пары идут по возрастанию leg. Первыми пробуются пары, у которых больше встреч впереди (сначала все пары
 * по кругу, потом повторные встречи), затем те, кто дольше ждёт: так первое решение ровнее распределяет игры и отдых.
 * labels меняет нумерацию команд (labels[t] — новый номер команды t): при равных оценках пары пробуются
 * в другом порядке, и перебор находит другие решения.
 */
function search(
  teamsCount: number,
  meetings: number,
  maxPlay: number,
  maxWait: number,
  budget: number,
  onSolution: (order: MatchSlot[]) => boolean,
  labels?: readonly number[],
): boolean {
  const pairs = matchPairs(teamsCount).map((p) => {
    const a = labels ? labels[p.teamA]! : p.teamA;
    const b = labels ? labels[p.teamB]! : p.teamB;
    return { teamA: Math.min(a, b), teamB: Math.max(a, b) };
  });
  const legsLeft = pairs.map(() => meetings);
  const left = new Array<number>(teamsCount + 1).fill(0);
  for (const p of pairs) {
    left[p.teamA]! += meetings;
    left[p.teamB]! += meetings;
  }
  const play = new Array<number>(teamsCount + 1).fill(0);
  const wait = new Array<number>(teamsCount + 1).fill(0);
  const total = pairs.length * meetings;
  const order: MatchSlot[] = [];
  let steps = 0;
  let found = false;
  let stop = false;

  const step = (): void => {
    if (order.length === total) {
      found = true;
      if (onSolution(order.map((m) => ({ ...m })))) stop = true;
      return;
    }
    if (++steps > budget) {
      stop = true;
      return;
    }
    // команды, которые уже ждут maxWait встреч, обязаны сыграть сейчас
    const must: number[] = [];
    for (let t = 1; t <= teamsCount; t++) if (left[t]! > 0 && wait[t]! >= maxWait) must.push(t);
    if (must.length > 2) return;
    const candidates: number[] = [];
    pairs.forEach((p, i) => {
      if (legsLeft[i] === 0) return;
      if (play[p.teamA]! >= maxPlay || play[p.teamB]! >= maxPlay) return;
      if (must.some((t) => t !== p.teamA && t !== p.teamB)) return;
      candidates.push(i);
    });
    const score = (i: number) => {
      const p = pairs[i]!;
      return [legsLeft[i]!, wait[p.teamA]! + wait[p.teamB]!, left[p.teamA]! + left[p.teamB]!];
    };
    candidates.sort((x, y) => {
      const a = score(x);
      const b = score(y);
      return b[0]! - a[0]! || b[1]! - a[1]! || b[2]! - a[2]! || x - y;
    });
    for (const i of candidates) {
      const p = pairs[i]!;
      const saved = { play: [...play], wait: [...wait] };
      legsLeft[i]! -= 1;
      left[p.teamA]! -= 1;
      left[p.teamB]! -= 1;
      for (let t = 1; t <= teamsCount; t++) {
        if (t === p.teamA || t === p.teamB) {
          play[t]! += 1;
          wait[t] = 0;
        } else {
          play[t] = 0;
          if (left[t]! > 0) wait[t]! += 1;
        }
      }
      order.push({ teamA: p.teamA, teamB: p.teamB, leg: meetings - legsLeft[i]! });
      step();
      order.pop();
      legsLeft[i]! += 1;
      left[p.teamA]! += 1;
      left[p.teamB]! += 1;
      for (let t = 0; t <= teamsCount; t++) {
        play[t] = saved.play[t]!;
        wait[t] = saved.wait[t]!;
      }
      if (stop) return;
    }
  };

  step();
  return found;
}

/** Первый найденный порядок или null. */
function first(teamsCount: number, meetings: number, maxPlay: number, maxWait: number): MatchSlot[] | null {
  let result: MatchSlot[] | null = null;
  search(teamsCount, meetings, maxPlay, maxWait, SEARCH_BUDGET, (order) => {
    result = order;
    return true;
  });
  return result;
}

/** Нумерации команд для разнообразия перебора: исходная и перемешанные генератором с постоянным зерном. */
function labelings(teamsCount: number, count: number): number[][] {
  let seed = 0x9e3779b9 ^ teamsCount;
  // mulberry32: один и тот же результат на сервере и в браузере
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const out: number[][] = [];
  for (let k = 0; k < count; k++) {
    const labels = Array.from({ length: teamsCount + 1 }, (_, i) => i);
    if (k > 0) {
      for (let i = teamsCount; i > 1; i--) {
        const j = 1 + Math.floor(random() * i);
        [labels[i], labels[j]] = [labels[j]!, labels[i]!];
      }
    }
    out.push(labels);
  }
  return out;
}

/** Самый ровный между командами порядок при ограничениях maxPlay/maxWait, начиная с уже найденного start. */
function fairest(
  teamsCount: number,
  meetings: number,
  maxPlay: number,
  maxWait: number,
  start: MatchSlot[],
  budget: number,
): MatchSlot[] {
  let best = start;
  let bestFairness = scheduleFairness(start, teamsCount);
  for (const labels of labelings(teamsCount, Math.ceil(budget / FAIR_BUDGET_PER_LABELING))) {
    if (isPerfect(bestFairness)) break;
    search(
      teamsCount,
      meetings,
      maxPlay,
      maxWait,
      FAIR_BUDGET_PER_LABELING,
      (order) => {
        const f = scheduleFairness(order, teamsCount);
        if (fairer(f, bestFairness)) {
          best = order;
          bestFairness = f;
        }
        return isPerfect(bestFairness);
      },
      labels,
    );
  }
  return best;
}

/**
 * Сравнение двух порядков встреч: сначала самая длинная серия матчей подряд, затем серия ожиданий,
 * затем равенство команд (scheduleFairness). Отрицательное число — первый лучше.
 */
export function compareMatchOrders(a: readonly MatchSlot[], b: readonly MatchSlot[], teamsCount: number): number {
  const sa = scheduleStats(a, teamsCount);
  const sb = scheduleStats(b, teamsCount);
  const fa = scheduleFairness(a, teamsCount);
  const fb = scheduleFairness(b, teamsCount);
  return (
    sa.maxPlayStreak - sb.maxPlayStreak ||
    sa.maxWaitStreak - sb.maxWaitStreak ||
    fa.streakSpread - fb.streakSpread ||
    fa.waitSpread - fb.waitSpread ||
    fa.profiles - fb.profiles
  );
}

/**
 * Поиск порядка встреч: сначала как можно меньше матчей подряд у любой команды, затем как можно меньше
 * ожиданий подряд, затем как можно ровнее между командами (на это даётся fairBudget шагов перебора).
 * Нижние границы: при двух командах играют все встречи подряд, при трёх кто-то играет дважды подряд;
 * ждать меньше ⌈n/2⌉−1 встреч нельзя — за встречу играют только две команды.
 * Долгий: готовые результаты лежат в match-orders.generated.ts (scripts/generate-match-orders.ts).
 */
export function searchMatchOrder(teamsCount: number, meetings: number, fairBudget = FAIR_BUDGET): MatchSlot[] {
  let result: MatchSlot[] | null = null;
  if (teamsCount > 2) {
    const minPlay = teamsCount === 3 ? 2 : 1;
    const minWait = Math.ceil(teamsCount / 2) - 1;
    for (let p = minPlay; p <= minPlay + 2 && !result; p++) {
      for (let w = minWait; w <= minWait + 3 && !result; w++) {
        const found = first(teamsCount, meetings, p, w);
        if (found) result = fairBudget > 0 ? fairest(teamsCount, meetings, p, w, found, fairBudget) : found;
      }
    }
    // запасной вариант: без ограничений на ожидание первое решение перебора всё равно ровное
    result ??= first(teamsCount, meetings, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  }
  return result ?? allMatches(teamsCount, meetings);
}

/** Строка таблицы: пары команд по два символа (номер команды в base36), встречи пары нумеруются по порядку. */
export function encodeMatchOrder(order: readonly MatchSlot[]): string {
  return order.map((m) => `${m.teamA.toString(36)}${m.teamB.toString(36)}`).join('');
}

export function decodeMatchOrder(code: string): MatchSlot[] {
  const legs = new Map<string, number>();
  const out: MatchSlot[] = [];
  for (let i = 0; i + 1 < code.length; i += 2) {
    const teamA = parseInt(code[i]!, 36);
    const teamB = parseInt(code[i + 1]!, 36);
    const pair = `${teamA}-${teamB}`;
    const leg = (legs.get(pair) ?? 0) + 1;
    legs.set(pair, leg);
    out.push({ teamA, teamB, leg });
  }
  return out;
}

const cache = new Map<string, MatchSlot[]>();

/**
 * Порядок встреч по умолчанию (лучший по compareMatchOrders из найденных): из заранее рассчитанной таблицы,
 * а для сочетаний вне таблицы — быстрым поиском без выравнивания между командами.
 */
export function defaultMatchOrder(teamsCount: number, meetings: number): MatchSlot[] {
  const key = `${teamsCount}:${meetings}`;
  let result = cache.get(key);
  if (!result) {
    const code = MATCH_ORDERS[key];
    const all = allMatches(teamsCount, meetings);
    const decoded = code === undefined ? null : decodeMatchOrder(code);
    result =
      decoded && isMatchPermutation(decoded.map((m) => matchKey(m.teamA, m.teamB, m.leg)), all)
        ? decoded
        : searchMatchOrder(teamsCount, meetings, 0);
    cache.set(key, result);
  }
  return result.map((m) => ({ ...m }));
}

/**
 * Порядок встреч сбора: сохранённый организатором (ключи matchKey), если он содержит ровно все встречи сбора,
 * иначе порядок по умолчанию (например, после смены числа команд или встреч).
 */
export function matchOrder(
  teamsCount: number,
  meetings: number,
  saved: readonly string[] | null,
): { matches: MatchSlot[]; custom: boolean } {
  const all = allMatches(teamsCount, meetings);
  if (saved && isMatchPermutation(saved, all)) {
    const byKey = new Map(all.map((m) => [matchKey(m.teamA, m.teamB, m.leg), m]));
    return { matches: saved.map((k) => ({ ...byKey.get(k)! })), custom: true };
  }
  return { matches: defaultMatchOrder(teamsCount, meetings), custom: false };
}

/** Ключи — ровно все встречи (каждая по разу). */
export function isMatchPermutation(keys: readonly string[], all: readonly MatchSlot[]): boolean {
  if (keys.length !== all.length) return false;
  const expected = new Set(all.map((m) => matchKey(m.teamA, m.teamB, m.leg)));
  const seen = new Set<string>();
  for (const k of keys) {
    if (!expected.has(k) || seen.has(k)) return false;
    seen.add(k);
  }
  return true;
}

/** Перенос элемента списка с позиции from на позицию to (как при перетаскивании). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  const [item] = out.splice(from, 1);
  if (item === undefined) return [...list];
  out.splice(to, 0, item);
  return out;
}
