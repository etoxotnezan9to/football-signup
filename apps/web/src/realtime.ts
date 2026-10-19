// Клиент WebSocket: авторизация, подписки, переподключение с задержкой и запасной опрос REST.
import type { ServerEvent } from '@football/shared';

export type ConnStatus = 'connecting' | 'online' | 'offline' | 'polling';

const POLL_INTERVAL_MS = 5000;
const MAX_FAILED_BEFORE_POLLING = 3;

export interface Realtime {
  subscribe(topic: string): () => void;
  onEvent(fn: (e: ServerEvent) => void): () => void;
  /** Вызывается после (пере)подключения и на каждом тике опроса: пора перезагрузить данные по REST */
  onRefresh(fn: () => void): () => void;
  onStatus(fn: (s: ConnStatus) => void): () => void;
  /** Принудительное переподключение (возврат приложения на передний план) */
  reconnectNow(): void;
  status(): ConnStatus;
  close(): void;
}

function topicMessage(type: 'subscribe' | 'unsubscribe', topic: string): string {
  if (topic === 'games') return JSON.stringify({ type, topic: 'games' });
  return JSON.stringify({ type, topic: 'game', gameId: Number(topic.split(':')[1]) });
}

export function createRealtime(wsAuth: string): Realtime {
  const topics = new Map<string, number>();
  const eventListeners = new Set<(e: ServerEvent) => void>();
  const refreshListeners = new Set<() => void>();
  const statusListeners = new Set<(s: ConnStatus) => void>();

  let ws: WebSocket | null = null;
  let status: ConnStatus = 'connecting';
  let failed = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  let authed = false;

  function setStatus(s: ConnStatus): void {
    if (status === s) return;
    status = s;
    for (const fn of statusListeners) fn(s);
  }

  function refresh(): void {
    for (const fn of refreshListeners) fn();
  }

  function startPolling(): void {
    if (pollTimer) return;
    pollTimer = setInterval(refresh, POLL_INTERVAL_MS);
  }

  function stopPolling(): void {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function scheduleRetry(): void {
    if (closed || retryTimer) return;
    const base = Math.min(15_000, 1000 * 2 ** Math.min(failed, 4));
    const delay = base / 2 + Math.random() * (base / 2);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, delay);
  }

  function connect(): void {
    if (closed) return;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    authed = false;
    setStatus(failed >= MAX_FAILED_BEFORE_POLLING ? 'polling' : 'connecting');
    const socket = new WebSocket(`${proto}://${window.location.host}/ws`);
    ws = socket;

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'auth', launchParams: wsAuth }));
    });

    socket.addEventListener('message', (m) => {
      let msg: { type?: string };
      try {
        msg = JSON.parse(String(m.data)) as { type?: string };
      } catch {
        return;
      }
      if (msg.type === 'auth.ok') {
        authed = true;
        failed = 0;
        stopPolling();
        setStatus('online');
        for (const topic of topics.keys()) socket.send(topicMessage('subscribe', topic));
        refresh(); // догружаем всё, что могло пройти за время разрыва
      } else if (
        msg.type === 'game.created' ||
        msg.type === 'game.updated' ||
        msg.type === 'roster.updated'
      ) {
        for (const fn of eventListeners) fn(msg as ServerEvent);
      }
    });

    socket.addEventListener('close', () => {
      if (ws === socket) ws = null;
      if (closed) return;
      if (!authed) failed += 1;
      if (failed >= MAX_FAILED_BEFORE_POLLING) {
        setStatus('polling');
        startPolling();
      } else {
        setStatus('offline');
      }
      scheduleRetry();
    });
  }

  connect();

  const ping = setInterval(() => {
    if (ws && authed && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
  }, 25_000);

  return {
    subscribe(topic) {
      topics.set(topic, (topics.get(topic) ?? 0) + 1);
      if (ws && authed && ws.readyState === WebSocket.OPEN) ws.send(topicMessage('subscribe', topic));
      return () => {
        const n = (topics.get(topic) ?? 1) - 1;
        if (n <= 0) {
          topics.delete(topic);
          if (ws && authed && ws.readyState === WebSocket.OPEN) ws.send(topicMessage('unsubscribe', topic));
        } else {
          topics.set(topic, n);
        }
      };
    },
    onEvent(fn) {
      eventListeners.add(fn);
      return () => eventListeners.delete(fn);
    },
    onRefresh(fn) {
      refreshListeners.add(fn);
      return () => refreshListeners.delete(fn);
    },
    onStatus(fn) {
      statusListeners.add(fn);
      return () => statusListeners.delete(fn);
    },
    reconnectNow() {
      if (closed) return;
      if (ws && ws.readyState === WebSocket.OPEN && authed) {
        refresh();
        return;
      }
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      ws?.close();
      failed = Math.min(failed, MAX_FAILED_BEFORE_POLLING - 1);
      connect();
    },
    status: () => status,
    close() {
      closed = true;
      clearInterval(ping);
      stopPolling();
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    },
  };
}
