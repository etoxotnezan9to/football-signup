// Главная по неделям: сборы раскладываются по дням недели (Пн–Вс) в местном времени браузера.

/** Ключ дня «2026-10-27» в местном времени. */
export function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Дата из ключа дня (полночь местного времени); null, если ключ неверный. */
export function parseDayKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return dayKey(d) === key ? d : null;
}

/** Понедельник недели, в которую попадает дата, в 00:00 местного времени. */
export function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const sinceMonday = (d.getDay() + 6) % 7; // getDay: 0 — воскресенье
  d.setDate(d.getDate() - sinceMonday);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

/** Семь дней недели начиная с понедельника. */
export function weekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** Сборы по дням: ключ дня → сборы этого дня по возрастанию времени. */
export function groupByDay<T extends { startsAt: string }>(games: readonly T[]): Map<string, T[]> {
  const byDay = new Map<string, T[]>();
  const sorted = [...games].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  for (const g of sorted) {
    const key = dayKey(new Date(g.startsAt));
    const list = byDay.get(key);
    if (list) list.push(g);
    else byDay.set(key, [g]);
  }
  return byDay;
}

/**
 * Неделя, которую показать при открытии: текущая, если в ней есть предстоящие сборы
 * (или предстоящих нет вовсе), иначе неделя ближайшего предстоящего сбора.
 */
export function initialWeekStart(games: readonly { startsAt: string; isFinished: boolean }[], now: Date): Date {
  const current = startOfWeek(now);
  const nextWeek = addDays(current, 7).getTime();
  const upcoming = games
    .filter((g) => !g.isFinished)
    .map((g) => Date.parse(g.startsAt))
    .sort((a, b) => a - b);
  const first = upcoming[0];
  if (first === undefined || first < nextWeek) return current;
  return startOfWeek(new Date(first));
}

/** «27 октября – 2 ноября»; если неделя не в текущем году, с годом у последнего дня. */
export function weekRangeLabel(weekStart: Date, now: Date): string {
  const end = addDays(weekStart, 6);
  const dm = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
  const sameYear = weekStart.getFullYear() === now.getFullYear() && end.getFullYear() === now.getFullYear();
  const last = sameYear
    ? dm.format(end)
    : new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(end);
  return `${dm.format(weekStart)} – ${last}`;
}

/** Заголовок дня: «Пн, 27 октября», с пометкой «сегодня» или «завтра». */
export function dayLabel(date: Date, now: Date): string {
  const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' }).format(date);
  const dm = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(date);
  const label = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${dm}`;
  const key = dayKey(date);
  if (key === dayKey(now)) return `${label} · сегодня`;
  if (key === dayKey(addDays(now, 1))) return `${label} · завтра`;
  return label;
}

/** Время сбора «19:00» для карточки внутри дня. */
export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}
