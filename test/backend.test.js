import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createBackend } from '../web/src/backend.js';
import { pgliteClient } from '../web/src/pglite-client.js';

const SCHEMA = fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');

/** Чистая база по схеме Supabase (роли anon/authenticated создаём сами — в Supabase они есть). */
async function setup() {
  const pg = new PGlite();
  await pg.exec('create role anon; create role authenticated;');
  await pg.exec(SCHEMA);
  const backend = createBackend(pgliteClient(pg));
  const api = async (method, payload, ctx) => {
    const r = await backend.call(method, payload, ctx);
    if (!r.ok) throw Object.assign(new Error(`${method}: ${r.error}`), { code: r.code, data: r.data });
    return r.data;
  };
  api.call = backend.call;
  return api;
}

test('юниты: ключи, настройки, дублирование, удаление', async () => {
  const api = await setup();
  const u1 = await api('createUnit', { name: 'Маркетинг', key: 'mkt' });
  assert.equal(u1.key, 'MKT');
  assert.equal(u1.settings.columns.length, 3);
  assert.ok(u1.settings.builtins.dueDate);
  assert.equal((await api('createUnit', { name: 'Без ключа' })).key, 'U');
  await assert.rejects(() => api('createUnit', { name: 'X', key: 'MKT' }), /уже занят/);

  const s = u1.settings;
  s.columns[0].name = 'Бэклог';
  s.builtins.description.hidden = true;
  s.builtins.title.hidden = true; // нельзя скрыть
  const upd = await api('updateUnit', { id: u1.id, settings: s, key: 'MARK' });
  assert.equal(upd.settings.columns[0].name, 'Бэклог');
  assert.equal(upd.settings.builtins.description.hidden, true);
  assert.equal(upd.settings.builtins.title.hidden, false);

  const dup = await api('duplicateUnit', { id: u1.id });
  assert.equal(dup.key, 'MARK2');
  assert.equal((await api('getBoard', { unitId: dup.id })).fields.length, 1);

  await api('createTask', { unitId: u1.id, title: 'a' });
  await api('deleteUnit', { id: u1.id });
  const boot = await api('bootstrap', {});
  assert.equal(boot.units.length, 2);
  await assert.rejects(() => api('getBoard', { unitId: u1.id }), /не найден/);
});

test('задачи: номера, правки, конфликт, журнал', async () => {
  const api = await setup();
  const me = await api('createPerson', { name: 'Аня', email: 'A@x.ru' });
  assert.equal(me.email, 'a@x.ru');
  const prof = await api('updatePerson', { id: me.id, role: '  Дизайнер ', color: '#ec4899' });
  assert.equal(prof.role, 'Дизайнер');
  assert.equal(prof.color, '#ec4899');
  assert.equal((await api('updatePerson', { id: me.id, color: 'red' })).color, ''); // невалидный цвет = авто
  const ctx = { actorId: me.id };
  const u = await api('createUnit', { name: 'Dev', key: 'DEV' });
  const prio = (await api('getBoard', { unitId: u.id })).fields[0];
  const t1 = await api('createTask', { unitId: u.id, title: '=SUM(1)' }, ctx);
  const t2 = await api('createTask', { unitId: u.id, title: 'Вторая', status: 'done' }, ctx);
  assert.equal(t1.num, 1);
  assert.equal(t2.num, 2);
  assert.ok(t2.doneAt);
  assert.equal(t1.createdBy, me.id);

  const a = await api('updateTask', { id: t1.id, expectedUpdatedAt: t1.updatedAt, patch: { status: 'in_progress', assigneeId: me.id, fields: { [prio.id]: 'o_high' } } }, ctx);
  assert.equal(a.status, 'in_progress');
  assert.equal(a.fields[prio.id], 'o_high');
  await assert.rejects(() => api('updateTask', { id: t1.id, expectedUpdatedAt: t1.updatedAt, patch: { title: 'x' } }), e => e.code === 'CONFLICT' && e.data.status === 'in_progress');

  const b = await api('updateTask', { id: t1.id, patch: { fields: { [prio.id]: null }, dueDate: 'завтра' } });
  assert.ok(!(prio.id in b.fields));
  assert.equal(b.dueDate, '');

  const ex = await api('getTaskExtras', { taskId: t1.id });
  const lines = ex.activity.map(x => `${x.action}:${x.label}:${x.fromText}>${x.toText}`);
  assert.ok(lines.includes('update:Статус:To Do>In Progress'), lines.join(' | '));
  assert.ok(lines.includes('update:Исполнитель:—>Аня'));
  assert.ok(lines.includes('update:Приоритет:High>—'));
  assert.equal(ex.activity.at(-1).actorId, me.id);
});

test('чеклист, срок, комментарии, главная, поиск', async () => {
  const api = await setup();
  const u = await api('createUnit', { name: 'Ops', key: 'OPS' });
  const t = await api('createTask', { unitId: u.id, title: 'Проверить бэкап', dueDate: '2020-01-01', checklist: [{ text: 'a' }, { text: ' ' }] });
  assert.equal(t.checklist.length, 1);
  assert.match(t.checklist[0].id, /^k_/);

  const t2 = await api('updateTask', { id: t.id, patch: { checklist: [{ ...t.checklist[0], text: 'a!' }, { id: 'k_x', text: 'b', done: true }] } });
  assert.equal(t2.checklist[1].done, true);
  assert.notEqual(t2.updatedAt, t.updatedAt);

  const c = await api('addComment', { taskId: t.id, text: '  Привет  ' });
  assert.equal(c.text, 'Привет');
  assert.ok((await api('updateComment', { id: c.id, text: 'Привет!' })).editedAt);
  await api('addComment', { taskId: t.id, text: 'Второй' });
  assert.equal((await api('getBoard', { unitId: u.id })).tasks[0].commentCount, 2);

  const home = await api('getHome', { today: '2026-09-24' });
  assert.equal(home.stats.overdue, 1);
  assert.equal(home.units[0].counts.overdue, 1);
  assert.ok(home.activity.some(a => a.action === 'comment' && a.task.key === 'OPS-1'));

  const found = await api('queryTasks', { q: 'бэкап' });
  assert.equal(found.length, 1);
  assert.equal(found[0].key, 'OPS-1');
  assert.equal(found[0].statusName, 'To Do');

  await api('deleteTask', { id: t.id });
  assert.equal((await api('getTaskExtras', { taskId: t.id })).comments.length, 0);
  assert.ok((await api('getHome', {})).activity.some(a => a.action === 'delete' && a.fromText === 'Проверить бэкап'));
});

test('поля: создание, варианты, удаление вместе со значениями; перенос задач', async () => {
  const api = await setup();
  const u1 = await api('createUnit', { name: 'A', key: 'AA' });
  const u2 = await api('createUnit', { name: 'B', key: 'BB' });
  const f = await api('createField', { unitId: u1.id, name: 'Теги', type: 'multiselect', options: [{ name: 'X' }, { name: 'Y' }, { name: '' }] });
  assert.equal(f.options.length, 2);
  const t = await api('createTask', { unitId: u1.id, title: 'T', fields: { [f.id]: [f.options[0].id] } });
  await api('createTask', { unitId: u2.id, title: 'first in B' });

  const moved = await api('moveTask', { id: t.id, unitId: u2.id });
  assert.equal(moved.unitId, u2.id);
  assert.equal(moved.num, 2);
  assert.deepEqual(moved.fields[f.id], [f.options[0].id]); // значения не теряются

  await api('moveTask', { id: t.id, unitId: u1.id });
  await api('deleteField', { id: f.id });
  assert.ok(!(f.id in (await api('getBoard', { unitId: u1.id })).tasks[0].fields));

  await api('reorderFields', { unitId: u1.id, ids: [(await api('getBoard', { unitId: u1.id })).fields[0].id] });
  assert.equal((await api('updateField', { id: (await api('getBoard', { unitId: u1.id })).fields[0].id, archived: true })).archived, true);
});

test('свои колонки, отделы, состав команды', async () => {
  const api = await setup();
  const u = await api('createUnit', { name: 'Alpha', key: 'ALP' });
  const s = u.settings;
  s.columns.splice(2, 0, { id: 'review', name: 'Review', kind: 'progress', color: '#8b5cf6' });
  s.columns.push({ id: 'Bad Id', name: 'x' });
  const u2 = await api('updateUnit', { id: u.id, settings: s });
  assert.deepEqual(u2.settings.columns.map(c => c.id), ['todo', 'in_progress', 'review', 'done']);

  const t = await api('createTask', { unitId: u.id, title: 'A', status: 'review', dueDate: '2020-01-01' });
  assert.equal(t.status, 'review');
  assert.equal((await api('getHome', { today: '2026-01-01' })).stats.in_progress, 1);
  assert.equal((await api('getHome', { today: '2026-01-01' })).stats.overdue, 1);
  await assert.rejects(() => api('updateTask', { id: t.id, patch: { status: 'nope' } }), /колонки нет/);

  // колонку «Review» переименовали в тип done → задача считается выполненной
  u2.settings.columns[2].kind = 'done';
  await api('updateUnit', { id: u.id, settings: u2.settings });
  let home = await api('getHome', { today: '2026-01-01' });
  assert.equal(home.stats.overdue, 0);
  assert.equal(home.stats.doneWeek, 1);

  // удаление колонки с задачами: переезд по statusRemap
  const cols = u2.settings.columns.filter(c => c.id !== 'review');
  await api('updateUnit', { id: u.id, settings: { ...u2.settings, columns: cols }, statusRemap: { review: 'todo' } });
  const moved = (await api('getBoard', { unitId: u.id })).tasks[0];
  assert.equal(moved.status, 'todo');
  assert.equal(moved.doneAt, '');

  // отделы и команда
  const board = await api('getBoard', { unitId: u.id });
  assert.deepEqual(board.departments.map(d => d.name), ['ASO', 'Design', 'iOS', 'Other']);
  const p = await api('createPerson', { name: 'Ира' });
  const members = await api('setMember', { unitId: u.id, personId: p.id, departmentId: 'd_design' });
  assert.deepEqual(members, [{ personId: p.id, departmentId: 'd_design' }]);
  const t2 = await api('updateTask', { id: t.id, patch: { assigneeId: p.id } });
  assert.equal(t2.departmentId, 'd_design'); // отдел подставился из состава команды
  const ex = (await api('getTaskExtras', { taskId: t.id })).activity.map(a => `${a.label}:${a.toText}`);
  assert.ok(ex.includes('Отдел:Design'), ex.join(' | '));
  await api('deleteDepartment', { id: 'd_design' });
  assert.equal((await api('getBoard', { unitId: u.id })).tasks[0].departmentId, '');
  assert.equal((await api('bootstrap', {})).units[0].members[0], p.id);
  assert.deepEqual(await api('removeMember', { unitId: u.id, personId: p.id }), []);
});

test('неизвестный метод и внутренние ошибки не падают', async () => {
  const { call } = await setup();
  assert.equal((await call('dropTables', {})).ok, false);
  assert.equal((await call('toString', {})).ok, false);
  assert.equal((await call('getBoard', null)).code, 'NOT_FOUND');
});
