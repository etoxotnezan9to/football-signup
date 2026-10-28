// Настройки сервера для текущего пользователя (GET /config): спрашиваем один раз за запуск приложения.
import { useEffect, useState } from 'react';
import { api } from './api.ts';

export interface ServerConfig {
  /** Тестовый режим: организатор может добавлять тестовых игроков */
  testMode: boolean;
  /** Может ли пользователь создавать сборы (есть в списке создателей) */
  canCreateGames: boolean;
}

let configPromise: Promise<ServerConfig> | null = null;

export function loadServerConfig(): Promise<ServerConfig> {
  configPromise ??= api
    .getConfig()
    .then((c) => ({ testMode: c.testMode === true, canCreateGames: c.canCreateGames === true }))
    .catch(() => {
      configPromise = null; // при сбое спросим снова в следующий раз
      return { testMode: false, canCreateGames: false };
    });
  return configPromise;
}

/** null — ещё не загружено. */
export function useServerConfig(): ServerConfig | null {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  useEffect(() => {
    let alive = true;
    void loadServerConfig().then((c) => {
      if (alive) setConfig(c);
    });
    return () => {
      alive = false;
    };
  }, []);
  return config;
}
