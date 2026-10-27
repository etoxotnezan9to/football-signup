import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameDetails, GameSummary } from '@football/shared';
import { api, type ApiError } from './api.ts';
import { useApp } from './context.ts';
import { filtersQuery, useListFilters } from './filters.ts';
import { visibleInList } from './format.ts';

interface Loadable<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** Порядок списка как у сервера: предстоящие по возрастанию времени, затем прошедшие от новых к старым. */
function sortByStart(list: GameSummary[]): GameSummary[] {
  return [...list].sort((a, b) => {
    if (a.isFinished !== b.isFinished) return a.isFinished ? 1 : -1;
    const byTime = Date.parse(a.startsAt) - Date.parse(b.startsAt);
    return (a.isFinished ? -byTime : byTime) || a.id - b.id;
  });
}

/** Период списка: начало сбора в [from, to), даты ISO. */
export interface GamesRange {
  from: string;
  to: string;
}

/**
 * Сборы недели с фильтрами главной (filters.ts): REST + события game.created / game.updated +
 * перезагрузка при переподключении, смене фильтров и недели. Пока range = null, ничего не грузится.
 */
export function useGames(range: GamesRange | null): Loadable<GameSummary[]> {
  const { realtime } = useApp();
  const filters = useListFilters();
  const query = range
    ? `${filtersQuery(filters)}&${new URLSearchParams({ from: range.from, to: range.to }).toString()}`
    : null;
  // данные помнят, к какому запросу относятся: после смены недели старая неделя не показывается
  const [state, setState] = useState<{ query: string; items: GameSummary[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    if (query === null) return;
    api
      .listGames(query)
      .then((page) => {
        setState({ query, items: page.items });
        setError(null);
      })
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(() => {
    if (query === null || range === null) return;
    reload();
    const from = Date.parse(range.from);
    const to = Date.parse(range.to);
    const unsubTopic = realtime.subscribe('games');
    const unsubEvent = realtime.onEvent((e) => {
      if (e.type !== 'game.created' && e.type !== 'game.updated') return;
      const g = e.game;
      setState((prev) => {
        if (!prev || prev.query !== query) return prev;
        const old = prev.items.find((x) => x.id === g.id);
        const rest = prev.items.filter((x) => x.id !== g.id);
        // в событии нет mySeats (зависит от получателя): сохраняем известное значение
        const mySeats = old?.mySeats ?? 0;
        const start = Date.parse(g.startsAt);
        if (!visibleInList(g, filters) || start < from || start >= to) return { query, items: rest };
        return { query, items: sortByStart([...rest, { ...g, mySeats }]) };
      });
    });
    const unsubRefresh = realtime.onRefresh(reload);
    return () => {
      unsubTopic();
      unsubEvent();
      unsubRefresh();
    };
    // range входит в query: отдельная зависимость не нужна
  }, [realtime, reload, filters, query]);

  const data = state !== null && state.query === query ? state.items : null;
  return { data, error, loading: loading || (query !== null && data === null && error === null), reload };
}

/**
 * Ближайший предстоящий сбор с фильтрами главной (кроме «прошедших»): по нему выбирается неделя при открытии.
 * undefined — ещё не загружено, null — предстоящих сборов нет. Обновляется при появлении и изменении сборов.
 */
export function useNearestGame(enabled: boolean): GameSummary | null | undefined {
  const { realtime } = useApp();
  const filters = useListFilters();
  const query = filtersQuery({ ...filters, showPast: false });
  const [nearest, setNearest] = useState<{ query: string; game: GameSummary | null } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () => {
      api
        .listGames(query, 1)
        .then((page) => {
          if (alive) setNearest({ query, game: page.items[0] ?? null });
        })
        .catch(() => {
          // без ближайшего сбора откроется текущая неделя
          if (alive) setNearest({ query, game: null });
        });
    };
    load();
    const unsubTopic = realtime.subscribe('games');
    const unsubEvent = realtime.onEvent((e) => {
      if (e.type === 'game.created' || e.type === 'game.updated') load();
    });
    const unsubRefresh = realtime.onRefresh(load);
    return () => {
      alive = false;
      unsubTopic();
      unsubEvent();
      unsubRefresh();
    };
  }, [realtime, query, enabled]);

  return nearest !== null && nearest.query === query ? nearest.game : undefined;
}

/** Одна игра с составом: REST + roster.updated. */
export function useGame(id: number): Loadable<GameDetails> & { setData: (g: GameDetails) => void } {
  const { realtime } = useApp();
  const [data, setData] = useState<GameDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const idRef = useRef(id);
  idRef.current = id;

  const reload = useCallback(() => {
    api
      .getGame(idRef.current)
      .then((g) => {
        setData(g);
        setError(null);
      })
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setData(null);
    setLoading(true);
    reload();
    const unsubTopic = realtime.subscribe(`game:${id}`);
    const unsubEvent = realtime.onEvent((e) => {
      if (e.type === 'roster.updated' && e.game.id === id) {
        setData(e.game);
        setError(null);
      }
    });
    const unsubRefresh = realtime.onRefresh(reload);
    return () => {
      unsubTopic();
      unsubEvent();
      unsubRefresh();
    };
  }, [id, realtime, reload]);

  return { data, error, loading, reload, setData };
}

export function useMyGames(): Loadable<{ organized: GameSummary[]; joined: GameSummary[] }> {
  const { realtime } = useApp();
  const [data, setData] = useState<{ organized: GameSummary[]; joined: GameSummary[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    api
      .myGames()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
    const unsubTopic = realtime.subscribe('games');
    const unsubEvent = realtime.onEvent((e) => {
      if (e.type === 'game.updated' || e.type === 'game.created') reload();
    });
    const unsubRefresh = realtime.onRefresh(reload);
    return () => {
      unsubTopic();
      unsubEvent();
      unsubRefresh();
    };
  }, [realtime, reload]);

  return { data, error, loading, reload };
}
