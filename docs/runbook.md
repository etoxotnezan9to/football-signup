# Развёртывание и эксплуатация

Статус: файлы в `deploy/` и workflow `deploy.yml` **ещё не запускались на реальном сервере**. Первый запуск делайте на staging и по шагам.

## 0. Что нужно заранее

- Домены с A-записями на IP сервера: `football-test.etoxotnezan9to.ru` (staging) и `football.etoxotnezan9to.ru` (prod).
- SSH-ключ для выкладки (приватный хранится только в GitHub Secrets): `ssh-keygen -t ed25519 -f ~/.ssh/football_deploy -C football-deploy -N ""`.
- «Защищённый ключ» приложения VK (Настройки → Разработка → Ключи доступа). Его вписывают только на сервере в `.env`.

## 1. Подготовка сервера (один раз на окружение)

Скопируйте каталог `deploy` на сервер и **сначала посмотрите план**:

```bash
scp -P 10022 -r deploy root@83.217.211.234:/root/football-deploy
ssh -p 10022 root@83.217.211.234
bash /root/football-deploy/server-setup.sh --env staging --domain football-test.etoxotnezan9to.ru \
  --api-port 3101 --email <ваша-почта> --ghcr-owner <владелец-репозитория-в-нижнем-регистре> \
  --deploy-user deploy --deploy-key-file /root/football_deploy.pub
```

План ничего не меняет. Проверьте список `server_name`, порт (`ss -tlnp`) и добавьте `--apply`. Скрипт создаёт только свои каталоги (`/opt/football/<env>`, `/var/www/football/<env>`), один конфиг `/etc/nginx/conf.d/football-<env>.conf` (с копией прежнего и откатом при ошибке `nginx -t`), сертификат Let's Encrypt, cron бэкапа. Чужие конфиги не меняются.

Дальше вручную:

1. Впишите `VK_APP_SECRET` в `/opt/football/<env>/.env` (права 600). Для личных уведомлений добавьте `VK_SERVICE_KEY` (см. раздел 3а); без него приложение работает, но уведомления выключены.
2. Если репозиторий приватный: под пользователем `deploy` выполните `docker login ghcr.io` (токен с правом `read:packages`).
3. Для prod повторите шаги с `--env prod --domain football.etoxotnezan9to.ru --api-port 3102`.

## 2. Секреты и переменные GitHub

Settings → Environments → New environment: создайте `staging` и `prod`, в каждом в блоке Environment secrets секреты `DEPLOY_HOST`, `DEPLOY_PORT` (10022), `DEPLOY_USER` (`deploy`), `DEPLOY_SSH_KEY` (приватный ключ целиком), `DEPLOY_KNOWN_HOSTS` (вывод `ssh-keyscan -p 10022 <хост>`, чтобы не доверять серверу вслепую), а в блоке Environment variables переменную `DEPLOY_DOMAIN` (домен для проверки по HTTPS).
Settings → Secrets and variables → Actions → вкладка Variables → New repository variable: `DEPLOY_ENABLED=true`.

Запуск: Actions → Deploy → Run workflow → выбрать окружение. Workflow с ручным запуском GitHub показывает, только когда `.github/workflows/deploy.yml` есть в ветке по умолчанию (`main`), поэтому сначала влейте рабочую ветку в `main`. Образ собирается в CI, статика выкладывается на сервер, `release.sh` перезапускает контейнер, ждёт `/api/health` и **откатывается на предыдущий тег**, если новая версия не отвечает.

## 3. Настройка приложения VK

В кабинете приложения: адрес разработческой версии = staging, основной = prod. Проверьте, что внутри VK открывается список и что ссылка `https://vk.com/app54809461#/game/<id>` ведёт на игру. Если в VK пустой экран, откройте консоль браузера: скорее всего нужно дополнить список доменов в `frame-ancestors` (`deploy/nginx.conf.template`).

## 3а. Личные уведомления

1. Возьмите «Сервисный ключ доступа» в настройках приложения (Разработка → Ключи доступа; это не «Защищённый ключ») и впишите в `/opt/football/<env>/.env` как `VK_SERVICE_KEY`, затем пересоздайте контейнер, чтобы он прочитал новый `.env`: `docker compose up -d --force-recreate api`. В логе при старте будет строка «личные уведомления включены».
2. VK принимает уведомления только от приложения, прошедшего модерацию. До модерации можно проверить отправку на пользователях со ролью в приложении, но результат зависит от настроек VK.
3. Получатель должен разрешить уведомления кнопкой в приложении и не отключить «Уведомления игр и приложений» в настройках VK.
4. Лимиты VK: 1 уведомление в час и 3 в сутки на человека. Если уведомление не пришло, посмотрите лог: `docker compose logs api | grep "не доставлено"` (код 1: выключены, 2 и 3: лимиты, 4: приложение не установлено).
5. Ключ не пишется в лог и в адрес запроса, он передаётся только в теле запроса к `api.vk.com`. Если ключ утёк, перевыпустите его в настройках VK и обновите `.env`.

## 4. Эксплуатация

| Задача | Команда (в `/opt/football/<env>`) |
|---|---|
| Логи API | `docker compose logs -f --tail 100 api` |
| Состояние | `docker compose ps`; `curl -fsS http://127.0.0.1:<порт>/api/health` |
| Откат вручную | `echo <прежний-тег> > .tag; TAG=<прежний-тег> docker compose up -d` (прежний тег в `.tag.prev`) |
| Бэкап сейчас | `./backup.sh /opt/football/<env>`; копии в `data/backups`, ежедневно в 03:17, хранится 14 |
| Продление сертификата | автоматически (`certbot.timer`); проверка: `certbot renew --dry-run` |

**Восстановление из копии** (останавливает API): `docker compose stop api && cp data/backups/football-<дата>.db data/football.db && chown 1000:1000 data/football.db && docker compose start api`. Бэкапы лежат на том же сервере: периодически забирайте их в другое место (`scp`, облачное хранилище).

## 5. Безопасность сервера

Выполняйте только после проверки входа по ключу пользователем `deploy`: отключить вход под root по паролю, не закрывать порт SSH 10022 и порты чужих сервисов при включении `ufw`. Группа `docker` фактически даёт права root: ключ деплоя храните только в секретах GitHub.
