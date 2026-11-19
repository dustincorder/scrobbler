// Разбор CSV-экспорта Last.fm (и похожих таблиц) без зависимостей.

export function detectDelimiter(line) {
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = -1;
  for (const candidate of candidates) {
    const count = line.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

export function parseCsv(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    if (row.some((value) => value.trim() !== '')) rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"' && field.trim() === '') {
      field = '';
      quoted = true;
      i += 1;
      continue;
    }
    if (delimiter && char === delimiter) {
      pushField();
      i += 1;
      continue;
    }
    if (char === '\n') {
      pushRow();
      i += 1;
      continue;
    }
    if (char === '\r') {
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  if (field !== '' || row.length) pushRow();
  return rows;
}

const HEADER_ALIASES = {
  artist: ['artist', 'artist_name', 'artistname', 'артист', 'исполнитель'],
  album: ['album', 'album_name', 'release', 'альбом'],
  albumArtist: ['album_artist', 'albumartist', 'album artist'],
  track: ['track', 'track_name', 'title', 'name', 'song', 'трек', 'название'],
  timestamp: ['uts', 'timestamp', 'unixtime', 'unix_timestamp', 'played_at', 'date', 'time', 'utc_time', 'дата'],
  duration: ['duration', 'duration_ms', 'length', 'длительность'],
};

function findHeader(headers) {
  const map = {};
  const normalized = headers.map((h) => h.trim().toLowerCase().replace(/^\ufeff/, ''));
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const index = normalized.findIndex((h) => aliases.includes(h));
    if (index >= 0) map[key] = index;
  }
  return map;
}

function parseTimestamp(value) {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return n > 1e12 ? Math.floor(n / 1000) : n;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  // Last.fm отдаёт время в UTC
  return Math.floor(date.getTime() / 1000);
}

/**
 * Возвращает массив {artist, album, track, played_at (unix seconds), duration}
 */
export function parseScrobblesCsv(text) {
  if (!text || typeof text !== 'string') return [];
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = detectDelimiter(firstLine);
  const rows = parseCsv(text, delimiter);
  if (rows.length < 2) return [];

  const map = findHeader(rows[0]);
  if (map.artist === undefined || map.track === undefined || map.timestamp === undefined) {
    throw new Error('В CSV нет колонок artist / track / timestamp (uts).');
  }

  const out = [];
  for (const row of rows.slice(1)) {
    const artist = (row[map.artist] ?? '').trim();
    const track = (row[map.track] ?? '').trim();
    const ts = parseTimestamp(row[map.timestamp]);
    if (!artist || !track || !ts) continue;

    const album = map.album !== undefined ? (row[map.album] ?? '').trim() : '';
    const albumArtist = map.albumArtist !== undefined ? (row[map.albumArtist] ?? '').trim() : '';
    let duration = map.duration !== undefined ? Number(row[map.duration]) : 0;
    if (Number.isFinite(duration) && duration > 86400) duration = Math.round(duration / 1000);

    out.push({
      artist,
      album: album || null,
      album_artist: albumArtist || null,
      track,
      played_at: ts,
      duration: Number.isFinite(duration) && duration > 0 ? duration : null,
    });
  }
  return out;
}
