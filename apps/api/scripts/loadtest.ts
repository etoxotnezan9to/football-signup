// Нагрузочный тест: много «пользователей» одновременно записываются на одну игру, пока наблюдатели
// слушают WebSocket. Проверяет главное требование: вместимость состава не превышена ни при каких гонках,
// сервер не отвечает ошибками 5xx, а все наблюдатели получают итоговый состав.
//
// Запуск против сервера с AUTH_DEV_BYPASS=1 (вне production):
//   node scripts/loadtest.ts [--base http://127.0.0.1:3000] [--users 200] [--observers 20]
// Код возврата 0 — все проверки пройдены, 1 — есть нарушения.

export {};

interface Roster {
  id: number;
  capacity: number;
  taken: number;
  queued: number;
  roster: { seats: number; mainSeats: number; queueSeats: number; user: { vkId: number } }[];
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const BASE = arg('base', 'http://127.0.0.1:3000').replace(/\/$/, '');
const USERS = Number(arg('users', '200'));
const OBSERVERS = Number(arg('observers', '20'));
// 4 команды по 6 игроков: вместимость сервер считает как их произведение
const TEAMS = 4;
const PLAYERS_PER_TEAM = 6;
const CAPACITY = TEAMS * PLAYERS_PER_TEAM;
const ORGANIZER = 900_000;

const failures: string[] = [];
const check = (ok: boolean, message: string): void => {
  if (!ok) failures.push(message);
};

const mockAuth = (id: number): string =>
  `${id}:${encodeURIComponent('Нагрузка')}:${encodeURIComponent(String(id))}`;

const latencies: number[] = [];
const statuses = new Map<number, number>();

async function call(
  method: string,
  path: string,
  userId: number,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const started = performance.now();
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    // content-type только вместе с телом: Fastify отвергает пустое тело при заголовке application/json
    headers: {
      authorization: `Mock ${mockAuth(userId)}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  latencies.push(performance.now() - started);
  statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

interface Observer {
  last: Roster | null;
  events: number;
  close(): void;
}

async function observe(gameId: number, userId: number): Promise<Observer> {
  const wsUrl = BASE.replace(/^http/, 'ws') + '/ws';
  const ws = new WebSocket(wsUrl);
  const obs: Observer = { last: null, events: 0, close: () => ws.close() };
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket: нет auth.ok за 5 с')), 5000);
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(String(e.data)) as { type: string; game?: Roster };
      if (msg.type === 'auth.ok') {
        ws.send(JSON.stringify({ type: 'subscribe', topic: 'game', gameId }));
        clearTimeout(timer);
        resolve();
      } else if (msg.type === 'roster.updated' && msg.game) {
        obs.last = msg.game;
        obs.events += 1;
      }
    });
    ws.addEventListener('error', () => reject(new Error('WebSocket: ошибка соединения')));
    ws.addEventListener('open', () =>
      ws.send(JSON.stringify({ type: 'auth', launchParams: `mock:${mockAuth(userId)}` })),
    );
  });
  return obs;
}

async function main(): Promise<void> {
  const startsAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const place = await call('POST', '/places', ORGANIZER, { name: 'Тест', address: 'Тест' });
  check(place.status === 201 || place.status === 200, `создание места вернуло ${place.status}`);
  const placeId = (place.json as { id: number }).id;
  const created = await call('POST', '/games', ORGANIZER, {
    startsAt,
    placeId,
    feeRub: 0,
    teamsMax: TEAMS,
    playersPerTeam: PLAYERS_PER_TEAM,
  });
  check(created.status === 201, `создание игры вернуло ${created.status}`);
  const gameId = (created.json as { id: number }).id;

  const observers = await Promise.all(
    Array.from({ length: OBSERVERS }, (_, i) => observe(gameId, 800_000 + i)),
  );

  // Все записываются одновременно; число мест детерминировано, чтобы ожидаемый итог был известен заранее
  const wanted = Array.from({ length: USERS }, (_, i) => 1 + (i % 5));
  const started = performance.now();
  const results = await Promise.all(
    wanted.map((seats, i) => call('PUT', `/games/${gameId}/signup`, 1000 + i, { seats })),
  );
  const writeMs = performance.now() - started;
  check(
    results.every((r) => r.status === 200),
    `не все записи прошли: ${JSON.stringify([...statuses])}`,
  );

  // Часть пользователей передумала: освободившиеся места должны достаться очереди без превышения
  const leavers = Array.from({ length: Math.floor(USERS / 4) }, (_, i) => i * 4);
  const leave = await Promise.all(leavers.map((i) => call('DELETE', `/games/${gameId}/signup`, 1000 + i)));
  check(
    leave.every((r) => r.status === 200),
    'не все отмены прошли',
  );

  const leaverSet = new Set(leavers);
  const expectedTotal = wanted.reduce((sum, seats, i) => sum + (leaverSet.has(i) ? 0 : seats), 0);

  const final = (await call('GET', `/games/${gameId}`, ORGANIZER)).json as Roster;
  check(final.taken <= CAPACITY, `состав превышен: ${final.taken} > ${CAPACITY}`);
  check(
    final.taken === Math.min(CAPACITY, expectedTotal),
    `в составе ${final.taken}, ожидалось ${Math.min(CAPACITY, expectedTotal)}`,
  );
  check(
    final.taken + final.queued === expectedTotal,
    `всего мест ${final.taken + final.queued}, ожидалось ${expectedTotal}`,
  );
  check(
    final.roster.every((e) => e.mainSeats + e.queueSeats === e.seats),
    'у записи mainSeats + queueSeats != seats',
  );
  check(
    final.roster.length === USERS - leavers.length,
    `записей ${final.roster.length}, ожидалось ${USERS - leavers.length}`,
  );

  // Наблюдатели получают итоговый состав (даём секунду на доставку последних событий)
  const deadline = Date.now() + 5000;
  while (
    Date.now() < deadline &&
    observers.some((o) => o.last?.taken !== final.taken || o.last?.queued !== final.queued)
  ) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const stale = observers.filter(
    (o) => o.last?.taken !== final.taken || o.last?.queued !== final.queued,
  ).length;
  check(stale === 0, `${stale} из ${OBSERVERS} наблюдателей не получили итоговый состав`);
  observers.forEach((o) => o.close());

  const has5xx = [...statuses.keys()].some((s) => s >= 500);
  check(!has5xx, `были ответы 5xx: ${JSON.stringify([...statuses])}`);

  console.log(
    JSON.stringify({
      users: USERS,
      observers: OBSERVERS,
      requests: latencies.length,
      statuses: Object.fromEntries(statuses),
      writeBurstMs: Math.round(writeMs),
      p50Ms: Math.round(percentile(latencies, 50)),
      p95Ms: Math.round(percentile(latencies, 95)),
      p99Ms: Math.round(percentile(latencies, 99)),
      finalTaken: final.taken,
      finalQueued: final.queued,
      eventsPerObserver: Math.round(observers.reduce((s, o) => s + o.events, 0) / Math.max(1, OBSERVERS)),
    }),
  );
}

try {
  await main();
} catch (err) {
  failures.push(`сбой теста: ${err instanceof Error ? err.message : String(err)}`);
}

if (failures.length > 0) {
  console.error('НАРУШЕНИЯ:\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log('OK: нагрузочный тест пройден');
