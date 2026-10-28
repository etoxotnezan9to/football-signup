// Расчёт состава и очереди. Чистые функции без зависимостей (docs/spec.md, раздел 4).

/** Часть мест записи: места, добавленные одним действием (запись или увеличение), со своим временем. */
export interface SignupPart {
  seats: number;
  createdAt: string;
}

export interface SignupInput {
  id: number;
  userId: number;
  seats: number;
  /** Время первой записи */
  createdAt: string;
  /** Части мест по порядку добавления; без них вся запись — одна часть со временем createdAt */
  parts?: readonly SignupPart[];
}

export interface RosterRow {
  signupId: number;
  userId: number;
  seats: number;
  /** Мест в составе */
  mainSeats: number;
  /** Мест в очереди */
  queueSeats: number;
  /** С какого места очереди (с 0) начинаются места записи в очереди; null — в очереди мест нет */
  queuePosition: number | null;
  createdAt: string;
}

export interface RosterTotals {
  taken: number;
  queued: number;
}

function compareSignups(a: SignupInput, b: SignupInput): number {
  const ta = Date.parse(a.createdAt);
  const tb = Date.parse(b.createdAt);
  if (ta !== tb) return ta - tb;
  return a.id - b.id;
}

/**
 * Места всех записей идут по времени добавления (части записей по createdAt, затем id записи, затем порядку частей).
 * Места заполняют состав по порядку, остаток уходит в очередь. Поэтому места, добавленные к записи позже,
 * встают в конец состава или очереди и никого не вытесняют. Внутри записи места всегда идут по порядку добавления:
 * первые mainSeats мест — в составе, остальные — в очереди.
 * Строки — в порядке первой записи (createdAt, id); порядок очереди — по queuePosition.
 */
export function computeRoster(capacity: number, signups: readonly SignupInput[]): RosterRow[] {
  const ordered = [...signups].sort(compareSignups);
  const rows = new Map<number, RosterRow>(
    ordered.map((s) => [
      s.id,
      {
        signupId: s.id,
        userId: s.userId,
        seats: s.seats,
        mainSeats: 0,
        queueSeats: 0,
        queuePosition: null,
        createdAt: s.createdAt,
      },
    ]),
  );
  const units = ordered.flatMap((s) =>
    (s.parts && s.parts.length > 0 ? s.parts : [{ seats: s.seats, createdAt: s.createdAt }]).map((p, index) => ({
      signupId: s.id,
      seats: p.seats,
      time: Date.parse(p.createdAt),
      index,
    })),
  );
  units.sort((a, b) => a.time - b.time || a.signupId - b.signupId || a.index - b.index);
  let free = Math.max(0, capacity);
  let queued = 0;
  for (const u of units) {
    const row = rows.get(u.signupId)!;
    const main = Math.min(u.seats, free);
    free -= main;
    row.mainSeats += main;
    const toQueue = u.seats - main;
    if (toQueue > 0) {
      row.queuePosition ??= queued;
      row.queueSeats += toQueue;
      queued += toQueue;
    }
  }
  return [...rows.values()];
}

/** Записи с местами в очереди в порядке очереди. */
export function queueOrder<T extends { queueSeats: number; queuePosition?: number | null }>(entries: readonly T[]): T[] {
  return entries
    .filter((e) => e.queueSeats > 0)
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.queuePosition ?? a.i) - (b.e.queuePosition ?? b.i) || a.i - b.i)
    .map(({ e }) => e);
}

/**
 * Части записи после изменения числа мест: увеличение добавляет новую часть со временем now (в конец),
 * уменьшение снимает места с последних частей (сначала самые поздние).
 */
export function resizeParts(parts: readonly SignupPart[], seats: number, now: string): SignupPart[] {
  const total = parts.reduce((sum, p) => sum + p.seats, 0);
  if (seats > total) return [...parts.map((p) => ({ ...p })), { seats: seats - total, createdAt: now }];
  const out: SignupPart[] = [];
  let left = seats;
  for (const p of parts) {
    if (left <= 0) break;
    const take = Math.min(p.seats, left);
    out.push({ seats: take, createdAt: p.createdAt });
    left -= take;
  }
  return out;
}

export function rosterTotals(rows: readonly RosterRow[]): RosterTotals {
  let taken = 0;
  let queued = 0;
  for (const r of rows) {
    taken += r.mainSeats;
    queued += r.queueSeats;
  }
  return { taken, queued };
}

/** Оплаченных мест не может быть больше, чем мест в записи. */
export function clampPaidSeats(paidSeats: number, seats: number): number {
  return Math.max(0, Math.min(paidSeats, seats));
}
