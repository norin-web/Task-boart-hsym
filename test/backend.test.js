import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createBackend } from '../web/src/backend.js';
import { pgliteClient, AUTH_STUB_SQL } from '../web/src/pglite-client.js';

const SCHEMA = fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');

/** Чистая база по схеме Supabase (роли anon/authenticated создаём сами — в Supabase они есть). */
async function setup() {
  const pg = new PGlite();
  await pg.exec(AUTH_STUB_SQL);
  await pg.exec(SCHEMA);
  const backend = createBackend(pgliteClient(pg));
  const api = async (method, payload, ctx) => {
    const r = await backend.call(method, payload, ctx);
    if (!r.ok) throw Object.assign(new Error(`${method}: ${r.error}`), { code: r.code, data: r.data });
    return r.data;
  };
  api.call = backend.call;
  api.pg = pg;
  return api;
}

test('юниты: ключи, настройки, дублирование, удаление', async () => {
  const api = await setup();
  const u1 = await api('createUnit', { name: 'Маркетинг', key: 'mkt' });
  assert.equal(u1.key, 'MKT');
  assert.equal(u1.settings.columns.length, 3);
  assert.ok(u1.settings.builtins.dueDate);
  assert.equal(u1.settings.hideDoneDays, 0);
  assert.equal((await api('createUnit', { name: 'Без ключа' })).key, 'U');
  await assert.rejects(() => api('createUnit', { name: 'X', key: 'MKT' }), /уже занят/);

  const s = u1.settings;
  s.columns[0].name = 'Бэклог';
  s.builtins.description.hidden = true;
  s.builtins.title.hidden = true; // нельзя скрыть
  s.hideDoneDays = '3';
  const upd = await api('updateUnit', { id: u1.id, settings: s, key: 'MARK' });
  assert.equal(upd.settings.columns[0].name, 'Бэклог');
  assert.equal(upd.settings.builtins.description.hidden, true);
  assert.equal(upd.settings.builtins.title.hidden, false);
  assert.equal(upd.settings.hideDoneDays, 3);

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

  // лента с фильтрами и сводка
  const feed = await api('getActivity', { kind: 'comment' });
  assert.ok(feed.items.length >= 2 && feed.items.every(a => a.action === 'comment'));
  assert.equal((await api('getActivity', { unitId: 'nope' })).items.length, 0);
  assert.equal((await api('getActivity', { since: new Date(Date.now() + 864e5).toISOString() })).items.length, 0);
  const page1 = await api('getActivity', { limit: 2 });
  assert.equal(page1.items.length, 2);
  assert.equal(page1.more, true);
  const page2 = await api('getActivity', { limit: 2, before: page1.items[1].at });
  assert.ok(page2.items.every(a => a.at < page1.items[1].at));
  const ov = await api('getOverview', { today: '2026-09-24' });
  assert.equal(ov.overdueTotal, 1);
  assert.equal(ov.overdue[0].key, 'OPS-1');
  assert.equal(ov.unassigned, 1);
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
  assert.deepEqual(board.departments.map(d => d.name), ['Product owner', 'iOS Dev', 'UX/UI Designer', 'ASO Specialist', 'Release Manager', 'QA', 'Other']);
  assert.equal((await api('createPerson', { name: 'Без позиции' })).positionId, 'd_other'); // без позиции не бывает
  const p = await api('createPerson', { name: 'Ира', positionId: 'd_design', extraPositionIds: ['d_po', 'd_design', 'нет'] });
  assert.deepEqual(p.positionIds, ['d_design', 'd_po']);
  const members = await api('setMember', { unitId: u.id, personId: p.id, departmentId: 'd_design' });
  assert.deepEqual(members, [{ personId: p.id, departmentId: 'd_design' }]);
  const t2 = await api('updateTask', { id: t.id, patch: { assigneeId: p.id } });
  assert.equal(t2.departmentId, 'd_design'); // основная позиция исполнителя
  const ex = (await api('getTaskExtras', { taskId: t.id })).activity.map(a => `${a.label}:${a.toText}`);
  assert.ok(ex.includes('Позиция:UX/UI Designer'), ex.join(' | '));
  // позиция следует за исполнителем: другой исполнитель с позицией iOS
  const dev = await api('createPerson', { name: 'Дима', positionId: 'd_ios' });
  assert.equal((await api('updateTask', { id: t.id, patch: { assigneeId: dev.id } })).departmentId, 'd_ios');
  // явная позиция в том же изменении важнее
  assert.equal((await api('updateTask', { id: t.id, patch: { assigneeId: p.id, departmentId: 'd_aso' } })).departmentId, 'd_aso');
  await api('updateTask', { id: t.id, patch: { assigneeId: p.id, departmentId: 'd_design' } });
  await api('deleteDepartment', { id: 'd_design' });
  assert.equal((await api('getBoard', { unitId: u.id })).tasks[0].departmentId, '');
  const after = (await api('bootstrap', {})).people.find(x => x.id === p.id);
  assert.deepEqual(after.positionIds, ['d_other', 'd_po']); // люди удалённой позиции — в Other
  await assert.rejects(() => api('deleteDepartment', { id: 'd_other' }), /Other удалить нельзя/);
  assert.equal((await api('bootstrap', {})).units[0].members[0], p.id);
  assert.deepEqual(await api('removeMember', { unitId: u.id, personId: p.id }), []);
});

test('корзина юнитов: восстановление и автоудаление по сроку', async () => {
  const api = await setup();
  const u = await api('createUnit', { name: 'Old', key: 'OLD' });
  await api('createTask', { unitId: u.id, title: 'x' });
  const arch = await api('updateUnit', { id: u.id, archived: true });
  assert.ok(arch.archived && arch.archivedAt);
  assert.equal((await api('updateUnit', { id: u.id, archived: false })).archivedAt, '');
  await api('updateUnit', { id: u.id, archived: true });
  assert.equal((await api('getAppSettings', {})).unitRetentionDays, 30);
  await assert.rejects(() => api('updateAppSettings', { unitRetentionDays: 5 }), /срок/);
  await api('updateAppSettings', { unitRetentionDays: 7 });
  assert.equal(await api('purgeArchivedUnits', {}), 0); // ещё рано
  await api.pg.query("update units set archived_at = '2000-01-01T00:00:00.000Z' where id = $1", [u.id]);
  assert.equal(await api('purgeArchivedUnits', {}), 1);
  assert.equal((await api('bootstrap', {})).units.length, 0);
});

test('общие поля: на все юниты, обязательность по типу колонки, слияние старых приоритетов', async () => {
  const api = await setup();
  const a = await api('createUnit', { name: 'A', key: 'AAA' });
  const b = await api('createUnit', { name: 'B', key: 'BBB' });
  // общее поле видно в обоих юнитах, в начале списка; свои поля юнита — только у него
  const g = await api('createField', { global: true, name: 'Канал', type: 'text', required: true, requiredFrom: 'done' });
  const own = await api('createField', { unitId: a.id, name: 'Своё', type: 'text' });
  const fa = (await api('getBoard', { unitId: a.id })).fields.map(f => f.id);
  const fb = (await api('getBoard', { unitId: b.id })).fields.map(f => f.id);
  assert.ok(fa.includes(g.id) && fb.includes(g.id) && fa.includes(own.id) && !fb.includes(own.id));
  assert.equal(fa[0], 'f_priority');
  // копия юнита забирает только свои поля
  const c = await api('createUnit', { name: 'C', key: 'CCC', copyFieldsFrom: a.id });
  const fc = (await api('getBoard', { unitId: c.id })).fields;
  assert.equal(fc.filter(f => f.name === 'Своё').length, 1);
  assert.equal(fc.filter(f => f.global).length, 2);
  await api('deleteField', { id: g.id });
  assert.ok(!(await api('getBoard', { unitId: b.id })).fields.some(f => f.id === g.id));

  // старая база: у юнита свой «Приоритет» → при обновлении схемы сливается в общий
  const pg = api.pg;
  await pg.query("delete from fields where id = 'f_priority'");
  await pg.query(`insert into fields (id, unit_id, name, type, options, show_on_card, required, ord, archived, staff_only, role)
    values ('f_old', $1, 'Приоритет', 'select', '[{"id":"o_x","name":"high","color":"#f00"}]', true, false, 1, false, true, 'priority')`, [a.id]);
  const t = await api('createTask', { unitId: a.id, title: 'x' });
  await pg.query(`update tasks set fields = '{"f_old":"o_x"}' where id = $1`, [t.id]);
  await pg.exec(SCHEMA);
  const board = await api('getBoard', { unitId: a.id });
  assert.ok(!board.fields.some(f => f.id === 'f_old'));
  assert.deepEqual(board.tasks.find(x => x.id === t.id).fields, { f_priority: 'o_high' });
});

test('иерархия: юниты по уровням, передача вниз, апдейты и декомпозиция, сводка', async () => {
  const api = await setup();
  const ceo = await api('createUnit', { name: 'Компания', key: 'CEO' });
  const mod = await api('createUnit', { name: 'Модераторы', key: 'MOD' });
  const ios = await api('createUnit', { name: 'iOS', key: 'IOS' });
  await api('updateUnit', { id: mod.id, parentId: ceo.id });
  await api('updateUnit', { id: ios.id, parentId: mod.id });
  await assert.rejects(() => api('updateUnit', { id: ceo.id, parentId: ios.id }), /самого себя/);

  // CEO: «В работу» → карточка-приложение у модераторов
  await api('updateUnit', { id: ceo.id, settings: { ...ceo.settings, handoff: { column: 'in_progress', unitId: mod.id } } });
  const app = await api('createTask', { unitId: ceo.id, title: 'Новое приложение', dueDate: '2030-01-01', fields: { f_priority: 'o_high' } });
  await api('updateTask', { id: app.id, patch: { status: 'in_progress' } });
  await api('updateTask', { id: app.id, patch: { status: 'todo' } });
  await api('updateTask', { id: app.id, patch: { status: 'in_progress' } }); // повторно — не дублирует
  let mb = await api('getBoard', { unitId: mod.id });
  assert.equal(mb.tasks.length, 1);
  const card = mb.tasks[0];
  assert.equal(card.kind, 'app');
  assert.equal(card.parentId, app.id);
  assert.equal(card.title, 'Новое приложение');
  assert.equal(card.fields.f_priority, 'o_high');
  assert.equal(card.parent.key, 'CEO-1');

  // модераторы: апдейт приложения и задачи в iOS
  const upd = await api('createTask', { unitId: mod.id, title: 'Апдейт 1.1', kind: 'update', parentId: card.id });
  const t1 = await api('createTask', { unitId: ios.id, title: 'Экран', parentId: upd.id, dueDate: '2000-01-01' });
  await api('createTask', { unitId: ios.id, title: 'Сборка', parentId: card.id, status: 'done' });
  assert.equal(t1.parentId, upd.id);

  // CEO видит сводку и дерево
  const cb = await api('getBoard', { unitId: ceo.id, today: '2026-10-26' });
  assert.deepEqual(cb.tasks[0].tree, { total: 4, done: 1, overdue: 1 });
  const mb2 = await api('getBoard', { unitId: mod.id, today: '2026-10-26' });
  assert.deepEqual(mb2.tasks.find(t => t.id === card.id).tree, { total: 3, done: 1, overdue: 1 }); // вложенные не дважды
  assert.deepEqual(mb2.tasks.find(t => t.id === upd.id).tree, { total: 1, done: 0, overdue: 1 });
  const tree = await api('getTaskTree', { id: app.id });
  assert.deepEqual(tree.descendants.map(d => [d.title, d.depth]), [['Новое приложение', 1], ['Апдейт 1.1', 2], ['Сборка', 2], ['Экран', 3]]);
  assert.ok(tree.descendants[0].stages.length >= 3);
  const up = await api('getTaskTree', { id: t1.id });
  assert.deepEqual(up.ancestors.map(a => a.title), ['Новое приложение', 'Новое приложение', 'Апдейт 1.1']);
});

test('неизвестный метод и внутренние ошибки не падают', async () => {
  const { call } = await setup();
  assert.equal((await call('dropTables', {})).ok, false);
  assert.equal((await call('toString', {})).ok, false);
  assert.equal((await call('getBoard', null)).code, 'NOT_FOUND');
});
