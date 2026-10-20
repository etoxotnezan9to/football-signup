import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MOCK_PLAYER_BASE_ID, mockAuthHeader, mockPlayer, nextMockPlayers } from '../src/mock-players.ts';

describe('nextMockPlayers', () => {
  it('выдаёт игроков подряд, начиная с первого', () => {
    const ids = nextMockPlayers([], 30).map((p) => p.id);
    assert.equal(ids.length, 30);
    assert.equal(ids[0], MOCK_PLAYER_BASE_ID + 1);
    assert.equal(ids[29], MOCK_PLAYER_BASE_ID + 30);
  });

  it('пропускает тех, кто уже записан, и не трогает обычных пользователей', () => {
    const taken = [1001, mockPlayer(1).id, mockPlayer(3).id];
    assert.deepEqual(
      nextMockPlayers(taken, 3).map((p) => p.lastName),
      ['игрок 2', 'игрок 4', 'игрок 5'],
    );
  });
});

describe('mockAuthHeader', () => {
  it('кодирует имя и фамилию для заголовка Mock', () => {
    assert.equal(mockAuthHeader(mockPlayer(7)), `Mock ${MOCK_PLAYER_BASE_ID + 7}:%D0%A2%D0%B5%D1%81%D1%82%D0%BE%D0%B2%D1%8B%D0%B9:%D0%B8%D0%B3%D1%80%D0%BE%D0%BA%207`);
  });
});
