# Схема БД (SQLite)

Режим: WAL, `foreign_keys = ON`, `busy_timeout = 5000`. Один процесс API владеет файлом базы. Время хранится как ISO-8601 UTC строка.

## Таблицы

```sql
CREATE TABLE users (
  vk_id       INTEGER PRIMARY KEY,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  photo_url   TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- миграция 0003: место проведения игр (создаёт любой пользователь, видят все)
CREATE TABLE places (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  address     TEXT NOT NULL,
  created_by  INTEGER REFERENCES users(vk_id),
  created_at  TEXT NOT NULL,
  UNIQUE (name, address)
);

CREATE TABLE games (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  organizer_id      INTEGER NOT NULL REFERENCES users(vk_id),
  starts_at         TEXT NOT NULL,
  place_id          INTEGER REFERENCES places(id),  -- миграция 0003, заменила venue и address
  teams_max         INTEGER,          -- миграция 0005, вместе с players_per_team заменила format; с миграции 0006 всегда задано
  players_per_team  INTEGER,
  fee_rub           INTEGER NOT NULL CHECK (fee_rub >= 0),
  capacity          INTEGER NOT NULL CHECK (capacity BETWEEN 2 AND 60),  -- = teams_max * players_per_team (с миграции 0006)
  description       TEXT NOT NULL DEFAULT '',
  payment_info      TEXT NOT NULL DEFAULT '',
  organizer_contact TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  reminder_sent_at  TEXT              -- миграция 0002: когда отправлено напоминание (один раз)
);
CREATE INDEX idx_games_starts_at ON games (status, starts_at);
CREATE INDEX idx_games_organizer ON games (organizer_id);
CREATE INDEX idx_games_place ON games (place_id);

-- миграция 0007: команды
CREATE TABLE game_teams (            -- только переименованные; иначе название из TEAM_PRESETS
  game_id  INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  team_no  INTEGER NOT NULL CHECK (team_no >= 1),
  name     TEXT NOT NULL,
  PRIMARY KEY (game_id, team_no)
);
CREATE TABLE team_assignments (      -- место записи (seat_no из 1..seats) в команде
  signup_id   INTEGER NOT NULL REFERENCES signups(id) ON DELETE CASCADE,
  seat_no     INTEGER NOT NULL CHECK (seat_no >= 1),
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  team_no     INTEGER NOT NULL CHECK (team_no >= 1),
  created_at  TEXT NOT NULL,         -- порядок внутри команды
  PRIMARY KEY (signup_id, seat_no)
);
CREATE INDEX idx_team_assignments_game ON team_assignments (game_id);

-- миграция 0008: счёт матчей между командами (каждая с каждой)
CREATE TABLE match_results (
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  team_a      INTEGER NOT NULL CHECK (team_a >= 1),
  team_b      INTEGER NOT NULL CHECK (team_b > team_a),
  goals_a     INTEGER NOT NULL CHECK (goals_a BETWEEN 0 AND 99),
  goals_b     INTEGER NOT NULL CHECK (goals_b BETWEEN 0 AND 99),
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (game_id, team_a, team_b)
);

CREATE TABLE signups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(vk_id),
  seats       INTEGER NOT NULL CHECK (seats BETWEEN 1 AND 5),
  paid_seats  INTEGER NOT NULL DEFAULT 0 CHECK (paid_seats >= 0),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (game_id, user_id),
  CHECK (paid_seats <= seats)
);
CREATE INDEX idx_signups_game ON signups (game_id, created_at, id);
CREATE INDEX idx_signups_user ON signups (user_id);
```

Колонка `title` у игр удалена миграцией 0004.

`place_id` обязателен на уровне API (SQLite не позволяет добавить `NOT NULL`-ссылку через `ALTER TABLE`). Миграция 0003 превратила каждую пару (площадка, адрес) существующих игр в место. В ответах API `venue` и `address` игры берутся из её места.

Верхняя граница `seats` (5) дублирует `MAX_SEATS_PER_USER`; при изменении константы нужна новая миграция.

## Конкурентная запись

- Все изменения записей и игр выполняются в транзакции `BEGIN IMMEDIATE`: она берёт блокировку записи сразу, поэтому параллельные изменения выстраиваются в очередь.
- Состав (`mainSeats`/`queueSeats`) не хранится: вычисляется функцией `computeRoster` из `capacity` и записей в порядке `(created_at, id)` внутри той же транзакции или при чтении. Так нет рассинхронизации после отмен.
- Перед записью проверяется: игра существует, `status = 'active'`, не завершена, `seats ≤ 5`.
- События WebSocket отправляются после коммита.

## Миграции

SQL-файлы `NNNN_name.sql` в `apps/api/migrations`, применяются по порядку при старте в транзакции; применённые имена хранятся в таблице `schema_migrations(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`. Откатов нет: исправления идут новой миграцией. Перед выкаткой на сервере делается копия файла БД.

## Бэкап

`VACUUM INTO '<file>'` раз в сутки, хранение 14 копий (см. этап 1b).
