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
let PLACE = 0;

function gameBody(over: Record<string, unknown> = {}) {
  return {
    startsAt: '2026-10-22T18:00:00.000Z',
    placeId: PLACE,
    feeRub: 650,
    teamsMax: 2, playersPerTeam: 2,
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
  for (const id of [ORG, U1, U2, U3])
    svc.upsertUser({ vkId: id, firstName: `Имя${id}`, lastName: `Фам${id}` });
  PLACE = svc.createPlace(ORG, { name: 'Орловский', address: 'Суздальское шоссе 62' }).place.id;
});

describe('создание и список игр', () => {
  it('создаёт игру и рассылает game.created', () => {
    const g = svc.createGame(ORG, gameBody());
    assert.equal(g.organizer.vkId, ORG);
    assert.equal(g.taken, 0);
    assert.equal(g.status, 'active');
    assert.equal(events[0]?.type, 'game.created');
  });

  it('вместимость = команды × игроки в команде, пересчитывается при изменении любого из них', () => {
    const g = svc.createGame(ORG, gameBody({ teamsMax: 3, playersPerTeam: 6, capacity: 99 }));
    assert.equal(g.teamsMax, 3);
    assert.equal(g.playersPerTeam, 6);
    assert.equal(g.capacity, 18, 'переданная capacity игнорируется');
    assert.equal(svc.updateGame(g.id, ORG, { playersPerTeam: 7 }).capacity, 21);
    assert.equal(svc.updateGame(g.id, ORG, { teamsMax: 2 }).capacity, 14);
    expectCode(() => svc.createGame(ORG, gameBody({ teamsMax: undefined })), 'VALIDATION_ERROR');
    expectCode(() => svc.updateGame(g.id, ORG, { teamsMax: 11 }), 'VALIDATION_ERROR');
    // по отдельности допустимо, но 10 × 7 = 70 больше 60 мест
    assert.throws(
      () => svc.updateGame(g.id, ORG, { teamsMax: 10 }),
      (e: unknown) => e instanceof AppError && e.code === 'VALIDATION_ERROR' && 'playersPerTeam' in (e.details ?? {}),
    );
    assert.equal(svc.getGame(g.id, ORG).capacity, 14);
  });

  it('отвергает прошедшее время и неверные поля', () => {
    expectCode(
      () => svc.createGame(ORG, gameBody({ startsAt: '2026-10-19T18:00:00.000Z' })),
      'STARTS_AT_IN_PAST',
    );
    expectCode(() => svc.createGame(ORG, gameBody({ teamsMax: 1 })), 'VALIDATION_ERROR');
    expectCode(() => svc.createGame(ORG, null), 'VALIDATION_ERROR');
  });

  it('ограничивает число активных игр организатора', () => {
    for (let i = 0; i < 10; i++) svc.createGame(ORG, gameBody());
    expectCode(() => svc.createGame(ORG, gameBody()), 'ACTIVE_GAMES_LIMIT');
    svc.createGame(U1, gameBody()); // у другого организатора лимит свой
  });

  it('список: по возрастанию времени, пагинация, mySeats', () => {
    const late = svc.createGame(ORG, gameBody({ startsAt: '2026-10-25T18:00:00.000Z' }));
    const early = svc.createGame(ORG, gameBody({ startsAt: '2026-10-21T18:00:00.000Z' }));
    svc.putSignup(early.id, U1, 2);
    const page1 = svc.listGames(U1, { limit: 1 });
    assert.equal(page1.items.length, 1);
    assert.equal(page1.items[0]?.id, early.id);
    assert.equal(page1.items[0]?.mySeats, 2);
    assert.equal(page1.nextCursor, '1');
    const page2 = svc.listGames(U1, { limit: 1, cursor: page1.nextCursor! });
    assert.equal(page2.items[0]?.id, late.id);
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
    const g = svc.createGame(ORG, gameBody({ teamsMax: 5, playersPerTeam: 2 }));
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
    const g = svc.createGame(ORG, gameBody({ teamsMax: 7, playersPerTeam: 1 }));
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
    expectCode(() => svc.updateGame(g.id, U1, { teamsMax: 5, playersPerTeam: 2 }), 'FORBIDDEN');
    expectCode(() => svc.cancelGame(g.id, U1), 'FORBIDDEN');
    expectCode(() => svc.setPaid(g.id, U1, s.signupId, 1), 'FORBIDDEN');
    expectCode(() => svc.removeSignup(g.id, U1, s.signupId), 'FORBIDDEN');
  });

  it('оплата: проверка границ и пример 14 (обрезка при уменьшении мест)', () => {
    const g = svc.createGame(ORG, gameBody({ teamsMax: 5, playersPerTeam: 2 }));
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
    const g = svc.createGame(ORG, gameBody({ teamsMax: 2, playersPerTeam: 1 }));
    const a = svc.putSignup(g.id, U1, 2).signup;
    svc.putSignup(g.id, U2, 1);
    const after = svc.removeSignup(g.id, ORG, a.signupId);
    assert.equal(after.roster.length, 1);
    assert.equal(after.roster[0]?.mainSeats, 1);
    assert.equal(after.queued, 0);
  });

  it('пример 8 и 9: изменение вместимости пересчитывает состав', () => {
    const g = svc.createGame(ORG, gameBody({ teamsMax: 2, playersPerTeam: 2 }));
    svc.putSignup(g.id, U1, 3);
    svc.putSignup(g.id, U2, 2);
    const smaller = svc.updateGame(g.id, ORG, { teamsMax: 2, playersPerTeam: 1 });
    assert.deepEqual(
      smaller.roster.map((e) => [e.mainSeats, e.queueSeats]),
      [
        [2, 1],
        [0, 2],
      ],
    );
    const bigger = svc.updateGame(g.id, ORG, { teamsMax: 4, playersPerTeam: 2 });
    assert.equal(bigger.queued, 0);
    assert.equal(bigger.taken, 5);
  });

  it('нельзя редактировать отменённую игру и ставить время в прошлое', () => {
    const g = svc.createGame(ORG, gameBody());
    expectCode(
      () => svc.updateGame(g.id, ORG, { startsAt: '2026-10-01T10:00:00.000Z' }),
      'STARTS_AT_IN_PAST',
    );
    expectCode(() => svc.updateGame(g.id, ORG, {}), 'VALIDATION_ERROR');
    svc.cancelGame(g.id, ORG);
    expectCode(() => svc.updateGame(g.id, ORG, { teamsMax: 5, playersPerTeam: 2 }), 'GAME_NOT_ACTIVE');
  });

  it('организатор может записаться на свою игру', () => {
    const g = svc.createGame(ORG, gameBody());
    const r = svc.putSignup(g.id, ORG, 1);
    assert.equal(r.game.mySeats, 1);
  });
});

describe('мои игры', () => {
  it('разделяет созданные и те, куда я записан', () => {
    const mine = svc.createGame(U1, gameBody());
    const other = svc.createGame(ORG, gameBody());
    svc.putSignup(other.id, U1, 1);
    const my = svc.myGames(U1);
    assert.deepEqual(
      my.organized.map((g) => g.id),
      [mine.id],
    );
    assert.deepEqual(
      my.joined.map((g) => g.id),
      [other.id],
    );
  });
});

describe('профиль', () => {
  it('фамилия необязательна, имя обязательно, фото только по https', () => {
    assert.equal(svc.updateProfile(U1, { firstName: 'Иван' }).lastName, '');
    expectCode(() => svc.updateProfile(U1, { firstName: '' }), 'VALIDATION_ERROR');
    expectCode(
      () => svc.updateProfile(U1, { firstName: 'И', photoUrl: 'javascript:alert(1)' }),
      'VALIDATION_ERROR',
    );
    const ok = svc.updateProfile(U1, {
      firstName: 'Иван',
      lastName: 'Петров',
      photoUrl: 'https://example.com/a.jpg',
    });
    assert.equal(ok.photoUrl, 'https://example.com/a.jpg');
  });
});

describe('места', () => {
  it('создаются любым пользователем, дубликат возвращает существующее', () => {
    const a = svc.createPlace(U1, { name: ' Зал ', address: 'ул. Мира, 1' });
    assert.equal(a.created, true);
    assert.deepEqual(a.place, { id: a.place.id, name: 'Зал', address: 'ул. Мира, 1' });
    const b = svc.createPlace(U2, { name: 'Зал', address: 'ул. Мира, 1' });
    assert.equal(b.created, false);
    assert.equal(b.place.id, a.place.id);
    expectCode(() => svc.createPlace(U1, { name: 'Без адреса' }), 'VALIDATION_ERROR');
    assert.deepEqual(
      svc.listPlaces().map((p) => p.name),
      ['Зал', 'Орловский'],
    );
  });

  it('игра показывает название и адрес места, смена места меняет их', () => {
    const g = svc.createGame(ORG, gameBody());
    assert.equal(g.placeId, PLACE);
    assert.equal(g.venue, 'Орловский');
    assert.equal(g.address, 'Суздальское шоссе 62');
    const other = svc.createPlace(U1, { name: 'Зал', address: 'ул. Мира, 1' }).place.id;
    const u = svc.updateGame(g.id, ORG, { placeId: other });
    assert.equal(u.venue, 'Зал');
    assert.equal(u.address, 'ул. Мира, 1');
    expectCode(() => svc.updateGame(g.id, ORG, { placeId: 12345 }), 'VALIDATION_ERROR');
    expectCode(() => svc.createGame(ORG, gameBody({ placeId: 12345 })), 'VALIDATION_ERROR');
    expectCode(() => svc.createGame(ORG, gameBody({ placeId: undefined })), 'VALIDATION_ERROR');
  });
});

describe('тестовые игроки', () => {
  it('без тестового режима запрещены', () => {
    const g = svc.createGame(ORG, gameBody());
    expectCode(() => svc.addTestPlayers(g.id, ORG, 3), 'FORBIDDEN');
    expectCode(() => svc.removeTestPlayers(g.id, ORG), 'FORBIDDEN');
  });

  it('организатор добавляет много игроков, лишние встают в очередь, потом их можно убрать', () => {
    const notified: number[][] = [];
    const db = openDatabase(':memory:', MIGRATIONS);
    const t = createService(db, { now: () => clock, testMode: true, notify: (n) => void notified.push(n.userIds) });
    t.upsertUser({ vkId: ORG, firstName: 'Орг', lastName: '' });
    t.upsertUser({ vkId: U1, firstName: 'Игрок', lastName: '' });
    const place = t.createPlace(ORG, { name: 'Зал', address: 'ул. 1' }).place.id;
    const g = t.createGame(ORG, gameBody({ placeId: place, teamsMax: 5, playersPerTeam: 2 }));
    t.putSignup(g.id, U1, 1);

    expectCode(() => t.addTestPlayers(g.id, U1, 3), 'FORBIDDEN');
    expectCode(() => t.addTestPlayers(g.id, ORG, 0), 'VALIDATION_ERROR');
    expectCode(() => t.addTestPlayers(g.id, ORG, 51), 'VALIDATION_ERROR');
    expectCode(() => t.addTestPlayers(g.id, ORG, 2, 6), 'VALIDATION_ERROR');

    const a = t.addTestPlayers(g.id, ORG, 12);
    assert.equal(a.roster.length, 13);
    assert.equal(a.taken, 10);
    assert.equal(a.queued, 3);
    const tests = a.roster.filter((e) => e.user.vkId < 0);
    assert.equal(new Set(tests.map((e) => e.user.vkId)).size, 12);
    assert.ok(tests.every((e) => e.user.lastName === '(тест)'));

    const b = t.addTestPlayers(g.id, ORG, 2, 3);
    assert.equal(b.roster.length, 15);
    assert.equal(b.queued, 9);

    const c = t.removeTestPlayers(g.id, ORG);
    assert.deepEqual(
      c.roster.map((e) => e.user.vkId),
      [U1],
    );
    // тестовым игрокам уведомления не уходят
    assert.ok(notified.flat().every((id) => id > 0));
  });
});

describe('команды', () => {
  it('по умолчанию 4 команды с цветами, переименовать может только организатор', () => {
    const g = svc.createGame(ORG, gameBody({ teamsMax: 4, playersPerTeam: 6 }));
    assert.deepEqual(
      g.teams.map((t) => t.name),
      ['Синие', 'Розовые', 'Салатовые', 'Оранжевые'],
    );
    const r = svc.setTeamName(g.id, ORG, 2, { name: '  Ветераны ' });
    assert.equal(r.teams[1]!.name, 'Ветераны');
    assert.equal(events.at(-1)?.type, 'roster.updated');
    expectCode(() => svc.setTeamName(g.id, U1, 1, { name: 'Мои' }), 'FORBIDDEN');
    expectCode(() => svc.setTeamName(g.id, ORG, 5, { name: 'Пятые' }), 'NOT_FOUND');
    expectCode(() => svc.setTeamName(g.id, ORG, 1, { name: ' ' }), 'VALIDATION_ERROR');
  });

  it('новые игроки состава распределяются сразу, запись целиком в одну команду', () => {
    const g = svc.createGame(ORG, gameBody({ teamsMax: 2, playersPerTeam: 3 }));
    const s1 = svc.putSignup(g.id, U1, 3).signup.signupId;
    const s2 = svc.putSignup(g.id, U2, 2).signup.signupId;
    const r = svc.getGame(g.id, ORG);
    assert.deepEqual(r.unassigned, []);
    assert.deepEqual(r.teams[0]!.members, [
      { signupId: s1, seat: 1 },
      { signupId: s1, seat: 2 },
      { signupId: s1, seat: 3 },
    ]);
    assert.deepEqual(r.teams[1]!.members, [
      { signupId: s2, seat: 1 },
      { signupId: s2, seat: 2 },
    ]);
    // событие уже с распределением
    const last = events.at(-1);
    assert.ok(last?.type === 'roster.updated' && last.game.unassigned.length === 0);
  });

  it('команды заполняются по очереди; распределённые и убранные организатором не трогаются', () => {
    const g = svc.createGame(ORG, gameBody({ teamsMax: 2, playersPerTeam: 3 }));
    const s1 = svc.putSignup(g.id, U1, 1).signup.signupId;
    const s2 = svc.putSignup(g.id, U2, 1).signup.signupId;
    let r = svc.getGame(g.id, ORG);
    // второй игрок идёт в уже начатую команду, а не во вторую
    assert.deepEqual(r.teams[0]!.members, [
      { signupId: s1, seat: 1 },
      { signupId: s2, seat: 1 },
    ]);
    assert.equal(r.teams[1]!.members.length, 0);

    // организатор переставил U2 во вторую команду и убрал U1 из команд
    svc.assignSeat(g.id, ORG, { signupId: s2, seat: 1, teamNo: 2 });
    svc.assignSeat(g.id, ORG, { signupId: s1, seat: 1, teamNo: null });
    // новый игрок идёт в самую заполненную (вторую); убранный не возвращается, переставленный не двигается
    const s3 = svc.putSignup(g.id, U3, 1).signup.signupId;
    r = svc.getGame(g.id, ORG);
    assert.deepEqual(r.unassigned, [{ signupId: s1, seat: 1 }]);
    assert.deepEqual(r.teams[1]!.members, [
      { signupId: s2, seat: 1 },
      { signupId: s3, seat: 1 },
    ]);

    // U2 добавил друга: друг идёт в команду U2
    r = svc.putSignup(g.id, U2, 2).game;
    assert.deepEqual(
      r.teams[1]!.members.filter((m) => m.signupId === s2),
      [
        { signupId: s2, seat: 1 },
        { signupId: s2, seat: 2 },
      ],
    );
  });

  it('ручное перемещение: в полную команду нельзя, места из очереди нельзя', () => {
    const g = svc.createGame(ORG, gameBody({ teamsMax: 2, playersPerTeam: 2 }));
    const s1 = svc.putSignup(g.id, U1, 2).signup.signupId; // команда 1
    const s2 = svc.putSignup(g.id, U2, 2).signup.signupId; // команда 2
    assert.throws(
      () => svc.assignSeat(g.id, ORG, { signupId: s1, seat: 1, teamNo: 2 }),
      (e: unknown) => e instanceof AppError && e.code === 'TEAM_FULL' && e.status === 409,
    );
    svc.assignSeat(g.id, ORG, { signupId: s2, seat: 2, teamNo: null });
    const r = svc.assignSeat(g.id, ORG, { signupId: s1, seat: 2, teamNo: 2 });
    assert.deepEqual(r.teams[0]!.members, [{ signupId: s1, seat: 1 }]);
    assert.deepEqual(r.teams[1]!.members, [
      { signupId: s2, seat: 1 },
      { signupId: s1, seat: 2 },
    ]);
    expectCode(() => svc.assignSeat(g.id, U1, { signupId: s1, seat: 1, teamNo: 2 }), 'FORBIDDEN');
    expectCode(() => svc.assignSeat(g.id, ORG, { signupId: s1, seat: 3, teamNo: 1 }), 'VALIDATION_ERROR');
    expectCode(() => svc.assignSeat(g.id, ORG, { signupId: s1, seat: 1, teamNo: 3 }), 'NOT_FOUND');
    expectCode(() => svc.assignSeat(g.id, ORG, { signupId: s1, seat: 1 }), 'VALIDATION_ERROR');
  });

  it('место, ушедшее из состава, выпадает из команды; вернувшись, распределяется заново', () => {
    const g = svc.createGame(ORG, gameBody({ teamsMax: 2, playersPerTeam: 2 }));
    const s1 = svc.putSignup(g.id, U1, 2).signup.signupId; // команда 1
    const s2 = svc.putSignup(g.id, U2, 1).signup.signupId; // команда 2
    svc.putSignup(g.id, U1, 1);
    let r = svc.getGame(g.id, ORG);
    assert.deepEqual(r.teams[0]!.members, [{ signupId: s1, seat: 1 }]);

    r = svc.updateGame(g.id, ORG, { playersPerTeam: 1 }); // вместимость 2: U2 остаётся, команды по 1
    assert.deepEqual(r.teams[1]!.members, [{ signupId: s2, seat: 1 }]);
    r = svc.putSignup(g.id, U3, 1).game; // в очередь: в команды не попадает
    assert.equal(r.unassigned.length, 0);
    r = svc.updateGame(g.id, ORG, { playersPerTeam: 2 }); // U3 переходит в состав и распределяется
    assert.equal(r.unassigned.length, 0);
    assert.equal(r.teams.flatMap((t) => t.members).length, 3);
  });
});

describe('счёт встреч', () => {
  it('по умолчанию 2 встречи; организатор записывает, меняет и стирает счёт каждой; порядок команд любой', () => {
    const g = svc.createGame(ORG, gameBody({ teamsMax: 3, playersPerTeam: 2 }));
    assert.equal(g.meetings, 2);
    assert.deepEqual(g.results, []);
    let r = svc.setMatchScore(g.id, ORG, 2, 1, 1, { goalsA: 3, goalsB: 1 }); // «Розовые» 3 : 1 «Синие»
    assert.deepEqual(r.results, [{ teamA: 1, teamB: 2, leg: 1, goalsA: 1, goalsB: 3 }]);
    assert.equal(events.at(-1)?.type, 'roster.updated');
    r = svc.setMatchScore(g.id, ORG, 1, 2, 2, { goalsA: 2, goalsB: 2 });
    assert.deepEqual(r.results, [
      { teamA: 1, teamB: 2, leg: 1, goalsA: 1, goalsB: 3 },
      { teamA: 1, teamB: 2, leg: 2, goalsA: 2, goalsB: 2 },
    ]);
    r = svc.setMatchScore(g.id, ORG, 1, 2, 1, null);
    assert.deepEqual(r.results, [{ teamA: 1, teamB: 2, leg: 2, goalsA: 2, goalsB: 2 }]);
  });

  it('права и проверки: только организатор, голы 0..99, команды и встречи из игры, не в отменённой игре', () => {
    const g = svc.createGame(ORG, gameBody({ teamsMax: 2, playersPerTeam: 2, meetings: 3 }));
    expectCode(() => svc.setMatchScore(g.id, U1, 1, 2, 1, { goalsA: 1, goalsB: 0 }), 'FORBIDDEN');
    expectCode(() => svc.setMatchScore(g.id, ORG, 1, 2, 1, { goalsA: 100, goalsB: 0 }), 'VALIDATION_ERROR');
    expectCode(() => svc.setMatchScore(g.id, ORG, 1, 2, 1, { goalsA: 1 }), 'VALIDATION_ERROR');
    expectCode(() => svc.setMatchScore(g.id, ORG, 1, 1, 1, { goalsA: 1, goalsB: 0 }), 'NOT_FOUND');
    expectCode(() => svc.setMatchScore(g.id, ORG, 1, 3, 1, { goalsA: 1, goalsB: 0 }), 'NOT_FOUND');
    svc.setMatchScore(g.id, ORG, 1, 2, 3, { goalsA: 0, goalsB: 0 });
    expectCode(() => svc.setMatchScore(g.id, ORG, 1, 2, 4, { goalsA: 1, goalsB: 0 }), 'NOT_FOUND');
    expectCode(() => svc.createGame(ORG, gameBody({ meetings: 11 })), 'VALIDATION_ERROR');
    svc.cancelGame(g.id, ORG);
    expectCode(() => svc.setMatchScore(g.id, ORG, 1, 2, 1, { goalsA: 1, goalsB: 0 }), 'GAME_NOT_ACTIVE');
  });

  it('меньше команд или встреч: счёт исчезнувших встреч не показывается, а при возврате появляется снова', () => {
    const g = svc.createGame(ORG, gameBody({ teamsMax: 3, playersPerTeam: 2 }));
    svc.setMatchScore(g.id, ORG, 1, 2, 1, { goalsA: 1, goalsB: 0 });
    svc.setMatchScore(g.id, ORG, 1, 2, 2, { goalsA: 0, goalsB: 1 });
    svc.setMatchScore(g.id, ORG, 2, 3, 1, { goalsA: 0, goalsB: 2 });
    let r = svc.updateGame(g.id, ORG, { teamsMax: 2, meetings: 1 });
    assert.equal(r.meetings, 1);
    assert.deepEqual(r.results, [{ teamA: 1, teamB: 2, leg: 1, goalsA: 1, goalsB: 0 }]);
    r = svc.updateGame(g.id, ORG, { meetings: 2 });
    assert.equal(r.results.length, 2);
  });
});

describe('рейтинг', () => {
  it('учитывает сборы со счётом, только самих записавшихся, без отменённых сборов', () => {
    const g = svc.createGame(ORG, gameBody({ teamsMax: 2, playersPerTeam: 2 }));
    svc.putSignup(g.id, U1, 2); // U1 и его друг — в команде 1
    svc.putSignup(g.id, U2, 1); // U2 — в команде 2
    assert.deepEqual(svc.rating(), [], 'без счёта рейтинга нет');
    svc.setMatchScore(g.id, ORG, 1, 2, 1, { goalsA: 3, goalsB: 0 });

    const other = svc.createGame(ORG, gameBody({ teamsMax: 2, playersPerTeam: 2 }));
    svc.putSignup(other.id, U3, 1);
    svc.putSignup(other.id, U2, 1);
    svc.setMatchScore(other.id, ORG, 1, 2, 1, { goalsA: 0, goalsB: 1 });
    svc.cancelGame(other.id, ORG); // отменённый сбор не учитывается

    const rows = svc.rating();
    assert.deepEqual(
      rows.map((r) => [r.user.vkId, r.user.firstName, r.matches, r.gatherings, r.points]),
      [
        [U1, `Имя${U1}`, { played: 1, won: 1, drawn: 0, lost: 0 }, { played: 1, won: 1 }, 1],
        [U2, `Имя${U2}`, { played: 1, won: 0, drawn: 0, lost: 1 }, { played: 1, won: 0 }, 0],
      ],
    );
  });
});
