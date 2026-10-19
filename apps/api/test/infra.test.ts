import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHub, type HubSocket } from '../src/hub.ts';
import { createRateLimiter } from '../src/rate-limit.ts';
import { signLaunchParams, verifyLaunchParams } from '../src/vk-auth.ts';
import type { GameDetails, GameSummary } from '@football/shared';

const SECRET = 'test-secret-key';
const NOW = 1_800_000_000;

function launch(over: Record<string, string> = {}, secret = SECRET): string {
  const p = new URLSearchParams({
    vk_user_id: '42',
    vk_app_id: '54809461',
    vk_ts: String(NOW - 10),
    vk_is_app_user: '1',
    vk_language: 'ru',
    vk_platform: 'desktop_web',
    ...over,
  });
  p.set('sign', signLaunchParams(p, secret));
  return p.toString();
}

const opts = { appId: 54809461, nowSec: NOW, maxAgeSec: 86_400 };

describe('verifyLaunchParams', () => {
  it('принимает валидную подпись', () => {
    assert.deepEqual(verifyLaunchParams(launch(), SECRET, opts), { ok: true, vkId: 42 });
  });

  it('принимает строку с ведущим «?»', () => {
    assert.equal(verifyLaunchParams('?' + launch(), SECRET, opts).ok, true);
  });

  it('отвергает подделанный параметр и чужой ключ', () => {
    const forged = launch().replace('vk_user_id=42', 'vk_user_id=43');
    assert.equal(verifyLaunchParams(forged, SECRET, opts).ok, false);
    assert.equal(verifyLaunchParams(launch({}, 'other'), SECRET, opts).ok, false);
  });

  it('отвергает отсутствующую подпись и мусор', () => {
    assert.equal(verifyLaunchParams('vk_user_id=42', SECRET, opts).ok, false);
    assert.equal(verifyLaunchParams('', SECRET, opts).ok, false);
    assert.equal(verifyLaunchParams('x'.repeat(5000), SECRET, opts).ok, false);
  });

  it('отвергает устаревшие параметры и чужое приложение', () => {
    assert.equal(verifyLaunchParams(launch({ vk_ts: String(NOW - 90_000) }), SECRET, opts).ok, false);
    assert.equal(verifyLaunchParams(launch({ vk_app_id: '1' }), SECRET, opts).ok, false);
  });

  it('не-vk параметры не влияют на подпись', () => {
    const extra = launch() + '&utm=1';
    assert.equal(verifyLaunchParams(extra, SECRET, opts).ok, true);
  });
});

describe('createRateLimiter', () => {
  it('пропускает max запросов в окне, затем отказывает, затем снова пропускает', () => {
    let t = 0;
    const rl = createRateLimiter({ max: 3, windowMs: 1000, now: () => t });
    assert.deepEqual([rl.take('a'), rl.take('a'), rl.take('a'), rl.take('a')], [true, true, true, false]);
    assert.equal(rl.take('b'), true);
    t = 1001;
    assert.equal(rl.take('a'), true);
  });
});

function fakeSocket() {
  const sent: unknown[] = [];
  const state = { closed: null as number | null };
  const socket: HubSocket = {
    send: (d) => sent.push(JSON.parse(d)),
    close: (c) => {
      state.closed = c ?? 1000;
    },
  };
  return { socket, sent, state };
}

const summary = (id: number): GameSummary => ({
  id,
  title: 'g',
  startsAt: '2026-10-22T18:00:00.000Z',
  placeId: 1,
  venue: 'v',
  feeRub: 1,
  capacity: 4,
  status: 'active',
  isFinished: false,
  taken: 0,
  queued: 0,
  organizer: { vkId: 1, firstName: 'a', lastName: 'b', photoUrl: null },
});

describe('hub', () => {
  const authenticate = (lp: string) => (lp === 'good' ? 7 : null);

  it('до авторизации подписки игнорируются, после — работают', () => {
    const hub = createHub({ authenticate });
    const c = fakeSocket();
    const conn = hub.connect(c.socket);
    conn.onMessage(JSON.stringify({ type: 'subscribe', topic: 'games' }));
    hub.publish({ type: 'game.created', game: summary(1) });
    assert.equal(c.sent.length, 0);
    conn.onMessage(JSON.stringify({ type: 'auth', launchParams: 'good' }));
    conn.onMessage(JSON.stringify({ type: 'subscribe', topic: 'games' }));
    hub.publish({ type: 'game.created', game: summary(1) });
    assert.deepEqual(
      c.sent.map((m) => (m as { type: string }).type),
      ['auth.ok', 'game.created'],
    );
  });

  it('неверная авторизация закрывает соединение с кодом 4401', () => {
    const hub = createHub({ authenticate });
    const c = fakeSocket();
    hub.connect(c.socket).onMessage(JSON.stringify({ type: 'auth', launchParams: 'bad' }));
    assert.equal(c.state.closed, 4401);
    assert.equal(hub.size(), 0);
  });

  it('roster.updated доставляется только подписчикам нужной игры', () => {
    const hub = createHub({ authenticate });
    const a = fakeSocket();
    const b = fakeSocket();
    for (const [c, gameId] of [
      [a, 1],
      [b, 2],
    ] as const) {
      const conn = hub.connect(c.socket);
      conn.onMessage(JSON.stringify({ type: 'auth', launchParams: 'good' }));
      conn.onMessage(JSON.stringify({ type: 'subscribe', topic: 'game', gameId }));
    }
    hub.publish({
      type: 'roster.updated',
      game: {
        ...summary(1),
        roster: [],
        address: '',
        format: '',
        description: '',
        paymentInfo: '',
        organizerContact: '',
      } as GameDetails,
    });
    assert.equal(a.sent.filter((m) => (m as { type: string }).type === 'roster.updated').length, 1);
    assert.equal(b.sent.filter((m) => (m as { type: string }).type === 'roster.updated').length, 0);
  });

  it('отписка, ping/pong, мусорные сообщения и закрытие', () => {
    const hub = createHub({ authenticate });
    const c = fakeSocket();
    const conn = hub.connect(c.socket);
    conn.onMessage('не json');
    conn.onMessage(JSON.stringify({ type: 'auth', launchParams: 'good' }));
    conn.onMessage(JSON.stringify({ type: 'ping' }));
    conn.onMessage(JSON.stringify({ type: 'subscribe', topic: 'game', gameId: 'x' }));
    conn.onMessage(JSON.stringify({ type: 'subscribe', topic: 'games' }));
    conn.onMessage(JSON.stringify({ type: 'unsubscribe', topic: 'games' }));
    hub.publish({ type: 'game.updated', game: summary(1) });
    assert.deepEqual(
      c.sent.map((m) => (m as { type: string }).type),
      ['auth.ok', 'pong'],
    );
    conn.onClose();
    assert.equal(hub.size(), 0);
  });
});
