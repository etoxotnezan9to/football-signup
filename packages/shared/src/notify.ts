// Чистая логика уведомлений: кого и о чём уведомлять при изменении состава (docs/spec.md, раздел «Уведомления»).

/** Ограничение VK на длину текста уведомления (notifications.sendMessage). */
export const NOTIFICATION_MAX_LENGTH = 254;
/** Напоминание уходит, когда до начала осталось не больше этого времени. */
export const REMINDER_LEAD_MIN = 24 * 60;
/** Если до начала осталось меньше, напоминание уже не отправляется. */
export const REMINDER_MIN_LEAD_MIN = 60;

/** Мои места в составе по пользователям: vkId → число мест в составе (нулевые не включаются). */
export type MainSeats = Record<number, number>;

export interface Promotion {
  userId: number;
  /** Сколько мест в составе добавилось */
  gained: number;
  /** Сколько мест в составе теперь */
  total: number;
}

/**
 * Кто получил места в составе между двумя снимками. Инициатор изменения (`actorId`) не уведомляется:
 * он и так видит результат своего действия.
 */
export function promotionsBetween(before: MainSeats, after: MainSeats, actorId?: number): Promotion[] {
  const result: Promotion[] = [];
  for (const [key, total] of Object.entries(after)) {
    const userId = Number(key);
    if (userId === actorId) continue;
    const gained = total - (before[userId] ?? 0);
    if (gained > 0) result.push({ userId, gained, total });
  }
  return result.sort((a, b) => a.userId - b.userId);
}

/** Группирует пользователей по значению (например, по числу мест), чтобы слать одно сообщение на группу. */
export function groupUsersBy(values: MainSeats): Map<number, number[]> {
  const groups = new Map<number, number[]>();
  for (const [key, value] of Object.entries(values)) {
    const list = groups.get(value) ?? [];
    list.push(Number(key));
    groups.set(value, list);
  }
  for (const list of groups.values()) list.sort((a, b) => a - b);
  return groups;
}

/**
 * Приводит текст к виду, который принимает VK: пробелы схлопнуты, длина не больше `max`.
 * Обрезка идёт по символам Unicode, чтобы не разорвать эмодзи.
 */
export function clipMessage(text: string, max: number = NOTIFICATION_MAX_LENGTH): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return Array.from(t).slice(0, max - 1).join('').trimEnd() + '…';
}
