import {
  getStats, recentScrobbles, topItems, dailyCounts, nowPlaying, lovedTracks,
} from '../api.js';
import { el, avatar, empty, spinner, errorBox, scrobbleRow, nowPlayingCard,
  topArtistList, topAlbumGrid, topTrackList, lovedTrackList, heatmap } from '../ui.js';
import { href } from '../router.js';
import { num, plays, shortDate } from '../format.js';

const RANGES = [
  ['7day', 'Неделя'],
  ['1month', 'Месяц'],
  ['12month', 'Год'],
  ['overall', 'Всё время'],
];

const DIMS = [
  ['artist', 'Артисты', 'artists'],
  ['album', 'Альбомы', 'albums'],
  ['track', 'Треки', 'tracks'],
];

const DIM_LIMIT = { artist: 50, album: 24, track: 50 };

export async function renderDashboard(profile, { owner = false } = {}) {
  const root = el('div', { class: 'dash' });
  let range = 'overall';
  let dim = 'artist';

  const [stats, daily, recent, loved, firstTop] = await Promise.all([
    getStats(profile.username),
    dailyCounts(profile.username, 365),
    recentScrobbles(profile.id, { limit: 15 }),
    lovedTracks(profile.id, 10),
    topItems(profile.username, dim, range, DIM_LIMIT[dim]),
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

  // ---- сейчас играет + последние скробблы ----
  const liveSlot = el('div', { class: 'live-slot' });
  const recentSection = el('section', { class: 'dash-recent' },
    el('div', { class: 'section-line' },
      el('p', { class: 'label', text: 'Последние прослушивания' }),
      el('a', { class: 'link-more', href: href('u', profile.username), text: 'Профиль' }),
    ),
    recent.length
      ? el('ol', { class: 'rows' }, ...recent.map((row) => scrobbleRow(row, profile.username)))
      : empty('Скробблов ещё нет.'),
  );
  const liveGrid = el('section', { class: 'dash-live' }, liveSlot, recentSection);
  root.append(liveGrid);
  refreshLive(profile.id, profile.username, liveSlot, liveGrid);

  // ---- любимые треки ----
  if (loved.length) {
    root.append(el('section', { class: 'dash-loved' },
      el('div', { class: 'section-line' },
        el('p', { class: 'label', text: `Любимые треки · ${num(stats?.loved ?? loved.length)}` }),
        el('a', { class: 'link-more', href: href('u', profile.username, 'loved'), text: 'Все' }),
      ),
      lovedTrackList(loved, profile.username),
    ));
  }

  // ---- статы + активность ----
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

  // ---- топы: вкладки по типу + период ----
  const dimBar = el('div', { class: 'range' });
  const rangeBar = el('div', { class: 'range' });
  const moreLink = el('a', { class: 'link-more', text: 'полный список' });
  const controls = el('div', { class: 'tops-controls' }, dimBar, el('div', { class: 'tops-side' }, rangeBar, moreLink));
  const topsSlot = el('section', { class: 'dash-toplist' });

  function dimLink() {
    const tab = DIMS.find(([key]) => key === dim)?.[2] ?? 'artists';
    moreLink.setAttribute('href', href('u', profile.username, tab));
  }

  function paintDims() {
    dimBar.replaceChildren(...DIMS.map(([key, label]) => el('button', {
      class: `range-btn${key === dim ? ' active' : ''}`,
      type: 'button',
      text: label,
      onclick: () => {
        if (dim === key) return;
        dim = key;
        paintDims();
        dimLink();
        loadTops();
      },
    })));
  }

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

  function paintTop(rows) {
    if (dim === 'album') topsSlot.replaceChildren(topAlbumGrid(rows, profile.username));
    else if (dim === 'track') topsSlot.replaceChildren(topTrackList(rows, profile.username));
    else topsSlot.replaceChildren(topArtistList(rows, profile.username));
  }

  async function loadTops() {
    topsSlot.replaceChildren(spinner());
    try {
      paintTop(await topItems(profile.username, dim, range, DIM_LIMIT[dim]));
    } catch (error) {
      topsSlot.replaceChildren(errorBox(error.message));
    }
  }

  paintDims();
  paintRanges();
  dimLink();
  paintTop(firstTop);
  root.append(controls, topsSlot);

  return root;
}

function pair(value, label) {
  return el('div', { class: 'pair' },
    el('strong', { text: num(value) }),
    el('span', { text: label }),
  );
}

async function refreshLive(profileId, username, slot, grid) {
  try {
    const live = await nowPlaying(profileId);
    if (slot.isConnected && live) {
      slot.replaceChildren(nowPlayingCard(live, username));
      grid.classList.add('has-live');
    }
  } catch {
    // не критично
  }
}
