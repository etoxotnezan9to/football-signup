import { useSyncExternalStore } from 'react';

/** Фильтры списка сборов на главной; хранятся в браузере пользователя. */
export interface ListFilters {
  /** Только сборы этой арены; null — все арены */
  placeId: number | null;
  /** Показывать прошедшие сборы */
  showPast: boolean;
  /** Показывать отменённые сборы (свои и те, куда был записан) */
  showCancelled: boolean;
}

export const DEFAULT_FILTERS: ListFilters = { placeId: null, showPast: false, showCancelled: true };

const KEY = 'listFilters';
/** Прежний ключ, где хранилась только выбранная арена */
const LEGACY_PLACE_KEY = 'placeFilter';

/** Фильтры из сохранённого JSON; мусор и отсутствующие поля заменяются значениями по умолчанию. */
export function parseFilters(raw: string | null, legacyPlace: string | null = null): ListFilters {
  let saved: Partial<Record<keyof ListFilters, unknown>> = {};
  try {
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (v && typeof v === 'object') saved = v;
  } catch {
    // повреждённое значение: берём значения по умолчанию
  }
  const legacy = Number(legacyPlace);
  const place = saved.placeId ?? (Number.isInteger(legacy) && legacy > 0 ? legacy : null);
  return {
    placeId: typeof place === 'number' && Number.isInteger(place) && place > 0 ? place : null,
    showPast: typeof saved.showPast === 'boolean' ? saved.showPast : DEFAULT_FILTERS.showPast,
    showCancelled: typeof saved.showCancelled === 'boolean' ? saved.showCancelled : DEFAULT_FILTERS.showCancelled,
  };
}

/** Сколько фильтров отличается от значений по умолчанию (для отметки на кнопке). */
export function activeFiltersCount(f: ListFilters): number {
  return (
    Number(f.placeId !== DEFAULT_FILTERS.placeId) +
    Number(f.showPast !== DEFAULT_FILTERS.showPast) +
    Number(f.showCancelled !== DEFAULT_FILTERS.showCancelled)
  );
}

/** Параметры запроса GET /games для фильтров. */
export function filtersQuery(f: ListFilters): string {
  const q = new URLSearchParams();
  if (f.showPast) q.set('includePast', '1');
  if (!f.showCancelled) q.set('includeCancelled', '0');
  if (f.placeId !== null) q.set('placeId', String(f.placeId));
  const s = q.toString();
  return s ? `&${s}` : '';
}

function read(): ListFilters {
  try {
    return parseFilters(localStorage.getItem(KEY), localStorage.getItem(LEGACY_PLACE_KEY));
  } catch {
    return DEFAULT_FILTERS;
  }
}

// Одно значение на всё приложение: страница фильтров и список видят изменения сразу
let current: ListFilters = read();
const listeners = new Set<() => void>();

export function getFilters(): ListFilters {
  return current;
}

export function setFilters(patch: Partial<ListFilters>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
    localStorage.removeItem(LEGACY_PLACE_KEY);
  } catch {
    // хранилище недоступно: фильтры действуют до перезагрузки
  }
  for (const l of listeners) l();
}

export function useListFilters(): ListFilters {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    getFilters,
    getFilters,
  );
}
