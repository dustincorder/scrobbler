import {
  getStats, recentScrobbles, topItems, dailyCounts, nowPlaying,
} from '../api.js';
import { el, avatar, cover, empty, spinner, errorBox, scrobbleRow, nowPlayingCard, heatmap } from '../ui.js';
import { href } from '../router.js';
import { num, plays, shortDate } from '../format.js';

const RANGES = [
  ['7day', 'Неделя'],
  ['1month', 'Месяц'],
  ['12month', 'Год'],
  ['overall', 'Всё время'],
];

const TOP_LIMIT = 8;
const TRACK_LIMIT = 10;

export async function renderDashboard(profile, { owner = false } = {}) {
  const root = el('div', { class: 'dash' });
  let range = 'overall';

  const [stats, daily, recent, artists, albums, tracks] = await Promise.all([
    getStats(profile.username),
    dailyCounts(profile.username, 365),
    recentScrobbles(profile.id, { limit: 12 }),
    topItems(profile.username, 'artist', range, TOP_LIMIT),
    topItems(profile.username, 'album', range, TOP_LIMIT),
    topItems(profile.username, 'track', range, TRACK_LIMIT),
  ]);

  const total = Number(stats?.scrobbles ?? 0);
  const activeDays = daily.filter((d) => Number(d.plays) > 0).length;

  root.append(el('header', { class: 'dash-head' },
    avatar(profile),
    el('div', {},
      el('h1', { class: 'dash-name', text: profile.display_name || profile.username }),
      el('p', { class: 'dash-meta', text: `@${profile.username} · с ${shortDate(profile.created_at)}` }),
    ),
  ));

  const liveSlot = el('div', { class: 'live-slot' });
  root.append(liveSlot);
  refreshLive(profile.id, profile.username, liveSlot);

  root.append(el('section', { class: 'dash-top' },
    el('div', {},
      el('p', { class: 'label', text: 'Всё время' }),
      el('div', { class: 'pairs' },
        pair(total, 'прослушиваний'),
        pair(stats?.artists ?? 0, 'артистов'),
        pair(stats?.albums ?? 0, 'альбомов'),
        pair(stats?.tracks ?? 0, 'треков'),
        pair(stats?.loved ?? 0, 'любимых'),
        pair(activeDays, 'дней с музыкой'),
      ),
    ),
    el('div', { class: 'dash-activity' },
      el('p', { class: 'label', text: 'Активность за год' }),
      heatmap(daily),
    ),
  ));

  if (!total && owner) {
    root.append(el('section', { class: 'panel welcome' },
      el('h2', { text: 'Пока пусто' }),
      el('p', { class: 'muted', text: 'Подключи клиент или импортируй историю из Last.fm — статистика появится здесь.' }),
      el('div', { class: 'button-row' },
        el('a', { class: 'button small', href: href('import'), text: 'Импорт Last.fm' }),
        el('a', { class: 'button secondary small', href: href('settings'), text: 'Подключить клиент' }),
      ),
    ));
  }

  const rangeBar = el('div', { class: 'range' });
  const topsSlot = el('section', { class: 'dash-tops' });

  function paintRanges() {
    rangeBar.replaceChildren(...RANGES.map(([key, label]) => el('button', {
      class: `range-btn${key === range ? ' active' : ''}`,
      type: 'button',
      text: label,
      onclick: () => {
        if (range === key) return;
        range = key;
        paintRanges();
        loadTops();
      },
    })));
  }

  function paintTops(artistRows, albumRows, trackRows) {
    topsSlot.replaceChildren(
      topColumn('Топ артистов', artistRows, profile.username, 'artist'),
      topColumn('Топ альбомов', albumRows, profile.username, 'album'),
      trackColumn(trackRows, profile.username),
    );
  }

  async function loadTops() {
    topsSlot.replaceChildren(spinner());
    try {
      const [nextArtists, nextAlbums, nextTracks] = await Promise.all([
        topItems(profile.username, 'artist', range, TOP_LIMIT),
        topItems(profile.username, 'album', range, TOP_LIMIT),
        topItems(profile.username, 'track', range, TRACK_LIMIT),
      ]);
      paintTops(nextArtists, nextAlbums, nextTracks);
    } catch (error) {
      topsSlot.replaceChildren(errorBox(error.message));
    }
  }

  paintRanges();
  paintTops(artists, albums, tracks);
  root.append(rangeBar, topsSlot);

  root.append(el('section', { class: 'dash-recent' },
    el('div', { class: 'section-line' },
      el('p', { class: 'label', text: 'Последние прослушивания' }),
      el('a', { class: 'link-more', href: href('u', profile.username, 'tracks'), text: 'Все' }),
    ),
    recent.length
      ? el('ol', { class: 'rows' }, ...recent.map((row) => scrobbleRow(row, profile.username)))
      : empty('Скробблов ещё нет.'),
  ));

  return root;
}

function pair(value, label) {
  return el('div', { class: 'pair' },
    el('strong', { text: num(value) }),
    el('span', { text: label }),
  );
}

function itemHref(kind, username, row) {
  return kind === 'artist'
    ? href('u', username, 'artist', row.artist)
    : href('u', username, 'album', row.artist, row.title);
}

function topColumn(title, rows, username, kind) {
  const col = el('div', { class: 'top-col' }, el('p', { class: 'label', text: title }));
  if (!rows.length) {
    col.append(empty('Пока пусто.'));
    return col;
  }

  const [first, ...rest] = rows;
  const featureCover = cover(first.artist, kind === 'album' ? first.title : null);
  featureCover.classList.add('feature-cover');
  col.append(el('a', { class: 'feature', href: itemHref(kind, username, first) },
    featureCover,
    el('div', { class: 'feature-body' },
      el('strong', { class: 'feature-title', text: kind === 'artist' ? first.artist : first.title }),
      kind === 'album' ? el('span', { class: 'feature-sub', text: first.artist }) : null,
      el('span', { class: 'feature-plays', text: plays(first.plays) }),
    ),
  ));

  if (rest.length) {
    col.append(el('ol', { class: 'mini-list' }, ...rest.map((row) => el('li', {},
      el('a', { class: 'mini', href: itemHref(kind, username, row) },
        cover(row.artist, kind === 'album' ? row.title : null),
        el('span', { class: 'mini-text' },
          el('strong', { text: kind === 'artist' ? row.artist : row.title }),
          kind === 'album' ? el('span', { class: 'muted small', text: row.artist }) : null,
        ),
        el('span', { class: 'mini-plays', text: plays(row.plays) }),
      ),
    ))));
  }
  return col;
}

function trackColumn(rows, username) {
  const col = el('div', { class: 'top-col' }, el('p', { class: 'label', text: 'Топ треков' }));
  if (!rows.length) {
    col.append(empty('Пока пусто.'));
    return col;
  }
  col.append(el('ol', { class: 'mini-list' }, ...rows.map((row, index) => el('li', {},
    el('a', { class: 'mini', href: href('u', username, 'track', row.artist, row.title) },
      el('span', { class: 'mini-num', text: String(index + 1).padStart(2, '0') }),
      cover(row.artist, row.album),
      el('span', { class: 'mini-text' },
        el('strong', { text: row.title }),
        el('span', { class: 'muted small', text: row.artist }),
      ),
      el('span', { class: 'mini-plays', text: plays(row.plays) }),
    ),
  ))));
  return col;
}

async function refreshLive(profileId, username, slot) {
  try {
    const live = await nowPlaying(profileId);
    if (slot.isConnected && live) slot.replaceChildren(nowPlayingCard(live, username));
  } catch {
    // не критично
  }
}
