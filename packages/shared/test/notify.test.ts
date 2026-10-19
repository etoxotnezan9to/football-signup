import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clipMessage, groupUsersBy, promotionsBetween, NOTIFICATION_MAX_LENGTH } from '../src/notify.ts';

describe('promotionsBetween', () => {
  it('находит тех, у кого прибавилось мест в составе', () => {
    const before = { 1: 3, 2: 1 };
    const after = { 1: 3, 2: 3, 3: 2 };
    assert.deepEqual(promotionsBetween(before, after), [
      { userId: 2, gained: 2, total: 3 },
      { userId: 3, gained: 2, total: 2 },
    ]);
  });

  it('не уведомляет инициатора изменения', () => {
    assert.deepEqual(promotionsBetween({}, { 5: 2, 6: 1 }, 5), [{ userId: 6, gained: 1, total: 1 }]);
  });

  it('ничего не возвращает, если места не прибавились или стали меньше', () => {
    assert.deepEqual(promotionsBetween({ 1: 3, 2: 2 }, { 1: 3, 2: 1 }), []);
    assert.deepEqual(promotionsBetween({}, {}), []);
  });
});

describe('groupUsersBy', () => {
  it('группирует пользователей по числу мест и сортирует id', () => {
    const groups = groupUsersBy({ 9: 2, 3: 1, 7: 2, 1: 1 });
    assert.deepEqual(groups.get(1), [1, 3]);
    assert.deepEqual(groups.get(2), [7, 9]);
    assert.equal(groups.size, 2);
  });
});

describe('clipMessage', () => {
  it('схлопывает пробелы и переводы строк', () => {
    assert.equal(clipMessage('  Игра \n «Чт»   отменена '), 'Игра «Чт» отменена');
  });

  it('не трогает короткий текст', () => {
    assert.equal(clipMessage('ok'), 'ok');
  });

  it('обрезает до лимита и добавляет многоточие', () => {
    const out = clipMessage('а'.repeat(400));
    assert.equal(out.length, NOTIFICATION_MAX_LENGTH);
    assert.ok(out.endsWith('…'));
  });

  it('не разрывает эмодзи при обрезке', () => {
    const out = clipMessage('⚽'.repeat(300), 20);
    assert.equal(Array.from(out).length, 20);
    assert.ok(!out.includes('�'));
    assert.doesNotMatch(out, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});
