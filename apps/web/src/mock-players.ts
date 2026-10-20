// Синтетические игроки тестового режима: позволяют заполнить игру десятками записей без настоящих аккаунтов.
// Сервер принимает их только с AUTH_DEV_BYPASS=1 вне production, как и остальных тестовых пользователей.

export interface MockPlayer {
  id: number;
  firstName: string;
  lastName: string;
}

/** Диапазон id не пересекается с MOCK_USERS (1001–1004) и правдоподобными id VK в локальной базе. */
export const MOCK_PLAYER_BASE_ID = 900_000;
export const MOCK_FILL_DEFAULT = 30;
export const MOCK_FILL_MAX = 50;

export function mockPlayer(n: number): MockPlayer {
  return { id: MOCK_PLAYER_BASE_ID + n, firstName: 'Тестовый', lastName: `игрок ${n}` };
}

/** Следующие `count` тестовых игроков, которых ещё нет в игре: номера идут подряд, занятые пропускаются. */
export function nextMockPlayers(takenIds: Iterable<number>, count: number): MockPlayer[] {
  const taken = new Set(takenIds);
  const out: MockPlayer[] = [];
  for (let n = 1; out.length < count; n++) {
    const p = mockPlayer(n);
    if (!taken.has(p.id)) out.push(p);
  }
  return out;
}

/** Заголовок Authorization тестового пользователя: `Mock <id>:<имя>:<фамилия>`. */
export function mockAuthHeader(u: MockPlayer): string {
  return `Mock ${u.id}:${encodeURIComponent(u.firstName)}:${encodeURIComponent(u.lastName)}`;
}
