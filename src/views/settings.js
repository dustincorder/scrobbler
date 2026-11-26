import { functionCall, supabase, FUNCTIONS_URL, signOut, validateUsername } from '../api.js';
import { el, sectionHead, avatar } from '../ui.js';
import { href, navigate } from '../router.js';
import { shortDate } from '../format.js';

function copyRow(label, value) {
  const input = el('input', { readonly: true, value, spellcheck: 'false' });
  const button = el('button', { class: 'button secondary small', type: 'button', text: 'Копировать' });
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(value);
      button.textContent = 'Скопировано';
      setTimeout(() => { button.textContent = 'Копировать'; }, 1500);
    } catch {
      input.select();
      button.textContent = 'Выделено';
    }
  });
  return el('div', { class: 'field' },
    el('span', { text: label }),
    el('div', { class: 'copy-row' }, input, button),
  );
}

export async function renderSettings(app) {
  const profile = app.profile;
  const wrap = el('div', { class: 'content narrow' });
  wrap.append(el('h1', { text: 'Настройки' }));

  // ---------- профиль ----------
  const profilePanel = el('section', { class: 'panel' });
  profilePanel.append(sectionHead('Профиль'));

  const display = el('input', { value: profile.display_name ?? '', maxlength: '80' });
  const country = el('input', { value: profile.country ?? '', maxlength: '80', placeholder: 'например, Россия' });
  const avatarUrl = el('input', { value: profile.avatar_url ?? '', placeholder: 'https://…', type: 'url' });
  const bio = el('textarea', { rows: '4', maxlength: '1000' });
  bio.value = profile.bio ?? '';
  const isPublic = el('input', { type: 'checkbox' });
  isPublic.checked = profile.is_public !== false;

  const saveState = el('span', { class: 'muted' });
  const save = el('button', { class: 'button', type: 'button', text: 'Сохранить' });
  save.addEventListener('click', async () => {
    save.disabled = true;
    saveState.textContent = 'Сохраняю…';
    const { error } = await supabase.from('profiles').update({
      display_name: display.value.trim() || profile.username,
      country: country.value.trim() || null,
      avatar_url: avatarUrl.value.trim() || null,
      bio: bio.value.trim() || null,
      is_public: isPublic.checked,
    }).eq('id', profile.id);
    save.disabled = false;
    if (error) {
      saveState.textContent = `Ошибка: ${error.message}`;
      return;
    }
    Object.assign(profile, {
      display_name: display.value.trim() || profile.username,
      country: country.value.trim() || null,
      avatar_url: avatarUrl.value.trim() || null,
      bio: bio.value.trim() || null,
      is_public: isPublic.checked,
    });
    saveState.textContent = 'Сохранено';
    setTimeout(() => { saveState.textContent = ''; }, 2000);
  });

  const head = el('div', { class: 'settings-head' }, avatar(profile, { big: true }),
    el('div', {}, el('strong', { text: `@${profile.username}` }), el('div', { class: 'muted', text: `с ${shortDate(profile.created_at)}` })));

  const usernameInput = el('input', {
    value: profile.username, maxlength: '32', spellcheck: 'false', autocomplete: 'off',
  });
  const usernameState = el('span', { class: 'muted' });
  const rename = el('button', { class: 'button secondary', type: 'button', text: 'Сменить имя' });
  rename.addEventListener('click', async () => {
    const value = usernameInput.value.trim().toLowerCase();
    usernameState.textContent = '';
    if (value === profile.username) return;
    if (!validateUsername(value)) {
      usernameState.textContent = '3–32 символа: только a-z, 0-9 и _.';
      return;
    }
    rename.disabled = true;
    const oldHref = href('u', profile.username);
    try {
      const result = await functionCall('/profile', { method: 'POST', body: { username: value } });
      profile.username = result.username;
      usernameInput.value = result.username;
      head.querySelector('strong').textContent = `@${result.username}`;
      for (const a of document.querySelectorAll(`a[href="${oldHref}"]`)) {
        a.setAttribute('href', href('u', result.username));
      }
      usernameState.textContent = `Готово — вход и URL теперь по имени «${result.username}». Старые ссылки на профиль больше не работают.`;
    } catch (error) {
      usernameState.textContent = `Ошибка: ${error.message}`;
    } finally {
      rename.disabled = false;
    }
  });

  profilePanel.append(
    head,
    el('div', { class: 'grid-2' },
      el('label', { class: 'field' }, el('span', { text: 'Имя пользователя' }), usernameInput),
      el('div', { class: 'field' },
        el('span', { text: ' ' }),
        el('div', { class: 'button-row' }, rename, usernameState)),
    ),
    el('div', { class: 'grid-2' },
      el('label', { class: 'field' }, el('span', { text: 'Отображаемое имя' }), display),
      el('label', { class: 'field' }, el('span', { text: 'Страна' }), country),
    ),
    el('label', { class: 'field' }, el('span', { text: 'Аватар (URL)' }), avatarUrl),
    el('label', { class: 'field' }, el('span', { text: 'О себе' }), bio),
    el('label', { class: 'checkbox' }, isPublic, el('span', { text: 'Публичный профиль' })),
    el('div', { class: 'button-row' }, save, saveState),
  );
  wrap.append(profilePanel);

  // ---------- подключение клиентов ----------
  const apiRoot = `${FUNCTIONS_URL}/api/2.0`;
  const webhookBase = `${FUNCTIONS_URL}/api/webhook`;

  const tokens = await functionCall('/tokens');
  let webhookToken = null;
  try {
    webhookToken = localStorage.getItem('scrobble:webhook-token');
  } catch { /* private mode */ }
  const hasWebhook = Boolean(webhookToken) && (tokens.tokens ?? []).some((t) => t.kind === 'webhook' && !t.revoked_at);

  const clientsPanel = el('section', { class: 'panel' });
  clientsPanel.append(sectionHead('Клиенты'));

  clientsPanel.append(el('h3', { text: 'Pano Scrobbler (Android, TV, Windows)' }));
  clientsPanel.append(el('ol', { class: 'steps' },
    el('li', { text: 'Настройки → Скробблинг → добавить сервис → GNU FM.' }),
    el('li', { text: 'URL сервера — ниже. Имя и пароль — как на этом сайте.' }),
    el('li', { text: 'После входа Pano получит ключ сессии и будет писать сюда.' }),
  ));
  clientsPanel.append(copyRow('Last.fm-совместимый адрес', apiRoot));

  clientsPanel.append(el('h3', { text: 'Web Scrobbler (браузер)' }));
  clientsPanel.append(el('ol', { class: 'steps' },
    el('li', { text: 'Настройки расширения → Добавить сервис → Webhook.' }),
    el('li', { text: 'Вставь URL ниже и сохрани.' }),
  ));
  if (hasWebhook) {
    clientsPanel.append(copyRow('Webhook URL', `${webhookBase}?token=${webhookToken}`));
    clientsPanel.append(el('p', { class: 'hint', text: 'URL хранится в этом браузере. Если потерял — отзови токен и создай новый.' }));
  } else {
    clientsPanel.append(el('p', { class: 'hint', text: 'Создай webhook-токен в разделе «Токены» ниже — URL появится здесь.' }));
  }

  clientsPanel.append(el('h3', { text: 'ListenBrainz-совместимые клиенты' }));
  clientsPanel.append(copyRow('API URL', `${FUNCTIONS_URL}/api`));
  clientsPanel.append(el('p', { class: 'hint', text: 'В Web Scrobbler: сервис ListenBrainz → этот API URL + токен типа listenbrainz или API-ключ (сервис сам допишет /1/submit-listens). Поддерживаются scrobble, now playing и импорт.' }));

  clientsPanel.append(el('h3', { text: 'Любой Last.fm-клиент' }));
  clientsPanel.append(copyRow('API root', apiRoot));

  clientsPanel.append(el('h3', { text: 'API-ключ' }));
  clientsPanel.append(el('ol', { class: 'steps' },
    el('li', { text: 'Создай токен типа API-ключ в разделе «Токены» ниже.' }),
    el('li', { text: 'Работает как ключ сессии (sk) в вызовах /api/2.0 — подходит любому Last.fm-совместимому клиенту.' }),
    el('li', { text: 'Для скриптов: POST /api/scrobble?token=<ключ> с телом {"artist": "…", "track": "…"}.' }),
  ));
  clientsPanel.append(copyRow('Scrobble endpoint', `${FUNCTIONS_URL}/api/scrobble`));
  wrap.append(clientsPanel);

  // ---------- обложки ----------
  const artPanel = el('section', { class: 'panel' });
  artPanel.append(sectionHead('Обложки'));

  const artState = el('span', { class: 'muted' });
  const artButton = el('button', { class: 'button secondary', type: 'button', text: 'Подтянуть обложки' });
  artButton.addEventListener('click', async () => {
    artButton.disabled = true;
    artState.textContent = 'Считаю, чего не хватает…';
    try {
      for (;;) {
        const result = await functionCall('/artwork', { method: 'POST' });
        if (!result.remaining) break;
        artState.textContent = `Осталось ${result.remaining}…`;
      }
      artState.textContent = 'Готово — картинки подставятся сами по мере появления на страницах.';
    } catch (error) {
      artState.textContent = `Ошибка: ${error.message}`;
    } finally {
      artButton.disabled = false;
    }
  });

  artPanel.append(
    el('p', { class: 'hint', text: 'Разово добирает картинки для артистов и альбомов из базы (Deezer → iTunes). Кэш общий и бессрочный; новые скробблы подтягивают обложки сами.' }),
    el('div', { class: 'button-row' }, artButton, artState),
  );
  wrap.append(artPanel);

  // ---------- токены ----------
  const tokenPanel = el('section', { class: 'panel' });
  tokenPanel.append(sectionHead('Токены'));

  const newTokenSlot = el('div', { class: 'hint' });
  const kind = el('select', {},
    el('option', { value: 'session', text: 'API-ключ' }),
    el('option', { value: 'webhook', text: 'Web Scrobbler (webhook)' }),
    el('option', { value: 'listenbrainz', text: 'ListenBrainz' }),
  );
  const label = el('input', { placeholder: 'название, например «ноутбук»', maxlength: '80' });
  const create = el('button', { class: 'button secondary', type: 'button', text: 'Создать токен' });
  create.addEventListener('click', async () => {
    create.disabled = true;
    try {
      const result = await functionCall('/tokens', {
        method: 'POST',
        body: { kind: kind.value, label: label.value.trim() || null },
      });
      if (kind.value === 'webhook') {
        try { localStorage.setItem('scrobble:webhook-token', result.token); } catch { /* ignore */ }
      }
      newTokenSlot.replaceChildren(
        el('p', { text: 'Токен создан. Скопируй сейчас — потом не покажу.' }),
        copyRow('Token', result.token),
        kind.value === 'session'
          ? el('p', { text: 'Это универсальный ключ: работает как sk в /api/2.0 (method=track.scrobble&sk=…) и как ?token= в /api/scrobble.' })
          : null,
      );
      await refreshTokens();
    } catch (error) {
      newTokenSlot.textContent = error.message;
    } finally {
      create.disabled = false;
    }
  });

  const tokenList = el('div', { class: 'token-list' });
  async function refreshTokens() {
    const data = await functionCall('/tokens');
    tokenList.replaceChildren();
    const rows = data.tokens ?? [];
    if (!rows.length) {
      tokenList.append(el('p', { class: 'muted', text: 'Пока ни одного токена.' }));
      return;
    }
    for (const token of rows) {
      const row = el('div', { class: `token-row${token.revoked_at ? ' revoked' : ''}` });
      row.append(el('div', {},
        el('strong', { text: token.label || token.kind }),
        el('div', { class: 'muted small', text: `${token.kind} · создан ${shortDate(token.created_at)}${token.last_used_at ? ` · использован ${shortDate(token.last_used_at)}` : ''}` }),
      ));
      if (!token.revoked_at) {
        const revoke = el('button', { class: 'button danger small', type: 'button', text: 'Отозвать' });
        revoke.addEventListener('click', async () => {
          revoke.disabled = true;
          await functionCall(`/tokens?id=${encodeURIComponent(token.id)}`, { method: 'DELETE' });
          if (token.kind === 'webhook') {
            try { localStorage.removeItem('scrobble:webhook-token'); } catch { /* ignore */ }
          }
          await refreshTokens();
        });
        row.append(revoke);
      } else {
        row.append(el('span', { class: 'muted small', text: 'отозван' }));
      }
      tokenList.append(row);
    }
  }

  tokenPanel.append(
    el('div', { class: 'grid-3' }, kind, label, create),
    newTokenSlot,
    tokenList,
  );
  wrap.append(tokenPanel);
  refreshTokens().catch(() => {});

  // ---------- пароль ----------
  const passwordPanel = el('section', { class: 'panel' });
  passwordPanel.append(sectionHead('Пароль'));

  const newPassword = el('input', {
    type: 'password', autocomplete: 'new-password', minlength: '6',
    placeholder: 'минимум 6 символов',
  });
  const confirmPassword = el('input', {
    type: 'password', autocomplete: 'new-password', minlength: '6',
    placeholder: 'ещё раз',
  });
  const passwordState = el('span', { class: 'muted' });
  const savePassword = el('button', { class: 'button secondary', type: 'button', text: 'Сменить пароль' });
  savePassword.addEventListener('click', async () => {
    passwordState.textContent = '';
    if (newPassword.value.length < 6) {
      passwordState.textContent = 'Пароль слишком короткий (минимум 6 символов).';
      return;
    }
    if (newPassword.value !== confirmPassword.value) {
      passwordState.textContent = 'Пароли не совпадают.';
      return;
    }
    savePassword.disabled = true;
    passwordState.textContent = 'Меняю…';
    const { error } = await supabase.auth.updateUser({ password: newPassword.value });
    savePassword.disabled = false;
    if (error) {
      passwordState.textContent = `Ошибка: ${error.message}`;
      return;
    }
    newPassword.value = '';
    confirmPassword.value = '';
    passwordState.textContent = 'Пароль обновлён. В Pano Scrobbler останется старая сессия, пока не выйдешь из неё.';
  });

  passwordPanel.append(
    el('p', { class: 'hint', text: 'Этот пароль используется для входа на сайт и для Pano Scrobbler (GNU FM).' }),
    el('div', { class: 'grid-2' },
      el('label', { class: 'field' }, el('span', { text: 'Новый пароль' }), newPassword),
      el('label', { class: 'field' }, el('span', { text: 'Повтор' }), confirmPassword),
    ),
    el('div', { class: 'button-row' }, savePassword, passwordState),
  );
  wrap.append(passwordPanel);

  // ---------- сессия ----------
  const sessionPanel = el('section', { class: 'panel' });
  sessionPanel.append(sectionHead('Сессия'));
  const logout = el('button', { class: 'button danger', type: 'button', text: 'Выйти' });
  logout.addEventListener('click', async () => {
    await signOut();
    navigate(href('login'), true);
  });
  sessionPanel.append(logout);
  wrap.append(sessionPanel);

  return wrap;
}
