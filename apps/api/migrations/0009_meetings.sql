-- Сколько раз каждая пара команд играет между собой (по умолчанию 2) и счёт каждой встречи отдельно.
ALTER TABLE games ADD COLUMN meetings INTEGER NOT NULL DEFAULT 2 CHECK (meetings BETWEEN 1 AND 10);

-- В ключ счёта добавляется номер встречи leg; уже записанный счёт становится первой встречей.
CREATE TABLE match_results_new (
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  team_a      INTEGER NOT NULL CHECK (team_a >= 1),
  team_b      INTEGER NOT NULL CHECK (team_b > team_a),
  leg         INTEGER NOT NULL CHECK (leg >= 1),
  goals_a     INTEGER NOT NULL CHECK (goals_a BETWEEN 0 AND 99),
  goals_b     INTEGER NOT NULL CHECK (goals_b BETWEEN 0 AND 99),
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (game_id, team_a, team_b, leg)
);
INSERT INTO match_results_new (game_id, team_a, team_b, leg, goals_a, goals_b, updated_at)
  SELECT game_id, team_a, team_b, 1, goals_a, goals_b, updated_at FROM match_results;
DROP TABLE match_results;
ALTER TABLE match_results_new RENAME TO match_results;
