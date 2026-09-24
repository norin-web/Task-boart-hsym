/**
 * Бизнес-логика поверх Supabase (Postgres). Работает в браузере.
 * createBackend(client) принимает клиент supabase-js (в тестах — совместимый адаптер над PGlite).
 * Все методы асинхронные: (payload, ctx) → данные; ctx.actorId — id человека, от чьего имени действие.
 */

export const KINDS = ['todo', 'progress', 'done'];
const KIND_COUNT_KEY = { todo: 'todo', progress: 'in_progress', done: 'done' };
export const FIELD_TYPES = ['text', 'longtext', 'number', 'date', 'select', 'multiselect', 'person', 'checkbox', 'url'];
export const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6', '#64748b', '#84cc16'];

export function defaultSettings() {
  return {
    columns: [
      { id: 'todo', name: 'To Do', kind: 'todo', color: '' },
      { id: 'in_progress', name: 'In Progress', kind: 'progress', color: '' },
      { id: 'done', name: 'Done', kind: 'done', color: '' },
    ],
    builtins: {
      title:       { label: 'Название',    hideable: false, hidden: false },
      status:      { label: 'Статус',      hideable: false, hidden: false },
      assignee:    { label: 'Исполнитель', hideable: true,  hidden: false },
      department:  { label: 'Отдел',       hideable: true,  hidden: false },
      dueDate:     { label: 'Срок',        hideable: true,  hidden: false },
      description: { label: 'Описание',    hideable: true,  hidden: false },
    },
    autoArchiveDays: 0,
  };
}

function defaultFields() {
  return [{
    name: 'Приоритет', type: 'select', showOnCard: true, required: false,
    options: [
      { id: 'o_low', name: 'Low', color: '#64748b' },
      { id: 'o_medium', name: 'Medium', color: '#f59e0b' },
      { id: 'o_high', name: 'High', color: '#ef4444' },
    ],
  }];
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
      return [k, { label: str(cur.label, 40) || def.label, hideable: def.hideable, hidden: def.hideable ? !!cur.hidden : false }];
    })),
    autoArchiveDays: Math.max(0, Math.min(365, parseInt(s.autoArchiveDays, 10) || 0)),
  };
}

function storedSettings(s) {
  const full = unitSettings(s);
  return {
    columns: full.columns.map(({ id, name, kind, color: c }) => ({ id, name, kind, color: c })),
    builtins: Object.fromEntries(Object.entries(full.builtins).map(([k, v]) => [k, { label: v.label, hidden: v.hidden }])),
    autoArchiveDays: full.autoArchiveDays,
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
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const taskOut = r => ({
  id: r.id, unitId: r.unit_id, num: r.num, title: r.title, description: r.description, status: r.status,
  assigneeId: r.assignee_id, departmentId: r.department_id || '', dueDate: r.due_date, order: r.ord,
  fields: json(r.fields, {}), checklist: json(r.checklist, []), archived: !!r.archived, doneAt: r.done_at,
  createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
});

const fieldOut = r => ({
  id: r.id, unitId: r.unit_id, name: r.name, type: r.type, options: json(r.options, []),
  showOnCard: !!r.show_on_card, required: !!r.required, order: r.ord, archived: !!r.archived,
});

const personOut = r => ({ id: r.id, name: r.name, email: r.email, role: r.role || '', color: r.color || '', active: !!r.active });
const deptOut = r => ({ id: r.id, name: r.name, color: r.color, order: r.ord, archived: !!r.archived });
const commentOut = r => ({ id: r.id, taskId: r.task_id, text: r.text, authorId: r.author_id, at: r.at, editedAt: r.edited_at });

/* ================= backend ================= */

export function createBackend(db) {
  const T = name => db.from(name);

  async function run(query) {
    const { data, error } = await query;
    if (error) throw new ApiError(error.message || 'Ошибка базы данных', 'DB');
    return data;
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
  const departments = async () => (await all(() => T('departments').select('*').order('ord').order('id'))).map(deptOut);
  const unitFields = async unitId => (await all(() => T('fields').select('*').eq('unit_id', unitId).order('ord').order('id'))).map(fieldOut);
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

  /** Отдел человека в этой команде — подставляется в задачу, если отдел не выбран. */
  async function memberDept(unitId, personId) {
    if (!personId) return '';
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
    const at = now();
    await run(T('activity').insert(entries.map(e => ({
      id: uid('a'), unit_id: e.unitId || '', task_id: e.taskId || '', action: e.action, field: e.field || '',
      from_val: logVal(e.from), to_val: logVal(e.to), actor_id: by, at,
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
      id: uid('f'), unit_id: unitId, name: req(str(p.name, 60), 'Название поля'),
      type: FIELD_TYPES.includes(p.type) ? p.type : 'text', options: cleanOptions(p.options),
      show_on_card: !!p.showOnCard, required: !!p.required, ord: order, archived: false,
    };
  }

  async function insertFields(unitId, fields) {
    if (fields.length) await run(T('fields').insert(fields.map((f, i) => fieldRow(unitId, f, i + 1))));
  }

  /** Добавляет к записям журнала подписи: название поля, «было → стало», задачу и юнит. */
  async function enrichActivity(rows) {
    if (!rows.length) return [];
    const taskIds = [...new Set(rows.map(r => r.task_id).filter(Boolean))];
    const [units, peopleRows, fields, depts, tasks] = await Promise.all([
      all(() => T('units').select('id,name,key,color,settings').order('id')),
      all(() => T('people').select('id,name').order('id')),
      all(() => T('fields').select('*').order('id')),
      all(() => T('departments').select('id,name').order('id')),
      taskIds.length ? run(T('tasks').select('id,unit_id,num,title').in('id', taskIds)) : [],
    ]);
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
        default:
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
        task: t ? { id: t.id, title: t.title, key: `${U[t.unit_id] ? U[t.unit_id].key : '?'}-${t.num}` } : null,
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
      const [units, ppl, depts] = await Promise.all([unitsWithCounts(today(p.today)), people(), departments()]);
      return { units: units.map(({ doneWeek, ...u }) => u), people: ppl, departments: depts };
    },

    async getHome(p) {
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
      return { units: units.map(({ doneWeek, ...u }) => u), people: ppl, departments: depts, stats, activity: await enrichActivity(log) };
    },

    /** Задачи из всех активных юнитов: поиск (q) или «мои задачи» (assigneeId). */
    async queryTasks(p) {
      const q = str(p.q, 100).toLowerCase();
      const units = Object.fromEntries((await all(() => T('units').select('*').eq('archived', false).order('id'))).map(u => [u.id, u]));
      let rows = await all(() => {
        let b = T('tasks').select('*').eq('archived', false);
        if (p.assigneeId) b = b.eq('assignee_id', String(p.assigneeId));
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
      const [fields, tasks, counts, units, ppl, depts, members] = await Promise.all([
        unitFields(unit.id),
        all(() => T('tasks').select('*').eq('unit_id', unit.id).order('id')),
        rpc('comment_counts', { p_unit: unit.id }),
        all(() => T('units').select('id,name,key,color,archived').order('ord').order('id')),
        people(), departments(), unitMembers(unit.id),
      ]);
      const cc = Object.fromEntries((counts || []).map(c => [c.task_id, Number(c.n)]));
      return {
        unit: unitOut(unit),
        fields,
        tasks: tasks.map(t => ({ ...taskOut(t), commentCount: cc[t.id] || 0 })),
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
        fields = (await unitFields(src.id)).filter(f => !f.archived);
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
      if ('archived' in p) upd.archived = !!p.archived;
      upd.updated_at = now();
      await run(T('units').update(upd).eq('id', u.id));
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
      await insertFields(unit.id, (await unitFields(src.id)).filter(f => !f.archived));
      return { ...unitOut(unit), counts: emptyCounts(), members: [] };
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
        id: uid('t'), unit_id: unit.id, num: await rpc('next_task_num', { p_unit: unit.id }),
        title: req(str(p.title, 500), 'Название задачи'), description: str(p.description, 20000), status,
        assignee_id: assignee, department_id: (await validDept(p.departmentId)) || (await memberDept(unit.id, assignee)),
        due_date: date(p.dueDate), ord: (await maxOrd('tasks', { unit_id: unit.id, status })) + 1,
        fields: cleanFieldValues(p.fields, false), checklist: cleanChecklist(p.checklist),
        archived: false, done_at: kindOf(st, status) === 'done' ? ts : '', created_by: actor(ctx), created_at: ts, updated_at: ts,
      };
      await run(T('tasks').insert(task));
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
        if (v !== t.description) { change('description', null, null); t.description = v; }
      }
      if ('status' in patch) {
        const st = unitSettings((await findUnit(t.unit_id)).settings);
        if (!st.columns.some(c => c.id === patch.status)) fail('Такой колонки нет');
        if (patch.status !== t.status) {
          change('status', t.status, patch.status);
          const wasDone = kindOf(st, t.status) === 'done', nowDone = kindOf(st, patch.status) === 'done';
          if (nowDone && !wasDone) t.done_at = now();
          if (!nowDone) t.done_at = '';
          t.status = patch.status;
        }
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
          const d = !t.department_id && !('departmentId' in patch) && (await memberDept(t.unit_id, v));
          if (d) { change('departmentId', '', d); t.department_id = d; }
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
          const progress = l => `${l.filter(i => i.done).length}/${l.length}`;
          if (progress(before) !== progress(after)) change('checklist', progress(before), progress(after));
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
          title: t.title, description: t.description, status: t.status, assignee_id: t.assignee_id, department_id: t.department_id,
          due_date: t.due_date, ord: t.ord, fields: t.fields, checklist: t.checklist, archived: t.archived,
          done_at: t.done_at, updated_at: t.updated_at,
        }).eq('id', t.id).eq('updated_at', r.updated_at).select('id'));
        if (!saved.length) fail('Задачу уже изменил кто-то другой', 'CONFLICT', taskOut(await findTask(t.id)));
        await log(logs, ctx);
      }
      return taskOut(t);
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
      const ts = now();
      const task = {
        ...src, id: uid('t'), num: await rpc('next_task_num', { p_unit: src.unit_id }), title: str(src.title + ' (копия)', 500),
        ord: (await maxOrd('tasks', { unit_id: src.unit_id, status: src.status })) + 1,
        archived: false, done_at: src.done_at ? ts : '', created_by: actor(ctx), created_at: ts, updated_at: ts,
      };
      await run(T('tasks').insert(task));
      await log([{ unitId: task.unit_id, taskId: task.id, action: 'create', to: task.title }], ctx);
      return { ...taskOut(task), commentCount: 0 };
    },

    async deleteTask(p, ctx) {
      const t = await findTask(p.id);
      await run(T('tasks').delete().eq('id', t.id));
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

    async updateComment(p) {
      const c = (await one('comments', p.id)) || fail('Комментарий не найден', 'NOT_FOUND');
      const upd = { text: req(str(p.text, 5000), 'Комментарий'), edited_at: now() };
      await run(T('comments').update(upd).eq('id', c.id));
      return commentOut({ ...c, ...upd });
    },

    async deleteComment(p) {
      await run(T('comments').delete().eq('id', String(p.id ?? '')));
      return true;
    },

    /* ---------- поля карточки ---------- */

    async createField(p) {
      const unit = await findUnit(p.unitId);
      const f = fieldRow(unit.id, p, (await maxOrd('fields', { unit_id: unit.id })) + 1);
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
      if ('archived' in p) upd.archived = !!p.archived;
      if (Object.keys(upd).length) await run(T('fields').update(upd).eq('id', f.id));
      return fieldOut({ ...f, ...upd });
    },

    async reorderFields(p) {
      await Promise.all((p.ids || []).map((id, i) => run(T('fields').update({ ord: i + 1 }).eq('id', String(id)).eq('unit_id', String(p.unitId)))));
      return true;
    },

    /** Удаление навсегда: поле и его значения во всех задачах юнита. */
    async deleteField(p) {
      const f = (await one('fields', p.id)) || fail('Поле не найдено', 'NOT_FOUND');
      await rpc('delete_field', { p_field: f.id });
      return true;
    },

    /* ---------- отделы (общий справочник) ---------- */

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
      if (Object.keys(upd).length) await run(T('departments').update(upd).eq('id', d.id));
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

    /* ---------- люди ---------- */

    async createPerson(p) {
      const person = {
        id: uid('p'), name: req(str(p.name, 80), 'Имя'), email: str(p.email, 120).toLowerCase(),
        role: str(p.role, 80), color: color(p.color, ''), telegram_chat_id: '', active: true, created_at: now(),
      };
      await run(T('people').insert(person));
      return personOut(person);
    },

    async updatePerson(p) {
      const person = (await one('people', p.id)) || fail('Человек не найден', 'NOT_FOUND');
      const upd = {};
      if ('name' in p) upd.name = req(str(p.name, 80), 'Имя');
      if ('email' in p) upd.email = str(p.email, 120).toLowerCase();
      if ('role' in p) upd.role = str(p.role, 80);
      if ('color' in p) upd.color = color(p.color, '');
      if ('active' in p) upd.active = !!p.active;
      if (Object.keys(upd).length) await run(T('people').update(upd).eq('id', person.id));
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
