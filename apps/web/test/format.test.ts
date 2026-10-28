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
  meetingsLabel,
  nextWeekOf,
  visibleInList,
  profileUrl,
  signupResultText,
  defaultStartsAt,
  splitPhones,
  type Route,
} from '../src/format.ts';

describe('splitPhones', () => {
  it('находит номера в разных записях и приводит к +7XXXXXXXXXX', () => {
    const phones = (t: string) => splitPhones(t).flatMap((p) => (p.phone ? [p.phone] : []));
    assert.deepEqual(phones('Т-Банк 8-900-123-45-67'), ['+79001234567']);
    assert.deepEqual(phones('+7 (900) 123-45-67, Сбер'), ['+79001234567']);
    assert.deepEqual(phones('89001234567 или 900 765 43 21'), ['+79001234567', '+79007654321']);
    assert.deepEqual(phones('+79001234567'), ['+79001234567']);
  });

  it('не принимает за номер короткие числа и номера карт', () => {
    const phones = (t: string) => splitPhones(t).filter((p) => p.phone);
    assert.equal(phones('Т-Банк 8-900').length, 0);
    assert.equal(phones('карта 2200 7001 2345 6789').length, 0);
    assert.equal(phones('взнос 650').length, 0);
  });

  it('сохраняет текст вокруг номера', () => {
    assert.deepEqual(splitPhones('Т-Банк 8-900-123-45-67, Иван'), [
      { text: 'Т-Банк ' },
      { text: '8-900-123-45-67', phone: '+79001234567' },
      { text: ', Иван' },
    ]);
    assert.deepEqual(splitPhones('без номера'), [{ text: 'без номера' }]);
  });
});

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

describe('nextWeekOf', () => {
  it('через неделю после копируемого сбора, тот же день недели и время', () => {
    const src = new Date(2026, 9, 21, 19, 30).toISOString(); // ср, 21 октября, 19:30 по местному времени
    assert.equal(nextWeekOf(src, new Date(2026, 9, 21, 12, 0)), '2026-10-28T19:30');
  });

  it('если и через неделю уже прошло, ближайшая такая же дата в будущем', () => {
    const src = new Date(2026, 8, 2, 21, 0).toISOString(); // 2 сентября
    // 9, 16, 23, 30 сентября, 7 и 14 октября уже прошли; 21 октября в 21:00 ещё впереди
    assert.equal(nextWeekOf(src, new Date(2026, 9, 21, 12, 0)), '2026-10-21T21:00');
  });
});

describe('profileUrl', () => {
  it('страница ВКонтакте по vkId; у тестовых игроков (vkId ≤ 0) её нет', () => {
    assert.equal(profileUrl(1002), 'https://vk.com/id1002');
    assert.equal(profileUrl(-5), null);
    assert.equal(profileUrl(0), null);
  });
});

describe('meetingsLabel', () => {
  it('склоняет «встреча»', () => {
    assert.equal(meetingsLabel(1), '1 встреча');
    assert.equal(meetingsLabel(2), '2 встречи');
    assert.equal(meetingsLabel(5), '5 встреч');
  });
});

describe('visibleInList', () => {
  const game = (status: 'active' | 'cancelled', isFinished = false, placeId = 7) => ({ status, isFinished, placeId });
  const f = (over: Partial<{ placeId: number | null; showPast: boolean; showCancelled: boolean }> = {}) => ({
    placeId: null,
    showPast: false,
    showCancelled: true,
    ...over,
  });

  it('по умолчанию видны активные и все отменённые, прошедшие — нет', () => {
    assert.equal(visibleInList(game('active'), f()), true);
    assert.equal(visibleInList(game('cancelled'), f()), true);
    assert.equal(visibleInList(game('active', true), f()), false);
  });

  it('фильтры: прошедшие, без отменённых, одна арена', () => {
    assert.equal(visibleInList(game('active', true), f({ showPast: true })), true);
    assert.equal(visibleInList(game('cancelled'), f({ showCancelled: false })), false);
    assert.equal(visibleInList(game('active'), f({ placeId: 7 })), true);
    assert.equal(visibleInList(game('active'), f({ placeId: 8 })), false);
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
