/**
 * Бизнес-логика поверх Supabase (Postgres). Работает в браузере.
 * createBackend(client) принимает клиент supabase-js (в тестах — совместимый адаптер над PGlite).
 * Все методы асинхронные: (payload, ctx) → данные; ctx.actorId — id человека, от чьего имени действие.
 */

/** Тип колонки: не начато / в работе / готово. Свои колонки встают между ними. */
import { DEV_QUESTIONS } from './devform.js';
import { cleanChart, METRIC_KIND } from './chartdefs.js';

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
    { key: 'design', title: 'Дизайн', positionId: 'd_design', dependsOn: [], checklist: ['Экраны приложения', 'Пейволл (PW)'] },
    // после approve дизайна — дизайн-лиду (сам или дизайнеру): онбординг и ASO-графика; потом по ним пишет тексты ASO
    { key: 'art', title: 'Онбординг и ASO-графика', positionId: 'd_design', dependsOn: ['design'], checklist: ['Онбординг (OB)', 'Скриншоты и иконка (ASO)'] },
    { key: 'ios', title: 'Разработка iOS', positionId: 'd_ios', dependsOn: ['design'] },
    { key: 'qa', title: 'Тестирование', positionId: 'd_qa', dependsOn: ['ios'] },
    // интеграция (OB, PW, SDK) — iOS-лид после приёмки QA; не нужна — PM снимает галочку при разбивке
    { key: 'integr', title: 'Интеграция', positionId: 'd_ios', dependsOn: ['qa'] },
    // ASO, два трека: тексты (OB, PW, скриншоты) — после графики; метаданные стора — параллельно, сразу после дизайна.
    // Готовые тексты дизайнер ставит в макеты и выгружает исходники на Google Drive; после — переводы.
    { key: 'meta', title: 'Тексты OB / PW / ASO', positionId: 'd_aso', dependsOn: ['art'], checklist: ['Тексты онбординга', 'Тексты пейволла', 'Тексты на скриншотах'] },
    { key: 'store', title: 'Метаданные', positionId: 'd_aso', dependsOn: ['design'], checklist: ['Название и подзаголовок', 'Описание', 'Ключевые слова'] },
    { key: 'retext', title: 'Тексты в дизайне', positionId: 'd_design', dependsOn: ['meta'], checklist: ['Тексты OB заменены в макетах', 'Тексты PW заменены в макетах', 'Тексты ASO заменены в скриншотах', 'Исходники выгружены на Google Drive'] },
    { key: 'l10n', title: 'Локализации', positionId: 'd_aso', dependsOn: ['retext', 'store'], checklist: ['Переводы приложения и пейволла', 'Переводы метаданных', 'Скриншоты на языках'] },
    { key: 'release', title: 'Релиз', positionId: 'd_release', dependsOn: ['design', 'art', 'ios', 'qa', 'integr', 'meta', 'store', 'retext', 'l10n'], release: true },
  ],
  update: [
    { key: 'design', title: 'Дизайн', positionId: 'd_design', dependsOn: [] },
    { key: 'ios', title: 'Разработка iOS', positionId: 'd_ios', dependsOn: ['design'] },
    { key: 'qa', title: 'Тестирование', positionId: 'd_qa', dependsOn: ['ios'] },
    { key: 'integr', title: 'Интеграция', positionId: 'd_ios', dependsOn: ['qa'] },
    { key: 'release', title: 'Релиз', positionId: 'd_release', dependsOn: ['design', 'ios', 'qa', 'integr'], release: true },
  ],
  other: [],
};
/** Статусы приложения по умолчанию (настраиваются; kind связывает статус с ходом работ). */
export const APP_STATUS_KINDS = ['dev', 'release', 'review', 'live', 'reject', ''];
/** Общее поле «Приоритет» (создаёт schema.sql): им же задаётся приоритет приложений и запросов CEO. */
const PRIORITY_FIELD = 'f_priority';
export const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6', '#64748b', '#84cc16'];

/**
 * Обязательная колонка «Доработка»: сюда QA возвращает задачи разработчика с баг-репортом (qa_return в schema.sql).
 * Есть в каждом юните, удалить нельзя; узнаём по id или по названию (у старых юнитов её добавляли вручную).
 */
export const REWORK_COLUMN = { id: 'rework', name: 'Доработка', kind: 'progress', color: '' };
export const isReworkColumn = c => !!c && (c.id === REWORK_COLUMN.id || /^доработ/i.test(String(c.name || '').trim()));

export function defaultSettings() {
  return {
    columns: [
      { id: 'todo', name: 'К выполнению', kind: 'todo', color: '' },
      { id: 'in_progress', name: 'В работе', kind: 'progress', color: '' },
      { id: 'review', name: 'В ревью', kind: 'progress', color: '' },
      { ...REWORK_COLUMN },
      { id: 'done', name: 'Готово', kind: 'done', color: '' },
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
    hideDoneDays: 7, // сколько дней держать выполненные на доске и в списке (0 — всегда)
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
  // «Доработка» обязательна: нет — встаёт перед первой «готово» (после ревью: возврат с ревью идёт в колонку перед ревью,
  // а в «Доработку» — только возвраты от QA); тип всегда «в процессе»
  const rework = columns.find(isReworkColumn);
  if (rework) rework.kind = 'progress';
  else {
    const at = columns.findIndex(c => c.kind === 'done');
    columns.splice(at < 0 ? columns.length : at, 0, { ...REWORK_COLUMN });
  }
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
  archivedAt: r.archived_at || '', createdAt: r.created_at, updatedAt: r.updated_at, pmId: r.pm_id || '', isTest: !!r.is_test,
  icon: r.icon || '', // картинка юнита (data:image), пусто — буквы ключа
});

const taskOut = r => ({
  id: r.id, unitId: r.unit_id, num: r.num, title: r.title, description: r.description, status: r.status,
  assigneeId: r.assignee_id, departmentId: r.department_id || '', dueDate: r.due_date, order: r.ord,
  fields: json(r.fields, {}), checklist: json(r.checklist, []), archived: !!r.archived, doneAt: r.done_at,
  reviewFrom: r.review_from || '', reviewerId: r.reviewer_id || '', teamId: r.team_id || '', specUrl: r.spec_url || '',
  parentId: r.parent_id || '', kind: r.kind || '', startedAt: r.started_at || '',
  release: json(r.release, {}) || {}, flowSteps: json(r.flow_steps, []) || [],
  appId: r.app_id || '', requestType: r.request_type || '', step: r.step || '', devForm: json(r.dev_form, {}) || {}, dependsOn: json(r.depends_on, []) || [], isTest: !!r.is_test, bugs: json(r.bugs, []) || [],
  createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
});

const ideaOut = r => ({ id: r.id, title: r.title, description: r.description || '', specUrl: r.spec_url || '', kind: r.kind, appId: r.app_id || '', unitId: r.unit_id || '', status: r.status, requestId: r.request_id || '', createdBy: r.created_by || '', createdAt: r.created_at, updatedAt: r.updated_at });
const fileOut = r => ({ id: r.id, taskId: r.task_id, tag: r.tag || '', name: r.name || '', data: r.data, by: r.created_by || '', at: r.created_at });

const fieldOut = r => ({
  id: r.id, unitId: r.unit_id || '', global: !r.unit_id, name: r.name, type: r.type, options: json(r.options, []),
  showOnCard: !!r.show_on_card, required: !!r.required, requiredFrom: r.required_from || '',
  staffOnly: !!r.staff_only, role: r.role || '', requiredOnCreate: !!r.required_on_create, order: r.ord, archived: !!r.archived,
});

/** Роли: superadmin — CEO, moderator — PM, rm — релиз-менеджер, lead — лид, member — сотрудник. */
export const ACCESS = ['superadmin', 'moderator', 'rm', 'lead', 'member'];
const ACCESS_NAMES = { superadmin: 'CEO', moderator: 'PM', rm: 'RM', lead: 'Lead', member: 'Сотрудник' };
const SHELF_NAMES = { spam: 'Design Spam [4.3]', sale: 'Removed from sale', deleted: 'Deleted' };
/** Как назвать в журнале изменённую общую настройку (ключ app_settings). */
const SETTING_NAMES = {
  appStatuses: 'статусы приложений', appFields: 'поля приложений', appInfoItems: 'пункты Info', releaseFields: 'релизные поля',
  releaseChecklist: 'чеклист релиза', devQuestions: 'опросник разработчика', staleDays: 'срок «без движения»',
  unitRetentionDays: 'срок хранения корзины', priorityOptions: 'приоритеты', storeAutoCheck: 'автопроверка App Store', storeManualCheck: 'кнопка ручной проверки App Store',
};
/** Фото data:image (webp/jpeg/png, до ~90 КБ; браузер сжимает до 160 px). Иначе — пусто. */
const photoValue = v => {
  const s = String(v || '');
  return s.length <= 120000 && /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(s) ? s : '';
};
/** Аватар: готовый маскот (preset:ios-3) или фото. Иначе — пусто (инициалы). */
const avatarValue = v => (/^preset:[a-z]+-\d{1,2}$/.test(String(v || '')) ? String(v) : photoValue(v));
/** Telegram: @username (5–32 символа: буквы, цифры, _) — храним без @; ссылка t.me/… тоже подходит. */
const telegramValue = v => { const m = /^(?:https?:\/\/)?(?:t\.me\/)?@?([A-Za-z0-9_]{5,32})$/.exec(String(v || '').trim()); return m ? m[1] : ''; };
/** Часовой пояс IANA: «Europe/Moscow», «Asia/Almaty», «UTC». */
const timezoneValue = v => { const s = String(v || '').trim(); return /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(s) && s.length <= 50 ? s : ''; };
const personOut = r => ({
  id: r.id, name: r.name, email: r.email, role: r.role || '', color: r.color || '', active: !!r.active,
  access: r.access || 'member', positionId: r.position_id || '', linked: !!r.user_id, prefs: json(r.prefs, {}) || {},
  lastSeenAt: r.last_seen_at || '', isDev: !!r.is_dev, viewAs: r.view_as || '', isTest: !!r.is_test, avatar: r.avatar || '', telegram: r.telegram || '', timezone: r.timezone || '',
  extraPositionIds: json(r.extra_positions, []) || [],
  teamIds: json(r.team_ids, []) || [],
  positionIds: [r.position_id || 'd_other', ...(json(r.extra_positions, []) || [])],
});
const teamOut = r => ({ id: r.id, name: r.name, color: r.color, order: r.ord, archived: !!r.archived, boardTemplate: cleanStages(json(r.board_template, [])), departmentIds: (json(r.department_ids, []) || []).filter(x => typeof x === 'string') });

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
const FEEDBACK_KINDS = ['idea', 'inconvenient', 'bug'];
const feedbackOut = r => ({ id: r.id, personId: r.person_id, kind: r.kind, text: r.text, status: r.status, createdAt: r.created_at, doneAt: r.done_at || '' });

const appOut = r => ({
  id: r.id, unitId: r.unit_id, name: r.name, color: r.color || '', status: r.status, info: json(r.info, {}) || {},
  priority: r.priority || '', statusAt: r.status_at || '', iconUrl: r.icon_url || '', storeName: r.store_name || '',
  storeOk: r.store_ok == null ? null : !!r.store_ok, storeCheckedAt: r.store_checked_at || '', checks: cleanChecks(r.checks), ownFields: cleanOwnFields(r.own_fields),
  order: r.ord, archived: !!r.archived, shelf: r.archived ? (r.shelf || 'deleted') : '', shelvedAt: r.shelved_at || '', isTest: !!r.is_test, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
});

/**
 * Что ушло в Apple с этим релизом: после реджекта — его исправления (№, задача реджекта), иначе — по запросу-родителю:
 * новое приложение целиком или апдейт №N. { kind: new_app | update | reject | other, label, requestId }.
 */
function releaseWhat(t, parent) {
  const rel = json(t.release, {}) || {};
  if (rel.rejectNo) return { kind: 'reject', label: `Исправления реджекта №${rel.rejectNo}`, requestId: rel.rejectRequestId || '' };
  if (parent && parent.request_type === 'new_app') return { kind: 'new_app', label: 'Новое приложение', requestId: parent.id };
  if (parent && parent.request_type === 'update') return { kind: 'update', label: parent.title, requestId: parent.id };
  return { kind: 'other', label: parent ? parent.title : 'Релиз', requestId: parent ? parent.id : '' };
}

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
/** Вопросы опросника: id, вид (yn — Да/Нет, text), текст, подсказка, что уточнить при «Да», необязательный. */
function cleanDevQuestions(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).slice(0, 40).map(x => {
    const q = str(x && x.q, 300);
    if (!q) return null;
    let id = /^[a-z0-9_]{1,40}$/.test((x && x.id) || '') && !seen.has(x.id) ? x.id : uid('q').toLowerCase().replace(/[^a-z0-9_]/g, '');
    seen.add(id);
    const out = { id, kind: x.kind === 'text' ? 'text' : 'yn', q };
    if (str(x.hint, 300)) out.hint = str(x.hint, 300);
    if (out.kind === 'yn' && str(x.note, 100)) out.note = str(x.note, 100);
    if (x.optional) out.optional = true;
    return out;
  }).filter(Boolean);
}

function cleanFlow(list) {
  const keys = [];
  return (Array.isArray(list) ? list : []).slice(0, 20).map(x => {
    const key = /^[a-z0-9_]{1,30}$/.test((x && x.key) || '') && !keys.includes(x.key) ? x.key : null;
    const title = str(x && x.title, 120);
    if (!key || !title) return null;
    const step = { key, title, positionId: str(x.positionId, 40), dependsOn: (Array.isArray(x.dependsOn) ? x.dependsOn : []).filter(k => keys.includes(k)), release: !!x.release };
    const items = (Array.isArray(x.checklist) ? x.checklist : []).map(i => str(i, 300)).filter(Boolean).slice(0, 30);
    if (items.length) step.checklist = items;
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
  kind: r.kind || '', steps: json(r.steps, []) || [],
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
  /** Запросы-родители релизов: { id → { id, title, request_type } } (функция базы — RM самих запросов не видит). */
  async function releaseParents(ids) {
    const list = [...new Set(ids.filter(Boolean))];
    if (!list.length) return {};
    const rows = (await rpc('release_parents', { p_ids: list })) || [];
    return Object.fromEntries(rows.map(r => [r.id, r]));
  }
  /** Ответственный за юнит: заданный (PM или CEO), иначе первый PM из состава; в замещение — заместитель (unit_pm в базе). */
  async function responsiblePm(unitId) {
    return (await rpc('unit_pm', { p_unit: String(unitId || '') })) || '';
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
    const respId = await responsiblePm(unitId);
    const st = unitSettings((await findUnit(unitId)).settings);
    for (const t of rows.filter(x => x.kind === 'request')) {
      const fresh = await findTask(t.id);
      if (kindOf(st, fresh.status) !== 'done') await methods.updateTask({ id: t.id, patch: { assigneeId: respId } }, ctx);
    }
    // исполнителей, которых нет в новом юните, не оставляем на открытых задачах: этап — человек той же позиции здесь, релиз — RM, иначе без исполнителя
    const crew = await unitPeople(unitId);
    for (const t of rows.filter(x => x.kind !== 'request')) {
      const fresh = await findTask(t.id);
      if (!fresh.assignee_id || fresh.done_at || crew.some(x => x.id === fresh.assignee_id)) continue;
      const samePos = crew.filter(x => x.positionIds.includes(fresh.department_id));
      const pick = fresh.step === 'release' ? crew.find(x => x.access === 'rm') : samePos.find(x => x.access === 'lead') || samePos[0];
      await run(T('tasks').update({ assignee_id: pick ? pick.id : '', updated_at: now() }).eq('id', fresh.id));
    }
  }
  /** Флоу по типам запроса: свой у юнита (настройки юнита), иначе студии (app_settings.flows), иначе по умолчанию. */
  const flows = async unitId => {
    const saved = (await setting('flows')) || {};
    const own = unitId ? unitSettings((await findUnit(unitId)).settings).flows : {};
    return Object.fromEntries(Object.keys(REQUEST_TYPES).map(k => [k, own[k] || (k in saved ? cleanFlow(saved[k]) : DEFAULT_FLOWS[k])]));
  };
  /** «Смотреть как»: id того, за кого смотрит разработчик (не он сам), иначе ''. Права проверяет база (notifications_of). */
  const viewedPerson = async id => {
    const v = str(id, 40);
    if (!v) return '';
    const me = (await rpc('my_person_id', {})) || '';
    return v !== me ? v : '';
  };
  const devQuestions = async () => { const own = cleanDevQuestions(await setting('devQuestions')); return own.length ? own : DEV_QUESTIONS; };
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

  /**
   * Позиции разграничены: этап ведёт человек его позиции, релиз — только RM (у обычных задач позиция — это
   * «кто видит», её можно задать отдельно от исполнителя). Кто не в юните — проверяют другие правила.
   */
  async function fitsAssignee(unitId, { kind, step, departmentId }, assigneeId) {
    if (!assigneeId) return;
    const anyone = (await people()).find(x => x.id === assigneeId);
    if (anyone && !anyone.active) fail(`${anyone.name} отключён — выберите другого исполнителя`, 'RULE');
    const person = (await unitPeople(unitId)).find(x => x.id === assigneeId);
    if (!person) return;
    if (kind === 'stage' && step === 'release') {
      if (person.access !== 'rm') fail(`Релиз ведёт релиз-менеджер: ${person.name} им не является`, 'RULE');
      return;
    }
    if (kind === 'stage' && departmentId && !person.positionIds.includes(departmentId)) {
      const d = await one('departments', departmentId);
      fail(`${person.name} — не ${d ? '«' + d.name + '»' : 'нужной позиции'}: выберите человека этой позиции`, 'RULE');
    }
  }
  /** RM — это и роль, и позиция Release Manager: одно без другого не бывает. */
  function checkRmPosition(access, positionIds) {
    if (access === 'rm' && !positionIds.includes('d_release')) fail('Релиз-менеджеру нужна позиция Release Manager', 'RULE');
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
  /** Какие уведомления вошедший выключил в «Настройки → Уведомления» (prefs.notifyOff — виды событий). */
  const myPrefs = async () => {
    const id = await rpc('my_person_id', {}).catch(() => '');
    const p = id && (await one('people', String(id)));
    return (p && json(p.prefs, {})) || {};
  };
  const mutedKinds = async (prefs = null) => {
    const off = (prefs || (await myPrefs())).notifyOff;
    return Array.isArray(off) ? off.map(String) : [];
  };
  /** Сколько дней хранить историю уведомлений (Настройки → Уведомления): 3, 7, 14 или 30; по умолчанию 7. */
  const NOTIFY_DAYS = [3, 7, 14, 30];
  const historyDays = prefs => (NOTIFY_DAYS.includes(Number(prefs.notifyDays)) ? Number(prefs.notifyDays) : 7);

  const logVal = v => {
    if (v === undefined || v === null) return '';
    const s = JSON.stringify(v);
    return s.length > 1000 ? JSON.stringify(String(v).slice(0, 300) + '…') : s;
  };

  /**
   * Ждущие этапы (есть незакрытые зависимости) — исполнителям не показываем (решение заказчика): ни на доске, ни в «Моих задачах».
   * CEO и PM юнита видят всю цепочку. rows — строки tasks; возвращает без ждущих.
   */
  async function hideWaiting(rows) {
    const deps = [...new Set(rows.flatMap(r => json(r.depends_on, []) || []))];
    if (!deps.length) return rows;
    const known = Object.fromEntries(rows.map(r => [r.id, r]));
    const missing = deps.filter(id => !known[id]);
    const more = missing.length ? await run(T('tasks').select('id,unit_id,status').in('id', missing)) : [];
    const all_ = { ...known, ...Object.fromEntries(more.map(r => [r.id, r])) };
    const unitIds = [...new Set(Object.values(all_).map(r => r.unit_id))];
    const units = unitIds.length ? await run(T('units').select('id,settings').in('id', unitIds)) : [];
    const ST = Object.fromEntries(units.map(u => [u.id, unitSettings(u.settings)]));
    const done = r => !!r && !!ST[r.unit_id] && kindOf(ST[r.unit_id], r.status) === 'done';
    const out = [];
    for (const r of rows) {
      const ds = json(r.depends_on, []) || [];
      if (!ds.length) { out.push(r); continue; }
      // зависимость может быть не видна этому человеку (чужая позиция) — тогда спрашиваем базу
      if (ds.some(id => !all_[id])) { if (!(await rpc('open_deps', { p_deps: ds }))) out.push(r); continue; }
      if (!ds.some(id => !done(all_[id]))) out.push(r);
    }
    return out;
  }

  /** Кого отметили «@Имя Фамилия» в тексте (новые относительно before). Уведомляет база — notify_mention. */
  async function notifyMentions(taskId, text, before, where) {
    if (!String(text || '').includes('@')) return 0;
    const ppl = await people();
    const has = (s, x) => String(s || '').includes('@' + x.name);
    const ids = ppl.filter(x => x.active && has(text, x) && !has(before, x)).map(x => x.id);
    return ids.length ? rpc('notify_mention', { p_task: taskId, p_people: ids, p_where: where }) : 0;
  }

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
      if (st.review && st.review.column && t.status === st.review.column) c.review = (c.review || 0) + 1;
      if (kind !== 'done' && t.due_date && t.due_date < day) c.overdue++;
      if (kind === 'done' && weekAgo && t.done_at >= weekAgo) c.doneWeek++;
    }
    return counts;
  }

  async function unitsWithCounts(day, weekAgo) {
    const [units, rows, members, staff] = await Promise.all([
      all(() => T('units').select('*').order('ord').order('id')),
      all(() => T('tasks').select('id,unit_id,status,due_date,done_at,depends_on').eq('archived', false).order('id')),
      all(() => T('unit_members').select('unit_id,person_id').order('created_at').order('person_id')),
      rpc('is_staff', {}),
    ]);
    // числа в сайдбаре — то, что человек видит на доске: ждущие этапы у участников скрыты и не считаются
    const tasks = staff ? rows : await hideWaiting(rows);
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
    // события приложений, юнитов, людей и настроек (пишет база): подписи статусов, приоритетов, ролей; иконки живых приложений
    const refs = [...new Set(rows.filter(r => /^app_/.test(r.action) && r.ref_id).map(r => r.ref_id))];
    const [appRows, statuses, prio] = rows.some(r => /^(app|person|settings)_/.test(r.action))
      ? await Promise.all([refs.length ? run(T('apps').select('id,name,color,icon_url').in('id', refs)) : [], appStatuses(), one('fields', PRIORITY_FIELD)])
      : [[], [], null];
    const AP = Object.fromEntries(appRows.map(r => [r.id, r]));
    const stName = id => (statuses.find(x => x.id === id) || {}).name || id || '';
    const prioName = id => (((prio && json(prio.options, [])) || []).find(o => o.id === id) || {}).name || (id ? id : 'без приоритета');
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
      let ref = null;
      if (/^(app|unit|person|settings)_/.test(a.action)) {
        const kind = a.action.split('_')[0];
        const live = kind === 'app' ? AP[a.ref_id] : null;
        ref = { kind, id: a.ref_id, name: (live && live.name) || a.ref_name || '', color: live ? live.color || '' : '', iconUrl: live ? live.icon_url || '' : '', gone: kind === 'app' && !live };
        const unitName = id => (U[id] ? U[id].name : id ? 'удалённый юнит' : '—');
        switch (`${kind}:${a.field}`) {
          case 'app:status': label = 'Статус'; fromText = stName(from); toText = stName(to); break;
          case 'app:priority': label = 'Приоритет'; fromText = prioName(from); toText = prioName(to); break;
          case 'app:unit': label = 'Юнит'; fromText = unitName(from); toText = unitName(to); break;
          case 'app:name': case 'unit:name': case 'person:name': label = 'Название'; break;
          case 'person:access': label = 'Роль'; fromText = ACCESS_NAMES[from] || from; toText = ACCESS_NAMES[to] || to; break;
          case 'person:position': label = 'Позиция'; fromText = from && D[from] ? D[from].name : '—'; toText = to && D[to] ? D[to].name : '—'; break;
          case 'person:active': label = 'Доступ'; fromText = from === 'true' ? 'включён' : 'отключён'; toText = to === 'true' ? 'включён' : 'отключён'; break;
          case 'unit:settings': label = 'Настройки юнита'; break;
          default:
            if (kind === 'settings') label = SETTING_NAMES[a.field] || a.field;
            if (a.action === 'app_shelve' || a.action === 'app_restore') { fromText = SHELF_NAMES[from] || from; toText = SHELF_NAMES[to] || to; }
        }
      }
      const text = v => (v === null || v === undefined || v === '' ? '—' : String(v));
      return {
        id: a.id, action: a.action, field: a.field, actorId: a.actor_id, at: a.at, ref,
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

  // автоархив доски — не чаще раза в 10 минут на юнит за сессию: иначе лишний запрос на каждое открытие доски
  const archivedAt = new Map();
  async function autoArchive(unit) {
    const st = unitSettings(unit.settings);
    if (!st.autoArchiveDays) return;
    if (Date.now() - (archivedAt.get(unit.id) || 0) < 10 * 60e3) return;
    archivedAt.set(unit.id, Date.now());
    const doneIds = st.columns.filter(c => c.kind === 'done').map(c => c.id);
    if (!doneIds.length) return;
    const cutoff = new Date(Date.now() - st.autoArchiveDays * 864e5).toISOString();
    await run(T('tasks').update({ archived: true }).eq('unit_id', unit.id).in('status', doneIds)
      .eq('archived', false).neq('done_at', '').lt('done_at', cutoff));
  }

  const methods = {

    /* ---------- общие данные, главная, поиск ---------- */

    async bootstrap(p) {
      const [units, ppl, depts, lf, tpl, tm, apps, statuses, afields, gfields, info, manual, infoLists] = await Promise.all([unitsWithCounts(today(p.today)), people(), departments(), linkFields(), templates(), teams(),
        all(() => T('apps').select('*').order('ord').order('id')), appStatuses(), appFields(), globalFields(), appInfoItems(), setting('storeManualCheck'),
        run(T('info_lists').select('person_id'))]);
      const prio = gfields.find(f => f.role === 'priority');
      return {
        units: units.map(({ doneWeek, ...u }) => u), people: ppl, departments: depts, linkFields: lf, templates: tpl, teams: tm,
        apps: apps.map(appOut), appStatuses: statuses, appFields: afields, appInfoItems: info, priorityOptions: prio ? prio.options : [],
        // кнопка «Обновить» (проверка App Store из браузера, с адреса человека) — по умолчанию скрыта, показ включает CEO
        storeManualCheck: !!(manual && manual.show),
        // у кого включён инфо-лист (человеку база отдаёт только его строку, CEO — все)
        infoListIds: infoLists.map(r => r.person_id),
      };
    },

    async getHome(p) {
      const day = today(p.today);
      const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
      // заодно — корзина юнитов по сроку хранения (для участников функция ничего не делает); всё параллельно
      const [, units, ppl, depts, log, tm] = await Promise.all([
        rpc('purge_archived_units', {}).catch(() => 0),
        unitsWithCounts(day, weekAgo), people(), departments(),
        run(T('activity').select('*').order('at', { ascending: false }).limit(30)), teams(),
      ]);
      const stats = { todo: 0, in_progress: 0, overdue: 0, doneWeek: 0 };
      for (const u of units) {
        if (u.archived) continue;
        stats.todo += u.counts.todo;
        stats.in_progress += u.counts.in_progress;
        stats.overdue += u.counts.overdue;
        stats.doneWeek += u.doneWeek;
      }
      return { units: units.map(({ doneWeek, ...u }) => u), people: ppl, departments: depts, teams: tm, stats, activity: await enrichActivity(log) };
    },

    /**
     * Лента событий с фильтрами: unitId, actorId, departmentId (позиция задачи), kind, since (скрыть старее), before (страница).
     * kind: create | status | assign | comment | fields | move | delete | archive | release; приложения — app_create | app_status | app_name |
     * app_unit | app_priority | app_shelve | app_restore | app_delete; units, people, settings_update. appId — всё по приложению и его задачам.
     */
    async getActivity(p) {
      const limit = Math.min(Math.max(Number(p.limit) || 30, 1), 100);
      const build = () => {
        let q = T('activity').select('*');
        if (p.unitId) q = q.eq('unit_id', String(p.unitId));
        if (p.actorId) q = q.eq('actor_id', String(p.actorId));
        switch (p.kind) {
          case 'app_create': case 'app_delete': case 'app_shelve': case 'app_restore': case 'settings_update': q = q.eq('action', p.kind); break;
          case 'app_status': q = q.eq('action', 'app_update').eq('field', 'status'); break;
          case 'app_name': q = q.eq('action', 'app_update').eq('field', 'name'); break;
          case 'app_unit': q = q.eq('action', 'app_update').eq('field', 'unit'); break;
          case 'app_priority': q = q.eq('action', 'app_update').eq('field', 'priority'); break;
          case 'units': q = q.in('action', ['unit_create', 'unit_update', 'unit_archive', 'unit_restore', 'unit_delete', 'unit_pm']); break;
          case 'people': q = q.in('action', ['person_create', 'person_update', 'person_delete']); break;
          case 'release': q = q.eq('field', 'release'); break;
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
      // По приложению: события самого приложения (ref_id) и его задач — два запроса, сливаем по времени
      if (p.appId) {
        const appId = String(p.appId);
        const taskIds = (await all(() => T('tasks').select('id').eq('app_id', appId).order('id'))).map(t => t.id);
        const [own, ofTasks] = await Promise.all([
          run(build().eq('ref_id', appId).limit(limit + 1)),
          taskIds.length ? run(build().in('task_id', taskIds).limit(limit + 1)) : [],
        ]);
        const merged = [...own, ...ofTasks].sort((a, b) => String(b.at).localeCompare(String(a.at)));
        let items = await enrichActivity(merged.slice(0, limit + 1));
        if (p.departmentId) items = items.filter(a => a.task && a.task.departmentId === p.departmentId);
        return { items: items.slice(0, limit), more: merged.length > limit };
      }
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
        if (p.authorId) b = b.eq('created_by', String(p.authorId)).neq('kind', 'stage'); // «Поставил я»: этапы разбивки — не постановка
        if (ids) b = b.in('id', ids);
        return b.order('updated_at', { ascending: false }).order('id');
      });
      rows = rows.filter(r => units[r.unit_id]);
      if (p.assigneeId) rows = await hideWaiting(rows); // «Мои задачи»: ждущие этапы появятся, когда откроются
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

    /**
     * Доска юнита. Архив копится годами, поэтому по умолчанию без него: archived — вместе с архивом (фильтр «Архив»),
     * taskId — плюс эта задача, даже если она в архиве (открыли по ссылке).
     */
    async getBoard(p) {
      const unit = await findUnit(p.unitId);
      await autoArchive(unit);
      const loadTasks = async () => {
        const rows = await all(() => (p.archived ? T('tasks').select('*').eq('unit_id', unit.id) : T('tasks').select('*').eq('unit_id', unit.id).eq('archived', false)).order('id'));
        if (!p.archived && p.taskId && !rows.some(t => t.id === p.taskId)) {
          const t = await run(T('tasks').select('*').eq('id', String(p.taskId)).eq('unit_id', unit.id).maybeSingle());
          if (t) rows.push(t);
        }
        return rows;
      };
      const [fields, allTasks, counts, units, ppl, depts, members, links, manages] = await Promise.all([
        unitFields(unit.id),
        loadTasks(),
        rpc('comment_counts', { p_unit: unit.id }),
        all(() => T('units').select('id,name,key,color,archived').order('ord').order('id')),
        people(), departments(), unitMembers(unit.id),
        all(() => T('task_links').select('task_id,field_id,url').eq('unit_id', unit.id).order('task_id').order('field_id')),
        rpc('can_manage', { p_unit: unit.id }),
      ]);
      // исполнителям ждущие этапы не показываем; CEO и PM юнита видят всю цепочку (с пометкой «ждёт»)
      const tasks = manages ? allTasks : await hideWaiting(allTasks);
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
        withArchived: !!p.archived,
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
      // ревьюеры по позициям задаются сразу при создании: без них задачи не уходят на ревью конкретному человеку
      if (p.review && typeof p.review === 'object') {
        const old = settings.review || {};
        const byPosition = { ...(old.byPosition || {}), ...(p.review.byPosition || {}) };
        settings = { ...settings, review: reviewSettings({ column: old.column, byPosition, default: p.review.default || old.default }, settings.columns) };
      }
      const ts = now();
      const unit = {
        id: uid('u'), name, key, color: color(p.color, PALETTE[count % PALETTE.length]), icon: photoValue(p.icon),
        description: str(p.description, 1000), settings, next_num: 1,
        ord: (await maxOrd('units')) + 1, archived: false, created_at: ts, updated_at: ts, is_test: !!p.test,
      };
      // ответственный за юнит: PM или CEO (CEO в состав не добавляем — он видит всё)
      const pm = p.pmId ? await one('people', String(p.pmId)) : null;
      if (pm && ['moderator', 'superadmin'].includes(pm.access) && pm.active) unit.pm_id = pm.id;
      await run(T('units').insert(unit));
      await insertFields(unit.id, fields);
      // PM юнита сразу в команде: без него задачи CEO некому раскладывать
      if (pm && pm.access === 'moderator') {
        await run(T('unit_members').upsert({ unit_id: unit.id, person_id: pm.id, department_id: await validDept(null), created_at: ts }, { onConflict: 'unit_id,person_id' }));
      }
      return { ...unitOut(unit), counts: emptyCounts(), members: pm && pm.access === 'moderator' ? await unitMembers(unit.id) : [] };
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
      if ('icon' in p) upd.icon = photoValue(p.icon);
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
        id: uid('u'), name: str(src.name + ' (копия)', 80), key: await uniqueKey(src.key), color: src.color, icon: src.icon || '',
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
      await fitsAssignee(unit.id, { kind: p.kind, step: str(p.step, 30), departmentId: await validDept(p.departmentId) || await memberDept(unit.id, assignee) }, assignee);
      const task = {
        id: uid('t'), unit_id: unit.id, num: (await rpc('next_task_num', { p_unit: unit.id })) ?? fail('Создавать задачи могут CEO и PM юнита', 'FORBIDDEN'),
        title: req(str(p.title, 500), 'Название задачи'), description: str(p.description, 20000), status,
        assignee_id: assignee, department_id: (await validDept(p.departmentId)) || (await memberDept(unit.id, assignee)),
        team_id: await validTeam(p.teamId), reviewer_id: '',
        due_date: date(p.dueDate), ord: (await maxOrd('tasks', { unit_id: unit.id, status })) + 1,
        fields: cleanFieldValues(p.fields, false), checklist: cleanChecklist(p.checklist),
        archived: false, done_at: kindOf(st, status) === 'done' ? ts : '', created_by: actor(ctx), created_at: ts, updated_at: ts,
        parent_id: p.parentId ? (await findTask(p.parentId)).id : '', kind: TASK_KINDS.includes(p.kind) ? p.kind : '',
        app_id: str(p.appId, 40), request_type: p.kind === 'request' && REQUEST_TYPES[p.requestType] ? p.requestType : '',
        step: str(p.step, 30), depends_on: (Array.isArray(p.dependsOn) ? p.dependsOn : []).map(x => str(x, 40)).filter(Boolean).slice(0, 20),
        is_test: !!p.test, started_at: kindOf(st, status) === 'todo' ? '' : ts, spec_url: linkUrl(p.specUrl),
        flow_steps: (Array.isArray(p.flowSteps) ? p.flowSteps : []).map(x => str(x, 30)).filter(Boolean).slice(0, 20),
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
          await fitsAssignee(t.unit_id, { kind: t.kind, step: t.step, departmentId: 'departmentId' in patch ? await validDept(patch.departmentId) : t.department_id }, v);
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
          done_at: t.done_at, updated_at: t.updated_at, started_at: t.started_at || '', reviewer_id: t.reviewer_id || '',
        }).eq('id', t.id).eq('updated_at', r.updated_at).select('*'));
        if (!saved.length) {
          const fresh = await one('tasks', t.id);
          if (fresh && fresh.updated_at !== r.updated_at) fail('Задачу уже изменил кто-то другой', 'CONFLICT', taskOut(fresh));
          fail('Недостаточно прав: менять можно только свои задачи', 'FORBIDDEN');
        }
        await log(logs, ctx);
        if ('description' in patch && saved[0].description !== r.description) await notifyMentions(t.id, saved[0].description, r.description, 'description');
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
    /**
     * Решение по ревью (ревьюер — исполнитель задачи в колонке ревью, или CEO / PM юнита):
     * approve — в «готово»; иначе «Правки» — обратно автору в колонку перед ревью, комментарий (если есть) — в обсуждение задачи.
     */
    async reviewDecision(p, ctx) {
      const t = await findTask(p.taskId);
      const st = unitSettings((await findUnit(t.unit_id)).settings);
      const col = (st.review || {}).column || '';
      if (!col || t.status !== col) fail('Задача уже не на ревью');
      const cols = st.columns;
      const i = cols.findIndex(c => c.id === t.status);
      const target = p.approve
        ? (cols.find(c => c.kind === 'done') || fail('В юните нет колонки «готово»')).id
        : ([...cols.slice(0, i)].reverse().find(c => c.kind !== 'done') || cols[0]).id;
      const text = str(p.comment, 5000);
      if (text) await methods.addComment({ taskId: t.id, text: (p.approve ? 'Аппрув: ' : 'Правки: ') + text }, ctx);
      const fresh = await findTask(t.id);
      return methods.updateTask({ id: t.id, expectedUpdatedAt: fresh.updated_at, patch: { status: target } }, ctx);
    },

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
      // запись в журнал — без ссылки на задачу: её уже нет, и база не даст сослаться на удалённую (название — в записи)
      await log([{ unitId: t.unit_id, action: 'delete', from: `${t.title}` }], ctx);
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
      await notifyMentions(t.id, c.text, '', 'comment');
      return commentOut(c);
    },

    async updateComment(p, ctx) {
      const c = (await one('comments', p.id)) || fail('Комментарий не найден', 'NOT_FOUND');
      const upd = { text: req(str(p.text, 5000), 'Комментарий'), edited_at: now() };
      await updateOne('comments', c.id, upd);
      const t = await one('tasks', c.task_id);
      if (t && upd.text !== c.text) {
        await log([{ unitId: t.unit_id, taskId: t.id, action: 'comment_edit', from: c.text.slice(0, 200), to: upd.text.slice(0, 200) }], ctx);
        await notifyMentions(t.id, upd.text, c.text, 'comment');
      }
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
      // свои задачи + отправленные мной на ревью (они у ревьюера, но видны мне в Review — можно забрать обратно)
      const [mine, sent] = await Promise.all([
        all(() => T('tasks').select('*').eq('assignee_id', me).eq('archived', false).order('id')),
        all(() => T('tasks').select('*').eq('review_from', me).eq('archived', false).order('id')),
      ]);
      const rows = await hideWaiting([...mine, ...sent.filter(t => !mine.some(x => x.id === t.id))]);
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
      const known = new Set((await run(T('departments').select('id'))).map(d => d.id));
      const t = { id: uid('t'), name: req(str(p.name, 40), 'Название команды'), color: color(p.color, PALETTE[n % PALETTE.length]), ord: (await maxOrd('teams')) + 1, archived: false,
        department_ids: [...new Set((Array.isArray(p.departmentIds) ? p.departmentIds : []).map(x => str(x, 40)).filter(x => known.has(x)))].slice(0, 30) };
      await run(T('teams').insert(t));
      return teamOut(t);
    },

    async updateTeam(p) {
      const t = (await one('teams', p.id)) || fail('Команда не найдена', 'NOT_FOUND');
      const upd = {};
      if ('name' in p) upd.name = req(str(p.name, 40), 'Название команды');
      if ('color' in p) upd.color = color(p.color, t.color);
      if ('archived' in p) upd.archived = !!p.archived;
      if ('departmentIds' in p) {
        const known = new Set((await run(T('departments').select('id'))).map(d => d.id));
        upd.department_ids = [...new Set((Array.isArray(p.departmentIds) ? p.departmentIds : []).map(x => str(x, 40)).filter(x => known.has(x)))].slice(0, 30);
      }
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
      const d = { id: uid('d'), name: req(str(p.name, 40), 'Название позиции'), color: color(p.color, PALETTE[count % PALETTE.length]), ord: (await maxOrd('departments')) + 1, archived: false };
      await run(T('departments').insert(d));
      return deptOut(d);
    },

    async updateDepartment(p) {
      const d = (await one('departments', p.id)) || fail('Позиция не найдена', 'NOT_FOUND');
      const upd = {};
      if ('name' in p) upd.name = req(str(p.name, 40), 'Название позиции');
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
      const d = (await one('departments', p.id)) || fail('Позиция не найдена', 'NOT_FOUND');
      await rpc('delete_department', { p_dept: d.id });
      return true;
    },

    /* ---------- состав юнита ---------- */

    /** Добавить человека в команду или сменить его отдел в ней. */
    /**
     * Сменить ответственного (PM) юнита: новый PM — в составе, прежние PM — из состава вон,
     * их открытые задачи CEO (запросы) переходят новому.
     */
    async setUnitPm(p, ctx) {
      const u = await findUnit(p.unitId);
      const pm = (await one('people', p.personId)) || fail('Человек не найден', 'NOT_FOUND');
      if (!['moderator', 'superadmin'].includes(pm.access) || !pm.active) fail('Ответственным за юнит может быть только PM или CEO');
      const old = (await unitPeople(u.id, 'moderator')).filter(x => x.id !== pm.id).map(x => x.id);
      if (pm.access === 'moderator') await methods.setMember({ unitId: u.id, personId: pm.id, departmentId: pm.position_id || '' });
      await updateOne('units', u.id, { pm_id: pm.id, updated_at: now() });
      await log([{ unitId: u.id, action: 'unit_pm', to: pm.name }], ctx);
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

    /** Зоны лидов: { leadId: [personId…] } — CEO и PM видят лидов своих юнитов, лид — свою. */
    async getLeadPeople() {
      const rows = await all(() => T('lead_people').select('lead_id,person_id').order('lead_id').order('person_id'));
      const out = {};
      for (const r of rows) (out[r.lead_id] ||= []).push(r.person_id);
      return out;
    },

    /** Выдать лиду конкретных людей (кроме его позиций). CEO — любому, PM — лиду своего юнита. */
    async setLeadPeople(p) {
      const lead = (await one('people', p.leadId)) || fail('Человек не найден', 'NOT_FOUND');
      if (lead.access !== 'lead') fail('Зона настраивается только для лида');
      await rpc('set_lead_people', { p_lead: lead.id, p_people: (Array.isArray(p.personIds) ? p.personIds : []).map(String) });
      return (await methods.getLeadPeople({}))[lead.id] || [];
    },

    /** Список приложений каждого PM: { personId: [appId…] }. Видит и меняет только CEO. */
    async getPmApps() {
      const rows = await all(() => T('pm_apps').select('person_id,app_id').order('person_id').order('app_id'));
      const out = {};
      for (const r of rows) (out[r.person_id] ||= []).push(r.app_id);
      return out;
    },

    /** Заменить список приложений PM (только CEO). */
    async setPmApps(p) {
      const pid = String(p.personId ?? '');
      const rows = await rpc('whoami', {});
      const who = Array.isArray(rows) ? rows[0] : rows;
      if (!who || who.access !== 'superadmin') fail('Недостаточно прав: список приложений PM настраивает CEO', 'FORBIDDEN');
      const person = await one('people', pid);
      if (!person || person.access !== 'moderator') fail('Список приложений настраивается только для PM');
      const ids = [...new Set((Array.isArray(p.appIds) ? p.appIds : []).map(String))];
      if (ids.length) {
        const found = await run(T('apps').select('id').in('id', ids));
        if (found.length !== ids.length) fail('Какого-то приложения уже нет', 'NOT_FOUND');
      }
      await run(T('pm_apps').delete().eq('person_id', pid).select('app_id'));
      if (ids.length) await run(T('pm_apps').insert(ids.map(app_id => ({ person_id: pid, app_id }))).select('app_id'));
      return ids;
    },

    /**
     * Сводка по приложениям: строка на приложение — этапы основного запроса (дизайн, iOS, тесты, тексты, релиз…), апдейт,
     * ссылки этапов и поля приложения. ready — дизайн закрыт, а iOS ещё не начат (очередь на разработку).
     */
    async getPipeline() {
      const apps = await methods.listApps({});
      const main = a => a.requests.filter(r => r.type === 'new_app').sort((x, y) => String(x.createdAt).localeCompare(String(y.createdAt)))[0]
        || a.requests.filter(r => r.type !== 'update')[0] || null;
      const upd = a => a.requests.filter(r => r.type === 'update').sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)))[0] || null;
      const ids = apps.flatMap(a => (main(a) ? main(a).stages.map(t => t.id) : []));
      const links = ids.length ? await all(() => T('task_links').select('task_id,field_id,url').in('task_id', ids)) : [];
      const brief = t => t && ({ id: t.id, kind: t.kind, done: t.done, blocked: t.blocked, assigneeId: t.assigneeId, updatedAt: t.updatedAt });
      return apps.map(a => {
        const m = main(a), u = upd(a);
        const stages = {};
        for (const t of (m ? m.stages : [])) if (t.step) stages[t.step] = brief(t);
        const mine = {};
        if (m) for (const l of links) if (l.url && m.stages.some(t => t.id === l.task_id)) mine[l.field_id] = mine[l.field_id] || l.url;
        const open = a.requests.filter(r => !r.done && r.stages.length);
        const ready = open.some(r => { const d = r.stages.find(t => t.step === 'design'), i = r.stages.find(t => t.step === 'ios'); return d && i && d.done && !i.done && i.kind === 'todo'; });
        const dd = stages.design;
        return {
          appId: a.id, appName: a.name, iconUrl: a.iconUrl, color: a.color, unitId: a.unitId, status: a.status, info: a.info, checks: a.checks,
          requestId: m ? m.id : '', pmId: m ? m.assigneeId : '', dueDate: m ? m.dueDate : '', priority: m ? m.priority : '',
          stages, links: mine, ready, readySince: ready && dd ? dd.updatedAt : '',
          update: u ? { id: u.id, done: u.done, progress: u.progress, title: u.title } : null,
        };
      });
    },

    async listApps(p) {
      let q = T('apps').select('*').eq('archived', !!p.archived);
      if (p.unitId) q = q.eq('unit_id', String(p.unitId));
      const apps = (await run(q.order('ord').order('created_at'))).map(appOut);
      if (!apps.length) return [];
      const [tasks, units] = await Promise.all([
        all(() => T('tasks').select('id,unit_id,num,title,status,assignee_id,due_date,archived,kind,request_type,step,parent_id,app_id,depends_on,fields,created_at,updated_at,done_at,flow_steps,release')
          .in('app_id', apps.map(a => a.id)).eq('archived', false).order('created_at').order('id')),
        all(() => T('units').select('id,key,settings').order('id')),
      ]);
      const U = Object.fromEntries(units.map(u => [u.id, { ...u, st: unitSettings(u.settings) }]));
      const kindOfRow = r => (U[r.unit_id] ? kindOf(U[r.unit_id].st, r.status) : 'todo');
      const doneRow = r => kindOfRow(r) === 'done';
      // запросы-родители релизов на ревью, которых не видно по правам (у RM) — названия из базы
      const seen = new Set(tasks.map(t => t.id));
      const RP = await releaseParents(tasks.filter(t => t.step === 'release' && t.parent_id && !seen.has(t.parent_id)).map(t => t.parent_id));
      return apps.map(a => {
        const own = tasks.filter(t => t.app_id === a.id);
        const requests = own.filter(t => t.kind === 'request').map(r => {
          // этапы флоу и задачи, которые PM поставил под запрос вручную
          const stages = own.filter(t => t.parent_id === r.id && t.kind !== 'request');
          const done = stages.filter(doneRow);
          return {
            id: r.id, unitId: r.unit_id, key: U[r.unit_id] ? `${U[r.unit_id].key}-${r.num}` : '', title: r.title, type: r.request_type,
            assigneeId: r.assignee_id, dueDate: r.due_date, done: doneRow(r), statusKind: kindOfRow(r),
            priority: (json(r.fields, {}) || {})[PRIORITY_FIELD] || '', createdAt: r.created_at, updatedAt: r.updated_at, doneAt: r.done_at || '', flowSteps: json(r.flow_steps, []) || [],
            stages: stages.map(t => ({ id: t.id, unitId: t.unit_id, step: t.step, title: t.title, assigneeId: t.assignee_id, kind: kindOfRow(t),
              dueDate: t.due_date, updatedAt: t.updated_at,
              done: doneRow(t), blocked: !doneRow(t) && (json(t.depends_on, []) || []).some(id => { const d = own.find(x => x.id === id); return d && !doneRow(d); }) })),
            progress: stages.length ? Math.round((done.length / stages.length) * 100) : 0,
          };
        });
        // последняя работа с приложением: само приложение, его задачи и этапы — чтобы видеть забытые
        const lastActivity = [a.updatedAt, a.statusAt, ...own.map(t => t.updated_at)].filter(Boolean).sort().pop() || a.createdAt || '';
        // на ревью Apple: какой релиз отправлен и что в нём — новое приложение, апдейт №N или исправления реджекта
        const sent = own.filter(t => t.step === 'release' && (json(t.release, {}) || {}).phase === 'submitted')
          .sort((x, y) => String((json(y.release, {}) || {}).submittedAt).localeCompare(String((json(x.release, {}) || {}).submittedAt)))[0];
        const sr = sent ? json(sent.release, {}) || {} : null;
        const review = sent ? {
          releaseId: sent.id, unitId: sent.unit_id, submittedAt: sr.submittedAt || '', version: [(sr.values || {}).version, (sr.values || {}).build].filter(Boolean).join(' · '),
          ...releaseWhat(sent, own.find(t => t.id === sent.parent_id) || RP[sent.parent_id]),
        } : null;
        return { ...a, requests, active: requests.filter(r => !r.done).length, lastActivity, review };
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
        pmId: p.pmId, dueDate: p.dueDate, priority: app.priority, specUrl: p.specUrl,
      }, ctx);
      return { app: appOut(app), request };
    },

    /**
     * Итог проверки App Store (кнопка «Обновить»): items [{ id, ok, storeName?, iconUrl? }] — открывается ли страница в сторе.
     * «Обновлено» у приложения не трогает: проверка — не работа над ним. Могут CEO, PM, RM и лиды юнита (функция базы).
     */
    async saveStoreCheck(p) {
      const items = (Array.isArray(p.items) ? p.items : []).slice(0, 2000).map(x => ({
        id: String(x.id ?? ''), ok: !!x.ok, storeName: str(x.storeName, 200), iconUrl: iconUrl(x.iconUrl),
      }));
      const saved = items.length ? Number(await rpc('save_store_check', { p_items: items })) || 0 : 0;
      return { saved, at: now() };
    },

    /**
     * Автопроверка App Store (база, раз в 2 минуты по одной ссылке, случайный порядок): включена ли, сколько приложений со
     * ссылкой, сколько проверено в текущем круге, последняя проверка. Включает и выключает CEO.
     */
    async getStoreAutoCheck() {
      const cfg = (await setting('storeAutoCheck')) || {};
      const sf = (await appFields()).find(f => f.kind === 'link' && /app ?store/i.test(f.name) && !/connect/i.test(f.name));
      const apps = sf ? (await all(() => T('apps').select('id,name,info,store_checked_at,archived,is_test').eq('archived', false).order('id')))
        .filter(a => !a.is_test && /id\d{5,}/.test((json(a.info, {}) || {})[sf.id] || '')) : [];
      const cyc = cfg.cycleAt || '';
      const last = apps.filter(a => a.store_checked_at).sort((x, y) => String(y.store_checked_at).localeCompare(String(x.store_checked_at)))[0];
      return {
        on: !!cfg.on, cycleAt: cyc, total: apps.length,
        checked: cyc ? apps.filter(a => a.store_checked_at && a.store_checked_at >= cyc).length : 0,
        lastAt: last ? last.store_checked_at : '', lastApp: last ? last.name : '', everyMin: 2,
      };
    },

    /* ---------- инфо-лист: CEO включает людям, у каждого свои поля приложения ---------- */

    /** Кому включён инфо-лист и какие поля (только CEO). */
    async getInfoLists() {
      const who = ((await rpc('whoami', {})) || [])[0] || {};
      if (who.access !== 'superadmin') fail('Инфо-лист настраивает CEO', 'FORBIDDEN');
      const rows = await run(T('info_lists').select('person_id,field_ids').order('person_id'));
      return rows.map(r => ({ personId: r.person_id, fieldIds: json(r.field_ids, []) || [] }));
    },

    /** Включить/выключить инфо-лист человеку и задать поля. on: false — выключить. Только CEO (и в базе). */
    async setInfoList(p) {
      const who = ((await rpc('whoami', {})) || [])[0] || {};
      if (who.access !== 'superadmin') fail('Инфо-лист настраивает CEO', 'FORBIDDEN');
      const person = (await one('people', str(p.personId, 40))) || fail('Человек не найден', 'NOT_FOUND');
      if (!p.on) {
        await run(T('info_lists').delete().eq('person_id', person.id));
        return { personId: person.id, on: false, fieldIds: [] };
      }
      const known = new Set((await appFields()).map(f => f.id));
      const fieldIds = [...new Set((Array.isArray(p.fieldIds) ? p.fieldIds : []).map(x => str(x, 40)).filter(x => known.has(x)))];
      await run(T('info_lists').upsert({ person_id: person.id, field_ids: fieldIds, updated_at: now() }, { onConflict: 'person_id' }));
      return { personId: person.id, on: true, fieldIds };
    },

    /** Мой инфо-лист: включён ли, мои поля и приложения моих юнитов только с этими полями. */
    async getMyInfoList(p) {
      const me = str(p.personId, 40);
      const row = me ? (await run(T('info_lists').select('field_ids').eq('person_id', me)))[0] : null;
      if (!row) return { on: false, fields: [], apps: [] };
      const ids = json(row.field_ids, []) || [];
      const fields = (await appFields()).filter(f => ids.includes(f.id));
      const apps = ((await rpc('my_info_list', {})) || []).map(r => ({
        id: r.id, name: r.name, iconUrl: r.icon_url || '', color: r.color || '', unitId: r.unit_id, values: json(r.vals, {}) || {},
      }));
      return { on: true, fields, apps };
    },

    /** Показывать ли кнопку «Обновить» в проверке App Store (проверка идёт из браузера, с адреса человека). Меняет CEO. */
    async setStoreManualCheck(p) {
      await run(T('app_settings').upsert({ key: 'storeManualCheck', value: { show: !!p.show }, updated_at: now() }, { onConflict: 'key' }));
      return { show: !!p.show };
    },

    async setStoreAutoCheck(p) {
      const cfg = (await setting('storeAutoCheck')) || {};
      await run(T('app_settings').upsert({ key: 'storeAutoCheck', value: { ...cfg, on: !!p.on }, updated_at: now() }, { onConflict: 'key' }));
      return methods.getStoreAutoCheck();
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
     * Убрать приложение (CEO): shelf spam — Design Spam [4.3], sale — снято с продажи (Removed from sale), deleted — удалённые. Приложение уходит из работы (archived),
     * его открытые задачи — в архив (запоминаем, чтобы вернуть). Уже убранное — просто переезжает на другую полку.
     */
    async shelveApp(p, ctx) {
      const shelf = ['spam', 'sale', 'deleted'].includes(p.shelf) ? p.shelf : fail('Нет такой полки');
      const a = (await one('apps', p.id)) || fail('Приложение не найдено', 'NOT_FOUND');
      const ts = now();
      if (a.archived) {
        await updateOne('apps', a.id, { shelf, updated_at: ts });
        return appOut({ ...a, shelf });
      }
      const rows = await all(() => T('tasks').select('id,unit_id,status').eq('app_id', a.id).eq('archived', false).order('created_at').order('id'));
      const units = rows.length ? await run(T('units').select('id,settings').in('id', [...new Set(rows.map(t => t.unit_id))])) : [];
      const U = Object.fromEntries(units.map(u => [u.id, unitSettings(u.settings)]));
      const open = rows.filter(t => !U[t.unit_id] || kindOf(U[t.unit_id], t.status) !== 'done').map(t => t.id);
      // сначала приложение: права проверяет база (только CEO), задачи — потом
      const upd = { archived: true, shelf, shelved_at: ts, shelf_tasks: open, updated_at: ts };
      await updateOne('apps', a.id, upd);
      for (const id of open) await methods.updateTask({ id, patch: { archived: true } }, ctx);
      return appOut({ ...a, ...upd });
    },

    /** Вернуть приложение из Design Spam / удалённых (CEO): снова в работе, задачи, ушедшие с ним в архив, — обратно. */
    async restoreApp(p, ctx) {
      const a = (await one('apps', p.id)) || fail('Приложение не найдено', 'NOT_FOUND');
      if (!a.archived) return appOut(a);
      const back = (json(a.shelf_tasks, []) || []).map(String);
      const upd = { archived: false, shelf: '', shelved_at: '', shelf_tasks: [], updated_at: now() };
      await updateOne('apps', a.id, upd);
      for (const id of back) await methods.updateTask({ id, patch: { archived: false } }, ctx).catch(() => null);
      return appOut({ ...a, ...upd });
    },

    /**
     * Дашборд PM по его юнитам (CEO — по всем; видимость решает база): входящие от CEO (запросы без разбивки),
     * приложения по этапам (открытые запросы с этапами), проблемы (просрочено, без движения, без исполнителя,
     * долго на ревью, готово к релизу) и команда с KPI за период (week / month / quarter).
     */
    async getPmDashboard(p) {
      const isCeo = ((await rpc('whoami', {}))?.[0] || {}).access === 'superadmin';
      const day = today(p.today);
      const periodDays = { week: 7, month: 30, quarter: 90 }[p.period] || 30;
      const from = new Date(Date.now() - periodDays * 864e5).toISOString();
      const [units, tasks, members, ppl, apps, staleRow] = await Promise.all([
        all(() => T('units').select('id,name,key,color,settings').eq('archived', false).order('ord').order('id')),
        all(() => T('tasks').select('id,unit_id,num,title,status,assignee_id,due_date,archived,kind,request_type,step,parent_id,app_id,depends_on,created_at,updated_at,done_at,started_at,department_id,created_by')
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
        updatedAt: t.updated_at, step: t.step || '', type: t.request_type || '', kind: kindOfRow(t), done: done(t), blocked: blocked(t), app: A[t.app_id] || null, createdBy: t.created_by || '' });
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
      return { inbox, pipeline, problems, team: isCeo ? team : [], period: { days: periodDays, from } };  // KPI людей — только CEO
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
     * Данные своего графика (Настройки → Графики): chart — { metric, split, step, days }, unitId — только этот юнит.
     * Ось X — шаги до сегодня (день, неделя, месяц) или «Итогом» (категории разбивки; у приложений — статусы, ряды — разбивка).
     * Ряды — по разбивке, не больше 8: остальное — в «Остальные». Видно только то, что человек видит по правилам базы.
     * Возвращает { x: [{ key, label, end }], series: [{ id, name, color, values }], total, unit }.
     */
    async getChartData(p) {
      if (((await rpc('whoami', {}))?.[0] || {}).access !== 'superadmin') fail('Недостаточно прав: графики и аналитика — только для CEO', 'FORBIDDEN');
      const c = cleanChart(p.chart || {});
      const kind = METRIC_KIND[c.metric];
      const end = today(p.today);
      const dayMs = 864e5, endMs = Date.parse(end + 'T00:00:00Z');
      const iso = ms => new Date(ms).toISOString().slice(0, 10);
      // шаги: последний кончается сегодня; «Итогом» — один шаг на весь период
      const size = { day: 1, week: 7, month: 30, total: c.days }[c.step];
      const n = Math.max(1, Math.ceil(c.days / size));
      const buckets = Array.from({ length: n }, (_, i) => {
        const e = endMs - (n - 1 - i) * size * dayMs;
        return { from: iso(e - (size - 1) * dayMs), to: iso(e) };
      });
      const inBucket = d => buckets.findIndex(b => d >= b.from && d <= b.to);
      const day = v => String(v || '').slice(0, 10);

      const [units, statuses, people, depts] = await Promise.all([
        all(() => T('units').select('id,name,color,ord').eq('archived', false).order('ord').order('id')), appStatuses(),
        all(() => T('people').select('id,name,color').order('name').order('id')),
        all(() => T('departments').select('id,name,color').order('ord').order('id')),
      ]);
      const unitOk = id => units.some(u => u.id === id) && (!p.unitId || id === String(p.unitId));
      const kindOf = id => (statuses.find(x => x.id === id) || {}).kind || '';
      const PAL = ['#0087EA', '#EC9900', '#5FCD74', '#764BF2', '#C53B4C', '#0EC2B5', '#E05FA0', '#7F5500'];
      const named = (list, id) => list.find(x => x.id === id);
      const meta = (dim, id, i) => {
        if (dim === 'none') return { name: { apps: 'Приложения', tasks: 'Задачи', releases: 'Релизы', rejects: 'Реджекты', overdue: 'Просрочки', cycle: 'Время в работе' }[c.metric], color: '' };
        if (dim === 'unit') { const u = named(units, id); return { name: u ? u.name : '—', color: u && u.color }; }
        if (dim === 'status') { const st = named(statuses, id); return { name: st ? st.name : '—', color: st && st.color }; }
        if (dim === 'position') { const d = named(depts, id); return { name: d ? d.name : 'Без позиции', color: d && d.color }; }
        const who = named(people, id);
        return { name: who ? who.name : dim === 'pm' ? 'Без PM' : 'Без исполнителя', color: PAL[i % PAL.length] };
      };

      // PM приложения — исполнитель последнего запроса CEO по нему
      const pmOfApp = async () => {
        const reqs = await all(() => T('tasks').select('app_id,assignee_id,created_at').eq('kind', 'request').order('created_at').order('id'));
        const m = {};
        for (const r of reqs) if (r.app_id) m[r.app_id] = r.assignee_id || m[r.app_id] || '';
        return m;
      };

      // ряды: rows — [{ dims, at | state(endDay) }]; потом раскладываем по шагам
      const add = (acc, key, bi, v = 1) => { (acc[key] || (acc[key] = buckets.map(() => 0)))[bi] += v; };
      const acc = {}, cnt = {}; // cnt — для средних (время в работе)
      let xs = null; // «Итогом» у приложений: ось — статусы
      const dimOf = (row, dim) => (dim === 'none' ? 'all' : row[dim] || '');

      if (c.metric === 'apps') {
        const apps = (await all(() => T('apps').select('id,unit_id,status,created_at').eq('archived', false).order('id'))).filter(a => unitOk(a.unit_id));
        const log = apps.length ? await all(() => T('app_status_log').select('app_id,from_status,to_status,at').in('app_id', apps.map(a => a.id)).order('at').order('id')) : [];
        const pm = c.split === 'pm' ? await pmOfApp() : {};
        const by = {};
        for (const r of log) (by[r.app_id] || (by[r.app_id] = [])).push(r);
        const statusAt = (a, t) => {
          const ev = by[a.id] || [];
          const first = ev.length ? ev[0].from_status : a.status;
          const existed = !!first && kindOf(first) !== 'dev';
          if (!existed && a.created_at && a.created_at > t) return null; // приложения ещё не было
          let st = ev.length ? ev[0].from_status || (ev[0].at <= t ? '' : a.status) : a.status;
          for (const e of ev) { if (e.at <= t) st = e.to_status; else break; }
          if (!st && ev.length) st = ev[0].to_status;
          return st;
        };
        if (c.step === 'total') {
          // сейчас: ось — статусы, ряды — разбивка (как «Юниты × статусы»)
          xs = statuses.map(st => ({ key: st.id, label: st.name }));
          for (const a of apps) {
            const row = { unit: a.unit_id, status: a.status, pm: pm[a.id] || '' };
            const xi = statuses.findIndex(st => st.id === a.status);
            if (xi < 0) continue;
            const key = c.split === 'status' || c.split === 'none' ? 'all' : dimOf(row, c.split);
            (acc[key] || (acc[key] = statuses.map(() => 0)))[xi]++;
          }
        } else {
          buckets.forEach((b, bi) => {
            const t = b.to + 'T23:59:59.999Z';
            for (const a of apps) {
              const st = statusAt(a, t);
              if (!st || !statuses.some(x => x.id === st)) continue;
              add(acc, dimOf({ unit: a.unit_id, status: st, pm: pm[a.id] || '' }, c.split), bi);
            }
          });
        }
      } else if (c.metric === 'releases' || c.metric === 'rejects') {
        const rows = (await all(() => T('tasks').select('id,unit_id,app_id,release').eq('step', 'release').order('created_at').order('id'))).filter(t => unitOk(t.unit_id));
        const pm = c.split === 'pm' ? await pmOfApp() : {};
        const want = c.metric === 'releases' ? 'live' : 'reject';
        for (const t of rows) {
          const rel = json(t.release, {}) || {};
          let hist = Array.isArray(rel.history) ? rel.history : [];
          if (!hist.length && rel.submittedAt) hist = [{ result: rel.phase === 'live' ? 'live' : rel.phase === 'rejected' ? 'reject' : '', at: rel.liveAt || rel.rejectedAt || '' }];
          for (const x of hist) {
            if (x.result !== want) continue;
            const bi = inBucket(day(x.at));
            if (bi >= 0) add(acc, dimOf({ unit: t.unit_id, pm: rel.pmId || pm[t.app_id] || '' }, c.split), bi);
          }
        }
      } else {
        const tasks = (await all(() => T('tasks').select('id,unit_id,assignee_id,department_id,done_at,started_at,created_at,due_date').eq('archived', false).order('id'))).filter(t => unitOk(t.unit_id));
        for (const t of tasks) {
          const row = { unit: t.unit_id, position: t.department_id, person: t.assignee_id };
          const key = dimOf(row, c.split);
          if (c.metric === 'tasks' || c.metric === 'cycle') {
            const bi = t.done_at ? inBucket(day(t.done_at)) : -1;
            if (bi < 0) continue;
            if (c.metric === 'tasks') { add(acc, key, bi); continue; }
            const from = Date.parse(t.started_at || t.created_at);
            if (!from) continue;
            add(acc, key, bi, Math.max(0, (Date.parse(t.done_at) - from) / dayMs));
            add(cnt, key, bi);
          } else {
            // просрочена на конец шага: срок прошёл, а задача ещё не закрыта
            if (!t.due_date) continue;
            buckets.forEach((b, bi) => {
              if (day(t.created_at) > b.to || t.due_date >= b.to) return;
              if (t.done_at && day(t.done_at) <= b.to) return;
              add(acc, key, bi);
            });
          }
        }
        if (c.metric === 'cycle') for (const k of Object.keys(acc)) acc[k] = acc[k].map((v, i) => (cnt[k][i] ? Math.round(v / cnt[k][i] * 10) / 10 : 0));
      }

      // «Итогом» по шагу: одна точка на ряд → ось — категории разбивки
      let series = Object.entries(acc).map(([id, values], i) => ({ id, ...meta(id === 'all' ? 'none' : c.split, id, i), values }));
      const sum = s => s.values.reduce((a, b) => a + b, 0);
      // юниты — в своём порядке, статусы — как в настройках; люди, позиции и PM — больше сверху
      if (c.split === 'unit') series.sort((a, b) => units.findIndex(u => u.id === a.id) - units.findIndex(u => u.id === b.id));
      else if (c.split !== 'none' && c.split !== 'status' && !xs) series.sort((a, b) => sum(b) - sum(a));
      if (c.split === 'status' && !xs) series.sort((a, b) => statuses.findIndex(x => x.id === a.id) - statuses.findIndex(x => x.id === b.id));
      if (series.length > 8) {
        const rest = series.slice(7);
        series = [...series.slice(0, 7), { id: 'rest', name: 'Остальные', color: '#9AA0AD', values: rest[0].values.map((_, i) => rest.reduce((a, s) => a + s.values[i], 0)) }];
      }
      if (c.split === 'none' && !series.length) series = [{ id: 'all', ...meta('none'), values: (xs || buckets).map(() => 0) }];
      let x = xs || buckets.map(b => ({ key: b.to, label: b.to, end: b.to }));
      if (!xs && c.step === 'total' && c.split !== 'none') {
        // ось — сами категории, один ряд
        x = series.map(s => ({ key: s.id, label: s.name, color: s.color }));
        series = [{ id: 'all', ...meta('none'), values: series.map(s => s.values[0]) }];
      }
      const allVals = series.flatMap(s => s.values);
      const total = kind === 'avg'
        ? (allVals.filter(Boolean).length ? Math.round(allVals.filter(Boolean).reduce((a, b) => a + b, 0) / allVals.filter(Boolean).length * 10) / 10 : 0)
        : kind === 'state' && !xs && c.step !== 'total' ? series.reduce((a, s) => a + s.values[s.values.length - 1], 0) : allVals.reduce((a, b) => a + b, 0);
      return { x, series, total, unit: kind === 'avg' ? 'дн.' : '', chart: c };
    },

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
    /**
     * «Поставить в работу» (CEO): приложениям без задач (добавлены списком) — запрос New App ответственному PM юнита,
     * дальше PM раскладывает его по этапам. Приложения, у которых уже есть запрос, пропускаем. Возвращает число запросов.
     */
    async startAppsWork(p, ctx) {
      if ((((await rpc('whoami', {})) || [])[0] || {}).access !== 'superadmin') fail('Ставить приложения в работу может только CEO', 'FORBIDDEN');
      const ids = (Array.isArray(p.ids) ? p.ids : []).map(x => String(x ?? '')).filter(Boolean).slice(0, 500);
      let made = 0;
      for (const id of ids) {
        const a = await one('apps', id);
        if (!a || a.archived) continue;
        const has = await run(T('tasks').select('id').eq('app_id', a.id).eq('kind', 'request').eq('archived', false).limit(1));
        if (has.length) continue;
        await methods.createRequest({ appId: a.id, type: 'new_app', title: `New App: ${a.name}` }, ctx);
        made++;
      }
      return { made };
    },

    async createRequest(p, ctx) {
      const a = (await one('apps', p.appId)) || fail('Приложение не найдено', 'NOT_FOUND');
      const type = REQUEST_TYPES[p.type] ? p.type : 'other';
      const pms = await unitPeople(a.unit_id, 'moderator');
      const respId = await responsiblePm(a.unit_id);
      const pmId = p.pmId && (p.pmId === respId || pms.some(x => x.id === p.pmId)) ? p.pmId : respId;
      const prio = await validPriority('priority' in p ? p.priority : a.priority);
      // «Кому» — не PM (задача, не апдейт): обычная задача прямо на человека из юнита, видна у него в «Мои задачи»
      const to = str(p.assigneeId, 40);
      if (to && type === 'other' && to !== pmId && to !== respId && !pms.some(x => x.id === to)) {
        if (!(await unitPeople(a.unit_id)).some(x => x.id === to)) fail('Этого человека нет в юните приложения');
        return methods.createTask({
          unitId: a.unit_id, title: req(str(p.title, 500), 'Название задачи'), description: p.description || '',
          assigneeId: to, dueDate: p.dueDate, appId: a.id, test: !!a.is_test,
          fields: prio ? { [PRIORITY_FIELD]: prio } : {}, specUrl: p.specUrl,
        }, ctx);
      }
      // шаблон апдейта: пункты — чеклистом запроса, нужные этапы — запоминаем для разбивки
      const tpl = p.templateId ? await one('task_templates', String(p.templateId)) : null;
      let title = str(p.title, 500) || (tpl && tpl.title) || `${REQUEST_TYPES[type]}: ${a.name}`;
      // апдейты нумеруются сами по приложению: «Апдейт №3: …» (руками номер не пишут)
      if (type === 'update') {
        const n = (await run(T('tasks').select('id').eq('app_id', a.id).eq('kind', 'request').eq('request_type', 'update'))).length + 1;
        const rest = title.replace(/^апдейт\s*(№\s*\d+)?\s*[:·—-]?\s*/i, '').trim();
        title = str(`Апдейт №${n}: ${rest || a.name}`, 500);
      }
      return methods.createTask({
        unitId: a.unit_id, title,
        description: p.description || (tpl ? tpl.description : ''),
        assigneeId: pmId, dueDate: p.dueDate, kind: 'request', requestType: type, appId: a.id, test: !!a.is_test,
        fields: prio ? { [PRIORITY_FIELD]: prio } : {}, specUrl: p.specUrl,
        checklist: tpl ? json(tpl.checklist, []) : p.checklist, flowSteps: tpl ? json(tpl.steps, []) : p.flowSteps,
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
      // запрос из шаблона апдейта — только его этапы (зависимости от убранных этапов снимаются)
      const only = json(r.flow_steps, []) || [];
      const pick_ = list => (only.length ? list.filter(s => only.includes(s.key)).map(s => ({ ...s, dependsOn: s.dependsOn.filter(k => only.includes(k)) })) : list);
      const steps = plan ? cleanFlow(plan) : pick_((await flows(r.unit_id))[r.request_type] || []);
      if (!steps.length) fail(plan ? 'Оставьте хотя бы один этап' : 'Для этого типа запроса нет флоу — создайте задачи вручную');
      const extra = Object.fromEntries((plan || []).map(x => [x && x.key, x || {}]));
      const people = await unitPeople(r.unit_id);
      const pick = positionId => {
        const withPos = people.filter(x => x.positionIds.includes(positionId));
        return (withPos.find(x => x.access === 'lead') || withPos[0] || {}).id || '';
      };
      const who = st => (st.release ? '' : extra[st.key] && 'assigneeId' in extra[st.key] ? str(extra[st.key].assigneeId, 40) : pick(st.positionId));
      const due = st => (extra[st.key] && 'dueDate' in extra[st.key] ? date(extra[st.key].dueDate) : r.due_date);
      // проверяем всех до первого создания: иначе запрос останется разложен наполовину
      for (const st of steps) await fitsAssignee(r.unit_id, { kind: 'stage', step: st.key, departmentId: st.positionId }, who(st));
      const ids = {}, created = [];
      const prio = (json(r.fields, {}) || {})[PRIORITY_FIELD]; // приоритет запроса — этапам
      for (const st of steps) {
        const t = await methods.createTask({
          unitId: r.unit_id, title: `${st.title} · ${r.title.replace(/^New App:\s*/, '')}`, parentId: r.id, kind: 'stage', step: st.key,
          appId: r.app_id, departmentId: st.positionId, assigneeId: who(st), dueDate: due(st),
          dependsOn: st.dependsOn.map(k => ids[k]).filter(Boolean), test: !!r.is_test, fields: prio ? { [PRIORITY_FIELD]: prio } : {},
          checklist: (st.checklist || []).map(text => ({ text })),
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
     * PM/CEO: добавить этап из флоу в уже разложенный запрос (например, «Интеграция», если решили по ходу).
     * Ждёт тех, кого ждёт по флоу; кто по флоу ждёт его (релиз) — ждёт и сейчас. Исполнитель — лид позиции, иначе первый.
     */
    async addStage(p, ctx) {
      const r = await findTask(p.requestId);
      if (r.kind !== 'request') fail('Этап добавляется в запрос');
      // этап ищем во флоу запроса, потом во флоу New App (например, «Метаданные» в апдейт — рефактор меты)
      const all_ = await flows(r.unit_id);
      const flow = [all_[r.request_type] || [], DEFAULT_FLOWS[r.request_type] || [], all_.new_app || [], DEFAULT_FLOWS.new_app].find(f => f.some(x => x.key === p.key)) || [];
      const def = flow.find(x => x.key === p.key) || fail('Такого этапа нет во флоу');
      if (def.release) fail('Релиз уже есть в разложенном запросе');
      const stages = (await run(T('tasks').select('id,step,status,depends_on,archived').eq('parent_id', r.id).eq('kind', 'stage'))).filter(x => !x.archived);
      if (!stages.length) fail('Запрос ещё не разложен — этапы выбираются в окне разбивки');
      if (stages.some(x => x.step === def.key)) fail(`Этап «${def.title}» уже есть`);
      const byStep = Object.fromEntries(stages.map(x => [x.step, x]));
      const withPos = (await unitPeople(r.unit_id)).filter(x => x.positionIds.includes(def.positionId));
      const assigneeId = 'assigneeId' in p ? str(p.assigneeId, 40) : (withPos.find(x => x.access === 'lead') || withPos[0] || {}).id || '';
      await fitsAssignee(r.unit_id, { kind: 'stage', step: def.key, departmentId: def.positionId }, assigneeId);
      const prio = (json(r.fields, {}) || {})[PRIORITY_FIELD];
      const t = await methods.createTask({
        unitId: r.unit_id, title: `${def.title} · ${r.title.replace(/^New App:\s*/, '')}`, parentId: r.id, kind: 'stage', step: def.key,
        appId: r.app_id, departmentId: def.positionId, assigneeId, dueDate: r.due_date,
        dependsOn: (def.dependsOn || []).map(k => byStep[k] && byStep[k].id).filter(Boolean), test: !!r.is_test,
        fields: prio ? { [PRIORITY_FIELD]: prio } : {}, checklist: (def.checklist || []).map(text => ({ text })),
      }, ctx);
      const st = unitSettings((await findUnit(r.unit_id)).settings);
      for (const w of flow.filter(x => (x.dependsOn || []).includes(def.key)).map(x => byStep[x.key]).filter(Boolean)) {
        const deps = json(w.depends_on, []) || [];
        if (kindOf(st, w.status) !== 'done' && !deps.includes(t.id)) await updateOne('tasks', w.id, { depends_on: [...deps, t.id], updated_at: now() });
      }
      await log([{ unitId: r.unit_id, taskId: r.id, action: 'stage_add', to: def.title }], ctx);
      return t;
    },

    /** PM/CEO: убрать незакрытый этап запроса (в архив). Кто его ждал — теперь ждёт то, что ждал он. Релиз не убирается. */
    async removeStage(p, ctx) {
      const t = await findTask(p.taskId);
      if (t.kind !== 'stage' || !t.parent_id) fail('Убрать можно только этап запроса');
      if (t.step === 'release') fail('Релиз убрать нельзя');
      const st = unitSettings((await findUnit(t.unit_id)).settings);
      if (kindOf(st, t.status) === 'done') fail('Этап уже закрыт');
      const mine = json(t.depends_on, []) || [];
      const sib = await run(T('tasks').select('id,depends_on').eq('parent_id', t.parent_id).eq('kind', 'stage'));
      for (const x of sib) {
        const deps = json(x.depends_on, []) || [];
        if (x.id !== t.id && deps.includes(t.id)) {
          await updateOne('tasks', x.id, { depends_on: [...deps.filter(d => d !== t.id), ...mine.filter(d => !deps.includes(d))], updated_at: now() });
        }
      }
      await updateOne('tasks', t.id, { archived: true, updated_at: now() });
      await log([{ unitId: t.unit_id, taskId: t.parent_id, action: 'stage_remove', from: t.title.split(' · ')[0] }], ctx);
      return true;
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
      // чеклист — не подставляем сам: у RM свои шаблоны («Из шаблона» в карточке релиза)
      const saved = await methods.updateTask({ id: t.id, patch: { assigneeId: rmId } }, ctx);
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
        all(() => T('tasks').select('id,unit_id,num,title,status,assignee_id,due_date,archived,kind,step,app_id,depends_on,fields,review_from,department_id,updated_at,parent_id,checklist')
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
      const brief = t => ({ id: t.id, unitId: t.unit_id, unit: { color: U[t.unit_id].color }, key: `${U[t.unit_id].key}-${t.num}`, title: t.title, dueDate: t.due_date, kind: kindOfRow(t),
        checklist: (json(t.checklist, []) || []).map(i => !!i.done),
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

      // отправлено мной на ревью: задача лежит в колонке ревью, исполнитель сейчас — ревьюер
      const sent = vis.filter(t => t.review_from === meId && reviewing(t) && t.assignee_id !== meId).map(t => ({ ...brief(t), reviewerId: t.assignee_id }))
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      if (!isLead) return { focus, sent, lead: null };
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
      // розданное: мои этапы с подзадачами (step = part) — кто делает, где сейчас, срок; этап — пока не закрыт
      const split = vis.filter(t => t.assignee_id === meId && !done(t) && vis.some(c => c.parent_id === t.id && c.step === 'part')).map(t => {
        const parts = vis.filter(c => c.parent_id === t.id && c.step === 'part').map(c => ({
          ...brief(c), workerId: c.review_from || c.assignee_id, inReview: reviewing(c), late: !done(c) && !!c.due_date && c.due_date < day,
        }));
        return { ...brief(t), parts, done: parts.filter(c => c.kind === 'done').length };
      });
      return { focus, sent, lead: { reviews, team, split } };
    },

    /**
     * «Раздать» (лид — свой этап, или PM): подзадачи сотрудникам позиции. items: [{ title, assigneeId, dueDate, checklist: [text] }].
     * Подзадачи наследуют ТЗ, описание, ссылки; этап закроется сам, когда закрыты все подзадачи. Возвращает созданные задачи.
     */
    async splitTask(p) {
      const t = await findTask(p.taskId);
      const items = (Array.isArray(p.items) ? p.items : []).slice(0, 30).map(x => ({
        title: str(x && x.title, 500), assigneeId: str(x && x.assigneeId, 40), dueDate: date(x && x.dueDate),
        checklist: (Array.isArray(x && x.checklist) ? x.checklist : []).map(i => str(i, 300)).filter(Boolean).slice(0, 50),
      })).filter(x => x.title);
      if (!items.length) fail('Добавьте хотя бы одну подзадачу');
      const res = await rpc('lead_split', { p_task: t.id, p_items: items });
      const ids = (Array.isArray(res) ? res : [res]).map(x => (typeof x === 'string' ? x : x && (x.lead_split || Object.values(x)[0]))).filter(Boolean);
      return ids.length ? (await run(T('tasks').select('*').in('id', ids))).map(taskOut) : [];
    },

    /** QA: «Вернуть в разработку» со списком багов — предыдущие этапы снова в работе, QA ждёт. Возвращает число этапов. */
    async qaReturn(p) {
      const t = await findTask(p.taskId);
      return rpc('qa_return', { p_task: t.id, p_text: str(p.text, 5000), p_url: linkUrl(p.url) });
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
      const [app, links, lf, settings, devForm] = await Promise.all([
        t.app_id ? one('apps', t.app_id) : null, rpc('release_links', { p_task: t.id }), linkFields(), methods.getReleaseSettings(), rpc('release_dev_form', { p_task: t.id }),
      ]);
      const LF = Object.fromEntries(lf.map(f => [f.id, f]));
      // номер следующего реджекта — по приложению (все его релизы)
      const sib = t.app_id ? await run(T('tasks').select('release').eq('app_id', t.app_id).eq('step', 'release')) : [];
      const rejects = sib.reduce((n, r) => n + ((json(r.release, {}) || {}).history || []).filter(x => x.result === 'reject').length, 0);
      return {
        task: taskOut(t), app: app ? appOut(app) : null, fields: settings.fields, nextRejectNo: rejects + 1, devForm: json(devForm, {}) || {},
        links: (links || []).map(l => ({ taskId: l.task_id, step: l.step, stage: String(l.title).split(' · ')[0], fieldId: l.field_id, name: (LF[l.field_id] || {}).name || 'Ссылка', kind: (LF[l.field_id] || {}).kind || 'link', url: l.url })),
      };
    },

    /** Команда релиза для RM: { pm: [id], design: [id], ios: [id], qa: [id], meta: [id] } — кто делал приложение. */
    async getReleaseTeam(p) {
      const t = await findTask(p.taskId);
      const rows = (await rpc('release_team', { p_task: t.id })) || [];
      const out = { pm: [], design: [], ios: [], qa: [], meta: [] };
      for (const r of Array.isArray(rows) ? rows : [rows]) {
        const k = r && (r.step === 'integr' ? 'ios' : r.step); // интеграция — в «Разработке»
        if (k && out[k] && r.person_id && !out[k].includes(r.person_id)) out[k].push(r.person_id);
      }
      return out;
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
      if (!['submit', 'live', 'reject', 'resubmit', 'close_reject'].includes(p.action)) fail('Неизвестный шаг релиза');
      const t = await findTask(p.taskId);
      const id = await rpc('release_step', { p_task: t.id, p_action: p.action, p_reason: str(p.reason, 2000), p_shot: linkUrl(p.shot), p_self: p.action === 'reject' && !!p.self });
      return { task: taskOut(await findTask(t.id)), rejectRequestId: p.action === 'reject' ? id : '' };
    },

    /** Мониторинг: ошибка в браузере пользователя (пишет само приложение; человек — тот, кто вошёл). */
    async logClientError(p) {
      const me = (await rpc('my_person_id', {})) || '';
      const message = str(p.message, 1000);
      if (!message) return false;
      await run(T('client_errors').insert({ person_id: me, message, stack: str(p.stack, 4000), url: str(p.url, 500), agent: str(p.agent, 300), version: str(p.version, 60) }));
      return true;
    },

    /** Режим разработчика: ошибки у пользователей за N дней (новые сверху); старше 30 дней — удаляются. */
    async getClientErrors(p) {
      const days = Math.min(30, Math.max(1, Number(p.days) || 7));
      await run(T('client_errors').delete().lt('at', new Date(Date.now() - 30 * 864e5).toISOString())).catch(() => null);
      const rows = await run(T('client_errors').select('*').gte('at', new Date(Date.now() - days * 864e5).toISOString()).order('at', { ascending: false }).limit(300));
      return rows.map(r => ({ id: r.id, personId: r.person_id, at: r.at, message: r.message, stack: r.stack, url: r.url, agent: r.agent, version: r.version }));
    },

    async clearClientErrors() {
      await run(T('client_errors').delete().neq('id', ''));
      return true;
    },

    /* ---------- обратная связь: предложения людей по улучшению сервиса ---------- */

    /** Отправить предложение (любой). kind: idea | inconvenient | bug. */
    async sendFeedback(p) {
      const me = (await rpc('my_person_id', {})) || '';
      if (!me) fail('Войдите, чтобы отправить предложение', 'FORBIDDEN');
      const kind = FEEDBACK_KINDS.includes(p.kind) ? p.kind : 'idea';
      const row = { id: uid('fb'), person_id: me, kind, text: req(str(p.text, 4000), 'Текст предложения'), status: 'new', created_at: now(), done_at: '' };
      await run(T('feedback').insert(row));
      return feedbackOut(row);
    },

    /** Мои предложения — новые сверху. */
    async getMyFeedback() {
      const me = (await rpc('my_person_id', {})) || '';
      if (!me) return [];
      return (await run(T('feedback').select('*').eq('person_id', me).order('created_at', { ascending: false }).limit(100))).map(feedbackOut);
    },

    /** Режим разработчика: все предложения — новые сверху. */
    async getFeedback() {
      const rows = await run(T('feedback').select('*').order('created_at', { ascending: false }).limit(500));
      return rows.map(feedbackOut);
    },

    /** Режим разработчика: отметить «учтено» / вернуть в новые. */
    async setFeedbackStatus(p) {
      const status = p.status === 'done' ? 'done' : 'new';
      await updateOne('feedback', str(p.id, 40), { status, done_at: status === 'done' ? now() : '' });
      return { id: p.id, status };
    },

    async deleteFeedback(p) {
      const gone = await run(T('feedback').delete().eq('id', str(p.id, 40)).select('id'));
      if (!gone.length) fail('Недостаточно прав для этого действия', 'FORBIDDEN');
      return true;
    },

    /** Бэклог (CEO): идеи и ТЗ — новые сверху, запущенные ниже. */
    async listIdeas() {
      return (await run(T('ideas').select('*').order('created_at', { ascending: false }))).map(ideaOut);
    },

    async saveIdea(p, ctx) {
      const kind = p.kind === 'update' ? 'update' : 'new_app';
      const app = kind === 'update' ? ((p.appId && (await one('apps', String(p.appId)))) || fail('Выберите приложение для апдейта')) : null;
      // юнит: у апдейта — юнит приложения; у новой идеи — выбранный ('' — общий бэклог)
      const unitId = app ? app.unit_id : p.unitId ? (await findUnit(String(p.unitId))).id : '';
      const row = {
        title: req(str(p.title, 200), 'Название'), description: str(p.description, 20000), spec_url: linkUrl(p.specUrl), kind,
        app_id: app ? app.id : '', unit_id: unitId, updated_at: now(),
      };
      if (p.id) {
        await updateOne('ideas', String(p.id), row);
        return ideaOut(await one('ideas', String(p.id)));
      }
      const idea = { id: uid('i'), ...row, status: 'new', request_id: '', created_by: actor(ctx), created_at: now() };
      await run(T('ideas').insert(idea));
      return ideaOut(idea);
    },

    async deleteIdea(p) {
      await run(T('ideas').delete().eq('id', String(p.id || '')));
      return true;
    },

    /** Запустить идею: новое приложение в юните (запрос New App ответственному) или запрос «Апдейт» по приложению. */
    async startIdea(p, ctx) {
      const idea = (await one('ideas', String(p.id || ''))) || fail('Идея не найдена', 'NOT_FOUND');
      if (idea.status === 'started') fail('Идея уже запущена');
      let request;
      if (idea.kind === 'update') {
        request = await methods.createRequest({ appId: idea.app_id, type: 'update', title: idea.title, description: idea.description, specUrl: idea.spec_url, templateId: p.templateId }, ctx);
      } else {
        const made = await methods.createApp({ unitId: p.unitId || idea.unit_id, name: str(p.name, 120) || idea.title, description: idea.description, specUrl: idea.spec_url, requestTitle: `New App: ${str(p.name, 120) || idea.title}` }, ctx);
        request = made.request;
      }
      await updateOne('ideas', idea.id, { status: 'started', request_id: request ? request.id : '', updated_at: now() });
      return { idea: ideaOut(await one('ideas', idea.id)), request };
    },

    /** Замещения (CEO): кто за кого и с какого по какое число. */
    async listDeputies() {
      return (await run(T('deputies').select('*').order('date_from'))).map(r => ({ id: r.id, personId: r.person_id, deputyId: r.deputy_id, from: r.date_from, to: r.date_to, note: r.note || '' }));
    },

    async saveDeputy(p, ctx) {
      const person = (await one('people', p.personId)) || fail('Кого замещают — не выбран');
      const deputy = (await one('people', p.deputyId)) || fail('Заместитель не выбран');
      if (person.id === deputy.id) fail('Человек не может замещать сам себя');
      const from = date(p.from) || fail('Укажите дату начала');
      const to = date(p.to) || fail('Укажите дату конца');
      if (to < from) fail('Дата конца раньше начала');
      const row = { person_id: person.id, deputy_id: deputy.id, date_from: from, date_to: to, note: str(p.note, 200) };
      if (p.id) await updateOne('deputies', String(p.id), row);
      else await run(T('deputies').insert({ id: uid('dp'), ...row, created_at: now() }));
      await log([{ action: 'deputy', to: `${person.name} → ${deputy.name}, ${from} – ${to}` }], ctx);
      return methods.listDeputies();
    },

    async deleteDeputy(p, ctx) {
      const gone = await run(T('deputies').delete().eq('id', String(p.id || '')).select('person_id,deputy_id'));
      if (gone.length) {
        const nm = async id => ((await one('people', id)) || {}).name || '';
        await log([{ action: 'deputy_off', from: `${await nm(gone[0].person_id)} → ${await nm(gone[0].deputy_id)}` }], ctx);
      }
      return methods.listDeputies();
    },

    /** Картинки к задаче (скриншоты реджекта): data:image/…, до 6 штук, каждая до ~1,5 МБ (сжимает браузер). */
    async addTaskFiles(p, ctx) {
      const t = await findTask(p.taskId);
      const files = (Array.isArray(p.files) ? p.files : []).slice(0, 6);
      if (!files.length) fail('Нет файлов');
      const me = actor(ctx);
      const rows = files.map(f => {
        const data = String((f && f.data) || '');
        if (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(data)) fail('Можно только картинки');
        if (data.length > 2000000) fail('Картинка слишком большая');
        return { id: uid('f'), task_id: t.id, tag: str(p.tag, 40), name: str(f.name, 120), data, created_by: me, created_at: now() };
      });
      await run(T('task_files').insert(rows));
      return rows.map(fileOut);
    },

    /** Картинки задачи по метке. Для задачи «Реджект №N» (запрос PM) — скриншоты из релиза, к которому она относится. */
    async getTaskFiles(p) {
      let t = await findTask(p.taskId);
      let tag = str(p.tag, 40);
      if (t.kind === 'request' && t.app_id) {
        const rels = await run(T('tasks').select('id,release').eq('app_id', t.app_id).eq('step', 'release'));
        for (const r of rels) {
          const rel = json(r.release, {}) || {};
          const hit = (rel.history || []).find(x => x.requestId === t.id) || (rel.rejectRequestId === t.id ? rel : null);
          if (hit) { t = { id: r.id }; tag = 'reject:' + (hit.rejectNo || 0); break; }
        }
      }
      let q = T('task_files').select('*').eq('task_id', t.id);
      if (tag) q = q.eq('tag', tag);
      return (await run(q.order('created_at'))).map(fileOut);
    },

    /** Опросник разработчика перед релизом: только этап iOS, все обязательные ответы; при «Нет» уточнение не хранится. */
    async saveDevForm(p) {
      const t = await findTask(p.taskId);
      if (t.step !== 'ios' && t.step !== 'integr') fail('Опросник — у этапа «Разработка iOS» или «Интеграция»');
      const df = json(t.dev_form, {}) || {};
      if ((t.step === 'ios' && df.need === false) || (t.step === 'integr' && df.need !== true)) {
        fail('Опросник в этом запросе заполняет ' + (t.step === 'ios' ? 'лид на интеграции' : 'разработчик (этап iOS)'));
      }
      const src = p.answers && typeof p.answers === 'object' ? p.answers : {};
      const answers = {};
      for (const [n, q] of (await devQuestions()).entries()) {
        const a = src[q.id] || {};
        const v = q.kind === 'yn' ? (['Да', 'Нет'].includes(a.v) ? a.v : '') : str(a.v, 1000);
        if (!v) { if (q.optional) continue; fail('Ответьте на вопрос: ' + q.q); }
        const note = q.kind === 'yn' && v === 'Да' ? str(a.note, 500) : '';
        if (q.kind === 'yn' && v === 'Да' && q.note && !note) fail(q.q + ' ' + q.note);
        // текст и номер вопроса — в ответе: вопросы потом могут поменять, а база не хранит порядок ключей
        answers[q.id] = note ? { v, note, q: q.q, n } : { v, q: q.q, n };
      }
      const form = { ...(json(t.dev_form, {}) || {}), answers, by: (await rpc('my_person_id', {})) || '', at: now() };
      await updateOne('tasks', t.id, { dev_form: form });
      return taskOut({ ...t, dev_form: form });
    },

    /** RM: принять опросник или вернуть с вопросами (ответы сбрасываются, разработчику — комментарий и уведомление). */
    async reviewDevForm(p) {
      const t = await findTask(p.taskId);
      return json(await rpc('dev_form_review', { p_task: t.id, p_ok: !!p.ok, p_note: str(p.note, 2000) }), {}) || {};
    },

    /** Вопросы опросника студии (настраивают CEO, PM и RM); пусто — набор по умолчанию. */
    async getDevQuestions() {
      return devQuestions();
    },

    async saveDevQuestions(p) {
      const list = cleanDevQuestions(p.questions);
      if (!list.length) fail('Оставьте хотя бы один вопрос');
      await run(T('app_settings').upsert({ key: 'devQuestions', value: list, updated_at: now() }, { onConflict: 'key' }));
      return list;
    },

    /** PM/CEO: кто заполняет опросник в этом запросе — разработчик (этап iOS) или лид на интеграции. */
    async setFormStep(p, ctx) {
      const r = await findTask(p.requestId);
      const step = p.step === 'integr' ? 'integr' : 'ios';
      const stages = (await run(T('tasks').select('id,step,dev_form,archived').eq('parent_id', r.id).eq('kind', 'stage'))).filter(x => !x.archived);
      if (step === 'integr' && !stages.some(x => x.step === 'integr')) fail('Сначала добавьте этап «Интеграция»');
      for (const x of stages.filter(y => y.step === 'ios' || y.step === 'integr')) {
        await updateOne('tasks', x.id, { dev_form: { ...(json(x.dev_form, {}) || {}), need: x.step === step }, updated_at: now() });
      }
      await log([{ unitId: r.unit_id, taskId: r.id, action: 'form_step', to: step === 'integr' ? 'лид на интеграции' : 'разработчик' }], ctx);
      return step;
    },


    /**
     * Дашборд RM: релизы, которые ему видны (свои и своей позиции), кроме вышедших: очередь (к отправке — чего не хватает),
     * на ревью Apple (сколько дней ждут), реджекты (причина, кто исправляет).
     */
    /**
     * История релизов (RM, CEO, PM): каждая попытка отправки в Apple — приложение, версия, когда отправили, итог и когда решили.
     * Фильтры: from / to (YYYY-MM-DD, по дате решения, без решения — по отправке), unitId, appId, result (live | reject | pending).
     * Сводка за период: вышло в стор, из них с 1-го раза (%), реджектов, отправок, среднее время ревью Apple (дней).
     */
    async getReleaseHistory(p) {
      const [rows, units, apps, files] = await Promise.all([
        all(() => T('tasks').select('id,unit_id,num,title,app_id,release,assignee_id').eq('step', 'release').order('created_at').order('id')),
        all(() => T('units').select('id,key,name,color').order('id')),
        all(() => T('apps').select('id,name,color,icon_url,unit_id').order('id')),
        all(() => T('task_files').select('id,task_id,tag').neq('tag', '').order('id')),
      ]);
      const U = Object.fromEntries(units.map(u => [u.id, u]));
      const A = Object.fromEntries(apps.map(a => [a.id, { id: a.id, name: a.name, color: a.color, iconUrl: a.icon_url || '', unitId: a.unit_id }]));
      const shots = {}; // скриншоты реджекта: «релиз|reject:N» → сколько
      for (const f of files) shots[f.task_id + '|' + f.tag] = (shots[f.task_id + '|' + f.tag] || 0) + 1;
      const day = iso => String(iso || '').slice(0, 10);
      const list = [];
      for (const t of rows) {
        if (!U[t.unit_id]) continue;
        const rel = json(t.release, {}) || {};
        let hist = Array.isArray(rel.history) ? rel.history : [];
        // старые релизы без истории — одна попытка из полей фазы
        if (!hist.length && rel.submittedAt) hist = [{ n: 1, submittedAt: rel.submittedAt, result: rel.phase === 'live' ? 'live' : rel.phase === 'rejected' ? 'reject' : '', at: rel.liveAt || rel.rejectedAt || '', reason: rel.reason || '' }];
        for (const x of hist) {
          list.push({
            taskId: t.id, unitId: t.unit_id, key: `${U[t.unit_id].key}-${t.num}`, app: A[t.app_id] || null, rmId: t.assignee_id,
            version: [(rel.values || {}).version, (rel.values || {}).build].filter(Boolean).join(' · '),
            n: x.n || 1, submittedAt: x.submittedAt || '', result: x.result || 'pending', at: x.at || '', reason: x.reason || '', rejectNo: x.rejectNo || 0, shot: x.shot || '', requestId: x.requestId || '', shots: shots[t.id + '|reject:' + (x.rejectNo || 0)] || 0, selfClosed: !!x.self,
            reviewDays: x.at && x.submittedAt ? Math.max(0, (Date.parse(x.at) - Date.parse(x.submittedAt)) / 864e5) : null,
          });
        }
      }
      const from = date(p.from), to = date(p.to);
      const inPeriod = x => { const d = day(x.at || x.submittedAt); return (!from || d >= from) && (!to || d <= to); };
      const scoped = list.filter(x => (!p.unitId || x.unitId === p.unitId) && (!p.appId || (x.app && x.app.id === p.appId)) && inPeriod(x));
      const live = scoped.filter(x => x.result === 'live');
      const decided = scoped.filter(x => x.reviewDays != null);
      const stats = {
        live: live.length, firstTry: live.filter(x => x.n === 1).length,
        firstTryPct: live.length ? Math.round(live.filter(x => x.n === 1).length / live.length * 100) : null,
        rejects: scoped.filter(x => x.result === 'reject').length,
        submitted: scoped.length, pending: scoped.filter(x => x.result === 'pending').length,
        avgReviewDays: decided.length ? Math.round(decided.reduce((s, x) => s + x.reviewDays, 0) / decided.length * 10) / 10 : null,
      };
      const out = scoped.filter(x => !p.result || x.result === p.result)
        .sort((a, b) => String(b.at || b.submittedAt).localeCompare(String(a.at || a.submittedAt)));
      return { rows: out.slice(0, 500), stats };
    },

    /**
     * Последний релиз каждого приложения (ids) — для «Отслеживаю» у RM: фаза, реджект, когда отправили / вышло,
     * чего не хватает до отправки. Нет релиза — приложения нет в ответе.
     */
    async getAppReleases(p) {
      const ids = (Array.isArray(p.ids) ? p.ids : []).map(x => String(x ?? '')).filter(Boolean).slice(0, 200);
      if (!ids.length) return {};
      const [rows, units, settings] = await Promise.all([
        run(T('tasks').select('*').eq('step', 'release').eq('archived', false).in('app_id', ids).order('created_at')),
        all(() => T('units').select('id,key').order('id')),
        methods.getReleaseSettings(),
      ]);
      const U = Object.fromEntries(units.map(u => [u.id, u]));
      const required = settings.fields.filter(f => f.required);
      const out = {};
      for (const t of rows) {
        const rel = json(t.release, {}) || {};
        const cl = json(t.checklist, []) || [];
        out[t.app_id] = {
          id: t.id, unitId: t.unit_id, key: U[t.unit_id] ? `${U[t.unit_id].key}-${t.num}` : '', assigneeId: t.assignee_id,
          phase: t.assignee_id ? rel.phase || '' : 'waiting', reason: rel.reason || '', rejectNo: rel.rejectNo || 0, pmId: rel.pmId || '',
          submittedAt: rel.submittedAt || '', rejectedAt: rel.rejectedAt || '', liveAt: rel.liveAt || '', fixedAt: rel.fixedAt || '',
          version: (rel.values || {}).version || '', missing: required.filter(f => !(rel.values || {})[f.id]).map(f => f.name),
          checklist: { done: cl.filter(i => i.done).length, total: cl.length }, attempts: (rel.history || []).length,
        };
      }
      return out;
    },

    async getRmDashboard(p) {
      const [rows, units, apps, settings] = await Promise.all([
        all(() => T('tasks').select('*').eq('step', 'release').eq('archived', false).neq('assignee_id', '').order('created_at').order('id')),
        all(() => T('units').select('id,key,settings').order('id')),
        all(() => T('apps').select('id,name,color,icon_url,unit_id,status,priority,is_test,archived,status_at').order('id')),
        methods.getReleaseSettings(),
      ]);
      const U = Object.fromEntries(units.map(u => [u.id, u]));
      const A = Object.fromEntries(apps.map(a => [a.id, { id: a.id, name: a.name, color: a.color, iconUrl: a.icon_url || '', unitId: a.unit_id, status: a.status, priority: a.priority || '', isTest: !!a.is_test }]));
      const required = settings.fields.filter(f => f.required);
      const P = await releaseParents(rows.map(t => t.parent_id));
      // у RM релиз живёт по своей фазе: статусы задач на досках (Done у PM) на это не влияют; уходит только «В сторе»
      const items = rows.filter(t => U[t.unit_id]).map(t => {
        const rel = json(t.release, {}) || {};
        const cl = json(t.checklist, []) || [];
        return {
          id: t.id, unitId: t.unit_id, key: `${U[t.unit_id].key}-${t.num}`, title: t.title, assigneeId: t.assignee_id, dueDate: t.due_date,
          app: A[t.app_id] || null, phase: rel.phase || '', reason: rel.reason || '', pmId: rel.pmId || '', rejectRequestId: rel.rejectRequestId || '',
          submittedAt: rel.submittedAt || '', rejectedAt: rel.rejectedAt || '', updatedAt: t.updated_at,
          rejectNo: rel.rejectNo || 0, shot: rel.shot || '', fixedAt: rel.fixedAt || '', attempts: (rel.history || []).length, version: (rel.values || {}).version || '',
          missing: required.filter(f => !(rel.values || {})[f.id]).map(f => f.name),
          checklist: { done: cl.filter(i => i.done).length, total: cl.length },
          what: releaseWhat(t, P[t.parent_id]),
        };
      }).filter(x => x.phase !== 'live');
      // приложения со статусом «Ревью Apple» без релиза в трекере (добавлены сразу на ревью) — тоже в «На ревью Apple»
      const reviewSt = new Set((await appStatuses()).filter(x => x.kind === 'review').map(x => x.id));
      const withRelease = new Set(items.filter(x => x.phase === 'submitted' && x.app).map(x => x.app.id));
      const appOnly = apps.filter(a => !a.archived && reviewSt.has(a.status) && !withRelease.has(a.id) && U[a.unit_id])
        .map(a => ({ id: '', appOnly: true, unitId: a.unit_id, title: a.name, app: A[a.id], submittedAt: a.status_at || '' }));
      // отправлено повторно после реджекта: в «Ревью Apple» перешли из статуса с типом «Реджект»
      const rejectIds = new Set((await appStatuses()).filter(x => x.kind === 'reject').map(x => x.id));
      if (appOnly.length) {
        const logs = await all(() => T('app_status_log').select('app_id,from_status,at').in('app_id', appOnly.map(x => x.app.id)).order('at').order('id'));
        const last = {};
        for (const l of logs) last[l.app_id] = l;
        for (const x of appOnly) x.afterReject = !!(last[x.app.id] && rejectIds.has(last[x.app.id].from_status));
      }
      // и со статусом «Реджект» без открытого реджекта релиза — на экран «Реджекты»
      const rejectSt = new Set((await appStatuses()).filter(x => x.kind === 'reject').map(x => x.id));
      // у кого есть релиз в трекере — реджект виден по релизу; «по статусу» — только приложения без релиза
      const withReject = new Set(items.filter(x => x.app).map(x => x.app.id));
      const rejectedApps = apps.filter(a => !a.archived && rejectSt.has(a.status) && !withReject.has(a.id) && U[a.unit_id])
        .map(a => ({ appOnly: true, unitId: a.unit_id, app: A[a.id], at: a.status_at || '' }));
      return {
        rejectedApps,
        queue: items.filter(x => !x.phase),
        review: [...items.filter(x => x.phase === 'submitted'), ...appOnly],
        rejected: items.filter(x => x.phase === 'rejected'),
      };
    },

    /** Приложение на ревью Apple без релиза: итог от RM — result live (вышло в стор) или reject. Возвращает новый статус. */
    async appReviewResult(p) {
      return { status: await rpc('rm_app_status', { p_app: String(p.appId || ''), p_result: String(p.result || '') }) };
    },

    /** Режим разработчика: удалить всё, что создали шорткаты (тестовые задачи и приложения). */
    async deleteTestData() {
      const r = json(await rpc('delete_test_data', {}), {}) || {};
      return { tasks: Number(r.tasks) || 0, apps: Number(r.apps) || 0, units: Number(r.units) || 0, people: Number(r.people) || 0 };
    },

    /* ---------- люди ---------- */

    /** Кто я: профиль вошедшего (привязка по email при первом входе). null — доступа нет. */
    /** «Смотреть как» (разработчик): права в базе — как у выбранного человека, только просмотр. '' — вернуться к себе. */
    async setViewAs(p) {
      return { viewAs: (await rpc('set_view_as', { p_person: str(p.personId, 40) })) || '' };
    },

    async whoami() {
      const rows = await rpc('whoami', {});
      const me = Array.isArray(rows) ? rows[0] : rows;
      return me && me.id ? personOut(me) : null;
    },

    /** Профиль без аккаунта (например, чтобы заранее назначать задачи). Аккаунт — createAccount. */
    async createPerson(p) {
      const person = {
        id: uid('p'), name: req(str(p.name, 80), 'Имя'), email: str(p.email, 120).toLowerCase(),
        role: str(p.role, 80), color: color(p.color, ''), avatar: avatarValue(p.avatar), telegram_chat_id: '', active: true, created_at: now(), is_test: !!p.test,
        access: ACCESS.includes(p.access) ? p.access : 'member', position_id: (await validDept(p.positionId)) || 'd_other',
      };
      person.extra_positions = (await cleanPositions(p.extraPositionIds)).filter(id => id !== person.position_id);
      checkRmPosition(person.access, [person.position_id, ...person.extra_positions]);
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
      checkRmPosition(ACCESS.includes(p.access) ? p.access : 'member', [str(p.positionId, 40), ...(await cleanPositions(p.extraPositionIds))]);
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
      // «я в сети» и напоминания о сроках — параллельно (напоминания нужны до подсчёта непрочитанных)
      await Promise.all([rpc('touch_presence', {}), p.today ? rpc('scan_due', { p_today: today(p.today) }) : null]);
      const other = await viewedPerson(p.personId);
      const [seen, unreadRaw, off] = await Promise.all([
        all(() => T('people').select('id,last_seen_at').order('id')),
        other ? rpc('notifications_of', { p_person: other }) : run(T('notifications').select('id,kind').eq('read_at', '').limit(100)),
        mutedKinds(),
      ]);
      const unread = (Array.isArray(unreadRaw) ? unreadRaw : unreadRaw ? [unreadRaw] : []);
      return { seen: Object.fromEntries(seen.map(r => [r.id, r.last_seen_at || ''])), unread: unread.filter(r => !off.includes(r.kind)).length };
    },

    /** Непрочитанные уведомления вошедшего — с задачей и юнитом (скрытые от него задачи пропускаются). */
    async getNotifications(p) {
      if (p.today) await rpc('scan_due', { p_today: today(p.today) });
      const prefs = await myPrefs();
      const off = await mutedKinds(prefs);
      // история: непрочитанные + прочитанные за N дней (по умолчанию 7) — прочитанные не пропадают, а приглушаются
      const since = new Date(Date.now() - historyDays(prefs) * 864e5).toISOString();
      // «смотреть как» (режим разработчика): уведомления того, за кого смотрим — только посмотреть
      const other = await viewedPerson(p.personId);
      const all_ = other ? (await rpc('notifications_of', { p_person: other, p_since: since })) || []
        : (await Promise.all([
          run(T('notifications').select('*').eq('read_at', '').order('at', { ascending: false }).limit(50)),
          run(T('notifications').select('*').neq('read_at', '').gte('at', since).order('at', { ascending: false }).limit(100)),
        ])).flat();
      const rows = (Array.isArray(all_) ? all_ : [all_]).filter(r => r && !off.includes(r.kind));
      if (!rows.length) return [];
      const tasks = await run(T('tasks').select('id,unit_id,num,title,status,due_date,archived,app_id').in('id', [...new Set(rows.map(r => r.task_id))]));
      const appIds = [...new Set(tasks.map(t => t.app_id).filter(Boolean))];
      const [units, apps] = await Promise.all([
        run(T('units').select('id,name,key,color').in('id', [...new Set(tasks.map(t => t.unit_id))])),
        appIds.length ? run(T('apps').select('id,name,color,icon_url').in('id', appIds)) : [],
      ]);
      const TT = Object.fromEntries(tasks.map(t => [t.id, t])), U = Object.fromEntries(units.map(u => [u.id, u]));
      const A = Object.fromEntries(apps.map(a => [a.id, { id: a.id, name: a.name, color: a.color || '', iconUrl: a.icon_url || '' }]));
      // одно уведомление на задачу: все непрочитанные события по ней — пометками, самое важное первым (решение заказчика)
      const RANK = ['store_reject', 'overdue', 'returned', 'review', 'mention', 'store_live', 'due_soon', 'unblocked', 'task_done', 'approved', 'assigned', 'handoff'];
      const rank = k => { const i = RANK.indexOf(k); return i < 0 ? RANK.length : i; };
      const byTask = new Map();
      for (const r of rows) {
        const t = TT[r.task_id];
        if (!t || t.archived || !U[t.unit_id]) continue;
        (byTask.get(t.id) || byTask.set(t.id, []).get(t.id)).push(r);
      }
      return [...byTask.values()].map(all => {
        // есть непрочитанные — показываем их (прочитанное по задаче уже видели); нет — запись истории, приглушённо
        const fresh = all.filter(r => !r.read_at);
        const list = fresh.length ? fresh : all;
        const top = [...list].sort((a, b) => rank(a.kind) - rank(b.kind) || String(b.at).localeCompare(String(a.at)))[0];
        const t = TT[top.task_id], u = U[t.unit_id];
        return {
          id: top.id, kind: top.kind, kinds: [...new Set(list.map(r => r.kind))].sort((a, b) => rank(a) - rank(b)), count: list.length,
          actorId: top.actor_id, at: list.map(r => r.at).sort().pop(), ref: top.ref || '', taskId: t.id, title: t.title, dueDate: t.due_date,
          key: `${u.key}-${t.num}`, unit: { id: u.id, name: u.name, color: u.color }, app: A[t.app_id] || null, read: !fresh.length,
        };
      }).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    },

    /** Отметить прочитанными: все или по одной задаче (taskId). База даёт менять только свои. */
    async readNotifications(p) {
      if (await viewedPerson(p.personId)) return 0; // «смотреть как» — только посмотреть, не отмечаем
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
        kind: p.kind === 'update' ? 'update' : '',
        steps: (Array.isArray(p.steps) ? p.steps : []).map(x => str(x, 30)).filter(Boolean).slice(0, 20),
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
      // слияние — в базе одной командой: две записи подряд (раскладка и «Отслеживаю») не затирают друг друга
      return json(await rpc('merge_prefs', { p_person: String(p.personId ?? ''), p_prefs: p.prefs || {} }), {}) || {};
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
      if ('avatar' in p) upd.avatar = avatarValue(p.avatar);
      if ('telegram' in p) upd.telegram = String(p.telegram || '').trim() ? telegramValue(p.telegram) || fail('Telegram: @username — от 5 символов, латиница, цифры и _') : '';
      if ('timezone' in p) upd.timezone = timezoneValue(p.timezone);
      if ('active' in p) upd.active = !!p.active;
      if ('access' in p) upd.access = ACCESS.includes(p.access) ? p.access : fail('Неизвестная роль');
      if ('positionId' in p) upd.position_id = (await validDept(p.positionId)) || 'd_other';
      const main = upd.position_id || person.position_id;
      if ('teamIds' in p) upd.team_ids = await cleanTeams(p.teamIds);
      if ('extraPositionIds' in p) upd.extra_positions = (await cleanPositions(p.extraPositionIds)).filter(id => id !== main);
      else if (upd.position_id) upd.extra_positions = (json(person.extra_positions, []) || []).filter(id => id !== main);
      checkRmPosition(upd.access || person.access, [main, ...(upd.extra_positions || json(person.extra_positions, []) || [])]);
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
