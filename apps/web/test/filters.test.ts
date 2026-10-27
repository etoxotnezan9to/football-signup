import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_FILTERS, activeFiltersCount, filtersQuery, parseFilters } from '../src/filters.ts';

describe('parseFilters', () => {
  it('значения по умолчанию: все арены, без прошедших, с отменёнными', () => {
    assert.deepEqual(parseFilters(null), DEFAULT_FILTERS);
    assert.deepEqual(DEFAULT_FILTERS, { placeId: null, showPast: false, showCancelled: true });
    assert.deepEqual(parseFilters('{мусор'), DEFAULT_FILTERS);
  });

  it('читает сохранённое и прежний ключ с ареной', () => {
    assert.deepEqual(parseFilters('{"placeId":3,"showPast":true,"showCancelled":false}'), {
      placeId: 3,
      showPast: true,
      showCancelled: false,
    });
    assert.equal(parseFilters(null, '5').placeId, 5, 'перенос старого фильтра арены');
    assert.equal(parseFilters('{"placeId":-1}').placeId, null);
  });
});

describe('filtersQuery / activeFiltersCount', () => {
  it('в запрос попадают только отличия от значений по умолчанию', () => {
    assert.equal(filtersQuery(DEFAULT_FILTERS), '');
    assert.equal(activeFiltersCount(DEFAULT_FILTERS), 0);
    const f = { placeId: 4, showPast: true, showCancelled: false };
    assert.equal(filtersQuery(f), '&includePast=1&includeCancelled=0&placeId=4');
    assert.equal(activeFiltersCount(f), 3);
  });
});
