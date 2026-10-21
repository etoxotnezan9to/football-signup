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

      copyFileSync(join(MIGRATIONS, '0005_teams.sql'), join(dir, '0005_teams.sql'));
      assert.deepEqual(migrate(db, dir), ['0005_teams.sql']);
      const cols5 = db.prepare('PRAGMA table_info(games)').all().map((c) => c.name);
      assert.ok(!cols5.includes('format') && cols5.includes('teams_max') && cols5.includes('players_per_team'));
      const nulls = db.prepare('SELECT COUNT(*) AS n FROM games WHERE teams_max IS NULL AND players_per_team IS NULL').get();
      assert.equal(nulls!.n, 3);

      // 0006–0008, затем счёт без номера встречи переносится в первую встречу (0009)
      for (const f of ['0006_capacity_from_teams.sql', '0007_teams.sql', '0008_match_results.sql']) {
        copyFileSync(join(MIGRATIONS, f), join(dir, f));
      }

      // у одной игры значения уже были, причём произведение больше 60
      db.prepare('UPDATE games SET teams_max = 10, players_per_team = 7 WHERE id = 1').run();
      assert.deepEqual(migrate(db, dir), ['0006_capacity_from_teams.sql', '0007_teams.sql', '0008_match_results.sql']);
      const rows = db.prepare('SELECT id, teams_max, players_per_team, capacity FROM games ORDER BY id').all();
      assert.deepEqual(
        rows.map((g) => [g.teams_max, g.players_per_team, g.capacity]),
        [
          [8, 7, 56],
          [4, 6, 24],
          [4, 6, 24],
        ],
      );

      db.prepare(
        "INSERT INTO match_results (game_id, team_a, team_b, goals_a, goals_b, updated_at) VALUES (1, 1, 2, 3, 1, 'x')",
      ).run();
      copyFileSync(join(MIGRATIONS, '0009_meetings.sql'), join(dir, '0009_meetings.sql'));
      assert.deepEqual(migrate(db, dir), ['0009_meetings.sql']);
      assert.deepEqual(
        db
          .prepare('SELECT meetings FROM games ORDER BY id')
          .all()
          .map((g) => g.meetings),
        [2, 2, 2],
      );
      const legs = db.prepare('SELECT team_a, team_b, leg, goals_a, goals_b FROM match_results').all();
      assert.deepEqual(
        legs.map((m) => [m.team_a, m.team_b, m.leg, m.goals_a, m.goals_b]),
        [[1, 2, 1, 3, 1]],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
