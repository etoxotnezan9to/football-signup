// Текстовый список для кнопки «Скопировать список» (docs/spec.md, раздел 10).
import { queueOrder } from './roster.ts';

export interface TextGameInfo {
  /** Уже отформатированная дата и время, чтобы функция не зависела от часового пояса */
  whenLabel: string;
  venue: string;
  address: string;
  feeRub: number;
  /** «Игра отменена» или «Игра прошла»; нет — сбор актуален */
  statusLabel?: string;
  /** Формат: «до 4 команд по 6 игроков, 2 встречи» */
  formatLabel?: string;
  organizerName?: string;
  organizerContact?: string;
  paymentInfo?: string;
  /** Описание как ввели, с переносами строк */
  description?: string;
  /** Заполненность: «занято 18/24, в очереди 3» */
  fillLabel?: string;
}

export interface TextRosterEntry {
  name: string;
  seats: number;
  mainSeats: number;
  queueSeats: number;
  /** Место в очереди (с 0), по нему упорядочена очередь; без него — порядок записей */
  queuePosition?: number | null;
  paidSeats: number;
}

/** Нумерация места или диапазона: `5)`, `7,8,9)` или `1-6)`. */
export function numberLabel(start: number, count: number): string {
  if (count <= 1) return `${start})`;
  if (count <= 3) {
    const nums: number[] = [];
    for (let i = 0; i < count; i++) nums.push(start + i);
    return `${nums.join(',')})`;
  }
  return `${start}-${start + count - 1})`;
}

function paidLabel(paidSeats: number, seats: number): string {
  if (paidSeats >= seats && seats > 0) return ' ✅оплачено';
  if (paidSeats > 0) return ` ✅оплачено ${paidSeats}`;
  return '';
}

/** Начинается ли текст с картинки-эмодзи (включая флаги из региональных индикаторов). */
export function startsWithEmoji(text: string): boolean {
  return /^(\p{Extended_Pictographic}|\p{Regional_Indicator})/u.test(text);
}

/**
 * Вся информация о сборе для чата: сведения (те же значки, что на экране сбора; пустые поля пропускаются),
 * затем состав и очередь.
 */
export function formatRosterText(game: TextGameInfo, entries: readonly TextRosterEntry[]): string {
  const lines: string[] = [];
  if (game.statusLabel) lines.push(`⚠ ${game.statusLabel}`);
  lines.push(`📅 ${game.whenLabel}`, `📍 ${game.venue}, ${game.address}`);
  if (game.formatLabel) lines.push(`⚽ ${game.formatLabel}`);
  lines.push(`💰 Взнос ${game.feeRub}₽`);
  if (game.organizerName) {
    const contact = game.organizerContact?.trim() ? `, ${game.organizerContact.trim()}` : '';
    lines.push(`🕺 Организатор: ${game.organizerName}${contact}`);
  }
  if (game.paymentInfo?.trim()) lines.push(`❗ Предоплата: ${game.paymentInfo.trim()}`);
  const description = game.description?.trim();
  // описание, которое уже начинается с картинки (эмодзи), не получает свой значок 📝
  if (description) lines.push(startsWithEmoji(description) ? description : `📝 ${description}`);
  if (game.fillLabel) lines.push(`👥 ${game.fillLabel[0]!.toUpperCase()}${game.fillLabel.slice(1)}`);
  lines.push('', 'Список:');

  let n = 1;
  for (const e of entries) {
    if (e.mainSeats <= 0) continue;
    const count = e.mainSeats > 1 ? ` (${e.mainSeats})` : '';
    lines.push(`${numberLabel(n, e.mainSeats)} ${e.name}${count}${paidLabel(e.paidSeats, e.seats)}`);
    n += e.mainSeats;
  }

  const queued = queueOrder(entries);
  if (queued.length > 0) {
    lines.push('', '⚠ Мест нет! В очереди:');
    let q = 1;
    for (const e of queued) {
      const count = e.queueSeats > 1 ? ` (${e.queueSeats})` : '';
      lines.push(`${numberLabel(q, e.queueSeats)} ${e.name}${count}`);
      q += e.queueSeats;
    }
  }

  return lines.join('\n');
}
