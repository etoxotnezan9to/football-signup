import { defineConfig } from '@playwright/test';

// Сквозные тесты: настоящий API (SQLite в памяти, вход «Mock» разрешён только вне production)
// и собранное веб-приложение через `vite preview` с проксированием /api и /ws.
// Перед запуском нужна сборка: pnpm --filter @football/web build
const baseEnv = process.env as Record<string, string>;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4173' },
  webServer: [
    {
      command: 'node src/server.ts',
      cwd: '../api',
      url: 'http://127.0.0.1:3000/api/health',
      timeout: 30_000,
      env: {
        ...baseEnv,
        NODE_ENV: 'development',
        AUTH_DEV_BYPASS: '1',
        VK_APP_ID: '54809461',
        DATABASE_FILE: ':memory:',
        HOST: '127.0.0.1',
        PORT: '3000',
      },
    },
    {
      command: 'pnpm exec vite preview --host 127.0.0.1 --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      timeout: 30_000,
    },
  ],
});
