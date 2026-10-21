import type { ErrorCode } from '@football/shared';

const STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  SEATS_LIMIT_EXCEEDED: 422,
  GAME_NOT_ACTIVE: 409,
  ACTIVE_GAMES_LIMIT: 422,
  STARTS_AT_IN_PAST: 422,
  TEAM_FULL: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class AppError extends Error {
  code: ErrorCode;
  status: number;
  details?: Record<string, string>;

  constructor(code: ErrorCode, message: string, details?: Record<string, string>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
    if (details) this.details = details;
  }
}
