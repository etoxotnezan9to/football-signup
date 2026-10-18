import { useEffect, useState } from 'react';
import { useApp } from '../context.ts';
import type { ConnStatus } from '../realtime.ts';

export function ConnectionBanner() {
  const { realtime } = useApp();
  const [status, setStatus] = useState<ConnStatus>(realtime.status());
  useEffect(() => realtime.onStatus(setStatus), [realtime]);

  if (status === 'offline') return <div className="banner">Нет соединения, переподключаемся…</div>;
  if (status === 'polling') return <div className="banner">Живое обновление недоступно: данные обновляются раз в 5 секунд</div>;
  return null;
}
