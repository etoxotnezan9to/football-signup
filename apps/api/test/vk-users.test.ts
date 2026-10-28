import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeScreenName, resolveScreenNames } from '../src/vk-users.ts';

describe('resolveScreenNames', () => {
  it('находит id пользователей по коротким именам через users.get', async () => {
    let body = '';
    const fetchImpl = (async (_url: string, init: { body: URLSearchParams }) => {
      body = init.body.toString();
      return new Response(JSON.stringify({ response: [{ id: 4321, screen_name: 'LFProject' }] }));
    }) as unknown as typeof fetch;
    const found = await resolveScreenNames(['@lfproject', 'nobody'], { serviceKey: 'key', fetchImpl });
    assert.deepEqual([...found], [['lfproject', 4321]]);
    assert.match(body, /user_ids=lfproject%2Cnobody/);
    assert.match(body, /access_token=key/);
  });

  it('ошибка VK — исключение; пустой список — без запроса', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: { error_code: 5, error_msg: 'auth failed' } }))) as unknown as typeof fetch;
    await assert.rejects(resolveScreenNames(['x'], { serviceKey: 'k', fetchImpl }), /users.get: 5/);
    const never = (async () => {
      throw new Error('не должно вызываться');
    }) as unknown as typeof fetch;
    assert.equal((await resolveScreenNames([], { serviceKey: 'k', fetchImpl: never })).size, 0);
  });

  it('normalizeScreenName', () => {
    assert.equal(normalizeScreenName(' @LFProject '), 'lfproject');
    assert.equal(normalizeScreenName('https://vk.com/lfproject'), 'lfproject');
    assert.equal(normalizeScreenName('m.vk.ru/LF'), 'lf');
  });
});
