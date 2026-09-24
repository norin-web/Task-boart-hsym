import { randomUUID } from 'node:crypto';

/**
 * Бизнес-логика. Каждый метод — синхронная функция (payload, ctx) → данные.
 * ctx.actorId — id человека из справочника, от чьего имени действие (пока без авторизации).
 * Записи идут в транзакциях; node:sqlite синхронный, поэтому вызовы не пересекаются.
 */

/** Тип колонки определяет смысл статуса: «готово» — для просрочек, прогресса и автоархива. */
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

/* ---------- утилиты ---------- */

let lastTs = 0;
/** Монотонное время: две записи подряд никогда не получат одинаковый updatedAt. */
function now() {
  let t = Date.now();
  if (t <= lastTs) t = lastTs + 1;
  lastTs = t;
  return new Date(t).toISOString();
}

const uid = prefix => prefix + '_' + randomUUID().replace(/-/g, '').slice(0, 12);
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const color = (c, fallback) => (/^#[0-9a-fA-F]{6}$/.test(c || '') ? c : fallback);
const date = v => { const s = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; };
const today = d => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : new Date().toISOString().slice(0, 10));
const req = (v, label) => v || fail(`Поле «${label}» обязательно`);
const parse = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };
const fmtDate = d => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? `${m[3]}.${m[2]}.${m[1]}` : ''; };
const emptyCounts = () => ({ todo: 0, in_progress: 0, done: 0, overdue: 0 });
const b = v => (v ? 1 : 0);

/** Колонка задачи; неизвестный статус (колонку удалили) считается первой колонкой. */
const columnOf = (settings, status) => settings.columns.find(c => c.id === status) || settings.columns[0];
const kindOf = (settings, status) => columnOf(settings, status).kind;

function normKey(k) {
  k = String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  return /^[A-Z][A-Z0-9]{1,9}$/.test(k) ? k : '';
}

export function unitSettings(raw) {
  const s = (typeof raw === 'string' ? parse(raw, {}) : raw) || {};
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
  return JSON.stringify({
    columns: full.columns.map(({ id, name, kind, color: c }) => ({ id, name, kind, color: c })),
    builtins: Object.fromEntries(Object.entries(full.builtins).map(([k, v]) => [k, { label: v.label, hidden: v.hidden }])),
    autoArchiveDays: full.autoArchiveDays,
  });
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

/* ---------- API ---------- */

export function createApi(db) {
  const cache = new Map();
  const stmt = sql => { let s = cache.get(sql); if (!s) { s = db.prepare(sql); cache.set(sql, s); } return s; };
  // node:sqlite не принимает undefined — пропущенные параметры становятся NULL
  const args = p => p.map(v => (v === undefined ? null : v));
  const all = (sql, ...p) => stmt(sql).all(...args(p));
  const get = (sql, ...p) => stmt(sql).get(...args(p));
  const run = (sql, ...p) => stmt(sql).run(...args(p));

  let depth = 0;
  function tx(fn) {
    if (depth > 0) return fn();
    db.exec('BEGIN IMMEDIATE');
    depth++;
    try {
      const r = fn();
      db.exec('COMMIT');
      return r;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      depth--;
    }
  }

  function insert(table, obj) {
    const cols = Object.keys(obj);
    run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...cols.map(c => obj[c]));
  }

  function update(table, id, obj) {
    const cols = Object.keys(obj);
    if (!cols.length) return;
    run(`UPDATE ${table} SET ${cols.map(c => c + ' = ?').join(', ')} WHERE id = ?`, ...cols.map(c => obj[c]), id);
  }

  /* ----- преобразование строк БД ----- */

  const unitOut = r => ({
    id: r.id, name: r.name, key: r.key, color: r.color, description: r.description,
    settings: unitSettings(r.settings), nextNum: r.next_num, order: r.ord, archived: !!r.archived,
    createdAt: r.created_at, updatedAt: r.updated_at,
  });

  const taskOut = r => ({
    id: r.id, unitId: r.unit_id, num: r.num, title: r.title, description: r.description, status: r.status,
    assigneeId: r.assignee_id, departmentId: r.department_id || '', dueDate: r.due_date, order: r.ord, fields: parse(r.fields, {}),
    checklist: parse(r.checklist, []), archived: !!r.archived, doneAt: r.done_at, createdBy: r.created_by,
    createdAt: r.created_at, updatedAt: r.updated_at,
    ...(r.comment_count !== undefined ? { commentCount: r.comment_count } : {}),
  });

  const fieldOut = r => ({
    id: r.id, unitId: r.unit_id, name: r.name, type: r.type, options: parse(r.options, []),
    showOnCard: !!r.show_on_card, required: !!r.required, order: r.ord, archived: !!r.archived,
  });

  const personOut = r => ({ id: r.id, name: r.name, email: r.email, role: r.role || '', color: r.color || '', active: !!r.active });
  const deptOut = r => ({ id: r.id, name: r.name, color: r.color, order: r.ord, archived: !!r.archived });
  const commentOut = r => ({ id: r.id, taskId: r.task_id, text: r.text, authorId: r.author_id, at: r.at, editedAt: r.edited_at });

  /* ----- выборки ----- */

  const findUnit = id => get('SELECT * FROM units WHERE id = ?', id) || fail('Юнит не найден', 'NOT_FOUND');
  const findTask = id => get('SELECT * FROM tasks WHERE id = ?', id) || fail('Задача не найдена', 'NOT_FOUND');
  const people = () => all('SELECT * FROM people ORDER BY name COLLATE NOCASE').map(personOut);
  const departments = () => all('SELECT * FROM departments ORDER BY ord').map(deptOut);
  const unitMembers = unitId => all('SELECT person_id, department_id FROM unit_members WHERE unit_id = ? ORDER BY created_at', unitId)
    .map(m => ({ personId: m.person_id, departmentId: m.department_id }));
  const validDept = id => (id && get('SELECT 1 FROM departments WHERE id = ?', String(id)) ? String(id) : '');
  /** Отдел человека в этой команде — подставляется в задачу, если отдел не выбран. */
  const memberDept = (unitId, personId) => {
    const m = personId && get('SELECT department_id FROM unit_members WHERE unit_id = ? AND person_id = ?', unitId, personId);
    return m ? m.department_id : '';
  };
  const unitFields = unitId => all('SELECT * FROM fields WHERE unit_id = ? ORDER BY ord', unitId).map(fieldOut);
  const keyTaken = (key, exceptId = '') => !!get('SELECT 1 FROM units WHERE key = ? AND id != ?', key, exceptId);
  const maxOrd = (sql, ...p) => get(`SELECT COALESCE(MAX(ord), 0) AS m FROM ${sql}`, ...p).m;

  function uniqueKey(base) {
    base = normKey(base) || 'U';
    if (!keyTaken(base)) return base;
    for (let i = 2; i < 1000; i++) {
      const k = base.slice(0, 10 - String(i).length) + i;
      if (!keyTaken(k)) return k;
    }
    return 'U' + Date.now().toString(36).toUpperCase().slice(-8);
  }

  function nextNum(unitId) {
    const u = findUnit(unitId);
    run('UPDATE units SET next_num = ? WHERE id = ?', u.next_num + 1, unitId);
    return u.next_num;
  }

  /** Счётчики по типам колонок (todo / in_progress / done / overdue) для каждого юнита. */
  function countTasks(day, weekAgo) {
    const settings = {};
    for (const u of all('SELECT id, settings FROM units')) settings[u.id] = unitSettings(u.settings);
    const counts = {};
    let doneWeek = 0;
    for (const t of all('SELECT unit_id, status, due_date, done_at FROM tasks WHERE archived = 0')) {
      const st = settings[t.unit_id];
      if (!st) continue;
      const kind = kindOf(st, t.status);
      const c = counts[t.unit_id] || (counts[t.unit_id] = emptyCounts());
      c[KIND_COUNT_KEY[kind]]++;
      if (kind !== 'done' && t.due_date && t.due_date < day) c.overdue++;
      if (kind === 'done' && weekAgo && t.done_at >= weekAgo) c.doneWeek = (c.doneWeek || 0) + 1;
    }
    return counts;
  }

  function unitsWithCounts(day) {
    const counts = countTasks(day);
    const members = {};
    for (const m of all('SELECT unit_id, person_id FROM unit_members ORDER BY created_at')) (members[m.unit_id] = members[m.unit_id] || []).push(m.person_id);
    return all('SELECT * FROM units ORDER BY ord').map(r => ({ ...unitOut(r), counts: counts[r.id] || emptyCounts(), members: members[r.id] || [] }));
  }

  function insertFields(unitId, fields) {
    fields.forEach((f, i) => insert('fields', fieldRow(unitId, f, i + 1)));
  }

  function fieldRow(unitId, p, order) {
    return {
      id: uid('f'), unit_id: unitId, name: req(str(p.name, 60), 'Название поля'),
      type: FIELD_TYPES.includes(p.type) ? p.type : 'text', options: JSON.stringify(cleanOptions(p.options)),
      show_on_card: b(p.showOnCard), required: b(p.required), ord: order, archived: 0,
    };
  }

  function actor(ctx) {
    const id = ctx && ctx.actorId;
    return id && get('SELECT 1 FROM people WHERE id = ?', id) ? id : '';
  }

  const logVal = v => {
    if (v === undefined || v === null) return '';
    const s = JSON.stringify(v);
    return s.length > 1000 ? JSON.stringify(String(v).slice(0, 300) + '…') : s;
  };

  function log(entries, ctx) {
    const by = actor(ctx);
    const at = now();
    for (const e of entries) {
      insert('activity', {
        id: uid('a'), unit_id: e.unitId || '', task_id: e.taskId || '', action: e.action, field: e.field || '',
        from_val: logVal(e.from), to_val: logVal(e.to), actor_id: by, at,
      });
    }
  }

  /** Добавляет к записям журнала подписи: название поля, «было → стало», задачу и юнит. */
  function enrichActivity(rows) {
    if (!rows.length) return [];
    const index = list => Object.fromEntries(list.map(r => [r.id, r]));
    const units = index(all('SELECT * FROM units'));
    const peopleIdx = index(all('SELECT id, name FROM people'));
    const fields = index(all('SELECT * FROM fields'));
    const depts = index(all('SELECT id, name FROM departments'));
    const taskIds = [...new Set(rows.map(r => r.task_id).filter(Boolean))];
    const tasks = index(taskIds.length ? all(`SELECT id, unit_id, num, title FROM tasks WHERE id IN (${taskIds.map(() => '?').join(',')})`, ...taskIds) : []);
    const personName = id => (id && peopleIdx[id] ? peopleIdx[id].name : '');

    return rows.map(a => {
      const t = tasks[a.task_id];
      const u = units[t ? t.unit_id : a.unit_id];
      const st = unitSettings(u && u.settings);
      const B = st.builtins;
      const from = a.from_val === '' ? null : parse(a.from_val, a.from_val);
      const to = a.to_val === '' ? null : parse(a.to_val, a.to_val);
      const col = id => (st.columns.find(c => c.id === id) || { name: id }).name;

      let label = '', fromText = from, toText = to;
      switch (a.field) {
        case 'title': label = B.title.label; break;
        case 'description': label = B.description.label; break;
        case 'status': label = B.status.label; fromText = col(from); toText = col(to); break;
        case 'assigneeId': label = B.assignee.label; fromText = personName(from); toText = personName(to); break;
        case 'departmentId': label = B.department.label; fromText = from && depts[from] ? depts[from].name : ''; toText = to && depts[to] ? depts[to].name : ''; break;
        case 'dueDate': label = B.dueDate.label; fromText = fmtDate(from); toText = fmtDate(to); break;
        case 'checklist': label = 'Чеклист'; break;
        case 'unit': label = 'Юнит'; break;
        default:
          if (/^f_/.test(a.field)) {
            const f = fields[a.field] ? fieldOut(fields[a.field]) : null;
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
        task: t ? { id: t.id, title: t.title, key: `${units[t.unit_id] ? units[t.unit_id].key : '?'}-${t.num}` } : null,
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
  function remapStatuses(unitId, before, after, remap) {
    const ids = new Set(after.columns.map(c => c.id));
    for (const t of all('SELECT id, status, done_at FROM tasks WHERE unit_id = ?', unitId)) {
      const status = ids.has(t.status) ? t.status : ids.has(remap[t.status]) ? remap[t.status] : after.columns[0].id;
      const wasDone = kindOf(before, t.status) === 'done', nowDone = kindOf(after, status) === 'done';
      const doneAt = nowDone ? (wasDone && t.done_at ? t.done_at : now()) : '';
      if (status !== t.status || doneAt !== t.done_at) run('UPDATE tasks SET status = ?, done_at = ? WHERE id = ?', status, doneAt, t.id);
    }
  }

  function autoArchive(unitId) {
    const u = get('SELECT settings FROM units WHERE id = ?', unitId);
    const days = u ? unitSettings(u.settings).autoArchiveDays : 0;
    if (!days) return;
    const cutoff = new Date(Date.now() - days * 864e5).toISOString();
    const doneIds = unitSettings(u.settings).columns.filter(c => c.kind === 'done').map(c => c.id);
    if (!doneIds.length) return;
    run(`UPDATE tasks SET archived = 1 WHERE unit_id = ? AND status IN (${doneIds.map(() => '?').join(',')}) AND archived = 0 AND done_at != '' AND done_at < ?`, unitId, ...doneIds, cutoff);
  }

  const methods = {

    /* ---------- общие данные, главная, поиск ---------- */

    bootstrap(p) {
      return { units: unitsWithCounts(today(p.today)), people: people(), departments: departments() };
    },

    getHome(p) {
      const day = today(p.today);
      const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
      const counts = countTasks(day, weekAgo);
      const units = unitsWithCounts(day);
      const s = { todo: 0, in_progress: 0, overdue: 0, done_week: 0 };
      for (const u of units) {
        if (u.archived || !counts[u.id]) continue;
        const c = counts[u.id];
        s.todo += c.todo; s.in_progress += c.in_progress; s.overdue += c.overdue; s.done_week += c.doneWeek || 0;
      }
      return {
        units,
        people: people(),
        departments: departments(),
        stats: { todo: s.todo || 0, in_progress: s.in_progress || 0, overdue: s.overdue || 0, doneWeek: s.done_week || 0 },
        activity: enrichActivity(all('SELECT * FROM activity ORDER BY at DESC LIMIT 30')),
      };
    },

    /** Задачи из всех активных юнитов: поиск (q) или «мои задачи» (assigneeId). */
    queryTasks(p) {
      const q = str(p.q, 100).toLowerCase();
      const params = [];
      let where = 't.archived = 0 AND u.archived = 0';
      if (p.assigneeId) { where += ' AND t.assignee_id = ?'; params.push(String(p.assigneeId)); }
      let rows = all(`
        SELECT t.*, u.key AS u_key, u.name AS u_name, u.color AS u_color, u.settings AS u_settings
        FROM tasks t JOIN units u ON u.id = t.unit_id WHERE ${where} ORDER BY t.updated_at DESC`, ...params);
      // SQLite lower() не знает кириллицу — фильтруем в JS
      if (q) rows = rows.filter(r => `${r.u_key}-${r.num} ${r.title} ${r.description}`.toLowerCase().includes(q));
      return rows.slice(0, Math.min(Number(p.limit) || 50, 500)).map(r => {
        const col = columnOf(unitSettings(r.u_settings), r.status);
        return {
          ...taskOut(r), key: `${r.u_key}-${r.num}`, statusName: col.name, statusKind: col.kind, statusColor: col.color,
          unit: { id: r.unit_id, name: r.u_name, key: r.u_key, color: r.u_color },
        };
      });
    },

    getBoard(p) {
      const unit = findUnit(p.unitId);
      autoArchive(unit.id);
      return {
        unit: unitOut(unit),
        fields: unitFields(unit.id),
        tasks: all(`
          SELECT t.*, (SELECT COUNT(*) FROM comments c WHERE c.task_id = t.id) AS comment_count
          FROM tasks t WHERE t.unit_id = ?`, unit.id).map(taskOut),
        units: all('SELECT id, name, key, color, archived FROM units ORDER BY ord').map(u => ({ ...u, archived: !!u.archived })),
        people: people(),
        departments: departments(),
        members: unitMembers(unit.id),
      };
    },

    /* ---------- юниты ---------- */

    createUnit(p) {
      return tx(() => {
        const name = req(str(p.name, 80), 'Название');
        let key = normKey(p.key);
        if (key && keyTaken(key)) fail(`Ключ ${key} уже занят`);
        if (!key) key = uniqueKey('U');
        const count = get('SELECT COUNT(*) AS n FROM units').n;

        let settings = storedSettings(defaultSettings());
        let fields = defaultFields();
        const src = p.copyFieldsFrom && get('SELECT * FROM units WHERE id = ?', p.copyFieldsFrom);
        if (src) {
          settings = src.settings;
          fields = unitFields(src.id).filter(f => !f.archived);
        }
        const ts = now();
        const unit = {
          id: uid('u'), name, key, color: color(p.color, PALETTE[count % PALETTE.length]),
          description: str(p.description, 1000), settings, next_num: 1,
          ord: maxOrd('units') + 1, archived: 0, created_at: ts, updated_at: ts,
        };
        insert('units', unit);
        insertFields(unit.id, fields);
        return { ...unitOut(unit), counts: emptyCounts(), members: [] };
      });
    },

    updateUnit(p) {
      return tx(() => {
        const u = findUnit(p.id);
        const upd = {};
        if ('name' in p) upd.name = req(str(p.name, 80), 'Название');
        if ('key' in p) {
          const key = normKey(p.key) || fail('Ключ: 2–10 латинских букв или цифр, начиная с буквы');
          if (keyTaken(key, u.id)) fail(`Ключ ${key} уже занят`);
          upd.key = key;
        }
        if ('color' in p) upd.color = color(p.color, u.color);
        if ('description' in p) upd.description = str(p.description, 1000);
        if ('settings' in p) {
          upd.settings = storedSettings(p.settings);
          remapStatuses(u.id, unitSettings(u.settings), unitSettings(upd.settings), p.statusRemap || {});
        }
        if ('archived' in p) upd.archived = b(p.archived);
        upd.updated_at = now();
        update('units', u.id, upd);
        return unitOut(findUnit(u.id));
      });
    },

    reorderUnits(p) {
      return tx(() => {
        (p.ids || []).forEach((id, i) => run('UPDATE units SET ord = ? WHERE id = ?', i + 1, String(id)));
        return true;
      });
    },

    duplicateUnit(p) {
      return tx(() => {
        const src = findUnit(p.id);
        const ts = now();
        const unit = {
          id: uid('u'), name: str(src.name + ' (копия)', 80), key: uniqueKey(src.key), color: src.color,
          description: src.description, settings: src.settings, next_num: 1,
          ord: maxOrd('units') + 1, archived: 0, created_at: ts, updated_at: ts,
        };
        insert('units', unit);
        insertFields(unit.id, unitFields(src.id).filter(f => !f.archived));
        return { ...unitOut(unit), counts: emptyCounts(), members: [] };
      });
    },

    /** Удаляет юнит; задачи, поля и комментарии уходят каскадом. */
    deleteUnit(p) {
      return tx(() => {
        const u = findUnit(p.id);
        run(`DELETE FROM activity WHERE task_id IN (SELECT id FROM tasks WHERE unit_id = ?)
             OR (unit_id = ? AND task_id NOT IN (SELECT id FROM tasks))`, u.id, u.id);
        run('DELETE FROM units WHERE id = ?', u.id);
        return true;
      });
    },

    /* ---------- задачи ---------- */

    createTask(p, ctx) {
      return tx(() => {
        const unit = findUnit(p.unitId);
        const st = unitSettings(unit.settings);
        const status = st.columns.some(c => c.id === p.status) ? p.status : st.columns[0].id;
        const ts = now();
        const task = {
          id: uid('t'), unit_id: unit.id, num: nextNum(unit.id),
          title: req(str(p.title, 500), 'Название задачи'), description: str(p.description, 20000), status,
          assignee_id: str(p.assigneeId, 40), due_date: date(p.dueDate),
          department_id: validDept(p.departmentId) || memberDept(unit.id, str(p.assigneeId, 40)),
          ord: maxOrd('tasks WHERE unit_id = ? AND status = ?', unit.id, status) + 1,
          fields: JSON.stringify(cleanFieldValues(p.fields, false)), checklist: JSON.stringify(cleanChecklist(p.checklist)),
          archived: 0, done_at: kindOf(st, status) === 'done' ? ts : '', created_by: actor(ctx), created_at: ts, updated_at: ts,
        };
        insert('tasks', task);
        log([{ unitId: unit.id, taskId: task.id, action: 'create', to: task.title }], ctx);
        return { ...taskOut(task), commentCount: 0 };
      });
    },

    /**
     * patch: { title, description, status, assigneeId, dueDate, order, archived, checklist, fields: { f_id: value|null } }
     * expectedUpdatedAt — защита от перезаписи чужих изменений (код ошибки CONFLICT).
     */
    updateTask(p, ctx) {
      return tx(() => {
        const r = findTask(p.id);
        if (p.expectedUpdatedAt && r.updated_at !== p.expectedUpdatedAt) {
          fail('Задачу уже изменил кто-то другой', 'CONFLICT', taskOut(r));
        }
        const patch = p.patch || {};
        const t = { ...r };
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
          const st = unitSettings(findUnit(t.unit_id).settings);
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
          const v = validDept(patch.departmentId);
          if (v !== t.department_id) { change('departmentId', t.department_id, v); t.department_id = v; }
        }
        if ('assigneeId' in patch) {
          const v = str(patch.assigneeId, 40);
          if (v !== t.assignee_id) {
            change('assigneeId', t.assignee_id, v);
            t.assignee_id = v;
            const d = !t.department_id && !('departmentId' in patch) && memberDept(t.unit_id, v);
            if (d) { change('departmentId', '', d); t.department_id = d; }
          }
        }
        if ('dueDate' in patch) {
          const v = date(patch.dueDate);
          if (v !== t.due_date) { change('dueDate', t.due_date, v); t.due_date = v; }
        }
        if ('checklist' in patch) {
          const before = cleanChecklist(parse(t.checklist, []));
          const after = cleanChecklist(patch.checklist);
          if (JSON.stringify(before) !== JSON.stringify(after)) {
            const progress = l => `${l.filter(i => i.done).length}/${l.length}`;
            if (progress(before) !== progress(after)) change('checklist', progress(before), progress(after));
            t.checklist = JSON.stringify(after);
            dirty = true;
          }
        }
        if ('archived' in patch) {
          const v = b(patch.archived);
          if (v !== t.archived) {
            logs.push({ unitId: t.unit_id, taskId: t.id, action: v ? 'archive' : 'unarchive' });
            t.archived = v;
          }
        }
        if (patch.fields) {
          const cur = parse(t.fields, {});
          for (const [k, after] of Object.entries(cleanFieldValues(patch.fields, true))) {
            const before = cur[k] ?? null;
            if (JSON.stringify(before) === JSON.stringify(after)) continue;
            change(k, before, after);
            if (after === null) delete cur[k]; else cur[k] = after;
          }
          t.fields = JSON.stringify(cur);
        }
        if ('order' in patch && Number.isFinite(Number(patch.order)) && Number(patch.order) !== t.ord) {
          t.ord = Number(patch.order);
          dirty = true;
        }

        if (logs.length || dirty) {
          t.updated_at = now();
          update('tasks', t.id, {
            title: t.title, description: t.description, status: t.status, assignee_id: t.assignee_id, department_id: t.department_id,
            due_date: t.due_date, ord: t.ord, fields: t.fields, checklist: t.checklist, archived: t.archived,
            done_at: t.done_at, updated_at: t.updated_at,
          });
          log(logs, ctx);
        }
        return { ...taskOut(t), commentCount: get('SELECT COUNT(*) AS n FROM comments WHERE task_id = ?', t.id).n };
      });
    },

    /** Перенос в другой юнит: новый номер, конец той же колонки. Значения полей сохраняются. */
    moveTask(p, ctx) {
      return tx(() => {
        const t = findTask(p.id);
        if (t.unit_id === p.unitId) return taskOut(t);
        const from = findUnit(t.unit_id);
        const to = findUnit(p.unitId);
        const num = nextNum(to.id);
        // В другом юните может не быть такой колонки — берём первую колонку того же типа
        const fromSt = unitSettings(from.settings), toSt = unitSettings(to.settings);
        const kind = kindOf(fromSt, t.status);
        const status = toSt.columns.some(c => c.id === t.status) ? t.status : (toSt.columns.find(c => c.kind === kind) || toSt.columns[0]).id;
        const upd = {
          unit_id: to.id, num, status, ord: maxOrd('tasks WHERE unit_id = ? AND status = ?', to.id, status) + 1, updated_at: now(),
        };
        update('tasks', t.id, upd);
        log([{ unitId: to.id, taskId: t.id, action: 'move', field: 'unit', from: `${from.key}-${t.num}`, to: `${to.key}-${num}` }], ctx);
        return taskOut(findTask(t.id));
      });
    },

    duplicateTask(p, ctx) {
      return tx(() => {
        const src = findTask(p.id);
        const ts = now();
        const task = {
          ...src, id: uid('t'), num: nextNum(src.unit_id), title: str(src.title + ' (копия)', 500),
          ord: maxOrd('tasks WHERE unit_id = ? AND status = ?', src.unit_id, src.status) + 1,
          archived: 0, done_at: src.done_at ? ts : '', created_by: actor(ctx), created_at: ts, updated_at: ts,
        };
        insert('tasks', task);
        log([{ unitId: task.unit_id, taskId: task.id, action: 'create', to: task.title }], ctx);
        return { ...taskOut(task), commentCount: 0 };
      });
    },

    deleteTask(p, ctx) {
      return tx(() => {
        const t = findTask(p.id);
        run('DELETE FROM tasks WHERE id = ?', t.id);
        log([{ unitId: t.unit_id, taskId: t.id, action: 'delete', from: t.title }], ctx);
        return true;
      });
    },

    /** Комментарии и история — грузятся при открытии карточки. */
    getTaskExtras(p) {
      return {
        comments: all('SELECT * FROM comments WHERE task_id = ? ORDER BY at', String(p.taskId)).map(commentOut),
        activity: enrichActivity(all('SELECT * FROM activity WHERE task_id = ? ORDER BY at DESC LIMIT 200', String(p.taskId))),
      };
    },

    /* ---------- комментарии ---------- */

    addComment(p, ctx) {
      return tx(() => {
        const t = findTask(p.taskId);
        const c = { id: uid('c'), task_id: t.id, text: req(str(p.text, 5000), 'Комментарий'), author_id: actor(ctx), at: now(), edited_at: '' };
        insert('comments', c);
        log([{ unitId: t.unit_id, taskId: t.id, action: 'comment', to: c.text.slice(0, 200) }], ctx);
        return commentOut(c);
      });
    },

    updateComment(p) {
      return tx(() => {
        const c = get('SELECT * FROM comments WHERE id = ?', p.id) || fail('Комментарий не найден', 'NOT_FOUND');
        const upd = { text: req(str(p.text, 5000), 'Комментарий'), edited_at: now() };
        update('comments', c.id, upd);
        return commentOut({ ...c, ...upd });
      });
    },

    deleteComment(p) {
      return tx(() => {
        run('DELETE FROM comments WHERE id = ?', String(p.id));
        return true;
      });
    },

    /* ---------- поля карточки ---------- */

    createField(p) {
      return tx(() => {
        const unit = findUnit(p.unitId);
        const f = fieldRow(unit.id, p, maxOrd('fields WHERE unit_id = ?', unit.id) + 1);
        insert('fields', f);
        return fieldOut(f);
      });
    },

    updateField(p) {
      return tx(() => {
        const f = get('SELECT * FROM fields WHERE id = ?', p.id) || fail('Поле не найдено', 'NOT_FOUND');
        const upd = {};
        if ('name' in p) upd.name = req(str(p.name, 60), 'Название поля');
        if ('type' in p) upd.type = FIELD_TYPES.includes(p.type) ? p.type : 'text';
        if ('options' in p) upd.options = JSON.stringify(cleanOptions(p.options));
        if ('showOnCard' in p) upd.show_on_card = b(p.showOnCard);
        if ('required' in p) upd.required = b(p.required);
        if ('archived' in p) upd.archived = b(p.archived);
        update('fields', f.id, upd);
        return fieldOut({ ...f, ...upd });
      });
    },

    reorderFields(p) {
      return tx(() => {
        (p.ids || []).forEach((id, i) => run('UPDATE fields SET ord = ? WHERE id = ? AND unit_id = ?', i + 1, String(id), String(p.unitId)));
        return true;
      });
    },

    /** Удаление навсегда: поле и его значения во всех задачах юнита. */
    deleteField(p) {
      return tx(() => {
        const f = get('SELECT * FROM fields WHERE id = ?', p.id) || fail('Поле не найдено', 'NOT_FOUND');
        run('DELETE FROM fields WHERE id = ?', f.id);
        for (const t of all('SELECT id, fields FROM tasks WHERE unit_id = ?', f.unit_id)) {
          const vals = parse(t.fields, {});
          if (!(f.id in vals)) continue;
          delete vals[f.id];
          run('UPDATE tasks SET fields = ? WHERE id = ?', JSON.stringify(vals), t.id);
        }
        return true;
      });
    },

    /* ---------- отделы (общий справочник) ---------- */

    createDepartment(p) {
      return tx(() => {
        const count = get('SELECT COUNT(*) AS n FROM departments').n;
        const d = { id: uid('d'), name: req(str(p.name, 40), 'Название отдела'), color: color(p.color, PALETTE[count % PALETTE.length]), ord: maxOrd('departments') + 1, archived: 0 };
        insert('departments', d);
        return deptOut(d);
      });
    },

    updateDepartment(p) {
      return tx(() => {
        const d = get('SELECT * FROM departments WHERE id = ?', p.id) || fail('Отдел не найден', 'NOT_FOUND');
        const upd = {};
        if ('name' in p) upd.name = req(str(p.name, 40), 'Название отдела');
        if ('color' in p) upd.color = color(p.color, d.color);
        if ('archived' in p) upd.archived = b(p.archived);
        update('departments', d.id, upd);
        return deptOut({ ...d, ...upd });
      });
    },

    reorderDepartments(p) {
      return tx(() => {
        (p.ids || []).forEach((id, i) => run('UPDATE departments SET ord = ? WHERE id = ?', i + 1, String(id)));
        return departments();
      });
    },

    /** Удаление: задачи и участники этого отдела остаются, но без отдела. */
    deleteDepartment(p) {
      return tx(() => {
        const d = get('SELECT * FROM departments WHERE id = ?', p.id) || fail('Отдел не найден', 'NOT_FOUND');
        run(`UPDATE tasks SET department_id = '' WHERE department_id = ?`, d.id);
        run(`UPDATE unit_members SET department_id = '' WHERE department_id = ?`, d.id);
        run('DELETE FROM departments WHERE id = ?', d.id);
        return true;
      });
    },

    /* ---------- состав юнита ---------- */

    /** Добавить человека в команду или сменить его отдел в ней. */
    setMember(p) {
      return tx(() => {
        const u = findUnit(p.unitId);
        get('SELECT 1 FROM people WHERE id = ?', p.personId) || fail('Человек не найден', 'NOT_FOUND');
        run(`INSERT INTO unit_members (unit_id, person_id, department_id, created_at) VALUES (?, ?, ?, ?)
             ON CONFLICT (unit_id, person_id) DO UPDATE SET department_id = excluded.department_id`,
          u.id, String(p.personId), validDept(p.departmentId), now());
        return unitMembers(u.id);
      });
    },

    /** Убрать из команды. Задачи человека не трогаем — исполнитель остаётся. */
    removeMember(p) {
      return tx(() => {
        run('DELETE FROM unit_members WHERE unit_id = ? AND person_id = ?', String(p.unitId), String(p.personId));
        return unitMembers(String(p.unitId));
      });
    },

    /* ---------- люди ---------- */

    createPerson(p) {
      return tx(() => {
        const person = {
          id: uid('p'), name: req(str(p.name, 80), 'Имя'), email: str(p.email, 120).toLowerCase(),
          role: str(p.role, 80), color: color(p.color, ''), telegram_chat_id: '', active: 1, created_at: now(),
        };
        insert('people', person);
        return personOut(person);
      });
    },

    updatePerson(p) {
      return tx(() => {
        const person = get('SELECT * FROM people WHERE id = ?', p.id) || fail('Человек не найден', 'NOT_FOUND');
        const upd = {};
        if ('name' in p) upd.name = req(str(p.name, 80), 'Имя');
        if ('email' in p) upd.email = str(p.email, 120).toLowerCase();
        if ('role' in p) upd.role = str(p.role, 80);
        if ('color' in p) upd.color = color(p.color, '');
        if ('active' in p) upd.active = b(p.active);
        update('people', person.id, upd);
        return personOut({ ...person, ...upd });
      });
    },
  };

  return {
    methods,
    /** Вызов по имени с единым форматом ответа. */
    call(method, payload, ctx = {}) {
      const fn = Object.hasOwn(methods, method) ? methods[method] : null;
      if (!fn) return { ok: false, error: 'Неизвестный метод: ' + method, code: 'NOT_FOUND' };
      try {
        return { ok: true, data: fn(payload && typeof payload === 'object' ? payload : {}, ctx) };
      } catch (e) {
        if (e instanceof ApiError) return { ok: false, error: e.message, code: e.code, data: e.data };
        console.error(`[api] ${method}:`, e);
        return { ok: false, error: 'Внутренняя ошибка сервера', code: 'INTERNAL' };
      }
    },
  };
}
