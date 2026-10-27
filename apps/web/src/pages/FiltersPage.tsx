import { useEffect, useState } from 'react';
import { Button, Checkbox, CustomSelect, FormItem, Group, PanelHeader, PanelHeaderBack } from '@vkontakte/vkui';
import type { Place } from '@football/shared';
import { api } from '../api.ts';
import { useApp } from '../context.ts';
import { DEFAULT_FILTERS, activeFiltersCount, setFilters, useListFilters } from '../filters.ts';
import { routeToHash } from '../format.ts';

/** Страница фильтров списка сборов: арена, прошедшие и отменённые. Изменения применяются сразу. */
export function FiltersPage() {
  const { navigate } = useApp();
  const filters = useListFilters();
  const [places, setPlaces] = useState<Place[] | null>(null);
  const back = () => navigate(routeToHash({ name: 'list' }));

  useEffect(() => {
    let alive = true;
    api
      .listPlaces()
      .then((r) => alive && setPlaces(r.items))
      .catch(() => alive && setPlaces([]));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      <PanelHeader before={<PanelHeaderBack onClick={back} />}>Фильтры</PanelHeader>
      <Group>
        <FormItem htmlFor="placeFilter" top="Арена">
          <CustomSelect
            id="placeFilter"
            searchable
            allowClearButton
            placeholder={places === null ? 'Загрузка…' : 'Все арены'}
            emptyText="Арен пока нет"
            fetching={places === null}
            options={(places ?? []).map((p) => ({ value: String(p.id), label: p.name, description: p.address }))}
            value={filters.placeId === null ? null : String(filters.placeId)}
            onChange={(_e, value) => setFilters({ placeId: value === null || value === '' ? null : Number(value) })}
          />
        </FormItem>
        <Checkbox checked={filters.showPast} onChange={(e) => setFilters({ showPast: e.target.checked })}>
          Показывать прошедшие сборы
        </Checkbox>
        <Checkbox checked={filters.showCancelled} onChange={(e) => setFilters({ showCancelled: e.target.checked })}>
          Показывать отменённые сборы
        </Checkbox>
        <FormItem>
          <div className="filters__actions">
            <Button size="l" stretched onClick={back}>
              Готово
            </Button>
            <Button
              size="l"
              mode="secondary"
              stretched
              disabled={activeFiltersCount(filters) === 0}
              onClick={() => setFilters(DEFAULT_FILTERS)}
            >
              Сбросить
            </Button>
          </div>
        </FormItem>
      </Group>
    </>
  );
}
