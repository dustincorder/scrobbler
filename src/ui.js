import { artwork } from './api.js';
import { initials, num, plays, shortDate, timeAgo, fullDate } from './format.js';
import { href } from './router.js';

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function cover(artist, album, { big = false } = {}) {
  const node = el('div', { class: `cover${big ? ' cover-big' : ''}` });
  const label = el('span', { class: 'cover-initials', text: initials(album || artist) });
  node.append(label);
  artwork(artist, album).then((url) => {
    if (!url) return;
    const img = el('img', { src: url, alt: '', loading: 'lazy', decoding: 'async' });
    img.addEventListener('load', () => node.classList.add('has-art'));
    node.append(img);
  });
  return node;
}

export function avatar(profile, { big = false } = {}) {
  const node = el('div', { class: `avatar${big ? ' avatar-big' : ''}` });
  node.append(el('span', { class: 'avatar-initials', text: initials(profile?.display_name || profile?.username) }));
  if (profile?.avatar_url) {
    const img = el('img', { src: profile.avatar_url, alt: '', loading: 'lazy' });
    node.append(img);
  }
  return node;
}

export function empty(message) {
  return el('div', { class: 'empty', text: message });
}

export function spinner(label = 'Загружаю…') {
  return el('div', { class: 'loading' }, el('span', { class: 'spinner' }), el('span', { text: label }));
}

export function errorBox(message) {
  return el('div', { class: 'error-box', text: message });
}

export function sectionHead(title, actions = null) {
  return el('div', { class: 'section-head' }, el('h2', { text: title }), actions);
}

export function tabs(username, active) {
  const items = [
    ['overview', 'Обзор'],
    ['artists', 'Артисты'],
    ['albums', 'Альбомы'],
    ['tracks', 'Треки'],
    ['charts', 'График'],
    ['loved', 'Любимое'],
  ];
  const nav = el('nav', { class: 'tabs' });
  for (const [key, label] of items) {
    const link = el('a', {
      class: `tab${active === key ? ' active' : ''}`,
      href: key === 'overview' ? href('u', username) : href('u', username, key),
      text: label,
    });
    nav.append(link);
  }
  return nav;
}

export function scrobbleRow(scrobble, username, { showDate = true, showArt = true } = {}) {
  const row = el('li', { class: 'row scrobble' });
  if (showArt) row.append(cover(scrobble.artist, scrobble.album));

  const main = el('div', { class: 'row-main' });
  main.append(el('a', {
    class: 'row-title',
    href: href('u', username, 'track', scrobble.artist, scrobble.track),
    text: scrobble.track,
  }));
  const sub = el('div', { class: 'row-sub' });
  sub.append(el('a', {
    href: href('u', username, 'artist', scrobble.artist),
    text: scrobble.artist,
  }));
  if (scrobble.album) {
    sub.append(el('span', { class: 'dot', text: '·' }));
    sub.append(el('a', {
      class: 'muted',
      href: href('u', username, 'album', scrobble.album_artist || scrobble.artist, scrobble.album),
      text: scrobble.album,
    }));
  }
  main.append(sub);
  row.append(main);

  if (showDate) {
    row.append(el('time', {
      class: 'row-time',
      datetime: scrobble.played_at,
      title: fullDate(scrobble.played_at),
      text: timeAgo(scrobble.played_at),
    }));
  }
  return row;
}

export function nowPlayingCard(item, username) {
  return el('div', { class: 'now-playing' },
    el('span', { class: 'pulse', title: 'Сейчас играет' }),
    cover(item.artist, item.album),
    el('div', { class: 'row-main' },
      el('a', {
        class: 'row-title',
        href: href('u', username, 'track', item.artist, item.track),
        text: item.track,
      }),
      el('div', { class: 'row-sub' },
        el('a', { href: href('u', username, 'artist', item.artist), text: item.artist }),
      ),
    ),
    el('span', { class: 'live-label', text: 'сейчас играет' }),
  );
}

export function topArtistList(rows, username, { bars = true } = {}) {
  if (!rows.length) return empty('Пока пусто.');
  const max = Math.max(...rows.map((r) => Number(r.plays) || 0), 1);
  const list = el('ol', { class: 'rank-list' });
  rows.forEach((row, index) => {
    const li = el('li', { class: 'rank' });
    li.append(el('span', { class: 'rank-num', text: String(index + 1) }));
    const art = cover(row.artist, null);
    li.append(art);
    const body = el('div', { class: 'rank-body' });
    body.append(el('a', {
      class: 'rank-title',
      href: href('u', username, 'artist', row.artist),
      text: row.artist,
    }));
    if (bars) {
      body.append(el('div', { class: 'bar' }, el('span', {
        style: `width:${Math.max(3, (Number(row.plays) / max) * 100)}%`,
      })));
    }
    body.append(el('span', { class: 'rank-count', text: plays(row.plays) }));
    li.append(body);
    list.append(li);
  });
  return list;
}

export function topAlbumGrid(rows, username) {
  if (!rows.length) return empty('Пока пусто.');
  const grid = el('div', { class: 'album-grid' });
  rows.forEach((row) => {
    const card = el('a', {
      class: 'album-card',
      href: href('u', username, 'album', row.artist, row.title),
    });
    card.append(cover(row.artist, row.title));
    card.append(el('span', { class: 'album-name', text: row.title }));
    card.append(el('span', { class: 'album-artist', text: row.artist }));
    card.append(el('span', { class: 'album-count', text: plays(row.plays) }));
    grid.append(card);
  });
  return grid;
}

export function topTrackList(rows, username) {
  if (!rows.length) return empty('Пока пусто.');
  const list = el('ol', { class: 'rank-list tracks' });
  rows.forEach((row, index) => {
    const li = el('li', { class: 'rank' });
    li.append(el('span', { class: 'rank-num', text: String(index + 1) }));
    li.append(cover(row.artist, row.album));
    const body = el('div', { class: 'rank-body' });
    body.append(el('a', {
      class: 'rank-title',
      href: href('u', username, 'track', row.artist, row.title),
      text: row.title,
    }));
    body.append(el('a', {
      class: 'rank-sub muted',
      href: href('u', username, 'artist', row.artist),
      text: row.artist,
    }));
    li.append(body);
    li.append(el('span', { class: 'rank-count', text: plays(row.plays) }));
    list.append(li);
  });
  return list;
}

export function lovedTrackList(items, username) {
  const rows = el('ol', { class: 'rows' });
  for (const item of items) {
    const li = el('li', { class: 'row scrobble' });
    li.append(cover(item.artist, null));
    const main = el('div', { class: 'row-main' });
    main.append(el('a', {
      class: 'row-title',
      href: href('u', username, 'track', item.artist, item.track),
      text: item.track,
    }));
    const sub = el('div', { class: 'row-sub' });
    sub.append(el('a', { href: href('u', username, 'artist', item.artist), text: item.artist }));
    main.append(sub);
    li.append(main, el('span', { class: 'heart', text: '♥', title: fullDate(item.loved_at) }));
    rows.append(li);
  }
  return rows;
}

export function heatmap(days) {
  const wrap = el('div', { class: 'heatmap-wrap' });
  const map = new Map(days.map((d) => [String(d.day), Number(d.plays)]));
  const max = Math.max(1, ...map.values());

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  // выравниваем начало на понедельник
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 364);
  const offset = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - offset);

  const grid = el('div', { class: 'heatmap' });
  const dayLabels = el('div', { class: 'heat-days' },
    ...['пн', '', 'ср', '', 'пт', '', 'вс'].map((label) => el('span', { text: label })));

  for (let i = 0; i < 53 * 7; i++) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + i);
    if (date > today) break;
    const key = date.toISOString().slice(0, 10);
    const count = map.get(key) ?? 0;
    const level = count === 0 ? 0 : Math.min(4, Math.ceil((count / max) * 4));
    const cell = el('span', {
      class: `heat-cell l${level}`,
      title: `${shortDate(date)} — ${count ? plays(count) : 'тишина'}`,
    });
    grid.append(cell);
  }

  wrap.append(el('div', { class: 'heatmap-inner' }, dayLabels, grid), el('div', { class: 'heatmap-legend' },
    el('span', { text: 'меньше' }),
    ...['l0', 'l1', 'l2', 'l3', 'l4'].map((c) => el('span', { class: `heat-cell ${c}` })),
    el('span', { text: 'больше' }),
  ));
  return wrap;
}

export function statBlock(label, value) {
  return el('div', { class: 'stat' },
    el('strong', { text: num(value) }),
    el('span', { text: label }),
  );
}

export function periodPicker(active, onChange) {
  const periods = [
    ['overall', 'всё время'],
    ['7day', 'неделя'],
    ['1month', 'месяц'],
    ['3month', '3 месяца'],
    ['12month', 'год'],
  ];
  const wrap = el('div', { class: 'periods' });
  for (const [key, label] of periods) {
    wrap.append(el('button', {
      class: `period${key === active ? ' active' : ''}`,
      type: 'button',
      text: label,
      onclick: () => onChange(key),
    }));
  }
  return wrap;
}

export function barChart(days) {
  const max = Math.max(1, ...days.map((d) => Number(d.plays) || 0));
  const wrap = el('div', { class: 'barchart' });
  const recent = days.slice(-120);
  for (const day of recent) {
    const height = Math.max(2, (Number(day.plays) / max) * 100);
    wrap.append(el('span', {
      class: 'barchart-bar',
      style: `height:${height}%`,
      title: `${shortDate(day.day)} — ${plays(day.plays)}`,
    }));
  }
  if (!recent.length) wrap.append(empty('Нет данных за период.'));
  return wrap;
}
