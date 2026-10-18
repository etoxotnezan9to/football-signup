// Типы ответов API и событий WebSocket (docs/openapi.yaml, docs/realtime.md).
import type { ErrorCode } from './constants.ts';

export interface User {
  vkId: number;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
}

export type GameStatus = 'active' | 'cancelled';

export interface GameSummary {
  id: number;
  title: string;
  startsAt: string;
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
  address: string;
  format: string;
  description: string;
  paymentInfo: string;
  organizerContact: string;
  roster: RosterEntry[];
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
