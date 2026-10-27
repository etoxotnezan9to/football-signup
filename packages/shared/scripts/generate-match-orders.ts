// Рассчитывает порядки встреч по умолчанию для всех сочетаний числа команд и встреч и записывает
// их в src/match-orders.generated.ts. Долго (минуты): запускать после изменения правил в src/schedule.ts.
//   node packages/shared/scripts/generate-match-orders.ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MAX_MEETINGS, MAX_TEAMS } from '../src/constants.ts';
import {
  compareMatchOrders,
  decodeMatchOrder,
  encodeMatchOrder,
  scheduleFairness,
  scheduleStats,
  searchMatchOrder,
  type MatchSlot,
} from '../src/schedule.ts';

/** Перенумеровать команды (labels[t] — новый номер команды t) и заново пронумеровать встречи пар. */
function relabel(order: readonly MatchSlot[], labels: readonly number[]): MatchSlot[] {
  const code = order
    .map((m) => {
      const a = labels[m.teamA]!;
      const b = labels[m.teamB]!;
      return `${Math.min(a, b).toString(36)}${Math.max(a, b).toString(36)}`;
    })
    .join('');
  return decodeMatchOrder(code);
}

/** Перестановки номеров команд: все при n ≤ 6, иначе 500 случайных с постоянным зерном. */
function permutations(n: number): number[][] {
  const out: number[][] = [];
  if (n <= 6) {
    const rec = (prefix: number[], rest: number[]) => {
      if (rest.length === 0) out.push([0, ...prefix]);
      rest.forEach((x, i) => rec([...prefix, x], [...rest.slice(0, i), ...rest.slice(i + 1)]));
    };
    rec([], Array.from({ length: n }, (_, i) => i + 1));
    return out;
  }
  let seed = 12345 + n;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  out.push(Array.from({ length: n + 1 }, (_, i) => i));
  for (let k = 0; k < 500; k++) {
    const p = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = n; i > 1; i--) {
      const j = 1 + Math.floor(random() * i);
      [p[i], p[j]] = [p[j]!, p[i]!];
    }
    out.push(p);
  }
  return out;
}

const table: Record<string, string> = {};
const best = new Map<string, MatchSlot[]>();
for (let n = 3; n <= MAX_TEAMS; n++) {
  const perms = permutations(n);
  for (let m = 1; m <= MAX_MEETINGS; m++) {
    const started = Date.now();
    let winner = searchMatchOrder(n, m);
    // склейки лучших порядков для меньшего числа встреч с перенумерацией команд на стыке
    for (let m1 = 1; m1 < m; m1++) {
      const head = best.get(`${n}:${m1}`)!;
      const tail = best.get(`${n}:${m - m1}`)!;
      for (const p of perms) {
        const candidate = decodeMatchOrder(encodeMatchOrder([...head, ...relabel(tail, p)]));
        if (compareMatchOrders(candidate, winner, n) < 0) winner = candidate;
      }
    }
    best.set(`${n}:${m}`, winner);
    table[`${n}:${m}`] = encodeMatchOrder(winner);
    const s = scheduleStats(winner, n);
    const f = scheduleFairness(winner, n);
    console.log(
      `${n} команд, ${m} встреч: подряд ${s.maxPlayStreak}, ждут ${s.maxWaitStreak}, ` +
        `неравенство ${f.streakSpread}/${f.waitSpread}/${f.profiles} (${Date.now() - started} мс)`,
    );
  }
}

const lines = Object.entries(table).map(([k, v]) => `  '${k}': '${v}',`);
const file = fileURLToPath(new URL('../src/match-orders.generated.ts', import.meta.url));
writeFileSync(
  file,
  `// Сгенерировано scripts/generate-match-orders.ts, вручную не править.\n` +
    `// Порядок встреч по умолчанию для «команд:встреч»: пары по два символа (номера команд в base36).\n` +
    `export const MATCH_ORDERS: Readonly<Record<string, string>> = {\n${lines.join('\n')}\n};\n`,
);
console.log(`записано: ${file}`);
