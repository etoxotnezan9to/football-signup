CREATE TABLE users (
  vk_id       INTEGER PRIMARY KEY,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  photo_url   TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE games (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  organizer_id      INTEGER NOT NULL REFERENCES users(vk_id),
  title             TEXT NOT NULL,
  starts_at         TEXT NOT NULL,
  venue             TEXT NOT NULL,
  address           TEXT NOT NULL,
  format            TEXT NOT NULL DEFAULT '',
  fee_rub           INTEGER NOT NULL CHECK (fee_rub >= 0),
  capacity          INTEGER NOT NULL CHECK (capacity BETWEEN 2 AND 60),
  description       TEXT NOT NULL DEFAULT '',
  payment_info      TEXT NOT NULL DEFAULT '',
  organizer_contact TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX idx_games_starts_at ON games (status, starts_at);
CREATE INDEX idx_games_organizer ON games (organizer_id);

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
