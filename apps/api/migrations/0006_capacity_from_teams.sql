-- Число команд и игроков в команде стали обязательными, а вместимость теперь всегда их произведение.
-- Игры без этих значений получают значения по умолчанию (4 × 6). Вместимость пересчитывается у всех игр,
-- но не выше 60 (ограничение CHECK на capacity); у такой игры число команд уменьшается, чтобы произведение не превышало предел.
UPDATE games SET teams_max = 4 WHERE teams_max IS NULL;
UPDATE games SET players_per_team = 6 WHERE players_per_team IS NULL;
UPDATE games SET teams_max = 60 / players_per_team WHERE teams_max * players_per_team > 60;
UPDATE games SET capacity = teams_max * players_per_team;
