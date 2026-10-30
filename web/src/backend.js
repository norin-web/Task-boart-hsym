/**
 * Бизнес-логика поверх Supabase (Postgres). Работает в браузере.
 * createBackend(client) принимает клиент supabase-js (в тестах — совместимый адаптер над PGlite).
 * Все методы асинхронные: (payload, ctx) → данные; ctx.actorId — id человека, от чьего имени действие.
 */

/** Тип колонки: не начато / в работе / готово. Свои колонки встают между ними. */
export const KINDS = ['todo', 'progress', 'done'];
const KIND_COUNT_KEY = { todo: 'todo', progress: 'in_progress', done: 'done' };
export const FIELD_TYPES = ['text', 'longtext', 'number', 'date', 'select', 'multiselect', 'person', 'checkbox', 'url'];
/** Тип карточки: '' — задача; request — запрос CEO по приложению; stage — этап декомпозиции запроса. */
export const TASK_KINDS = ['', 'request', 'stage'];
/** Запросы CEO по приложению. */
export const REQUEST_TYPES = { new_app: 'New App', update: 'Апдейт', other: 'Задача' };

/**
 * Флоу декомпозиции запроса по умолчанию: этапы с позицией и зависимостями. Следующий этап виден сразу,
 * но заблокирован (база не даст сдвинуть его из «не начато»), пока не закрыты те, от которых он зависит.
 * release — последний: исполнителя нет, пока PM не передаст его RM («Передать в релиз»).
 */
export const DEFAULT_FLOWS = {
  new_app: [
    { key: 'design', title: 'Дизайн', positionId: 'd_design', dependsOn: [] },
    { key: 'ios', title: 'Разработка iOS', positionId: 'd_ios', dependsOn: ['design'] },
    { key: 'qa', title: 'Тестирование', positionId: 'd_qa', dependsOn: ['ios'] },
    { key: 'meta', title: 'Мета (ASO)', positionId: 'd_aso', dependsOn: [] },
    { key: 'release', title: 'Релиз', positionId: 'd_release', dependsOn: ['design', 'ios', 'qa', 'meta'], release: true },
  ],
  update: [
    { key: 'design', title: 'Дизайн', positionId: 'd_design', dependsOn: [] },
    { key: 'ios', title: 'Разработка iOS', positionId: 'd_ios', dependsOn: ['design'] },
    { key: 'qa', title: 'Тестирование', positionId: 'd_qa', dependsOn: ['ios'] },
    { key: 'release', title: 'Релиз', positionId: 'd_release', dependsOn: ['design', 'ios', 'qa'], release: true },
  ],
  other: [],
};
/** Статусы приложения по умолчанию (настраиваются; kind связывает статус с ходом работ). */
export const APP_STATUS_KINDS = ['dev', 'release', 'review', 'live', 'reject', ''];
/** Общее поле «Приоритет» (создаёт schema.sql): им же задаётся приоритет приложений и запросов CEO. */
const PRIORITY_FIELD = 'f_priority';
export const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6', '#64748b', '#84cc16'];

export function defaultSettings() {
  return {
    columns: [
      { id: 'todo', name: 'To Do', kind: 'todo', color: '' },
      { id: 'in_progress', name: 'In Progress', kind: 'progress', color: '' },
      { id: 'review', name: 'Review', kind: 'progress', color: '' },
      { id: 'done', name: 'Done', kind: 'done', color: '' },
    ],
    builtins: {
      title:       { label: 'Название',    hideable: false, hidden: false },
      status:      { label: 'Статус',      hideable: false, hidden: false },
      assignee:    { label: 'Исполнитель', hideable: true,  hidden: false },
      department:  { label: 'Позиция',     hideable: true,  hidden: false },
      dueDate:     { label: 'Срок',        hideable: true,  hidden: false },
      description: { label: 'Описание',    hideable: true,  hidden: false },
    },
    autoArchiveDays: 0,
    hideDoneDays: 0, // сколько дней держать выполненные на доске и в списке (0 — всегда)
    checklistBeforeDone: false, // участник не перенесёт в «готово», пока чеклист не закрыт
  };
}

/** Свои поля нового юнита. Приоритет — общее поле на все юниты (создаёт schema.sql). */
function defaultFields() {
  return [];
}

export class ApiError extends Error {
  constructor(message, code = 'ERROR', data = null) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

const fail = (message, code, data) => { throw new ApiError(message, code, data); };

/* ---------- чистые хелперы ---------- */

let lastTs = 0;
/** Монотонное время: две записи подряд никогда не получат одинаковый updatedAt. */
function now() {
  let t = Date.now();
  if (t <= lastTs) t = lastTs + 1;
  lastTs = t;
  return new Date(t).toISOString();
}

const uid = prefix => prefix + '_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const color = (c, fallback) => (/^#[0-9a-fA-F]{6}$/.test(c || '') ? c : fallback);
const date = v => { const s = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; };
const today = d => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : new Date().toISOString().slice(0, 10));
const req = (v, label) => v || fail(`Поле «${label}» обязательно`);
const json = (v, fallback) => {
  if (v && typeof v === 'object') return v;
  try { return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};
const fmtDate = d => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? `${m[3]}.${m[2]}.${m[1]}` : ''; };
const emptyCounts = () => ({ todo: 0, in_progress: 0, done: 0, overdue: 0 });

/** Колонка задачи; неизвестный статус (колонку удалили) считается первой колонкой. */
const columnOf = (settings, status) => settings.columns.find(c => c.id === status) || settings.columns[0];
const kindOf = (settings, status) => columnOf(settings, status).kind;

function normKey(k) {
  k = String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  return /^[A-Z][A-Z0-9]{1,9}$/.test(k) ? k : '';
}

/**
 * Ревью: колонка ревью и ревьюеры (по позиции задачи и по умолчанию). Пока не настраивали — колонка с названием
 * Review/Ревью, ревьюеров нет (автоназначение выключено). Применяет триггер review_assign в базе.
 */
function reviewSettings(r, columns) {
  const ids = new Set(columns.map(c => c.id));
  const guess = (columns.find(c => /review|ревью/i.test(c.name)) || {}).id || '';
  const column = r && typeof r === 'object' && 'column' in r ? (ids.has(r.column) ? r.column : '') : guess;
  const byPosition = {};
  for (const [k, v] of Object.entries((r && r.byPosition) || {})) {
    if (/^[\w-]{1,40}$/.test(k) && v) byPosition[k] = str(v, 40);
  }
  return { column, byPosition, default: str(r && r.default, 40) };
}

export function unitSettings(raw) {
  const s = json(raw, {}) || {};
  const d = defaultSettings();
  const builtins = s.builtins || {};
  // Колонки: свой набор в каждом юните. Старые настройки без kind получают тип по id.
  const seen = new Set();
  let columns = (Array.isArray(s.columns) ? s.columns : []).slice(0, 20).map(c => {
    if (!c || !/^[a-z0-9_]{1,40}$/.test(c.id || '') || seen.has(c.id)) return null;
    seen.add(c.id);
    const def = d.columns.find(x => x.id === c.id);
    return {
      id: c.id,
      name: str(c.name, 40) || (def ? def.name : 'Колонка'),
      kind: KINDS.includes(c.kind) ? c.kind : def ? def.kind : 'progress',
      color: color(c.color, ''),
    };
  }).filter(Boolean);
  if (!columns.length) columns = d.columns;
  return {
    columns,
    builtins: Object.fromEntries(Object.entries(d.builtins).map(([k, def]) => {
      const cur = builtins[k] || {};
      const label = str(cur.label, 40);
      return [k, { label: (k === 'department' && label === 'Отдел' ? '' : label) || def.label, hideable: def.hideable, hidden: def.hideable ? !!cur.hidden : false }];
    })),
    autoArchiveDays: Math.max(0, Math.min(365, parseInt(s.autoArchiveDays, 10) || 0)),
    hideDoneDays: Math.max(0, Math.min(365, parseInt(s.hideDoneDays, 10) || 0)),
    review: reviewSettings(s.review, columns),
    checklistBeforeDone: !!s.checklistBeforeDone,
    // свой флоу юнита по типам запроса (нет типа — флоу студии по умолчанию)
    flows: Object.fromEntries(Object.keys(REQUEST_TYPES).filter(k => s.flows && Array.isArray(s.flows[k])).map(k => [k, cleanFlow(s.flows[k])])),
  };
}

function storedSettings(s) {
  const full = unitSettings(s);
  return {
    columns: full.columns.map(({ id, name, kind, color: c }) => ({ id, name, kind, color: c })),
    builtins: Object.fromEntries(Object.entries(full.builtins).map(([k, v]) => [k, { label: v.label, hidden: v.hidden }])),
    autoArchiveDays: full.autoArchiveDays,
    hideDoneDays: full.hideDoneDays,
    review: full.review,
    checklistBeforeDone: full.checklistBeforeDone,
    flows: full.flows,
  };
}

function cleanOptions(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  return arr.slice(0, 100).map(o => {
    const name = str(o && o.name, 60);
    if (!name) return null;
    let id = /^o_[a-z0-9_]{1,40}$/.test(o.id || '') ? o.id : uid('o');
    if (seen.has(id)) id = uid('o');
    seen.add(id);
    return { id, name, color: color(o.color, '#64748b') };
  }).filter(Boolean);
}

function cleanChecklist(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  return arr.slice(0, 100).map(i => {
    const text = str(i && i.text, 300);
    if (!text) return null;
    let id = /^k_[a-z0-9]{1,40}$/.test(i.id || '') ? i.id : uid('k');
    if (seen.has(id)) id = uid('k');
    seen.add(id);
    return { id, text, done: !!i.done };
  }).filter(Boolean);
}

/** Значения кастомных полей: ключ — id поля; пустое значение = удалить (null). */
function cleanFieldValues(obj, keepNulls) {
  const out = {};
  for (const [k, raw] of Object.entries(obj || {})) {
    if (!/^f_[a-z0-9]{1,40}$/.test(k)) continue;
    let v = raw;
    if (Array.isArray(v)) {
      v = v.map(x => str(x, 200)).filter(Boolean).slice(0, 50);
      if (!v.length) v = null;
    } else if (typeof v === 'string') v = str(v, 5000) || null;
    else if (typeof v === 'number') v = Number.isFinite(v) ? v : null;
    else if (typeof v !== 'boolean') v = null;
    if (v !== null || keepNulls) out[k] = v;
  }
  return out;
}

/* ---------- преобразование строк БД ---------- */

const unitOut = r => ({
  id: r.id, name: r.name, key: r.key, color: r.color, description: r.description,
  settings: unitSettings(r.settings), nextNum: r.next_num, order: r.ord, archived: !!r.archived,
  archivedAt: r.archived_at || '', createdAt: r.created_at, updatedAt: r.updated_at,
});

const taskOut = r => ({
  id: r.id, unitId: r.unit_id, num: r.num, title: r.title, description: r.description, status: r.status,
  assigneeId: r.assignee_id, departmentId: r.department_id || '', dueDate: r.due_date, order: r.ord,
  fields: json(r.fields, {}), checklist: json(r.checklist, []), archived: !!r.archived, doneAt: r.done_at,
  reviewFrom: r.review_from || '', reviewerId: r.reviewer_id || '', teamId: r.team_id || '', specUrl: r.spec_url || '',
  parentId: r.parent_id || '', kind: r.kind || '', startedAt: r.started_at || '',
  release: json(r.release, {}) || {},
  appId: r.app_id || '', requestType: r.request_type || '', step: r.step || '', dependsOn: json(r.depends_on, []) || [], isTest: !!r.is_test,
  createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
});

const fieldOut = r => ({
  id: r.id, unitId: r.unit_id || '', global: !r.unit_id, name: r.name, type: r.type, options: json(r.options, []),
  showOnCard: !!r.show_on_card, required: !!r.required, requiredFrom: r.required_from || '',
  staffOnly: !!r.staff_only, role: r.role || '', requiredOnCreate: !!r.required_on_create, order: r.ord, archived: !!r.archived,
});

/** Роли: superadmin — CEO, moderator — PM, rm — релиз-менеджер, lead — лид, member — сотрудник. */
export const ACCESS = ['superadmin', 'moderator', 'rm', 'lead', 'member'];
const personOut = r => ({
  id: r.id, name: r.name, email: r.email, role: r.role || '', color: r.color || '', active: !!r.active,
  access: r.access || 'member', positionId: r.position_id || '', linked: !!r.user_id, prefs: json(r.prefs, {}) || {},
  lastSeenAt: r.last_seen_at || '', isDev: !!r.is_dev,
  extraPositionIds: json(r.extra_positions, []) || [],
  teamIds: json(r.team_ids, []) || [],
  positionIds: [r.position_id || 'd_other', ...(json(r.extra_positions, []) || [])],
});
const teamOut = r => ({ id: r.id, name: r.name, color: r.color, order: r.ord, archived: !!r.archived, boardTemplate: cleanStages(json(r.board_template, [])) });

/** Этапы личной доски: колонки { id, name, kind: todo|progress|done, color }, до 12, хотя бы одна. */
function cleanStages(list) {
  const seen = new Set();
  const out = (Array.isArray(list) ? list : []).slice(0, 12).map((c, i) => {
    let id = /^[a-z0-9_]{1,40}$/.test((c && c.id) || '') ? c.id : 's' + (i + 1);
    while (seen.has(id)) id += '_';
    seen.add(id);
    return { id, name: str(c && c.name, 40) || 'Этап', kind: KINDS.includes(c && c.kind) ? c.kind : 'progress', color: color(c && c.color, '') };
  });
  return out;
}
/** Иконка приложения — только картинка Apple (mzstatic.com) по https; иначе пусто. */
const iconUrl = v => { const s = String(v || '').trim().slice(0, 500); return /^https:\/\/[\w.-]+\.mzstatic\.com\//.test(s) ? s : ''; };
const appOut = r => ({
  id: r.id, unitId: r.unit_id, name: r.name, color: r.color || '', status: r.status, info: json(r.info, {}) || {},
  priority: r.priority || '', statusAt: r.status_at || '', iconUrl: r.icon_url || '', storeName: r.store_name || '',
  storeOk: r.store_ok == null ? null : !!r.store_ok, storeCheckedAt: r.store_checked_at || '', checks: cleanChecks(r.checks), ownFields: cleanOwnFields(r.own_fields),
  order: r.ord, archived: !!r.archived, isTest: !!r.is_test, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
});

/** Релизные поля: { id, name, kind: text | longtext | link, required }. */
function cleanReleaseFields(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).slice(0, 30).map(x => {
    const name = str(x && x.name, 60);
    if (!name) return null;
    let id = /^[a-z0-9_]{1,40}$/.test((x && x.id) || '') ? x.id : uid('rf').toLowerCase();
    if (seen.has(id)) id = uid('rf').toLowerCase();
    seen.add(id);
    return { id, name, kind: ['text', 'longtext', 'link'].includes(x.kind) ? x.kind : 'text', required: !!x.required };
  }).filter(Boolean);
}
const cleanReleaseChecklist = list => (Array.isArray(list) ? list : []).map(x => str(x, 300)).filter(Boolean).slice(0, 40);

/** Поля приложения: { id, name, kind: link | text }. */
function cleanAppFields(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).slice(0, 30).map(x => {
    const name = str(x && x.name, 40);
    if (!name) return null;
    let id = /^[a-z0-9_]{1,40}$/.test((x && x.id) || '') ? x.id : uid('af').toLowerCase();
    if (seen.has(id)) id = uid('af').toLowerCase();
    seen.add(id);
    return { id, name, kind: x.kind === 'text' ? 'text' : 'link' };
  }).filter(Boolean);
}

/** Общие пункты Info приложения: { id, name } — у каждого приложения своя отметка. */
function cleanInfoItems(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).slice(0, 60).map(x => {
    const name = str(x && x.name, 120);
    if (!name) return null;
    let id = /^[a-z0-9_]{1,40}$/.test((x && x.id) || '') ? x.id : uid('ii').toLowerCase();
    if (seen.has(id)) id = uid('ii').toLowerCase();
    seen.add(id);
    return { id, name };
  }).filter(Boolean);
}
/** Отметки Info у приложения: done — id отмеченных общих пунктов, own — свои пункты приложения. */
function cleanChecks(v) {
  const c = json(v, {}) || {};
  const ids = new Set();
  return {
    done: [...new Set((Array.isArray(c.done) ? c.done : []).map(x => String(x)).filter(x => /^[\w-]{1,40}$/.test(x)))].slice(0, 100),
    own: (Array.isArray(c.own) ? c.own : []).slice(0, 50).map(x => {
      const name = str(x && x.name, 120);
      if (!name) return null;
      let id = /^[\w-]{1,40}$/.test((x && x.id) || '') ? x.id : uid('io').toLowerCase();
      if (ids.has(id)) id = uid('io').toLowerCase();
      ids.add(id);
      return { id, name, done: !!x.done };
    }).filter(Boolean),
  };
}

/** Свои поля «Быстрого доступа» у приложения: { id, name, kind, value }. */
function cleanOwnFields(v) {
  const ids = new Set();
  return (Array.isArray(json(v, [])) ? json(v, []) : []).slice(0, 30).map(x => {
    const name = str(x && x.name, 40);
    if (!name) return null;
    let id = /^[\w-]{1,40}$/.test((x && x.id) || '') ? x.id : uid('of').toLowerCase();
    if (ids.has(id)) id = uid('of').toLowerCase();
    ids.add(id);
    const kind = x.kind === 'text' ? 'text' : 'link';
    return { id, name, kind, value: kind === 'link' ? linkUrl(x.value) : str(x.value, 500) };
  }).filter(Boolean);
}

/** Статусы приложения: { id, name, color, kind }, хотя бы один. */
function cleanAppStatuses(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).slice(0, 20).map(x => {
    const name = str(x && x.name, 40);
    if (!name) return null;
    let id = /^[a-z0-9_]{1,40}$/.test((x && x.id) || '') ? x.id : uid('as').toLowerCase();
    if (seen.has(id)) id = uid('as').toLowerCase();
    seen.add(id);
    return { id, name, color: color(x.color, '#64748b'), kind: APP_STATUS_KINDS.includes(x.kind) ? x.kind : '' };
  }).filter(Boolean);
}

/** Флоу: этапы { key, title, positionId, dependsOn: [key], release }; зависимости — только на этапы выше по списку. */
function cleanFlow(list) {
  const keys = [];
  return (Array.isArray(list) ? list : []).slice(0, 20).map(x => {
    const key = /^[a-z0-9_]{1,30}$/.test((x && x.key) || '') && !keys.includes(x.key) ? x.key : null;
    const title = str(x && x.title, 120);
    if (!key || !title) return null;
    const step = { key, title, positionId: str(x.positionId, 40), dependsOn: (Array.isArray(x.dependsOn) ? x.dependsOn : []).filter(k => keys.includes(k)), release: !!x.release };
    keys.push(key);
    return step;
  }).filter(Boolean);
}
const deptOut = r => ({ id: r.id, name: r.name, color: r.color, order: r.ord, archived: !!r.archived });
export const LINK_KINDS = ['figma', 'github', 'drive', 'meta', 'link'];
const linkFieldOut = r => ({
  id: r.id, name: r.name, kind: r.kind, positions: json(r.positions, []) || [], order: r.ord, archived: !!r.archived,
});
/** Только http(s)-ссылки: javascript: и прочее не сохраняем. */
const linkUrl = v => {
  const u = str(v, 2000);
  if (!u) return '';
  const full = /^[a-z][\w+.-]*:/i.test(u) ? u : 'https://' + u;
  if (!/^https?:\/\/[^\s]+$/i.test(full)) fail('Нужна ссылка вида https://…');
  return full;
};
const templateOut = r => ({
  id: r.id, name: r.name, title: r.title, description: r.description, departmentId: r.department_id,
  dueDays: Number(r.due_days), checklist: json(r.checklist, []) || [], order: r.ord,
  assigneeId: r.assignee_id || '', links: json(r.links, {}) || {}, teamId: r.team_id || '',
});
const commentOut = r => ({ id: r.id, taskId: r.task_id, text: r.text, authorId: r.author_id, at: r.at, editedAt: r.edited_at });

/* ================= backend ================= */

/**
 * db — клиент supabase-js (или совместимый). opts.invoke(name, body) — вызов серверной функции Supabase
 * (управление аккаунтами); без неё (локальный режим) профили создаются напрямую.
 */
export function createBackend(db, opts = {}) {
  const T = name => db.from(name);
  const invoke = opts.invoke || null;

  async function run(query) {
    // Сразу после входа часы сервера базы могут отставать от сервера входа на пару секунд —
    // тогда свежий токен отклоняется («JWT issued at future»). Повторяем запрос с паузой.
    for (let attempt = 0; ; attempt++) {
      const { data, error } = await query;
      if (!error) return data;
      if (/issued at future/i.test(error.message || '') && attempt < 5) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      throw dbError(error);
    }
  }

  /** Ошибки прав и проверок базы — понятным текстом. */
  function dbError(error) {
    const m = error.message || 'Ошибка базы данных';
    if (error.code === '42501' || /row-level security|permission denied/i.test(m)) {
      return new ApiError(/^Недостаточно|^Роли|^Роль|^Email|^Профиль|^Привязку|^Нельзя/.test(m) ? m : 'Недостаточно прав для этого действия', 'FORBIDDEN');
    }
    if (error.code === 'P0001') return new ApiError(m, 'RULE');
    return new ApiError(m, 'DB');
  }

  /** Обновить одну строку; если её не видно или нет прав — ошибка, а не тихое «ничего не произошло». */
  async function updateOne(table, id, upd) {
    if (!Object.keys(upd).length) return;
    const rows = await run(T(table).update(upd).eq('id', id).select('id'));
    if (!rows.length) fail('Недостаточно прав для этого действия', 'FORBIDDEN');
  }
  const rpc = (fn, args) => run(db.rpc(fn, args));

  /** Все строки выборки: PostgREST отдаёт максимум 1000 за раз. */
  async function all(build) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const rows = await run(build().range(from, from + 999));
      out.push(...rows);
      if (rows.length < 1000) return out;
    }
  }

  const one = async (table, id) => run(T(table).select('*').eq('id', String(id ?? '')).maybeSingle());
  const findUnit = async id => (await one('units', id)) || fail('Юнит не найден', 'NOT_FOUND');
  const findTask = async id => (await one('tasks', id)) || fail('Задача не найдена', 'NOT_FOUND');
  const people = async () => (await all(() => T('people').select('*').order('name').order('id'))).map(personOut)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const teams = async () => (await all(() => T('teams').select('*').order('ord').order('id'))).map(teamOut);
  const validTeam = async id => (id && (await one('teams', id)) ? String(id) : '');
  const cleanTeams = async list => {
    const ids = new Set((await teams()).map(t => t.id));
    return [...new Set((Array.isArray(list) ? list : []).map(String))].filter(id => ids.has(id));
  };
  const departments = async () => (await all(() => T('departments').select('*').order('ord').order('id'))).map(deptOut);
  /** Поля юнита: сначала общие (на все юниты), потом свои. */
  const globalFields = async () => (await all(() => T('fields').select('*').is('unit_id', null).order('ord').order('id'))).map(fieldOut);
  const ownFields = async unitId => (await all(() => T('fields').select('*').eq('unit_id', unitId).order('ord').order('id'))).map(fieldOut);
  /**
   * Сводка по потомкам задач (вниз по иерархии, до 6 уровней): сколько всего, готово, просрочено,
   * и родитель каждой задачи (для «↑ App» на карточке). Возвращает { stats: {id → {total, done, overdue}}, parents: {id → brief} }.
   */
  async function treeInfo(tasks, day) {
    const stats = {}, parents = {};
    const withParent = tasks.filter(t => t.parent_id);
    const roots = tasks.map(t => t.id);
    if (!roots.length) return { stats, parents };
    const unitRows = await all(() => T('units').select('id,key,name,color,settings').order('id'));
    const U = Object.fromEntries(unitRows.map(u => [u.id, { ...u, st: unitSettings(u.settings) }]));
    // все потомки (без повторов) и дети каждого — затем у каждой задачи считаем своё поддерево
    const kids = {}, seen = new Set(roots);
    let level = roots;
    for (let depth = 1; level.length && depth <= 6; depth++) {
      const rows = (await run(T('tasks').select('id,parent_id,unit_id,status,due_date,archived').in('parent_id', level).order('id')))
        .filter(r => !seen.has(r.id) || roots.includes(r.id));
      rows.forEach(r => { (kids[r.parent_id] || (kids[r.parent_id] = [])).push(r); });
      level = rows.filter(r => !seen.has(r.id)).map(r => r.id);
      level.forEach(id => seen.add(id));
    }
    for (const root of roots) {
      const s = { total: 0, done: 0, overdue: 0 };
      const stack = [...(kids[root] || [])];
      for (let guard = 0; stack.length && guard < 5000; guard++) {
        const r = stack.pop();
        stack.push(...(kids[r.id] || []));
        if (r.archived || !U[r.unit_id]) continue;
        s.total++;
        const k = kindOf(U[r.unit_id].st, r.status);
        if (k === 'done') s.done++; else if (r.due_date && r.due_date < day) s.overdue++;
      }
      if (s.total) stats[root] = s;
    }
    if (withParent.length) {
      const rows = await run(T('tasks').select('id,unit_id,num,title,kind').in('id', [...new Set(withParent.map(t => t.parent_id))]));
      const P = Object.fromEntries(rows.map(r => [r.id, r]));
      for (const t of withParent) {
        const r = P[t.parent_id], u = r && U[r.unit_id];
        if (r && u) parents[t.id] = { id: r.id, key: `${u.key}-${r.num}`, title: r.title, kind: r.kind || '', unit: { id: u.id, name: u.name, color: u.color } };
      }
    }
    return { stats, parents };
  }

  const unitFields = async unitId => [...await globalFields(), ...await ownFields(unitId)];
  /** Состав юнита с ролью (access) и позициями; role — только эта роль. */
  async function unitPeople(unitId, role) {
    const ids = (await unitMembers(unitId)).map(m => m.personId);
    const list = (await people()).filter(x => x.active && ids.includes(x.id));
    return role ? list.filter(x => x.access === role) : list;
  }
  async function setting(key) {
    const r = await run(T('app_settings').select('value').eq('key', key).maybeSingle());
    return r ? json(r.value, null) : null;
  }
  const appStatuses = async () => {
    const list = cleanAppStatuses(await setting('appStatuses'));
    return list.length ? list : cleanAppStatuses([{ id: 'dev', name: 'В разработке', kind: 'dev' }]);
  };
  const appFields = async () => cleanAppFields(await setting('appFields'));
  const appInfoItems = async () => cleanInfoItems(await setting('appInfoItems'));
  /** Приоритет — вариант общего поля «Приоритет» (o_low…o_critical); пусто — без приоритета. */
  async function validPriority(v) {
    if (!v) return '';
    const f = await one('fields', PRIORITY_FIELD);
    return f && (json(f.options, []) || []).some(o => o.id === v) ? String(v) : fail('Нет такого приоритета');
  }
  /** Приложение переехало в другой юнит: его задачи — туда же (колонка того же типа), открытые запросы — PM нового юнита. */
  async function moveAppTasks(a, unitId, ctx) {
    const rows = await all(() => T('tasks').select('id,kind,status,unit_id').eq('app_id', a.id).order('created_at').order('id'));
    for (const t of rows) if (t.unit_id !== unitId) await methods.moveTask({ id: t.id, unitId }, ctx);
    const pms = await unitPeople(unitId, 'moderator');
    const st = unitSettings((await findUnit(unitId)).settings);
    for (const t of rows.filter(x => x.kind === 'request')) {
      const fresh = await findTask(t.id);
      if (kindOf(st, fresh.status) !== 'done') await methods.updateTask({ id: t.id, patch: { assigneeId: pms.length ? pms[0].id : '' } }, ctx);
    }
  }
  /** Флоу по типам запроса: свой у юнита (настройки юнита), иначе студии (app_settings.flows), иначе по умолчанию. */
  const flows = async unitId => {
    const saved = (await setting('flows')) || {};
    const own = unitId ? unitSettings((await findUnit(unitId)).settings).flows : {};
    return Object.fromEntries(Object.keys(REQUEST_TYPES).map(k => [k, own[k] || (k in saved ? cleanFlow(saved[k]) : DEFAULT_FLOWS[k])]));
  };
  const templates = async () => (await all(() => T('task_templates').select('*').order('ord').order('id'))).map(templateOut);
  const linkFields = async () => (await all(() => T('link_fields').select('*').order('ord').order('id'))).map(linkFieldOut);
  const cleanPositions = async list => {
    const ids = new Set((await departments()).map(d => d.id));
    return [...new Set((Array.isArray(list) ? list : []).map(String))].filter(id => ids.has(id));
  };
  const unitMembers = async unitId => (await all(() => T('unit_members').select('person_id,department_id').eq('unit_id', unitId).order('created_at').order('person_id')))
    .map(m => ({ personId: m.person_id, departmentId: m.department_id }));

  async function keyTaken(key, exceptId = '') {
    const rows = await run(T('units').select('id').eq('key', key).neq('id', exceptId).limit(1));
    return rows.length > 0;
  }

  async function uniqueKey(base) {
    base = normKey(base) || 'U';
    if (!(await keyTaken(base))) return base;
    for (let i = 2; i < 1000; i++) {
      const k = base.slice(0, 10 - String(i).length) + i;
      if (!(await keyTaken(k))) return k;
    }
    return 'U' + Date.now().toString(36).toUpperCase().slice(-8);
  }

  async function maxOrd(table, filters) {
    let q = T(table).select('ord');
    for (const [k, v] of Object.entries(filters || {})) q = q.eq(k, v);
    const rows = await run(q.order('ord', { ascending: false }).limit(1));
    return rows.length ? Number(rows[0].ord) || 0 : 0;
  }

  async function validDept(id) {
    if (!id) return '';
    return (await one('departments', id)) ? String(id) : '';
  }

  /** Отдел (позиция) исполнителя — подставляется в задачу, если отдел не выбран. Сначала позиция из профиля. */
  async function memberDept(unitId, personId) {
    if (!personId) return '';
    const person = await run(T('people').select('position_id').eq('id', personId).maybeSingle());
    if (person && person.position_id) return person.position_id;
    const m = await run(T('unit_members').select('department_id').eq('unit_id', unitId).eq('person_id', personId).maybeSingle());
    return m ? m.department_id : '';
  }

  const actor = ctx => str(ctx && ctx.actorId, 40);

  const logVal = v => {
    if (v === undefined || v === null) return '';
    const s = JSON.stringify(v);
    return s.length > 1000 ? JSON.stringify(String(v).slice(0, 300) + '…') : s;
  };

  async function log(entries, ctx) {
    if (!entries.length) return;
    const by = actor(ctx);
    // У каждой записи своё время (монотонное) — постраничная лента не теряет записи на границе
    await run(T('activity').insert(entries.map(e => ({
      id: uid('a'), unit_id: e.unitId || '', task_id: e.taskId || '', action: e.action, field: e.field || '',
      from_val: logVal(e.from), to_val: logVal(e.to), actor_id: by, at: now(),
    }))));
  }

  /** Счётчики по типам колонок (todo / in_progress / done / overdue) для каждого юнита. */
  function countTasks(units, tasks, day, weekAgo) {
    const settings = Object.fromEntries(units.map(u => [u.id, unitSettings(u.settings)]));
    const counts = {};
    for (const t of tasks) {
      const st = settings[t.unit_id];
      if (!st) continue;
      const kind = kindOf(st, t.status);
      const c = counts[t.unit_id] || (counts[t.unit_id] = { ...emptyCounts(), doneWeek: 0 });
      c[KIND_COUNT_KEY[kind]]++;
      if (kind !== 'done' && t.due_date && t.due_date < day) c.overdue++;
      if (kind === 'done' && weekAgo && t.done_at >= weekAgo) c.doneWeek++;
    }
    return counts;
  }

  async function unitsWithCounts(day, weekAgo) {
    const [units, tasks, members] = await Promise.all([
      all(() => T('units').select('*').order('ord').order('id')),
      all(() => T('tasks').select('unit_id,status,due_date,done_at').eq('archived', false).order('id')),
      all(() => T('unit_members').select('unit_id,person_id').order('created_at').order('person_id')),
    ]);
    const counts = countTasks(units, tasks, day, weekAgo);
    const byUnit = {};
    for (const m of members) (byUnit[m.unit_id] = byUnit[m.unit_id] || []).push(m.person_id);
    return units.map(r => {
      const { doneWeek, ...c } = counts[r.id] || { ...emptyCounts(), doneWeek: 0 };
      return { ...unitOut(r), counts: c, doneWeek, members: byUnit[r.id] || [] };
    });
  }

  function fieldRow(unitId, p, order) {
    return {
      id: uid('f'), unit_id: unitId || null, name: req(str(p.name, 60), 'Название поля'),
      type: FIELD_TYPES.includes(p.type) ? p.type : 'text', options: cleanOptions(p.options),
      show_on_card: !!p.showOnCard, required: !!p.required, required_from: str(p.requiredFrom, 40), ord: order, archived: false,
      staff_only: !!p.staffOnly, role: '', // приоритет — только общее поле (schema.sql)
      required_on_create: !!p.requiredOnCreate,
    };
  }

  async function insertFields(unitId, fields) {
    if (fields.length) await run(T('fields').insert(fields.map((f, i) => fieldRow(unitId, f, i + 1))));
  }

  /** Добавляет к записям журнала подписи: название поля, «было → стало», задачу и юнит. */
  async function enrichActivity(rows) {
    if (!rows.length) return [];
    const taskIds = [...new Set(rows.map(r => r.task_id).filter(Boolean))];
    const [units, peopleRows, fields, depts, tasks, lfRows, teamRows] = await Promise.all([
      all(() => T('units').select('id,name,key,color,settings').order('id')),
      all(() => T('people').select('id,name').order('id')),
      all(() => T('fields').select('*').order('id')),
      all(() => T('departments').select('id,name').order('id')),
      taskIds.length ? run(T('tasks').select('id,unit_id,num,title,department_id').in('id', taskIds)) : [],
      all(() => T('link_fields').select('id,name').order('id')),
      all(() => T('teams').select('id,name').order('id')),
    ]);
    const TM = Object.fromEntries(teamRows.map(r => [r.id, r.name]));
    const LF = Object.fromEntries(lfRows.map(r => [r.id, r]));
    const index = list => Object.fromEntries(list.map(r => [r.id, r]));
    const U = index(units), P = index(peopleRows), F = index(fields), D = index(depts), TT = index(tasks);
    const personName = id => (id && P[id] ? P[id].name : '');

    return rows.map(a => {
      const t = TT[a.task_id];
      const u = U[t ? t.unit_id : a.unit_id];
      const st = unitSettings(u && u.settings);
      const B = st.builtins;
      const from = a.from_val === '' ? null : json(a.from_val, a.from_val);
      const to = a.to_val === '' ? null : json(a.to_val, a.to_val);
      const col = id => (st.columns.find(c => c.id === id) || { name: id }).name;

      let label = '', fromText = from, toText = to;
      switch (a.field) {
        case 'title': label = B.title.label; break;
        case 'description': label = B.description.label; break;
        case 'status': label = B.status.label; fromText = col(from); toText = col(to); break;
        case 'assigneeId': label = B.assignee.label; fromText = personName(from); toText = personName(to); break;
        case 'departmentId': label = B.department.label; fromText = from && D[from] ? D[from].name : ''; toText = to && D[to] ? D[to].name : ''; break;
        case 'dueDate': label = B.dueDate.label; fromText = fmtDate(from); toText = fmtDate(to); break;
        case 'checklist': label = 'Чеклист'; break;
        case 'unit': label = 'Юнит'; break;
        case 'teamId': label = 'Команда'; fromText = TM[from] || ''; toText = TM[to] || ''; break;
        case 'specUrl': label = 'ТЗ'; break;
        case 'checklist:add': case 'checklist:remove': case 'checklist:rename': case 'checklist:done': case 'checklist:undone': label = 'Чеклист'; break;
        default:
          // ссылки: в истории только факт изменения, без адреса — история видна шире, чем само поле
          if (/^link:/.test(a.field)) {
            const lf = LF[a.field.slice(5)];
            label = lf ? lf.name : 'Ссылка';
            fromText = ''; toText = to ? (from ? 'изменена' : 'добавлена') : 'удалена';
          }
          if (/^f_/.test(a.field)) {
            const f = F[a.field] ? fieldOut(F[a.field]) : null;
            label = f ? f.name : 'Удалённое поле';
            fromText = f ? fmtVal(f, from, personName) : '';
            toText = f ? fmtVal(f, to, personName) : '';
          }
      }
      const text = v => (v === null || v === undefined || v === '' ? '—' : String(v));
      return {
        id: a.id, action: a.action, field: a.field, actorId: a.actor_id, at: a.at,
        label, fromText: text(fromText), toText: text(toText),
        unit: u ? { id: u.id, name: u.name, key: u.key, color: u.color } : null,
        task: t ? { id: t.id, title: t.title, key: `${U[t.unit_id] ? U[t.unit_id].key : '?'}-${t.num}`, departmentId: t.department_id || '' } : null,
      };
    });
  }

  function fmtVal(f, v, personName) {
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return '';
    const opt = id => (f.options.find(o => o.id === id) || { name: '?' }).name;
    switch (f.type) {
      case 'select': return opt(v);
      case 'multiselect': return (Array.isArray(v) ? v : [v]).map(opt).join(', ');
      case 'person': return personName(v) || '?';
      case 'checkbox': return v ? 'да' : 'нет';
      case 'date': return fmtDate(v);
      default: return String(v);
    }
  }

  /**
   * После изменения колонок: задачи из удалённых колонок переезжают в remap[old] (или в первую колонку),
   * отметка «выполнено» пересчитывается по типу новой колонки.
   */
  async function remapStatuses(unitId, before, after, remap) {
    const ids = new Set(after.columns.map(c => c.id));
    const tasks = await all(() => T('tasks').select('id,status,done_at').eq('unit_id', unitId).order('id'));
    for (const t of tasks) {
      const status = ids.has(t.status) ? t.status : ids.has(remap[t.status]) ? remap[t.status] : after.columns[0].id;
      const wasDone = kindOf(before, t.status) === 'done', nowDone = kindOf(after, status) === 'done';
      const doneAt = nowDone ? (wasDone && t.done_at ? t.done_at : now()) : '';
      if (status !== t.status || doneAt !== t.done_at) await run(T('tasks').update({ status, done_at: doneAt }).eq('id', t.id));
    }
  }

  async function autoArchive(unit) {
    const st = unitSettings(unit.settings);
    if (!st.autoArchiveDays) return;
    const doneIds = st.columns.filter(c => c.kind === 'done').map(c => c.id);
    if (!doneIds.length) return;
    const cutoff = new Date(Date.now() - st.autoArchiveDays * 864e5).toISOString();
    await run(T('tasks').update({ archived: true }).eq('unit_id', unit.id).in('status', doneIds)
      .eq('archived', false).neq('done_at', '').lt('done_at', cutoff));
  }

  const methods = {

    /* ---------- общие данные, главная, поиск ---------- */

    async bootstrap(p) {
      const [units, ppl, depts, lf, tpl, tm, apps, statuses, afields, gfields, info] = await Promise.all([unitsWithCounts(today(p.today)), people(), departments(), linkFields(), templates(), teams(),
        all(() => T('apps').select('*').order('ord').order('id')), appStatuses(), appFields(), globalFields(), appInfoItems()]);
      const prio = gfields.find(f => f.role === 'priority');
      return {
        units: units.map(({ doneWeek, ...u }) => u), people: ppl, departments: depts, linkFields: lf, templates: tpl, teams: tm,
        apps: apps.map(appOut), appStatuses: statuses, appFields: afields, appInfoItems: info, priorityOptions: prio ? prio.options : [],
      };
    },

    async getHome(p) {
      // Заодно чистим корзину юнитов по сроку хранения (для участников функция ничего не делает)
      await rpc('purge_archived_units', {}).catch(() => 0);
      const day = today(p.today);
      const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
      const [units, ppl, depts, log] = await Promise.all([
        unitsWithCounts(day, weekAgo), people(), departments(),
        run(T('activity').select('*').order('at', { ascending: false }).limit(30)),
      ]);
      const stats = { todo: 0, in_progress: 0, overdue: 0, doneWeek: 0 };
      for (const u of units) {
        if (u.archived) continue;
        stats.todo += u.counts.todo;
        stats.in_progress += u.counts.in_progress;
        stats.overdue += u.counts.overdue;
        stats.doneWeek += u.doneWeek;
      }
      return { units: units.map(({ doneWeek, ...u }) => u), people: ppl, departments: depts, teams: await teams(), stats, activity: await enrichActivity(log) };
    },

    /**
     * Лента событий с фильтрами: unitId, actorId, departmentId (позиция задачи), kind, since (скрыть старее), before (страница).
     * kind: create | status | assign | comment | fields | move | delete | archive.
     */
    async getActivity(p) {
      const limit = Math.min(Math.max(Number(p.limit) || 30, 1), 100);
      const build = () => {
        let q = T('activity').select('*');
        if (p.unitId) q = q.eq('unit_id', String(p.unitId));
        if (p.actorId) q = q.eq('actor_id', String(p.actorId));
        switch (p.kind) {
          case 'create': case 'comment': case 'move': case 'delete': q = q.eq('action', p.kind); break;
          case 'archive': q = q.in('action', ['archive', 'unarchive']); break;
          case 'status': q = q.eq('action', 'update').eq('field', 'status'); break;
          case 'assign': q = q.eq('action', 'update').eq('field', 'assigneeId'); break;
          case 'fields': q = q.eq('action', 'update').neq('field', 'status').neq('field', 'assigneeId'); break;
          default: break;
        }
        if (p.since) q = q.gt('at', String(p.since));
        if (p.before) q = q.lt('at', String(p.before));
        return q.order('at', { ascending: false });
      };
      // Позиция задачи известна только после обогащения — берём с запасом и фильтруем
      const rows = await run(build().limit(p.departmentId ? limit * 4 : limit + 1));
      let items = await enrichActivity(rows);
      if (p.departmentId) items = items.filter(a => a.task && a.task.departmentId === p.departmentId);
      return { items: items.slice(0, limit), more: items.length > limit || (!!p.departmentId && rows.length === limit * 4) };
    },

    /** Сводка для администраторов: загрузка людей и позиций, просрочки, что требует внимания. */
    async getOverview(p) {
      const day = today(p.today);
      const [units, tasks, ppl, members] = await Promise.all([
        all(() => T('units').select('id,key,name,color,settings,archived').order('id')),
        all(() => T('tasks').select('id,unit_id,num,title,status,assignee_id,department_id,due_date').eq('archived', false).order('id')),
        people(),
        all(() => T('unit_members').select('unit_id,person_id').order('unit_id')),
      ]);
      const U = Object.fromEntries(units.filter(u => !u.archived).map(u => [u.id, { ...u, st: unitSettings(u.settings) }]));
      const byPerson = {};
      const byPersonUnit = {}; // человек → юнит → счётчики (для фильтра «Загрузки» по юниту)
      const byPosition = {};
      const overdue = [], unassignedTasks = [], noPositionTasks = [];
      let unassigned = 0, noPosition = 0;
      for (const t of tasks) {
        const u = U[t.unit_id];
        if (!u) continue;
        const kind = kindOf(u.st, t.status);
        if (kind === 'done') continue;
        const late = !!t.due_date && t.due_date < day;
        const bump = (map, key) => {
          const c = map[key] || (map[key] = { open: 0, inProgress: 0, overdue: 0 });
          c.open++;
          if (kind === 'progress') c.inProgress++;
          if (late) c.overdue++;
        };
        const brief = { id: t.id, key: `${u.key}-${t.num}`, title: t.title, dueDate: t.due_date, assigneeId: t.assignee_id, departmentId: t.department_id || '', unit: { id: u.id, name: u.name, color: u.color } };
        if (t.assignee_id) bump(byPersonUnit[t.assignee_id] || (byPersonUnit[t.assignee_id] = {}), t.unit_id);
        if (t.assignee_id) bump(byPerson, t.assignee_id); else { unassigned++; unassignedTasks.push(brief); }
        if (t.department_id) bump(byPosition, t.department_id); else { noPosition++; noPositionTasks.push(brief); }
        if (late) overdue.push(brief);
      }
      overdue.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      const teamUnits = new Set(members.map(m => m.unit_id));
      const unitMembers = {};
      for (const m of members) (unitMembers[m.unit_id] = unitMembers[m.unit_id] || []).push(m.person_id);
      const byDue = (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
      const active = ppl.filter(x => x.active);
      return {
        byPerson, byPosition, unassigned, noPosition,
        overdue: overdue.slice(0, 10), overdueTotal: overdue.length,
        byPersonUnit, unassignedTasks: unassignedTasks.sort(byDue).slice(0, 15), noPositionTasks: noPositionTasks.sort(byDue).slice(0, 15), unitMembers,
        peopleNoLogin: active.filter(x => !x.linked).map(x => x.id),
        unitsNoTeam: Object.values(U).filter(u => !teamUnits.has(u.id)).map(u => u.id),
      };
    },

    /** Задачи из всех активных юнитов: поиск (q), «мои задачи» (assigneeId) или конкретные (ids — «Отслеживаю» на дашборде). */
    async queryTasks(p) {
      const q = str(p.q, 100).toLowerCase();
      const units = Object.fromEntries((await all(() => T('units').select('*').eq('archived', false).order('id'))).map(u => [u.id, u]));
      const ids = Array.isArray(p.ids) ? p.ids.map(x => String(x ?? '')).filter(Boolean).slice(0, 200) : null;
      if (ids && !ids.length) return [];
      let rows = await all(() => {
        let b = T('tasks').select('*').eq('archived', false);
        if (p.assigneeId) b = b.eq('assignee_id', String(p.assigneeId));
        if (ids) b = b.in('id', ids);
        return b.order('updated_at', { ascending: false }).order('id');
      });
      rows = rows.filter(r => units[r.unit_id]);
      if (q) rows = rows.filter(r => `${units[r.unit_id].key}-${r.num} ${r.title} ${r.description}`.toLowerCase().includes(q));
      return rows.slice(0, Math.min(Number(p.limit) || 50, 500)).map(r => {
        const u = units[r.unit_id];
        const col = columnOf(unitSettings(u.settings), r.status);
        return {
          ...taskOut(r), key: `${u.key}-${r.num}`, statusName: col.name, statusKind: col.kind, statusColor: col.color,
          unit: { id: u.id, name: u.name, key: u.key, color: u.color },
        };
      });
    },

    async getBoard(p) {
      const unit = await findUnit(p.unitId);
      await autoArchive(unit);
      const [fields, tasks, counts, units, ppl, depts, members, links] = await Promise.all([
        unitFields(unit.id),
        all(() => T('tasks').select('*').eq('unit_id', unit.id).order('id')),
        rpc('comment_counts', { p_unit: unit.id }),
        all(() => T('units').select('id,name,key,color,archived').order('ord').order('id')),
        people(), departments(), unitMembers(unit.id),
        all(() => T('task_links').select('task_id,field_id,url').eq('unit_id', unit.id).order('task_id').order('field_id')),
      ]);
      const cc = Object.fromEntries((counts || []).map(c => [c.task_id, Number(c.n)]));
      const lk = {};
      links.forEach(l => { (lk[l.task_id] || (lk[l.task_id] = {}))[l.field_id] = l.url; });
      const tree = await treeInfo(tasks.filter(t => !t.archived), today(p.today));
      return {
        unit: unitOut(unit),
        fields,
        tasks: tasks.map(t => ({ ...taskOut(t), commentCount: cc[t.id] || 0, links: lk[t.id] || {}, tree: tree.stats[t.id] || null, parent: tree.parents[t.id] || null })),
        units: units.map(u => ({ ...u, archived: !!u.archived })),
        people: ppl,
        departments: depts,
        members,
      };
    },

    /* ---------- юниты ---------- */

    async createUnit(p) {
      const name = req(str(p.name, 80), 'Название');
      let key = normKey(p.key);
      if (key && (await keyTaken(key))) fail(`Ключ ${key} уже занят`);
      if (!key) key = await uniqueKey('U');
      const count = (await run(T('units').select('id'))).length;

      let settings = storedSettings(defaultSettings());
      let fields = defaultFields();
      const src = p.copyFieldsFrom && (await one('units', p.copyFieldsFrom));
      if (src) {
        settings = storedSettings(src.settings);
        fields = (await ownFields(src.id)).filter(f => !f.archived);
      }
      const ts = now();
      const unit = {
        id: uid('u'), name, key, color: color(p.color, PALETTE[count % PALETTE.length]),
        description: str(p.description, 1000), settings, next_num: 1,
        ord: (await maxOrd('units')) + 1, archived: false, created_at: ts, updated_at: ts,
      };
      await run(T('units').insert(unit));
      await insertFields(unit.id, fields);
      return { ...unitOut(unit), counts: emptyCounts(), members: [] };
    },

    async updateUnit(p) {
      const u = await findUnit(p.id);
      const upd = {};
      if ('name' in p) upd.name = req(str(p.name, 80), 'Название');
      if ('key' in p) {
        const key = normKey(p.key) || fail('Ключ: 2–10 латинских букв или цифр, начиная с буквы');
        if (await keyTaken(key, u.id)) fail(`Ключ ${key} уже занят`);
        upd.key = key;
      }
      if ('color' in p) upd.color = color(p.color, u.color);
      if ('description' in p) upd.description = str(p.description, 1000);
      if ('settings' in p) upd.settings = storedSettings(p.settings);
      if ('archived' in p) {
        upd.archived = !!p.archived;
        if (upd.archived !== !!u.archived) upd.archived_at = upd.archived ? now() : '';
      }
      upd.updated_at = now();
      await updateOne('units', u.id, upd);
      if (upd.settings) await remapStatuses(u.id, unitSettings(u.settings), unitSettings(upd.settings), p.statusRemap || {});
      return unitOut(await findUnit(u.id));
    },

    async reorderUnits(p) {
      await Promise.all((p.ids || []).map((id, i) => run(T('units').update({ ord: i + 1 }).eq('id', String(id)))));
      return true;
    },

    async duplicateUnit(p) {
      const src = await findUnit(p.id);
      const ts = now();
      const unit = {
        id: uid('u'), name: str(src.name + ' (копия)', 80), key: await uniqueKey(src.key), color: src.color,
        description: src.description, settings: storedSettings(src.settings), next_num: 1,
        ord: (await maxOrd('units')) + 1, archived: false, created_at: ts, updated_at: ts,
      };
      await run(T('units').insert(unit));
      await insertFields(unit.id, (await ownFields(src.id)).filter(f => !f.archived));
      return { ...unitOut(unit), counts: emptyCounts(), members: [] };
    },

    /** Общие настройки приложения. */
    async getAppSettings() {
      const rows = await all(() => T('app_settings').select('key,value').order('key'));
      return { unitRetentionDays: 30, ...Object.fromEntries(rows.map(r => [r.key, json(r.value, r.value)])) };
    },

    /** Меняет супер-админ (RLS). Сейчас: unitRetentionDays — через сколько дней удалять юниты из корзины, 0 — никогда. */
    async updateAppSettings(p) {
      if ('unitRetentionDays' in p) {
        const d = Number(p.unitRetentionDays);
        if (![0, 7, 15, 30, 60, 90].includes(d)) fail('Недопустимый срок');
        await run(T('app_settings').upsert({ key: 'unitRetentionDays', value: d, updated_at: now() }, { onConflict: 'key' }));
      }
      return methods.getAppSettings();
    },

    /** Удаляет из корзины юниты старше срока хранения. */
    async purgeArchivedUnits() {
      return rpc('purge_archived_units', {});
    },

    /** Удаляет юнит; задачи, поля, комментарии и состав уходят каскадом. */
    async deleteUnit(p) {
      const u = await findUnit(p.id);
      await rpc('delete_unit', { p_unit: u.id });
      return true;
    },

    /* ---------- задачи ---------- */

    async createTask(p, ctx) {
      const unit = await findUnit(p.unitId);
      const st = unitSettings(unit.settings);
      const status = st.columns.some(c => c.id === p.status) ? p.status : st.columns[0].id;
      const assignee = str(p.assigneeId, 40);
      const ts = now();
      const task = {
        id: uid('t'), unit_id: unit.id, num: (await rpc('next_task_num', { p_unit: unit.id })) ?? fail('Создавать задачи могут CEO и PM юнита', 'FORBIDDEN'),
        title: req(str(p.title, 500), 'Название задачи'), description: str(p.description, 20000), status,
        assignee_id: assignee, department_id: (await validDept(p.departmentId)) || (await memberDept(unit.id, assignee)),
        team_id: await validTeam(p.teamId),
        due_date: date(p.dueDate), ord: (await maxOrd('tasks', { unit_id: unit.id, status })) + 1,
        fields: cleanFieldValues(p.fields, false), checklist: cleanChecklist(p.checklist),
        archived: false, done_at: kindOf(st, status) === 'done' ? ts : '', created_by: actor(ctx), created_at: ts, updated_at: ts,
        parent_id: p.parentId ? (await findTask(p.parentId)).id : '', kind: TASK_KINDS.includes(p.kind) ? p.kind : '',
        app_id: str(p.appId, 40), request_type: p.kind === 'request' && REQUEST_TYPES[p.requestType] ? p.requestType : '',
        step: str(p.step, 30), depends_on: (Array.isArray(p.dependsOn) ? p.dependsOn : []).map(x => str(x, 40)).filter(Boolean).slice(0, 20),
        is_test: !!p.test, started_at: kindOf(st, status) === 'todo' ? '' : ts, spec_url: linkUrl(p.specUrl),
      };
      // наследование от родителя (этап от запроса, подзадача от этапа): ТЗ, описание (если своего нет) и ссылки
      const parent = task.parent_id && p.inherit !== false ? await one('tasks', task.parent_id) : null;
      if (parent) {
        if (!task.spec_url) task.spec_url = parent.spec_url || '';
        if (!task.description) task.description = parent.description || '';
      }
      await run(T('tasks').insert(task));
      if (parent) {
        const links = await run(T('task_links').select('field_id,url').eq('task_id', parent.id));
        if (links.length) await run(T('task_links').insert(links.map(l => ({ task_id: task.id, field_id: l.field_id, unit_id: task.unit_id, url: l.url, updated_at: ts }))));
      }
      await log([{ unitId: unit.id, taskId: task.id, action: 'create', to: task.title }], ctx);
      return { ...taskOut(task), commentCount: 0 };
    },

    /**
     * patch: { title, description, status, assigneeId, departmentId, dueDate, order, archived, checklist, fields: { f_id: value|null } }
     * expectedUpdatedAt — защита от перезаписи чужих изменений (код ошибки CONFLICT).
     */
    async updateTask(p, ctx) {
      const r = await findTask(p.id);
      if (p.expectedUpdatedAt && r.updated_at !== p.expectedUpdatedAt) {
        fail('Задачу уже изменил кто-то другой', 'CONFLICT', taskOut(r));
      }
      const patch = p.patch || {};
      const t = { ...r, fields: json(r.fields, {}), checklist: json(r.checklist, []) };
      const logs = [];
      let dirty = false; // изменения без записи в журнал: порядок, текст пунктов чеклиста
      const change = (field, from, to) => logs.push({ unitId: t.unit_id, taskId: t.id, action: 'update', field, from, to });

      if ('title' in patch) {
        const v = req(str(patch.title, 500), 'Название задачи');
        if (v !== t.title) { change('title', t.title, v); t.title = v; }
      }
      if ('description' in patch) {
        const v = str(patch.description, 20000);
        // в истории — начало текста «было → стало», чтобы видно, что поменялось
        const cut = s => (s.length > 140 ? s.slice(0, 140) + '…' : s);
        if (v !== t.description) { change('description', cut(t.description), cut(v)); t.description = v; }
      }
      if ('specUrl' in patch) {
        const v = linkUrl(patch.specUrl);
        if (v !== (t.spec_url || '')) { change('specUrl', t.spec_url || '', v); t.spec_url = v; }
      }
      if ('status' in patch) {
        const st = unitSettings((await findUnit(t.unit_id)).settings);
        if (!st.columns.some(c => c.id === patch.status)) fail('Такой колонки нет');
        if (patch.status !== t.status) {
          change('status', t.status, patch.status);
          const wasDone = kindOf(st, t.status) === 'done', nowDone = kindOf(st, patch.status) === 'done';
          if (!t.started_at && kindOf(st, patch.status) !== 'todo') t.started_at = now(); // впервые взяли в работу (раньше «готово»)
          if (nowDone && !wasDone) t.done_at = now();
          if (!nowDone) t.done_at = '';
          t.status = patch.status;
        }
      }
      if ('teamId' in patch) {
        const v = await validTeam(patch.teamId);
        if (v !== (t.team_id || '')) { change('teamId', t.team_id || '', v); t.team_id = v; }
      }
      if ('departmentId' in patch) {
        const v = await validDept(patch.departmentId);
        if (v !== t.department_id) { change('departmentId', t.department_id, v); t.department_id = v; }
      }
      if ('assigneeId' in patch) {
        const v = str(patch.assigneeId, 40);
        if (v !== t.assignee_id) {
          change('assigneeId', t.assignee_id, v);
          t.assignee_id = v;
          // Позиция задачи следует за исполнителем (если её не задали явно в этом же изменении)
          const d = !('departmentId' in patch) && (await memberDept(t.unit_id, v));
          if (d && d !== t.department_id) { change('departmentId', t.department_id, d); t.department_id = d; }
        }
      }
      if ('dueDate' in patch) {
        const v = date(patch.dueDate);
        if (v !== t.due_date) { change('dueDate', t.due_date, v); t.due_date = v; }
      }
      if ('checklist' in patch) {
        const before = cleanChecklist(t.checklist);
        const after = cleanChecklist(patch.checklist);
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          // каждое изменение пункта — своей записью: добавлен, удалён, переименован, отмечен / снят
          const byId = l => Object.fromEntries(l.map(i => [i.id, i]));
          const B0 = byId(before), A0 = byId(after);
          for (const i of after) {
            const was = B0[i.id];
            if (!was) logs.push({ unitId: t.unit_id, taskId: t.id, action: 'update', field: 'checklist:add', to: i.text });
            else {
              if (was.text !== i.text) logs.push({ unitId: t.unit_id, taskId: t.id, action: 'update', field: 'checklist:rename', from: was.text, to: i.text });
              if (!!was.done !== !!i.done) logs.push({ unitId: t.unit_id, taskId: t.id, action: 'update', field: i.done ? 'checklist:done' : 'checklist:undone', to: i.text });
            }
          }
          for (const i of before) if (!A0[i.id]) logs.push({ unitId: t.unit_id, taskId: t.id, action: 'update', field: 'checklist:remove', from: i.text });
          t.checklist = after;
          dirty = true;
        }
      }
      if ('archived' in patch) {
        const v = !!patch.archived;
        if (v !== !!t.archived) {
          logs.push({ unitId: t.unit_id, taskId: t.id, action: v ? 'archive' : 'unarchive' });
          t.archived = v;
        }
      }
      if (patch.fields) {
        const cur = { ...t.fields };
        for (const [k, after] of Object.entries(cleanFieldValues(patch.fields, true))) {
          const before = cur[k] ?? null;
          if (JSON.stringify(before) === JSON.stringify(after)) continue;
          change(k, before, after);
          if (after === null) delete cur[k]; else cur[k] = after;
        }
        t.fields = cur;
      }
      if ('order' in patch && Number.isFinite(Number(patch.order)) && Number(patch.order) !== Number(t.ord)) {
        t.ord = Number(patch.order);
        dirty = true;
      }

      if (logs.length || dirty) {
        t.updated_at = now();
        // Условие по updated_at: если между чтением и записью задачу успели изменить — конфликт
        const saved = await run(T('tasks').update({
          title: t.title, description: t.description, status: t.status, assignee_id: t.assignee_id, department_id: t.department_id, team_id: t.team_id || '',
          due_date: t.due_date, ord: t.ord, fields: t.fields, checklist: t.checklist, archived: t.archived, spec_url: t.spec_url || '',
          done_at: t.done_at, updated_at: t.updated_at, started_at: t.started_at || '',
        }).eq('id', t.id).eq('updated_at', r.updated_at).select('*'));
        if (!saved.length) {
          const fresh = await one('tasks', t.id);
          if (fresh && fresh.updated_at !== r.updated_at) fail('Задачу уже изменил кто-то другой', 'CONFLICT', taskOut(fresh));
          fail('Недостаточно прав: менять можно только свои задачи', 'FORBIDDEN');
        }
        await log(logs, ctx);
        return taskOut(saved[0]); // из базы: исполнителя мог сменить триггер ревью
      }
      return taskOut(t);
    },

    /**
     * Дерево задачи: цепочка родителей (от верхнего) и все потомки ниже — с юнитом, этапом и этапами юнита
     * (для жизненного цикла). Видно только то, что пускают правила доступа.
     */
    async getTaskTree(p) {
      const root = await findTask(p.id);
      const unitRows = await all(() => T('units').select('id,name,key,color,settings').order('id'));
      const U = Object.fromEntries(unitRows.map(u => [u.id, { ...u, st: unitSettings(u.settings) }]));
      const brief = r => {
        const u = U[r.unit_id];
        const col = u ? columnOf(u.st, r.status) : { name: r.status, kind: 'todo', color: '' };
        return {
          id: r.id, key: u ? `${u.key}-${r.num}` : '', title: r.title, kind: r.kind || '', parentId: r.parent_id || '',
          unit: u ? { id: u.id, name: u.name, color: u.color } : null, status: r.status,
          statusName: col.name, statusKind: col.kind, statusColor: col.color || '',
          assigneeId: r.assignee_id, dueDate: r.due_date, archived: !!r.archived, step: r.step || '', dependsOn: json(r.depends_on, []) || [],
        };
      };
      const ancestors = [];
      for (let pid = root.parent_id, i = 0; pid && i < 10; i++) {
        const a = await one('tasks', pid);
        if (!a) break;
        ancestors.unshift(brief(a));
        pid = a.parent_id;
      }
      const descendants = [];
      let level = [root.id];
      for (let depth = 1; level.length && depth <= 6; depth++) {
        const rows = await run(T('tasks').select('*').in('parent_id', level).order('created_at').order('id'));
        rows.forEach(r => descendants.push({ ...brief(r), depth }));
        level = rows.map(r => r.id);
      }
      return { task: brief(root), ancestors, descendants };
    },

    /** Забрать задачу из ревью (тот, кто отправил): обратно в колонку перед ревью, исполнитель — снова он. */
    async recallReview(p) {
      const t = await findTask(p.id);
      await rpc('recall_review', { p_task: t.id });
      return taskOut((await one('tasks', t.id)) || t);
    },

    /** Перенос в другой юнит: новый номер, колонка того же типа. Значения полей сохраняются. */
    async moveTask(p, ctx) {
      const t = await findTask(p.id);
      if (t.unit_id === p.unitId) return taskOut(t);
      const from = await findUnit(t.unit_id);
      const to = await findUnit(p.unitId);
      const fromSt = unitSettings(from.settings), toSt = unitSettings(to.settings);
      const kind = kindOf(fromSt, t.status);
      const status = toSt.columns.some(c => c.id === t.status) ? t.status : (toSt.columns.find(c => c.kind === kind) || toSt.columns[0]).id;
      const num = await rpc('next_task_num', { p_unit: to.id });
      await run(T('tasks').update({
        unit_id: to.id, num, status, ord: (await maxOrd('tasks', { unit_id: to.id, status })) + 1, updated_at: now(),
      }).eq('id', t.id));
      await log([{ unitId: to.id, taskId: t.id, action: 'move', field: 'unit', from: `${from.key}-${t.num}`, to: `${to.key}-${num}` }], ctx);
      return taskOut(await findTask(t.id));
    },

    async duplicateTask(p, ctx) {
      const src = await findTask(p.id);
      const id = uid('t');
      // копирует база: «нужно при создании» к копии не относится
      await rpc('duplicate_task', {
        p_task: src.id, p_id: id, p_title: str(src.title + ' (копия)', 500),
        p_ord: (await maxOrd('tasks', { unit_id: src.unit_id, status: src.status })) + 1, p_at: now(),
      });
      const task = await findTask(id);
      await log([{ unitId: task.unit_id, taskId: task.id, action: 'create', to: task.title }], ctx);
      return { ...taskOut(task), commentCount: 0 };
    },

    async deleteTask(p, ctx) {
      const t = await findTask(p.id);
      const gone = await run(T('tasks').delete().eq('id', t.id).select('id'));
      if (!gone.length) fail('Недостаточно прав для этого действия', 'FORBIDDEN');
      await log([{ unitId: t.unit_id, taskId: t.id, action: 'delete', from: t.title }], ctx);
      return true;
    },

    /** Комментарии и история — грузятся при открытии карточки. */
    async getTaskExtras(p) {
      const id = String(p.taskId ?? '');
      const [comments, log] = await Promise.all([
        all(() => T('comments').select('*').eq('task_id', id).order('at').order('id')),
        run(T('activity').select('*').eq('task_id', id).order('at', { ascending: false }).limit(200)),
      ]);
      return { comments: comments.map(commentOut), activity: await enrichActivity(log) };
    },

    /* ---------- комментарии ---------- */

    async addComment(p, ctx) {
      const t = await findTask(p.taskId);
      const c = { id: uid('c'), task_id: t.id, text: req(str(p.text, 5000), 'Комментарий'), author_id: actor(ctx), at: now(), edited_at: '' };
      await run(T('comments').insert(c));
      await log([{ unitId: t.unit_id, taskId: t.id, action: 'comment', to: c.text.slice(0, 200) }], ctx);
      return commentOut(c);
    },

    async updateComment(p, ctx) {
      const c = (await one('comments', p.id)) || fail('Комментарий не найден', 'NOT_FOUND');
      const upd = { text: req(str(p.text, 5000), 'Комментарий'), edited_at: now() };
      await updateOne('comments', c.id, upd);
      const t = await one('tasks', c.task_id);
      if (t && upd.text !== c.text) await log([{ unitId: t.unit_id, taskId: t.id, action: 'comment_edit', from: c.text.slice(0, 200), to: upd.text.slice(0, 200) }], ctx);
      return commentOut({ ...c, ...upd });
    },

    async deleteComment(p, ctx) {
      const gone = await run(T('comments').delete().eq('id', String(p.id ?? '')).select('id,task_id,text'));
      if (!gone.length) fail('Удалить можно только свой комментарий', 'FORBIDDEN');
      const t = gone[0].task_id && (await one('tasks', gone[0].task_id));
      if (t) await log([{ unitId: t.unit_id, taskId: t.id, action: 'comment_delete', from: String(gone[0].text || '').slice(0, 200) }], ctx);
      return true;
    },

    /* ---------- поля карточки ---------- */

    /** Общие поля карточки (на все юниты) — для Панели админа. */
    async getGlobalFields() {
      return globalFields();
    },

    /** Поле юнита (unitId) или общее на все юниты (global: true). */
    async createField(p) {
      const unitId = p.global ? null : (await findUnit(p.unitId)).id;
      const list = unitId ? await ownFields(unitId) : await globalFields();
      const f = fieldRow(unitId, p, Math.max(0, ...list.map(x => Number(x.order) || 0)) + 1);
      await run(T('fields').insert(f));
      return fieldOut(f);
    },

    async updateField(p) {
      const f = (await one('fields', p.id)) || fail('Поле не найдено', 'NOT_FOUND');
      const upd = {};
      if ('name' in p) upd.name = req(str(p.name, 60), 'Название поля');
      if ('type' in p) upd.type = FIELD_TYPES.includes(p.type) ? p.type : 'text';
      if ('options' in p) upd.options = cleanOptions(p.options);
      if ('showOnCard' in p) upd.show_on_card = !!p.showOnCard;
      if ('required' in p) upd.required = !!p.required;
      if ('requiredFrom' in p) upd.required_from = str(p.requiredFrom, 40);
      if ('staffOnly' in p) upd.staff_only = !!p.staffOnly;
      if ('requiredOnCreate' in p) upd.required_on_create = !!p.requiredOnCreate;
      // приоритет остаётся выбором из списка
      if (f.role === 'priority' && upd.type && upd.type !== 'select') fail('Приоритет — всегда список вариантов');
      if ('archived' in p) upd.archived = !!p.archived;
      await updateOne('fields', f.id, upd);
      return fieldOut({ ...f, ...upd });
    },

    async reorderFields(p) {
      // unitId пустой — порядок общих полей
      await Promise.all((p.ids || []).map((id, i) => {
        const q = T('fields').update({ ord: i + 1 }).eq('id', String(id));
        return run(p.unitId ? q.eq('unit_id', String(p.unitId)) : q.is('unit_id', null));
      }));
      return true;
    },

    /** Удаление навсегда: поле и его значения во всех задачах юнита. */
    async deleteField(p) {
      const f = (await one('fields', p.id)) || fail('Поле не найдено', 'NOT_FOUND');
      await rpc('delete_field', { p_field: f.id });
      return true;
    },

    /* ---------- отделы (общий справочник) ---------- */

    /* ---------- личная доска ---------- */

    /**
     * Моя доска: задачи, назначенные на человека (из всех юнитов), где лежит каждая на его доске,
     * и юниты этих задач с колонками (для типа статуса). Этапы самой доски — в people.prefs.myBoard.
     */
    async getMyBoard(p) {
      const me = str(p.personId, 40);
      const rows = await all(() => T('tasks').select('*').eq('assignee_id', me).eq('archived', false).order('id'));
      const unitIds = [...new Set(rows.map(t => t.unit_id))];
      const [units, places] = await Promise.all([
        unitIds.length ? run(T('units').select('id,name,key,color,settings,archived').in('id', unitIds)) : [],
        all(() => T('my_board').select('task_id,stage,ord').eq('person_id', me).order('task_id')),
      ]);
      const live = new Set(units.filter(u => !u.archived).map(u => u.id));
      return {
        tasks: rows.filter(t => live.has(t.unit_id)).map(taskOut),
        units: units.filter(u => !u.archived).map(u => ({ id: u.id, name: u.name, key: u.key, color: u.color, columns: unitSettings(u.settings).columns })),
        placement: Object.fromEntries(places.map(r => [r.task_id, { stage: r.stage, order: Number(r.ord) }])),
      };
    },

    /** Положить задачу в этап своей доски (порядок — order). Чужую доску база не даст тронуть. */
    async setMyBoardItem(p) {
      const row = { person_id: str(p.personId, 40), task_id: str(p.taskId, 40), stage: str(p.stage, 40), ord: Number(p.order) || 0 };
      await run(T('my_board').upsert(row, { onConflict: 'person_id,task_id' }));
      return true;
    },

    /* ---------- команды (общий справочник) ---------- */

    async createTeam(p) {
      const n = (await teams()).length;
      const t = { id: uid('t'), name: req(str(p.name, 40), 'Название команды'), color: color(p.color, PALETTE[n % PALETTE.length]), ord: (await maxOrd('teams')) + 1, archived: false };
      await run(T('teams').insert(t));
      return teamOut(t);
    },

    async updateTeam(p) {
      const t = (await one('teams', p.id)) || fail('Команда не найдена', 'NOT_FOUND');
      const upd = {};
      if ('name' in p) upd.name = req(str(p.name, 40), 'Название команды');
      if ('color' in p) upd.color = color(p.color, t.color);
      if ('archived' in p) upd.archived = !!p.archived;
      if ('boardTemplate' in p) {
        upd.board_template = cleanStages(p.boardTemplate);
        if (!upd.board_template.length) fail('Нужен хотя бы один этап');
      }
      await updateOne('teams', t.id, upd);
      return teamOut({ ...t, ...upd });
    },

    async reorderTeams(p) {
      await Promise.all((p.ids || []).map((id, i) => run(T('teams').update({ ord: i + 1 }).eq('id', String(id)))));
      return teams();
    },

    async deleteTeam(p) {
      const t = (await one('teams', p.id)) || fail('Команда не найдена', 'NOT_FOUND');
      await rpc('delete_team', { p_team: t.id });
      return true;
    },

    async createDepartment(p) {
      const count = (await run(T('departments').select('id'))).length;
      const d = { id: uid('d'), name: req(str(p.name, 40), 'Название отдела'), color: color(p.color, PALETTE[count % PALETTE.length]), ord: (await maxOrd('departments')) + 1, archived: false };
      await run(T('departments').insert(d));
      return deptOut(d);
    },

    async updateDepartment(p) {
      const d = (await one('departments', p.id)) || fail('Отдел не найден', 'NOT_FOUND');
      const upd = {};
      if ('name' in p) upd.name = req(str(p.name, 40), 'Название отдела');
      if ('color' in p) upd.color = color(p.color, d.color);
      if ('archived' in p) upd.archived = !!p.archived;
      await updateOne('departments', d.id, upd);
      return deptOut({ ...d, ...upd });
    },

    async reorderDepartments(p) {
      await Promise.all((p.ids || []).map((id, i) => run(T('departments').update({ ord: i + 1 }).eq('id', String(id)))));
      return departments();
    },

    /** Удаление: задачи и участники этого отдела остаются, но без отдела. */
    async deleteDepartment(p) {
      const d = (await one('departments', p.id)) || fail('Отдел не найден', 'NOT_FOUND');
      await rpc('delete_department', { p_dept: d.id });
      return true;
    },

    /* ---------- состав юнита ---------- */

    /** Добавить человека в команду или сменить его отдел в ней. */
    /**
     * Сменить ответственного (PM) юнита: новый PM — в составе, прежние PM — из состава вон,
     * их открытые задачи CEO (запросы) переходят новому.
     */
    async setUnitPm(p) {
      const u = await findUnit(p.unitId);
      const pm = (await one('people', p.personId)) || fail('Человек не найден', 'NOT_FOUND');
      if (pm.access !== 'moderator') fail('Ответственным за юнит может быть только PM');
      const old = (await unitPeople(u.id, 'moderator')).filter(x => x.id !== pm.id).map(x => x.id);
      await methods.setMember({ unitId: u.id, personId: pm.id, departmentId: pm.position_id || '' });
      for (const id of old) await methods.removeMember({ unitId: u.id, personId: id });
      if (old.length) {
        const st = unitSettings(u.settings);
        const open = (await run(T('tasks').select('id,status').eq('unit_id', u.id).eq('kind', 'request').eq('archived', false).in('assignee_id', old)))
          .filter(t => kindOf(st, t.status) !== 'done');
        for (const t of open) await methods.updateTask({ id: t.id, patch: { assigneeId: pm.id } });
      }
      return unitMembers(u.id);
    },

    async setMember(p) {
      const u = await findUnit(p.unitId);
      (await one('people', p.personId)) || fail('Человек не найден', 'NOT_FOUND');
      const existing = await run(T('unit_members').select('created_at').eq('unit_id', u.id).eq('person_id', String(p.personId)).maybeSingle());
      await run(T('unit_members').upsert({
        unit_id: u.id, person_id: String(p.personId), department_id: await validDept(p.departmentId),
        created_at: existing ? existing.created_at : now(),
      }, { onConflict: 'unit_id,person_id' }));
      return unitMembers(u.id);
    },

    /** Убрать из команды. Задачи человека не трогаем — исполнитель остаётся. */
    async removeMember(p) {
      await run(T('unit_members').delete().eq('unit_id', String(p.unitId ?? '')).eq('person_id', String(p.personId ?? '')));
      return unitMembers(String(p.unitId ?? ''));
    },

    /* ---------- приложения (Tasks 2.0) ---------- */

    /** Статусы приложения (настраиваемый список; по умолчанию — из schema.sql). */
    async getAppStatuses() {
      return appStatuses();
    },

    async saveAppStatuses(p) {
      const list = cleanAppStatuses(p.statuses);
      if (!list.length) fail('Нужен хотя бы один статус');
      await run(T('app_settings').upsert({ key: 'appStatuses', value: list, updated_at: now() }, { onConflict: 'key' }));
      return list;
    },

    /** Флоу декомпозиции по типу запроса: сохранённый в настройках или по умолчанию. */
    /** Флоу юнита (unitId) или студии по умолчанию. */
    async getFlows(p) {
      return flows(p.unitId ? String(p.unitId) : '');
    },

    /** Сохранить флоу типа запроса: у юнита (unitId — правят CEO и PM юнита) или студии (без unitId — только CEO). */
    async saveFlow(p) {
      if (!REQUEST_TYPES[p.type]) fail('Неизвестный тип запроса');
      const steps = cleanFlow(p.steps);
      if (p.unitId) {
        const u = await findUnit(p.unitId);
        const st = unitSettings(u.settings);
        await methods.updateUnit({ id: u.id, settings: { ...st, flows: { ...st.flows, [p.type]: steps } } });
        return flows(u.id);
      }
      const all = { ...(await flows()), [p.type]: steps };
      await run(T('app_settings').upsert({ key: 'flows', value: all, updated_at: now() }, { onConflict: 'key' }));
      return all;
    },

    /**
     * Приложения со сводкой по работам: открытые запросы (тип, этап, прогресс этапов). unitId — только этого юнита.
     * Видно: CEO — все, остальным — приложения своих юнитов (правила базы).
     */
    /* ---------- заметки к приложению ---------- */

    async getAppNotes(p) {
      return (await run(T('app_notes').select('*').eq('app_id', String(p.appId)).order('at', { ascending: false })))
        .map(r => ({ id: r.id, appId: r.app_id, authorId: r.author_id, text: r.text, at: r.at }));
    },

    async addAppNote(p, ctx) {
      const text = req(str(p.text, 5000), 'Текст заметки');
      const row = { id: uid('n'), app_id: String(p.appId), author_id: actor(ctx), text, at: now() };
      await run(T('app_notes').insert(row));
      return { id: row.id, appId: row.app_id, authorId: row.author_id, text, at: row.at };
    },

    async deleteAppNote(p) {
      const gone = await run(T('app_notes').delete().eq('id', String(p.id ?? '')).select('id'));
      if (!gone.length) fail('Удалить можно только свою заметку', 'FORBIDDEN');
      return true;
    },

    async listApps(p) {
      let q = T('apps').select('*').eq('archived', !!p.archived);
      if (p.unitId) q = q.eq('unit_id', String(p.unitId));
      const apps = (await run(q.order('ord').order('created_at'))).map(appOut);
      if (!apps.length) return [];
      const [tasks, units] = await Promise.all([
        all(() => T('tasks').select('id,unit_id,num,title,status,assignee_id,due_date,archived,kind,request_type,step,parent_id,app_id,depends_on,fields,created_at,updated_at,done_at')
          .in('app_id', apps.map(a => a.id)).eq('archived', false).order('created_at').order('id')),
        all(() => T('units').select('id,key,settings').order('id')),
      ]);
      const U = Object.fromEntries(units.map(u => [u.id, { ...u, st: unitSettings(u.settings) }]));
      const kindOfRow = r => (U[r.unit_id] ? kindOf(U[r.unit_id].st, r.status) : 'todo');
      const doneRow = r => kindOfRow(r) === 'done';
      return apps.map(a => {
        const own = tasks.filter(t => t.app_id === a.id);
        const requests = own.filter(t => t.kind === 'request').map(r => {
          // этапы флоу и задачи, которые PM поставил под запрос вручную
          const stages = own.filter(t => t.parent_id === r.id && t.kind !== 'request');
          const done = stages.filter(doneRow);
          return {
            id: r.id, unitId: r.unit_id, key: U[r.unit_id] ? `${U[r.unit_id].key}-${r.num}` : '', title: r.title, type: r.request_type,
            assigneeId: r.assignee_id, dueDate: r.due_date, done: doneRow(r), statusKind: kindOfRow(r),
            priority: (json(r.fields, {}) || {})[PRIORITY_FIELD] || '', createdAt: r.created_at, updatedAt: r.updated_at, doneAt: r.done_at || '',
            stages: stages.map(t => ({ id: t.id, unitId: t.unit_id, step: t.step, title: t.title, assigneeId: t.assignee_id, kind: kindOfRow(t),
              dueDate: t.due_date, updatedAt: t.updated_at,
              done: doneRow(t), blocked: !doneRow(t) && (json(t.depends_on, []) || []).some(id => { const d = own.find(x => x.id === id); return d && !doneRow(d); }) })),
            progress: stages.length ? Math.round((done.length / stages.length) * 100) : 0,
          };
        });
        // последняя работа с приложением: само приложение, его задачи и этапы — чтобы видеть забытые
        const lastActivity = [a.updatedAt, a.statusAt, ...own.map(t => t.updated_at)].filter(Boolean).sort().pop() || a.createdAt || '';
        return { ...a, requests, active: requests.filter(r => !r.done).length, lastActivity };
      });
    },

    /**
     * Новое приложение (CEO): сущность в юните + запрос «New App» PM юнита (pmId — конкретный PM, иначе первый PM юнита).
     * test — шорткат разработчика: всё помечается тестовым.
     */
    async createApp(p, ctx) {
      const unit = await findUnit(p.unitId);
      const statuses = await appStatuses();
      const ts = now();
      const app = {
        id: uid('app'), unit_id: unit.id, name: req(str(p.name, 120), 'Название'), color: color(p.color, PALETTE[Math.floor(Math.random() * PALETTE.length)]),
        status: (statuses.find(x => x.id === p.status) || statuses.find(x => x.kind === 'dev') || statuses[0]).id, info: {}, ord: (await maxOrd('apps', { unit_id: unit.id })) + 1,
        archived: false, is_test: !!p.test, created_by: actor(ctx), created_at: ts, updated_at: ts,
        priority: await validPriority(p.priority), status_at: ts, icon_url: iconUrl(p.iconUrl), store_name: str(p.storeName, 200),
      };
      // ссылка на стор — сразу в поле «App Store», если оно есть
      const store = p.storeUrl && (await appFields()).find(f => f.kind === 'link' && /app ?store/i.test(f.name) && !/connect/i.test(f.name));
      if (store) { const v = linkUrl(p.storeUrl); if (v) app.info = { [store.id]: v }; }
      await run(T('apps').insert(app));
      // уже существующее приложение (импорт списком) — без запроса «New App»
      if (p.noRequest) return { app: appOut(app), request: null };
      const request = await methods.createRequest({
        appId: app.id, type: 'new_app', title: str(p.requestTitle, 500) || `New App: ${app.name}`, description: p.description,
        pmId: p.pmId, dueDate: p.dueDate, priority: app.priority,
      }, ctx);
      return { app: appOut(app), request };
    },

    /**
     * Итог проверки App Store (кнопка «Обновить»): items [{ id, ok, storeName?, iconUrl? }] — открывается ли страница в сторе.
     * «Обновлено» у приложения не трогает: проверка — не работа над ним. Права — как на правку приложения (база).
     */
    async saveStoreCheck(p) {
      const at = now();
      let n = 0;
      for (const x of (Array.isArray(p.items) ? p.items : []).slice(0, 2000)) {
        const upd = { store_ok: !!x.ok, store_checked_at: at };
        if (x.ok && x.storeName) upd.store_name = str(x.storeName, 200);
        if (x.ok && x.iconUrl) upd.icon_url = iconUrl(x.iconUrl);
        n += (await run(T('apps').update(upd).eq('id', String(x.id ?? '')).select('id'))).length;
      }
      return { saved: n, at };
    },

    /** Массовая правка приложений: статус, приоритет ('' — снять) и/или юнит (юнит — только CEO, задачи едут вместе). Возвращает обновлённые. */
    async updateApps(p, ctx) {
      const ids = (Array.isArray(p.ids) ? p.ids : []).map(x => String(x ?? '')).filter(Boolean);
      const patch = {};
      if (p.status) patch.status = String(p.status);
      if ('priority' in p) patch.priority = String(p.priority ?? '');
      if (p.unitId) patch.unitId = String(p.unitId);
      if (!ids.length || !Object.keys(patch).length) return [];
      const out = [];
      for (const id of ids) out.push(await methods.updateApp({ id, ...patch }, ctx));
      return out;
    },

    /** Удалить приложения (только CEO) вместе с их задачами — запросами, этапами, реджектами. Возвращает число удалённых. */
    async deleteApps(p) {
      const ids = (Array.isArray(p.ids) ? p.ids : [p.id]).map(x => String(x ?? '')).filter(Boolean);
      if (!ids.length) return { apps: 0, tasks: 0 };
      const gone = await run(T('apps').delete().in('id', ids).select('id'));
      if (!gone.length) fail('Недостаточно прав для этого действия', 'FORBIDDEN');
      const done = gone.map(x => x.id);
      const tasks = await run(T('tasks').delete().in('app_id', done).select('id'));
      return { apps: done.length, tasks: tasks.length };
    },

    /**
     * Поправить приложение: название, цвет, статус, приоритет, порядок (order — приоритет внутри колонки канбана), инфо-поля.
     * Юнит — только CEO (проверяет база): задачи приложения переезжают с ним, открытые запросы — PM нового юнита.
     */
    async updateApp(p, ctx) {
      const a = (await one('apps', p.id)) || fail('Приложение не найдено', 'NOT_FOUND');
      const upd = {};
      if ('name' in p) upd.name = req(str(p.name, 120), 'Название');
      if ('color' in p) upd.color = color(p.color, a.color);
      if ('status' in p && p.status !== a.status) {
        upd.status = (await appStatuses()).some(x => x.id === p.status) ? p.status : fail('Нет такого статуса');
        upd.status_at = now();
      }
      if ('priority' in p) upd.priority = await validPriority(p.priority);
      if ('iconUrl' in p) upd.icon_url = iconUrl(p.iconUrl);
      if ('storeName' in p) upd.store_name = str(p.storeName, 200);
      if ('checks' in p) upd.checks = cleanChecks(p.checks);
      if ('ownFields' in p) upd.own_fields = cleanOwnFields(p.ownFields);
      if ('order' in p && Number.isFinite(Number(p.order))) upd.ord = Number(p.order);
      if ('unitId' in p && p.unitId !== a.unit_id) upd.unit_id = (await findUnit(p.unitId)).id;
      if ('info' in p) {
        const known = new Set((await appFields()).map(f => f.id));
        const info = { ...(json(a.info, {}) || {}) };
        for (const [k, v] of Object.entries(p.info || {})) {
          if (!known.has(k)) continue;
          const f = (await appFields()).find(x => x.id === k);
          const val = f.kind === 'link' ? linkUrl(v) : str(v, 500);
          if (val) info[k] = val; else delete info[k];
        }
        upd.info = info;
      }
      if ('archived' in p) upd.archived = !!p.archived;
      if (!Object.keys(upd).length) return appOut(a);
      upd.updated_at = now();
      await updateOne('apps', a.id, upd);
      if (upd.unit_id) await moveAppTasks(a, upd.unit_id, ctx);
      return appOut({ ...a, ...upd });
    },

    /**
     * Дашборд PM по его юнитам (CEO — по всем; видимость решает база): входящие от CEO (запросы без разбивки),
     * приложения по этапам (открытые запросы с этапами), проблемы (просрочено, без движения, без исполнителя,
     * долго на ревью, готово к релизу) и команда с KPI за период (week / month / quarter).
     */
    async getPmDashboard(p) {
      const day = today(p.today);
      const periodDays = { week: 7, month: 30, quarter: 90 }[p.period] || 30;
      const from = new Date(Date.now() - periodDays * 864e5).toISOString();
      const [units, tasks, members, ppl, apps, staleRow] = await Promise.all([
        all(() => T('units').select('id,name,key,color,settings').eq('archived', false).order('ord').order('id')),
        all(() => T('tasks').select('id,unit_id,num,title,status,assignee_id,due_date,archived,kind,request_type,step,parent_id,app_id,depends_on,created_at,updated_at,done_at,started_at,department_id')
          .eq('archived', false).order('created_at').order('id')),
        all(() => T('unit_members').select('unit_id,person_id').order('unit_id')),
        people(),
        all(() => T('apps').select('id,name,color,icon_url,unit_id,status,priority,is_test').order('id')),
        setting('staleDays'),
      ]);
      const U = Object.fromEntries(units.map(u => [u.id, { ...u, st: unitSettings(u.settings) }]));
      const A = Object.fromEntries(apps.map(a => [a.id, { id: a.id, name: a.name, color: a.color, iconUrl: a.icon_url || '', unitId: a.unit_id, status: a.status, priority: a.priority || '', isTest: !!a.is_test }]));
      const own = tasks.filter(t => U[t.unit_id]);
      const kindOfRow = t => kindOf(U[t.unit_id].st, t.status);
      const done = t => kindOfRow(t) === 'done';
      const byId = Object.fromEntries(own.map(t => [t.id, t]));
      const blocked = t => !done(t) && (json(t.depends_on, []) || []).some(id => byId[id] && !done(byId[id]));
      const staleBefore = new Date(Date.now() - Math.max(1, Number(staleRow) || 7) * 864e5).toISOString();
      const reviewBefore = new Date(Date.now() - 2 * 864e5).toISOString();
      const key = t => `${U[t.unit_id].key}-${t.num}`;
      const brief = t => ({ id: t.id, unitId: t.unit_id, key: key(t), title: t.title, assigneeId: t.assignee_id, dueDate: t.due_date,
        updatedAt: t.updated_at, step: t.step || '', type: t.request_type || '', kind: kindOfRow(t), done: done(t), blocked: blocked(t), app: A[t.app_id] || null });
      const kids = id => own.filter(t => t.parent_id === id && t.kind !== 'request');

      const requests = own.filter(t => t.kind === 'request' && !done(t));
      const inbox = requests.filter(r => !kids(r.id).length).map(brief);
      const pipeline = requests.filter(r => kids(r.id).length).map(r => {
        const stages = kids(r.id).map(brief);
        const release = stages.find(s => s.step === 'release');
        return { ...brief(r), type: r.request_type, stages,
          progress: Math.round(stages.filter(s => s.done).length / stages.length * 100),
          releaseReady: !!(release && !release.assigneeId && !release.blocked && !release.done) };
      });

      const problems = [];
      for (const t of own.filter(x => !done(x))) {
        const b = brief(t);
        const review = U[t.unit_id].st.review.column;
        if (t.step === 'release' && !t.assignee_id) { if (!b.blocked) problems.push({ type: 'release', task: b }); continue; }
        if (t.due_date && t.due_date < day) problems.push({ type: 'overdue', task: b });
        else if (review && t.status === review && t.updated_at < reviewBefore) problems.push({ type: 'review', task: b });
        else if (!b.blocked && t.updated_at < staleBefore) problems.push({ type: 'stale', task: b });
        if (!t.assignee_id && t.kind !== 'request') problems.push({ type: 'unassigned', task: b });
      }
      const rank = { overdue: 0, release: 1, review: 2, unassigned: 3, stale: 4 };
      problems.sort((x, y) => rank[x.type] - rank[y.type] || (x.task.dueDate || x.task.updatedAt).localeCompare(y.task.dueDate || y.task.updatedAt));

      // команда: участники этих юнитов, кроме CEO и PM
      const ids = new Set(members.filter(m => U[m.unit_id]).map(m => m.person_id));
      const team = ppl.filter(x => x.active && ids.has(x.id) && !['superadmin', 'moderator'].includes(x.access)).map(x => {
        const mine = own.filter(t => t.assignee_id === x.id);
        const closed = mine.filter(t => done(t) && t.done_at >= from);
        const withDue = closed.filter(t => t.due_date);
        const onTime = withDue.filter(t => t.done_at.slice(0, 10) <= t.due_date).length;
        const spans = closed.map(t => (Date.parse(t.done_at) - Date.parse(t.started_at || t.created_at)) / 864e5).filter(d => d >= 0);
        return {
          personId: x.id, done: closed.length, onTime: withDue.length ? Math.round(onTime / withDue.length * 100) : null,
          inProgress: mine.filter(t => kindOfRow(t) === 'progress').length,
          overdue: mine.filter(t => !done(t) && t.due_date && t.due_date < day).length,
          avgDays: spans.length ? Math.round(spans.reduce((a, b) => a + b, 0) / spans.length * 10) / 10 : null,
        };
      });
      return { inbox, pipeline, problems, team, period: { days: periodDays, from } };
    },

    /** Поля приложения (быстрый доступ на карточке): ссылки и тексты. */
    async getAppFields() {
      return appFields();
    },

    /** Общие пункты Info (CEO): список { id, name }; отметки приложений по удалённым пунктам просто перестают показываться. */
    async saveAppInfoItems(p) {
      const list = cleanInfoItems(p.items);
      await run(T('app_settings').upsert({ key: 'appInfoItems', value: list, updated_at: now() }, { onConflict: 'key' }));
      return list;
    },

    async saveAppFields(p) {
      const list = cleanAppFields(p.fields);
      await run(T('app_settings').upsert({ key: 'appFields', value: list, updated_at: now() }, { onConflict: 'key' }));
      return list;
    },

    /**
     * Дашборд CEO: портфель по статусам (и по юнитам), что требует внимания (реджекты, просрочки, без движения
     * staleDays дней, запрос без разбивки или без PM), работы в ходу (открытые запросы с текущим этапом), недавно вышло (14 дней).
     */
    async getCeoDashboard(p) {
      const day = today(p.today);
      const [apps, statuses, staleRow] = await Promise.all([methods.listApps({}), appStatuses(), setting('staleDays')]);
      const staleDays = Math.max(1, Number(staleRow) || 7);
      const staleBefore = new Date(Date.now() - staleDays * 864e5).toISOString();
      const recentFrom = new Date(Date.now() - 30 * 864e5).toISOString();
      const kindOfStatus = id => (statuses.find(x => x.id === id) || {}).kind || '';
      const brief = a => ({ id: a.id, name: a.name, color: a.color, iconUrl: a.iconUrl, unitId: a.unitId, status: a.status, priority: a.priority, isTest: a.isTest });
      const portfolio = { byStatus: {}, byUnit: {} };
      for (const a of apps) {
        (portfolio.byStatus[a.status] || (portfolio.byStatus[a.status] = [])).push(a.id);
        const u = portfolio.byUnit[a.unitId] || (portfolio.byUnit[a.unitId] = {});
        u[a.status] = (u[a.status] || 0) + 1;
      }
      const attention = [], inProgress = [], recent = [];
      for (const a of apps) {
        if (kindOfStatus(a.status) === 'reject') attention.push({ type: 'reject', app: brief(a), at: a.statusAt });
        for (const r of a.requests) {
          // начало разработки — запрос «New App»
          if (r.type === 'new_app' && r.createdAt >= recentFrom) recent.push({ type: 'start', app: brief(a), request: r, at: r.createdAt });
          if (r.done) {
            if (r.doneAt >= recentFrom) recent.push({ type: 'done', app: brief(a), request: r, at: r.doneAt });
            continue;
          }
          const open = [r, ...r.stages.filter(s => !s.done)];
          for (const t of open) {
            const ref = { id: t.id, title: t.title, assigneeId: t.assigneeId, dueDate: t.dueDate, updatedAt: t.updatedAt };
            if (t.dueDate && t.dueDate < day) attention.push({ type: 'overdue', app: brief(a), request: r, task: ref, at: t.dueDate });
            else if (!t.blocked && t.updatedAt && t.updatedAt < staleBefore) attention.push({ type: 'stale', app: brief(a), request: r, task: ref, at: t.updatedAt });
          }
          if (!r.assigneeId) attention.push({ type: 'nopm', app: brief(a), request: r, at: r.createdAt });
          else if (!r.stages.length) attention.push({ type: 'waiting', app: brief(a), request: r, at: r.createdAt });
          const current = r.stages.find(s => !s.done && !s.blocked && s.kind !== 'todo') || r.stages.find(s => !s.done && !s.blocked) || null;
          inProgress.push({ app: brief(a), request: r, current });
        }
      }
      // движение по статусам приложений за 30 дней — из истории статусов (импорт и создание сюда не попадают)
      const byId = Object.fromEntries(apps.map(a => [a.id, a]));
      const log = await run(T('app_status_log').select('*').gte('at', recentFrom).order('at', { ascending: false }).limit(300));
      for (const x of log) {
        const a = byId[x.app_id];
        if (a) recent.push({ type: 'status', app: brief(a), from: x.from_status, to: x.to_status, byId: x.by_id, at: x.at });
      }
      const rank = { reject: 0, overdue: 1, nopm: 2, waiting: 3, stale: 4 };
      attention.sort((x, y) => rank[x.type] - rank[y.type] || String(x.at).localeCompare(String(y.at)));
      recent.sort((x, y) => String(y.at).localeCompare(String(x.at)));
      return { portfolio, attention, inProgress, recent: recent.slice(0, 200), staleDays, statuses };
    },

    /**
     * Запрос CEO по приложению → PM юнита приложения: type new_app / update / other.
     * Задача лежит в юните приложения, тип request; pmId — конкретный PM (иначе первый PM юнита).
     */
    async createRequest(p, ctx) {
      const a = (await one('apps', p.appId)) || fail('Приложение не найдено', 'NOT_FOUND');
      const type = REQUEST_TYPES[p.type] ? p.type : 'other';
      const pms = await unitPeople(a.unit_id, 'moderator');
      const pmId = p.pmId && pms.some(x => x.id === p.pmId) ? p.pmId : pms.length ? pms[0].id : '';
      const prio = await validPriority('priority' in p ? p.priority : a.priority);
      return methods.createTask({
        unitId: a.unit_id, title: str(p.title, 500) || `${REQUEST_TYPES[type]}: ${a.name}`, description: p.description,
        assigneeId: pmId, dueDate: p.dueDate, kind: 'request', requestType: type, appId: a.id, test: !!a.is_test,
        fields: prio ? { [PRIORITY_FIELD]: prio } : {},
      }, ctx);
    },

    /**
     * Разложить запрос по флоу (PM): этапы — дочерние задачи с позицией, зависимостями и исполнителем
     * (лид позиции в юните, иначе первый с этой позицией; у релиза — никого, пока не передадут RM).
     * Запрос уходит «в работу». Повторно не раскладывает.
     */
    async decomposeRequest(p, ctx) {
      const r = await findTask(p.taskId);
      if (r.kind !== 'request') fail('Разложить по флоу можно только запрос');
      const existing = await run(T('tasks').select('id').eq('parent_id', r.id).eq('kind', 'stage').limit(1));
      if (existing.length) fail('Запрос уже разложен по этапам');
      // план из окна предпросмотра (этапы, исполнители, сроки) или флоу юнита по умолчанию
      const plan = Array.isArray(p.plan) ? p.plan : null;
      const steps = plan ? cleanFlow(plan) : (await flows(r.unit_id))[r.request_type] || [];
      if (!steps.length) fail(plan ? 'Оставьте хотя бы один этап' : 'Для этого типа запроса нет флоу — создайте задачи вручную');
      const extra = Object.fromEntries((plan || []).map(x => [x && x.key, x || {}]));
      const people = await unitPeople(r.unit_id);
      const pick = positionId => {
        const withPos = people.filter(x => x.positionIds.includes(positionId));
        return (withPos.find(x => x.access === 'lead') || withPos[0] || {}).id || '';
      };
      const who = st => (st.release ? '' : extra[st.key] && 'assigneeId' in extra[st.key] ? str(extra[st.key].assigneeId, 40) : pick(st.positionId));
      const due = st => (extra[st.key] && 'dueDate' in extra[st.key] ? date(extra[st.key].dueDate) : r.due_date);
      const ids = {}, created = [];
      const prio = (json(r.fields, {}) || {})[PRIORITY_FIELD]; // приоритет запроса — этапам
      for (const st of steps) {
        const t = await methods.createTask({
          unitId: r.unit_id, title: `${st.title} · ${r.title.replace(/^New App:\s*/, '')}`, parentId: r.id, kind: 'stage', step: st.key,
          appId: r.app_id, departmentId: st.positionId, assigneeId: who(st), dueDate: due(st),
          dependsOn: st.dependsOn.map(k => ids[k]).filter(Boolean), test: !!r.is_test, fields: prio ? { [PRIORITY_FIELD]: prio } : {},
        }, ctx);
        ids[st.key] = t.id;
        created.push(t);
      }
      // запрос — в работу (первая колонка типа «в работе»)
      const st = unitSettings((await findUnit(r.unit_id)).settings);
      const col = st.columns.find(c => c.kind === 'progress');
      if (col && kindOf(st, r.status) === 'todo') await methods.updateTask({ id: r.id, patch: { status: col.id } }, ctx);
      return created;
    },

    /**
     * Передать в релиз (PM): этап release получает исполнителя-RM (rmId или первый RM юнита) — только когда
     * закрыты все этапы, от которых он зависит. Статус приложения — «Релиз».
     */
    async sendToRelease(p, ctx) {
      const t = await findTask(p.taskId);
      if (t.kind !== 'stage' || t.step !== 'release') fail('Передать в релиз можно только этап «Релиз»');
      const open = await rpc('open_deps', { p_deps: json(t.depends_on, []) || [] });
      if (open) fail(`Сначала закройте: ${open}`, 'RULE');
      const rms = await unitPeople(t.unit_id, 'rm');
      const rmId = p.rmId && rms.some(x => x.id === p.rmId) ? p.rmId : rms.length ? rms[0].id : fail('В юните нет релиз-менеджера — добавьте RM в состав');
      // чеклист релиза студии — в этап (если своего ещё нет)
      const tpl = cleanReleaseChecklist(await setting('releaseChecklist'));
      const patch = { assigneeId: rmId };
      if (tpl.length && !(json(t.checklist, []) || []).length) patch.checklist = tpl.map(text => ({ text, done: false }));
      const saved = await methods.updateTask({ id: t.id, patch }, ctx);
      if (t.app_id) {
        const rel = (await appStatuses()).find(x => x.kind === 'release');
        if (rel) await methods.updateApp({ id: t.app_id, status: rel.id }).catch(() => null);
      }
      return saved;
    },

    /* ---------- сотрудник и лид ---------- */

    /**
     * Дашборд сотрудника: фокус (мои открытые задачи — просрочено, срок сегодня/завтра, в работе; заблокированные этапы не здесь).
     * Лиду ещё: очередь ревью (задачи сотрудников на его ревью: «Принять» — колонка готово, «Вернуть» — колонка перед ревью)
     * и загрузка людей его позиций в его юнитах. personId — кто смотрит (в «смотреть как» — за кого).
     */
    async getMyDashboard(p) {
      const day = today(p.today);
      const tomorrow = new Date(Date.parse(day) + 864e5).toISOString().slice(0, 10);
      const meId = str(p.personId, 40);
      const [tasks, units, apps, ppl, members] = await Promise.all([
        all(() => T('tasks').select('id,unit_id,num,title,status,assignee_id,due_date,archived,kind,step,app_id,depends_on,fields,review_from,department_id,updated_at')
          .eq('archived', false).order('id')),
        all(() => T('units').select('id,key,name,color,settings').eq('archived', false).order('ord').order('id')),
        all(() => T('apps').select('id,name,color,icon_url,priority').order('id')),
        people(), all(() => T('unit_members').select('unit_id,person_id').order('unit_id')),
      ]);
      const U = Object.fromEntries(units.map(u => [u.id, { ...u, st: unitSettings(u.settings) }]));
      const A = Object.fromEntries(apps.map(a => [a.id, { id: a.id, name: a.name, color: a.color, iconUrl: a.icon_url || '', priority: a.priority || '' }]));
      const vis = tasks.filter(t => U[t.unit_id]);
      const kindOfRow = t => kindOf(U[t.unit_id].st, t.status);
      const byId = Object.fromEntries(vis.map(t => [t.id, t]));
      const done = t => kindOfRow(t) === 'done';
      const blocked = t => (json(t.depends_on, []) || []).some(id => byId[id] && !done(byId[id]));
      const col = t => columnOf(U[t.unit_id].st, t.status);
      const brief = t => ({ id: t.id, unitId: t.unit_id, key: `${U[t.unit_id].key}-${t.num}`, title: t.title, dueDate: t.due_date, kind: kindOfRow(t),
        statusName: col(t).name, priority: (json(t.fields, {}) || {}).f_priority || (A[t.app_id] || {}).priority || '', app: A[t.app_id] || null, updatedAt: t.updated_at });

      const person = ppl.find(x => x.id === meId);
      const isLead = !!person && person.access === 'lead';
      const reviewing = t => !!t.review_from && t.status === U[t.unit_id].st.review.column;
      // у лида задачи на его ревью — в своей очереди, не в фокусе
      const mine = vis.filter(t => t.assignee_id === meId && !done(t) && !blocked(t) && !(isLead && reviewing(t)));
      const reason = t => (t.due_date && t.due_date < day ? 'overdue' : t.due_date === day ? 'today' : t.due_date === tomorrow ? 'tomorrow' : kindOfRow(t) === 'progress' ? 'progress' : '');
      const rankR = { overdue: 0, today: 1, tomorrow: 2, progress: 3 };
      const focus = mine.map(t => ({ ...brief(t), reason: reason(t) })).filter(t => t.reason)
        .sort((a, b) => rankR[a.reason] - rankR[b.reason] || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));

      if (!isLead) return { focus, lead: null };
      // очередь ревью: на мне, отправлено на ревью, лежит в колонке ревью
      const reviews = vis.filter(t => t.assignee_id === meId && reviewing(t)).map(t => {
        const cols = U[t.unit_id].st.columns;
        const i = cols.findIndex(c => c.id === t.status);
        const back = [...cols.slice(0, i)].reverse().find(c => c.kind !== 'done') || cols[0];
        const fin = cols.find(c => c.kind === 'done');
        return { ...brief(t), authorId: t.review_from, acceptStatus: fin ? fin.id : '', returnStatus: back.id };
      });
      // загрузка: люди моих позиций в моих юнитах
      const myUnits = new Set(members.filter(m => m.person_id === meId).map(m => m.unit_id));
      const inMine = new Set(members.filter(m => myUnits.has(m.unit_id)).map(m => m.person_id));
      const team = ppl.filter(x => x.active && inMine.has(x.id) && x.positionIds.some(id => person.positionIds.includes(id))).map(x => {
        const own = vis.filter(t => t.assignee_id === x.id && !done(t));
        return { personId: x.id, open: own.length, inProgress: own.filter(t => kindOfRow(t) === 'progress').length,
          overdue: own.filter(t => t.due_date && t.due_date < day).length, waiting: own.filter(blocked).length };
      }).sort((a, b) => b.open - a.open);
      return { focus, lead: { reviews, team } };
    },

    /** Лид передаёт свою задачу сотруднику своей позиции в юните (проверяет база). */
    async handOverTask(p) {
      const t = await findTask(p.taskId);
      await rpc('lead_handover', { p_task: t.id, p_person: str(p.personId, 40) });
      return taskOut(await findTask(t.id));
    },

    /* ---------- релиз (RM) ---------- */

    /** Релизные поля и чеклист релиза студии (настраивают CEO и RM). */
    async getReleaseSettings() {
      return { fields: cleanReleaseFields(await setting('releaseFields')), checklist: cleanReleaseChecklist(await setting('releaseChecklist')) };
    },

    async saveReleaseSettings(p) {
      if ('fields' in p) await run(T('app_settings').upsert({ key: 'releaseFields', value: cleanReleaseFields(p.fields), updated_at: now() }, { onConflict: 'key' }));
      if ('checklist' in p) await run(T('app_settings').upsert({ key: 'releaseChecklist', value: cleanReleaseChecklist(p.checklist), updated_at: now() }, { onConflict: 'key' }));
      return methods.getReleaseSettings();
    },

    /** Карточка релиза: этап, приложение, ссылки из этапов запроса, релизные поля. */
    async getRelease(p) {
      const t = await findTask(p.taskId);
      if (t.step !== 'release') fail('Это не этап «Релиз»');
      const [app, links, lf, settings] = await Promise.all([
        t.app_id ? one('apps', t.app_id) : null, rpc('release_links', { p_task: t.id }), linkFields(), methods.getReleaseSettings(),
      ]);
      const LF = Object.fromEntries(lf.map(f => [f.id, f]));
      return {
        task: taskOut(t), app: app ? appOut(app) : null, fields: settings.fields,
        links: (links || []).map(l => ({ taskId: l.task_id, step: l.step, stage: String(l.title).split(' · ')[0], fieldId: l.field_id, name: (LF[l.field_id] || {}).name || 'Ссылка', kind: (LF[l.field_id] || {}).kind || 'link', url: l.url })),
      };
    },

    /** Релизные поля этапа: значения по id полей студии (ссылки — только http(s)). */
    async saveReleaseValues(p) {
      const t = await findTask(p.taskId);
      if (t.step !== 'release') fail('Это не этап «Релиз»');
      const fields = cleanReleaseFields(await setting('releaseFields'));
      const rel = json(t.release, {}) || {};
      const values = { ...(rel.values || {}) };
      for (const [k, v] of Object.entries(p.values || {})) {
        const f = fields.find(x => x.id === k);
        if (!f) continue;
        const val = f.kind === 'link' ? linkUrl(v) : str(v, f.kind === 'longtext' ? 4000 : 300);
        if (val) values[k] = val; else delete values[k];
      }
      await updateOne('tasks', t.id, { release: { ...rel, values }, updated_at: now() });
      return taskOut(await findTask(t.id));
    },

    /** Шаг релиза: submit (отправил в Apple) / live (вышло в стор) / reject (реджект, reason) / resubmit (отправил снова). */
    async releaseStep(p) {
      if (!['submit', 'live', 'reject', 'resubmit'].includes(p.action)) fail('Неизвестный шаг релиза');
      const t = await findTask(p.taskId);
      const id = await rpc('release_step', { p_task: t.id, p_action: p.action, p_reason: str(p.reason, 300) });
      return { task: taskOut(await findTask(t.id)), rejectRequestId: p.action === 'reject' ? id : '' };
    },

    /**
     * Дашборд RM: релизы, которые ему видны (свои и своей позиции), кроме вышедших: очередь (к отправке — чего не хватает),
     * на ревью Apple (сколько дней ждут), реджекты (причина, кто исправляет).
     */
    async getRmDashboard(p) {
      const [rows, units, apps, settings] = await Promise.all([
        all(() => T('tasks').select('*').eq('step', 'release').eq('archived', false).neq('assignee_id', '').order('created_at').order('id')),
        all(() => T('units').select('id,key,settings').order('id')),
        all(() => T('apps').select('id,name,color,icon_url,unit_id,status,priority,is_test').order('id')),
        methods.getReleaseSettings(),
      ]);
      const U = Object.fromEntries(units.map(u => [u.id, u]));
      const A = Object.fromEntries(apps.map(a => [a.id, { id: a.id, name: a.name, color: a.color, iconUrl: a.icon_url || '', unitId: a.unit_id, status: a.status, priority: a.priority || '', isTest: !!a.is_test }]));
      const required = settings.fields.filter(f => f.required);
      const items = rows.filter(t => U[t.unit_id] && kindOf(unitSettings(U[t.unit_id].settings), t.status) !== 'done').map(t => {
        const rel = json(t.release, {}) || {};
        const cl = json(t.checklist, []) || [];
        return {
          id: t.id, unitId: t.unit_id, key: `${U[t.unit_id].key}-${t.num}`, title: t.title, assigneeId: t.assignee_id, dueDate: t.due_date,
          app: A[t.app_id] || null, phase: rel.phase || '', reason: rel.reason || '', pmId: rel.pmId || '',
          submittedAt: rel.submittedAt || '', rejectedAt: rel.rejectedAt || '', updatedAt: t.updated_at,
          missing: required.filter(f => !(rel.values || {})[f.id]).map(f => f.name),
          checklist: { done: cl.filter(i => i.done).length, total: cl.length },
        };
      }).filter(x => x.phase !== 'live');
      return {
        queue: items.filter(x => !x.phase),
        review: items.filter(x => x.phase === 'submitted'),
        rejected: items.filter(x => x.phase === 'rejected'),
      };
    },

    /** Режим разработчика: удалить всё, что создали шорткаты (тестовые задачи и приложения). */
    async deleteTestData() {
      return { tasks: Number(await rpc('delete_test_data', {})) || 0 };
    },

    /* ---------- люди ---------- */

    /** Кто я: профиль вошедшего (привязка по email при первом входе). null — доступа нет. */
    async whoami() {
      const rows = await rpc('whoami', {});
      const me = Array.isArray(rows) ? rows[0] : rows;
      return me && me.id ? personOut(me) : null;
    },

    /** Профиль без аккаунта (например, чтобы заранее назначать задачи). Аккаунт — createAccount. */
    async createPerson(p) {
      const person = {
        id: uid('p'), name: req(str(p.name, 80), 'Имя'), email: str(p.email, 120).toLowerCase(),
        role: str(p.role, 80), color: color(p.color, ''), telegram_chat_id: '', active: true, created_at: now(),
        access: ACCESS.includes(p.access) ? p.access : 'member', position_id: (await validDept(p.positionId)) || 'd_other',
      };
      person.extra_positions = (await cleanPositions(p.extraPositionIds)).filter(id => id !== person.position_id);
      // команды: указанные или Other (если такая есть)
      person.team_ids = 'teamIds' in p ? await cleanTeams(p.teamIds) : (await validTeam('t_other')) ? ['t_other'] : [];
      await run(T('people').insert(person));
      return personOut(person);
    },

    /**
     * Аккаунт для входа: email + временный пароль. Создаёт профиль или привязывает существующий (personId).
     * В Supabase — через серверную функцию admin-users (нужны права администратора), локально — сразу профиль.
     */
    async createAccount(p) {
      const email = str(p.email, 120).toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('Укажите корректный email');
      const password = str(p.password, 72);
      if (password.length < 8) fail('Временный пароль — от 8 символов');
      if (!invoke) {
        // Локальный режим: аккаунтов нет, вход — переключателем «Войти как»
        if (p.personId) return methods.updatePerson({ id: p.personId, email });
        return methods.createPerson({ ...p, email });
      }
      const res = await invoke('admin-users', {
        action: 'create', email, password, personId: p.personId || null, name: str(p.name, 80),
        role: str(p.role, 80), access: ACCESS.includes(p.access) ? p.access : 'member', positionId: str(p.positionId, 40),
        extraPositionIds: await cleanPositions(p.extraPositionIds), teamIds: await cleanTeams(p.teamIds),
      });
      return personOut(res.person);
    },

    /** Новый временный пароль для человека (администратор). */
    async resetPassword(p) {
      const password = str(p.password, 72);
      if (password.length < 8) fail('Временный пароль — от 8 символов');
      if (!invoke) return true;
      await invoke('admin-users', { action: 'password', personId: String(p.personId ?? ''), password });
      return true;
    },

    /* ---------- присутствие и уведомления ---------- */

    /** Пульс раз в минуту: отметить «я в приложении», вернуть, кто когда был, и число непрочитанных уведомлений. */
    async heartbeat(p) {
      await rpc('touch_presence', {});
      if (p.today) await rpc('scan_due', { p_today: today(p.today) });
      const [seen, unread] = await Promise.all([
        all(() => T('people').select('id,last_seen_at').order('id')),
        run(T('notifications').select('id').eq('read_at', '').limit(100)),
      ]);
      return { seen: Object.fromEntries(seen.map(r => [r.id, r.last_seen_at || ''])), unread: unread.length };
    },

    /** Непрочитанные уведомления вошедшего — с задачей и юнитом (скрытые от него задачи пропускаются). */
    async getNotifications(p) {
      if (p.today) await rpc('scan_due', { p_today: today(p.today) });
      const rows = await run(T('notifications').select('*').eq('read_at', '').order('at', { ascending: false }).limit(50));
      if (!rows.length) return [];
      const tasks = await run(T('tasks').select('id,unit_id,num,title,status,due_date,archived,app_id').in('id', [...new Set(rows.map(r => r.task_id))]));
      const appIds = [...new Set(tasks.map(t => t.app_id).filter(Boolean))];
      const [units, apps] = await Promise.all([
        run(T('units').select('id,name,key,color').in('id', [...new Set(tasks.map(t => t.unit_id))])),
        appIds.length ? run(T('apps').select('id,name,color,icon_url').in('id', appIds)) : [],
      ]);
      const TT = Object.fromEntries(tasks.map(t => [t.id, t])), U = Object.fromEntries(units.map(u => [u.id, u]));
      const A = Object.fromEntries(apps.map(a => [a.id, { id: a.id, name: a.name, color: a.color || '', iconUrl: a.icon_url || '' }]));
      return rows.filter(r => TT[r.task_id] && !TT[r.task_id].archived && U[TT[r.task_id].unit_id]).map(r => {
        const t = TT[r.task_id], u = U[t.unit_id];
        return {
          id: r.id, kind: r.kind, actorId: r.actor_id, at: r.at, ref: r.ref || '', taskId: t.id, title: t.title, dueDate: t.due_date,
          key: `${u.key}-${t.num}`, unit: { id: u.id, name: u.name, color: u.color }, app: A[t.app_id] || null,
        };
      });
    },

    /** Отметить прочитанными: все или по одной задаче (taskId). База даёт менять только свои. */
    async readNotifications(p) {
      let q = T('notifications').update({ read_at: now() }).eq('read_at', '');
      if (p.taskId) q = q.eq('task_id', String(p.taskId));
      return (await run(q.select('id'))).length;
    },

    /* ---------- шаблоны задач ---------- */

    async saveTemplate(p) {
      const row = {
        name: req(str(p.name, 60), 'Название шаблона'), title: str(p.title, 500), description: str(p.description, 20000),
        department_id: await validDept(p.departmentId), checklist: cleanChecklist(p.checklist),
        due_days: [-1, 0, 1, 2, 3, 5, 7, 14, 30].includes(Number(p.dueDays)) ? Number(p.dueDays) : -1,
        assignee_id: p.assigneeId && (await one('people', p.assigneeId)) ? String(p.assigneeId) : '',
        team_id: await validTeam(p.teamId),
        links: {},
      };
      // ссылки шаблона: только существующие поля-ссылки и только http(s)
      const known = new Set((await linkFields()).map(f => f.id));
      for (const [k, v] of Object.entries(p.links || {})) {
        const url = linkUrl(v);
        if (known.has(k) && url) row.links[k] = url;
      }
      if (p.id) {
        await updateOne('task_templates', String(p.id), row);
        return templateOut({ ...(await one('task_templates', p.id)) });
      }
      const t = { id: uid('tp'), ...row, ord: (await maxOrd('task_templates')) + 1 };
      await run(T('task_templates').insert(t));
      return templateOut(t);
    },

    async deleteTemplate(p) {
      const gone = await run(T('task_templates').delete().eq('id', String(p.id ?? '')).select('id'));
      if (!gone.length) fail('Недостаточно прав для этого действия', 'FORBIDDEN');
      return true;
    },

    async reorderTemplates(p) {
      await Promise.all((p.ids || []).map((id, i) => run(T('task_templates').update({ ord: i + 1 }).eq('id', String(id)))));
      return templates();
    },

    /* ---------- ссылки в карточке ---------- */

    async createLinkField(p) {
      const f = {
        id: uid('lf'), name: req(str(p.name, 40), 'Название'), kind: LINK_KINDS.includes(p.kind) ? p.kind : 'link',
        positions: await cleanPositions(p.positions), ord: (await maxOrd('link_fields')) + 1, archived: false,
      };
      await run(T('link_fields').insert(f));
      return linkFieldOut(f);
    },

    async updateLinkField(p) {
      const f = (await one('link_fields', p.id)) || fail('Поле не найдено', 'NOT_FOUND');
      const upd = {};
      if ('name' in p) upd.name = req(str(p.name, 40), 'Название');
      if ('kind' in p) upd.kind = LINK_KINDS.includes(p.kind) ? p.kind : 'link';
      if ('positions' in p) upd.positions = await cleanPositions(p.positions);
      if ('archived' in p) upd.archived = !!p.archived;
      await updateOne('link_fields', f.id, upd);
      return linkFieldOut({ ...f, ...upd });
    },

    async reorderLinkFields(p) {
      await Promise.all((p.ids || []).map((id, i) => run(T('link_fields').update({ ord: i + 1 }).eq('id', String(id)))));
      return linkFields();
    },

    /** Удалить поле навсегда — вместе со всеми ссылками в задачах. */
    async deleteLinkField(p) {
      const gone = await run(T('link_fields').delete().eq('id', String(p.id ?? '')).select('id'));
      if (!gone.length) fail('Недостаточно прав для этого действия', 'FORBIDDEN');
      return true;
    },

    /** Поставить или убрать (url = '') ссылку в задаче. */
    async setTaskLink(p, ctx) {
      const t = await findTask(p.taskId);
      const fieldId = str(p.fieldId, 40);
      const url = linkUrl(p.url);
      const had = (await run(T('task_links').select('url').eq('task_id', t.id).eq('field_id', fieldId).maybeSingle()));
      if (url) {
        await run(T('task_links').upsert({ task_id: t.id, field_id: fieldId, unit_id: t.unit_id, url, updated_at: now() }, { onConflict: 'task_id,field_id' }));
      } else if (had) {
        const gone = await run(T('task_links').delete().eq('task_id', t.id).eq('field_id', fieldId).select('task_id'));
        if (!gone.length) fail('Недостаточно прав для этого действия', 'FORBIDDEN');
      }
      if ((had ? had.url : '') !== url) await log([{ unitId: t.unit_id, taskId: t.id, action: 'update', field: 'link:' + fieldId, from: had ? had.url : null, to: url || null }], ctx);
      return url;
    },

    /** Личные настройки интерфейса: сливаем переданные ключи с сохранёнными. */
    async setMyPrefs(p) {
      const person = (await one('people', p.personId)) || fail('Человек не найден', 'NOT_FOUND');
      const prefs = { ...(json(person.prefs, {}) || {}), ...(p.prefs || {}) };
      if (JSON.stringify(prefs).length > 20000) fail('Слишком большие настройки');
      await updateOne('people', person.id, { prefs });
      return prefs;
    },

    /**
     * Удалить человека из системы (супер-админ): задачи — без исполнителя, история и комментарии остаются.
     * Аккаунт входа удаляет серверная функция — уже после профиля, чтобы проверки прав сработали в базе.
     */
    async deletePerson(p) {
      const person = (await one('people', p.id)) || fail('Человек не найден', 'NOT_FOUND');
      await rpc('delete_person', { p_person: person.id });
      if (invoke && person.user_id) await invoke('admin-users', { action: 'deleteAuth', userId: person.user_id });
      return true;
    },

    async updatePerson(p) {
      const person = (await one('people', p.id)) || fail('Человек не найден', 'NOT_FOUND');
      const upd = {};
      if ('name' in p) upd.name = req(str(p.name, 80), 'Имя');
      if ('email' in p) upd.email = str(p.email, 120).toLowerCase();
      if ('role' in p) upd.role = str(p.role, 80);
      if ('color' in p) upd.color = color(p.color, '');
      if ('active' in p) upd.active = !!p.active;
      if ('access' in p) upd.access = ACCESS.includes(p.access) ? p.access : fail('Неизвестная роль');
      if ('positionId' in p) upd.position_id = (await validDept(p.positionId)) || 'd_other';
      const main = upd.position_id || person.position_id;
      if ('teamIds' in p) upd.team_ids = await cleanTeams(p.teamIds);
      if ('extraPositionIds' in p) upd.extra_positions = (await cleanPositions(p.extraPositionIds)).filter(id => id !== main);
      else if (upd.position_id) upd.extra_positions = (json(person.extra_positions, []) || []).filter(id => id !== main);
      await updateOne('people', person.id, upd);
      // Отключённый человек не должен входить: блокируем аккаунт на сервере
      if ('active' in p && invoke && person.user_id && !!p.active !== !!person.active) {
        await invoke('admin-users', { action: 'active', personId: person.id, active: !!p.active });
      }
      return personOut({ ...person, ...upd });
    },
  };

  return {
    methods,
    /** Вызов по имени с единым форматом ответа { ok, data } | { ok: false, error, code, data }. */
    async call(method, payload, ctx = {}) {
      const fn = Object.hasOwn(methods, method) ? methods[method] : null;
      if (!fn) return { ok: false, error: 'Неизвестный метод: ' + method, code: 'NOT_FOUND' };
      try {
        return { ok: true, data: await fn(payload && typeof payload === 'object' ? payload : {}, ctx) };
      } catch (e) {
        if (e instanceof ApiError) return { ok: false, error: e.message, code: e.code, data: e.data };
        console.error(`[api] ${method}:`, e);
        return { ok: false, error: 'Непредвиденная ошибка: ' + (e && e.message ? e.message : e), code: 'INTERNAL' };
      }
    },
  };
}
