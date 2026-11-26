import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { normalizeScrobble, sha256, type ScrobbleInput } from './util.ts';
import { warmArtwork } from './artwork.ts';

export interface TokenRow {
  id: string;
  user_id: string;
  kind: 'session' | 'webhook' | 'listenbrainz';
}

export async function resolveToken(
  admin: SupabaseClient,
  token: string | null | undefined,
  kind?: TokenRow['kind'],
): Promise<TokenRow | null> {
  if (!token) return null;
  const hash = await sha256(token);
  const { data } = await admin
    .from('scrobble_tokens')
    .select('id,user_id,kind,revoked_at')
    .eq('token_hash', hash)
    .maybeSingle();
  if (!data || data.revoked_at) return null;
  if (kind && data.kind !== kind) return null;

  // не блокируем ответ ради отметки активности
  admin
    .from('scrobble_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(() => {}, () => {});

  return { id: data.id, user_id: data.user_id, kind: data.kind };
}

export async function createToken(
  admin: SupabaseClient,
  userId: string,
  kind: TokenRow['kind'],
  label: string | null,
  raw: string,
): Promise<{ id: string } | null> {
  const hash = await sha256(raw);
  const { data } = await admin
    .from('scrobble_tokens')
    .insert({ user_id: userId, kind, label, token_hash: hash })
    .select('id')
    .maybeSingle();
  return data;
}

export async function ingestScrobbles(
  admin: SupabaseClient,
  userId: string,
  rawItems: Record<string, unknown>[],
  source: string,
): Promise<{ accepted: number; ignored: number }> {
  const items: ScrobbleInput[] = [];
  for (const raw of rawItems) {
    const normalized = normalizeScrobble(raw, source);
    if (normalized) items.push(normalized);
  }
  if (items.length === 0) return { accepted: 0, ignored: rawItems.length };

  let accepted = 0;
  for (let i = 0; i < items.length; i += 500) {
    const chunk = items.slice(i, i + 500).map((item) => ({ ...item, user_id: userId }));
    const { error } = await admin
      .from('scrobbles')
      .upsert(chunk, { onConflict: 'user_id,artist,track,played_at', ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    accepted += chunk.length;
  }

  if (accepted > 0) warmArtwork(admin, items);

  return { accepted, ignored: Math.max(0, rawItems.length - items.length) };
}

export async function setNowPlaying(
  admin: SupabaseClient,
  userId: string,
  payload: { artist?: unknown; album?: unknown; track?: unknown; duration?: unknown },
): Promise<boolean> {
  const artist = typeof payload.artist === 'string' ? payload.artist.trim().slice(0, 500) : '';
  const track = typeof payload.track === 'string' ? payload.track.trim().slice(0, 500) : '';
  if (!artist || !track) return false;

  const album = typeof payload.album === 'string' ? payload.album.trim().slice(0, 500) : null;
  const duration = Number(payload.duration);

  const { error } = await admin.from('now_playing').upsert(
    {
      user_id: userId,
      artist,
      album: album || null,
      track,
      duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  return !error;
}

export async function clearNowPlaying(admin: SupabaseClient, userId: string): Promise<void> {
  await admin.from('now_playing').delete().eq('user_id', userId);
}
