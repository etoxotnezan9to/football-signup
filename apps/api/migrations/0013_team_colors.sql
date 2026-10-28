-- Цвет команды, выбранный организатором или скопированный из другого сбора: ключ из TEAM_COLORS (packages/shared).
-- NULL — цвет по умолчанию для номера команды (resolveTeamColors).
ALTER TABLE game_teams ADD COLUMN color TEXT;
