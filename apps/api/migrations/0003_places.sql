-- «Место» — отдельная сущность: название и адрес. Игра ссылается на место вместо своих полей venue/address.
CREATE TABLE places (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  address     TEXT NOT NULL,
  created_by  INTEGER REFERENCES users(vk_id),
  created_at  TEXT NOT NULL,
  UNIQUE (name, address)
);

-- Существующие игры: каждая пара (площадка, адрес) становится местом
INSERT INTO places (name, address, created_by, created_at)
SELECT venue, address, MIN(organizer_id), MIN(created_at)
  FROM games
 GROUP BY venue, address;

ALTER TABLE games ADD COLUMN place_id INTEGER REFERENCES places(id);
UPDATE games SET place_id = (SELECT p.id FROM places p WHERE p.name = games.venue AND p.address = games.address);
CREATE INDEX idx_games_place ON games (place_id);

ALTER TABLE games DROP COLUMN venue;
ALTER TABLE games DROP COLUMN address;
