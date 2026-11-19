// Хеш-роутер. GitHub Pages не умеет SPA-fallback, поэтому всё после #.

export function parseRoute(hash = location.hash) {
  const raw = String(hash || '').replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const query = new URLSearchParams(queryPart ?? '');
  const segments = pathPart.split('/').filter(Boolean).map(safeDecode);

  if (segments.length === 0) return { name: 'home', query };
  if (segments[0] === 'login') return { name: 'login', query, next: query.get('next') };
  if (segments[0] === 'join') return { name: 'join', query };
  if (segments[0] === 'settings') return { name: 'settings', query };
  if (segments[0] === 'import') return { name: 'import', query };
  if (segments[0] === 'connect') return { name: 'connect', query, token: query.get('token') ?? '' };

  if (segments[0] === 'u' && segments[1]) {
    const username = segments[1].toLowerCase();
    if (segments.length === 2) return { name: 'profile', username, tab: 'overview', query };
    const tab = segments[2];
    if (['artists', 'albums', 'tracks', 'loved', 'charts', 'library'].includes(tab)) {
      return { name: 'profile', username, tab, query };
    }
    if (tab === 'artist' && segments[3]) {
      return { name: 'artist', username, artist: segments.slice(3).join('/'), query };
    }
    if (tab === 'album' && segments[3] && segments[4]) {
      return { name: 'album', username, artist: segments[3], album: segments.slice(4).join('/'), query };
    }
    if (tab === 'track' && segments[3] && segments[4]) {
      return { name: 'track', username, artist: segments[3], track: segments.slice(4).join('/'), query };
    }
  }

  return { name: 'notfound', query };
}

export function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function href(...parts) {
  const clean = parts
    .filter((part) => part !== null && part !== undefined && part !== '')
    .map((part) => encodeURIComponent(String(part)));
  return `#/${clean.join('/')}`;
}

export function userHref(username, tab) {
  return tab && tab !== 'overview' ? href('u', username, tab) : href('u', username);
}

export function navigate(path, replace = false) {
  const target = path.startsWith('#') ? path : `#${path}`;
  if (replace) location.replace(target);
  else location.hash = target.slice(1);
}
