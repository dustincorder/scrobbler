// Общие утилиты Edge Function. Работает на Deno (Supabase Edge Runtime).

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function text(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  return null;
}

export function randomToken(bytes = 24): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function cleanText(value: unknown, max = 500): string | null {
  if (typeof value !== 'string') return null;
  const s = value.replace(/\u0000/g, '').trim();
  if (!s) return null;
  return s.slice(0, max);
}

export function toTimestamp(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    // секунды или миллисекунды
    const ms = value > 1e12 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) return toTimestamp(Number(trimmed));
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function iso(value: Date): string {
  return value.toISOString();
}

/** "19 Nov 2026, 20:45" — формат Last.fm для date.#text */
export function lastfmDate(date: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${dd} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${hh}:${mm}`;
}

export function normalizeUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const u = value.trim().toLowerCase();
  return /^[a-z0-9_]{3,32}$/.test(u) ? u : null;
}

export interface ScrobbleInput {
  artist: string;
  artist_mbid?: string | null;
  album?: string | null;
  album_mbid?: string | null;
  album_artist?: string | null;
  track: string;
  track_mbid?: string | null;
  duration?: number | null;
  played_at: string;
  source?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return UUID_RE.test(s) ? s : null;
}

export function normalizeScrobble(raw: Record<string, unknown>, source: string): ScrobbleInput | null {
  const artist = cleanText(raw.artist ?? raw.artist_name, 500);
  const track = cleanText(raw.track ?? raw.title ?? raw.name, 500);
  const played = toTimestamp(raw.played_at ?? raw.timestamp ?? raw.time ?? raw.date);
  if (!artist || !track || !played) return null;

  // не принимаем скробблы из будущего и из 1970-го
  const now = Date.now();
  if (played.getTime() > now + 10 * 60 * 1000) return null;
  if (played.getTime() < Date.UTC(2002, 0, 1)) return null;

  const duration = Number(raw.duration);
  return {
    artist,
    artist_mbid: uuidOrNull(raw.artist_mbid),
    album: cleanText(raw.album ?? raw.album_name, 500),
    album_mbid: uuidOrNull(raw.album_mbid),
    album_artist: cleanText(raw.album_artist, 500),
    track,
    track_mbid: uuidOrNull(raw.track_mbid ?? raw.recording_mbid),
    duration: Number.isFinite(duration) && duration >= 0 && duration <= 86400 ? Math.round(duration) : null,
    played_at: played.toISOString(),
    source,
  };
}
