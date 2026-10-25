import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createBackend } from '../web/src/backend.js';
import { pgliteClient, AUTH_STUB_SQL, actAs } from '../web/src/pglite-client.js';

const SCHEMA = fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const UID = n => `00000000-0000-4000-8000-00000000000${n}`;

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
  /** Выполнить fn от имени человека (или системы, если person = null). */
  api.as = async (person, fn) => {
    await actAs(pg, person ? person.uid : null, person ? person.email : '');
    try { return await fn(); } finally { await actAs(pg, null); }
  };
  api.pg = pg;
  return api;
}

/** Команда: супер-админ, модератор, дизайнер и iOS-разработчик в юните A; юнит B без участников. */
async function team(api) {
  const mk = async (n, name, access, positionId) => {
    const p = await api('createPerson', { name, email: `u${n}@x.ru`, access, positionId });
    await api.pg.query('update people set user_id = $1 where id = $2', [UID(n), p.id]);
    return { ...p, uid: UID(n) };
  };
  const admin = await mk(1, 'Админ', 'superadmin', '');
  const mod = await mk(2, 'Модер', 'moderator', '');
  const designer = await mk(3, 'Дизайнер', 'member', 'd_design');
  const dev = await mk(4, 'Разраб', 'member', 'd_ios');
  const A = await api('createUnit', { name: 'Alpha', key: 'ALP' });
  const B = await api('createUnit', { name: 'Bravo', key: 'BRV' });
  await api('setMember', { unitId: A.id, personId: designer.id });
  await api('setMember', { unitId: A.id, personId: dev.id });
  const link = await api('createField', { unitId: A.id, name: 'Макет', type: 'url', required: true });
  const t1 = await api('createTask', { unitId: A.id, title: 'Макет экрана', assigneeId: designer.id });
  const t2 = await api('createTask', { unitId: A.id, title: 'Вёрстка', assigneeId: dev.id });
  const t3 = await api('createTask', { unitId: A.id, title: 'Иконка', departmentId: 'd_design' });
  return { admin, mod, designer, dev, A, B, link, t1, t2, t3 };
}

const forbidden = e => e.code === 'FORBIDDEN';

test('участник видит свои юниты и задачи своей позиции', async () => {
  const api = await setup();
  const { designer, A, B, t1, t2, t3 } = await team(api);
  assert.equal(t1.departmentId, 'd_design'); // отдел подставлен из позиции исполнителя
  await api.as(designer, async () => {
    const me = await api('whoami', {});
    assert.equal(me.id, designer.id);
    assert.equal(me.access, 'member');
    assert.deepEqual((await api('bootstrap', {})).units.map(u => u.key), ['ALP']);
    const board = await api('getBoard', { unitId: A.id });
    assert.deepEqual(board.tasks.map(t => t.id).sort(), [t1.id, t3.id].sort());
    assert.ok(!board.tasks.some(t => t.id === t2.id));
    await assert.rejects(() => api('getBoard', { unitId: B.id }), e => e.code === 'NOT_FOUND');
    assert.deepEqual((await api('queryTasks', { q: 'вёрстка' })).length, 0);
  });
});

test('участник: только свои задачи, обязательные поля перед переносом', async () => {
  const api = await setup();
  const { admin, designer, A, link, t1, t3 } = await team(api);
  await api.as(designer, async () => {
    await assert.rejects(() => api('createTask', { unitId: A.id, title: 'x' }), forbidden);
    await assert.rejects(() => api('updateTask', { id: t1.id, patch: { title: 'Новое' } }), forbidden);
    await assert.rejects(() => api('updateTask', { id: t1.id, patch: { dueDate: '2030-01-01' } }), forbidden);
    await assert.rejects(() => api('updateTask', { id: t1.id, patch: { status: 'in_progress' } }), e => e.code === 'RULE' && /Макет/.test(e.message));
    await api('updateTask', { id: t1.id, patch: { fields: { [link.id]: 'https://figma.com/x' }, checklist: [{ text: 'a' }] } });
    const moved = await api('updateTask', { id: t1.id, patch: { status: 'in_progress', order: 5 } });
    assert.equal(moved.status, 'in_progress');
    await assert.rejects(() => api('updateTask', { id: t3.id, patch: { status: 'done' } }), forbidden); // не своя
    await assert.rejects(() => api('deleteTask', { id: t1.id }), forbidden);
    await assert.rejects(() => api('deleteUnit', { id: A.id }), forbidden);

    // автора подставляет база, даже если браузер прислал чужой id
    const c = await api('addComment', { taskId: t1.id, text: 'готово' }, { actorId: admin.id });
    assert.equal(c.text, 'готово');
    await assert.rejects(() => api('addComment', { taskId: t3.id, text: 'x' }), forbidden);
  });
  const extras = await api('getTaskExtras', { taskId: t1.id });
  assert.equal(extras.comments[0].authorId, designer.id);
  assert.ok(extras.activity.filter(a => a.action === 'update').every(a => a.actorId === designer.id));
});

test('профили: свой профиль, роли меняет только супер-админ', async () => {
  const api = await setup();
  const { admin, mod, designer, dev } = await team(api);
  await api.as(designer, async () => {
    await api('updatePerson', { id: designer.id, name: 'Дизайнер Ира', color: '#ec4899' });
    await assert.rejects(() => api('updatePerson', { id: designer.id, access: 'superadmin' }), forbidden);
    await assert.rejects(() => api('updatePerson', { id: designer.id, positionId: 'd_ios' }), forbidden);
    await assert.rejects(() => api('updatePerson', { id: dev.id, name: 'x' }), forbidden);
    await assert.rejects(() => api('createPerson', { name: 'x' }), forbidden);
    // личная раскладка главной — только своя
    const prefs = await api('setMyPrefs', { personId: designer.id, prefs: { memberHome: { hidden: ['units'] } } });
    assert.deepEqual(prefs.memberHome.hidden, ['units']);
    await assert.rejects(() => api('setMyPrefs', { personId: dev.id, prefs: { x: 1 } }), forbidden);
  });
  await api.as(mod, async () => {
    await api('updatePerson', { id: designer.id, positionId: 'd_qa' });
    const p = await api('createPerson', { name: 'Новичок', positionId: 'd_aso' });
    assert.equal(p.access, 'member');
    await assert.rejects(() => api('updatePerson', { id: designer.id, access: 'moderator' }), forbidden);
    await assert.rejects(() => api('createPerson', { name: 'x', access: 'moderator' }), forbidden);
    await assert.rejects(() => api('updatePerson', { id: admin.id, name: 'x' }), forbidden);
    const u = await api('createUnit', { name: 'Charlie', key: 'CHR' }); // модератор управляет юнитами
    await api('setMember', { unitId: u.id, personId: dev.id });
  });
  await api.as(admin, async () => {
    await assert.rejects(() => api('updatePerson', { id: admin.id, access: 'member' }), e => e.code === 'RULE' && /последнего/.test(e.message));
    await api('updatePerson', { id: mod.id, access: 'superadmin' });
    await api('updatePerson', { id: admin.id, access: 'moderator' });
  });
});

test('вход: привязка профиля по email, первый вход в пустой сервис, чужой email', async () => {
  const api = await setup();
  // пустой сервис: первый вошедший — супер-админ
  const first = await api.as({ uid: UID(7), email: 'boss@x.ru' }, () => api('whoami', {}));
  assert.equal(first.access, 'superadmin');
  assert.equal(first.email, 'boss@x.ru');
  // заранее созданный профиль привязывается по email
  const p = await api('createPerson', { name: 'Ира', email: 'ira@x.ru', positionId: 'd_design' });
  const ira = await api.as({ uid: UID(8), email: 'IRA@x.ru' }, () => api('whoami', {}));
  assert.equal(ira.id, p.id);
  assert.equal(ira.linked, true);
  assert.equal(ira.access, 'member');
  // неизвестный email при наличии супер-админа — доступа нет
  assert.equal(await api.as({ uid: UID(9), email: 'stranger@x.ru' }, () => api('whoami', {})), null);
});
