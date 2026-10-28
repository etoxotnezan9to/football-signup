import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeRoster, queueOrder, resizeParts, rosterTotals, clampPaidSeats, type SignupInput } from '../src/index.ts';

let seq = 0;
function mk(userId: number, seats: number, minute: number): SignupInput {
  seq += 1;
  return { id: seq, userId, seats, createdAt: new Date(Date.UTC(2026, 0, 1, 12, minute)).toISOString() };
}

function split(rows: ReturnType<typeof computeRoster>, userId: number): [number, number] {
  const r = rows.find((x) => x.userId === userId);
  assert.ok(r, `нет записи ${userId}`);
  return [r.mainSeats, r.queueSeats];
}

const A = 1;
const B = 2;
const D = 3;

describe('computeRoster (примеры из docs/spec.md, раздел 11)', () => {
  it('1: пустая игра, A +3 → 3 в составе', () => {
    const rows = computeRoster(4, [mk(A, 3, 0)]);
    assert.deepEqual(split(rows, A), [3, 0]);
  });

  it('2: A:3, B +3 → B делится 1 + 2', () => {
    const rows = computeRoster(4, [mk(A, 3, 0), mk(B, 3, 1)]);
    assert.deepEqual(split(rows, A), [3, 0]);
    assert.deepEqual(split(rows, B), [1, 2]);
  });

  it('3: A отменяет → очередь B продвигается целиком', () => {
    const rows = computeRoster(4, [mk(B, 3, 1)]);
    assert.deepEqual(split(rows, B), [3, 0]);
  });

  it('4: A уменьшает до 1 → B полностью в составе', () => {
    const rows = computeRoster(4, [mk(A, 1, 0), mk(B, 3, 1)]);
    assert.deepEqual(split(rows, A), [1, 0]);
    assert.deepEqual(split(rows, B), [3, 0]);
  });

  it('5: A:2, B:2, D:1 в очереди; B отменяет → D в составе, свободно 1', () => {
    const before = computeRoster(4, [mk(A, 2, 0), mk(B, 2, 1), mk(D, 1, 2)]);
    assert.deepEqual(split(before, D), [0, 1]);
    const after = computeRoster(4, [mk(A, 2, 0), mk(D, 1, 2)]);
    assert.deepEqual(split(after, D), [1, 0]);
    assert.equal(rosterTotals(after).taken, 3);
  });

  it('6: D увеличивает до 3 при полном составе → всё в очереди', () => {
    const rows = computeRoster(4, [mk(A, 2, 0), mk(B, 2, 1), mk(D, 3, 2)]);
    assert.deepEqual(split(rows, D), [0, 3]);
  });

  it('7: A увеличивает запись — добавленные места встают в конец, B остаётся в составе', () => {
    const t = (minute: number) => new Date(Date.UTC(2026, 0, 1, 12, minute)).toISOString();
    const a: SignupInput = { id: 101, userId: A, seats: 5, createdAt: t(0), parts: [{ seats: 1, createdAt: t(0) }, { seats: 4, createdAt: t(5) }] };
    const b: SignupInput = { id: 102, userId: B, seats: 1, createdAt: t(1) };
    const rows = computeRoster(3, [a, b]);
    assert.deepEqual(split(rows, A), [2, 3]);
    assert.deepEqual(split(rows, B), [1, 0]);
  });

  it('8: вместимость уменьшена до 2', () => {
    const rows = computeRoster(2, [mk(A, 3, 0), mk(B, 2, 1)]);
    assert.deepEqual(split(rows, A), [2, 1]);
    assert.deepEqual(split(rows, B), [0, 2]);
  });

  it('9: вместимость увеличена до 8 → все в составе', () => {
    const rows = computeRoster(8, [mk(A, 3, 0), mk(B, 2, 1)]);
    assert.deepEqual(split(rows, A), [3, 0]);
    assert.deepEqual(split(rows, B), [2, 0]);
    assert.deepEqual(rosterTotals(rows), { taken: 5, queued: 0 });
  });

  it('11: удаление A при C=2 → B из очереди попадает в состав', () => {
    const rows = computeRoster(2, [mk(B, 1, 1)]);
    assert.deepEqual(split(rows, B), [1, 0]);
  });

  it('13: идемпотентность — повторный расчёт даёт тот же результат', () => {
    const input = [mk(A, 2, 0), mk(B, 3, 1)];
    assert.deepEqual(computeRoster(4, input), computeRoster(4, input));
  });

  it('14: paidSeats обрезается до seats', () => {
    assert.equal(clampPaidSeats(3, 2), 2);
    assert.equal(clampPaidSeats(-1, 2), 0);
    assert.equal(clampPaidSeats(1, 2), 1);
  });

  it('порядок: одинаковое время создания разрешается по id, вход не мутируется', () => {
    const s1 = mk(A, 2, 5);
    const s2 = mk(B, 2, 5);
    const input = [s2, s1];
    const rows = computeRoster(2, input);
    assert.equal(rows[0]?.userId, A);
    assert.deepEqual(split(rows, A), [2, 0]);
    assert.deepEqual(split(rows, B), [0, 2]);
    assert.equal(input[0], s2);
  });

  it('нулевая вместимость: все места в очереди', () => {
    const rows = computeRoster(0, [mk(A, 2, 0)]);
    assert.deepEqual(split(rows, A), [0, 2]);
  });
});

describe('части записи: добавленные места в конец состава и очереди', () => {
  const t = (minute: number) => new Date(Date.UTC(2026, 0, 1, 12, minute)).toISOString();

  it('увеличение в очереди встаёт за теми, кто уже ждёт', () => {
    // C=2: A:1 и B:1 в составе, D:1 в очереди; A добавляет 2 места — они за D
    const a: SignupInput = { id: 1, userId: A, seats: 3, createdAt: t(0), parts: [{ seats: 1, createdAt: t(0) }, { seats: 2, createdAt: t(9) }] };
    const b: SignupInput = { id: 2, userId: B, seats: 1, createdAt: t(1) };
    const d: SignupInput = { id: 3, userId: D, seats: 1, createdAt: t(2) };
    const rows = computeRoster(2, [a, b, d]);
    assert.deepEqual(split(rows, A), [1, 2]);
    assert.deepEqual(split(rows, B), [1, 0]);
    assert.deepEqual(split(rows, D), [0, 1]);
    // строки — по первой записи, очередь — по месту в очереди
    assert.deepEqual(rows.map((r) => r.userId), [A, B, D]);
    assert.deepEqual(queueOrder(rows).map((r) => r.userId), [D, A]);
    assert.equal(rows.find((r) => r.userId === D)?.queuePosition, 0);
    assert.equal(rows.find((r) => r.userId === A)?.queuePosition, 1);
  });

  it('освободившееся место достаётся тому, кто раньше в очереди, а не раньше записался', () => {
    // C=3: A:1, B:1, D:1 (t2); A добавила 1 (t5) — в очереди; B уходит → место получает A (её часть t5 первая в очереди)
    const a: SignupInput = { id: 1, userId: A, seats: 2, createdAt: t(0), parts: [{ seats: 1, createdAt: t(0) }, { seats: 1, createdAt: t(5) }] };
    const d: SignupInput = { id: 3, userId: D, seats: 2, createdAt: t(2), parts: [{ seats: 1, createdAt: t(2) }, { seats: 1, createdAt: t(7) }] };
    const rows = computeRoster(3, [a, d]);
    assert.deepEqual(split(rows, A), [2, 0]);
    assert.deepEqual(split(rows, D), [1, 1]);
  });

  it('resizeParts: увеличение — новая часть в конце, уменьшение — с последних частей', () => {
    const parts = [{ seats: 2, createdAt: t(0) }];
    const grown = resizeParts(parts, 5, t(3));
    assert.deepEqual(grown, [{ seats: 2, createdAt: t(0) }, { seats: 3, createdAt: t(3) }]);
    assert.deepEqual(resizeParts(grown, 3, t(4)), [{ seats: 2, createdAt: t(0) }, { seats: 1, createdAt: t(3) }]);
    assert.deepEqual(resizeParts(grown, 1, t(4)), [{ seats: 1, createdAt: t(0) }]);
    assert.deepEqual(resizeParts(grown, 5, t(4)), grown);
  });

  it('queueOrder без queuePosition сохраняет порядок записей', () => {
    const entries = [{ id: 1, queueSeats: 1 }, { id: 2, queueSeats: 0 }, { id: 3, queueSeats: 2 }];
    assert.deepEqual(queueOrder(entries).map((e) => e.id), [1, 3]);
  });
});
