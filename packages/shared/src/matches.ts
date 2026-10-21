// Матчи между командами игры и турнирная таблица (чистые функции, используются сервером и клиентом).

export const MAX_GOALS = 99;
export const POINTS_WIN = 3;
export const POINTS_DRAW = 1;

/** Счёт матча команд teamA < teamB (номера с 1); голы — в том же порядке. */
export interface MatchResult {
  teamA: number;
  teamB: number;
  goalsA: number;
  goalsB: number;
}

export interface Match {
  /** Номер тура, с 1 */
  round: number;
  /** Меньший номер команды */
  teamA: number;
  /** Больший номер команды */
  teamB: number;
}

/**
 * Круговая система: каждая команда с каждой по одному разу, по турам (метод «вращения круга»),
 * чтобы команды играли по очереди. При нечётном числе команд в каждом туре одна отдыхает.
 */
export function roundRobin(teamsCount: number): Match[] {
  if (teamsCount < 2) return [];
  const slots: number[] = Array.from({ length: teamsCount }, (_, i) => i + 1);
  if (slots.length % 2 === 1) slots.push(0); // 0 — отдых
  const n = slots.length;
  const out: Match[] = [];
  for (let round = 1; round < n; round++) {
    for (let i = 0; i < n / 2; i++) {
      const x = slots[i]!;
      const y = slots[n - 1 - i]!;
      if (x === 0 || y === 0) continue;
      out.push({ round, teamA: Math.min(x, y), teamB: Math.max(x, y) });
    }
    // первая позиция закреплена, остальные сдвигаются по кругу
    slots.splice(1, 0, slots.pop()!);
  }
  return out;
}

export function matchKey(teamA: number, teamB: number): string {
  return `${Math.min(teamA, teamB)}-${Math.max(teamA, teamB)}`;
}

/** Число голов: целое 0..MAX_GOALS. */
export function isGoals(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_GOALS;
}

export interface StandingRow {
  teamNo: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
}

/**
 * Турнирная таблица как в групповом этапе: победа — 3 очка, ничья — 1. Порядок: очки, разница мячей,
 * забитые мячи, затем номер команды. Учитываются только матчи между командами из teamNos.
 */
export function standings(teamNos: readonly number[], results: readonly MatchResult[]): StandingRow[] {
  const rows = new Map<number, StandingRow>(
    teamNos.map((no) => [
      no,
      { teamNo: no, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0 },
    ]),
  );
  const add = (row: StandingRow, scored: number, conceded: number) => {
    row.played += 1;
    row.goalsFor += scored;
    row.goalsAgainst += conceded;
    if (scored > conceded) {
      row.won += 1;
      row.points += POINTS_WIN;
    } else if (scored === conceded) {
      row.drawn += 1;
      row.points += POINTS_DRAW;
    } else {
      row.lost += 1;
    }
  };
  for (const r of results) {
    const a = rows.get(r.teamA);
    const b = rows.get(r.teamB);
    if (!a || !b || r.teamA === r.teamB) continue;
    add(a, r.goalsA, r.goalsB);
    add(b, r.goalsB, r.goalsA);
  }
  for (const row of rows.values()) row.goalDiff = row.goalsFor - row.goalsAgainst;
  return [...rows.values()].sort(
    (x, y) =>
      y.points - x.points || y.goalDiff - x.goalDiff || y.goalsFor - x.goalsFor || x.teamNo - y.teamNo,
  );
}
