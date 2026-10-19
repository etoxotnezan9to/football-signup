// Хаб WebSocket: авторизация, подписки и рассылка событий (docs/realtime.md).
// Не зависит от конкретной реализации сокета.
import type { ServerEvent } from '@football/shared';

export interface HubSocket {
  send(data: string): void;
  close(code?: number): void;
}

export interface HubOptions {
  /** Возвращает vkId при валидных параметрах запуска, иначе null */
  authenticate: (launchParams: string) => number | null;
  authTimeoutMs?: number;
}

export interface HubConnection {
  onMessage(raw: string): void;
  onClose(): void;
}

interface Conn {
  socket: HubSocket;
  vkId: number | null;
  topics: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createHub(options: HubOptions) {
  const conns = new Set<Conn>();
  const authTimeoutMs = options.authTimeoutMs ?? 10_000;

  function send(conn: Conn, payload: unknown): void {
    try {
      conn.socket.send(JSON.stringify(payload));
    } catch {
      // сокет уже закрыт, чистка произойдёт в onClose
    }
  }

  function dispose(conn: Conn): void {
    if (conn.timer) clearTimeout(conn.timer);
    conn.timer = null;
    conns.delete(conn);
  }

  return {
    connect(socket: HubSocket): HubConnection {
      const conn: Conn = { socket, vkId: null, topics: new Set(), timer: null };
      conns.add(conn);
      conn.timer = setTimeout(() => {
        if (conn.vkId === null) {
          send(conn, { type: 'auth.error' });
          socket.close(4401);
          dispose(conn);
        }
      }, authTimeoutMs);
      // не мешаем процессу завершиться
      conn.timer.unref?.();

      return {
        onMessage(raw: string): void {
          let msg: Record<string, unknown>;
          try {
            const parsed: unknown = JSON.parse(raw);
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return;
            msg = parsed as Record<string, unknown>;
          } catch {
            return;
          }

          if (msg.type === 'auth') {
            const id = typeof msg.launchParams === 'string' ? options.authenticate(msg.launchParams) : null;
            if (id === null) {
              send(conn, { type: 'auth.error' });
              socket.close(4401);
              dispose(conn);
              return;
            }
            conn.vkId = id;
            if (conn.timer) clearTimeout(conn.timer);
            conn.timer = null;
            send(conn, { type: 'auth.ok' });
            return;
          }

          if (conn.vkId === null) return; // до авторизации всё игнорируем

          if (msg.type === 'ping') {
            send(conn, { type: 'pong' });
          } else if (msg.type === 'subscribe' || msg.type === 'unsubscribe') {
            let topic: string | null = null;
            if (msg.topic === 'games') topic = 'games';
            else if (msg.topic === 'game' && Number.isInteger(msg.gameId) && (msg.gameId as number) > 0) {
              topic = `game:${msg.gameId as number}`;
            }
            if (!topic) return;
            if (msg.type === 'subscribe') conn.topics.add(topic);
            else conn.topics.delete(topic);
          }
        },
        onClose(): void {
          dispose(conn);
        },
      };
    },

    /** Рассылает событие подписчикам. Вызывать только после коммита транзакции. */
    publish(event: ServerEvent): void {
      const topic = event.type === 'roster.updated' ? `game:${event.game.id}` : 'games';
      for (const conn of conns) {
        if (conn.vkId !== null && conn.topics.has(topic)) send(conn, event);
      }
    },

    size(): number {
      return conns.size;
    },
  };
}

export type Hub = ReturnType<typeof createHub>;
