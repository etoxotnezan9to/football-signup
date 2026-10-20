import bridge from '@vkontakte/vk-bridge';
import { notificationsEnabledFromSearch } from './format.ts';
import { mockAuthHeader } from './mock-players.ts';

export const VK_APP_ID = Number(import.meta.env.VITE_VK_APP_ID ?? 54809461);

export interface Session {
  /** Значение заголовка Authorization для REST */
  authHeader: string;
  /** Строка авторизации для WebSocket */
  wsAuth: string;
  mock: boolean;
  /** Разрешил ли пользователь уведомления приложения; null — неизвестно (вне VK) */
  notificationsEnabled: boolean | null;
  user: { id: number; firstName: string; lastName: string; photoUrl: string | null };
}

export const MOCK_USERS = [
  { id: 1001, firstName: 'Иван', lastName: 'Петров' },
  { id: 1002, firstName: 'Мария', lastName: 'Сидорова' },
  { id: 1003, firstName: 'Алексей', lastName: 'Смирнов' },
  { id: 1004, firstName: 'Дмитрий', lastName: 'Козлов' },
];

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setMockUser(id: number): void {
  try {
    localStorage.setItem('mockUser', String(id));
  } catch {
    // хранилище недоступно: останется пользователь по умолчанию
  }
}

/** Запущено ли приложение внутри VK (есть подпись параметров запуска). */
export function insideVk(): boolean {
  return new URLSearchParams(window.location.search).has('sign');
}

export async function initSession(): Promise<Session> {
  if (insideVk()) {
    const launch = window.location.search.replace(/^\?/, '');
    await bridge.send('VKWebAppInit');
    const info = await bridge.send('VKWebAppGetUserInfo');
    return {
      authHeader: `VK ${launch}`,
      wsAuth: launch,
      mock: false,
      notificationsEnabled: notificationsEnabledFromSearch(window.location.search),
      user: {
        id: info.id,
        firstName: info.first_name,
        lastName: info.last_name,
        photoUrl: info.photo_100 ?? null,
      },
    };
  }

  const saved = Number(storageGet('mockUser'));
  const mock = MOCK_USERS.find((u) => u.id === saved) ?? MOCK_USERS[0]!;
  const authHeader = mockAuthHeader(mock);
  return {
    authHeader,
    wsAuth: `mock:${authHeader.slice('Mock '.length)}`,
    mock: true,
    notificationsEnabled: null,
    user: { id: mock.id, firstName: mock.firstName, lastName: mock.lastName, photoUrl: null },
  };
}
