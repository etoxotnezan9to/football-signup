import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createVkNotifier, type Notification } from '../src/notifier.ts';

interface Call {
  url: string;
  form: URLSearchParams;
}

function fakeFetch(reply: unknown | (() => unknown), calls: Call[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), form: new URLSearchParams(String(init?.body)) });
    const body = typeof reply === 'function' ? (reply as () => unknown)() : reply;
    return { json: async () => body } as Response;
  }) as typeof fetch;
}

function logger() {
  const info: object[] = [];
  const warn: object[] = [];
  return { info, warn, log: { info: (o: object) => void info.push(o), warn: (o: object) => void warn.push(o) } };
}

const note = (over: Partial<Notification> = {}): Notification => ({
  userIds: [1, 2],
  message: 'Вы в составе!',
  fragment: '/game/7',
  ...over,
});

describe('VK-уведомления', () => {
  it('отправляет POST с ключом в теле, получателями и ссылкой на экран игры', async () => {
    const calls: Call[] = [];
    const n = createVkNotifier({
      serviceKey: 'SERVICE-KEY',
      fetchImpl: fakeFetch({ response: [{ user_id: 1, status: true }, { user_id: 2, status: true }] }, calls),
    });
    n.notify(note());
    await n.flush();
    assert.equal(calls.length, 1);
    const call = calls[0]!;
    assert.match(call.url, /api\.vk\.com\/method\/notifications\.sendMessage$/);
    assert.equal(call.form.get('user_ids'), '1,2');
    assert.equal(call.form.get('message'), 'Вы в составе!');
    assert.equal(call.form.get('fragment'), '/game/7');
    assert.equal(call.form.get('access_token'), 'SERVICE-KEY');
    assert.match(call.form.get('random_id') ?? '', /^\d+$/);
    assert.ok(!call.url.includes('SERVICE-KEY'), 'ключ не должен попадать в адрес запроса');
  });

  it('разбивает получателей на пачки по 100 и убирает дубликаты и мусорные id', async () => {
    const calls: Call[] = [];
    const n = createVkNotifier({ serviceKey: 'k', fetchImpl: fakeFetch({ response: [] }, calls) });
    const ids = Array.from({ length: 230 }, (_, i) => i + 1);
    n.notify(note({ userIds: [...ids, ...ids, 0, -5, 1.5] }));
    await n.flush();
    assert.deepEqual(
      calls.map((c) => (c.form.get('user_ids') ?? '').split(',').length),
      [100, 100, 30],
    );
    const rand = new Set(calls.map((c) => c.form.get('random_id')));
    assert.equal(rand.size, calls.length, 'random_id уникален для каждого вызова');
  });

  it('обрезает слишком длинный текст до лимита VK', async () => {
    const calls: Call[] = [];
    const n = createVkNotifier({ serviceKey: 'k', fetchImpl: fakeFetch({ response: [] }, calls) });
    n.notify(note({ message: 'я'.repeat(500) }));
    await n.flush();
    assert.equal((calls[0]!.form.get('message') ?? '').length, 254);
  });

  it('не вызывает VK без получателей или с пустым текстом', async () => {
    const calls: Call[] = [];
    const n = createVkNotifier({ serviceKey: 'k', fetchImpl: fakeFetch({ response: [] }, calls) });
    n.notify(note({ userIds: [] }));
    n.notify(note({ message: '   ' }));
    await n.flush();
    assert.equal(calls.length, 0);
  });

  it('ожидаемые отказы (лимиты, уведомления выключены) пишет как info, прочие как warn', async () => {
    const l = logger();
    const n = createVkNotifier({
      serviceKey: 'k',
      log: l.log,
      fetchImpl: fakeFetch(
        {
          response: [
            { user_id: 1, status: false, error: { code: 1, description: 'disabled' } },
            { user_id: 2, status: false, error: { code: 2, description: 'hour' } },
            { user_id: 3, status: false, error: { code: 99, description: 'boom' } },
          ],
        },
        [],
      ),
    });
    n.notify(note({ userIds: [1, 2, 3] }));
    await n.flush();
    assert.equal(l.info.length, 2);
    assert.equal(l.warn.length, 1);
  });

  it('ошибка уровня запроса (например, неверный ключ) логируется и не выбрасывается', async () => {
    const l = logger();
    const n = createVkNotifier({
      serviceKey: 'k',
      log: l.log,
      fetchImpl: fakeFetch({ error: { error_code: 5, error_msg: 'invalid token' } }, []),
    });
    n.notify(note());
    await n.flush();
    assert.equal(l.warn.length, 1);
  });

  it('сетевой сбой не выбрасывается и не раскрывает ключ в логе', async () => {
    const l = logger();
    const n = createVkNotifier({
      serviceKey: 'TOP-SECRET',
      log: l.log,
      fetchImpl: (async () => {
        throw new Error('connect ECONNREFUSED');
      }) as typeof fetch,
    });
    n.notify(note());
    await n.flush();
    assert.equal(l.warn.length, 1);
    assert.ok(!JSON.stringify(l.warn).includes('TOP-SECRET'));
  });
});
