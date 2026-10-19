import { useState } from 'react';
import bridge from '@vkontakte/vk-bridge';
import { Button, Text } from '@vkontakte/vkui';
import { useApp } from '../context.ts';

const DISMISS_KEY = 'notifyPromptDismissedAt';
const DISMISS_DAYS = 14;

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return at > 0 && Date.now() - at < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

function rememberDismiss(): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // хранилище недоступно: приглашение просто покажется снова при следующем запуске
  }
}

/**
 * Приглашение включить уведомления VK: сообщим, когда вас переведут из очереди в состав
 * или отменят игру, и напомним об игре за сутки. Показывается только внутри VK, пока уведомления выключены.
 */
export function NotificationsPrompt() {
  const { session, showToast } = useApp();
  const [hidden, setHidden] = useState(dismissedRecently);

  if (session.mock || session.notificationsEnabled !== false || hidden) return null;

  const enable = async () => {
    try {
      const res = await bridge.send('VKWebAppAllowNotifications');
      if (res.result) showToast('Уведомления включены');
      setHidden(true);
    } catch {
      // пользователь отказался в окне VK: не настаиваем
      rememberDismiss();
      setHidden(true);
    }
  };

  const later = () => {
    rememberDismiss();
    setHidden(true);
  };

  return (
    <div className="notify-prompt">
      <Text>
        Включите уведомления: сообщим, если вас переведут из очереди в состав или игру отменят, и напомним об игре за
        сутки.
      </Text>
      <div className="notify-prompt__actions">
        <Button size="m" onClick={() => void enable()}>
          Включить
        </Button>
        <Button size="m" mode="tertiary" onClick={later}>
          Не сейчас
        </Button>
      </div>
    </div>
  );
}
