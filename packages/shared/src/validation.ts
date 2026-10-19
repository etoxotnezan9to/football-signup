// Валидация входных данных без внешних библиотек (используется и сервером, и клиентом).
import { MAX_CAPACITY, MAX_FEE_RUB, MAX_SEATS_PER_USER, MIN_CAPACITY } from './constants.ts';

export interface GameInput {
  title: string;
  startsAt: string;
  venue: string;
  address: string;
  format: string;
  feeRub: number;
  capacity: number;
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
  checkString(body, 'title', 1, 80, errors, out, true);
  checkDate(body, 'startsAt', errors, out, true);
  checkString(body, 'venue', 1, 80, errors, out, true);
  checkString(body, 'address', 1, 160, errors, out, true);
  checkString(body, 'format', 0, 120, errors, out, false);
  checkInt(body, 'feeRub', 0, MAX_FEE_RUB, errors, out, true);
  checkInt(body, 'capacity', MIN_CAPACITY, MAX_CAPACITY, errors, out, true);
  checkString(body, 'description', 0, 1000, errors, out, false);
  checkString(body, 'paymentInfo', 0, 300, errors, out, false);
  checkString(body, 'organizerContact', 0, 120, errors, out, false);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title: out.title as string,
      startsAt: out.startsAt as string,
      venue: out.venue as string,
      address: out.address as string,
      format: (out.format as string | undefined) ?? '',
      feeRub: out.feeRub as number,
      capacity: out.capacity as number,
      description: (out.description as string | undefined) ?? '',
      paymentInfo: (out.paymentInfo as string | undefined) ?? '',
      organizerContact: (out.organizerContact as string | undefined) ?? '',
    },
  };
}

/** Разбор частичного обновления игры: любое подмножество полей, но не пустое. */
export function parseGameUpdate(body: unknown): ParseResult<Partial<GameInput>> {
  if (!isRecord(body)) return { ok: false, errors: { body: 'ожидается объект' } };
  const errors: FieldErrors = {};
  const out: Raw = {};
  checkString(body, 'title', 1, 80, errors, out, false);
  checkDate(body, 'startsAt', errors, out, false);
  checkString(body, 'venue', 1, 80, errors, out, false);
  checkString(body, 'address', 1, 160, errors, out, false);
  checkString(body, 'format', 0, 120, errors, out, false);
  checkInt(body, 'feeRub', 0, MAX_FEE_RUB, errors, out, false);
  checkInt(body, 'capacity', MIN_CAPACITY, MAX_CAPACITY, errors, out, false);
  checkString(body, 'description', 0, 1000, errors, out, false);
  checkString(body, 'paymentInfo', 0, 300, errors, out, false);
  checkString(body, 'organizerContact', 0, 120, errors, out, false);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (Object.keys(out).length === 0) return { ok: false, errors: { body: 'нет полей для изменения' } };
  return { ok: true, value: out as Partial<GameInput> };
}

/** Число мест для записи: 1..MAX_SEATS_PER_USER. Превышение лимита отличается от прочих ошибок. */
export type SeatsCheck = { ok: true; seats: number } | { ok: false; code: 'VALIDATION_ERROR' | 'SEATS_LIMIT_EXCEEDED' };

export function checkSeats(value: unknown): SeatsCheck {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return { ok: false, code: 'VALIDATION_ERROR' };
  }
  if (value > MAX_SEATS_PER_USER) return { ok: false, code: 'SEATS_LIMIT_EXCEEDED' };
  return { ok: true, seats: value };
}
