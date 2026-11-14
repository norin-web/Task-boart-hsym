import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createBackend } from '../web/src/backend.js';
import { pgliteClient, AUTH_STUB_SQL } from '../web/src/pglite-client.js';
import { batchClient } from '../web/src/batch.js';
// TM_BATCH=1 — все чтения через пакет (read_batch), как на общей базе
const client = pg => (process.env.TM_BATCH ? batchClient(pgliteClient(pg)) : pgliteClient(pg));

const SCHEMA = fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');

/** Чистая база по схеме Supabase (роли anon/authenticated создаём сами — в Supabase они есть). */
async function setup() {
  const pg = new PGlite();
  await pg.exec(AUTH_STUB_SQL);
  await pg.exec(SCHEMA);
  const backend = createBackend(client(pg));
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
  assert.deepEqual(u1.settings.columns.map(c => c.name), ['К выполнению', 'В работе', 'В ревью', 'Доработка', 'Готово']); // константы досок; «Доработка» — обязательная
  assert.equal(u1.settings.review.column, 'review');
  assert.ok(u1.settings.builtins.dueDate);
  assert.equal(u1.settings.hideDoneDays, 7);
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
  assert.ok(lines.includes('update:Статус:К выполнению>В работе'), lines.join(' | '));
  assert.ok(lines.includes('update:Исполнитель:—>Аня'));
  assert.ok(lines.includes('update:Приоритет:Высокий>—'));
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
  assert.ok((await api('getActivity', {})).items.some(a => a.action === 'comment' && a.task.key === 'OPS-1'));

  const found = await api('queryTasks', { q: 'бэкап' });
  assert.equal(found.length, 1);
  assert.equal(found[0].key, 'OPS-1');
  assert.equal(found[0].statusName, 'К выполнению');

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
  assert.ok((await api('getActivity', {})).items.some(a => a.action === 'delete' && a.fromText === 'Проверить бэкап'));
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
  assert.deepEqual(u2.settings.columns.map(c => c.id), ['todo', 'in_progress', 'review', 'rework', 'done']);
  // «Доработку» нельзя убрать и сделать не рабочей: после сохранения она снова на месте, тип — «в процессе»
  const u3 = await api('updateUnit', { id: u.id, settings: { ...u2.settings, columns: u2.settings.columns.filter(c => c.id !== 'rework') } });
  assert.deepEqual(u3.settings.columns.map(c => c.id), ['todo', 'in_progress', 'review', 'rework', 'done']);
  const u4 = await api('updateUnit', { id: u.id, settings: { ...u3.settings, columns: u3.settings.columns.map(c => (c.id === 'rework' ? { ...c, kind: 'done', name: 'Доработка' } : c)) } });
  assert.equal(u4.settings.columns.find(c => c.id === 'rework').kind, 'progress');

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

test('доска: архив не грузится, пока не попросили (фильтр «Архив» или ссылка на задачу)', async () => {
  const api = await setup();
  const u = await api('createUnit', { name: 'Доска', key: 'brd' });
  const live = await api('createTask', { unitId: u.id, title: 'Живая' });
  const old = await api('createTask', { unitId: u.id, title: 'Старая' });
  await api('updateTask', { id: old.id, patch: { archived: true } });
  const ids = b => b.tasks.map(t => t.id).sort();
  const plain = await api('getBoard', { unitId: u.id });
  assert.deepEqual(ids(plain), [live.id]);
  assert.equal(plain.withArchived, false);
  const full = await api('getBoard', { unitId: u.id, archived: true });
  assert.deepEqual(ids(full), [live.id, old.id].sort());
  assert.equal(full.withArchived, true);
  assert.ok(full.tasks.find(t => t.id === old.id).archived);
  assert.deepEqual(ids(await api('getBoard', { unitId: u.id, taskId: old.id })), [live.id, old.id].sort());
  // задача другого юнита по taskId не подмешивается
  const other = await api('createUnit', { name: 'Другой', key: 'oth' });
  const alien = await api('createTask', { unitId: other.id, title: 'Чужая' });
  assert.deepEqual(ids(await api('getBoard', { unitId: u.id, taskId: alien.id })), [live.id]);
});

test('картинка юнита: при создании и в настройках, только data:image, копируется с юнитом', async () => {
  const api = await setup();
  const pic = 'data:image/webp;base64,' + 'A'.repeat(200);
  const u = await api('createUnit', { name: 'С картинкой', key: 'pic', icon: pic });
  assert.equal(u.icon, pic);
  assert.equal((await api('bootstrap', { today: '2026-11-05' })).units.find(x => x.id === u.id).icon, pic);
  assert.equal((await api('updateUnit', { id: u.id, icon: 'javascript:alert(1)' })).icon, '', 'не картинка — пусто');
  assert.equal((await api('updateUnit', { id: u.id, icon: 'data:image/png;base64,' + 'A'.repeat(130000) })).icon, '', 'слишком большая — пусто');
  assert.equal((await api('updateUnit', { id: u.id, icon: pic })).icon, pic);
  assert.equal((await api('updateUnit', { id: u.id, name: 'Без смены картинки' })).icon, pic, 'другие правки картинку не трогают');
  assert.equal((await api('createUnit', { name: 'Без картинки', key: 'nopic' })).icon, '');
  assert.equal((await api('duplicateUnit', { id: u.id })).icon, pic, 'копия юнита — с той же картинкой');
});

test('схема: старым юнитам без «Доработки» она добавляется перед «Готово», повторный запуск ничего не меняет', async () => {
  const api = await setup();
  const u = await api('createUnit', { name: 'Старый', key: 'old' });
  const old = [{ id: 'todo', name: 'К выполнению', kind: 'todo', color: '' }, { id: 'in_progress', name: 'В работе', kind: 'progress', color: '' },
    { id: 'review', name: 'В ревью', kind: 'progress', color: '' }, { id: 'done', name: 'Готово', kind: 'done', color: '' }];
  const manual = await api('createUnit', { name: 'Вручную', key: 'man' });
  const own = [old[0], { id: 'c_fix', name: 'Доработка', kind: 'progress', color: '#ff0000' }, old[3]];
  await api.pg.query(`update units set settings = jsonb_set(settings, '{columns}', $2::jsonb) where id = $1`, [u.id, JSON.stringify(old)]);
  await api.pg.query(`update units set settings = jsonb_set(settings, '{columns}', $2::jsonb) where id = $1`, [manual.id, JSON.stringify(own)]);
  const cols = async id => (await api.pg.query('select settings from units where id = $1', [id])).rows[0].settings.columns.map(c => c.id);
  await api.pg.exec(SCHEMA);
  assert.deepEqual(await cols(u.id), ['todo', 'in_progress', 'review', 'rework', 'done']);
  assert.deepEqual(await cols(manual.id), ['todo', 'c_fix', 'done'], 'своя «Доработка» остаётся, вторую не добавляем');
  await api.pg.exec(SCHEMA);
  assert.deepEqual(await cols(u.id), ['todo', 'in_progress', 'review', 'rework', 'done']);
});

test('неизвестный метод и внутренние ошибки не падают', async () => {
  const { call } = await setup();
  assert.equal((await call('dropTables', {})).ok, false);
  assert.equal((await call('toString', {})).ok, false);
  assert.equal((await call('getBoard', null)).code, 'NOT_FOUND');
});

test('бэклог: у идеи юнит — общий или выбранный; у апдейта — юнит приложения; запуск нового — в юнит идеи', async () => {
  const api = await setup();
  const u = await api('createUnit', { name: 'Gold', key: 'GLD' });
  const { app } = await api('createApp', { name: 'Пульт', unitId: u.id, noRequest: true });
  const common = await api('saveIdea', { kind: 'new_app', title: 'Общая идея' });
  assert.equal(common.unitId, '');
  const mine = await api('saveIdea', { kind: 'new_app', unitId: u.id, title: 'Идея Gold' });
  assert.equal(mine.unitId, u.id);
  const upd = await api('saveIdea', { kind: 'update', appId: app.id, title: 'Виджеты' });
  assert.equal(upd.unitId, u.id);
  const res = await api('startIdea', { id: mine.id, name: 'Новое' });
  assert.equal(res.request.unitId, u.id);
});

test('новая задача с приложением: только приложение этого юнита', async () => {
  const api = await setup();
  const a = await api('createUnit', { name: 'Alpha', key: 'ALP' });
  const b = await api('createUnit', { name: 'Bravo', key: 'BRV' });
  const { app } = await api('createApp', { name: 'Forest', unitId: a.id, noRequest: true });
  const t = await api('createTask', { unitId: a.id, title: 'Иконка', appId: app.id });
  assert.equal(t.appId, app.id);
  await assert.rejects(() => api('createTask', { unitId: b.id, title: 'Чужое', appId: app.id }), /другого юнита/);
  await assert.rejects(() => api('createTask', { unitId: a.id, title: 'Нет такого', appId: 'app_none' }), /не найдено/);
  assert.equal((await api('createTask', { unitId: b.id, title: 'Без приложения' })).appId, '');
  // сменить и убрать приложение у задачи; чужой юнит — отказ; в истории — «Приложение»
  const { app: app2 } = await api('createApp', { name: 'Ocean', unitId: a.id, noRequest: true });
  assert.equal((await api('updateTask', { id: t.id, patch: { appId: app2.id } })).appId, app2.id);
  const { app: other } = await api('createApp', { name: 'Desert', unitId: b.id, noRequest: true });
  await assert.rejects(() => api('updateTask', { id: t.id, patch: { appId: other.id } }), /другого юнита/);
  assert.equal((await api('updateTask', { id: t.id, patch: { appId: '' } })).appId, '');
  const hist = (await api('getTaskExtras', { taskId: t.id })).activity;
  const row = hist.find(x => x.field === 'appId' && x.toText === '—');
  assert.ok(hist.some(x => x.label === 'Приложение' && x.fromText === 'Forest' && x.toText === 'Ocean'), 'смена приложения в истории');
  assert.ok(row && row.fromText === 'Ocean', 'убрали приложение — в истории');
});
