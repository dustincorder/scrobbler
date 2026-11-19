# scrobble

Своя замена Last.fm: история прослушиваний, статистика и профиль на GitHub Pages.
Скробблы принимает Supabase Edge Function, совместимая с **Pano Scrobbler** (Last.fm / GNU FM API)
и **Web Scrobbler** (webhook). Плюс импорт всей истории из Last.fm.

```
GitHub Pages (статика)  ──►  Supabase Postgres (RLS, только чтение для публики)
        │                        ▲
        └── Supabase Auth        │  service role
                                 │
                     Edge Function /api
                     ├─ Last.fm 2.0 API  ← Pano, любые Last.fm-клиенты
                     ├─ /webhook         ← Web Scrobbler
                     ├─ /1/submit-listens← ListenBrainz-клиенты
                     └─ /import          ← импорт Last.fm / CSV
```

## Возможности

- профиль слушателя: топ артистов, альбомов, треков, любимое;
- «сейчас играет» с обновлением без перезагрузки;
- график активности и тепловая карта за год;
- страницы артиста, альбома и трека с историей;
- периоды: неделя / месяц / 3 месяца / год / всё время;
- обложки через iTunes Search API с кешем в браузере;
- импорт всей истории Last.fm (API или CSV-экспорт);
- публичный или скрытый профиль;
- панель токенов: webhook и ListenBrainz, отзыв в один клик.

## Быстрый старт

### 1. Supabase

1. Создай проект на [supabase.com](https://supabase.com) (free tier достаточно).
2. SQL Editor → вставь целиком `supabase/schema.sql` → Run.
3. Authentication → Sign In / Providers → Email:
   - **Confirm email: выключить** (вход по синтетическому адресу `имя@users.scrobble.invalid`);
   - включить Email + Password.
4. Authentication → URL Configuration → Site URL: адрес твоего сайта.

### 2. Edge Function

Нужен [Supabase CLI](https://supabase.com/docs/guides/cli).

```sh
supabase login
supabase link --project-ref <project-ref>
supabase functions deploy api --no-verify-jwt
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` и `SUPABASE_SERVICE_ROLE_KEY` Supabase подставляет сам.
Секретов в коде нет.

### 3. GitHub Pages

1. Запушь репозиторий на GitHub.
2. Settings → Pages → Source: **GitHub Actions**.
3. Settings → Secrets and variables → Actions → **Variables**:
   - `VITE_SUPABASE_URL` — `https://<project-ref>.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` — publishable (anon) key
4. Пуш в `main` собирает и публикует сайт.

Локально:

```sh
cp .env.example .env.local   # вписать свои значения
npm install
npm run dev
npm test
```

## Подключение клиентов

### Pano Scrobbler

- Сервис: **GNU FM** (Last.fm-совместимый).
- URL сервера: `https://<project-ref>.supabase.co/functions/v1/api/2.0`
- Имя и пароль — как на сайте.

Pano получает ключ сессии через `auth.getMobileSession`. Пароль хранится самим Pano;
на сервере он проверяется через Supabase Auth и никуда не пишется.

### Web Scrobbler

1. Сайт → Настройки → Токены → создать **webhook**-токен.
2. Скопировать появившийся URL вида
   `https://<project-ref>.supabase.co/functions/v1/api/webhook?token=…`.
3. Web Scrobbler → Настройки → Добавить сервис → **Webhook** → вставить URL.

### ListenBrainz-клиенты

Endpoint: `https://<project-ref>.supabase.co/functions/v1/api/1/submit-listens`,
токен типа **listenbrainz** в заголовке `Authorization: Token <token>`.

## Импорт Last.fm

Два пути:

1. **API** (нужен ключ). Ключ создаётся на [last.fm/api/account/create](https://www.last.fm/api/account/create).
   С 1 декабря 2026 новые ключи требуют Last.fm Pro — забирай историю, пока можно.
   Сайт → Импорт → имя + ключ → «Импортировать всё». Страницы идут по 200,
   прогресс сохраняется в браузере, можно продолжить после обрыва.
2. **CSV/JSON** без ключа: Last.fm → Settings → Export data → распаковать → загрузить файл
   в разделе «Импорт → CSV». Понимаются колонки `artist / track / uts`
   (а также `timestamp`, `date`, `title`, `name`), плюс JSON из скрипта ниже.

Выгрузить всё локально, не поднимая бэкенд:

```sh
LASTFM_API_KEY=xxxx npm run export:lastfm -- --user slutvibe --out lastfm.json
# или сразу CSV, который понимает импорт
LASTFM_API_KEY=xxxx npm run export:lastfm -- --user slutvibe --out lastfm.csv
```

Скрипт идёт по всем страницам `user.getRecentTracks`, забирает любимые треки и
информацию профиля.

## Безопасность

- GitHub Pages и весь фронтенд публичны. Доступ решают RLS и Edge Function.
- `service_role` живёт только в Edge Function, в браузер не попадает.
- Запись скробблов возможна только через Edge Function или токен.
- Публичные чтения ограничены профилями с `is_public = true`.
- Пароли не хранятся в базе приложения: только Supabase Auth.

## Структура

```
src/                 фронтенд (Vite, vanilla JS)
  views/             профиль, детали, настройки, импорт, вход
supabase/
  schema.sql         полная схема для нового проекта
  migrations/        то же, для истории
  functions/api/     Last.fm API + webhook + ListenBrainz + импорт
tests/               node:test
docs/                архитектура и инструкции
```

Подробности: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/CLIENTS.md](docs/CLIENTS.md).
