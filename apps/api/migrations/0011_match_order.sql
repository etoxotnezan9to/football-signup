-- Порядок встреч, заданный организатором перетаскиванием: JSON-массив ключей matchKey («1-2-1»).
-- NULL — порядок по умолчанию (defaultMatchOrder в packages/shared).
ALTER TABLE games ADD COLUMN match_order TEXT;
