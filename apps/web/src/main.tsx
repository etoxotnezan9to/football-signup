import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@vkontakte/vkui/dist/vkui.css';
import './styles.css';
import { api, setAuthHeader } from './api.ts';
import { App } from './App.tsx';
import { createRealtime } from './realtime.ts';
import { initSession } from './session.ts';
// подписка на тему VK до VKWebAppInit: первое событие с темой приходит сразу после него
import './theme.ts';

const container = document.getElementById('root');
if (!container) throw new Error('Элемент #root не найден');
const root = createRoot(container);

async function start(): Promise<void> {
  try {
    const session = await initSession();
    setAuthHeader(session.authHeader);
    // Имя и фото берутся из VK на клиенте; сервер хранит их для списков. Сбой не мешает запуску.
    await api
      .putMe({
        firstName: session.user.firstName,
        lastName: session.user.lastName,
        photoUrl: session.user.photoUrl,
      })
      .catch(() => undefined);
    const realtime = createRealtime(session.wsAuth);
    root.render(
      <StrictMode>
        <App session={session} realtime={realtime} />
      </StrictMode>,
    );
  } catch (e) {
    const text = e instanceof Error ? e.message : 'неизвестная ошибка';
    root.render(<div style={{ padding: 16 }}>Не удалось запустить приложение: {text}</div>);
  }
}

void start();
