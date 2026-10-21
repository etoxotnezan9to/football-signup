-- Счёт матчей между командами игры (каждая с каждой). Пара хранится с team_a < team_b, голы в том же порядке.
CREATE TABLE match_results (
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  team_a      INTEGER NOT NULL CHECK (team_a >= 1),
  team_b      INTEGER NOT NULL CHECK (team_b > team_a),
  goals_a     INTEGER NOT NULL CHECK (goals_a BETWEEN 0 AND 99),
  goals_b     INTEGER NOT NULL CHECK (goals_b BETWEEN 0 AND 99),
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (game_id, team_a, team_b)
);
