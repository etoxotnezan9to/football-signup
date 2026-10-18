import { join } from 'node:path';

export interface Config {
  nodeEnv: string;
  host: string;
  port: number;
  databaseFile: string;
  migrationsDir: string;
  vkAppId: number;
  vkAppSecret: string;
  /** Сервисный ключ доступа для личных уведомлений VK; пусто — уведомления выключены */
  vkServiceKey: string;
  /** Часовой пояс, в котором время игры показывается в уведомлениях */
  notifyTimeZone: string;
  /** Только вне production: разрешает заголовок `Authorization: Mock <id>:<имя>:<фамилия>` */
  authDevBypass: boolean;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const production = nodeEnv === 'production';

  const vkAppId = Number(env.VK_APP_ID);
  if (!Number.isInteger(vkAppId) || vkAppId <= 0) throw new Error('VK_APP_ID должен быть положительным числом');

  const vkAppSecret = env.VK_APP_SECRET ?? '';
  const authDevBypass = !production && env.AUTH_DEV_BYPASS === '1';
  if (!vkAppSecret && !authDevBypass) {
    throw new Error('VK_APP_SECRET обязателен (или AUTH_DEV_BYPASS=1 вне production)');
  }
  if (production && env.AUTH_DEV_BYPASS === '1') {
    throw new Error('AUTH_DEV_BYPASS запрещён в production');
  }

  const notifyTimeZone = env.NOTIFY_TIMEZONE ?? 'Europe/Moscow';
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: notifyTimeZone });
  } catch {
    throw new Error('NOTIFY_TIMEZONE должен быть корректным часовым поясом IANA, например Europe/Moscow');
  }

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT некорректен');

  return {
    nodeEnv,
    host: env.HOST ?? '0.0.0.0',
    port,
    databaseFile: env.DATABASE_FILE ?? './data/football.db',
    migrationsDir: env.MIGRATIONS_DIR ?? join(process.cwd(), 'migrations'),
    vkAppId,
    vkAppSecret,
    vkServiceKey: env.VK_SERVICE_KEY ?? '',
    notifyTimeZone,
    authDevBypass,
  };
}
