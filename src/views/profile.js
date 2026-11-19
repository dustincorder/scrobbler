import {
  getProfile, getStats, recentScrobbles, topItems, dailyCounts, lovedTracks,
  nowPlaying, artistPage,
} from '../api.js';
import { el, avatar, cover, empty, spinner, errorBox, sectionHead, tabs, scrobbleRow,
  nowPlayingCard, topArtistList, topAlbumGrid, topTrackList, heatmap, statBlock,
  periodPicker, barChart } from '../ui.js';
import { href, navigate } from '../router.js';
import { escapeHtml, num, plays, fullDate, shortDate, periodLabel } from '../format.js';

export async function renderProfile(route, app) {
  const profile = await getProfile(route.username);
  if (!profile) return errorBox('Профиль не найден или скрыт.');

  const isMe = app.profile?.id === profile.id;
  const root = el('div', { class: 'profile' });

  // ---- шапка ----
  const head = el('section', { class: 'profile-head' });
  head.append(avatar(profile, { big: true }));

  const info = el('div', { class: 'profile-info' });
  info.append(el('p', { class: 'eyebrow', text: 'слушатель' }));
  info.append(el('h1', { text: profile.display_name || profile.username }));
  const meta = el('div', { class: 'profile-meta' });
  meta.append(el('span', { text: `@${profile.username}` }));
  if (profile.country) meta.append(el('span', { class: 'dot', text: '·' }), el('span', { text: profile.country }));
  meta.append(el('span', { class: 'dot', text: '·' }), el('span', {
    text: `с ${shortDate(profile.created_at)}`,
  }));
  if (!profile.is_public) meta.append(el('span', { class: 'badge', text: 'скрытый профиль' }));
  info.append(meta);
  if (profile.bio) info.append(el('p', { class: 'bio', text: profile.bio }));

  if (isMe) {
    const actions = el('div', { class: 'profile-actions' });
    actions.append(el('a', { class: 'button secondary small', href: href('settings'), text: 'Редактировать' }));
    actions.append(el('a', { class: 'button secondary small', href: href('import'), text: 'Импорт' }));
    info.append(actions);
  }
  head.append(info);
  root.append(head);

  // ---- статы ----
  const stats = await getStats(profile.username);
  const statRow = el('section', { class: 'stats' });
  statRow.append(
    statBlock('прослушиваний', stats?.scrobbles ?? 0),
    statBlock('артистов', stats?.artists ?? 0),
    statBlock('альбомов', stats?.albums ?? 0),
    statBlock('треков', stats?.tracks ?? 0),
    statBlock('любимых', stats?.loved ?? 0),
  );
  root.append(statRow);

  // ---- сейчас играет ----
  const liveSlot = el('div', { class: 'live-slot' });
  root.append(liveSlot);

  const version = app.version;
  async function refreshLive() {
    if (version !== app.version) return;
    try {
      const live = await nowPlaying(profile.id);
      if (version !== app.version) return;
      liveSlot.replaceChildren(live ? nowPlayingCard(live, profile.username) : el('span'));
    } catch {
      // не критично
    }
    if (version === app.version) setTimeout(refreshLive, 20000);
  }
  refreshLive();

  // ---- табы ----
  root.append(tabs(profile.username, route.tab));

  const panel = el('div', { class: 'tab-panel' }, spinner());
  root.append(panel);

  try {
    const content = await renderTab(route, profile, isMe);
    if (version === app.version) panel.replaceChildren(content);
  } catch (error) {
    panel.replaceChildren(errorBox(error.message));
  }

  return root;
}

async function renderTab(route, profile, isMe) {
  const period = route.query?.get('period') ?? 'overall';

  if (route.tab === 'overview') {
    const [recent, artists, albums, tracks, daily] = await Promise.all([
      recentScrobbles(profile.id, { limit: 25 }),
      topItems(profile.username, 'artist', 'overall', 8),
      topItems(profile.username, 'album', 'overall', 6),
      topItems(profile.username, 'track', 'overall', 8),
      dailyCounts(profile.username, 365),
    ]);

    const layout = el('div', { class: 'overview' });

    const recentBlock = el('section', { class: 'panel' },
      sectionHead('Последние прослушивания',
        el('a', { class: 'link-more', href: href('u', profile.username, 'tracks'), text: 'все треки' })),
    );
    recentBlock.append(recent.length
      ? el('ol', { class: 'rows', id: 'recent-list' }, ...recent.map((s) => scrobbleRow(s, profile.username)))
      : empty('Скробблов пока нет. Настрой клиент или импортируй Last.fm.'));
    if (recent.length >= 25) {
      const more = el('button', { class: 'button secondary small', type: 'button', text: 'Показать ещё' });
      more.addEventListener('click', async () => {
        more.disabled = true;
        const batch = await recentScrobbles(profile.id, { limit: 50, before: recent.at(-1).played_at });
        document.getElementById('recent-list')?.append(...batch.map((s) => scrobbleRow(s, profile.username)));
        more.remove();
      });
      recentBlock.append(more);
    }

    const right = el('div', { class: 'overview-side' },
      sectionHead('Топ артистов', el('a', { class: 'link-more', href: href('u', profile.username, 'artists'), text: 'все' })),
      topArtistList(artists, profile.username),
      sectionHead('Топ альбомов', el('a', { class: 'link-more', href: href('u', profile.username, 'albums'), text: 'все' })),
      topAlbumGrid(albums, profile.username),
    );

    layout.append(recentBlock, right);

    const lower = el('div', { class: 'overview-lower' },
      el('section', { class: 'panel' },
        sectionHead('Топ треков', el('a', { class: 'link-more', href: href('u', profile.username, 'tracks'), text: 'все' })),
        topTrackList(tracks, profile.username),
      ),
      el('section', { class: 'panel' },
        sectionHead('Активность за год'),
        heatmap(daily),
      ),
    );

    const wrap = el('div', {});
    wrap.append(layout, lower);
    return wrap;
  }

  if (route.tab === 'artists') {
    return periodPanel(profile, period, async () =>
      topArtistList(await topItems(profile.username, 'artist', period, 100), profile.username));
  }

  if (route.tab === 'albums') {
    return periodPanel(profile, period, async () =>
      topAlbumGrid(await topItems(profile.username, 'album', period, 100), profile.username));
  }

  if (route.tab === 'tracks') {
    return periodPanel(profile, period, async () =>
      topTrackList(await topItems(profile.username, 'track', period, 100), profile.username));
  }

  if (route.tab === 'loved') {
    const loved = await lovedTracks(profile.id);
    if (!loved.length) return empty('Ничего не отмечено любимым.');
    const rows = el('ol', { class: 'rows' });
    for (const item of loved) {
      const li = el('li', { class: 'row scrobble' });
      li.append(cover(item.artist, null));
      const main = el('div', { class: 'row-main' });
      main.append(el('a', {
        class: 'row-title',
        href: href('u', profile.username, 'track', item.artist, item.track),
        text: item.track,
      }));
      const sub = el('div', { class: 'row-sub' });
      sub.append(el('a', { href: href('u', profile.username, 'artist', item.artist), text: item.artist }));
      main.append(sub);
      li.append(main, el('span', { class: 'heart', text: '♥', title: fullDate(item.loved_at) }));
      rows.append(li);
    }
    return el('section', { class: 'panel' }, sectionHead(`Любимые треки · ${num(loved.length)}`), rows);
  }

  if (route.tab === 'charts') {
    const [daily, stats] = await Promise.all([
      dailyCounts(profile.username, 365),
      getStats(profile.username),
    ]);
    const total = daily.reduce((sum, d) => sum + Number(d.plays), 0);
    const peak = daily.reduce((best, d) => (Number(d.plays) > Number(best?.plays ?? 0) ? d : best), null);
    const panel = el('section', { class: 'panel' });
    panel.append(sectionHead(`Активность ${periodLabel('12month')}`));
    panel.append(el('div', { class: 'chart-stats' },
      statBlock('прослушиваний', total),
      statBlock('в среднем в день', daily.length ? Math.round(total / Math.max(1, daily.length)) : 0),
      statBlock('лучший день', peak ? `${shortDate(peak.day)} — ${num(peak.plays)}` : '—'),
      statBlock('первый скроббл', stats?.first_play ? shortDate(stats.first_play) : '—'),
    ));
    panel.append(barChart(daily));
    panel.append(el('div', { class: 'panel-sub' }, sectionHead('Календарь'), heatmap(daily)));
    return panel;
  }

  return empty('Раздел не найден.');
}

function periodPanel(profile, period, loader) {
  const body = el('div', { class: 'tab-body' }, spinner());
  const panel = el('section', { class: 'panel' });
  panel.append(sectionHead(`Топ · ${periodLabel(period)}`));
  panel.append(periodPicker(period, (next) => {
    const url = new URLSearchParams(routeQuery());
    if (next === 'overall') url.delete('period');
    else url.set('period', next);
    const suffix = url.toString() ? `?${url}` : '';
    navigate(`#${location.hash.replace(/^#/, '').split('?')[0]}${suffix}`);
  }));
  panel.append(body);

  loader().then((node) => body.replaceChildren(node)).catch((error) => body.replaceChildren(errorBox(error.message)));
  return panel;
}

function routeQuery() {
  const raw = location.hash.split('?')[1] ?? '';
  return raw;
}
