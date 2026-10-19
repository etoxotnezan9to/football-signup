import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import bridge from '@vkontakte/vk-bridge';
import {
  AdaptivityProvider,
  AppRoot,
  ConfigProvider,
  Panel,
  SplitCol,
  SplitLayout,
  View,
} from '@vkontakte/vkui';
import { ConnectionBanner } from './components/ConnectionBanner.tsx';
import { Toast } from './components/Toast.tsx';
import { AppContext, type AppContextValue } from './context.ts';
import { parseRoute } from './format.ts';
import { GameForm, EditGamePage } from './pages/GameForm.tsx';
import { GamePage } from './pages/GamePage.tsx';
import { ListPage } from './pages/ListPage.tsx';
import { MyPage } from './pages/MyPage.tsx';
import type { Realtime } from './realtime.ts';
import type { Session } from './session.ts';

const TOAST_MS = 3500;

interface Props {
  session: Session;
  realtime: Realtime;
}

export function App({ session, realtime }: Props) {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  const [popout, setPopout] = useState<ReactNode | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [appearance, setAppearance] = useState<'light' | 'dark'>('light');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Возврат на передний план: таймеры и сокет могли «заснуть», поэтому переподключаемся и догружаем данные
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) realtime.reconnectNow();
    };
    document.addEventListener('visibilitychange', onVisible);
    bridge.subscribe((e) => {
      const detail = e.detail;
      if (detail.type === 'VKWebAppViewRestore') realtime.reconnectNow();
      if (detail.type === 'VKWebAppUpdateConfig') {
        const next = (detail.data as { appearance?: string }).appearance;
        if (next === 'light' || next === 'dark') setAppearance(next);
      }
    });
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [realtime]);

  useEffect(() => () => realtime.close(), [realtime]);

  const navigate = useCallback((hash: string) => {
    if (window.location.hash !== hash) window.location.hash = hash;
  }, []);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const ctx = useMemo<AppContextValue>(
    () => ({ session, realtime, navigate, showToast, setPopout }),
    [session, realtime, navigate, showToast],
  );

  const gameId = route.name === 'game' || route.name === 'edit' ? route.id : 0;

  return (
    <ConfigProvider colorScheme={appearance}>
      <AdaptivityProvider>
        <AppRoot>
          <AppContext.Provider value={ctx}>
            <SplitLayout popout={popout}>
              <SplitCol>
                <ConnectionBanner />
                <View activePanel={route.name}>
                  <Panel id="list">
                    <ListPage />
                  </Panel>
                  <Panel id="my">
                    <MyPage />
                  </Panel>
                  <Panel id="create">
                    <GameForm />
                  </Panel>
                  <Panel id="game">
                    <GamePage id={gameId} />
                  </Panel>
                  <Panel id="edit">
                    <EditGamePage id={gameId} />
                  </Panel>
                </View>
              </SplitCol>
            </SplitLayout>
            <Toast text={toast} />
          </AppContext.Provider>
        </AppRoot>
      </AdaptivityProvider>
    </ConfigProvider>
  );
}
