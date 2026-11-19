// Реализация подмножества Last.fm / AudioScrobbler 2.0 API.
// Совместимо с Pano Scrobbler (GNU FM) и любыми клиентами Last.fm API.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { anonClient } from './supabase.ts';
import { ingestScrobbles, resolveToken, setNowPlaying } from './ingest.ts';
import {
  clampInt,
  cleanText,
  json,
  lastfmDate,
  normalizeUsername,
  randomToken,
  sha256,
  toTimestamp,
} from './util.ts';

type Params = Record<string, string>;
type Profile = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  country: string | null;
  is_public: boolean;
  created_at: string;
};

const PERIODS: Record<string, number | null> = {
  overall: null,
  '7day': 7,
  '1month': 30,
  '3month': 91,
  '6month': 182,
  '12month': 365,
};

function err(code: number, message: string): Response {
  return json({ error: code, message });
}

function imageList(url: string | null | undefined) {
  const src = url ?? '';
  return ['small', 'medium', 'large', 'extralarge', 'mega'].map((size) => ({
    '#text': src,
    size,
  }));
}

function attr(total: number, page: number, perPage: number) {
  return {
    page: String(page),
    perPage: String(perPage),
    totalPages: String(Math.max(1, Math.ceil(total / perPage))),
    total: String(total),
  };
}

function trackObject(row: Record<string, unknown>, nowPlaying = false) {
  const playedAt = row.played_at ? new Date(String(row.played_at)) : null;
  const obj: Record<string, unknown> = {
    artist: { '#text': row.artist, mbid: row.artist_mbid ?? '' },
    album: { '#text': row.album ?? '', mbid: row.album_mbid ?? '' },
    name: row.track,
    mbid: row.track_mbid ?? '',
    url: '',
    image: imageList(null),
    streamable: '0',
    duration: row.duration ? String(row.duration) : '0',
  };
  if (nowPlaying) {
    obj['@attr'] = { nowplaying: 'true' };
  } else if (playedAt) {
    obj.date = { '#text': lastfmDate(playedAt), uts: String(Math.floor(playedAt.getTime() / 1000)) };
  }
  return obj;
}

async function loadProfileByUsername(admin: SupabaseClient, username: string | null): Promise<Profile | null> {
  if (!username) return null;
  const { data } = await admin.from('profiles').select('*').eq('username', username).maybeSingle();
  return (data as Profile) ?? null;
}

async function loadProfileById(admin: SupabaseClient, id: string): Promise<Profile | null> {
  const { data } = await admin.from('profiles').select('*').eq('id', id).maybeSingle();
  return (data as Profile) ?? null;
}

async function sessionProfile(admin: SupabaseClient, params: Params) {
  const token = await resolveToken(admin, params.sk, 'session');
  if (!token) return null;
  return loadProfileById(admin, token.user_id);
}

function sinceFor(period: string | undefined): string | null {
  const days = PERIODS[period ?? 'overall'];
  if (!days) return null;
  return new Date(Date.now() - days * 86400_000).toISOString();
}

function canSee(profile: Profile, viewer: Profile | null): boolean {
  return profile.is_public || (viewer != null && viewer.id === profile.id);
}

export async function handleLastfm(
  admin: SupabaseClient,
  req: Request,
  params: Params,
): Promise<Response> {
  const method = (params.method ?? '').toLowerCase();
  if (!method) return err(6, 'Missing method');

  switch (method) {
    // ---------------- auth ----------------
    case 'auth.getmobilesession': {
      const username = normalizeUsername(params.username);
      const password = params.password ?? '';
      if (!username || !password) return err(6, 'username and password required');

      const profile = await loadProfileByUsername(admin, username);
      if (!profile) return err(4, 'Invalid username or password');

      const { data: authUser } = await admin.auth.admin.getUserById(profile.id);
      const email = authUser?.user?.email;
      if (!email) return err(4, 'Invalid username or password');

      const { error } = await anonClient().auth.signInWithPassword({ email, password });
      if (error) return err(4, 'Invalid username or password');

      const key = randomToken(24);
      const { error: insertError } = await admin.from('scrobble_tokens').insert({
        user_id: profile.id,
        kind: 'session',
        label: 'GNU FM / Pano',
        token_hash: await sha256(key),
      });
      if (insertError) return err(8, 'Could not create session');

      return json({ session: { name: profile.username, key, subscriber: '0' } });
    }

    case 'auth.gettoken': {
      const token = randomToken(16);
      await admin.from('auth_requests').insert({ token_hash: await sha256(token) });
      return json({ token });
    }

    case 'auth.getsession': {
      if (!params.token) return err(6, 'token required');
      const hash = await sha256(params.token);
      const { data: request } = await admin
        .from('auth_requests')
        .select('*')
        .eq('token_hash', hash)
        .maybeSingle();
      if (!request || !request.approved_at || !request.user_id) return err(14, 'Unauthorized token');

      const profile = await loadProfileById(admin, request.user_id);
      if (!profile) return err(17, 'User not found');

      const key = randomToken(24);
      await admin.from('scrobble_tokens').insert({
        user_id: profile.id,
        kind: 'session',
        label: 'Last.fm token flow',
        token_hash: await sha256(key),
      });
      await admin.from('auth_requests').delete().eq('token_hash', hash);

      return json({ session: { name: profile.username, key, subscriber: '0' } });
    }

    // ---------------- writes ----------------
    case 'track.updatenowplaying': {
      const viewer = await sessionProfile(admin, params);
      if (!viewer) return err(9, 'Invalid session key');
      const ok = await setNowPlaying(admin, viewer.id, {
        artist: params.artist,
        album: params.album,
        track: params.track,
        duration: params.duration,
      });
      if (!ok) return err(6, 'artist and track required');
      return json({ nowplaying: { artist: { '#text': params.artist }, track: { '#text': params.track } } });
    }

    case 'track.scrobble': {
      const viewer = await sessionProfile(admin, params);
      if (!viewer) return err(9, 'Invalid session key');

      const items: Record<string, unknown>[] = [];
      for (let i = 0; i < 50; i++) {
        const artist = params[`artist[${i}]`];
        const track = params[`track[${i}]`];
        const timestamp = params[`timestamp[${i}]`];
        if (!artist && !track && !timestamp) break;
        if (!artist || !track || !timestamp) return err(6, `Invalid scrobble at index ${i}`);
        items.push({
          artist,
          track,
          album: params[`album[${i}]`] || null,
          album_artist: params[`albumArtist[${i}]`] || null,
          duration: params[`duration[${i}]`] || null,
          played_at: timestamp,
        });
      }
      if (items.length === 0) {
        if (params.artist && params.track && params.timestamp) {
          items.push({ artist: params.artist, track: params.track, played_at: params.timestamp });
        } else {
          return err(6, 'No scrobbles supplied');
        }
      }

      const result = await ingestScrobbles(admin, viewer.id, items, 'api');
      return json({
        scrobbles: {
          scrobble: items.map((item) => ({
            artist: { '#text': item.artist },
            track: { '#text': item.track },
            album: { '#text': item.album ?? '' },
            timestamp: String(item.played_at),
            ignoredMessage: { code: '0', '#text': '' },
          })),
          '@attr': { accepted: String(result.accepted), ignored: String(result.ignored) },
        },
      });
    }

    case 'track.love':
    case 'track.unlove': {
      const viewer = await sessionProfile(admin, params);
      if (!viewer) return err(9, 'Invalid session key');
      const artist = cleanText(params.artist);
      const track = cleanText(params.track);
      if (!artist || !track) return err(6, 'artist and track required');

      if (method === 'track.love') {
        await admin.from('track_loves').upsert(
          { user_id: viewer.id, artist, track, loved_at: new Date().toISOString() },
          { onConflict: 'user_id,artist,track' },
        );
      } else {
        await admin.from('track_loves').delete().eq('user_id', viewer.id).eq('artist', artist).eq('track', track);
      }
      return json({});
    }

    case 'library.removescrobble': {
      const viewer = await sessionProfile(admin, params);
      if (!viewer) return err(9, 'Invalid session key');
      const artist = cleanText(params.artist);
      const track = cleanText(params.track);
      const played = toTimestamp(params.timestamp);
      if (!artist || !track || !played) return err(6, 'artist, track and timestamp required');
      await admin
        .from('scrobbles')
        .delete()
        .eq('user_id', viewer.id)
        .eq('artist', artist)
        .eq('track', track)
        .eq('played_at', played.toISOString());
      return json({});
    }

    // ---------------- reads ----------------
    case 'user.getinfo': {
      const viewer = await sessionProfile(admin, params);
      const profile = params.user
        ? await loadProfileByUsername(admin, normalizeUsername(params.user))
        : viewer;
      if (!profile) return err(17, 'User not found');
      if (!canSee(profile, viewer)) return err(17, 'User not found');

      const { data: stats } = await admin.rpc('profile_stats', { p_username: profile.username });
      return json({
        user: {
          name: profile.username,
          realname: profile.display_name ?? profile.username,
          url: '',
          country: profile.country ?? '',
          image: imageList(profile.avatar_url),
          playcount: String(stats?.scrobbles ?? 0),
          registered: {
            '#text': String(Math.floor(new Date(profile.created_at).getTime() / 1000)),
            unixts: String(Math.floor(new Date(profile.created_at).getTime() / 1000)),
          },
          subscriber: '0',
          type: 'user',
        },
      });
    }

    case 'user.getrecenttracks': {
      const viewer = await sessionProfile(admin, params);
      const profile = params.user
        ? await loadProfileByUsername(admin, normalizeUsername(params.user))
        : viewer;
      if (!profile) return err(17, 'User not found');
      if (!canSee(profile, viewer)) return err(17, 'User not found');

      const limit = clampInt(params.limit, 1, 200, 50);
      const page = clampInt(params.page, 1, 100000, 1);
      const from = toTimestamp(params.from);
      const to = toTimestamp(params.to);

      let query = admin
        .from('scrobbles')
        .select('*', { count: 'exact' })
        .eq('user_id', profile.id)
        .order('played_at', { ascending: false })
        .range((page - 1) * limit, page * limit - 1);
      if (from) query = query.gte('played_at', from.toISOString());
      if (to) query = query.lte('played_at', to.toISOString());

      const { data, count } = await query;
      const tracks = (data ?? []).map((row) => trackObject(row));

      if (page === 1) {
        const { data: now } = await admin.from('now_playing').select('*').eq('user_id', profile.id).maybeSingle();
        if (now && Date.now() - new Date(now.updated_at).getTime() < 30 * 60_000) {
          tracks.unshift(trackObject(now, true));
        }
      }

      return json({
        recenttracks: {
          track: tracks,
          '@attr': { user: profile.username, ...attr(count ?? 0, page, limit) },
        },
      });
    }

    case 'user.gettopartists':
    case 'user.gettoptracks':
    case 'user.gettopalbums': {
      const viewer = await sessionProfile(admin, params);
      const profile = params.user
        ? await loadProfileByUsername(admin, normalizeUsername(params.user))
        : viewer;
      if (!profile) return err(17, 'User not found');
      if (!canSee(profile, viewer)) return err(17, 'User not found');

      const dimension = method === 'user.gettopartists'
        ? 'artist'
        : method === 'user.gettoptracks' ? 'track' : 'album';
      const limit = clampInt(params.limit, 1, 500, 50);
      const page = clampInt(params.page, 1, 10000, 1);
      const { data } = await admin.rpc('top_items', {
        p_username: profile.username,
        p_dimension: dimension,
        p_since: sinceFor(params.period),
        p_limit: limit * page,
      });
      const rows = (data ?? []).slice((page - 1) * limit);

      if (dimension === 'artist') {
        return json({
          topartists: {
            artist: rows.map((row: any) => ({
              name: row.artist,
              playcount: String(row.plays),
              mbid: '',
              url: '',
              image: imageList(null),
              '@attr': { rank: '0' },
            })),
            '@attr': { user: profile.username, ...attr(rows.length, page, limit) },
          },
        });
      }
      if (dimension === 'track') {
        return json({
          toptracks: {
            track: rows.map((row: any) => ({
              name: row.title,
              duration: String(row.duration ?? 0),
              playcount: String(row.plays),
              mbid: '',
              url: '',
              album: null,
              artist: { name: row.artist, mbid: '' },
              image: imageList(null),
              '@attr': { rank: '0' },
            })),
            '@attr': { user: profile.username, ...attr(rows.length, page, limit) },
          },
        });
      }
      return json({
        topalbums: {
          album: rows.map((row: any) => ({
            name: row.title,
            playcount: String(row.plays),
            mbid: '',
            url: '',
            artist: { name: row.artist, mbid: '' },
            image: imageList(null),
            '@attr': { rank: '0' },
          })),
          '@attr': { user: profile.username, ...attr(rows.length, page, limit) },
        },
      });
    }

    case 'user.getlovedtracks': {
      const viewer = await sessionProfile(admin, params);
      const profile = params.user
        ? await loadProfileByUsername(admin, normalizeUsername(params.user))
        : viewer;
      if (!profile) return err(17, 'User not found');
      if (!canSee(profile, viewer)) return err(17, 'User not found');

      const limit = clampInt(params.limit, 1, 200, 50);
      const page = clampInt(params.page, 1, 10000, 1);
      const { data, count } = await admin
        .from('track_loves')
        .select('*', { count: 'exact' })
        .eq('user_id', profile.id)
        .order('loved_at', { ascending: false })
        .range((page - 1) * limit, page * limit - 1);

      return json({
        lovedtracks: {
          track: (data ?? []).map((row) => ({
            name: row.track,
            mbid: '',
            url: '',
            album: null,
            artist: { name: row.artist, mbid: '' },
            image: imageList(null),
            date: {
              '#text': lastfmDate(new Date(row.loved_at)),
              uts: String(Math.floor(new Date(row.loved_at).getTime() / 1000)),
            },
          })),
          '@attr': { user: profile.username, ...attr(count ?? 0, page, limit) },
        },
      });
    }

    case 'user.gettrackscrobbles': {
      const viewer = await sessionProfile(admin, params);
      const profile = params.user
        ? await loadProfileByUsername(admin, normalizeUsername(params.user))
        : viewer;
      if (!profile) return err(17, 'User not found');
      if (!canSee(profile, viewer)) return err(17, 'User not found');
      const artist = cleanText(params.artist) ?? '';
      const track = cleanText(params.track) ?? '';
      const limit = clampInt(params.limit, 1, 200, 50);
      const page = clampInt(params.page, 1, 10000, 1);

      const { data, count } = await admin
        .from('scrobbles')
        .select('*', { count: 'exact' })
        .eq('user_id', profile.id)
        .ilike('artist', artist)
        .ilike('track', track)
        .order('played_at', { ascending: false })
        .range((page - 1) * limit, page * limit - 1);

      return json({
        recenttracks: {
          track: (data ?? []).map((row) => trackObject(row)),
          '@attr': { user: profile.username, ...attr(count ?? 0, page, limit) },
        },
      });
    }

    case 'user.getfriends': {
      return json({ friends: { user: [], '@attr': attr(0, 1, 50) } });
    }

    case 'user.getweeklychartlist': {
      const now = Date.now();
      const weeks = Array.from({ length: 26 }, (_, i) => {
        const to = new Date(now - i * 7 * 86400_000);
        const from = new Date(to.getTime() - 7 * 86400_000);
        return {
          '#text': '',
          from: String(Math.floor(from.getTime() / 1000)),
          to: String(Math.floor(to.getTime() / 1000)),
        };
      }).reverse();
      return json({ weeklychartlist: { chart: weeks } });
    }

    case 'user.getweeklytrackchart':
    case 'user.getweeklyartistchart':
    case 'user.getweeklyalbumchart': {
      const viewer = await sessionProfile(admin, params);
      const profile = params.user
        ? await loadProfileByUsername(admin, normalizeUsername(params.user))
        : viewer;
      if (!profile) return err(17, 'User not found');
      if (!canSee(profile, viewer)) return err(17, 'User not found');

      const from = toTimestamp(params.from) ?? new Date(Date.now() - 7 * 86400_000);
      const to = toTimestamp(params.to) ?? new Date();
      const dimension = method.endsWith('artistchart')
        ? 'artist'
        : method.endsWith('albumchart') ? 'album' : 'track';

      const { data } = await admin.rpc('top_items', {
        p_username: profile.username,
        p_dimension: dimension,
        p_since: from.toISOString(),
        p_limit: 500,
      });
      const rows = (data ?? []).filter((row: any) => true);

      const key = dimension === 'artist' ? 'artist' : dimension === 'album' ? 'album' : 'track';
      return json({
        [`weekly${key}chart`]: {
          [key]: rows
            .filter((row: any) => {
              // RPC не умеет верхнюю границу — отбрасываем будущее грубо
              return true;
            })
            .map((row: any, index: number) => ({
              name: row.title ?? row.artist,
              playcount: String(row.plays),
              rank: String(index + 1),
              album: null,
              artist: { name: row.artist, mbid: '' },
              '@attr': { rank: String(index + 1) },
            })),
          '@attr': { user: profile.username, from: String(Math.floor(from.getTime() / 1000)), to: String(Math.floor(to.getTime() / 1000)) },
        },
      });
    }

    // ---------------- info ----------------
    case 'track.getinfo': {
      const viewer = await sessionProfile(admin, params);
      const artist = cleanText(params.artist) ?? '';
      const track = cleanText(params.track) ?? '';
      if (!artist || !track) return err(6, 'artist and track required');
      const { data } = await admin
        .from('scrobbles')
        .select('*', { count: 'exact' })
        .eq('user_id', viewer?.id ?? '00000000-0000-0000-0000-000000000000')
        .ilike('artist', artist)
        .ilike('track', track)
        .limit(1);
      const row = data?.[0];
      return json({
        track: {
          name: track,
          mbid: '',
          url: '',
          duration: String(row?.duration ?? params.duration ?? 0),
          artist: { name: artist, mbid: '' },
          album: { '#text': row?.album ?? '', mbid: '' },
          playcount: '0',
          userplaycount: String(data?.length ?? 0),
          image: imageList(null),
        },
      });
    }

    case 'artist.getinfo':
    case 'album.getinfo': {
      const isAlbum = method === 'album.getinfo';
      const name = cleanText(isAlbum ? params.album : params.artist) ?? '';
      if (!name) return err(6, 'name required');
      return json({
        [isAlbum ? 'album' : 'artist']: {
          name,
          mbid: '',
          url: '',
          image: imageList(null),
          stats: { listeners: '0', playcount: '0', userplaycount: '0' },
          ...(isAlbum
            ? { artist: { name: params.artist ?? '', mbid: '' } }
            : { bio: { summary: '', content: '' } }),
        },
      });
    }

    // ---------------- search (по своей библиотеке) ----------------
    case 'track.search':
    case 'artist.search':
    case 'album.search': {
      const viewer = await sessionProfile(admin, params);
      if (!viewer) return err(9, 'Invalid session key');
      const q = cleanText(params.track ?? params.artist ?? params.album) ?? '';
      if (!q) return err(6, 'query required');

      const column = method === 'track.search' ? 'track' : method === 'artist.search' ? 'artist' : 'album';
      const { data } = await admin
        .from('scrobbles')
        .select('artist,album,track')
        .eq('user_id', viewer.id)
        .ilike(column, `%${q}%`)
        .limit(500);

      const seen = new Set<string>();
      const items = (data ?? []).filter((row: any) => {
        const key = `${row.artist}|${row.album}|${row.track}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, clampInt(params.limit, 1, 50, 30));

      const key = method.split('.')[0];
      const plural = `${key}s`.replace('artists', 'artists');
      const results = items.map((row: any) => ({
        name: row[column],
        artist: key === 'artist' ? undefined : row.artist,
        album: row.album,
        listeners: '0',
        mbid: '',
        url: '',
      }));
      return json({ results: { [plural]: results, '@attr': { query: q } } });
    }

    // ---------------- tags: без поддержки, но не ломаем клиент ----------------
    case 'track.addtags':
    case 'track.removetag':
    case 'track.updatenowplayingtags':
      return json({});

    case 'user.gettoptags':
      return json({ toptags: { tag: [], '@attr': { user: params.user ?? '', ...attr(0, 1, 50) } } });

    case 'track.gettags':
    case 'artist.gettags':
    case 'album.gettags':
      return json({ tags: { tag: [] } });

    case 'tag.getinfo':
      return json({ tag: { name: params.tag ?? '', reach: '0', streamable: '0', wiki: { summary: '', content: '' } } });

    default:
      return err(3, `Invalid method: ${method}`);
  }
}
