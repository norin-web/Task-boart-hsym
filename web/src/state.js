/** Общее состояние приложения и чистые хелперы над данными. */

export const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6', '#64748b', '#84cc16'];
export const TYPE_LABELS = {
  text: 'Текст', longtext: 'Длинный текст', number: 'Число', date: 'Дата', select: 'Список',
  multiselect: 'Мультисписок', person: 'Человек', checkbox: 'Флажок', url: 'Ссылка',
};
export const AUTO_ARCHIVE = [0, 7, 14, 30, 60, 90];
/** Тип колонки: определяет цвет по умолчанию и смысл («готово» — для прогресса и просрочек). */
export const KINDS = ['todo', 'progress', 'done'];
export const KIND_LABELS = { todo: 'Не начато', progress: 'В работе', done: 'Готово' };
export const KIND_COLORS = { todo: 'var(--st-todo)', progress: 'var(--st-progress)', done: 'var(--st-done)' };
export const KIND_ICONS = { todo: 'circle', progress: 'progress', done: 'done' };

/** localStorage с защитой от приватного режима и битых значений. */
export const LS = {
  get(k, d) { try { const v = localStorage.getItem('tm.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tm.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

export const freshFilters = () => ({ q: '', assignees: [], depts: [], overdue: false, archived: false, opts: [] });

export const S = {
  units: [],
  people: [],
  departments: [],          // общий справочник отделов
  session: null,            // сессия Supabase Auth (в локальном режиме — null)
  board: null,              // { unit, fields, tasks, units, people }
  route: { view: 'home' },  // { view } | { unit, mode: board|list|settings, task }
  filters: freshFilters(),
  quick: { status: null, dept: null, text: '' },
  lanes: LS.get('lanes', false),   // дорожки по отделам на доске
  collapsedLanes: new Set(),
  panelTaskId: null,
  listSort: { key: 'status', dir: 1 },
  showArchivedUnits: false,
  meId: LS.get('meId', ''),
};

export const unitById = id => S.units.find(u => u.id === id);
export const taskById = id => (S.board ? S.board.tasks.find(t => t.id === id) : null);
export const personById = id => (id ? S.people.find(p => p.id === id) : null);
export const activePeople = () => S.people.filter(p => p.active);
export const me = () => personById(S.meId);
export const activeFields = () => (S.board ? S.board.fields.filter(f => !f.archived).sort(byOrder) : []);
export const columns = () => (S.board ? S.board.unit.settings.columns : []);
/** Колонка по id; неизвестный статус = первая колонка (как на сервере). */
export const colById = id => columns().find(c => c.id === id) || columns()[0];
export const colName = s => { const c = colById(s); return c ? c.name : s; };
export const colColor = c => (c ? c.color || KIND_COLORS[c.kind] : KIND_COLORS.todo);
export const taskDone = t => (t.statusKind ? t.statusKind === 'done' : (colById(t.status) || {}).kind === 'done');

export const activeDepts = () => S.departments.filter(d => !d.archived).sort(byOrder);
export const deptById = id => (id ? S.departments.find(d => d.id === id) : null);
/** Участники текущего юнита: [{ personId, departmentId }]. */
export const members = () => (S.board ? S.board.members : []);
export const memberOf = personId => members().find(m => m.personId === personId);
export const taskKey = t => (t._temp ? '…' : S.board.unit.key + '-' + t.num);
export const isEmpty = v => v == null || v === '' || (Array.isArray(v) && !v.length);
export const optById = (f, id) => (f.options || []).find(o => o.id === id);
export const maxOrder = list => list.reduce((m, x) => Math.max(m, Number(x.order) || 0), 0);
export const byOrder = (a, b) => (a.order || 0) - (b.order || 0);
export const emptyCounts = () => ({ todo: 0, in_progress: 0, done: 0, overdue: 0 });
export const openCount = u => (u.counts ? u.counts.todo + u.counts.in_progress : 0);

export function setMe(id) {
  S.meId = id || '';
  LS.set('meId', S.meId);
}

/** Порядок между двумя соседями для drag & drop (дробные значения). */
export function between(a, b) {
  if (a == null && b == null) return 1;
  if (a == null) return b - 1;
  if (b == null) return a + 1;
  return (a + b) / 2;
}

/* ---------- даты ---------- */

const pad = n => String(n).padStart(2, '0');
export const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = () => isoDate(new Date());
export const addDays = (n, from = new Date()) => { const d = new Date(from); d.setDate(d.getDate() + n); return isoDate(d); };

function daysFromToday(s) {
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d) - t) / 864e5);
}

export function fmtDate(s, withYear) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  if (!m) return String(s || '');
  const sameYear = Number(m[1]) === new Date().getFullYear();
  return `${m[3]}.${m[2]}${sameYear && !withYear ? '' : '.' + m[1]}`;
}

export function fmtDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function relTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const s = (Date.now() - d) / 1000;
  if (s < 45) return 'только что';
  if (s < 3600) return Math.round(s / 60) + ' мин назад';
  if (s < 86400) return Math.round(s / 3600) + ' ч назад';
  if (s < 86400 * 7) { const n = Math.round(s / 86400); return n === 1 ? 'вчера' : n + ' ' + plural(n, ['день', 'дня', 'дней']) + ' назад'; }
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

/** Подпись и оттенок для срока задачи. */
export function dueInfo(due, done) {
  if (!due) return null;
  const n = daysFromToday(due);
  if (done) return { text: fmtDate(due), cls: 'done', hint: '' };
  if (n < 0) return { text: fmtDate(due), cls: 'overdue', hint: 'Просрочено на ' + -n + ' ' + plural(-n, ['день', 'дня', 'дней']) };
  if (n === 0) return { text: 'Сегодня', cls: 'soon', hint: 'Срок сегодня' };
  if (n === 1) return { text: 'Завтра', cls: 'soon', hint: 'Срок завтра' };
  if (n <= 3) return { text: fmtDate(due), cls: 'soon', hint: 'Через ' + n + ' ' + plural(n, ['день', 'дня', 'дней']) };
  return { text: fmtDate(due), cls: '', hint: 'Через ' + n + ' ' + plural(n, ['день', 'дня', 'дней']) };
}

export const isOverdue = (t, today = todayStr()) => !t.archived && !taskDone(t) && !!t.dueDate && t.dueDate < today;

/* ---------- текст ---------- */

export function plural(n, forms) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

export const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : null);

export function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
}

export function colorFor(str) {
  let x = 0;
  for (const ch of String(str)) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[x % PALETTE.length];
}

const TRANSLIT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };

/** Ключ юнита из названия: «Маркетинг и пиар» → MIP. */
export function suggestKey(name) {
  const lat = [...String(name).toLowerCase()].map(c => TRANSLIT[c] ?? c).join('');
  const words = lat.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(w => /^[A-Z]/.test(w));
  let key = words.length > 1 ? words.slice(0, 4).map(w => w[0]).join('') : (words[0] || '').slice(0, 4);
  if (key.length < 2) key = (key + 'UN').slice(0, 2);
  let out = key, i = 2;
  while (S.units.some(u => u.key === out)) out = key.slice(0, 10 - String(i).length) + i++;
  return out;
}

export function fmtValue(f, v) {
  if (isEmpty(v)) return '—';
  switch (f.type) {
    case 'select': return (optById(f, v) || { name: '?' }).name;
    case 'multiselect': return (Array.isArray(v) ? v : [v]).map(id => (optById(f, id) || { name: '?' }).name).join(', ');
    case 'person': return (personById(v) || { name: '?' }).name;
    case 'checkbox': return v ? 'да' : 'нет';
    case 'date': return fmtDate(v, true);
    default: return String(v);
  }
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}
