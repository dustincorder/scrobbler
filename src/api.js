import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';

export const configured = Boolean(SUPABASE_URL && SUPABASE_KEY);

export const supabase = createClient(SUPABASE_URL || 'https://invalid.supabase.co', SUPABASE_KEY || 'invalid', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

export async function functionCall(path, { method = 'GET', body, token } = {}) {
  const { data } = await supabase.auth.getSession();
  const jwt = token ?? data?.session?.access_token;
  const response = await fetch(`${FUNCTIONS_URL}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { error: text };
  }
  if (!response.ok) {
    throw new Error(payload?.error ?? `HTTP ${response.status}`);
  }
  return payload;
}

// ---------- чтение публичных данных ----------

export async function getProfile(username) {
  const { data, error } = await supabase.rpc('get_profile', { p_username: username });
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

// Личный экземпляр: публичный профиль владельца — первый в базе.
export async function ownerProfile() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('is_public', true)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

export async function getStats(username) {
  const { data, error } = await supabase.rpc('profile_stats', { p_username: username });
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function recentScrobbles(userId, { limit = 50, before = null } = {}) {
  let query = supabase
    .from('scrobbles')
    .select('*')
    .eq('user_id', userId)
    .order('played_at', { ascending: false })
    .limit(limit);
  if (before) query = query.lt('played_at', before);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function topItems(username, dimension, period = 'overall', limit = 50) {
  const days = { '7day': 7, '1month': 30, '3month': 91, '6month': 182, '12month': 365 }[period];
  const since = days ? new Date(Date.now() - days * 86400_000).toISOString() : null;
  const { data, error } = await supabase.rpc('top_items', {
    p_username: username,
    p_dimension: dimension,
    p_since: since,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function dailyCounts(username, days = 365) {
  const { data, error } = await supabase.rpc('daily_counts', { p_username: username, p_days: days });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function lovedTracks(userId, limit = 200) {
  const { data, error } = await supabase
    .from('track_loves')
    .select('*')
    .eq('user_id', userId)
    .order('loved_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function nowPlaying(userId) {
  const { data } = await supabase
    .from('now_playing')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return null;
  const age = Date.now() - new Date(data.updated_at).getTime();
  return age < 30 * 60_000 ? data : null;
}

export async function artistPage(username, artist) {
  const { data, error } = await supabase.rpc('artist_page', { p_username: username, p_artist: artist });
  if (error) throw new Error(error.message);
  return data;
}

export async function albumPage(username, artist, album) {
  const { data, error } = await supabase.rpc('album_page', {
    p_username: username, p_artist: artist, p_album: album,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function trackPage(username, artist, track) {
  const { data, error } = await supabase.rpc('track_page', {
    p_username: username, p_artist: artist, p_track: track,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function trackHistory(username, artist, track, limit = 100) {
  const { data, error } = await supabase.rpc('track_history', {
    p_username: username, p_artist: artist, p_track: track, p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ---------- обложки ----------

const ART_KEY = 'scrobble:art:v1';
let artCache = {};
try {
  artCache = JSON.parse(localStorage.getItem(ART_KEY) ?? '{}') || {};
} catch {
  artCache = {};
}

let saveTimer = null;
function saveArtCache() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const entries = Object.entries(artCache).slice(-600);
      localStorage.setItem(ART_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {
      // переполнение localStorage не критично
    }
  }, 800);
}

const pending = new Map();
let active = 0;
const queue = [];

function pump() {
  while (active < 4 && queue.length) {
    const job = queue.shift();
    active++;
    job().finally(() => {
      active--;
      pump();
    });
  }
}

export function artwork(artist, album) {
  if (!artist) return Promise.resolve(null);
  const key = `${artist}|${album ?? ''}`.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(artCache, key)) return Promise.resolve(artCache[key]);
  if (pending.has(key)) return pending.get(key);

  const promise = new Promise((resolve) => {
    queue.push(async () => {
      let url = null;
      try {
        const params = new URLSearchParams({ artist });
        if (album) params.set('album', album);
        const response = await fetch(`${FUNCTIONS_URL}/api/artwork?${params}`);
        if (response.ok) url = (await response.json())?.image ?? null;
      } catch {
        url = null;
      }
      artCache[key] = url;
      saveArtCache();
      pending.delete(key);
      resolve(url);
    });
    pump();
  });
  pending.set(key, promise);
  return promise;
}

// ---------- авторизация ----------

export const EMAIL_DOMAIN = 'users.scrobble.invalid';

// Registration is closed by default. Supabase auth has it disabled as well; this
// flag only controls whether the UI offers the "join" flow at all.
export const signupsOpen = import.meta.env.VITE_SIGNUPS_OPEN === 'true';

export function emailFor(username) {
  return `${username}@${EMAIL_DOMAIN}`;
}

export async function signIn(username, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: emailFor(username),
    password,
  });
  if (error) throw new Error(translateAuthError(error.message));
  return data;
}

export async function signUp(username, password) {
  const { data, error } = await supabase.auth.signUp({
    email: emailFor(username),
    password,
    options: { data: { username } },
  });
  if (error) throw new Error(translateAuthError(error.message));
  return data;
}

export async function signOut() {
  await supabase.auth.signOut({ scope: 'local' });
}

export function translateAuthError(message) {
  const m = String(message ?? '');
  if (/Invalid login credentials/i.test(m)) return 'Неверное имя или пароль.';
  if (/User already registered/i.test(m)) return 'Такое имя уже занято.';
  if (/Password should be at least/i.test(m)) return 'Пароль слишком короткий (минимум 6 символов).';
  if (/rate limit|too many/i.test(m)) return 'Слишком много попыток. Подожди немного.';
  if (/Email not confirmed/i.test(m)) return 'Подтверждение почты отключено не в том месте. Напиши администратору.';
  return m || 'Не получилось.';
}

export function validateUsername(value) {
  return /^[a-z0-9_]{3,32}$/.test(value);
}
