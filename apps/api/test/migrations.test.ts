import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/db.ts';

const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));

describe('миграция 0003_places', () => {
  it('переносит площадку и адрес существующих игр в места', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-'));
    try {
      for (const f of ['0001_init.sql', '0002_reminders.sql'])
        copyFileSync(join(MIGRATIONS, f), join(dir, f));
      const db = new DatabaseSync(':memory:');
      db.exec('PRAGMA foreign_keys = ON');
      migrate(db, dir);
      const ts = '2026-10-01T00:00:00.000Z';
      db.prepare(
        "INSERT INTO users (vk_id, first_name, last_name, created_at, updated_at) VALUES (1, 'a', 'b', ?, ?)",
      ).run(ts, ts);
      const insert = db.prepare(
        `INSERT INTO games (organizer_id, title, starts_at, venue, address, fee_rub, capacity, created_at, updated_at)
         VALUES (1, ?, ?, ?, ?, 0, 10, ?, ?)`,
      );
      insert.run('g1', ts, 'Орловский', 'Суздальское шоссе 62', ts, ts);
      insert.run('g2', ts, 'Орловский', 'Суздальское шоссе 62', ts, ts);
      insert.run('g3', ts, 'Зал', 'ул. Мира, 1', ts, ts);

      copyFileSync(join(MIGRATIONS, '0003_places.sql'), join(dir, '0003_places.sql'));
      assert.deepEqual(migrate(db, dir), ['0003_places.sql']);

      const places = db.prepare('SELECT name, address FROM places ORDER BY name').all();
      assert.deepEqual(
        places.map((p) => [p.name, p.address]),
        [
          ['Зал', 'ул. Мира, 1'],
          ['Орловский', 'Суздальское шоссе 62'],
        ],
      );
      const games = db
        .prepare('SELECT g.title, p.name FROM games g JOIN places p ON p.id = g.place_id ORDER BY g.title')
        .all();
      assert.deepEqual(
        games.map((g) => [g.title, g.name]),
        [
          ['g1', 'Орловский'],
          ['g2', 'Орловский'],
          ['g3', 'Зал'],
        ],
      );
      const cols = db
        .prepare('PRAGMA table_info(games)')
        .all()
        .map((c) => c.name);
      assert.ok(!cols.includes('venue') && !cols.includes('address'));

      copyFileSync(join(MIGRATIONS, '0004_drop_game_title.sql'), join(dir, '0004_drop_game_title.sql'));
      assert.deepEqual(migrate(db, dir), ['0004_drop_game_title.sql']);
      const after = db.prepare('PRAGMA table_info(games)').all().map((c) => c.name);
      assert.ok(!after.includes('title'));
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM games').get()!.n, 3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
