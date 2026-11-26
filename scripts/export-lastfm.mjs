#!/usr/bin/env node
// Полная выгрузка истории Last.fm без бэкенда.
//
//   node scripts/export-lastfm.mjs --user yourname --key XXXX --out lastfm.json
//   node scripts/export-lastfm.mjs --user yourname --key XXXX --out lastfm.csv
//
// --key необязателен, если есть переменная окружения LASTFM_API_KEY.
// Ключ: https://www.last.fm/api/account/create (до 1 декабря 2026 бесплатно).

import { writeFile } from 'node:fs/promises';

const API = 'https://ws.audioscrobbler.com/2.0/';

function parseArgs(argv) {
  const out = { user: '', key: process.env.LASTFM_API_KEY ?? '', out: 'lastfm.json', page: 1, limit: 200 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--user') out.user = argv[++i];
    else if (arg === '--key') out.key = argv[++i];
    else if (arg === '--out') out.out = argv[++i];
    else if (arg === '--page') out.page = Number(argv[++i]);
    else if (arg === '--help' || arg === '-h') out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.user) {
  console.log('usage: node scripts/export-lastfm.mjs --user <lastfm> --key <api_key> --out <file.json|csv>');
  process.exit(args.help ? 0 : 1);
}
if (!args.key) {
  console.error('Нет API key. Передай --key или LASTFM_API_KEY.');
  process.exit(1);
}

async function call(params) {
  const url = new URL(API);
  for (const [k, v] of Object.entries({ ...params, api_key: args.key, format: 'json' })) {
    url.searchParams.set(k, String(v));
  }
  const response = await fetch(url, { headers: { 'User-Agent': 'scrobble-export/1.0' } });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(`HTTP ${response.status}`);
  if (data.error) throw new Error(`Last.fm: ${data.message ?? data.error} (${data.error})`);
  return data;
}

async function paged(method, key, map) {
  let page = 1;
  let totalPages = 1;
  const items = [];
  do {
    const data = await call({ method, user: args.user, limit: args.limit, page });
    const block = data[key] ?? {};
    totalPages = Number(block['@attr']?.totalPages ?? 1);
    const batch = (block.track ?? []).map(map).filter(Boolean);
    items.push(...batch);
    process.stdout.write(`\r${method}: ${page}/${totalPages}, ${items.length} строк`);
    page += 1;
  } while (page <= totalPages);
  process.stdout.write('\n');
  return items;
}

const info = (await call({ method: 'user.getInfo', user: args.user })).user;

const scrobbles = await paged('user.getRecentTracks', 'recenttracks', (track) => {
  if (track['@attr']?.nowplaying || !track.date?.uts) return null;
  return {
    artist: track.artist?.['#text'] ?? track.artist?.name ?? '',
    artist_mbid: track.artist?.mbid || null,
    album: track.album?.['#text'] || null,
    album_mbid: track.album?.mbid || null,
    track: track.name,
    track_mbid: track.mbid || null,
    duration: Number(track.duration) || null,
    played_at: Number(track.date.uts),
  };
});

const loved = await paged('user.getLovedTracks', 'lovedtracks', (track) => ({
  artist: track.artist?.name ?? track.artist?.['#text'] ?? '',
  track: track.name,
  loved_at: Number(track.date?.uts ?? 0),
}));

if (args.out.endsWith('.csv')) {
  const header = 'uts,artist,album,track,duration,artist_mbid,album_mbid\n';
  const body = scrobbles.map((s) => [
    s.played_at,
    csvCell(s.artist),
    csvCell(s.album ?? ''),
    csvCell(s.track),
    s.duration ?? '',
    s.artist_mbid ?? '',
    s.album_mbid ?? '',
  ].join(',')).join('\n');
  await writeFile(args.out, header + body + '\n', 'utf8');
} else {
  await writeFile(args.out, JSON.stringify({
    profile: {
      username: info.name,
      realname: info.realname ?? null,
      country: info.country ?? null,
      playcount: Number(info.playcount ?? 0),
      registered: Number(info.registered?.unixts ?? info.registered?.['#text'] ?? 0),
      image: info.image?.find((i) => i.size === 'extralarge')?.['#text'] ?? null,
    },
    exported_at: new Date().toISOString(),
    scrobbles,
    loved,
  }, null, 2), 'utf8');
}

console.log(`Готово: ${scrobbles.length} скробблов, ${loved.length} любимых → ${args.out}`);

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
