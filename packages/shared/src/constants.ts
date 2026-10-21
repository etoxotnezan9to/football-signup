// Константы из docs/spec.md, раздел 2. Используются и сервером, и клиентом.

export const MAX_SEATS_PER_USER = 5;
export const MIN_CAPACITY = 2;
export const MAX_CAPACITY = 60;
export const MIN_TEAMS = 2;
export const MAX_TEAMS = 10;
export const MIN_PLAYERS_PER_TEAM = 2;
export const MAX_PLAYERS_PER_TEAM = 11;
export const MAX_FEE_RUB = 100_000;
export const MAX_ACTIVE_GAMES_PER_ORGANIZER = 10;
export const LIST_PAGE_SIZE = 20;
export const LAUNCH_PARAMS_MAX_AGE_SEC = 86_400;
export const WS_HEARTBEAT_SEC = 25;
export const FINISH_GRACE_MIN = 180;

export const ERROR_CODES = [
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'SEATS_LIMIT_EXCEEDED',
  'GAME_NOT_ACTIVE',
  'ACTIVE_GAMES_LIMIT',
  'STARTS_AT_IN_PAST',
  'RATE_LIMITED',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
