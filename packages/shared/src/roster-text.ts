// Текстовый список для кнопки «Скопировать список» (docs/spec.md, раздел 10).

export interface TextGameInfo {
  title: string;
  /** Уже отформатированная дата и время, чтобы функция не зависела от часового пояса */
  whenLabel: string;
  venue: string;
  address: string;
  feeRub: number;
}

export interface TextRosterEntry {
  name: string;
  seats: number;
  mainSeats: number;
  queueSeats: number;
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

export function formatRosterText(game: TextGameInfo, entries: readonly TextRosterEntry[]): string {
  const lines: string[] = [
    game.title,
    `📅 ${game.whenLabel}`,
    `📍 ${game.venue}, ${game.address}`,
    `💰 Взнос ${game.feeRub}₽`,
    '',
    'Список:',
  ];

  let n = 1;
  for (const e of entries) {
    if (e.mainSeats <= 0) continue;
    const count = e.mainSeats > 1 ? ` (${e.mainSeats})` : '';
    lines.push(`${numberLabel(n, e.mainSeats)} ${e.name}${count}${paidLabel(e.paidSeats, e.seats)}`);
    n += e.mainSeats;
  }

  const queued = entries.filter((e) => e.queueSeats > 0);
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
