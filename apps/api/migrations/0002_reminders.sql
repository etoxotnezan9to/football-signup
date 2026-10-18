-- Напоминание участникам за сутки до игры отправляется один раз: время отправки хранится в игре.
ALTER TABLE games ADD COLUMN reminder_sent_at TEXT;
