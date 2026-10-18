import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildApp, authenticateLaunchParams } from './app.ts';
import { loadConfig } from './config.ts';
import { openDatabase } from './db.ts';
import { createHub } from './hub.ts';
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
const service = createService(db, { emit: (e) => hub.publish(e) });
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

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'остановка');
  try {
    await app.close();
    db.close();
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.host, port: config.port });
