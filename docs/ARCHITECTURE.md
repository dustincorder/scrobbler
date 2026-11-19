# Архитектура

## Границы выполнения

```
GitHub Pages (публичная статика, Vite)
  ├─ Supabase Auth           вход по имени + паролю
  ├─ PostgREST               чтение scrobbles/top через RLS
  └─ fetch → Edge Function   запись, токены, импорт

Supabase Edge Function `api` (Deno, service role)
  ├─ /2.0                  Last.fm AudioScrobbler 2.0 (JSON)
  ├─ /webhook              Web Scrobbler
  ├─ /1/submit-listens     ListenBrainz
  ├─ /tokens               выпуск/отзыв токенов (нужен JWT)
  ├─ /import               пакетная запись (нужен JWT)
  ├─ /lastfm               прокси к Last.fm для импорта (нужен JWT)
  └─ /auth/approve         подтверждение token flow
```

GitHub Pages не выполняет серверный код. Браузер недоверенный: любое решение о
доступе принимает Postgres (RLS) или Edge Function.

## Почему Supabase, а не Cloudflare

GitHub Pages не принимает POST. Скробблерам нужен HTTP-endpoint, поэтому нужен
бэкенд. Supabase даёт Postgres + Auth + Edge Functions на free tier и не требует
своего сервера. Cloudflare остаётся вариантом для домена/DNS.

## Модель данных

| таблица | назначение | запись |
|---|---|---|
| `profiles` | username, отображаемое имя, аватар, приватность | владелец (RLS), триггер при регистрации |
| `scrobbles` | одна строка = одно прослушивание | только service role |
| `now_playing` | последний `updateNowPlaying`, TTL 30 минут | владелец / service role |
| `track_loves` | лайки | владелец / service role |
| `scrobble_tokens` | хеши ключей сессий и webhook | только service role |
| `auth_requests` | одноразовые токены Last.fm token flow | только service role |
| `import_jobs` | журнал импорта (зарезервировано) | service role |

`scrobbles` дедуплицируются по `(user_id, artist, track, played_at)`.
Повторный импорт безопасен.

Ключи клиентов не хранятся в открытом виде: в базе только SHA-256.
Plaintext показывается один раз при создании.

## Публичный доступ

`can_view_profile(user_id)` возвращает true, если профиль публичный или это
текущий пользователь. Политики `select` на `scrobbles`, `now_playing`,
`track_loves` используют эту функцию.

Агрегаты считаются `security definer`-функциями (`top_items`, `profile_stats`,
`daily_counts`, `artist_page`, `album_page`, `track_page`, `track_history`),
которые сами проверяют доступ и не требуют чтения чужих строк клиентом.

## Last.fm API

Реализовано подмножество, нужное Pano Scrobbler и типичным клиентам:

- `auth.getMobileSession`, `auth.getToken`, `auth.getSession`;
- `track.updateNowPlaying`, `track.scrobble` (до 50 за вызов), `track.love`,
  `track.unlove`, `library.removeScrobble`;
- `user.getInfo`, `getRecentTracks`, `getLovedTracks`, `getTopArtists`,
  `getTopTracks`, `getTopAlbums`, `getTrackScrobbles`, `getFriends`,
  `getWeeklyChartList`, weekly chart-методы;
- `artist.getInfo`, `album.getInfo`, `track.getInfo`, поиск по своей библиотеке;
- tag-методы отвечают пустым объектом, чтобы не ломать клиентов.

Подпись `api_sig` не проверяется: Pano подписывает запросы захардкоженным ключом
LibreFM. Аутентификация — ключ сессии `sk` + Supabase Auth при логине.

Ответы всегда JSON, HTTP 200 даже для логических ошибок (формат Last.fm:
`{"error": code, "message": "..."}`).

## Клиенты

- **Pano Scrobbler**: тип GNU FM, `apiRoot = .../functions/v1/api/2.0`,
  логин `auth.getMobileSession` с именем и паролем сайта.
- **Web Scrobbler**: сервис Webhook, URL с токеном.
- **ListenBrainz-совместимые**: `POST /1/submit-listens`, `Authorization: Token`.

## Импорт

`/lastfm` проксирует `user.getInfo`, `user.getRecentTracks`, `user.getLovedTracks`.
Ключ Last.fm приходит в каждом запросе и не сохраняется. Фронтенд идёт по
страницам по 200, отправляет их в `/import` пакетами, прогресс держит в
localStorage. CSV-экспорт разбирается в браузере (`src/csv.js`).

## Ограничения

- Нет рекомендаций, радио, скробблов «в реальном времени» для друзей.
- Обложки ищутся в iTunes Search API, а не хранятся у себя.
- Полнотекстового поиска по всей базе нет — только по своей библиотеке.
- Free tier Supabase: 500 МБ БД; при ~200 байт на скроббл это миллионы строк.
