import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  fillLabel,
  teamsLabel,
  formatWhen,
  fromLocalInput,
  gameLink,
  notificationsEnabledFromSearch,
  parseRoute,
  placeOptions,
  plural,
  routeToHash,
  seatsLabel,
  seatName,
  toLocalInput,
  withTimeOf,
  signupResultText,
  defaultStartsAt,
  type Route,
} from '../src/format.ts';

describe('plural / seatsLabel', () => {
  it('склоняет «место»', () => {
    assert.equal(seatsLabel(1), '1 место');
    assert.equal(seatsLabel(2), '2 места');
    assert.equal(seatsLabel(5), '5 мест');
    assert.equal(seatsLabel(11), '11 мест');
    assert.equal(seatsLabel(21), '21 место');
    assert.equal(seatsLabel(24), '24 места');
    assert.equal(plural(0, ['a', 'b', 'c']), 'c');
  });
});

describe('fillLabel', () => {
  it('показывает очередь только если она есть', () => {
    assert.equal(fillLabel(18, 24, 0), 'занято 18/24');
    assert.equal(fillLabel(24, 24, 3), 'занято 24/24, в очереди 3');
  });
});

describe('teamsLabel', () => {
  it('склоняет команды и игроков', () => {
    assert.equal(teamsLabel(4, 6), 'до 4 команд по 6 игроков');
    assert.equal(teamsLabel(2, 2), 'до 2 команд по 2 игрока');
    assert.equal(teamsLabel(3, 1), 'до 3 команд по 1 игроку');
    assert.equal(teamsLabel(10, 11), 'до 10 команд по 11 игроков');
  });
});

describe('seatName', () => {
  it('друзья по записи подписаны как +1, +2', () => {
    const u = { firstName: 'Иван', lastName: 'Петров' };
    assert.equal(seatName(u, 1), 'Иван Петров');
    assert.equal(seatName(u, 3), 'Иван Петров +2');
  });
});

describe('withTimeOf', () => {
  it('оставляет дату поля, а время берёт из копируемого сбора', () => {
    const iso = new Date(2026, 9, 1, 19, 30).toISOString(); // 1 октября, 19:30 по местному времени
    assert.equal(toLocalInput(iso).slice(11), '19:30');
    assert.equal(withTimeOf('2026-10-25T21:00', iso), '2026-10-25T19:30');
    assert.equal(withTimeOf('', iso), toLocalInput(iso), 'пустое поле — дата и время копируемого');
  });
});

describe('formatWhen', () => {
  it('использует заданный часовой пояс', () => {
    const s = formatWhen('2026-10-22T18:00:00.000Z', 'Europe/Moscow');
    assert.ok(s.includes('21:00'), s);
    assert.ok(s.includes('22'), s);
  });
});

describe('fromLocalInput', () => {
  it('неверная дата даёт пустую строку', () => {
    assert.equal(fromLocalInput('not a date'), '');
    assert.ok(fromLocalInput('2026-10-22T21:00').endsWith('Z'));
  });
});

describe('маршруты', () => {
  const cases: [string, Route][] = [
    ['', { name: 'list' }],
    ['#/', { name: 'list' }],
    ['#/my', { name: 'my' }],
    ['#/create', { name: 'create' }],
    ['#/game/12', { name: 'game', id: 12 }],
    ['#game/12', { name: 'game', id: 12 }],
    ['#/game/12/edit', { name: 'edit', id: 12 }],
    ['#/game/abc', { name: 'list' }],
    ['#/unknown', { name: 'list' }],
  ];
  for (const [hash, route] of cases) {
    it(`parseRoute(${JSON.stringify(hash)})`, () => assert.deepEqual(parseRoute(hash), route));
  }
  it('routeToHash и parseRoute взаимно обратны', () => {
    for (const [, route] of cases) assert.deepEqual(parseRoute(routeToHash(route)), route);
  });
});

describe('gameLink', () => {
  it('строит ссылку внутрь приложения VK', () => {
    assert.equal(gameLink(54809461, 7), 'https://vk.com/app54809461#/game/7');
  });
});

describe('signupResultText', () => {
  it('описывает разбиение записи между составом и очередью', () => {
    assert.equal(signupResultText({ mainSeats: 2, queueSeats: 1 }), 'Вы записаны: 2 места в составе, 1 место в очереди');
    assert.equal(signupResultText({ mainSeats: 3, queueSeats: 0 }), 'Вы записаны: 3 места в составе');
    assert.equal(signupResultText({ mainSeats: 0, queueSeats: 2 }), 'Вы записаны: 2 места в очереди');
    assert.equal(signupResultText({ mainSeats: 0, queueSeats: 0 }), 'Запись обновлена');
  });
});

describe('defaultStartsAt', () => {
  it('завтра в 21:00 по локальному времени, в том числе на стыке месяцев', () => {
    assert.equal(defaultStartsAt(new Date(2026, 9, 16, 10, 0)), '2026-10-17T21:00');
    assert.equal(defaultStartsAt(new Date(2026, 9, 31, 23, 59)), '2026-11-01T21:00');
  });
});

describe('notificationsEnabledFromSearch', () => {
  it('читает подписанный параметр запуска VK', () => {
    assert.equal(notificationsEnabledFromSearch('?vk_user_id=1&vk_are_notifications_enabled=1&sign=x'), true);
    assert.equal(notificationsEnabledFromSearch('vk_are_notifications_enabled=0&sign=x'), false);
  });

  it('без параметра или с мусором — неизвестно', () => {
    assert.equal(notificationsEnabledFromSearch(''), null);
    assert.equal(notificationsEnabledFromSearch('?vk_are_notifications_enabled=yes'), null);
  });
});

describe('placeOptions', () => {
  it('уникальные места по алфавиту', () => {
    const games = [
      { placeId: 2, venue: 'Орловский' },
      { placeId: 1, venue: 'Арена' },
      { placeId: 2, venue: 'Орловский' },
    ];
    assert.deepEqual(placeOptions(games), [
      { id: 1, name: 'Арена' },
      { id: 2, name: 'Орловский' },
    ]);
    assert.deepEqual(placeOptions([]), []);
  });
});
