// Единая Edge Function: Last.fm-совместимый API, webhook, ListenBrainz,
// нативные операции сайта и импорт из Last.fm.

import { adminClient, anonClient, bearer, profileById, userFromJwt } from './supabase.ts';
import { handleLastfm } from './lastfm.ts';
import { createToken, clearNowPlaying, ingestScrobbles, resolveToken, setNowPlaying } from './ingest.ts';
import {
  clampInt,
  cleanText,
  json,
  normalizeScrobble,
  preflight,
  randomToken,
  sha256,
  toTimestamp,
} from './util.ts';

const admin = adminClient();

function routeOf(req: Request): string {
  const path = new URL(req.url).pathname;
  const marker = path.indexOf('/api');
  const tail = marker >= 0 ? path.slice(marker + 4) : path;
  return tail.replace(/\/+$/, '') || '/';
}

async function readParams(req: Request): Promise<Record<string, string>> {
  const url = new URL(req.url);
  const params: Record<string, string> = {};
  for (const [k, v] of url.searchParams) params[k] = v;

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const type = req.headers.get('content-type') ?? '';
    try {
      if (type.includes('application/json')) {
        const body = await req.json();
        if (body && typeof body === 'object') {
          for (const [k, v] of Object.entries(body)) {
            if (typeof v === 'string') params[k] = v;
          }
        }
      } else {
        const form = await req.formData();
        for (const [k, v] of form.entries()) {
          if (typeof v === 'string') params[k] = v;
        }
      }
    } catch {
      // пустое тело — нормально для Last.fm-совместимых вызовов
    }
  }
  return params;
}

async function requireUser(req: Request) {
  const user = await userFromJwt(admin, req);
  if (!user) return null;
  const profile = await profileById(admin, user.id);
  return profile ? { user, profile } : null;
}

// ---------- нативные операции сайта ----------

async function handleTokens(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) return json({ error: 'unauthorized' }, 401);

  if (req.method === 'GET') {
    const { data } = await admin
      .from('scrobble_tokens')
      .select('id,kind,label,created_at,last_used_at,revoked_at')
      .eq('user_id', auth.profile.id)
      .order('created_at', { ascending: false });
    return json({ tokens: data ?? [] });
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const kind = ['webhook', 'listenbrainz'].includes(body.kind) ? body.kind : 'webhook';
    const label = cleanText(body.label, 80) ?? (kind === 'webhook' ? 'Web Scrobbler' : 'ListenBrainz');
    const raw = randomToken(24);
    const row = await createToken(admin, auth.profile.id, kind, label, raw);
    if (!row) return json({ error: 'could not create token' }, 500);
    return json({ id: row.id, kind, label, token: raw }, 201);
  }

  if (req.method === 'DELETE') {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return json({ error: 'id required' }, 400);
    const { error } = await admin
      .from('scrobble_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', auth.profile.id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: 'method not allowed' }, 405);
}

async function handleAuthApprove(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) return json({ error: 'unauthorized' }, 401);
  const body = await req.json().catch(() => ({}));
  const token = cleanText(body.token, 128);
  if (!token) return json({ error: 'token required' }, 400);

  const hash = await sha256(token);
  const { data } = await admin
    .from('auth_requests')
    .update({ user_id: auth.profile.id, approved_at: new Date().toISOString() })
    .eq('token_hash', hash)
    .select('token_hash')
    .maybeSingle();
  if (!data) return json({ error: 'token not found' }, 404);
  return json({ ok: true });
}

async function handleImport(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) return json({ error: 'unauthorized' }, 401);
  const body = await req.json().catch(() => ({}));
  const items = Array.isArray(body.items) ? body.items : null;
  if (!items) return json({ error: 'items must be an array' }, 400);
  if (items.length > 5000) return json({ error: 'too many items in one batch' }, 413);

  const source = ['csv', 'import', 'manual'].includes(body.source) ? body.source : 'csv';
  try {
    const result = await ingestScrobbles(admin, auth.profile.id, items, source);
    return json(result);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'import failed' }, 500);
  }
}

async function handleNowPlaying(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) return json({ error: 'unauthorized' }, 401);
  if (req.method === 'DELETE') {
    await clearNowPlaying(admin, auth.profile.id);
    return json({ ok: true });
  }
  const body = await req.json().catch(() => ({}));
  const ok = await setNowPlaying(admin, auth.profile.id, body);
  return ok ? json({ ok: true }) : json({ error: 'artist and track required' }, 400);
}

// ---------- Last.fm прокси для импорта ----------

const LASTFM_API = 'https://ws.audioscrobbler.com/2.0/';

async function fetchLastfm(params: Record<string, string>): Promise<any> {
  const url = new URL(LASTFM_API);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const response = await fetch(url, { headers: { 'User-Agent': 'scrobble-selfhosted/1.0' } });
  const text = await response.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Last.fm returned HTTP ${response.status}`);
  }
  if (data?.error) throw new Error(`Last.fm: ${data.message ?? data.error}`);
  return data;
}

async function handleLastfmProxy(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) return json({ error: 'unauthorized' }, 401);

  const url = new URL(req.url);
  let body: any = {};
  if (req.method === 'POST') body = await req.json().catch(() => ({}));
  const get = (key: string) => body[key] ?? url.searchParams.get(key);

  const apiKey = cleanText(get('apiKey'), 64);
  const lastfmUser = cleanText(get('lastfmUser'), 64);
  const mode = cleanText(get('mode') ?? 'recent', 16);
  if (!apiKey || !lastfmUser) return json({ error: 'apiKey and lastfmUser required' }, 400);

  const page = clampInt(get('page'), 1, 100000, 1);
  const limit = clampInt(get('limit'), 1, 200, 200);

  try {
    if (mode === 'info') {
      const data = await fetchLastfm({
        method: 'user.getInfo', user: lastfmUser, api_key: apiKey, format: 'json',
      });
      return json({ info: data.user ?? null });
    }

    if (mode === 'loved') {
      const data = await fetchLastfm({
        method: 'user.getLovedTracks', user: lastfmUser, api_key: apiKey, format: 'json',
        limit: String(limit), page: String(page),
      });
      const block = data.lovedtracks ?? {};
      const items = (block.track ?? []).map((track: any) => ({
        artist: track.artist?.name ?? track.artist?.['#text'],
        track: track.name,
        album: track.album?.['#text'] ?? null,
        played_at: Number(track.date?.uts ?? 0),
        source: 'import',
      })).filter((item: any) => item.artist && item.track && item.played_at);
      return json({
        items,
        page: Number(block['@attr']?.page ?? page),
        totalPages: Number(block['@attr']?.totalPages ?? 1),
        total: Number(block['@attr']?.total ?? items.length),
      });
    }

    const data = await fetchLastfm({
      method: 'user.getRecentTracks', user: lastfmUser, api_key: apiKey, format: 'json',
      limit: String(limit), page: String(page), extended: '0',
    });
    const block = data.recenttracks ?? {};
    const items = (block.track ?? [])
      .filter((track: any) => !track['@attr']?.nowplaying && track.date?.uts)
      .map((track: any) => ({
        artist: track.artist?.['#text'] ?? track.artist?.name,
        track: track.name,
        album: track.album?.['#text'] ?? null,
        duration: Number(track.duration ?? 0) || null,
        artist_mbid: track.artist?.mbid || null,
        album_mbid: track.album?.mbid || null,
        track_mbid: track.mbid || null,
        played_at: Number(track.date.uts),
        source: 'import',
      }))
      .filter((item: any) => item.artist && item.track && item.played_at);

    return json({
      items,
      page: Number(block['@attr']?.page ?? page),
      totalPages: Number(block['@attr']?.totalPages ?? 1),
      total: Number(block['@attr']?.total ?? items.length),
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Last.fm request failed' }, 502);
  }
}

// ---------- Web Scrobbler webhook ----------

function pickSong(song: any): Record<string, unknown> {
  const processed = song?.processed ?? {};
  const parsed = song?.parsed ?? {};
  const pick = (key: string) => processed[key] ?? parsed[key] ?? song?.[key] ?? null;
  return {
    artist: pick('artist'),
    album: pick('album'),
    album_artist: pick('albumArtist'),
    track: pick('track'),
    duration: pick('duration'),
  };
}

async function handleWebhook(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const authHeader = bearer(req);
  const token = url.searchParams.get('token') ?? authHeader ?? '';
  const row = await resolveToken(admin, token, 'webhook');
  if (!row) return json({ error: 'invalid token' }, 401);

  const body = await req.json().catch(() => null);
  if (!body) return json({ error: 'invalid json' }, 400);

  const event = String(body.eventName ?? body.event ?? '');
  const data = body.data ?? {};
  const time = toTimestamp(body.time) ?? new Date();

  if (event === 'nowplaying') {
    const song = pickSong(data.song ?? data);
    const ok = await setNowPlaying(admin, row.user_id, song);
    return ok ? json({ ok: true }) : json({ error: 'artist and track required' }, 400);
  }

  if (event === 'paused' || event === 'resumedplaying') {
    return json({ ok: true });
  }

  if (event === 'scrobble') {
    const list = Array.isArray(data.songs) ? data.songs : [data.song ?? data];
    const items = list.map((song: any) => ({ ...pickSong(song), played_at: time.toISOString() }));
    const result = await ingestScrobbles(admin, row.user_id, items, 'webhook');
    return json(result);
  }

  if (event === 'loved') {
    const song = pickSong(data.song ?? data);
    const artist = cleanText(song.artist);
    const track = cleanText(song.track);
    if (!artist || !track) return json({ error: 'artist and track required' }, 400);
    if (data.isLoved === false) {
      await admin.from('track_loves').delete().eq('user_id', row.user_id).eq('artist', artist).eq('track', track);
    } else {
      await admin.from('track_loves').upsert(
        { user_id: row.user_id, artist, track, loved_at: new Date().toISOString() },
        { onConflict: 'user_id,artist,track' },
      );
    }
    return json({ ok: true });
  }

  return json({ ok: true, ignored: true });
}

// ---------- ListenBrainz-совместимый приём ----------

async function handleListenbrainz(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const header = req.headers.get('authorization') ?? '';
  const token = url.searchParams.get('token')
    ?? header.replace(/^Token\s+/i, '').trim();
  const row = await resolveToken(admin, token, 'listenbrainz');
  if (!row) return json({ error: 'invalid token' }, 401);

  const body = await req.json().catch(() => null);
  const listens = Array.isArray(body?.payload) ? body.payload : [];
  if (listens.length === 0) return json({ status: 'ok' });

  const items = listens.map((listen: any) => {
    const meta = listen.track_metadata ?? {};
    return {
      artist: meta.artist_name ?? listen.artist_name,
      track: meta.track_name ?? listen.track_name,
      album: meta.release_name ?? null,
      track_mbid: meta.additional_info?.recording_mbid ?? listen.recording_msid ?? null,
      artist_mbid: meta.additional_info?.artist_mbids?.[0] ?? null,
      duration: meta.additional_info?.duration_ms ? Number(meta.additional_info.duration_ms) / 1000 : null,
      played_at: listen.listened_at ?? listen.played_at,
    };
  });

  const result = await ingestScrobbles(admin, row.user_id, items, 'listenbrainz');
  return json({ status: 'ok', accepted: result.accepted });
}

// ---------- entry ----------

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;

  const route = routeOf(req);

  try {
    if (route === '/webhook' || route === '/webhook/') return await handleWebhook(req);
    if (route === '/tokens') return await handleTokens(req);
    if (route === '/auth/approve') return await handleAuthApprove(req);
    if (route === '/import') return await handleImport(req);
    if (route === '/now-playing') return await handleNowPlaying(req);
    if (route === '/lastfm') return await handleLastfmProxy(req);
    if (route === '/lb/1/submit-listens' || route === '/1/submit-listens') return await handleListenbrainz(req);

    // Last.fm-совместимый корень: /api/2.0/ , /api/ , или вызов с ?method=
    const params = await readParams(req);
    if (route === '/2.0' || route === '/' || params.method) {
      return await handleLastfm(admin, req, params);
    }

    return json({ error: 'not found', route }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : 'internal error' }, 500);
  }
});
