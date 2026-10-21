// Рейтинг игроков по всем сборам с сохранённым счётом (чистая функция, используется сервером).
import { standings, type MatchResult } from './matches.ts';

/** Очко игрока за победу его команды в сборе */
export const POINTS_PER_GATHERING_WIN = 1;
/** Очки лучшему игроку сбора; с очком за победу команды не складываются (берётся большее) */
export const POINTS_BEST_PLAYER = 2;

/** Один сбор: какие команды есть, кто из записавшихся в какой команде, счёт встреч. */
export interface RatingGame {
  teamNos: readonly number[];
  /** Записавшиеся (только сами люди, без их друзей) и номер их команды */
  players: readonly { userId: number; teamNo: number }[];
  results: readonly MatchResult[];
  /** Лучший игрок сбора (выбирает организатор); null — не выбран */
  bestPlayerId?: number | null;
}

export interface RatingStats {
  userId: number;
  matches: { played: number; won: number; drawn: number; lost: number };
  /** Сборы с сохранённым счётом, где игрок был в команде, и сколько из них выиграла его команда */
  gatherings: { played: number; won: number };
  /** Сколько раз игрок был лучшим игроком сбора */
  bestPlayer: number;
  /**
   * Персональные очки за каждый сбор: POINTS_BEST_PLAYER лучшему игроку, иначе POINTS_PER_GATHERING_WIN
   * за победу команды (не складываются)
   */
  points: number;
}

/**
 * Победитель сбора — команда на первом месте турнирной таблицы. Если вторая команда не уступает ей
 * ни по очкам, ни по разнице, ни по забитым мячам, победителя нет (места разделены).
 */
export function gatheringWinner(teamNos: readonly number[], results: readonly MatchResult[]): number | null {
  if (results.length === 0) return null;
  const [first, second] = standings(teamNos, results);
  if (!first) return null;
  if (
    second &&
    second.points === first.points &&
    second.goalDiff === first.goalDiff &&
    second.goalsFor === first.goalsFor
  ) {
    return null;
  }
  return first.teamNo;
}

/**
 * Статистика каждого игрока, который был в команде хотя бы в одном сборе с сохранённым счётом:
 * матчи его команды (каждая встреча — матч), сборы и победы в них, сколько раз был лучшим игроком, очки.
 * Порядок: очки, доля побед в матчах, победы в матчах, сыграно матчей, затем userId.
 */
export function computeRating(games: readonly RatingGame[]): RatingStats[] {
  const byUser = new Map<number, RatingStats>();
  const statsOf = (userId: number): RatingStats => {
    let s = byUser.get(userId);
    if (!s) {
      s = {
        userId,
        matches: { played: 0, won: 0, drawn: 0, lost: 0 },
        gatherings: { played: 0, won: 0 },
        bestPlayer: 0,
        points: 0,
      };
      byUser.set(userId, s);
    }
    return s;
  };

  for (const game of games) {
    const teams = new Set(game.teamNos);
    const results = game.results.filter((r) => teams.has(r.teamA) && teams.has(r.teamB));
    if (results.length === 0) continue;
    const winner = gatheringWinner(game.teamNos, results);
    const seen = new Set<number>();
    for (const p of game.players) {
      // один человек считается в сборе один раз, даже если данные повторяются
      if (!teams.has(p.teamNo) || seen.has(p.userId)) continue;
      seen.add(p.userId);
      const s = statsOf(p.userId);
      s.gatherings.played += 1;
      const best = game.bestPlayerId === p.userId;
      if (best) s.bestPlayer += 1;
      if (winner === p.teamNo) s.gatherings.won += 1;
      // лучший игрок получает свои очки вместо очка за победу команды, а не вдобавок к нему
      s.points += best ? POINTS_BEST_PLAYER : winner === p.teamNo ? POINTS_PER_GATHERING_WIN : 0;
      for (const r of results) {
        if (r.teamA !== p.teamNo && r.teamB !== p.teamNo) continue;
        const [mine, theirs] = r.teamA === p.teamNo ? [r.goalsA, r.goalsB] : [r.goalsB, r.goalsA];
        s.matches.played += 1;
        if (mine > theirs) s.matches.won += 1;
        else if (mine === theirs) s.matches.drawn += 1;
        else s.matches.lost += 1;
      }
    }
  }

  const winShare = (s: RatingStats) => (s.matches.played === 0 ? 0 : s.matches.won / s.matches.played);
  return [...byUser.values()].sort(
    (a, b) =>
      b.points - a.points ||
      winShare(b) - winShare(a) ||
      b.matches.won - a.matches.won ||
      b.matches.played - a.matches.played ||
      a.userId - b.userId,
  );
}

/** Доля в процентах, округлённая до целого; при нуле в знаменателе 0. */
export function percent(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 100);
}
