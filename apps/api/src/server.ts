import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildApp, authenticateLaunchParams } from './app.ts';
import { loadConfig } from './config.ts';
import { openDatabase } from './db.ts';
import { createHub } from './hub.ts';
import { createVkNotifier } from './notifier.ts';
import { createRateLimiter } from './rate-limit.ts';
import { createService } from './service.ts';

const config = loadConfig();
if (config.databaseFile !== ':memory:') mkdirSync(dirname(config.databaseFile), { recursive: true });

const db = openDatabase(config.databaseFile, config.migrationsDir);

// service и hub ссылаются друг на друга: сначала хаб с отложенной авторизацией
const holder: { service: ReturnType<typeof createService> | null } = { service: null };
const hub = createHub({
  authenticate: (lp) => (holder.service ? authenticateLaunchParams(config, lp, holder.service) : null),
});

// Логгер приложения появляется после создания сервера, а уведомления нужны сервису раньше
const logRef: { current: { info(o: object, m?: string): void; warn(o: object, m?: string): void } | null } = {
  current: null,
};
const notifier = config.vkServiceKey
  ? createVkNotifier({
      serviceKey: config.vkServiceKey,
      log: {
        info: (o, m) => logRef.current?.info(o, m),
        warn: (o, m) => logRef.current?.warn(o, m),
      },
    })
  : null;

const service = createService(db, {
  emit: (e) => hub.publish(e),
  notify: notifier?.notify,
  timeZone: config.notifyTimeZone,
  testMode: config.testMode,
});
holder.service = service;

const require = createRequire(import.meta.url);
let version = 'dev';
try {
  version = (require('../package.json') as { version: string }).version;
} catch {
  // в собранном образе package.json может отсутствовать
}

const app = buildApp({
  config,
  service,
  hub,
  limiter: createRateLimiter({ max: 60, windowMs: 60_000 }),
  version: process.env.APP_VERSION ?? version,
  logger: true,
});

logRef.current = app.log;
app.log.info(
  { notifications: notifier !== null },
  notifier ? 'личные уведомления включены' : 'личные уведомления выключены (нет VK_SERVICE_KEY)',
);
if (config.testMode) app.log.warn('тестовый режим включён: организаторы могут добавлять тестовых игроков');

// Напоминания: раз в минуту ищем игры, до которых осталось меньше суток
const REMINDER_TICK_MS = 60_000;
const reminderTimer = notifier
  ? setInterval(() => {
      try {
        const games = service.sendDueReminders();
        if (games > 0) app.log.info({ games }, 'напоминания поставлены в отправку');
      } catch (err) {
        app.log.error({ err }, 'сбой планировщика напоминаний');
      }
    }, REMINDER_TICK_MS)
  : null;
reminderTimer?.unref();

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'остановка');
  if (reminderTimer) clearInterval(reminderTimer);
  try {
    await notifier?.flush();
    await app.close();
    db.close();
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.host, port: config.port });
