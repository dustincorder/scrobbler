# Подключение клиентов

## Pano Scrobbler (Android / TV / Windows)

Pano умеет GNU FM — это Last.fm-совместимый сервер.

1. Установи приложение и открой онбординг (или Настройки → Сервисы скробблинга).
2. Выбери **GNU FM** (не Last.fm).
3. URL сервера:

   ```
   https://<project-ref>.supabase.co/functions/v1/api/2.0
   ```

4. Имя пользователя и пароль — те же, что на сайте scrobble.
5. Сохрани. Pano вызовет `auth.getMobileSession` и получит ключ сессии.

Что работает: скробблинг, now playing, лайки, удаление скробблов, история,
топы, недельные графики, страницы трека/артиста/альбома.

Ограничение: Pano хранит пароль у себя, потому что GNU FM-вход парольный.
Если не хочешь — используй отдельный пароль или Webhook-путь.

## Web Scrobbler (Chrome / Firefox / Edge)

1. Сайт → **Настройки → Токены → Создать токен** → тип `webhook`.
2. Скопируй URL, который появился (он хранится только в этом браузере):

   ```
   https://<project-ref>.supabase.co/functions/v1/api/webhook?token=<token>
   ```

3. Web Scrobbler → Настройки → **Добавить сервис** → **Webhook**.
4. Вставь URL в поле адреса, сохрани.
5. Поставь галочку скробблинга для Webhook.

Поддерживаются события `nowplaying`, `scrobble`, `loved`, `paused`,
`resumedplaying`. Now playing живёт 30 минут.

## Любой Last.fm-клиент

API root:

```
https://<project-ref>.supabase.co/functions/v1/api/2.0
```

Клиенту нужны `api_key` и `api_secret` — подойдёт любая непустая строка
(подпись не проверяется, потому что это собственный сервер). Авторизация:
`auth.getToken` → открыть
`https://<сайт>/#/connect?token=<token>` → войти → `auth.getSession`.
Либо сразу `auth.getMobileSession` с именем и паролем.

## API-ключ

Сайт → **Настройки → Токены → Создать токен** → тип `API-ключ`. Это токен
вида `session`, он работает везде, где принимается ключ сессии:

- как `sk` в вызовах `/api/2.0` (`method=track.scrobble&sk=<ключ>`);
- как `?token=<ключ>` или `Authorization: Bearer <ключ>` в `/api/scrobble`.

Простой приём скробблов для скриптов и своих клиентов:

```sh
curl -X POST "https://<project-ref>.supabase.co/functions/v1/api/scrobble?token=<ключ>" \
  -H 'Content-Type: application/json' \
  -d '{"artist":"Кино","track":"Звезда по имени Солнце","album":"Звезда по имени Солнце"}'
```

Тело — один объект или массив (или `{"items":[...]}`). Поля: `artist`,
`track`, опционально `album`, `album_artist`, `duration`, `played_at`
(секунды UNIX или ISO). Если `played_at` нет — пишется «сейчас».

## ListenBrainz-совместимые клиенты

Базовый API URL (клиент сам допишет `/1/submit-listens` и `/1/validate-token`):

```
https://<project-ref>.supabase.co/functions/v1/api
```

Заголовок:

```
Authorization: Token <listenbrainz-токен или API-ключ из настроек>
```

Поддерживаются `listen_type`: `single`, `import`, `playing_now` (ставит
«сейчас играет»). В Web Scrobbler это сервис ListenBrainz — в настройках
расширения вставить API URL и токен. У Pano адрес ListenBrainz зашит, ему —
GNU FM.

## Проверка, что всё работает

```sh
curl -s "https://<project-ref>.supabase.co/functions/v1/api/2.0/?method=user.getInfo&user=<имя>&format=json"
```

Должен вернуть JSON с `user.playcount`. Публичный профиль виден без ключа.

Если Pano пишет «Invalid username or password» — проверь, что в Supabase
Authentication выключено подтверждение почты и пользователь реально создан
через сайт (а не через вход по email).
