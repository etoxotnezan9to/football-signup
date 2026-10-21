// Матчи между командами игры (каждая пара встречается meetings раз) и турнирная таблица.
// Чистые функции, используются сервером и клиентом.

export const MAX_GOALS = 99;
export const POINTS_WIN = 3;
export const POINTS_DRAW = 1;

/** Счёт встречи leg (с 1) команд teamA < teamB (номера с 1); голы — в том же порядке. */
export interface MatchResult {
  teamA: number;
  teamB: number;
  leg: number;
  goalsA: number;
  goalsB: number;
}

/** Пара команд, которая встречается между собой meetings раз. */
export interface MatchPair {
  /** Меньший номер команды */
  teamA: number;
  /** Больший номер команды */
  teamB: number;
}

/** Все пары команд 1..teamsCount (каждая с каждой): 1–2, 1–3, …, 2–3, … */
export function matchPairs(teamsCount: number): MatchPair[] {
  const out: MatchPair[] = [];
  for (let a = 1; a <= teamsCount; a++) {
    for (let b = a + 1; b <= teamsCount; b++) out.push({ teamA: a, teamB: b });
  }
  return out;
}

/** Ключ встречи: пара команд в любом порядке и номер встречи. */
export function matchKey(teamA: number, teamB: number, leg: number): string {
  return `${Math.min(teamA, teamB)}-${Math.max(teamA, teamB)}-${leg}`;
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
 * Турнирная таблица как в групповом этапе: каждая встреча — отдельный матч, победа — 3 очка, ничья — 1.
 * Порядок: очки, разница мячей, забитые мячи, затем номер команды. Учитываются только матчи между командами из teamNos.
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
