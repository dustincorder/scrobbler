import { artistPage, albumPage, trackPage, supabase } from '../api.js';
import { el, cover, empty, sectionHead, scrobbleRow } from '../ui.js';
import { href } from '../router.js';
import { num, plays, shortDate, fullDate, timeAgo } from '../format.js';

function crumbs(route, items) {
  const nav = el('nav', { class: 'crumbs' });
  nav.append(el('a', { href: href('u', route.username), text: route.username }));
  for (const item of items) {
    nav.append(el('span', { class: 'crumb-sep', text: '/' }));
    nav.append(item.href
      ? el('a', { href: item.href, text: item.text })
      : el('span', { text: item.text }));
  }
  return nav;
}

function statLine(...parts) {
  const line = el('div', { class: 'detail-stats' });
  parts.filter(Boolean).forEach((part, index) => {
    if (index) line.append(el('span', { class: 'dot', text: '·' }));
    line.append(part);
  });
  return line;
}

export async function renderArtist(route, app) {
  const data = await artistPage(route.username, route.artist);
  if (!data || !Number(data.plays)) {
    return el('div', {}, crumbs(route, [{ text: route.artist }]),
      el('div', { class: 'error-box', text: 'У этого слушателя нет такого артиста.' }));
  }

  const wrap = el('div', { class: 'detail' });
  wrap.append(crumbs(route, [{ text: route.artist }]));

  const head = el('section', { class: 'detail-head' });
  head.append(cover(route.artist, null, { big: true }));
  const info = el('div', { class: 'profile-info' });
  info.append(el('p', { class: 'eyebrow', text: 'артист' }));
  info.append(el('h1', { text: route.artist }));
  info.append(statLine(
    el('strong', { text: plays(data.plays) }),
    el('span', { class: 'muted', text: `впервые ${shortDate(data.first_play)}` }),
    el('span', { class: 'muted', text: `последний раз ${timeAgo(data.last_play)}` }),
  ));
  head.append(info);
  wrap.append(head);

  const grid = el('div', { class: 'detail-grid' });
  const panel = el('section', { class: 'panel' },
    sectionHead('Топ треков'),
    el('ol', { class: 'rank-list tracks' }, ...data.tracks.map((row, index) => {
      const li = el('li', { class: 'rank' });
      li.append(el('span', { class: 'rank-num', text: String(index + 1) }));
      li.append(cover(route.artist, row.album));
      const body = el('div', { class: 'rank-body' });
      body.append(el('a', {
        class: 'rank-title',
        href: href('u', route.username, 'track', route.artist, row.title),
        text: row.title,
      }));
      if (row.album) {
        body.append(el('a', {
          class: 'rank-sub muted',
          href: href('u', route.username, 'album', route.artist, row.album),
          text: row.album,
        }));
      }
      li.append(body);
      li.append(el('span', { class: 'rank-count', text: plays(row.plays) }));
      return li;
    })),
  );

  const albums = el('section', { class: 'panel' },
    sectionHead('Альбомы'),
    data.albums.length ? el('div', { class: 'album-grid compact' }, ...data.albums.map((album) => {
      const card = el('a', {
        class: 'album-card',
        href: href('u', route.username, 'album', route.artist, album.title),
      });
      card.append(cover(route.artist, album.title));
      card.append(el('span', { class: 'album-name', text: album.title }));
      card.append(el('span', { class: 'album-count', text: plays(album.plays) }));
      return card;
    })) : empty('Альбомов нет.'),
  );

  grid.append(panel, albums);
  wrap.append(grid);
  return wrap;
}

export async function renderAlbum(route, app) {
  const data = await albumPage(route.username, route.artist, route.album);
  if (!data || !Number(data.plays)) {
    return el('div', {}, crumbs(route, [{ text: route.album }]),
      el('div', { class: 'error-box', text: 'Такого альбома нет в истории.' }));
  }

  const wrap = el('div', { class: 'detail' });
  wrap.append(crumbs(route, [
    { text: route.artist, href: href('u', route.username, 'artist', route.artist) },
    { text: route.album },
  ]));

  const head = el('section', { class: 'detail-head' });
  head.append(cover(route.artist, route.album, { big: true }));
  const info = el('div', { class: 'profile-info' });
  info.append(el('p', { class: 'eyebrow', text: 'альбом' }));
  info.append(el('h1', { text: route.album }));
  info.append(el('a', {
    class: 'detail-artist',
    href: href('u', route.username, 'artist', route.artist),
    text: route.artist,
  }));
  info.append(statLine(
    el('strong', { text: plays(data.plays) }),
    el('span', { class: 'muted', text: `впервые ${shortDate(data.first_play)}` }),
    el('span', { class: 'muted', text: `последний раз ${timeAgo(data.last_play)}` }),
  ));
  head.append(info);
  wrap.append(head);

  const rows = el('ol', { class: 'rank-list tracks' });
  data.tracks.forEach((track, index) => {
    const li = el('li', { class: 'rank' });
    li.append(el('span', { class: 'rank-num', text: String(index + 1) }));
    const body = el('div', { class: 'rank-body' });
    body.append(el('a', {
      class: 'rank-title',
      href: href('u', route.username, 'track', route.artist, track.title),
      text: track.title,
    }));
    li.append(body);
    li.append(el('span', { class: 'rank-count', text: plays(track.plays) }));
    rows.append(li);
  });

  wrap.append(el('section', { class: 'panel' }, sectionHead('Треки'), rows));
  return wrap;
}

export async function renderTrack(route, app) {
  const data = await trackPage(route.username, route.artist, route.track);
  if (!data || !Number(data.plays)) {
    return el('div', {}, crumbs(route, [{ text: route.track }]),
      el('div', { class: 'error-box', text: 'Трек не найден в истории.' }));
  }

  const wrap = el('div', { class: 'detail' });
  wrap.append(crumbs(route, [
    { text: route.artist, href: href('u', route.username, 'artist', route.artist) },
    { text: route.track },
  ]));

  const head = el('section', { class: 'detail-head' });
  head.append(cover(route.artist, data.album, { big: true }));
  const info = el('div', { class: 'profile-info' });
  info.append(el('p', { class: 'eyebrow', text: 'трек' }));
  info.append(el('h1', { text: route.track }));
  info.append(el('a', {
    class: 'detail-artist',
    href: href('u', route.username, 'artist', route.artist),
    text: route.artist,
  }));
  if (data.album) {
    info.append(el('a', {
      class: 'detail-album muted',
      href: href('u', route.username, 'album', route.artist, data.album),
      text: data.album,
    }));
  }
  info.append(statLine(
    el('strong', { text: plays(data.plays) }),
    data.loved ? el('span', { class: 'heart', text: '♥ любимый' }) : null,
    el('span', { class: 'muted', text: `впервые ${shortDate(data.first_play)}` }),
    el('span', { class: 'muted', text: `последний раз ${timeAgo(data.last_play)}` }),
  ));

  if (app.profile?.username === route.username) {
    const love = el('button', {
      class: 'button secondary small',
      type: 'button',
      text: data.loved ? 'Убрать из любимых' : '♥ В любимое',
    });
    love.addEventListener('click', async () => {
      love.disabled = true;
      if (data.loved) {
        await supabase.from('track_loves')
          .delete()
          .eq('user_id', app.profile.id)
          .eq('artist', route.artist)
          .eq('track', route.track);
      } else {
        await supabase.from('track_loves').upsert({
          user_id: app.profile.id,
          artist: route.artist,
          track: route.track,
          loved_at: new Date().toISOString(),
        }, { onConflict: 'user_id,artist,track' });
      }
      data.loved = !data.loved;
      love.textContent = data.loved ? 'Убрать из любимых' : '♥ В любимое';
      love.disabled = false;
    });
    info.append(love);
  }

  head.append(info);
  wrap.append(head);

  const rows = el('ol', { class: 'rows' });
  for (const item of data.history) {
    rows.append(scrobbleRow({
      artist: route.artist,
      track: route.track,
      album: item.album,
      album_artist: route.artist,
      played_at: item.played_at,
    }, route.username, { showArt: false }));
  }

  wrap.append(el('section', { class: 'panel' },
    sectionHead(`История · ${num(data.plays)}`),
    rows,
  ));
  return wrap;
}
