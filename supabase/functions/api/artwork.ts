// Резолвер обложек/аватаров: общий кэш в таблице artwork, источники — Deezer, затем iTunes.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const MISS_TTL = 30 * 86400_000; // «ничего не нашли» перепроверяем раз в 30 дней

async function deezer(path: string): Promise<any> {
  try {
    const r = await fetch(`https://api.deezer.com${path}`);
    if (r.ok) return await r.json();
  } catch { /* недоступно — пробуем следующий источник */ }
  return null;
}

async function itunes(term: string, entity: string): Promise<string | null> {
  try {
    const r = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=${entity}&limit=1`,
    );
    if (r.ok) {
      const data = await r.json();
      const raw = data?.results?.[0]?.artworkUrl100 ?? data?.results?.[0]?.artworkUrl60;
      if (raw) return raw.replace(/\/\d+x\d+bb\./, '/600x600bb.');
    }
  } catch { /* нет картинки */ }
  return null;
}

async function fetchArtistImage(artist: string): Promise<string | null> {
  const dz = await deezer(`/search/artist?q=${encodeURIComponent(artist)}&limit=1`);
  const pic = dz?.data?.[0]?.picture_xl ?? dz?.data?.[0]?.picture_big;
  if (pic) return pic;
  return itunes(artist, 'musicArtist');
}

async function fetchAlbumImage(artist: string, album: string): Promise<string | null> {
  const strict = await deezer(
    `/search/album?q=${encodeURIComponent(`artist:"${artist}" album:"${album}"`)}&limit=1`,
  );
  const pic = strict?.data?.[0]?.cover_xl ?? strict?.data?.[0]?.cover_big;
  if (pic) return pic;
  const loose = await deezer(`/search/album?q=${encodeURIComponent(`${artist} ${album}`)}&limit=1`);
  const pic2 = loose?.data?.[0]?.cover_xl ?? loose?.data?.[0]?.cover_big;
  if (pic2) return pic2;
  return itunes(`${artist} ${album}`, 'album');
}

export async function resolveArtwork(
  admin: SupabaseClient,
  kind: 'artist' | 'album',
  artist: string,
  album: string | null,
): Promise<string | null> {
  const a = artist.toLowerCase();
  const al = (album ?? '').toLowerCase();
  const { data: row } = await admin
    .from('artwork')
    .select('image_url,fetched_at')
    .eq('kind', kind)
    .eq('artist', a)
    .eq('album', al)
    .maybeSingle();
  if (row && (row.image_url || Date.now() - new Date(row.fetched_at).getTime() < MISS_TTL)) {
    return row.image_url;
  }
  const image = kind === 'album' ? await fetchAlbumImage(a, al) : await fetchArtistImage(a);
  await admin.from('artwork').upsert(
    { kind, artist: a, album: al, image_url: image, fetched_at: new Date().toISOString() },
    { onConflict: 'kind,artist,album' },
  );
  return image;
}

/** Фоновое подтягивание обложек для свежих скробблов — не блокирует ответ. */
export function warmArtwork(admin: SupabaseClient, items: { artist?: unknown; album?: unknown }[]): void {
  const want = new Map<string, { kind: 'artist' | 'album'; artist: string; album: string }>();
  for (const item of items) {
    if (typeof item.artist !== 'string' || !item.artist) continue;
    const a = item.artist.toLowerCase();
    want.set(`artist|${a}|`, { kind: 'artist', artist: a, album: '' });
    if (typeof item.album === 'string' && item.album) {
      const al = item.album.toLowerCase();
      want.set(`album|${a}|${al}`, { kind: 'album', artist: a, album: al });
    }
  }
  if (!want.size) return;

  const job = (async () => {
    const { data: have } = await admin.from('artwork').select('kind,artist,album');
    const haveSet = new Set((have ?? []).map((r) => `${r.kind}|${r.artist}|${r.album}`));
    for (const key of [...want.values()].slice(0, 20)) {
      if (!haveSet.has(`${key.kind}|${key.artist}|${key.album}`)) {
        await resolveArtwork(admin, key.kind, key.artist, key.album).catch(() => {});
      }
    }
  })();

  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(job);
  else job.catch(() => {});
}
