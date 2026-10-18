#!/usr/bin/env bash
# Выкладка образа на сервере с проверкой здоровья и откатом. Запуск: release.sh /opt/football/<env> <тег-образа>
set -euo pipefail
DIR="${1:?укажите каталог окружения}"
NEW="${2:?укажите тег образа}"
cd "$DIR"
set -a
# shellcheck disable=SC1091
. ./.env
set +a
: "${API_PORT:?в .env не задан API_PORT}"
: "${GHCR_OWNER:?в .env не задан GHCR_OWNER}"

PREV="$(cat .tag 2>/dev/null || true)"
export TAG="$NEW"
docker compose pull
docker compose up -d

ok=0
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${API_PORT}/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done

if [ "$ok" = 1 ]; then
  [ -n "$PREV" ] && echo "$PREV" > .tag.prev
  echo "$NEW" > .tag
  echo "Выкладка успешна: $NEW"
  exit 0
fi

echo "Версия $NEW не отвечает на /api/health." >&2
docker compose logs --tail 40 api >&2 || true
if [ -n "$PREV" ]; then
  echo "Откат на $PREV" >&2
  export TAG="$PREV"
  docker compose up -d
else
  echo "Предыдущей версии нет, откатываться некуда." >&2
fi
exit 1
