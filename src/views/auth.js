import { signIn, signUp, validateUsername, functionCall } from '../api.js';
import { el, spinner, errorBox } from '../ui.js';
import { href, navigate } from '../router.js';

function authCard(title, subtitle, form) {
  return el('div', { class: 'auth-card' },
    el('h1', { text: title }),
    el('p', { class: 'muted', text: subtitle }),
    form,
  );
}

export function renderAuth(root, route, { shell, app, navigate: go }) {
  const join = route.name === 'join';
  if (app.profile) {
    go(href('u', app.profile.username), true);
    return;
  }

  const errorSlot = el('div', { class: 'form-error', role: 'alert' });
  const username = el('input', {
    name: 'username', autocomplete: 'username', required: true,
    placeholder: 'например, slutvibe', spellcheck: 'false', maxlength: '32',
  });
  const password = el('input', {
    name: 'password', type: 'password', autocomplete: join ? 'new-password' : 'current-password',
    required: true, minlength: '6', placeholder: 'минимум 6 символов',
  });
  const submit = el('button', { class: 'button', type: 'submit', text: join ? 'Создать профиль' : 'Войти' });

  const form = el('form', { class: 'stack' });
  form.append(
    el('label', { class: 'field' }, el('span', { text: 'Имя пользователя' }), username),
    el('label', { class: 'field' }, el('span', { text: 'Пароль' }), password),
    errorSlot,
    submit,
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorSlot.textContent = '';
    const name = username.value.trim().toLowerCase();
    if (!validateUsername(name)) {
      errorSlot.textContent = 'Имя: 3–32 символа, только a-z, 0-9 и _.';
      return;
    }
    submit.disabled = true;
    submit.textContent = join ? 'Создаю…' : 'Вхожу…';
    try {
      if (join) {
        const result = await signUp(name, password.value);
        if (!result.session) {
          errorSlot.textContent = 'Профиль создан, но вход не выдан. Проверь настройки Supabase (Confirm email = off).';
          submit.disabled = false;
          submit.textContent = 'Создать профиль';
          return;
        }
      } else {
        await signIn(name, password.value);
      }
      const next = route.query?.get('next');
      const target = next && next.startsWith('#/') ? next : href('u', name);
      go(target, true);
    } catch (error) {
      errorSlot.textContent = error instanceof Error ? error.message : 'Не получилось.';
      submit.disabled = false;
      submit.textContent = join ? 'Создать профиль' : 'Войти';
    }
  });

  const content = el('div', { class: 'auth-wrap' },
    authCard(
      join ? 'Новый слушатель' : 'С возвращением',
      join
        ? 'Имя видно в адресе профиля. Пароль понадобится для Pano Scrobbler.'
        : 'Войди, чтобы смотреть свои настройки и импорт.',
      form,
    ),
    el('p', { class: 'auth-alt' },
      join ? 'Уже есть профиль? ' : 'Ещё нет профиля? ',
      el('a', { href: href(join ? 'login' : 'join'), text: join ? 'Войти' : 'Создать' }),
    ),
  );

  root.replaceChildren(shell(el('div', { class: 'narrow' }, content)));
}

export function renderConnect(root, route, { shell }) {
  const slot = el('div', { class: 'content' }, spinner());
  root.replaceChildren(shell(el('div', { class: 'narrow' }, slot)));

  const token = route.token;
  if (!token) {
    slot.replaceChildren(errorBox('В ссылке нет token. Начни подключение заново из приложения.'));
    return;
  }

  const button = el('button', {
    class: 'button', type: 'button', text: 'Разрешить доступ',
    onclick: async () => {
      button.disabled = true;
      button.textContent = 'Подключаю…';
      try {
        await functionCall('/auth/approve', { method: 'POST', body: { token } });
        slot.replaceChildren(
          el('h1', { text: 'Готово' }),
          el('p', { class: 'muted', text: 'Вернись в приложение — оно получит ключ сессии.' }),
        );
      } catch (error) {
        slot.replaceChildren(errorBox(error.message));
      }
    },
  });

  slot.replaceChildren(
    el('h1', { text: 'Подключить приложение' }),
    el('p', { class: 'muted', text: 'Приложение просит доступ к твоему профилю скробблера. Разрешить?' }),
    button,
  );
}
