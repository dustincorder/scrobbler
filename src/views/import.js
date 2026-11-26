import { functionCall, supabase } from '../api.js';
import { el, sectionHead } from '../ui.js';
import { num } from '../format.js';
import { parseScrobblesCsv } from '../csv.js';

function progressBar() {
  const inner = el('span', { style: 'width:0%' });
  const bar = el('div', { class: 'progress' }, inner);
  return { bar, set(percent) { inner.style.width = `${Math.max(0, Math.min(100, percent))}%`; } };
}

function lsKey(app) {
  return `scrobble:import:${app.profile?.id ?? 'anon'}`;
}

function readProgress(app) {
  try {
    return JSON.parse(localStorage.getItem(lsKey(app)) ?? 'null');
  } catch {
    return null;
  }
}

function writeProgress(app, value) {
  if (value) localStorage.setItem(lsKey(app), JSON.stringify(value));
  else localStorage.removeItem(lsKey(app));
}

export async function renderImport(app) {
  const wrap = el('div', { class: 'content narrow' });
  wrap.append(el('h1', { text: 'Импорт' }));
  wrap.append(el('p', { class: 'muted', text: 'Забери историю из Last.fm, пока их API ещё отвечает. Ключ используется только в этом запросе и не сохраняется.' }));

  // ---------- Last.fm API ----------
  const lfmPanel = el('section', { class: 'panel' });
  lfmPanel.append(sectionHead('Last.fm API'));

  const userInput = el('input', {
    placeholder: 'имя на Last.fm', value: '', spellcheck: 'false', autocomplete: 'off',
  });
  if (app.profile?.username) userInput.value = app.profile.username;

  const keyInput = el('input', {
    placeholder: 'API key с last.fm/api', spellcheck: 'false', autocomplete: 'off', type: 'password',
  });

  const note = el('div', { class: 'hint' },
    el('p', {
      text: 'Ключ создаётся на last.fm/api/account/create. С 1 декабря новые ключи требуют Pro, поэтому забирай историю сейчас.',
    }),
    el('p', {
      text: 'Альтернатива без ключа: Last.fm → Settings → Export data. Получишь CSV, импортируй его ниже.',
    }),
  );

  const checkResult = el('div', { class: 'hint' });
  const progress = progressBar();
  const log = el('div', { class: 'import-log', role: 'status' });
  let stop = false;

  const checkButton = el('button', { class: 'button secondary', type: 'button', text: 'Проверить профиль' });
  const runButton = el('button', { class: 'button', type: 'button', text: 'Импортировать всё' });
  const stopButton = el('button', { class: 'button secondary hidden', type: 'button', text: 'Остановить' });

  const saved = readProgress(app);
  if (saved?.page && saved.totalPages && saved.page < saved.totalPages) {
    runButton.textContent = `Продолжить с ${saved.page + 1}-й страницы`;
  }

  checkButton.addEventListener('click', async () => {
    checkButton.disabled = true;
    checkResult.textContent = 'Проверяю…';
    try {
      const data = await functionCall(
        `/lastfm?mode=info&lastfmUser=${encodeURIComponent(userInput.value.trim())}&apiKey=${encodeURIComponent(keyInput.value.trim())}`,
      );
      const info = data.info;
      checkResult.textContent = `${info.realname || info.name} · ${num(info.playcount)} скробблов · создан ${info.registered?.['#text'] ? new Date(Number(info.registered['#text']) * 1000).toLocaleDateString('ru-RU') : '—'}`;
      const avatar = info.image?.find((i) => i.size === 'large')?.['#text'];
      if (avatar && !app.profile?.avatar_url) {
        checkResult.append(el('br'), el('span', { class: 'muted', text: `Аватар: ${avatar}` }));
      }
    } catch (error) {
      checkResult.textContent = error.message;
    } finally {
      checkButton.disabled = false;
    }
  });

  runButton.addEventListener('click', async () => {
    const lastfmUser = userInput.value.trim();
    const apiKey = keyInput.value.trim();
    if (!lastfmUser || !apiKey) {
      log.textContent = 'Нужны имя и API key.';
      return;
    }
    runButton.disabled = true;
    checkButton.disabled = true;
    stop = false;
    stopButton.classList.remove('hidden');
    log.textContent = '';
    const state = readProgress(app) ?? { page: 0, totalPages: 0, imported: 0 };
    const leaving = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', leaving);

    try {
      const infoData = await functionCall(
        `/lastfm?mode=info&lastfmUser=${encodeURIComponent(lastfmUser)}&apiKey=${encodeURIComponent(apiKey)}`,
      );
      const info = infoData.info;
      log.textContent = `Профиль: ${info.name}. Всего на Last.fm: ${num(info.playcount)}.`;

      // профиль (имя/аватар) — если пусто
      const patch = {};
      if (!app.profile?.display_name || app.profile.display_name === app.profile.username) {
        if (info.realname) patch.display_name = info.realname;
      }
      const avatar = info.image?.find((i) => i.size === 'extralarge')?.['#text']
        || info.image?.find((i) => i.size === 'large')?.['#text'];
      if (avatar && !app.profile?.avatar_url) patch.avatar_url = avatar;
      if (info.country && !app.profile?.country) patch.country = info.country;
      if (Object.keys(patch).length) {
        await supabase.from('profiles').update(patch).eq('id', app.profile.id);
      }

      // ---- скробблы ----
      let page = state.page ?? 0;
      let totalPages = state.totalPages ?? 1;
      let imported = state.imported ?? 0;
      let ignored = 0;
      let remoteTotal = null;

      while (!stop && page < totalPages) {
        page += 1;
        const data = await functionCall(
          `/lastfm?mode=recent&lastfmUser=${encodeURIComponent(lastfmUser)}&apiKey=${encodeURIComponent(apiKey)}&page=${page}&limit=200`,
        );
        totalPages = data.totalPages || totalPages;
        if (remoteTotal === null) remoteTotal = data.total ?? 0;
        if (data.items?.length) {
          const result = await functionCall('/import', {
            method: 'POST',
            body: { items: data.items, source: 'import' },
          });
          imported += result.accepted ?? 0;
          ignored += result.ignored ?? 0;
        }
        progress.set((page / totalPages) * 100);
        log.textContent = `Страница ${page} из ${totalPages} · принято ${num(imported)}`;
        writeProgress(app, { page, totalPages, imported, lastfmUser });
      }

      if (!stop) {
        // ---- любимые треки ----
        let lovedPage = 1;
        let lovedTotal = 1;
        let lovedCount = 0;
        while (lovedPage <= lovedTotal) {
          const data = await functionCall(
            `/lastfm?mode=loved&lastfmUser=${encodeURIComponent(lastfmUser)}&apiKey=${encodeURIComponent(apiKey)}&page=${lovedPage}&limit=200`,
          );
          lovedTotal = data.totalPages || 1;
          for (const item of data.items ?? []) {
            const ts = new Date(Number(item.played_at) * 1000).toISOString();
            await supabase.from('track_loves').upsert({
              user_id: app.profile.id,
              artist: item.artist,
              track: item.track,
              loved_at: ts,
            }, { onConflict: 'user_id,artist,track' });
            lovedCount += 1;
          }
          lovedPage += 1;
        }
        if (imported === 0 && (remoteTotal ?? 0) === 0) {
          log.textContent = `Last.fm отдал пустую историю скробблов при ${num(info.playcount)} в профиле — любимые треки импортированы (${num(lovedCount)}), скробблы нет. Обычно это настройка приватности: Last.fm → Settings → Privacy → «Hide real-time listening data» должна быть выключена. Либо ключ без Pro после 1 декабря видит не всё — тогда CSV-экспорт ниже.`;
        } else {
          log.textContent = `Готово. Импортировано ${num(imported)} скробблов${ignored ? `, отклонено ${num(ignored)}` : ''} и ${num(lovedCount)} любимых треков.`;
        }
        progress.set(100);
        writeProgress(app, null);
      } else {
        log.textContent = `Остановлено на странице ${page}. Прогресс сохранён — можно продолжить позже.`;
      }
    } catch (error) {
      log.textContent = `Ошибка: ${error.message}`;
    } finally {
      window.removeEventListener('beforeunload', leaving);
      runButton.disabled = false;
      checkButton.disabled = false;
      stopButton.classList.add('hidden');
      runButton.textContent = 'Импортировать всё';
    }
  });

  stopButton.addEventListener('click', () => { stop = true; });

  lfmPanel.append(
    el('div', { class: 'grid-2' },
      el('label', { class: 'field' }, el('span', { text: 'Профиль Last.fm' }), userInput),
      el('label', { class: 'field' }, el('span', { text: 'API key' }), keyInput),
    ),
    el('div', { class: 'button-row' }, checkButton, runButton, stopButton),
    el('p', { class: 'hint', text: 'Импорт идёт в этой вкладке — не закрывай её. Если оборвётся, прогресс сохранён: кнопка станет «Продолжить».' }),
    checkResult,
    progress.bar,
    log,
    note,
  );
  wrap.append(lfmPanel);

  // ---------- CSV ----------
  const csvPanel = el('section', { class: 'panel' });
  csvPanel.append(sectionHead('CSV из Last.fm'));
  const fileInput = el('input', { type: 'file', accept: '.csv,.json,text/csv,application/json' });
  const csvLog = el('div', { class: 'import-log', role: 'status' });
  const csvButton = el('button', { class: 'button secondary', type: 'button', text: 'Импортировать CSV' });
  const csvProgress = progressBar();

  csvButton.addEventListener('click', async () => {
    const file = fileInput.files?.[0];
    if (!file) {
      csvLog.textContent = 'Выбери файл.';
      return;
    }
    csvButton.disabled = true;
    try {
      const text = await file.text();
      let scrobbles;
      if (file.name.toLowerCase().endsWith('.json') || text.trimStart().startsWith('{')) {
        const parsed = JSON.parse(text);
        const list = Array.isArray(parsed) ? parsed : parsed.scrobbles;
        if (!Array.isArray(list)) throw new Error('В JSON нет массива scrobbles.');
        scrobbles = list.map((item) => ({
          artist: item.artist,
          album: item.album ?? null,
          album_artist: item.album_artist ?? null,
          track: item.track ?? item.title ?? item.name,
          duration: item.duration ?? null,
          played_at: item.played_at ?? item.uts ?? item.timestamp,
        })).filter((item) => item.artist && item.track && item.played_at);
      } else {
        scrobbles = parseScrobblesCsv(text);
      }
      csvLog.textContent = `Найдено строк: ${num(scrobbles.length)}. Загружаю…`;
      let accepted = 0;
      for (let i = 0; i < scrobbles.length; i += 1000) {
        const batch = scrobbles.slice(i, i + 1000).map((s) => ({
          ...s,
          played_at: s.played_at,
        }));
        const result = await functionCall('/import', {
          method: 'POST',
          body: { items: batch, source: 'csv' },
        });
        accepted += result.accepted ?? 0;
        csvProgress.set((accepted / scrobbles.length) * 100);
        csvLog.textContent = `Загружено ${num(accepted)} из ${num(scrobbles.length)}…`;
      }
      csvLog.textContent = `Готово: ${num(accepted)} строк.`;
      csvProgress.set(100);
    } catch (error) {
      csvLog.textContent = `Ошибка: ${error.message}`;
    } finally {
      csvButton.disabled = false;
    }
  });

  csvPanel.append(
    el('label', { class: 'field' }, el('span', { text: 'Файл экспорта' }), fileInput),
    el('div', { class: 'button-row' }, csvButton),
    csvProgress.bar,
    csvLog,
    el('div', { class: 'hint' },
      el('p', { text: 'Понимаю колонки artist / track / uts (или timestamp/date). Остальные игнорирую.' }),
    ),
  );
  wrap.append(csvPanel);

  return wrap;
}
