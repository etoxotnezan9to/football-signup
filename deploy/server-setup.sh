#!/usr/bin/env bash
# Подготовка сервера под ОДНО окружение (staging или prod).
# По умолчанию скрипт ТОЛЬКО ПОКАЗЫВАЕТ ПЛАН и ничего не меняет. Для выполнения добавьте --apply.
# Трогает только своё: каталоги /opt/football/<env> и /var/www/football/<env>, один конфиг nginx
# (/etc/nginx/conf.d/football-<env>.conf), один файл cron, при желании пользователя для деплоя.
# Чужие сервисы и конфиги nginx не изменяются. Перед заменой нашего конфига делается копия.
set -euo pipefail

usage() {
  cat <<USAGE
Использование: $0 --env staging|prod --domain <домен> --api-port <порт> --email <почта> --ghcr-owner <владелец> [--deploy-user <имя> --deploy-key-file <файл.pub>] [--apply]
  --env             окружение
  --domain          домен окружения (A-запись должна указывать на этот сервер)
  --api-port        свободный порт на 127.0.0.1 для API (разные для staging и prod)
  --email           почта для Let's Encrypt
  --ghcr-owner      владелец репозитория GitHub в нижнем регистре (путь образа ghcr.io/<владелец>/football-api)
  --deploy-user     создать пользователя для выкладки (вход по ключу, членство в группе docker)
  --deploy-key-file файл с ПУБЛИЧНЫМ ключом для этого пользователя
  --apply           выполнить (без него только план)
USAGE
  exit 2
}

ENV_NAME=""; DOMAIN=""; API_PORT=""; EMAIL=""; GHCR_OWNER=""; DEPLOY_USER=""; DEPLOY_KEY_FILE=""; APPLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENV_NAME="${2:-}"; shift 2 ;;
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --api-port) API_PORT="${2:-}"; shift 2 ;;
    --email) EMAIL="${2:-}"; shift 2 ;;
    --ghcr-owner) GHCR_OWNER="${2:-}"; shift 2 ;;
    --deploy-user) DEPLOY_USER="${2:-}"; shift 2 ;;
    --deploy-key-file) DEPLOY_KEY_FILE="${2:-}"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    *) usage ;;
  esac
done

[[ "$ENV_NAME" =~ ^(staging|prod)$ ]] || usage
[[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || { echo "Некорректный домен" >&2; usage; }
[[ "$API_PORT" =~ ^[0-9]+$ ]] && [ "$API_PORT" -ge 1024 ] && [ "$API_PORT" -le 65535 ] || { echo "Некорректный порт" >&2; usage; }
[ -n "$EMAIL" ] && [ -n "$GHCR_OWNER" ] || usage
if [ -n "$DEPLOY_USER" ]; then
  [[ "$DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || { echo "Некорректное имя пользователя" >&2; usage; }
  [ -f "$DEPLOY_KEY_FILE" ] || { echo "Укажите существующий файл публичного ключа (--deploy-key-file)" >&2; usage; }
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="/opt/football/$ENV_NAME"
WEB_ROOT="/var/www/football/$ENV_NAME"
CONF="/etc/nginx/conf.d/football-$ENV_NAME.conf"
OWNER_OF_FILES="${DEPLOY_USER:-root}"

say() { printf '%s\n' "$*"; }
act() { # act "описание" команда...
  local desc="$1"; shift
  if [ "$APPLY" = 1 ]; then say "==> $desc"; "$@"; else say "[план] $desc"; fi
}

# ---------- проверки (только чтение) ----------
say "Окружение: $ENV_NAME, домен: $DOMAIN, порт API: 127.0.0.1:$API_PORT"
[ "$APPLY" = 1 ] && [ "$(id -u)" != 0 ] && { echo "Для --apply нужен root" >&2; exit 1; }
for cmd in nginx docker; do
  command -v "$cmd" >/dev/null || { echo "Не найден $cmd" >&2; exit 1; }
done
if ss -tln | awk '{print $4}' | grep -Eq "[:.]${API_PORT}\$"; then
  echo "Порт $API_PORT уже занят, выберите другой (ss -tlnp)" >&2; exit 1
fi
RESOLVED="$(getent hosts "$DOMAIN" | awk '{print $1; exit}' || true)"
if [ -z "$RESOLVED" ]; then
  say "ВНИМАНИЕ: $DOMAIN пока не резолвится. Создайте A-запись, иначе Let's Encrypt не выдаст сертификат."
else
  say "$DOMAIN -> $RESOLVED (убедитесь, что это адрес этого сервера)"
fi
say "Уже настроенные server_name в nginx (для сверки на конфликты):"
nginx -T 2>/dev/null | grep -E '^\s*server_name ' | sort -u | sed 's/^/    /' || true

# ---------- шаги ----------
create_deploy_user() {
  id "$DEPLOY_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEPLOY_USER"
  usermod -aG docker "$DEPLOY_USER"
  install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
  local ak="/home/$DEPLOY_USER/.ssh/authorized_keys"
  touch "$ak"
  grep -qxF "$(cat "$DEPLOY_KEY_FILE")" "$ak" || cat "$DEPLOY_KEY_FILE" >> "$ak"
  chown "$DEPLOY_USER:$DEPLOY_USER" "$ak"; chmod 600 "$ak"
}

make_dirs() {
  mkdir -p "$APP_DIR/data/backups" "$WEB_ROOT" /var/www/certbot
  chown 1000:1000 "$APP_DIR/data" "$APP_DIR/data/backups"   # uid пользователя node внутри контейнера
  chown "$OWNER_OF_FILES" "$APP_DIR" "$WEB_ROOT"
  install -m 644 -o "$OWNER_OF_FILES" "$HERE/docker-compose.yml" "$APP_DIR/docker-compose.yml"
  install -m 755 -o "$OWNER_OF_FILES" "$HERE/backup.sh" "$APP_DIR/backup.sh"
  install -m 755 -o "$OWNER_OF_FILES" "$HERE/release.sh" "$APP_DIR/release.sh"
}

make_env() {
  if [ -f "$APP_DIR/.env" ]; then
    echo "$APP_DIR/.env уже есть, не трогаю"
    return
  fi
  install -m 600 -o "$OWNER_OF_FILES" "$HERE/.env.example" "$APP_DIR/.env"
  sed -i "s|^API_PORT=.*|API_PORT=$API_PORT|; s|^GHCR_OWNER=.*|GHCR_OWNER=$GHCR_OWNER|" "$APP_DIR/.env"
  echo "Создан $APP_DIR/.env. ЗАПОЛНИТЕ VK_APP_SECRET вручную."
}

install_certbot() {
  command -v certbot >/dev/null || { apt-get update -y && apt-get install -y certbot; }
}

nginx_install() { # nginx_install <файл-с-конфигом>: копия старого, проверка, откат при ошибке
  local new="$1" backup=""
  if [ -f "$CONF" ]; then backup="$CONF.bak.$(date +%Y%m%d%H%M%S)"; cp "$CONF" "$backup"; fi
  cp "$new" "$CONF"
  if nginx -t; then
    systemctl reload nginx
  else
    echo "nginx -t не прошёл, возвращаю прежний конфиг" >&2
    if [ -n "$backup" ]; then cp "$backup" "$CONF"; else rm -f "$CONF"; fi
    exit 1
  fi
}

issue_certificate() {
  local tmp; tmp="$(mktemp)"
  cat > "$tmp" <<CONF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 404; }
}
CONF
  nginx_install "$tmp"
  certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" \
    --deploy-hook "systemctl reload nginx"
  rm -f "$tmp"
}

install_full_nginx_conf() {
  local tmp; tmp="$(mktemp)"
  sed -e "s|__ENV__|$ENV_NAME|g" -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__WEB_ROOT__|$WEB_ROOT|g" \
      -e "s|__API_PORT__|$API_PORT|g" "$HERE/nginx.conf.template" > "$tmp"
  nginx_install "$tmp"
  rm -f "$tmp"
}

install_backup_cron() {
  cat > "/etc/cron.d/football-backup-$ENV_NAME" <<CRON
17 3 * * * $OWNER_OF_FILES $APP_DIR/backup.sh $APP_DIR 14 >> /var/log/football-backup-$ENV_NAME.log 2>&1
CRON
  chmod 644 "/etc/cron.d/football-backup-$ENV_NAME"
  touch "/var/log/football-backup-$ENV_NAME.log"; chown "$OWNER_OF_FILES" "/var/log/football-backup-$ENV_NAME.log"
}

[ -n "$DEPLOY_USER" ] && act "Создать пользователя $DEPLOY_USER (вход по ключу, группа docker) и добавить публичный ключ" create_deploy_user
act "Создать каталоги $APP_DIR, $WEB_ROOT и скопировать compose и скрипты" make_dirs
act "Создать $APP_DIR/.env (права 600) из примера, если его нет" make_env
act "Установить certbot, если его нет" install_certbot
act "Получить сертификат Let's Encrypt для $DOMAIN (временный http-конфиг nginx)" issue_certificate
act "Установить рабочий конфиг nginx $CONF (проверка nginx -t, откат при ошибке)" install_full_nginx_conf
act "Включить ежедневный бэкап БД в 03:17 (14 копий)" install_backup_cron

if [ "$APPLY" = 1 ]; then
  say ""
  say "Готово. Что осталось сделать вручную:"
  say "  1. Вписать VK_APP_SECRET в $APP_DIR/.env (Защищённый ключ из настроек приложения VK)."
  say "  2. Если репозиторий приватный: под пользователем $OWNER_OF_FILES выполнить docker login ghcr.io (токен с правом read:packages)."
  say "  3. Запустить выкладку из GitHub Actions (workflow Deploy) или вручную: $APP_DIR/release.sh $APP_DIR <тег>."
else
  say ""
  say "Это был только план. Для выполнения добавьте --apply."
fi
