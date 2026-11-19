import {
  configured, supabase, FUNCTIONS_URL, signOut,
} from './api.js';
import { parseRoute, href, navigate } from './router.js';
import { el, avatar, spinner, errorBox } from './ui.js';
import { escapeHtml, num } from './format.js';
import { renderProfile } from './views/profile.js';
import { renderArtist, renderAlbum, renderTrack } from './views/detail.js';
import { renderAuth, renderConnect } from './views/auth.js';
import { renderSettings } from './views/settings.js';
import { renderImport } from './views/import.js';
import './style.css';

const root = document.querySelector('#app');
const app = {
  session: null,
  profile: null,
  version: 0,
};

window.scrobblerConfig = { FUNCTIONS_URL };

function shell(content, { wide = false } = {}) {
  const header = el('header', { class: 'topbar' });
  const brand = el('a', { class: 'brand', href: href(), 'aria-label': 'scrobble' },
    el('span', { class: 'brand-mark' }),
    el('span', { class: 'brand-name', text: 'scrobble' }),
  );

  const search = el('form', { class: 'search' });
  const input = el('input', {
    type: 'search',
    name: 'q',
    placeholder: 'Найти слушателя',
    'aria-label': 'Имя пользователя',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  search.append(input);
  search.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = input.value.trim().toLowerCase();
    if (/^[a-z0-9_]{3,32}$/.test(value)) navigate(href('u', value));
  });

  const actions = el('nav', { class: 'top-actions' });
  if (app.profile) {
    actions.append(el('a', { class: 'ghost-link', href: href('import'), text: 'Импорт' }));
    actions.append(el('a', { class: 'ghost-link', href: href('settings'), text: 'Настройки' }));
    const me = el('a', { class: 'me', href: href('u', app.profile.username), title: app.profile.username });
    me.append(avatar(app.profile));
    actions.append(me);
  } else {
    actions.append(el('a', { class: 'ghost-link', href: href('login'), text: 'Войти' }));
    actions.append(el('a', { class: 'button small', href: href('join'), text: 'Создать профиль' }));
  }

  header.append(brand, search, actions);

  const main = el('main', { class: wide ? 'page wide' : 'page' }, content);
  const footer = el('footer', { class: 'footer' },
    el('span', { text: 'Своя история прослушиваний. Без Last.fm.' }),
    el('a', { href: href('settings'), text: 'Настройка клиентов' }),
  );

  return el('div', { class: 'shell' }, header, main, footer);
}

function renderFatal(message) {
  root.replaceChildren(shell(el('div', { class: 'error-box' }, message)));
}

function renderHome() {
  if (app.profile) {
    navigate(href('u', app.profile.username), true);
    return;
  }
  const hero = el('section', { class: 'hero' },
    el('p', { class: 'eyebrow', text: 'своя история прослушиваний' }),
    el('h1', { text: 'Last.fm больше не нужен.' }),
    el('p', {
      class: 'lead',
      text: 'Скробблинг с телефона и браузера, полная статистика, любимые треки и графики. Свои данные, свой сервер, без подписки на API.',
    }),
    el('div', { class: 'hero-actions' },
      el('a', { class: 'button', href: href('join'), text: 'Создать профиль' }),
      el('a', { class: 'button secondary', href: href('login'), text: 'Войти' }),
    ),
  );

  const cards = el('section', { class: 'feature-grid' },
    feature('Pano Scrobbler', 'Подключи как GNU FM сервер и скроббли с Android, TV и Windows.'),
    feature('Web Scrobbler', 'Один webhook URL — и браузерные проигрыватели пишут сюда.'),
    feature('Импорт Last.fm', 'Забери всю историю, пока старый API ещё отвечает.'),
    feature('Статистика', 'Топы, графики, тепловая карта, любимые треки и страницы артистов.'),
  );

  root.replaceChildren(shell(el('div', {}, hero, cards)));
}

function feature(title, text) {
  return el('div', { class: 'feature' }, el('h3', { text: title }), el('p', { text }));
}

async function render() {
  const version = ++app.version;
  const route = parseRoute();

  if (route.name === 'home') return renderHome();
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
