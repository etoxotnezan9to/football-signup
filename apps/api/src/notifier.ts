// Отправка личных уведомлений через VK API (notifications.sendMessage, сервисный ключ доступа).
// Ограничения VK: до 100 получателей за вызов, текст до 254 символов, не больше 1 уведомления
// в час и 3 в сутки на пользователя, одинаковый текст подряд одному человеку запрещён.
// Уведомления вторичны: любой сбой логируется и никогда не влияет на запись на игру.
import { randomInt } from 'node:crypto';
import { clipMessage } from '@football/shared';

export interface Notification {
  userIds: number[];
  message: string;
  /** Часть ссылки после `#` (например `/game/12`): VK откроет приложение на этом экране */
  fragment?: string;
}

export type Notify = (notification: Notification) => void;

export interface NotifierLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

export interface VkNotifierOptions {
  /** Сервисный ключ доступа приложения (не защищённый ключ). Передаётся только в теле запроса к VK. */
  serviceKey: string;
  fetchImpl?: typeof fetch;
  log?: NotifierLogger;
  endpoint?: string;
  apiVersion?: string;
  timeoutMs?: number;
}

export interface VkNotifier {
  notify: Notify;
  /** Дожидается отправки всех поставленных в очередь уведомлений (для остановки сервера и тестов). */
  flush(): Promise<void>;
}

const CHUNK_SIZE = 100;
/**
 * Ожидаемые отказы VK, не считающиеся ошибкой приложения:
 * 1 — уведомления отключены, 2 — часовой лимит, 3 — суточный лимит, 4 — приложение не установлено.
 */
const EXPECTED_ERROR_CODES = new Set([1, 2, 3, 4]);

interface VkResultItem {
  user_id?: number;
  status?: boolean;
  error?: { code?: number; description?: string };
}

interface VkResponse {
  response?: VkResultItem[];
  error?: { error_code?: number; error_msg?: string };
}

export function createVkNotifier(options: VkNotifierOptions): VkNotifier {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = options.endpoint ?? 'https://api.vk.com/method/notifications.sendMessage';
  const apiVersion = options.apiVersion ?? '5.199';
  const timeoutMs = options.timeoutMs ?? 5_000;
  const log: NotifierLogger = options.log ?? { info: () => {}, warn: () => {} };
  const pending = new Set<Promise<void>>();

  async function sendChunk(userIds: number[], message: string, fragment: string | undefined): Promise<void> {
    const body = new URLSearchParams({
      user_ids: userIds.join(','),
      message,
      access_token: options.serviceKey,
      v: apiVersion,
      random_id: String(randomInt(1, 2_147_483_647)),
    });
    if (fragment) body.set('fragment', fragment);

    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = (await res.json()) as VkResponse;
    if (json.error) {
      log.warn({ code: json.error.error_code, vkMessage: json.error.error_msg }, 'VK отклонил запрос уведомлений');
      return;
    }
    for (const item of json.response ?? []) {
      if (item.status) continue;
      const code = item.error?.code ?? 0;
      const entry = { userId: item.user_id, code, vkMessage: item.error?.description };
      if (EXPECTED_ERROR_CODES.has(code)) log.info(entry, 'уведомление не доставлено');
      else log.warn(entry, 'уведомление не доставлено');
    }
  }

  async function send(notification: Notification): Promise<void> {
    const userIds = [...new Set(notification.userIds)].filter((id) => Number.isInteger(id) && id > 0);
    const message = clipMessage(notification.message);
    if (userIds.length === 0 || message === '') return;
    for (let i = 0; i < userIds.length; i += CHUNK_SIZE) {
      try {
        await sendChunk(userIds.slice(i, i + CHUNK_SIZE), message, notification.fragment);
      } catch (err) {
        // ключ в сообщение об ошибке не попадает: логируем только имя и текст исключения
        log.warn({ error: err instanceof Error ? err.message : String(err) }, 'не удалось отправить уведомления');
      }
    }
  }

  return {
    notify(notification) {
      const task = send(notification).finally(() => pending.delete(task));
      pending.add(task);
    },
    async flush() {
      while (pending.size > 0) await Promise.all([...pending]);
    },
  };
}
