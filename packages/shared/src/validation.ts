// Валидация входных данных без внешних библиотек (используется и сервером, и клиентом).
import {
  MAX_CAPACITY,
  MAX_FEE_RUB,
  MAX_PLAYERS_PER_TEAM,
  MAX_SEATS_PER_USER,
  MAX_TEAMS,
  MIN_PLAYERS_PER_TEAM,
  MIN_TEAMS,
} from './constants.ts';

export interface GameInput {
  startsAt: string;
  placeId: number;
  /** Максимальное число команд */
  teamsMax: number;
  /** Игроков в команде */
  playersPerTeam: number;
  feeRub: number;
  description: string;
  paymentInfo: string;
  organizerContact: string;
}

export type FieldErrors = Record<string, string>;

type Raw = Record<string, unknown>;

function isRecord(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkString(
  raw: Raw,
  key: string,
  min: number,
  max: number,
  errors: FieldErrors,
  out: Raw,
  required: boolean,
): void {
  const v = raw[key];
  if (v === undefined) {
    if (required) errors[key] = 'обязательное поле';
    return;
  }
  if (typeof v !== 'string') {
    errors[key] = 'должно быть строкой';
    return;
  }
  const s = v.trim();
  if (s.length < min || s.length > max) {
    errors[key] = min > 0 ? `длина от ${min} до ${max}` : `не длиннее ${max}`;
    return;
  }
  out[key] = s;
}

function checkInt(
  raw: Raw,
  key: string,
  min: number,
  max: number,
  errors: FieldErrors,
  out: Raw,
  required: boolean,
): void {
  const v = raw[key];
  if (v === undefined) {
    if (required) errors[key] = 'обязательное поле';
    return;
  }
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    errors[key] = `целое число от ${min} до ${max}`;
    return;
  }
  out[key] = v;
}

/** Мест в составе: команд × игроков в команде. Отдельно не задаётся. */
export function gameCapacity(teamsMax: number, playersPerTeam: number): number {
  return teamsMax * playersPerTeam;
}

/** Ошибка для поля playersPerTeam, если произведение не помещается в MAX_CAPACITY; иначе null. */
export function capacityError(teamsMax: number, playersPerTeam: number): string | null {
  return gameCapacity(teamsMax, playersPerTeam) > MAX_CAPACITY
    ? `команд × игроков — не больше ${MAX_CAPACITY} мест`
    : null;
}

function checkTeams(raw: Raw, errors: FieldErrors, out: Raw, required: boolean): void {
  checkInt(raw, 'teamsMax', MIN_TEAMS, MAX_TEAMS, errors, out, required);
  checkInt(raw, 'playersPerTeam', MIN_PLAYERS_PER_TEAM, MAX_PLAYERS_PER_TEAM, errors, out, required);
  if (typeof out.teamsMax === 'number' && typeof out.playersPerTeam === 'number') {
    const err = capacityError(out.teamsMax, out.playersPerTeam);
    if (err) errors.playersPerTeam = err;
  }
}

function checkPlaceId(raw: Raw, errors: FieldErrors, out: Raw, required: boolean): void {
  const v = raw.placeId;
  if (v === undefined) {
    if (required) errors.placeId = 'выберите место';
    return;
  }
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    errors.placeId = 'выберите место';
    return;
  }
  out.placeId = v;
}

function checkDate(raw: Raw, key: string, errors: FieldErrors, out: Raw, required: boolean): void {
  const v = raw[key];
  if (v === undefined) {
    if (required) errors[key] = 'обязательное поле';
    return;
  }
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) {
    errors[key] = 'дата в формате ISO-8601';
    return;
  }
  out[key] = new Date(v).toISOString();
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

/** Разбор тела создания игры: все обязательные поля должны быть заданы. */
export function parseGameInput(body: unknown): ParseResult<GameInput> {
  if (!isRecord(body)) return { ok: false, errors: { body: 'ожидается объект' } };
  const errors: FieldErrors = {};
  const out: Raw = {};
  checkDate(body, 'startsAt', errors, out, true);
  checkPlaceId(body, errors, out, true);
  checkTeams(body, errors, out, true);
  checkInt(body, 'feeRub', 0, MAX_FEE_RUB, errors, out, true);
  checkString(body, 'description', 0, 1000, errors, out, false);
  checkString(body, 'paymentInfo', 0, 300, errors, out, false);
  checkString(body, 'organizerContact', 0, 120, errors, out, false);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      startsAt: out.startsAt as string,
      placeId: out.placeId as number,
      teamsMax: out.teamsMax as number,
      playersPerTeam: out.playersPerTeam as number,
      feeRub: out.feeRub as number,
      description: (out.description as string | undefined) ?? '',
      paymentInfo: (out.paymentInfo as string | undefined) ?? '',
      organizerContact: (out.organizerContact as string | undefined) ?? '',
    },
  };
}

/**
 * Разбор частичного обновления игры: любое подмножество полей, но не пустое.
 * Если передано только одно из teamsMax и playersPerTeam, предел произведения проверяет вызывающий по итоговым значениям.
 */
export function parseGameUpdate(body: unknown): ParseResult<Partial<GameInput>> {
  if (!isRecord(body)) return { ok: false, errors: { body: 'ожидается объект' } };
  const errors: FieldErrors = {};
  const out: Raw = {};
  checkDate(body, 'startsAt', errors, out, false);
  checkPlaceId(body, errors, out, false);
  checkTeams(body, errors, out, false);
  checkInt(body, 'feeRub', 0, MAX_FEE_RUB, errors, out, false);
  checkString(body, 'description', 0, 1000, errors, out, false);
  checkString(body, 'paymentInfo', 0, 300, errors, out, false);
  checkString(body, 'organizerContact', 0, 120, errors, out, false);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (Object.keys(out).length === 0) return { ok: false, errors: { body: 'нет полей для изменения' } };
  return { ok: true, value: out as Partial<GameInput> };
}

export interface PlaceInput {
  name: string;
  address: string;
}

/** Разбор тела создания места: название и адрес обязательны. */
export function parsePlaceInput(body: unknown): ParseResult<PlaceInput> {
  if (!isRecord(body)) return { ok: false, errors: { body: 'ожидается объект' } };
  const errors: FieldErrors = {};
  const out: Raw = {};
  checkString(body, 'name', 1, 80, errors, out, true);
  checkString(body, 'address', 1, 160, errors, out, true);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name: out.name as string, address: out.address as string } };
}

/** Число мест для записи: 1..MAX_SEATS_PER_USER. Превышение лимита отличается от прочих ошибок. */
export type SeatsCheck =
  { ok: true; seats: number } | { ok: false; code: 'VALIDATION_ERROR' | 'SEATS_LIMIT_EXCEEDED' };

export function checkSeats(value: unknown): SeatsCheck {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return { ok: false, code: 'VALIDATION_ERROR' };
  }
  if (value > MAX_SEATS_PER_USER) return { ok: false, code: 'SEATS_LIMIT_EXCEEDED' };
  return { ok: true, seats: value };
}
