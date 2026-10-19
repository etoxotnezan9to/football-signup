import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Открывает базу SQLite (WAL, внешние ключи) и применяет миграции. */
export function openDatabase(file: string, migrationsDir: string): DatabaseSync {
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  migrate(db, migrationsDir);
  return db;
}

export function migrate(db: DatabaseSync, migrationsDir: string): string[] {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  const applied = new Set(
    (db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map((r) => r.name),
  );
  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();
  const done: string[] = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(join(migrationsDir, f), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(
        f,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
      done.push(f);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return done;
}

/** Выполняет fn в транзакции BEGIN IMMEDIATE: параллельные изменения выстраиваются в очередь. */
export function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
