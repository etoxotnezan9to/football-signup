// Типы ответов API и событий WebSocket (docs/openapi.yaml, docs/realtime.md).
import type { ErrorCode } from './constants.ts';
import type { MatchResult } from './matches.ts';
import type { MatchSlot } from './schedule.ts';
import type { Team, TeamSeat } from './teams.ts';

export interface User {
  vkId: number;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
}

/** Место проведения игр. Создать может любой пользователь, видят все. */
export interface Place {
  id: number;
  name: string;
  address: string;
}

export type GameStatus = 'active' | 'cancelled';

export interface GameSummary {
  id: number;
  startsAt: string;
  placeId: number;
  /** Название места (из сущности «Место») */
  venue: string;
  feeRub: number;
  capacity: number;
  status: GameStatus;
  isFinished: boolean;
  /** Занято мест в составе */
  taken: number;
  /** Мест в очереди */
  queued: number;
  organizer: User;
  /** Мои места суммарно (только в ответах REST, зависит от получателя) */
  mySeats?: number;
}

export interface RosterEntry {
  signupId: number;
  user: User;
  seats: number;
  mainSeats: number;
  queueSeats: number;
  paidSeats: number;
  createdAt: string;
}

export interface GameDetails extends GameSummary {
  /** Адрес места (из сущности «Место») */
  address: string;
  /** Максимальное число команд */
  teamsMax: number;
  /** Игроков в команде */
  playersPerTeam: number;
  /** Сколько раз каждая пара команд играет между собой */
  meetings: number;
  description: string;
  paymentInfo: string;
  organizerContact: string;
  roster: RosterEntry[];
  /** Команды (их teamsMax) с распределёнными игроками состава */
  teams: Team[];
  /** Места состава, ещё не распределённые по командам */
  unassigned: TeamSeat[];
  /** Лучший игрок сбора (vkId, выбирает организатор из записавшихся, кто в командах); null — не выбран */
  bestPlayerId: number | null;
  /** Счёт сыгранных встреч между командами (каждая пара — meetings встреч) */
  results: MatchResult[];
  /** Все встречи в порядке проведения: заданном организатором или по умолчанию (defaultMatchOrder) */
  matches: MatchSlot[];
  /** Порядок встреч задан организатором (иначе — по умолчанию) */
  matchOrderCustom: boolean;
}

/** Строка рейтинга игроков (GET /rating) */
export interface RatingRow {
  user: User;
  matches: { played: number; won: number; drawn: number; lost: number };
  gatherings: { played: number; won: number };
  /** Сколько раз игрок был лучшим игроком сбора */
  bestPlayer: number;
  points: number;
}

export interface ErrorBody {
  error: { code: ErrorCode; message: string };
}

export type ServerEvent =
  | { type: 'game.created'; game: GameSummary }
  | { type: 'game.updated'; game: GameSummary }
  | { type: 'roster.updated'; game: GameDetails };

export type ClientMessage =
  | { type: 'auth'; launchParams: string }
  | { type: 'subscribe'; topic: 'games' }
  | { type: 'subscribe'; topic: 'game'; gameId: number }
  | { type: 'unsubscribe'; topic: 'game'; gameId: number }
  | { type: 'ping' };
