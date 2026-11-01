/** Общее состояние приложения и чистые хелперы над данными. */

export const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6', '#64748b', '#84cc16'];
export const TYPE_LABELS = {
  text: 'Текст', longtext: 'Длинный текст', number: 'Число', date: 'Дата', select: 'Список',
  multiselect: 'Мультисписок', person: 'Человек', checkbox: 'Флажок', url: 'Ссылка',
};
export const AUTO_ARCHIVE = [0, 7, 14, 30, 60, 90];
export const HIDE_DONE = [[0, 'Всегда показывать'], [1, 'Сутки'], [3, '3 дня'], [7, 'Неделю'], [14, '2 недели'], [30, 'Месяц']];
/** Тип колонки: определяет цвет по умолчанию и смысл («готово» — для прогресса и просрочек). */
export const KINDS = ['todo', 'progress', 'done'];
export const KIND_LABELS = { todo: 'Не начато', progress: 'В работе', done: 'Готово' };
export const KIND_COLORS = { todo: 'var(--st-todo)', progress: 'var(--st-progress)', done: 'var(--st-done)' };
/** Тип карточки: запрос CEO по приложению (метка на доске); этапы и обычные задачи — без метки. */
export const TASK_KINDS = {
  request: { label: 'Запрос CEO', plural: 'Запросы CEO', short: 'Запрос', color: '#0ea5e9', icon: 'zap' },
};
export const KIND_ICONS = { todo: 'circle', progress: 'progress', done: 'done' };

/** localStorage с защитой от приватного режима и битых значений. */
export const LS = {
  get(k, d) { try { const v = localStorage.getItem('tm.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tm.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

/** Вид доски (фильтры и дорожки) — у каждого юнита свой, запоминается в браузере; поиск по тексту не храним. */
export function loadBoardView(unitId) {
  const v = (LS.get('boardView', {}) || {})[unitId] || {};
  S.filters = { ...freshFilters(), ...(v.filters || {}), q: '' };
  S.lanes = v.lanes === true || v.lanes === 'kind' || v.lanes === 'app' ? v.lanes : false;
}
export function saveBoardView(unitId) {
  const all = LS.get('boardView', {}) || {};
  const { q, ...filters } = S.filters;
  all[unitId] = { filters, lanes: S.lanes };
  LS.set('boardView', all);
}
export const freshFilters = () => ({ q: '', assignees: [], depts: [], overdue: false, archived: false, opts: [], app: '' });

export const S = {
  units: [],
  people: [],
  departments: [],          // общий справочник отделов
  teams: [],                // команды людей (Product Team, UX/UI Designers…)
  linkFields: [],           // поля-ссылки карточки (Figma, GitHub…), общие для всех юнитов
  templates: [],            // шаблоны задач (общие)
  apps: [],                 // приложения (сущности): юнит, статус
  appStatuses: [],          // настраиваемые статусы приложения { id, name, color, kind }
  appInfoItems: [],         // общие пункты Info приложения: { id, name }; отметки — apps.checks
  appFields: [],            // поля приложения (быстрый доступ): { id, name, kind: link | text }
  priorityOptions: [],      // варианты общего «Приоритета» (от низкого к высокому) — у задач и приложений
  realMeId: '',             // режим разработчика: кто вошёл на самом деле (meId — «смотрю как»)
  session: null,            // сессия Supabase Auth (в локальном режиме — null)
  board: null,              // { unit, fields, tasks, units, people }
  route: { view: 'home' },  // { view } | { unit, mode: board|list|settings, task }
  filters: freshFilters(),
  quick: { status: null, dept: null, text: '' },
  lanes: false,             // дорожки на доске: false | true (по отделам) | 'kind' (по типу) — у каждой доски свои
  collapsedLanes: new Set(),
  panelTaskId: null,
  listSort: { key: 'status', dir: 1 },
  showOldDone: '',
  notes: [],                // непрочитанные уведомления («на вас назначили задачу»)
  unread: 0,          // юнит, где сейчас показаны давно выполненные
  showArchivedUnits: false,
  meId: LS.get('meId', ''),
};

export const unitById = id => S.units.find(u => u.id === id);
export const taskById = id => (S.board ? S.board.tasks.find(t => t.id === id) : null);
export const personById = id => (id ? S.people.find(p => p.id === id) : null);
export const activePeople = () => S.people.filter(p => p.active);
export const me = () => personById(S.meId);
/** Имя автора/участника истории; кого удалили из системы — «Удалённый сотрудник». */
export const whoName = id => { const p = personById(id); return p ? p.name : id ? 'Удалённый сотрудник' : 'Система'; };

/* ---------- роли ---------- */
/** Роли: внутренние значения в базе прежние, в интерфейсе — CEO / PM / RM / Lead / сотрудник. */
export const ACCESS_LABELS = { superadmin: 'CEO', moderator: 'PM', rm: 'RM', lead: 'Lead', member: 'Сотрудник' };
export const ACCESS_HINTS = {
  superadmin: 'Всё: приложения, приоритеты, задачи PM, роли и доступы',
  moderator: 'Свои юниты: запросы CEO, этапы, команда, релиз',
  rm: 'Релизы своих юнитов — после всех этапов разработки',
  lead: 'Свои задачи и ревью своей позиции',
  member: 'Свои задачи в своих юнитах',
};
export const REQUEST_TYPES = { new_app: 'New App', update: 'Апдейт', other: 'Задача' };
export const myAccess = () => (me() || {}).access || 'member';
/** «Приложения» видят CEO, PM, RM и лиды; сотрудникам — нет. */
export const seesApps = () => ['superadmin', 'moderator', 'rm', 'lead'].includes(myAccess());
/** Модератор или супер-админ: управляет юнитами, задачами и людьми. */
export const isStaff = () => ['superadmin', 'moderator'].includes(myAccess());
/** Только CEO (супер-админ): роли и доступы, приложения. */
export const isSuper = () => myAccess() === 'superadmin';
/** Режим CEO: default — только приложения и верхний уровень; admin — всё. Хранится в профиле. */
export const ceoMode = () => (isSuper() ? ((me() || {}).prefs || {}).ceoMode === 'admin' ? 'admin' : 'default' : '');
/** CEO в режиме Default: без юнитов, досок и панели админа. */
export const ceoDefault = () => ceoMode() === 'default';
/** Режим разработчика — по тому, кто вошёл, а не за кого смотрит. */
export const isDev = () => !!(personById(S.realMeId || S.meId) || {}).isDev;
export const appById = id => (id ? S.apps.find(a => a.id === id) : null);
export const appStatusById = id => S.appStatuses.find(x => x.id === id) || null;
export const prioById = id => (id ? S.priorityOptions.find(o => o.id === id) : null);
/** Может ли текущий человек работать с задачей (свои задачи у участника). */
export const canEditTask = t => isStaff() || (!!S.meId && t.assigneeId === S.meId);
export const activeFields = () => (S.board ? S.board.fields.filter(f => !f.archived).sort(byOrder) : []);
export const columns = () => (S.board ? S.board.unit.settings.columns : []);
/** Колонка по id; неизвестный статус = первая колонка (как на сервере). */
export const colById = id => columns().find(c => c.id === id) || columns()[0];
export const colName = s => { const c = colById(s); return c ? c.name : s; };
export const colColor = c => (c ? c.color || KIND_COLORS[c.kind] : KIND_COLORS.todo);
export const taskDone = t => (t.statusKind ? t.statusKind === 'done' : (colById(t.status) || {}).kind === 'done');

export const LINK_KINDS = { figma: 'Figma', github: 'GitHub', drive: 'Google Drive', meta: 'Metadata', link: 'Ссылка' };
/** Поля-ссылки, которые видит текущий человек (то же правило проверяет база). */
export const visibleLinkFields = () => S.linkFields.filter(f => !f.archived
  && (isStaff() || !f.positions.length || (me() && (me().positionIds || []).some(id => f.positions.includes(id))))).sort(byOrder);

export const activeTeams = () => S.teams.filter(t => !t.archived).sort(byOrder);
export const teamById = id => (id ? S.teams.find(t => t.id === id) : null);
export const activeDepts = () => S.departments.filter(d => !d.archived).sort(byOrder);
export const deptById = id => (id ? S.departments.find(d => d.id === id) : null);
/** Участники текущего юнита: [{ personId, departmentId }]. */
export const members = () => (S.board ? S.board.members : []);
export const memberOf = personId => members().find(m => m.personId === personId);
export const taskKey = t => (t._temp ? '…' : S.board.unit.key + '-' + t.num);
/** Поле-приоритет юнита (одно): варианты по порядку — от низкого к высокому. */
export const priorityField = () => activeFields().find(f => f.role === 'priority' && f.type === 'select');
/** Приоритет задачи: { opt, rank 0…1, top } или null, если не задан. */
export function priorityOf(t, f = priorityField()) {
  if (!f || !t.fields) return null;
  const opts = f.options || [];
  const i = opts.findIndex(o => o.id === t.fields[f.id]);
  if (i < 0) return null;
  return { opt: opts[i], rank: opts.length > 1 ? i / (opts.length - 1) : 1, top: i === opts.length - 1 && opts.length > 1 };
}
/** Сортировка в колонке: сначала выше приоритет, потом ручной порядок. */
export function byPriority() {
  const f = priorityField();
  const r = t => { const p = priorityOf(t, f); return p ? p.rank : -1; };
  return (a, b) => r(b) - r(a) || a.order - b.order;
}
export const isEmpty = v => v == null || v === '' || (Array.isArray(v) && !v.length);
const colIdx = id => columns().findIndex(c => c.id === id);
/** Нужно ли поле для переноса в колонку status: с колонки requiredFrom и правее; без колонки (или её удалили) — для любого переноса. Как в базе. */
export const requiredIn = (f, status) => f.required && (!f.requiredFrom || colIdx(f.requiredFrom) < 0 || colIdx(status) >= colIdx(f.requiredFrom));
/** Пустые поля, без которых задачу не перенести в колонку status. */
export const missingFor = (t, status) => activeFields().filter(f => requiredIn(f, status) && isEmpty(t.fields[f.id]));
/** Что мешает перенести задачу в следующую колонку. */
export const missingNext = t => { const next = columns()[colIdx(t.status) + 1]; return next ? missingFor(t, next.id) : []; };
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
  // как в макете: «14 дек.», другой год — «14 дек. 2025»
  const mon = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'][Number(m[2]) - 1];
  return `${Number(m[3])} ${mon}${sameYear && !withYear ? '' : ' ' + m[1]}`;
}

export function fmtDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** В сети: пульс был за последние 2,5 минуты (приложение шлёт его раз в минуту). */
export const isOnline = p => !!(p && p.lastSeenAt && Date.now() - Date.parse(p.lastSeenAt) < 150e3);
export const presenceText = p => (isOnline(p) ? 'в сети' : p && p.lastSeenAt ? 'был(а) в сети ' + relTime(p.lastSeenAt) : 'ещё не заходил(а)');

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

/** Заголовок дашборда: «Пятница, 1 ноября». */
export function todayLabel() {
  const t = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
export function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}
