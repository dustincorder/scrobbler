# Agent guide

Canonical instructions for coding agents. Read before editing. Keep it accurate.

## Product

`scrobble` is a self-hosted Last.fm replacement. Public static frontend on GitHub
Pages, Supabase as backend. Interface language is Russian. Own data, no Last.fm
API dependency after import.

Two hard compatibility targets:

- **Pano Scrobbler** connects as GNU FM: `apiRoot = <fn>/api/2.0`, logs in via
  `auth.getMobileSession` with username/password, then sends `sk`.
- **Web Scrobbler** connects via its Webhook service.

## Stack and commands

- Frontend: Vite 7, vanilla JS modules, plain CSS.
- Backend: Supabase PostgreSQL + RLS + one Edge Function (`api`, Deno).
- Tests: `node --test`.

```sh
npm ci
npm test
VITE_SUPABASE_URL=... VITE_SUPABASE_PUBLISHABLE_KEY=... npm run build
```

Node 22+.

## Repository map

- `src/main.js` — boot, session lifecycle, hash routing, shell, auth state.
- `src/api.js` — Supabase client, read queries, RPCs, iTunes artwork cache, auth.
- `src/router.js` — hash routes (Pages has no SPA fallback).
- `src/format.js` — dates, Russian plurals, escaping.
- `src/csv.js` — Last.fm CSV parsing.
- `src/ui.js` — shared components (rows, covers, heatmap, charts).
- `src/views/` — profile, detail pages, auth, settings, import.
- `supabase/schema.sql` — full schema for a fresh project.
- `supabase/migrations/` — ordered copies for existing projects.
- `supabase/functions/api/index.ts` — dispatch, webhook, tokens, import, Last.fm proxy.
- `supabase/functions/api/lastfm.ts` — Last.fm 2.0 protocol subset.
- `supabase/functions/api/ingest.ts` — token resolution and scrobble ingestion.
- `supabase/functions/api/util.ts` — normalization, hashing, dates.

## Security invariants

1. GitHub Pages and all shipped JS are public. Authorization lives in RLS and
   the Edge Function, never in hidden UI.
2. Never commit `SUPABASE_SERVICE_ROLE_KEY`, access tokens, `.env.local`, or real
   passwords. The Vite URL and publishable key are public by design.
3. `scrobbles`, `now_playing` and `track_loves` accept writes only through the
   Edge Function or explicit owner policies. Do not add anonymous insert.
4. Client tokens are stored as SHA-256 hashes only. Plaintext leaves the server
   exactly once, at creation.
5. Last.fm API keys from the import UI are used per request and never persisted.
6. All public reads go through `can_view_profile` / `security definer` RPCs.
7. Render user content with `textContent`/DOM APIs; `escapeHtml` for templates.
8. Keep `verify_jwt = false` only for the `api` function, which does its own auth
   (session key, webhook token, Supabase JWT depending on the route).

## Protocol rules

- Last.fm responses are JSON, HTTP 200 even for logical errors:
  `{ "error": code, "message": "..." }`.
- Do not verify `api_sig`: Pano signs with a hardcoded LibreFM secret.
- Keep `@attr` pagination fields accurate; Pano depends on `totalPages`.
- `track.updateNowPlaying` must not create a scrobble.

## Data rules

- Scrobbles dedupe on `(user_id, artist, track, played_at)`.
- Ingestion validates timestamps (not future, not before 2002) and text length.
- Import must stay resumable; never discard a partial batch silently.

## Change discipline

- Do not apply migrations or deploy functions to a live project without explicit
  authorization.
- Add tests for router, CSV, and formatting changes.
- Keep mobile layout usable; check 360 px width.

## Definition of done

Build passes, tests pass, Pano and Webhook paths still match the documented
contract, no secrets in the frontend, and docs reflect any new operator step.
