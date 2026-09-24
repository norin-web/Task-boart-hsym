import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';

function setup() {
  const { call } = createApi(openDb(':memory:'));
  const api = (method, payload, ctx) => {
    const r = call(method, payload, ctx);
    if (!r.ok) throw Object.assign(new Error(`${method}: ${r.error}`), { code: r.code, data: r.data });
    return r.data;
  };
  return api;
}

test('юниты: ключи, настройки, дублирование, удаление', () => {
  const api = setup();
  const u1 = api('createUnit', { name: 'Маркетинг', key: 'mkt' });
  assert.equal(u1.key, 'MKT');
  assert.equal(u1.settings.columns.length, 3);
  assert.ok(u1.settings.builtins.dueDate);
  assert.equal(api('createUnit', { name: 'Без ключа' }).key, 'U');
  assert.throws(() => api('createUnit', { name: 'X', key: 'MKT' }), /уже занят/);

  const s = u1.settings;
  s.columns[0].name = 'Бэклог';
  s.builtins.description.hidden = true;
  s.builtins.title.hidden = true; // нельзя скрыть
  const upd = api('updateUnit', { id: u1.id, settings: s, key: 'MARK' });
  assert.equal(upd.settings.columns[0].name, 'Бэклог');
  assert.equal(upd.settings.builtins.description.hidden, true);
  assert.equal(upd.settings.builtins.title.hidden, false);

  const dup = api('duplicateUnit', { id: u1.id });
  assert.equal(dup.key, 'MARK2');
  assert.equal(api('getBoard', { unitId: dup.id }).fields.length, 1);

  api('createTask', { unitId: u1.id, title: 'a' });
  api('deleteUnit', { id: u1.id });
  const boot = api('bootstrap', {});
  assert.equal(boot.units.length, 2);
  assert.throws(() => api('getBoard', { unitId: u1.id }), /не найден/);
});

test('задачи: номера, правки, конфликт, журнал', () => {
  const api = setup();
  const me = api('createPerson', { name: 'Аня', email: 'A@x.ru' });
  assert.equal(me.email, 'a@x.ru');
  const prof = api('updatePerson', { id: me.id, role: '  Дизайнер ', color: '#ec4899' });
  assert.equal(prof.role, 'Дизайнер');
  assert.equal(prof.color, '#ec4899');
  assert.equal(api('updatePerson', { id: me.id, color: 'red' }).color, ''); // невалидный цвет = авто
  const ctx = { actorId: me.id };
  const u = api('createUnit', { name: 'Dev', key: 'DEV' });
  const prio = api('getBoard', { unitId: u.id }).fields[0];
  const t1 = api('createTask', { unitId: u.id, title: '=SUM(1)' }, ctx);
  const t2 = api('createTask', { unitId: u.id, title: 'Вторая', status: 'done' }, ctx);
  assert.equal(t1.num, 1);
  assert.equal(t2.num, 2);
  assert.ok(t2.doneAt);
  assert.equal(t1.createdBy, me.id);

  const a = api('updateTask', { id: t1.id, expectedUpdatedAt: t1.updatedAt, patch: { status: 'in_progress', assigneeId: me.id, fields: { [prio.id]: 'o_high' } } }, ctx);
  assert.equal(a.status, 'in_progress');
  assert.equal(a.fields[prio.id], 'o_high');
  assert.throws(() => api('updateTask', { id: t1.id, expectedUpdatedAt: t1.updatedAt, patch: { title: 'x' } }), e => e.code === 'CONFLICT' && e.data.status === 'in_progress');

  const b = api('updateTask', { id: t1.id, patch: { fields: { [prio.id]: null }, dueDate: 'завтра' } });
  assert.ok(!(prio.id in b.fields));
  assert.equal(b.dueDate, '');

  const ex = api('getTaskExtras', { taskId: t1.id });
  const lines = ex.activity.map(x => `${x.action}:${x.label}:${x.fromText}>${x.toText}`);
  assert.ok(lines.includes('update:Статус:To Do>In Progress'), lines.join(' | '));
  assert.ok(lines.includes('update:Исполнитель:—>Аня'));
  assert.ok(lines.includes('update:Приоритет:High>—'));
  assert.equal(ex.activity.at(-1).actorId, me.id);
});

test('чеклист, срок, комментарии, главная, поиск', () => {
  const api = setup();
  const u = api('createUnit', { name: 'Ops', key: 'OPS' });
  const t = api('createTask', { unitId: u.id, title: 'Проверить бэкап', dueDate: '2020-01-01', checklist: [{ text: 'a' }, { text: ' ' }] });
  assert.equal(t.checklist.length, 1);
  assert.match(t.checklist[0].id, /^k_/);

  const t2 = api('updateTask', { id: t.id, patch: { checklist: [{ ...t.checklist[0], text: 'a!' }, { id: 'k_x', text: 'b', done: true }] } });
  assert.equal(t2.checklist[1].done, true);
  assert.notEqual(t2.updatedAt, t.updatedAt);

  const c = api('addComment', { taskId: t.id, text: '  Привет  ' });
  assert.equal(c.text, 'Привет');
  assert.ok(api('updateComment', { id: c.id, text: 'Привет!' }).editedAt);
  api('addComment', { taskId: t.id, text: 'Второй' });
  assert.equal(api('getBoard', { unitId: u.id }).tasks[0].commentCount, 2);

  const home = api('getHome', { today: '2026-09-24' });
  assert.equal(home.stats.overdue, 1);
  assert.equal(home.units[0].counts.overdue, 1);
  assert.ok(home.activity.some(a => a.action === 'comment' && a.task.key === 'OPS-1'));

  const found = api('queryTasks', { q: 'бэкап' });
  assert.equal(found.length, 1);
  assert.equal(found[0].key, 'OPS-1');
  assert.equal(found[0].statusName, 'To Do');

  api('deleteTask', { id: t.id });
  assert.equal(api('getTaskExtras', { taskId: t.id }).comments.length, 0);
  assert.ok(api('getHome', {}).activity.some(a => a.action === 'delete' && a.fromText === 'Проверить бэкап'));
});

test('поля: создание, варианты, удаление вместе со значениями; перенос задач', () => {
  const api = setup();
  const u1 = api('createUnit', { name: 'A', key: 'AA' });
  const u2 = api('createUnit', { name: 'B', key: 'BB' });
  const f = api('createField', { unitId: u1.id, name: 'Теги', type: 'multiselect', options: [{ name: 'X' }, { name: 'Y' }, { name: '' }] });
  assert.equal(f.options.length, 2);
  const t = api('createTask', { unitId: u1.id, title: 'T', fields: { [f.id]: [f.options[0].id] } });
  api('createTask', { unitId: u2.id, title: 'first in B' });

  const moved = api('moveTask', { id: t.id, unitId: u2.id });
  assert.equal(moved.unitId, u2.id);
  assert.equal(moved.num, 2);
  assert.deepEqual(moved.fields[f.id], [f.options[0].id]); // значения не теряются

  api('moveTask', { id: t.id, unitId: u1.id });
  api('deleteField', { id: f.id });
  assert.ok(!(f.id in api('getBoard', { unitId: u1.id }).tasks[0].fields));

  api('reorderFields', { unitId: u1.id, ids: [api('getBoard', { unitId: u1.id }).fields[0].id] });
  assert.equal(api('updateField', { id: api('getBoard', { unitId: u1.id }).fields[0].id, archived: true }).archived, true);
});

test('свои колонки, отделы, состав команды', () => {
  const api = setup();
  const u = api('createUnit', { name: 'Alpha', key: 'ALP' });
  const s = u.settings;
  s.columns.splice(2, 0, { id: 'review', name: 'Review', kind: 'progress', color: '#8b5cf6' });
  s.columns.push({ id: 'Bad Id', name: 'x' });
  const u2 = api('updateUnit', { id: u.id, settings: s });
  assert.deepEqual(u2.settings.columns.map(c => c.id), ['todo', 'in_progress', 'review', 'done']);

  const t = api('createTask', { unitId: u.id, title: 'A', status: 'review', dueDate: '2020-01-01' });
  assert.equal(t.status, 'review');
  assert.equal(api('getHome', { today: '2026-01-01' }).stats.in_progress, 1);
  assert.equal(api('getHome', { today: '2026-01-01' }).stats.overdue, 1);
  assert.throws(() => api('updateTask', { id: t.id, patch: { status: 'nope' } }), /колонки нет/);

  // колонку «Review» переименовали в тип done → задача считается выполненной
  u2.settings.columns[2].kind = 'done';
  api('updateUnit', { id: u.id, settings: u2.settings });
  let home = api('getHome', { today: '2026-01-01' });
  assert.equal(home.stats.overdue, 0);
  assert.equal(home.stats.doneWeek, 1);

  // удаление колонки с задачами: переезд по statusRemap
  const cols = u2.settings.columns.filter(c => c.id !== 'review');
  api('updateUnit', { id: u.id, settings: { ...u2.settings, columns: cols }, statusRemap: { review: 'todo' } });
  const moved = api('getBoard', { unitId: u.id }).tasks[0];
  assert.equal(moved.status, 'todo');
  assert.equal(moved.doneAt, '');

  // отделы и команда
  const board = api('getBoard', { unitId: u.id });
  assert.deepEqual(board.departments.map(d => d.name), ['ASO', 'Design', 'iOS', 'Other']);
  const p = api('createPerson', { name: 'Ира' });
  const members = api('setMember', { unitId: u.id, personId: p.id, departmentId: 'd_design' });
  assert.deepEqual(members, [{ personId: p.id, departmentId: 'd_design' }]);
  const t2 = api('updateTask', { id: t.id, patch: { assigneeId: p.id } });
  assert.equal(t2.departmentId, 'd_design'); // отдел подставился из состава команды
  const ex = api('getTaskExtras', { taskId: t.id }).activity.map(a => `${a.label}:${a.toText}`);
  assert.ok(ex.includes('Отдел:Design'), ex.join(' | '));
  api('deleteDepartment', { id: 'd_design' });
  assert.equal(api('getBoard', { unitId: u.id }).tasks[0].departmentId, '');
  assert.equal(api('bootstrap', {}).units[0].members[0], p.id);
  assert.deepEqual(api('removeMember', { unitId: u.id, personId: p.id }), []);
});

test('неизвестный метод и внутренние ошибки не падают', () => {
  const { call } = createApi(openDb(':memory:'));
  assert.equal(call('dropTables', {}).ok, false);
  assert.equal(call('toString', {}).ok, false);
  assert.equal(call('getBoard', null).code, 'NOT_FOUND');
});
