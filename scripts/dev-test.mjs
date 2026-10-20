// Запуск в тестовом режиме одной командой: `pnpm dev:test`.
// API с входом «Mock» (тестовые пользователи) и тестовыми игроками + веб-приложение Vite.
// Откройте http://localhost:5173 в браузере. База тестового режима: apps/api/data/dev.db.
import { spawn } from 'node:child_process';
import process from 'node:process';

const children = [
  spawn(process.execPath, ['src/server.ts'], {
    cwd: 'apps/api',
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      AUTH_DEV_BYPASS: '1',
      VK_APP_ID: process.env.VK_APP_ID ?? '54809461',
      DATABASE_FILE: process.env.DATABASE_FILE ?? './data/dev.db',
      HOST: '127.0.0.1',
      PORT: '3000',
    },
  }),
  spawn('pnpm', ['--filter', '@football/web', 'dev'], { stdio: 'inherit', shell: process.platform === 'win32' }),
];

let stopping = false;
const stop = (code) => {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill('SIGTERM');
  process.exitCode = code;
};
for (const c of children) c.on('exit', (code) => stop(code ?? 0));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
