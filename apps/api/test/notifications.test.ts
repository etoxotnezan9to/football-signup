import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/db.ts';
import { createService, type Service } from '../src/service.ts';
import type { Notification } from '../src/notifier.ts';

const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));

const ORG = 100;
const A = 1;
const B = 2;
const C = 3;
let PLACE = 0;

let clockMs = 0;
let sent: Notification[] = [];
let svc: Service;

/** Время идёт только по команде теста: порядок записей задаётся через tick(). */
const setClock = (iso: string) => void (clockMs = Date.parse(iso));
const tick = () => void (clockMs += 1000);

function gameBody(over: Record<string, unknown> = {}) {
  return {
    startsAt: '2026-10-22T18:00:00.000Z', // 21:00 по Москве
    placeId: PLACE,
    feeRub: 650,
    teamsMax: 2, playersPerTeam: 1,
    ...over,
  };
}

function setup(timeZone?: string) {
  setClock('2026-10-20T10:00:00.000Z');
  sent = [];
  svc = createService(openDatabase(':memory:', MIGRATIONS), {
    now: () => new Date(clockMs),
    notify: (n) => void sent.push(n),
    ...(timeZone ? { timeZone } : {}),
  });
  for (const id of [ORG, A, B, C]) svc.upsertUser({ vkId: id, firstName: `Имя${id}`, lastName: `Фам${id}` });
  PLACE = svc.createPlace(ORG, { name: 'Орловский', address: 'Суздальское шоссе 62' }).place.id;
}

function signup(gameId: number, userId: number, seats: number) {
  tick();
  return svc.putSignup(gameId, userId, seats);
}

beforeEach(() => setup());

describe('уведомление о попадании в состав', () => {
  it('человек из очереди получает уведомление, когда кто-то отменил запись', () => {
    const g = svc.createGame(ORG, gameBody());
    signup(g.id, A, 2);
    signup(g.id, B, 1); // в очереди
    assert.equal(sent.length, 0, 'запись сама по себе никого не уведомляет');

    tick();
    svc.deleteSignup(g.id, A);

    assert.equal(sent.length, 1);
    const n = sent[0]!;
    assert.deepEqual(n.userIds, [B]);
    assert.match(n.message, /Вы в составе/);
    assert.match(n.message, /Орловский/);
    assert.match(n.message, /21:00/, 'время показывается по Москве');
    assert.equal(n.fragment, `/game/${g.id}`);
  });

  it('инициатор действия не получает уведомление о собственном повышении', () => {
    const g = svc.createGame(ORG, gameBody({ teamsMax: 3, playersPerTeam: 1 }));
    signup(g.id, A, 2);
    signup(g.id, B, 2); // 1 в составе + 1 в очереди
    sent = [];
    tick();
    svc.putSignup(g.id, A, 1); // A уменьшается, место достаётся B
    assert.deepEqual(
      sent.map((n) => n.userIds),
      [[B]],
    );
  });

  it('организатор удалил участника: человек из очереди уведомлён', () => {
    const g = svc.createGame(ORG, gameBody());
    const first = signup(g.id, A, 2);
    signup(g.id, B, 1);
    tick();
    svc.removeSignup(g.id, ORG, first.signup.signupId);
    assert.deepEqual(
      sent.map((n) => n.userIds),
      [[B]],
    );
  });

  it('увеличение вместимости организатором поднимает людей из очереди', () => {
    const g = svc.createGame(ORG, gameBody());
    signup(g.id, A, 2);
    signup(g.id, B, 2); // в очереди
    tick();
    svc.updateGame(g.id, ORG, { teamsMax: 2, playersPerTeam: 2 });
    assert.deepEqual(
      sent.map((n) => n.userIds),
      [[B]],
    );
    assert.match(sent[0]!.message, /Мест у вас в составе: 2/);
  });

  it('в очереди остаётся без уведомления, пока места не освободились', () => {
    const g = svc.createGame(ORG, gameBody());
    signup(g.id, A, 2);
    signup(g.id, B, 1);
    signup(g.id, C, 1);
    tick();
    svc.putSignup(g.id, B, 2); // B просто увеличил запись, мест нет
    assert.equal(sent.length, 0);
  });

  it('часовой пояс уведомлений настраивается', () => {
    setup('UTC');
    const g = svc.createGame(ORG, gameBody());
    signup(g.id, A, 2);
    signup(g.id, B, 1);
    tick();
    svc.deleteSignup(g.id, A);
    assert.match(sent[0]!.message, /18:00/);
  });
});

describe('уведомления об изменении и отмене игры', () => {
  it('перенос времени или места уведомляет записавшихся, кроме организатора', () => {
    const g = svc.createGame(ORG, gameBody({ teamsMax: 2, playersPerTeam: 2 }));
    signup(g.id, A, 1);
    signup(g.id, B, 1);
    tick();
    svc.updateGame(g.id, ORG, { startsAt: '2026-10-22T19:00:00.000Z' });
    assert.equal(sent.length, 1);
    assert.deepEqual([...sent[0]!.userIds].sort(), [A, B]);
    assert.match(sent[0]!.message, /Сбор .* изменён/);
    assert.match(sent[0]!.message, /22:00/);
  });

  it('правка описания или взноса никого не беспокоит', () => {
    const g = svc.createGame(ORG, gameBody({ teamsMax: 2, playersPerTeam: 2 }));
    signup(g.id, A, 1);
    tick();
    svc.updateGame(g.id, ORG, { description: 'Берите сменку', feeRub: 700 });
    assert.equal(sent.length, 0);
  });

  it('тот, кого подняли из очереди, получает одно сообщение, а не два', () => {
    const g = svc.createGame(ORG, gameBody());
    signup(g.id, A, 2);
    signup(g.id, B, 1); // очередь
    tick();
    const other = svc.createPlace(ORG, { name: 'Другой зал', address: 'ул. Другая, 1' }).place.id;
    svc.updateGame(g.id, ORG, { teamsMax: 3, playersPerTeam: 1, placeId: other });
    const toB = sent.filter((n) => n.userIds.includes(B));
    assert.equal(toB.length, 1);
    assert.match(toB[0]!.message, /Вы в составе/);
    const toA = sent.filter((n) => n.userIds.includes(A));
    assert.equal(toA.length, 1);
    assert.match(toA[0]!.message, /Сбор .* изменён/);
  });

  it('отмена игры уведомляет всех записавшихся, повторная отмена нет', () => {
    const g = svc.createGame(ORG, gameBody());
    signup(g.id, A, 2);
    signup(g.id, B, 1);
    tick();
    svc.cancelGame(g.id, ORG);
    assert.equal(sent.length, 1);
    assert.deepEqual([...sent[0]!.userIds].sort(), [A, B]);
    assert.match(sent[0]!.message, /Сбор .* отменён организатором/);
    tick();
    svc.cancelGame(g.id, ORG);
    assert.equal(sent.length, 1);
  });

  it('игра без записавшихся: отмена проходит молча', () => {
    const g = svc.createGame(ORG, gameBody());
    svc.cancelGame(g.id, ORG);
    assert.equal(sent.length, 0);
  });
});

describe('напоминания за сутки', () => {
  function gameWithPlayers() {
    const g = svc.createGame(ORG, gameBody());
    signup(g.id, A, 2);
    signup(g.id, B, 1); // в очереди: напоминание не получает
    sent = [];
    return g;
  }

  it('до окна в 24 часа напоминаний нет', () => {
    gameWithPlayers();
    assert.equal(svc.sendDueReminders(), 0);
    assert.equal(sent.length, 0);
  });

  it('в окне отправляет один раз, только тем, кто в составе', () => {
    const g = gameWithPlayers();
    setClock('2026-10-21T18:30:00.000Z'); // за 23,5 часа
    assert.equal(svc.sendDueReminders(), 1);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0]!.userIds, [A]);
    assert.match(sent[0]!.message, /Напоминание: сбор/);
    assert.match(sent[0]!.message, /Мест у вас в составе: 2/);
    assert.equal(sent[0]!.fragment, `/game/${g.id}`);

    setClock('2026-10-21T19:30:00.000Z');
    assert.equal(svc.sendDueReminders(), 0, 'повторно не отправляется');
    assert.equal(sent.length, 1);
  });

  it('участники с разным числом мест получают отдельные сообщения', () => {
    const g = svc.createGame(ORG, gameBody({ teamsMax: 3, playersPerTeam: 2 }));
    signup(g.id, A, 2);
    signup(g.id, B, 1);
    signup(g.id, C, 2);
    sent = [];
    setClock('2026-10-21T18:30:00.000Z');
    svc.sendDueReminders();
    assert.equal(sent.length, 2);
    const bySeats = new Map(sent.map((n) => [n.message.match(/составе: (\d)/)![1], [...n.userIds].sort()]));
    assert.deepEqual(bySeats.get('2'), [A, C]);
    assert.deepEqual(bySeats.get('1'), [B]);
  });

  it('игра, созданная менее чем за сутки до начала, без напоминания', () => {
    setClock('2026-10-22T08:00:00.000Z');
    const g = svc.createGame(ORG, gameBody()); // до начала 10 часов
    signup(g.id, A, 1);
    sent = [];
    setClock('2026-10-22T10:00:00.000Z');
    assert.equal(svc.sendDueReminders(), 0);
    assert.equal(sent.length, 0);
  });

  it('меньше чем за час до начала напоминание уже не отправляется', () => {
    gameWithPlayers();
    setClock('2026-10-22T17:30:00.000Z');
    assert.equal(svc.sendDueReminders(), 0);
    assert.equal(sent.length, 0);
  });

  it('отменённая игра без напоминания', () => {
    const g = gameWithPlayers();
    tick();
    svc.cancelGame(g.id, ORG);
    sent = [];
    setClock('2026-10-21T18:30:00.000Z');
    assert.equal(svc.sendDueReminders(), 0);
    assert.equal(sent.length, 0);
  });

  it('без включённых уведомлений ничего не делает', () => {
    const plain = createService(openDatabase(':memory:', MIGRATIONS), { now: () => new Date(clockMs) });
    assert.equal(plain.sendDueReminders(), 0);
  });
});
