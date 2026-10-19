import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checkSeats,
  formatRosterText,
  numberLabel,
  parseGameInput,
  parseGameUpdate,
  MAX_SEATS_PER_USER,
} from '../src/index.ts';

describe('numberLabel', () => {
  it('одно место', () => assert.equal(numberLabel(10, 1), '10)'));
  it('2–3 места перечисляются', () => {
    assert.equal(numberLabel(7, 3), '7,8,9)');
    assert.equal(numberLabel(1, 2), '1,2)');
  });
  it('4 и более — диапазон', () => assert.equal(numberLabel(1, 6), '1-6)'));
});

describe('formatRosterText', () => {
  const game = {
    title: 'Футбол в четверг',
    whenLabel: 'чт, 22 октября, 21:00',
    venue: 'Ф.Ц. «Орловский»',
    address: 'Суздальское шоссе 62',
    feeRub: 650,
  };

  it('форматирует состав, оплату и очередь как в чате', () => {
    const text = formatRosterText(game, [
      { name: 'Артём Миронов', seats: 6, mainSeats: 6, queueSeats: 0, paidSeats: 6 },
      { name: 'Алексей Иванов', seats: 3, mainSeats: 3, queueSeats: 0, paidSeats: 2 },
      { name: 'Николай Лисовалов', seats: 1, mainSeats: 1, queueSeats: 0, paidSeats: 0 },
      { name: 'Григорий Захарьин', seats: 2, mainSeats: 1, queueSeats: 1, paidSeats: 0 },
      { name: 'Филипп Коркунов', seats: 2, mainSeats: 0, queueSeats: 2, paidSeats: 0 },
    ]);
    const lines = text.split('\n');
    assert.ok(lines.includes('1-6) Артём Миронов (6) ✅оплачено'));
    assert.ok(lines.includes('7,8,9) Алексей Иванов (3) ✅оплачено 2'));
    assert.ok(lines.includes('10) Николай Лисовалов'));
    assert.ok(lines.includes('11) Григорий Захарьин'));
    assert.ok(lines.includes('⚠ Мест нет! В очереди:'));
    assert.ok(lines.includes('1) Григорий Захарьин'));
    assert.ok(lines.includes('2,3) Филипп Коркунов (2)'));
    assert.equal(lines[0], 'Футбол в четверг');
  });

  it('без очереди блок «Мест нет» не выводится', () => {
    const text = formatRosterText(game, [{ name: 'Иван', seats: 1, mainSeats: 1, queueSeats: 0, paidSeats: 0 }]);
    assert.ok(!text.includes('Мест нет'));
  });
});

describe('checkSeats', () => {
  it('принимает 1..лимит', () => {
    assert.deepEqual(checkSeats(1), { ok: true, seats: 1 });
    assert.deepEqual(checkSeats(MAX_SEATS_PER_USER), { ok: true, seats: MAX_SEATS_PER_USER });
  });
  it('превышение лимита — отдельный код', () => {
    assert.deepEqual(checkSeats(MAX_SEATS_PER_USER + 1), { ok: false, code: 'SEATS_LIMIT_EXCEEDED' });
  });
  it('мусор — ошибка валидации', () => {
    for (const v of [0, -1, 1.5, '2', null, undefined, NaN]) {
      assert.deepEqual(checkSeats(v), { ok: false, code: 'VALIDATION_ERROR' }, String(v));
    }
  });
});

describe('parseGameInput / parseGameUpdate', () => {
  const valid = {
    title: ' Четверг ',
    startsAt: '2026-10-22T18:00:00.000Z',
    venue: 'Орловский',
    address: 'Суздальское шоссе 62',
    feeRub: 650,
    capacity: 24,
  };

  it('нормализует и подставляет значения по умолчанию', () => {
    const r = parseGameInput(valid);
    assert.ok(r.ok);
    assert.equal(r.value.title, 'Четверг');
    assert.equal(r.value.format, '');
    assert.equal(r.value.capacity, 24);
  });

  it('сообщает обо всех ошибках полей', () => {
    const r = parseGameInput({ title: '', capacity: 1, feeRub: -5 });
    assert.ok(!r.ok);
    for (const k of ['title', 'startsAt', 'venue', 'address', 'feeRub', 'capacity']) {
      assert.ok(k in r.errors, k);
    }
  });

  it('отвергает не-объект', () => {
    assert.ok(!parseGameInput(null).ok);
    assert.ok(!parseGameInput([]).ok);
  });

  it('обновление: пустое тело отвергается, подмножество принимается', () => {
    assert.ok(!parseGameUpdate({}).ok);
    const r = parseGameUpdate({ capacity: 10 });
    assert.ok(r.ok);
    assert.deepEqual(r.value, { capacity: 10 });
  });
});
