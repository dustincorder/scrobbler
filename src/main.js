import {
  configured, supabase,
} from './api.js';
import { parseRoute, href, navigate } from './router.js';
import { el, avatar, spinner, errorBox } from './ui.js';
import { renderProfile } from './views/profile.js';
import { renderArtist, renderAlbum, renderTrack } from './views/detail.js';
import { renderAuth, renderConnect } from './views/auth.js';
import { renderSettings } from './views/settings.js';
import { renderImport } from './views/import.js';
import { renderDashboard } from './views/dashboard.js';
import './style.css';

const root = document.querySelector('#app');
const app = {
  session: null,
  profile: null,
  version: 0,
};

const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .7-1.5l7-6a2 2 0 0 1 2.6 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  import: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h10"/><path d="M18 7h2"/><circle cx="16" cy="7" r="2"/><path d="M4 17h2"/><path d="M10 17h10"/><circle cx="8" cy="17" r="2"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};

function icon(name) {
  return el('span', { class: 'icon', html: ICONS[name] ?? '' });
}

function brand() {
  return el('a', { class: 'brand', href: href(), 'aria-label': 'scrobble' },
    el('span', { class: 'brand-mark' }),
    el('span', { class: 'brand-name', text: 'scrobble' }),
  );
}

function openSearch() {
  const input = el('input', {
    type: 'search', placeholder: 'Имя слушателя', spellcheck: 'false', autocomplete: 'off',
  });
  const dialog = el('div', { class: 'search-overlay' },
    el('div', { class: 'search-dialog' },
      el('div', { class: 'search-field' }, icon('search'), input),
      el('p', { class: 'hint', text: 'Введи имя и нажми Enter.' }),
    ),
  );
  const close = () => dialog.remove();
  dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const value = input.value.trim().toLowerCase();
    if (/^[a-z0-9_]{3,32}$/.test(value)) {
      close();
      navigate(href('u', value));
    }
  });
  document.addEventListener('keydown', function onEsc(event) {
    if (event.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
  });
  document.body.append(dialog);
  input.focus();
}

function navLink({ label, href: to, name, iconName, onClick }) {
  const active = !onClick && parseRoute().name === name;
  return el(onClick ? 'button' : 'a', {
    class: `nav-link${active ? ' active' : ''}`,
    ...(onClick ? { type: 'button', onclick: onClick } : { href: to }),
    'aria-label': label,
    title: label,
  }, icon(iconName));
}

function shell(content, { wide = false } = {}) {
  if (!app.profile) {
    return el('div', { class: 'bare' },
      el('div', { class: 'bare-top' }, brand()),
      el('main', { class: 'page' }, content),
    );
  }

  const username = app.profile.username;
  const nav = el('nav', { class: 'rail-nav' },
    navLink({ label: 'Главная', href: href(), name: 'home', iconName: 'home' }),
    navLink({ label: 'Поиск', onClick: openSearch, iconName: 'search' }),
    navLink({ label: 'Профиль', href: href('u', username), name: 'profile', iconName: 'user' }),
    navLink({ label: 'Импорт', href: href('import'), name: 'import', iconName: 'import' }),
    navLink({ label: 'Настройки', href: href('settings'), name: 'settings', iconName: 'settings' }),
  );

  const rail = el('aside', { class: 'rail' },
    el('a', { class: 'rail-brand', href: href(), 'aria-label': 'scrobble' },
      el('span', { class: 'brand-mark' })),
    nav,
    el('a', { class: 'rail-me', href: href('u', username), 'aria-label': username },
      avatar(app.profile)),
  );

  const header = el('header', { class: 'mobile-top' },
    brand(),
    el('a', { class: 'mobile-me', href: href('u', username) }, avatar(app.profile)),
  );

  return el('div', { class: 'app-layout' },
    rail,
    el('div', { class: 'app-main' }, header, el('main', { class: wide ? 'page wide' : 'page' }, content)),
  );
}

function renderFatal(message) {
  root.replaceChildren(shell(el('div', { class: 'error-box' }, message)));
}

async function render() {
  const version = ++app.version;
  const route = parseRoute();

  if (route.name === 'home') {
    if (app.profile) {
      const wrap = el('div', { class: 'content' }, spinner());
      root.replaceChildren(shell(wrap, { wide: true }));
      try {
        const node = await renderDashboard(app);
        if (version !== app.version) return;
        wrap.replaceChildren(node);
      } catch (error) {
        if (version !== app.version) return;
        wrap.replaceChildren(errorBox(error instanceof Error ? error.message : 'Не удалось загрузить.'));
      }
      return;
    }
    return renderAuth(root, { name: 'login', query: null }, { shell, app, navigate });
  }
  if (route.name === 'login' || route.name === 'join') {
    return renderAuth(root, route, { shell, app, navigate });
  }
  if (route.name === 'connect') {
    return renderConnect(root, route, { shell });
  }

  if (!app.profile && ['settings', 'import'].includes(route.name)) {
    navigate(`${href('login')}?next=${encodeURIComponent(location.hash)}`, true);
    return;
  }

  const wrap = el('div', { class: 'content' }, spinner());
  root.replaceChildren(shell(wrap, { wide: route.name === 'profile' }));

  try {
    let node;
    if (route.name === 'profile') node = await renderProfile(route, app);
    else if (route.name === 'artist') node = await renderArtist(route, app);
    else if (route.name === 'album') node = await renderAlbum(route, app);
    else if (route.name === 'track') node = await renderTrack(route, app);
    else if (route.name === 'settings') node = await renderSettings(app);
    else if (route.name === 'import') node = await renderImport(app);
    else node = el('div', { class: 'error-box', text: 'Страница не найдена.' });
    if (version !== app.version) return;
    wrap.replaceChildren(node);
  } catch (error) {
    if (version !== app.version) return;
    wrap.replaceChildren(errorBox(error instanceof Error ? error.message : 'Не удалось загрузить страницу.'));
  }
}

async function boot() {
  if (!configured) {
    renderFatal('Не настроен Supabase: задай VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY.');
    return;
  }

  const { data } = await supabase.auth.getSession();
  app.session = data.session ?? null;
  if (app.session?.user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', app.session.user.id)
      .maybeSingle();
    app.profile = profile ?? null;
  }

  supabase.auth.onAuthStateChange(async (_event, session) => {
    app.session = session ?? null;
    if (session?.user) {
      const { data: profile } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
      app.profile = profile ?? null;
    } else {
      app.profile = null;
    }
    render();
  });

  window.addEventListener('hashchange', render);
  render();
}

boot().catch((error) => {
  renderFatal(error instanceof Error ? error.message : 'Ошибка запуска.');
});

export { app };
