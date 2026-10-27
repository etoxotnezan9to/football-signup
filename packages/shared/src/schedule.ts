// Порядок встреч сбора: каждая пара команд играет meetings раз, встречи идут одна за другой.
// Чистые функции, используются сервером и клиентом.

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

/** Сколько шагов перебора даётся на одну пару ограничений; не уложились — считаем ограничения невыполнимыми. */
const SEARCH_BUDGET = 40_000;

/**
 * Перебор с возвратом: порядок встреч, где ни одна команда не играет больше maxPlay матчей подряд
 * и не ждёт больше maxWait встреч подряд. null — не нашли за SEARCH_BUDGET шагов.
 * Встречи одной пары идут по возрастанию leg. Первыми пробуются пары, у которых больше встреч впереди (сначала все пары
 * по кругу, потом повторные встречи), затем те, кто дольше ждёт: так первое решение ровнее распределяет игры и отдых.
 */
function search(teamsCount: number, meetings: number, maxPlay: number, maxWait: number): MatchSlot[] | null {
  const pairs = matchPairs(teamsCount);
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

  const step = (): boolean => {
    if (order.length === total) return true;
    if (++steps > SEARCH_BUDGET) return false;
    // команды, которые уже ждут maxWait встреч, обязаны сыграть сейчас
    const must: number[] = [];
    for (let t = 1; t <= teamsCount; t++) if (left[t]! > 0 && wait[t]! >= maxWait) must.push(t);
    if (must.length > 2) return false;
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
      if (step()) return true;
      order.pop();
      legsLeft[i]! += 1;
      left[p.teamA]! += 1;
      left[p.teamB]! += 1;
      for (let t = 0; t <= teamsCount; t++) {
        play[t] = saved.play[t]!;
        wait[t] = saved.wait[t]!;
      }
      if (steps > SEARCH_BUDGET) return false;
    }
    return false;
  };

  return step() ? order : null;
}

const cache = new Map<string, MatchSlot[]>();

/**
 * Порядок встреч по умолчанию: сначала как можно меньше матчей подряд у любой команды,
 * затем как можно меньше ожиданий подряд. Нижние границы: при двух командах играют все встречи подряд,
 * при трёх кто-то играет дважды подряд; ждать меньше ⌈n/2⌉−1 встреч нельзя — за встречу играют только две команды.
 */
export function defaultMatchOrder(teamsCount: number, meetings: number): MatchSlot[] {
  const key = `${teamsCount}:${meetings}`;
  const hit = cache.get(key);
  if (hit) return hit.map((m) => ({ ...m }));
  const all = allMatches(teamsCount, meetings);
  let result: MatchSlot[] | null = null;
  if (teamsCount === 2) result = all;
  else if (teamsCount > 2) {
    const minPlay = teamsCount === 3 ? 2 : 1;
    const minWait = Math.ceil(teamsCount / 2) - 1;
    for (let p = minPlay; p <= minPlay + 2 && !result; p++) {
      for (let w = minWait; w <= minWait + 3 && !result; w++) result = search(teamsCount, meetings, p, w);
    }
    // запасной вариант: без ограничений на ожидание первое решение перебора всё равно ровное
    result ??= search(teamsCount, meetings, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER) ?? all;
  } else result = all;
  cache.set(key, result);
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
