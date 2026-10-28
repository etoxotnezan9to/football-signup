-- Части записи: места, добавленные одним действием, со своим временем. Увеличение записи добавляет новую часть,
-- поэтому добавленные места встают в конец состава и очереди. signups.seats — сумма мест частей.
CREATE TABLE signup_parts (
  id          INTEGER PRIMARY KEY,
  signup_id   INTEGER NOT NULL REFERENCES signups(id) ON DELETE CASCADE,
  seats       INTEGER NOT NULL CHECK (seats >= 1),
  created_at  TEXT NOT NULL
);
CREATE INDEX signup_parts_signup ON signup_parts (signup_id, created_at, id);

-- у существующих записей все места — одна часть со временем записи
INSERT INTO signup_parts (signup_id, seats, created_at)
  SELECT id, seats, created_at FROM signups;
