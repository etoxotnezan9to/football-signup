-- Команды игры: названия, заданные организатором (по умолчанию берутся из TEAM_PRESETS), и распределение мест состава.
CREATE TABLE game_teams (
  game_id  INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  team_no  INTEGER NOT NULL CHECK (team_no >= 1),
  name     TEXT NOT NULL,
  PRIMARY KEY (game_id, team_no)
);

-- Место записи (seat_no из 1..seats) в команде. Строка удаляется вместе с записью;
-- места, выпавшие из состава или из числа команд, сервер удаляет при пересчёте.
CREATE TABLE team_assignments (
  signup_id   INTEGER NOT NULL REFERENCES signups(id) ON DELETE CASCADE,
  seat_no     INTEGER NOT NULL CHECK (seat_no >= 1),
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  team_no     INTEGER NOT NULL CHECK (team_no >= 1),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (signup_id, seat_no)
);
CREATE INDEX idx_team_assignments_game ON team_assignments (game_id);
