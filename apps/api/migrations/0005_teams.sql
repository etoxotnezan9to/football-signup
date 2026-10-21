-- Текстовый «формат» игры заменён двумя числами: максимум команд и игроков в команде (NULL — не указано).
-- Старый текст не переносится: его нельзя надёжно разобрать на числа.
ALTER TABLE games ADD COLUMN teams_max INTEGER;
ALTER TABLE games ADD COLUMN players_per_team INTEGER;
ALTER TABLE games DROP COLUMN format;
