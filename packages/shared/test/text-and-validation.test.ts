import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  capacityError,
  checkSeats,
  gameCapacity,
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
    teamsMax: 4,
    playersPerTeam: 6,
    feeRub: 650,
  };

  it('нормализует и подставляет значения по умолчанию', () => {
    const r = parseGameInput(valid);
    assert.ok(r.ok);
    assert.equal(r.value.placeId, 1);
    assert.equal(r.value.teamsMax, 4);
    assert.equal(r.value.playersPerTeam, 6);
    assert.equal(r.value.meetings, 2, 'встреч по умолчанию 2');
    assert.equal(r.value.description, '');
    assert.ok(!('capacity' in r.value), 'вместимость не задаётся во входных данных');
  });

  it('сообщает обо всех ошибках полей', () => {
    const r = parseGameInput({ teamsMax: 1, feeRub: -5 });
    assert.ok(!r.ok);
    for (const k of ['startsAt', 'placeId', 'teamsMax', 'playersPerTeam', 'feeRub']) {
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
    assert.ok(!parseGameUpdate({ capacity: 10 }).ok, 'capacity больше не принимается');
    const r = parseGameUpdate({ teamsMax: 5 });
    assert.ok(r.ok);
    assert.deepEqual(r.value, { teamsMax: 5 });
  });
});

describe('meetings', () => {
  const valid = { startsAt: '2026-10-22T18:00:00.000Z', placeId: 1, teamsMax: 4, playersPerTeam: 6, feeRub: 0 };

  it('1..10, по умолчанию 2', () => {
    const one = parseGameInput({ ...valid, meetings: 1 });
    assert.ok(one.ok && one.value.meetings === 1);
    assert.ok(parseGameInput({ ...valid, meetings: 10 }).ok);
    for (const v of [0, 11, 1.5, '2', null]) {
      const r = parseGameInput({ ...valid, meetings: v });
      assert.ok(!r.ok && r.errors.meetings === 'целое число от 1 до 10', String(v));
    }
    const u = parseGameUpdate({ meetings: 3 });
    assert.ok(u.ok);
    assert.deepEqual(u.value, { meetings: 3 });
  });
});

describe('teamsMax / playersPerTeam', () => {
  const valid = { startsAt: '2026-10-22T18:00:00.000Z', placeId: 1, feeRub: 0 };

  it('обязательны и принимают границы диапазона', () => {
    const r = parseGameInput({ ...valid, teamsMax: 3, playersPerTeam: 6 });
    assert.ok(r.ok);
    assert.equal(gameCapacity(r.value.teamsMax, r.value.playersPerTeam), 18);
    assert.ok(parseGameInput({ ...valid, teamsMax: 2, playersPerTeam: 1 }).ok);
    assert.ok(parseGameInput({ ...valid, teamsMax: 5, playersPerTeam: 11 }).ok);
    const missing = parseGameInput(valid);
    assert.ok(!missing.ok && missing.errors.teamsMax === 'обязательное поле');
    assert.ok(!missing.ok && missing.errors.playersPerTeam === 'обязательное поле');
  });

  it('вне диапазона, не целые и null отвергаются', () => {
    for (const v of [1, 11, 2.5, '3', null]) {
      const r = parseGameInput({ ...valid, teamsMax: v, playersPerTeam: 6 });
      assert.ok(!r.ok && r.errors.teamsMax === 'целое число от 2 до 10', String(v));
    }
    for (const v of [0, 12, NaN, null]) {
      const r = parseGameInput({ ...valid, teamsMax: 4, playersPerTeam: v });
      assert.ok(!r.ok && r.errors.playersPerTeam === 'целое число от 1 до 11', String(v));
    }
  });

  it('произведение не больше MAX_CAPACITY', () => {
    assert.ok(parseGameInput({ ...valid, teamsMax: 10, playersPerTeam: 6 }).ok);
    const r = parseGameInput({ ...valid, teamsMax: 10, playersPerTeam: 7 });
    assert.ok(!r.ok && r.errors.playersPerTeam === 'команд × игроков — не больше 60 мест');
    assert.equal(capacityError(6, 10), null);
    assert.ok(!parseGameUpdate({ teamsMax: 10, playersPerTeam: 11 }).ok);
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
