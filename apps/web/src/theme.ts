// Тема оформления (светлая или тёмная). Внутри VK — из настроек VK: событие VKWebAppUpdateConfig приходит сразу
// после VKWebAppInit, поэтому подписка оформляется при загрузке модуля, до запуска (импортируется в main.tsx),
// и дополнительно тема запрашивается через VKWebAppGetConfig. Без данных от VK — системная тема устройства.
import { useSyncExternalStore } from 'react';
import bridge from '@vkontakte/vk-bridge';
import { appearanceFromVkConfig, type Appearance } from './format.ts';
import { insideVk } from './session.ts';

let fromVk: Appearance | null = null;
const listeners = new Set<() => void>();
const notify = () => {
  for (const l of listeners) l();
};

function setFromVk(data: unknown): void {
  const next = appearanceFromVkConfig(data);
  if (next === null || next === fromVk) return;
  fromVk = next;
  notify();
}

bridge.subscribe((e) => {
  if (e.detail.type === 'VKWebAppUpdateConfig') setFromVk(e.detail.data);
});

const systemQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
systemQuery?.addEventListener('change', notify);

/** Запросить тему у VK (после VKWebAppInit); вне VK ничего не делает. */
export function requestVkAppearance(): void {
  if (!insideVk()) return;
  bridge
    .send('VKWebAppGetConfig')
    .then(setFromVk)
    .catch(() => undefined);
}

function current(): Appearance {
  return fromVk ?? (systemQuery?.matches ? 'dark' : 'light');
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    current,
    current,
  );
}
