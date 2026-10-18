import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/db.ts';
import { createService, type Service } from '../src/service.ts';
import { AppError } from '../src/errors.ts';
import type { ServerEvent } from '@football/shared';

const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));

let clock = new Date('2026-10-20T10:00:00.000Z');
let events: ServerEvent[] = [];
let svc: Service;

const ORG = 100;
const U1 = 1;
const U2 = 2;
const U3 = 3;

function gameBody(over: Record<string, unknown> = {}) {
  return {
    title: 'Четверг',
    startsAt: '2026-10-22T18:00:00.000Z',
    venue: 'Орловский',
    address: 'Суздальское шоссе 62',
    feeRub: 650,
    capacity: 4,
    ...over,
  };
}

function expectCode(fn: () => unknown, code: string) {
  assert.throws(fn, (e: unknown) => e instanceof AppError && e.code === code, `ожидался ${code}`);
}

beforeEach(() => {
  clock = new Date('2026-10-20T10:00:00.000Z');
  events = [];
  const db = openDatabase(':memory:', MIGRATIONS);
  svc = createService(db, {
    now: () => {
      clock = new Date(clock.getTime() + 1000); // каждый вызов на секунду позже: порядок записей детерминирован
      return clock;
    },
    emit: (e) => events.push(e),
  });
  for (const id of [ORG, U1, U2, U3]) svc.upsertUser({ vkId: id, firstName: `Имя${id}`, lastName: `Фам${id}` });
});

describe('создание и список игр', () => {
  it('создаёт игру и рассылает game.created', () => {
    const g = svc.createGame(ORG, gameBody());
    assert.equal(g.organizer.vkId, ORG);
    assert.equal(g.taken, 0);
    assert.equal(g.status, 'active');
    assert.equal(events[0]?.type, 'game.created');
  });

  it('отвергает прошедшее время и неверные поля', () => {
    expectCode(() => svc.createGame(ORG, gameBody({ startsAt: '2026-10-19T18:00:00.000Z' })), 'STARTS_AT_IN_PAST');
    expectCode(() => svc.createGame(ORG, gameBody({ capacity: 1 })), 'VALIDATION_ERROR');
    expectCode(() => svc.createGame(ORG, null), 'VALIDATION_ERROR');
  });

  it('ограничивает число активных игр организатора', () => {
    for (let i = 0; i < 10; i++) svc.createGame(ORG, gameBody({ title: `Игра ${i}` }));
    expectCode(() => svc.createGame(ORG, gameBody()), 'ACTIVE_GAMES_LIMIT');
    svc.createGame(U1, gameBody()); // у другого организатора лимит свой
  });

  it('список: по возрастанию времени, пагинация, mySeats', () => {
    svc.createGame(ORG, gameBody({ title: 'Поздняя', startsAt: '2026-10-25T18:00:00.000Z' }));
    const early = svc.createGame(ORG, gameBody({ title: 'Ранняя', startsAt: '2026-10-21T18:00:00.000Z' }));
    svc.putSignup(early.id, U1, 2);
    const page1 = svc.listGames(U1, { limit: 1 });
    assert.equal(page1.items.length, 1);
    assert.equal(page1.items[0]?.title, 'Ранняя');
    assert.equal(page1.items[0]?.mySeats, 2);
    assert.equal(page1.nextCursor, '1');
    const page2 = svc.listGames(U1, { limit: 1, cursor: page1.nextCursor! });
    assert.equal(page2.items[0]?.title, 'Поздняя');
    assert.equal(page2.items[0]?.mySeats, 0);
    assert.equal(page2.nextCursor, null);
  });

  it('завершённые и отменённые игры не попадают в список', () => {
    const g = svc.createGame(ORG, gameBody());
    svc.cancelGame(g.id, ORG);
    assert.equal(svc.listGames(U1).items.length, 0);
  });
});

describe('запись на игру', () => {
  it('пример 2: A +3, B +3 при 4 местах → B делится 1 + 2', () => {
    const g = svc.createGame(ORG, gameBody());
    svc.putSignup(g.id, U1, 3);
    const r = svc.putSignup(g.id, U2, 3);
    assert.equal(r.signup.mainSeats, 1);
    assert.equal(r.signup.queueSeats, 2);
    assert.equal(r.game.taken, 4);
    assert.equal(r.game.queued, 2);
  });

  it('пример 3: отмена A продвигает очередь', () => {
    const g = svc.createGame(ORG, gameBody());
    svc.putSignup(g.id, U1, 3);
    svc.putSignup(g.id, U2, 3);
    const after = svc.deleteSignup(g.id, U1);
    assert.equal(after.queued, 0);
    assert.equal(after.roster[0]?.mainSeats, 3);
  });

  it('пример 4: уменьшение мест освобождает их очереди', () => {
    const g = svc.createGame(ORG, gameBody());
    svc.putSignup(g.id, U1, 3);
    svc.putSignup(g.id, U2, 3);
    const r = svc.putSignup(g.id, U1, 1);
    assert.equal(r.game.queued, 0);
    assert.equal(r.game.taken, 4);
  });

  it('пример 13: повторная запись с тем же числом идемпотентна и не меняет порядок', () => {
    const g = svc.createGame(ORG, gameBody());
    svc.putSignup(g.id, U1, 2);
    svc.putSignup(g.id, U2, 2);
    const first = svc.getGame(g.id, U1);
    const again = svc.putSignup(g.id, U1, 2);
    assert.deepEqual(
      again.game.roster.map((e) => [e.user.vkId, e.mainSeats, e.queueSeats]),
      first.roster.map((e) => [e.user.vkId, e.mainSeats, e.queueSeats]),
    );
    assert.equal(again.game.roster[0]?.user.vkId, U1);
  });

  it('пример 10: лимит 5 мест, состояние не меняется', () => {
    const g = svc.createGame(ORG, gameBody({ capacity: 10 }));
    svc.putSignup(g.id, U1, 1);
    expectCode(() => svc.putSignup(g.id, U1, 6), 'SEATS_LIMIT_EXCEEDED');
    assert.equal(svc.getGame(g.id, U1).roster[0]?.seats, 1);
    svc.putSignup(g.id, U1, 5); // ровно лимит допустим
    expectCode(() => svc.putSignup(g.id, U1, 0), 'VALIDATION_ERROR');
    expectCode(() => svc.putSignup(g.id, U1, 'x'), 'VALIDATION_ERROR');
  });

  it('пример 12: в отменённую игру записаться нельзя', () => {
    const g = svc.createGame(ORG, gameBody());
    svc.putSignup(g.id, U1, 1);
    svc.cancelGame(g.id, ORG);
    expectCode(() => svc.putSignup(g.id, U2, 1), 'GAME_NOT_ACTIVE');
    expectCode(() => svc.deleteSignup(g.id, U1), 'GAME_NOT_ACTIVE');
  });

  it('после начала игры + запас запись закрывается', () => {
    const g = svc.createGame(ORG, gameBody());
    clock = new Date('2026-10-23T00:00:00.000Z');
    expectCode(() => svc.putSignup(g.id, U1, 1), 'GAME_NOT_ACTIVE');
    assert.equal(svc.getGame(g.id, U1).isFinished, true);
  });

  it('удаление несуществующей записи и запись в несуществующую игру', () => {
    const g = svc.createGame(ORG, gameBody());
    expectCode(() => svc.deleteSignup(g.id, U1), 'NOT_FOUND');
    expectCode(() => svc.putSignup(9999, U1, 1), 'NOT_FOUND');
  });

  it('последовательные записи никогда не превышают вместимость состава', () => {
    const g = svc.createGame(ORG, gameBody({ capacity: 7 }));
    const users = [U1, U2, U3, ORG];
    for (let i = 0; i < 40; i++) {
      const u = users[i % users.length]!;
      svc.putSignup(g.id, u, (i % 5) + 1);
      const cur = svc.getGame(g.id, u);
      assert.ok(cur.taken <= 7, `занято ${cur.taken} > 7`);
      assert.equal(
        cur.roster.reduce((a, e) => a + e.mainSeats, 0),
        cur.taken,
      );
    }
  });

  it('рассылает game.updated и roster.updated после записи', () => {
    const g = svc.createGame(ORG, gameBody());
    events = [];
    svc.putSignup(g.id, U1, 2);
    assert.deepEqual(
      events.map((e) => e.type),
      ['game.updated', 'roster.updated'],
    );
    const ev = events[1];
    assert.ok(ev && ev.type === 'roster.updated');
    assert.equal(ev.game.roster.length, 1);
    assert.equal('mySeats' in ev.game, false);
  });
});

describe('функции организатора', () => {
  it('только организатор редактирует, отменяет, отмечает оплату и удаляет', () => {
    const g = svc.createGame(ORG, gameBody());
    const s = svc.putSignup(g.id, U1, 2).signup;
    expectCode(() => svc.updateGame(g.id, U1, { title: 'x' }), 'FORBIDDEN');
    expectCode(() => svc.cancelGame(g.id, U1), 'FORBIDDEN');
    expectCode(() => svc.setPaid(g.id, U1, s.signupId, 1), 'FORBIDDEN');
    expectCode(() => svc.removeSignup(g.id, U1, s.signupId), 'FORBIDDEN');
  });

  it('оплата: проверка границ и пример 14 (обрезка при уменьшении мест)', () => {
    const g = svc.createGame(ORG, gameBody({ capacity: 10 }));
    const s = svc.putSignup(g.id, U1, 3).signup;
    expectCode(() => svc.setPaid(g.id, ORG, s.signupId, 4), 'VALIDATION_ERROR');
    expectCode(() => svc.setPaid(g.id, ORG, s.signupId, -1), 'VALIDATION_ERROR');
    expectCode(() => svc.setPaid(g.id, ORG, 9999, 1), 'NOT_FOUND');
    const paid = svc.setPaid(g.id, ORG, s.signupId, 3);
    assert.equal(paid.roster[0]?.paidSeats, 3);
    const reduced = svc.putSignup(g.id, U1, 2);
    assert.equal(reduced.signup.paidSeats, 2);
  });

  it('пример 11: удаление участника продвигает очередь', () => {
    const g = svc.createGame(ORG, gameBody({ capacity: 2 }));
    const a = svc.putSignup(g.id, U1, 2).signup;
    svc.putSignup(g.id, U2, 1);
    const after = svc.removeSignup(g.id, ORG, a.signupId);
    assert.equal(after.roster.length, 1);
    assert.equal(after.roster[0]?.mainSeats, 1);
    assert.equal(after.queued, 0);
  });

  it('пример 8 и 9: изменение вместимости пересчитывает состав', () => {
    const g = svc.createGame(ORG, gameBody({ capacity: 4 }));
    svc.putSignup(g.id, U1, 3);
    svc.putSignup(g.id, U2, 2);
    const smaller = svc.updateGame(g.id, ORG, { capacity: 2 });
    assert.deepEqual(
      smaller.roster.map((e) => [e.mainSeats, e.queueSeats]),
      [
        [2, 1],
        [0, 2],
      ],
    );
    const bigger = svc.updateGame(g.id, ORG, { capacity: 8 });
    assert.equal(bigger.queued, 0);
    assert.equal(bigger.taken, 5);
  });

  it('нельзя редактировать отменённую игру и ставить время в прошлое', () => {
    const g = svc.createGame(ORG, gameBody());
    expectCode(() => svc.updateGame(g.id, ORG, { startsAt: '2026-10-01T10:00:00.000Z' }), 'STARTS_AT_IN_PAST');
    expectCode(() => svc.updateGame(g.id, ORG, {}), 'VALIDATION_ERROR');
    svc.cancelGame(g.id, ORG);
    expectCode(() => svc.updateGame(g.id, ORG, { title: 'новое' }), 'GAME_NOT_ACTIVE');
  });

  it('организатор может записаться на свою игру', () => {
    const g = svc.createGame(ORG, gameBody());
    const r = svc.putSignup(g.id, ORG, 1);
    assert.equal(r.game.mySeats, 1);
  });
});

describe('мои игры', () => {
  it('разделяет созданные и те, куда я записан', () => {
    const mine = svc.createGame(U1, gameBody({ title: 'Моя' }));
    const other = svc.createGame(ORG, gameBody({ title: 'Чужая' }));
    svc.putSignup(other.id, U1, 1);
    const my = svc.myGames(U1);
    assert.deepEqual(my.organized.map((g) => g.id), [mine.id]);
    assert.deepEqual(my.joined.map((g) => g.id), [other.id]);
  });
});

describe('профиль', () => {
  it('фамилия необязательна, имя обязательно, фото только по https', () => {
    assert.equal(svc.updateProfile(U1, { firstName: 'Иван' }).lastName, '');
    expectCode(() => svc.updateProfile(U1, { firstName: '' }), 'VALIDATION_ERROR');
    expectCode(() => svc.updateProfile(U1, { firstName: 'И', photoUrl: 'javascript:alert(1)' }), 'VALIDATION_ERROR');
    const ok = svc.updateProfile(U1, { firstName: 'Иван', lastName: 'Петров', photoUrl: 'https://example.com/a.jpg' });
    assert.equal(ok.photoUrl, 'https://example.com/a.jpg');
  });
});
