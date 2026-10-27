import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameDetails, GameSummary } from '@football/shared';
import { api, type ApiError } from './api.ts';
import { useApp } from './context.ts';
import { visibleInList } from './format.ts';

interface Loadable<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

function sortByStart(list: GameSummary[]): GameSummary[] {
  return [...list].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id - b.id);
}

/** Список предстоящих игр: REST + события game.created / game.updated + перезагрузка при переподключении. */
export function useGames(): Loadable<GameSummary[]> {
  const { realtime, session } = useApp();
  const me = session.user.id;
  const [data, setData] = useState<GameSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    api
      .listGames()
      .then((page) => {
        setData(page.items);
        setError(null);
      })
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
    const unsubTopic = realtime.subscribe('games');
    const unsubEvent = realtime.onEvent((e) => {
      if (e.type !== 'game.created' && e.type !== 'game.updated') return;
      const g = e.game;
      setData((prev) => {
        if (!prev) return prev;
        const old = prev.find((x) => x.id === g.id);
        const rest = prev.filter((x) => x.id !== g.id);
        // в событии нет mySeats (зависит от получателя): сохраняем известное значение
        const mySeats = old?.mySeats ?? 0;
        if (!visibleInList(g, me, mySeats)) return rest;
        return sortByStart([...rest, { ...g, mySeats }]);
      });
    });
    const unsubRefresh = realtime.onRefresh(reload);
    return () => {
      unsubTopic();
      unsubEvent();
      unsubRefresh();
    };
  }, [realtime, reload, me]);

  return { data, error, loading, reload };
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
