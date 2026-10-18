import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeRoster, rosterTotals, clampPaidSeats, type SignupInput } from '../src/index.ts';

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

  it('7: C=3, A:1 и B:1; A увеличивает до 5 → A 3+2, B в очереди', () => {
    const rows = computeRoster(3, [mk(A, 5, 0), mk(B, 1, 1)]);
    assert.deepEqual(split(rows, A), [3, 2]);
    assert.deepEqual(split(rows, B), [0, 1]);
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
