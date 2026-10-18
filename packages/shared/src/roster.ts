// Расчёт состава и очереди. Чистые функции без зависимостей (docs/spec.md, раздел 4).

export interface SignupInput {
  id: number;
  userId: number;
  seats: number;
  createdAt: string;
}

export interface RosterRow {
  signupId: number;
  userId: number;
  seats: number;
  /** Мест в составе */
  mainSeats: number;
  /** Мест в очереди */
  queueSeats: number;
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
 * Записи идут по порядку (createdAt, id). Каждая получает min(seats, свободно) мест
 * в составе, остаток уходит в очередь. Запись может быть разделена между составом и очередью.
 */
export function computeRoster(capacity: number, signups: readonly SignupInput[]): RosterRow[] {
  const ordered = [...signups].sort(compareSignups);
  let free = Math.max(0, capacity);
  return ordered.map((s) => {
    const mainSeats = Math.min(s.seats, free);
    free -= mainSeats;
    return {
      signupId: s.id,
      userId: s.userId,
      seats: s.seats,
      mainSeats,
      queueSeats: s.seats - mainSeats,
      createdAt: s.createdAt,
    };
  });
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
