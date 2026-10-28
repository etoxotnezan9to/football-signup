-- Кто может создавать сборы: пользователь по числовому id VK или по короткому имени (vk.com/<имя>).
-- Короткое имя сервер при запуске превращает в id через VK API (нужен VK_SERVICE_KEY), см. docs/runbook.md.
CREATE TABLE game_creators (
  id           INTEGER PRIMARY KEY,
  vk_id        INTEGER UNIQUE,
  screen_name  TEXT UNIQUE COLLATE NOCASE,
  created_at   TEXT NOT NULL,
  CHECK (vk_id IS NOT NULL OR screen_name IS NOT NULL)
);
INSERT INTO game_creators (vk_id, created_at) VALUES (74073332, '2026-10-28T00:00:00.000Z');
INSERT INTO game_creators (screen_name, created_at) VALUES ('lfproject', '2026-10-28T00:00:00.000Z');

-- Создатель сбора (тот, кто его завёл); организатор может быть другим. Создатель нигде не показывается.
ALTER TABLE games ADD COLUMN created_by INTEGER REFERENCES users(vk_id);
UPDATE games SET created_by = organizer_id;
