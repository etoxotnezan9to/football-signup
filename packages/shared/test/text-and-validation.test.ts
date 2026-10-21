import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checkSeats,
  formatRosterText,
  numberLabel,
  parseGameInput,
  parseGameUpdate,
  parsePlaceInput,
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
    assert.equal(lines[0], '📅 чт, 22 октября, 21:00');
  });

  it('без очереди блок «Мест нет» не выводится', () => {
    const text = formatRosterText(game, [
      { name: 'Иван', seats: 1, mainSeats: 1, queueSeats: 0, paidSeats: 0 },
    ]);
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
    startsAt: '2026-10-22T18:00:00.000Z',
    placeId: 1,
    feeRub: 650,
    capacity: 24,
  };

  it('нормализует и подставляет значения по умолчанию', () => {
    const r = parseGameInput(valid);
    assert.ok(r.ok);
    assert.equal(r.value.placeId, 1);
    assert.equal(r.value.teamsMax, null);
    assert.equal(r.value.playersPerTeam, null);
    assert.equal(r.value.capacity, 24);
  });

  it('сообщает обо всех ошибках полей', () => {
    const r = parseGameInput({ capacity: 1, feeRub: -5 });
    assert.ok(!r.ok);
    for (const k of ['startsAt', 'placeId', 'feeRub', 'capacity']) {
      assert.ok(k in r.errors, k);
    }
  });

  it('отвергает не-объект', () => {
    assert.ok(!parseGameInput(null).ok);
    assert.ok(!parseGameInput([]).ok);
  });

  it('placeId: только положительное целое', () => {
    for (const v of [0, -1, 1.5, '1', null]) {
      const r = parseGameInput({ ...valid, placeId: v });
      assert.ok(!r.ok && r.errors.placeId === 'выберите место', String(v));
    }
    const r = parseGameUpdate({ placeId: 3 });
    assert.ok(r.ok);
    assert.deepEqual(r.value, { placeId: 3 });
  });

  it('обновление: пустое тело отвергается, подмножество принимается', () => {
    assert.ok(!parseGameUpdate({}).ok);
    const r = parseGameUpdate({ capacity: 10 });
    assert.ok(r.ok);
    assert.deepEqual(r.value, { capacity: 10 });
  });
});

describe('teamsMax / playersPerTeam', () => {
  const valid = { startsAt: '2026-10-22T18:00:00.000Z', placeId: 1, feeRub: 0, capacity: 18 };

  it('необязательны и принимают границы диапазона', () => {
    const r = parseGameInput({ ...valid, teamsMax: 3, playersPerTeam: 6 });
    assert.ok(r.ok);
    assert.equal(r.value.teamsMax, 3);
    assert.equal(r.value.playersPerTeam, 6);
    assert.ok(parseGameInput({ ...valid, teamsMax: 2, playersPerTeam: 11 }).ok);
    assert.ok(parseGameInput({ ...valid, teamsMax: 10, playersPerTeam: 2 }).ok);
  });

  it('вне диапазона и не целые отвергаются', () => {
    for (const v of [1, 11, 2.5, '3']) {
      const r = parseGameInput({ ...valid, teamsMax: v });
      assert.ok(!r.ok && r.errors.teamsMax === 'целое число от 2 до 10', String(v));
    }
    for (const v of [1, 12, NaN]) {
      const r = parseGameInput({ ...valid, playersPerTeam: v });
      assert.ok(!r.ok && r.errors.playersPerTeam === 'целое число от 2 до 11', String(v));
    }
  });

  it('null в обновлении очищает значение', () => {
    const r = parseGameUpdate({ teamsMax: null, playersPerTeam: 5 });
    assert.ok(r.ok);
    assert.deepEqual(r.value, { teamsMax: null, playersPerTeam: 5 });
  });
});

describe('parsePlaceInput', () => {
  it('обрезает пробелы и требует оба поля', () => {
    const r = parsePlaceInput({ name: ' Ф.Ц. «Орловский» ', address: 'Суздальское шоссе 62 ' });
    assert.ok(r.ok);
    assert.deepEqual(r.value, { name: 'Ф.Ц. «Орловский»', address: 'Суздальское шоссе 62' });
    const bad = parsePlaceInput({ name: '  ' });
    assert.ok(!bad.ok);
    assert.ok('name' in bad.errors && 'address' in bad.errors);
    assert.ok(!parsePlaceInput('x').ok);
  });

  it('ограничивает длину', () => {
    const r = parsePlaceInput({ name: 'x'.repeat(81), address: 'y'.repeat(161) });
    assert.ok(!r.ok);
    assert.equal(r.errors.name, 'длина от 1 до 80');
    assert.equal(r.errors.address, 'длина от 1 до 160');
  });
});
