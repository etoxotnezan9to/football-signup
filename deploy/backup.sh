#!/usr/bin/env bash
# Консистентная копия SQLite (VACUUM INTO) и ротация. Запуск: deploy/backup.sh /opt/football/<env> [сколько_хранить]
# Работает внутри контейнера api, поэтому sqlite3 на хосте не нужен.
set -euo pipefail
DIR="${1:?укажите каталог окружения, например /opt/football/prod}"
KEEP="${2:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
cd "$DIR"
docker compose exec -T api node -e "
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
fs.mkdirSync('/data/backups', { recursive: true });
const db = new DatabaseSync('/data/football.db');
db.exec(\"VACUUM INTO '/data/backups/football-${STAMP}.db'\");
db.close();
"
# оставляем KEEP самых новых копий
ls -1t data/backups/football-*.db 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f --
echo "Копия создана: $DIR/data/backups/football-${STAMP}.db"
