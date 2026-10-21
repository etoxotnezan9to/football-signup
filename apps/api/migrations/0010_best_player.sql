-- Лучший игрок сбора: выбирает организатор из записавшихся, кто в командах. NULL — не выбран.
ALTER TABLE games ADD COLUMN best_player_id INTEGER REFERENCES users(vk_id);
