import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  dayKey,
  dayLabel,
  groupByDay,
  initialWeekStart,
  parseDayKey,
  startOfWeek,
  weekDays,
  weekRangeLabel,
} from '../src/week.ts';

/** Местное время: new Date(год, месяц-1, день, час). */
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const iso = (y: number, m: number, d: number, h = 0, min = 0) => local(y, m, d, h, min).toISOString();

describe('неделя', () => {
  it('начинается с понедельника, в том числе для воскресенья', () => {
    assert.equal(dayKey(startOfWeek(local(2026, 10, 27, 15))), '2026-10-26'); // вторник
    assert.equal(dayKey(startOfWeek(local(2026, 10, 26, 0))), '2026-10-26'); // понедельник
    assert.equal(dayKey(startOfWeek(local(2026, 11, 1, 23, 59))), '2026-10-26'); // воскресенье
  });

  it('семь дней через границу месяца', () => {
    assert.deepEqual(weekDays(local(2026, 10, 26)).map(dayKey), [
      '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01',
    ]);
  });

  it('ключ дня читается обратно, неверный ключ — null', () => {
    assert.equal(dayKey(parseDayKey('2026-10-26')!), '2026-10-26');
    assert.equal(parseDayKey('2026-02-30'), null);
    assert.equal(parseDayKey('мусор'), null);
  });

  it('сборы раскладываются по дням, внутри дня по времени', () => {
    const games = [
      { id: 1, startsAt: iso(2026, 10, 28, 21) },
      { id: 2, startsAt: iso(2026, 10, 28, 18) },
      { id: 3, startsAt: iso(2026, 10, 30, 10) },
    ];
    const byDay = groupByDay(games);
    assert.deepEqual(byDay.get('2026-10-28')?.map((g) => g.id), [2, 1]);
    assert.deepEqual(byDay.get('2026-10-30')?.map((g) => g.id), [3]);
    assert.equal(byDay.get('2026-10-29'), undefined);
  });

  it('при открытии: текущая неделя, а без предстоящих сборов в ней — неделя ближайшего', () => {
    const now = local(2026, 11, 1, 12); // воскресенье
    const tomorrow = { startsAt: iso(2026, 11, 2, 21), isFinished: false };
    const today = { startsAt: iso(2026, 11, 1, 19), isFinished: false };
    const past = { startsAt: iso(2026, 10, 27, 19), isFinished: true };
    assert.equal(dayKey(initialWeekStart([], now)), '2026-10-26');
    assert.equal(dayKey(initialWeekStart([today, tomorrow], now)), '2026-10-26');
    assert.equal(dayKey(initialWeekStart([past, tomorrow], now)), '2026-11-02');
    assert.equal(dayKey(initialWeekStart([past], now)), '2026-10-26');
  });

  it('подписи недели и дня', () => {
    const now = local(2026, 10, 27, 9);
    assert.equal(weekRangeLabel(local(2026, 10, 26), now), '26 октября – 1 ноября');
    assert.equal(weekRangeLabel(local(2026, 12, 28), now), '28 декабря – 3 января 2027 г.');
    assert.equal(dayLabel(local(2026, 10, 27), now), 'Вт, 27 октября · сегодня');
    assert.equal(dayLabel(local(2026, 10, 28), now), 'Ср, 28 октября · завтра');
    assert.equal(dayLabel(local(2026, 10, 30), now), 'Пт, 30 октября');
  });
});
