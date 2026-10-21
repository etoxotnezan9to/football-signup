// HTTP- и WebSocket-тесты поверх Fastify. Требуют установленных зависимостей (запускаются в CI).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { authenticateLaunchParams, buildApp } from '../src/app.ts';
import type { Config } from '../src/config.ts';
import { openDatabase } from '../src/db.ts';
import { createHub } from '../src/hub.ts';
import { createRateLimiter } from '../src/rate-limit.ts';
import { createService, type Service } from '../src/service.ts';
import { signLaunchParams } from '../src/vk-auth.ts';

const SECRET = 'test-secret';
const config: Config = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 0,
  databaseFile: ':memory:',
  migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
  vkAppId: 54809461,
  vkAppSecret: SECRET,
  vkServiceKey: '',
  notifyTimeZone: 'Europe/Moscow',
  authDevBypass: false,
  testMode: false,
};

function launch(userId: number): string {
  const p = new URLSearchParams({
    vk_user_id: String(userId),
    vk_app_id: String(config.vkAppId),
    vk_ts: String(Math.floor(Date.now() / 1000)),
    vk_platform: 'desktop_web',
  });
  p.set('sign', signLaunchParams(p, SECRET));
  return p.toString();
}

const auth = (userId: number) => ({ authorization: `VK ${launch(userId)}` });

const gameBody = (over: Record<string, unknown> = {}) => ({
  startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  placeId: placeId,
  feeRub: 650,
  teamsMax: 2, playersPerTeam: 2,
  ...over,
});

let placeId = 0;
let app: FastifyInstance;
let service: Service;

before(async () => {
  const db = openDatabase(':memory:', config.migrationsDir);
  const holder: { service: Service | null } = { service: null };
  const hub = createHub({
    authenticate: (lp) => (holder.service ? authenticateLaunchParams(config, lp, holder.service) : null),
  });
  service = createService(db, { emit: (e) => hub.publish(e) });
  holder.service = service;
  service.ensureUser(1);
  placeId = service.createPlace(1, { name: 'Орловский', address: 'Суздальское шоссе 62' }).place.id;
  app = buildApp({
    config,
    service,
    hub,
    limiter: createRateLimiter({ max: 1000, windowMs: 60_000 }),
    version: 'test',
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
});

after(async () => {
  await app.close();
});

describe('HTTP API', () => {
  it('GET /api/health без авторизации', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().status, 'ok');
  });

  it('401 без подписи и с поддельной подписью', async () => {
    const a = await app.inject({ method: 'GET', url: '/api/games' });
    assert.equal(a.statusCode, 401);
    assert.equal(a.json().error.code, 'UNAUTHORIZED');
    const b = await app.inject({
      method: 'GET',
      url: '/api/games',
      headers: { authorization: 'VK vk_user_id=1&sign=forged' },
    });
    assert.equal(b.statusCode, 401);
  });

  it('PUT /api/me сохраняет профиль, GET /api/me его возвращает', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/me',
      headers: auth(501),
      payload: { firstName: 'Иван', lastName: 'Петров' },
    });
    assert.equal(put.statusCode, 200);
    const get = await app.inject({ method: 'GET', url: '/api/me', headers: auth(501) });
    assert.equal(get.json().firstName, 'Иван');
    const bad = await app.inject({
      method: 'PUT',
      url: '/api/me',
      headers: auth(501),
      payload: { firstName: '' },
    });
    assert.equal(bad.statusCode, 400);
  });

  it('полный сценарий: создать игру, записаться, превысить лимит, отменить запись', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      headers: auth(601),
      payload: gameBody(),
    });
    assert.equal(created.statusCode, 201);
    const id = created.json().id as number;

    const join = await app.inject({
      method: 'PUT',
      url: `/api/games/${id}/signup`,
      headers: auth(602),
      payload: { seats: 3 },
    });
    assert.equal(join.statusCode, 200);
    assert.equal(join.json().signup.mainSeats, 3);

    const over = await app.inject({
      method: 'PUT',
      url: `/api/games/${id}/signup`,
      headers: auth(602),
      payload: { seats: 6 },
    });
    assert.equal(over.statusCode, 422);
    assert.equal(over.json().error.code, 'SEATS_LIMIT_EXCEEDED');

    const list = await app.inject({ method: 'GET', url: '/api/games', headers: auth(602) });
    const item = (list.json().items as { id: number; mySeats: number }[]).find((g) => g.id === id);
    assert.equal(item?.mySeats, 3);

    const del = await app.inject({ method: 'DELETE', url: `/api/games/${id}/signup`, headers: auth(602) });
    assert.equal(del.statusCode, 200);
    assert.equal(del.json().taken, 0);
  });

  it('команды: переименование и распределение, полная команда даёт 409 TEAM_FULL', async () => {
    const g = await app.inject({
      method: 'POST',
      url: '/api/games',
      headers: auth(901),
      payload: gameBody({ teamsMax: 2, playersPerTeam: 1 }),
    });
    const id = g.json().id;
    const join = await app.inject({
      method: 'PUT',
      url: `/api/games/${id}/signup`,
      headers: auth(902),
      payload: { seats: 2 },
    });
    const s1 = join.json().signup.signupId;
    const rename = await app.inject({
      method: 'PUT',
      url: `/api/games/${id}/teams/1`,
      headers: auth(901),
      payload: { name: 'Ветераны' },
    });
    assert.equal(rename.statusCode, 200);
    assert.equal(rename.json().teams[0].name, 'Ветераны');
    const put = (seat: number, teamNo: number | null, user = 901) =>
      app.inject({
        method: 'PUT',
        url: `/api/games/${id}/team-assignment`,
        headers: auth(user),
        payload: { signupId: s1, seat, teamNo },
      });
    const first = await put(1, 1);
    assert.equal(first.statusCode, 200);
    assert.deepEqual(first.json().teams[0].members, [{ signupId: s1, seat: 1 }]);
    const full = await put(2, 1);
    assert.equal(full.statusCode, 409);
    assert.equal(full.json().error.code, 'TEAM_FULL');
    assert.equal((await put(2, 2, 902)).statusCode, 403);
  });

  it('GET /api/rating отдаёт список игроков', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/rating', headers: auth(921) });
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.json().items));
    assert.equal((await app.inject({ method: 'GET', url: '/api/rating' })).statusCode, 401);
  });

  it('счёт матча: PUT записывает, DELETE стирает, чужой — 403', async () => {
    const g = await app.inject({
      method: 'POST',
      url: '/api/games',
      headers: auth(911),
      payload: gameBody({ teamsMax: 2, playersPerTeam: 2 }),
    });
    const id = g.json().id;
    const put = await app.inject({
      method: 'PUT',
      url: `/api/games/${id}/matches/2/1/1`,
      headers: auth(911),
      payload: { goalsA: 4, goalsB: 2 },
    });
    assert.equal(put.statusCode, 200);
    assert.deepEqual(put.json().results, [{ teamA: 1, teamB: 2, leg: 1, goalsA: 2, goalsB: 4 }]);
    const other = await app.inject({
      method: 'PUT',
      url: `/api/games/${id}/matches/1/2/1`,
      headers: auth(912),
      payload: { goalsA: 0, goalsB: 0 },
    });
    assert.equal(other.statusCode, 403);
    const del = await app.inject({ method: 'DELETE', url: `/api/games/${id}/matches/1/2/1`, headers: auth(911) });
    assert.equal(del.statusCode, 200);
    assert.deepEqual(del.json().results, []);
  });

  it('конфигурация и тестовые игроки выключены без тестового режима', async () => {
    const cfg = await app.inject({ method: 'GET', url: '/api/config', headers: auth(801) });
    assert.equal(cfg.statusCode, 200);
    assert.deepEqual(cfg.json(), { testMode: false });
    const g = await app.inject({ method: 'POST', url: '/api/games', headers: auth(801), payload: gameBody() });
    const add = await app.inject({
      method: 'POST',
      url: `/api/games/${g.json().id}/test-players`,
      headers: auth(801),
      payload: { count: 5 },
    });
    assert.equal(add.statusCode, 403);
  });

  it('места: создать, получить список, выбрать в игре', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/places',
      headers: auth(701),
      payload: { name: 'Арена-701', address: 'ул. Новая, 7' },
    });
    assert.equal(created.statusCode, 201);
    const place = created.json() as { id: number; name: string; address: string };
    assert.equal(place.name, 'Арена-701');

    const again = await app.inject({
      method: 'POST',
      url: '/api/places',
      headers: auth(702),
      payload: { name: 'Арена-701', address: 'ул. Новая, 7' },
    });
    assert.equal(again.statusCode, 200);
    assert.equal(again.json().id, place.id);

    const bad = await app.inject({
      method: 'POST',
      url: '/api/places',
      headers: auth(701),
      payload: { name: '' },
    });
    assert.equal(bad.statusCode, 400);
    assert.ok('address' in bad.json().error.details);

    const list = await app.inject({ method: 'GET', url: '/api/places', headers: auth(702) });
    assert.equal(list.statusCode, 200);
    assert.ok((list.json().items as { id: number }[]).some((p) => p.id === place.id));

    const game = await app.inject({
      method: 'POST',
      url: '/api/games',
      headers: auth(701),
      payload: gameBody({ placeId: place.id }),
    });
    assert.equal(game.statusCode, 201);
    assert.equal(game.json().placeId, place.id);
    assert.equal(game.json().venue, 'Арена-701');
    assert.equal(game.json().address, 'ул. Новая, 7');

    const missing = await app.inject({
      method: 'POST',
      url: '/api/games',
      headers: auth(701),
      payload: gameBody({ placeId: 999_999 }),
    });
    assert.equal(missing.statusCode, 400);
    assert.equal(missing.json().error.details.placeId, 'место не найдено');
  });

  it('права: чужой не может отменить игру; организатор может', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      headers: auth(611),
      payload: gameBody(),
    });
    const id = created.json().id as number;
    const denied = await app.inject({ method: 'POST', url: `/api/games/${id}/cancel`, headers: auth(612) });
    assert.equal(denied.statusCode, 403);
    const ok = await app.inject({ method: 'POST', url: `/api/games/${id}/cancel`, headers: auth(611) });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().status, 'cancelled');
    const join = await app.inject({
      method: 'PUT',
      url: `/api/games/${id}/signup`,
      headers: auth(612),
      payload: { seats: 1 },
    });
    assert.equal(join.statusCode, 409);
  });

  it('валидация: плохое тело и неизвестная игра', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/games',
      headers: auth(621),
      payload: { placeId: 0 },
    });
    assert.equal(bad.statusCode, 400);
    assert.ok(bad.json().error.details.placeId);
    const nf = await app.inject({ method: 'GET', url: '/api/games/999999', headers: auth(621) });
    assert.equal(nf.statusCode, 404);
    const nan = await app.inject({ method: 'GET', url: '/api/games/abc', headers: auth(621) });
    assert.equal(nan.statusCode, 404);
    const broken = await app.inject({
      method: 'POST',
      url: '/api/games',
      headers: { ...auth(621), 'content-type': 'application/json' },
      payload: '{not json',
    });
    assert.equal(broken.statusCode, 400);
  });

  it('лимитер возвращает 429 при превышении', async () => {
    const db = openDatabase(':memory:', config.migrationsDir);
    const svc = createService(db);
    const hub = createHub({ authenticate: () => null });
    const limited = buildApp({
      config,
      service: svc,
      hub,
      limiter: createRateLimiter({ max: 2, windowMs: 60_000 }),
      version: 'test',
    });
    const headers = auth(701);
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await limited.inject({ method: 'PUT', url: '/api/me', headers, payload: { firstName: 'А' } });
      codes.push(r.statusCode);
    }
    assert.deepEqual(codes, [200, 200, 429]);
    await limited.close();
  });
});

describe('WebSocket', () => {
  it('подписчик получает game.created и roster.updated без перезагрузки', async () => {
    const port = (app.server.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const received: { type: string; game?: { id: number } }[] = [];
    ws.addEventListener('message', (m) => received.push(JSON.parse(String(m.data))));
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', () => reject(new Error('ws error')));
    });

    ws.send(JSON.stringify({ type: 'auth', launchParams: launch(801) }));
    await waitFor(() => received.some((m) => m.type === 'auth.ok'));
    ws.send(JSON.stringify({ type: 'subscribe', topic: 'games' }));

    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      headers: auth(802),
      payload: gameBody(),
    });
    const id = created.json().id as number;
    await waitFor(() => received.some((m) => m.type === 'game.created' && m.game?.id === id));

    ws.send(JSON.stringify({ type: 'subscribe', topic: 'game', gameId: id }));
    await new Promise((r) => setTimeout(r, 50));
    await app.inject({
      method: 'PUT',
      url: `/api/games/${id}/signup`,
      headers: auth(803),
      payload: { seats: 2 },
    });
    await waitFor(() => received.some((m) => m.type === 'roster.updated' && m.game?.id === id));
    ws.close();
  });

  it('dev-авторизация mock: принимается только при authDevBypass', async () => {
    const db = openDatabase(':memory:', config.migrationsDir);
    const svc = createService(db);
    assert.equal(authenticateLaunchParams(config, 'mock:5:A:B', svc), null);
    assert.equal(authenticateLaunchParams({ ...config, authDevBypass: true }, 'mock:5:A:B', svc), 5);
    assert.equal(authenticateLaunchParams({ ...config, authDevBypass: true }, 'mock:x:A:B', svc), null);
  });

  it('неверная авторизация закрывает соединение', async () => {
    const port = (app.server.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const closed = new Promise<number>((resolve) => ws.addEventListener('close', (e) => resolve(e.code)));
    await new Promise<void>((resolve) => ws.addEventListener('open', () => resolve()));
    ws.send(JSON.stringify({ type: 'auth', launchParams: 'vk_user_id=1&sign=bad' }));
    assert.equal(await closed, 4401);
  });
});

async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('таймаут ожидания события');
    await new Promise((r) => setTimeout(r, 20));
  }
}
