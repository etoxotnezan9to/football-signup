// Форматирование для интерфейса (чистые функции, тестируются без DOM).

export function plural(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

export const seatsLabel = (n: number): string => `${n} ${plural(n, ['место', 'места', 'мест'])}`;

export function formatWhen(iso: string, timeZone?: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  };
  return new Intl.DateTimeFormat('ru-RU', opts).format(new Date(iso));
}

/** Обозначение игры вместо названия: дата и время, затем название места. */
export function gameLabel(g: { startsAt: string; venue: string }, timeZone?: string): string {
  return `${formatWhen(g.startsAt, timeZone)} · ${g.venue}`;
}

/** Места, в которых есть игры из списка, для фильтра на главной: без повторов, по алфавиту. */
export function placeOptions(
  games: readonly { placeId: number; venue: string }[],
): { id: number; name: string }[] {
  const byId = new Map<number, string>();
  for (const g of games) byId.set(g.placeId, g.venue);
  return [...byId]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.id - b.id);
}

/** Значение для <input type="datetime-local"> из ISO (в локальном времени). */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO из значения <input type="datetime-local"> (локальное время браузера). Пустая строка — если дата неверна. */
export function fromLocalInput(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/**
 * Дата и время нового сбора при копировании: через неделю после копируемого, в тот же день недели и час.
 * Если и это уже прошло (копируют давний сбор), берётся ближайшая такая же дата в будущем.
 */
export function nextWeekOf(iso: string, now: Date): string {
  const d = new Date(iso);
  do {
    d.setDate(d.getDate() + 7);
  } while (d.getTime() <= now.getTime());
  return toLocalInput(d.toISOString());
}

export function fullName(u: { firstName: string; lastName: string }): string {
  return `${u.firstName} ${u.lastName}`.trim();
}

/** Имя для места записи в командах: само место — «Иван Петров», его друзья — «Иван Петров +1», «+2». */
export function seatName(u: { firstName: string; lastName: string }, seat: number): string {
  return seat <= 1 ? fullName(u) : `${fullName(u)} +${seat - 1}`;
}

/** Подпись состояния заполненности: «занято 18/24, в очереди 3». */
/** Формат игры для экрана игры: «до 4 команд по 6 игроков». */
export function teamsLabel(teamsMax: number, playersPerTeam: number): string {
  return `до ${teamsMax} ${plural(teamsMax, ['команды', 'команд', 'команд'])} по ${playersPerTeam} ${plural(playersPerTeam, ['игроку', 'игрока', 'игроков'])}`;
}

export function fillLabel(taken: number, capacity: number, queued: number): string {
  const base = `занято ${taken}/${capacity}`;
  return queued > 0 ? `${base}, в очереди ${queued}` : base;
}

/** Результат записи для тоста: «Вы записаны: 2 места в составе, 1 место в очереди». */
export function signupResultText(e: { mainSeats: number; queueSeats: number }): string {
  const parts: string[] = [];
  if (e.mainSeats > 0) parts.push(`${seatsLabel(e.mainSeats)} в составе`);
  if (e.queueSeats > 0) parts.push(`${seatsLabel(e.queueSeats)} в очереди`);
  return parts.length > 0 ? `Вы записаны: ${parts.join(', ')}` : 'Запись обновлена';
}

/** Начало новой игры по умолчанию: завтра в 21:00 по локальному времени (формат datetime-local). */
export function defaultStartsAt(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 21, 0, 0, 0);
  return toLocalInput(d.toISOString());
}

/**
 * Включены ли у пользователя уведомления приложения: параметр запуска `vk_are_notifications_enabled`
 * (подписан VK). Вне VK или без параметра возвращает null.
 */
export function notificationsEnabledFromSearch(search: string): boolean | null {
  const v = new URLSearchParams(search).get('vk_are_notifications_enabled');
  if (v === '1') return true;
  if (v === '0') return false;
  return null;
}

/** Ссылка на игру внутри VK: https://vk.com/app<ID>#/game/<id> */
export function gameLink(appId: number, gameId: number): string {
  return `https://vk.com/app${appId}#/game/${gameId}`;
}

export type Route =
  | { name: 'list' }
  | { name: 'my' }
  | { name: 'create' }
  | { name: 'game'; id: number }
  | { name: 'edit'; id: number };

/** Разбор hash: `#/`, `#/my`, `#/create`, `#/game/12`, `#/game/12/edit` (допускается и `#game/12`). */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'my') return { name: 'my' };
  if (parts[0] === 'create') return { name: 'create' };
  if (parts[0] === 'game' && /^\d+$/.test(parts[1] ?? '')) {
    const id = Number(parts[1]);
    return parts[2] === 'edit' ? { name: 'edit', id } : { name: 'game', id };
  }
  return { name: 'list' };
}

export function routeToHash(r: Route): string {
  switch (r.name) {
    case 'list':
      return '#/';
    case 'my':
      return '#/my';
    case 'create':
      return '#/create';
    case 'game':
      return `#/game/${r.id}`;
    case 'edit':
      return `#/game/${r.id}/edit`;
  }
}
