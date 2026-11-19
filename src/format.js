// Форматирование, безопасный HTML и парсинг дат. Без DOM-зависимостей.

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

const nf = new Intl.NumberFormat('ru-RU');

export function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? nf.format(n) : '0';
}

export function plural(n, one, few, many) {
  const abs = Math.abs(Number(n)) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

export function plays(n) {
  return `${num(n)} ${plural(n, 'прослушивание', 'прослушивания', 'прослушиваний')}`;
}

export function artistPlays(n) {
  return `${num(n)} ${plural(n, 'артист', 'артиста', 'артистов')}`;
}

export function timeAgo(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Math.max(0, Date.now() - date.getTime()) / 1000;
  if (diff < 45) return 'только что';
  if (diff < 3600) {
    const m = Math.round(diff / 60);
    return `${m} ${plural(m, 'минуту', 'минуты', 'минут')} назад`;
  }
  if (diff < 86400) {
    const h = Math.round(diff / 3600);
    return `${h} ${plural(h, 'час', 'часа', 'часов')} назад`;
  }
  if (diff < 86400 * 30) {
    const d = Math.round(diff / 86400);
    return `${d} ${plural(d, 'день', 'дня', 'дней')} назад`;
  }
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fullDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function shortDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function periodLabel(period) {
  return {
    overall: 'за всё время',
    '7day': 'за неделю',
    '1month': 'за месяц',
    '3month': 'за 3 месяца',
    '6month': 'за 6 месяцев',
    '12month': 'за год',
  }[period] ?? 'за всё время';
}

export function periodSince(period) {
  const days = { '7day': 7, '1month': 30, '3month': 91, '6month': 182, '12month': 365 }[period];
  if (!days) return null;
  return new Date(Date.now() - days * 86400_000).toISOString();
}

export function initials(value) {
  return String(value ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function hashString(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function hueFor(value) {
  return hashString(String(value).toLowerCase()) % 360;
}
