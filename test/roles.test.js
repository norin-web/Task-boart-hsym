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

/** Команда: CEO (супер-админ), PM (модератор) юнита A, дизайнер и iOS-разработчик в юните A; юнит B без участников. */
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
  await api('setMember', { unitId: A.id, personId: mod.id }); // PM юнита A (B ему не виден)
  const link = await api('createField', { unitId: A.id, name: 'Макет', type: 'url', required: true });
  const t1 = await api('createTask', { unitId: A.id, title: 'Макет экрана', assigneeId: designer.id });
  const t2 = await api('createTask', { unitId: A.id, title: 'Вёрстка', assigneeId: dev.id });
  const t3 = await api('createTask', { unitId: A.id, title: 'Иконка', departmentId: 'd_design' });
  return { admin, mod, designer, dev, A, B, link, t1, t2, t3 };
}

const forbidden = e => e.code === 'FORBIDDEN';

test('участник видит свои юниты и только свои задачи', async () => {
  const api = await setup();
  const { designer, A, B, t1, t2, t3 } = await team(api);
  assert.equal(t1.departmentId, 'd_design'); // отдел подставлен из позиции исполнителя
  await api.as(designer, async () => {
    const me = await api('whoami', {});
    assert.equal(me.id, designer.id);
    assert.equal(me.access, 'member');
    assert.deepEqual((await api('bootstrap', {})).units.map(u => u.key), ['ALP']);
    const board = await api('getBoard', { unitId: A.id });
    assert.deepEqual(board.tasks.map(t => t.id), [t1.id]);  // t3 — той же позиции, но без исполнителя: чужая, t2 — чужая
    assert.ok(!board.tasks.some(t => t.id === t2.id || t.id === t3.id));
    await assert.rejects(() => api('getBoard', { unitId: B.id }), e => e.code === 'NOT_FOUND');
    assert.deepEqual((await api('queryTasks', { q: 'вёрстка' })).length, 0);
  });
});

test('PM: удаляет свой юнит, чужой не видит, новый не создаёт, общие поля не меняет', async () => {
  const api = await setup();
  const { mod, A, B } = await team(api);
  await api.as(mod, async () => {
    await assert.rejects(() => api('deleteUnit', { id: B.id }));
    await assert.rejects(() => api('createUnit', { name: 'Gamma', key: 'GAM' }));
    await assert.rejects(() => api('createField', { global: true, name: 'Общее', type: 'text' }));
    await api('deleteUnit', { id: A.id });
  });
  const left = await api.pg.query('select id from units');
  assert.deepEqual(left.rows.map(r => r.id), [B.id]);
});

test('ответственный за юнит: CEO может им быть, менять может только CEO, запросы идут ему', async () => {
  const api = await setup();
  const { admin, mod, A } = await team(api);
  // PM не меняет ответственного напрямую (база не даёт)
  await api.as(mod, async () => {
    await assert.rejects(() => api.pg.query('update units set pm_id = $1 where id = $2', [admin.id, A.id]), /только CEO/);
  });
  // CEO как ответственный: запросы по приложениям юнита идут ему, а не первому PM
  await api('setUnitPm', { unitId: A.id, personId: admin.id });
  assert.equal((await api.pg.query('select pm_id from units where id = $1', [A.id])).rows[0].pm_id, admin.id);
  const { request } = await api('createApp', { unitId: A.id, name: 'Пульт 1' });
  assert.equal(request.assigneeId, admin.id);
  // обратно на PM — работает
  await api('setUnitPm', { unitId: A.id, personId: mod.id });
  assert.equal((await api.pg.query('select unit_pm($1) as p', [A.id])).rows[0].p, mod.id);
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
    await assert.rejects(() => api('updateTask', { id: t3.id, patch: { status: 'done' } }), e => forbidden(e) || e.code === 'NOT_FOUND'); // не своя — её даже не видно
    await assert.rejects(() => api('deleteTask', { id: t1.id }), forbidden);
    await assert.rejects(() => api('deleteUnit', { id: A.id }), forbidden);

    // автора подставляет база, даже если браузер прислал чужой id
    const c = await api('addComment', { taskId: t1.id, text: 'готово' }, { actorId: admin.id });
    assert.equal(c.text, 'готово');
    await assert.rejects(() => api('addComment', { taskId: t3.id, text: 'x' }), e => forbidden(e) || e.code === 'NOT_FOUND');
  });
  const extras = await api('getTaskExtras', { taskId: t1.id });
  assert.equal(extras.comments[0].authorId, designer.id);
  assert.ok(extras.activity.filter(a => a.action === 'update').every(a => a.actorId === designer.id));
});

test('обязательное поле с колонки: нужно только при переносе в неё и правее', async () => {
  const api = await setup();
  const { admin, designer, A, link, t1 } = await team(api);
  await api('updateField', { id: link.id, requiredFrom: 'done' });
  await api.as(designer, async () => {
    const moved = await api('updateTask', { id: t1.id, patch: { status: 'in_progress' } });
    assert.equal(moved.status, 'in_progress');
    await api('updateTask', { id: t1.id, patch: { status: 'review' } }); // в «готово» — только из ревью
    await assert.rejects(() => api('updateTask', { id: t1.id, patch: { status: 'done' } }), e => e.code === 'RULE' && /Макет/.test(e.message));
    assert.equal((await api('updateTask', { id: t1.id, patch: { status: 'todo' } })).status, 'todo'); // назад — можно
  });
  await api.as(admin, async () => {
    assert.equal((await api('updateTask', { id: t1.id, patch: { status: 'done' } })).status, 'done'); // админа правило не держит
  });
  const f = (await api('getBoard', { unitId: A.id })).fields.find(x => x.id === link.id);
  assert.equal(f.requiredFrom, 'done');
});

test('ссылки: видимость по позициям проверяет база', async () => {
  const api = await setup();
  const { mod, designer, dev, A, B, t1, t2 } = await team(api);
  // Google Drive — только дизайнерам; Figma — всем
  await api('updateLinkField', { id: 'lf_drive', positions: ['d_design', 'нет-такой'] });
  await api.as(designer, async () => {
    await assert.rejects(() => api('updateLinkField', { id: 'lf_drive', positions: [] }), forbidden);
  });
  await api.as(mod, async () => {
    await assert.rejects(() => api('createLinkField', { name: 'Jira' }), forbidden); // набор — только супер-админ
    await api('setTaskLink', { taskId: t2.id, fieldId: 'lf_drive', url: 'drive.google.com/x' });
    await api('setTaskLink', { taskId: t2.id, fieldId: 'lf_figma', url: 'https://figma.com/f' });
    await assert.rejects(() => api('setTaskLink', { taskId: t2.id, fieldId: 'lf_figma', url: 'javascript:alert(1)' }));
  });
  const drive = (await api('bootstrap', {})).linkFields.find(f => f.id === 'lf_drive');
  assert.deepEqual(drive.positions, ['d_design']);
  await api.as(dev, async () => {
    const t = (await api('getBoard', { unitId: A.id })).tasks.find(x => x.id === t2.id);
    assert.deepEqual(t.links, { lf_figma: 'https://figma.com/f' }); // Drive разработчику не уходит вовсе
    await assert.rejects(() => api('setTaskLink', { taskId: t2.id, fieldId: 'lf_drive', url: 'https://x.ru' }), forbidden);
    await api('setTaskLink', { taskId: t2.id, fieldId: 'lf_figma', url: '' }); // своя задача, видимое поле
    const hist = (await api('getTaskExtras', { taskId: t2.id })).activity.filter(a => a.field.startsWith('link:'));
    assert.ok(hist.length >= 2 && hist.every(a => !/drive\.google|figma\.com/.test(a.toText + a.fromText)));
  });
  await api.as(designer, async () => {
    await assert.rejects(() => api('setTaskLink', { taskId: t2.id, fieldId: 'lf_figma', url: 'https://x.ru' })); // чужая задача
    await api('setTaskLink', { taskId: t1.id, fieldId: 'lf_drive', url: 'https://drive.google.com/d' });
  });
  await api('moveTask', { id: t1.id, unitId: B.id });
  const moved = (await api('getBoard', { unitId: B.id })).tasks.find(x => x.id === t1.id);
  assert.equal(moved.links.lf_drive, 'https://drive.google.com/d');
  await api('deleteLinkField', { id: 'lf_drive' });
  assert.ok(!(await api('bootstrap', {})).linkFields.some(f => f.id === 'lf_drive'));
});

test('уведомления о назначении и онлайн-метка', async () => {
  const api = await setup();
  const { admin, designer, dev, A } = await team(api);
  // team() назначала задачи системой — начинаем с чистого листа
  await api.as(designer, () => api('readNotifications', {}));
  await api.as(dev, () => api('readNotifications', {}));
  let t;
  await api.as(admin, async () => {
    t = await api('createTask', { unitId: A.id, title: 'Новая иконка', assigneeId: designer.id });
    await api('createTask', { unitId: A.id, title: 'Сам себе', assigneeId: admin.id });
  });
  await api.as(designer, async () => {
    const list = (await api('getNotifications', {})).filter(n => !n.read);
    assert.deepEqual(list.map(n => [n.taskId, n.actorId, n.key]), [[t.id, admin.id, 'ALP-' + t.num]]);
    assert.equal((await api('heartbeat', {})).unread, 1);
  });
  await api.as(admin, async () => {
    assert.equal((await api('getNotifications', {})).filter(n => !n.read).length, 0); // себе не уведомляем
    await api('updateTask', { id: t.id, patch: { assigneeId: dev.id } }); // переназначили — у дизайнера снялось
  });
  await api.as(designer, async () => {
    assert.equal((await api('getNotifications', {})).filter(n => !n.read).length, 0);
  });
  await api.as(dev, async () => {
    assert.equal((await api('getNotifications', {})).filter(n => !n.read)[0].taskId, t.id);
    assert.equal(await api('readNotifications', { taskId: t.id }), 1);
    assert.equal((await api('heartbeat', {})).unread, 0);
    const hb = await api('heartbeat', {});
    assert.ok(hb.seen[dev.id] > '2020');
    assert.equal(hb.seen[designer.id] > '2020', true); // дизайнер тоже заходил выше
    assert.equal(hb.seen[admin.id] || '', ''); // админ heartbeat не слал
  });
  // чужие уведомления не видны и не отмечаются
  await api.as(admin, () => api('createTask', { unitId: A.id, title: 'Ещё', assigneeId: dev.id }));
  await api.as(designer, async () => {
    assert.equal((await api('getNotifications', {})).filter(n => !n.read).length, 0);
    assert.equal(await api('readNotifications', {}), 0);
  });
  assert.equal((await api.as(dev, () => api('getNotifications', {}))).filter(n => !n.read).length, 1);
});

test('несколько позиций, приоритет — только админы, удаление человека', async () => {
  const api = await setup();
  const { admin, mod, designer, dev, A, t1, t2, link } = await team(api);
  // дополнительная позиция задачи другой позиции не открывает: сотрудник видит только свои
  const po = await api('createTask', { unitId: A.id, title: 'Roadmap', departmentId: 'd_po' });
  await api.as(designer, async () => {
    assert.ok(!(await api('getBoard', { unitId: A.id })).tasks.some(t => t.id === po.id));
  });
  await api('updatePerson', { id: designer.id, extraPositionIds: ['d_po'] });
  await api.as(designer, async () => {
    assert.ok(!(await api('getBoard', { unitId: A.id })).tasks.some(t => t.id === po.id));
    await assert.rejects(() => api('updatePerson', { id: designer.id, extraPositionIds: [] }), forbidden);
  });

  // приоритет — одно общее поле на все юниты, «только администраторы»
  const other = await api('createField', { unitId: A.id, name: 'Срочность', type: 'select', role: 'priority', options: [{ id: 'x', name: 'x', color: '#000' }] });
  assert.equal(other.role, ''); // своё поле юнита приоритетом не становится
  const fields = (await api('getBoard', { unitId: A.id })).fields;
  const prio = fields.find(f => f.role === 'priority');
  assert.ok(prio.global && prio.staffOnly);
  assert.deepEqual(fields.filter(f => f.role === 'priority').map(f => f.id), [prio.id]);
  await api.as(designer, async () => {
    assert.ok((await api('getBoard', { unitId: A.id })).fields.some(f => f.id === prio.id)); // участник видит общее поле
    await assert.rejects(() => api('updateTask', { id: t1.id, patch: { fields: { [prio.id]: 'o_high' } } }), forbidden);
  });
  await api.as(mod, () => api('updateTask', { id: t1.id, patch: { fields: { [prio.id]: 'o_high' } } }));
  // общее обязательное поле «с типа колонки»: в «в работе» можно, в «готово» — только заполнив
  const ch = await api('createField', { global: true, name: 'Канал', type: 'text', required: true, requiredFrom: 'done' });
  await api.as(designer, async () => {
    await api('updateTask', { id: t1.id, patch: { fields: { [link.id]: 'https://figma.com/x' } } });
    await api('updateTask', { id: t1.id, patch: { status: 'in_progress' } });
    await api('updateTask', { id: t1.id, patch: { status: 'review' } }); // в «готово» — только из ревью
    await assert.rejects(() => api('updateTask', { id: t1.id, patch: { status: 'done' } }), /Канал/);
    await api('updateTask', { id: t1.id, patch: { fields: { [ch.id]: 'tg' } } });
    await api('updateTask', { id: t1.id, patch: { status: 'done' } });
  });
  await api('deleteField', { id: ch.id });

  // удаление человека: только супер-админ, задачи остаются без исполнителя
  await api.as(mod, async () => {
    await assert.rejects(() => api('deletePerson', { id: dev.id }), forbidden);
  });
  await api.as(admin, async () => {
    await assert.rejects(() => api('deletePerson', { id: admin.id }), /самого себя/);
    await api('deletePerson', { id: dev.id });
  });
  const b = await api('getBoard', { unitId: A.id });
  assert.equal(b.tasks.find(t => t.id === t2.id).assigneeId, '');
  assert.ok(!b.people.some(p => p.id === dev.id));
  assert.ok(!b.members.some(m => m.personId === dev.id));
});

test('ревью: ревьюер по позиции из настроек юнита важнее того, кто поставил задачу (PM)', async () => {
  const api = await setup();
  const { mod, designer, dev, A, link } = await team(api);
  await api('updateField', { id: link.id, required: false });
  const st = (await api('getBoard', { unitId: A.id })).unit.settings;
  const prog = st.columns.find(c => c.kind === 'progress').id;
  await api('updateUnit', { id: A.id, settings: { ...st, review: { column: st.review.column || 'review', byPosition: { d_ios: designer.id }, default: '' } } });
  const board = (await api('getBoard', { unitId: A.id })).unit.settings;
  const t = await api.as(mod, () => api('createTask', { unitId: A.id, title: 'От PM', assigneeId: dev.id, status: prog, departmentId: 'd_ios' }));
  assert.equal(t.reviewerId, '');
  const moved = await api.as(dev, () => api('updateTask', { id: t.id, patch: { status: board.review.column } }));
  assert.equal(moved.assigneeId, designer.id);
});

test('ревью: автоназначение ревьюера по позиции и возврат исполнителю', async () => {
  const api = await setup();
  const { mod, designer, dev, A, link, t1, t2 } = await team(api);
  await api('updateField', { id: link.id, required: false });
  const st = (await api('getBoard', { unitId: A.id })).unit.settings;
  st.columns.splice(2, 0, { id: 'review', name: 'Review', kind: 'progress', color: '' });
  delete st.review;
  let u = await api('updateUnit', { id: A.id, settings: st });
  assert.equal(u.settings.review.column, 'review'); // угадали по названию
  u = await api('updateUnit', { id: A.id, settings: { ...u.settings, review: { column: 'review', byPosition: { d_ios: designer.id }, default: mod.id } } });
  assert.deepEqual(u.settings.review.byPosition, { d_ios: designer.id });

  // разработчик сдаёт задачу на ревью → она на дизайнере (ревьюер iOS), разработчик её по-прежнему видит
  await api.as(dev, async () => {
    const t = await api('updateTask', { id: t2.id, patch: { status: 'review' } });
    assert.equal(t.assigneeId, designer.id);
    assert.equal(t.reviewFrom, dev.id);
    assert.equal(t.departmentId, 'd_ios'); // позиция задачи не меняется
    assert.ok((await api('getBoard', { unitId: A.id })).tasks.some(x => x.id === t2.id));
    await assert.rejects(() => api('updateTask', { id: t2.id, patch: { status: 'done' } }), forbidden); // теперь не его
  });
  // ревьюер — обычный участник другой позиции: видит, двигает, задача возвращается исполнителю
  await api.as(designer, async () => {
    assert.equal((await api('getNotifications', {})).filter(n => !n.read).filter(n => n.taskId === t2.id).length, 1);
    const t = await api('updateTask', { id: t2.id, patch: { status: 'done' } });
    assert.equal(t.assigneeId, dev.id);
    assert.equal(t.reviewFrom, '');
    assert.equal(t.reviewerId, designer.id);
  });
  const hist = (await api('getTaskExtras', { taskId: t2.id })).activity.filter(a => a.field === 'assigneeId').map(a => a.toText);
  assert.deepEqual(hist.slice(0, 2), ['Разраб', 'Дизайнер']);

  // отправил на ревью и передумал — забирает обратно (только он)
  await api.as(dev, async () => {
    await api('updateTask', { id: t2.id, patch: { status: 'review' } });
    await api('readNotifications', {});
  });
  await api.as(mod, async () => {
    await assert.rejects(() => api('recallReview', { id: t2.id }), forbidden);
  });
  await api.as(dev, async () => {
    const back = await api('recallReview', { id: t2.id });
    assert.equal(back.status, 'in_progress'); // колонка перед Review
    assert.equal(back.assigneeId, dev.id);
    assert.equal((await api('getNotifications', {})).filter(n => !n.read).length, 0); // сам себе — без уведомления
    await assert.rejects(() => api('recallReview', { id: t2.id }), /уже не на ревью/);
  });
  await api.as(designer, async () => {
    assert.equal((await api('getNotifications', {})).filter(n => !n.read).filter(n => n.taskId === t2.id).length, 0); // у ревьюера снялось
  });
  // отправленное на ревью видно на дашборде автора
  await api.as(dev, () => api('updateTask', { id: t2.id, patch: { status: 'review' } }));
  await api.as(dev, async () => {
    const d = await api('getMyDashboard', { personId: dev.id, today: '2026-11-02' });
    assert.ok(d.sent.some(x => x.id === t2.id && x.reviewerId === designer.id));
  });
  await api.as(dev, () => api('recallReview', { id: t2.id }));
  // ревьюер вернул на доработку — «вернули»
  await api.as(dev, () => api('updateTask', { id: t2.id, patch: { status: 'review' } }));
  await api.as(designer, () => api('updateTask', { id: t2.id, patch: { status: 'in_progress' } }));
  await api.as(dev, async () => {
    assert.equal((await api('getNotifications', {})).filter(n => !n.read).find(x => x.taskId === t2.id).kind, 'returned');
    await api('readNotifications', {});
  });
  // снова на ревью и возврат ревьюером — для проверки ниже
  await api.as(dev, () => api('updateTask', { id: t2.id, patch: { status: 'review' } }));
  await api.as(designer, () => api('updateTask', { id: t2.id, patch: { status: 'done' } }));

  // ревьюер перенёс в «готово» — исполнителю «закрыта по ревью», а не «вернули»
  await api.as(dev, async () => {
    const n = (await api('getNotifications', {})).filter(n => !n.read).find(x => x.taskId === t2.id);
    assert.equal(n.kind, 'approved');
    assert.equal(n.actorId, designer.id);
  });
  // дизайнерская задача → ревьюер по умолчанию (модератор)
  await api.as(designer, async () => {
    assert.equal((await api('updateTask', { id: t1.id, patch: { status: 'review' } })).assigneeId, mod.id);
  });
  // модератор сам перенёс задачу на ревью, а ревьюер — он же: уведомление всё равно приходит
  await api.as(mod, async () => {
    await api('updateTask', { id: t1.id, patch: { status: 'in_progress' } });
    const own = await api('createTask', { unitId: A.id, title: 'Своя', assigneeId: designer.id, departmentId: 'd_qa' });
    await api('updateTask', { id: own.id, patch: { status: 'review' } });
    const n = (await api('getNotifications', {})).filter(n => !n.read).find(x => x.taskId === own.id);
    assert.equal(n && n.kind, 'review');
  });
});

test('чеклист перед «готово» и поля, обязательные при создании', async () => {
  const api = await setup();
  const { designer, A, link, t1 } = await team(api);
  await api('updateField', { id: link.id, required: false });
  const st = (await api('getBoard', { unitId: A.id })).unit.settings;
  assert.equal(st.checklistBeforeDone, false);
  await api('updateUnit', { id: A.id, settings: { ...st, checklistBeforeDone: true } });
  await api.as(designer, async () => {
    await api('updateTask', { id: t1.id, patch: { checklist: [{ text: 'a' }, { text: 'b', done: true }] } });
    await api('updateTask', { id: t1.id, patch: { status: 'review' } }); // в «готово» — только из ревью
    await assert.rejects(() => api('updateTask', { id: t1.id, patch: { status: 'done' } }), e => e.code === 'RULE' && /чеклист/.test(e.message));
    const cl = (await api('getBoard', { unitId: A.id })).tasks.find(t => t.id === t1.id).checklist.map(i => ({ ...i, done: true }));
    await api('updateTask', { id: t1.id, patch: { checklist: cl } });
    assert.equal((await api('updateTask', { id: t1.id, patch: { status: 'done' } })).status, 'done');
  });

  const ch = await api('createField', { unitId: A.id, name: 'Канал', type: 'text', requiredOnCreate: true });
  assert.equal(ch.requiredOnCreate, true);
  await assert.rejects(() => api.as({ uid: '00000000-0000-4000-8000-000000000001', email: 'u1@x.ru' }, () =>
    api('createTask', { unitId: A.id, title: 'Без канала' })), e => e.code === 'RULE' && /Канал/.test(e.message));
  const ok = await api.as({ uid: '00000000-0000-4000-8000-000000000001', email: 'u1@x.ru' }, () =>
    api('createTask', { unitId: A.id, title: 'С каналом', fields: { [ch.id]: 'ASO' } }));
  assert.equal(ok.fields[ch.id], 'ASO');
});

test('уведомления о сроках: просрочено и срок скоро — по одному на срок', async () => {
  const api = await setup();
  const { designer, dev, t1, t2 } = await team(api);
  await api('updateTask', { id: t1.id, patch: { dueDate: '2026-10-20' } }); // просрочена
  await api('updateTask', { id: t2.id, patch: { dueDate: '2026-10-26' } }); // завтра
  const today = '2026-10-25';
  await api.as(designer, async () => {
    await api('readNotifications', {});
    await api('heartbeat', { today });
    await api('heartbeat', { today }); // повторный пульс не дублирует
    const n = await api('getNotifications', { today });
    assert.deepEqual(n.map(x => [x.taskId, x.kind, x.ref]), [[t1.id, 'overdue', '2026-10-20']]);
    await api('readNotifications', {});
    assert.equal((await api('getNotifications', { today })).filter(n => !n.read).length, 0); // прочитано — не возвращается
  });
  await api.as(dev, async () => {
    await api('readNotifications', {});
    assert.deepEqual((await api('getNotifications', { today })).filter(n => !n.read).map(x => x.kind), ['due_soon']);
    assert.deepEqual((await api('getNotifications', { today: '2026-10-27' })).filter(n => !n.read).map(x => x.kind), ['overdue']); // «скоро» заменено
  });
  await api('updateTask', { id: t1.id, patch: { dueDate: '2026-10-22' } }); // новый срок — новое уведомление
  await api.as(designer, async () => {
    assert.equal((await api('getNotifications', { today })).filter(n => !n.read).length, 1);
  });
  await api('updateTask', { id: t2.id, patch: { status: 'done' } });
  await api.as(dev, async () => {
    await api('readNotifications', {});
    assert.equal((await api('getNotifications', { today: '2026-11-01' })).filter(n => !n.read).length, 0); // выполненные не напоминают
  });
});

test('шаблоны задач: ведут администраторы, видят все', async () => {
  const api = await setup();
  const { mod, designer, A } = await team(api);
  const tpl = await api.as(mod, () => api('saveTemplate', {
    name: 'Релиз', title: 'Релиз X.Y', departmentId: 'd_release', dueDays: 7, checklist: [{ text: 'Сборка' }, { text: 'Скрины' }],
  }));
  assert.equal(tpl.dueDays, 7);
  await assert.rejects(() => api('saveTemplate', { id: tpl.id, name: 'Релиз', links: { lf_github: 'javascript:1' } }), /https/);
  const withLinks = await api('saveTemplate', { id: tpl.id, name: 'Релиз', assigneeId: designer.id,
    links: { lf_figma: 'figma.com/file/x', lf_nope: 'https://a.b', lf_github: '' } });
  assert.equal(withLinks.assigneeId, designer.id);
  assert.deepEqual(withLinks.links, { lf_figma: 'https://figma.com/file/x' });
  assert.deepEqual(tpl.checklist.map(i => i.text), ['Сборка', 'Скрины']);
  await api.as(designer, async () => {
    assert.equal((await api('bootstrap', {})).templates[0].name, 'Релиз');
    await assert.rejects(() => api('saveTemplate', { name: 'x' }), forbidden);
    await assert.rejects(() => api('deleteTemplate', { id: tpl.id }), forbidden);
  });
  const upd = await api('saveTemplate', { id: tpl.id, name: 'Релиз iOS', dueDays: 99 });
  assert.equal(upd.name, 'Релиз iOS');
  assert.equal(upd.dueDays, -1); // неизвестный срок — без срока
  const t = await api('createTask', { unitId: A.id, title: 'Релиз 3.5', checklist: tpl.checklist, departmentId: tpl.departmentId });
  assert.equal(t.checklist.length, 2);
  await api('deleteTemplate', { id: tpl.id });
  assert.equal((await api('bootstrap', {})).templates.length, 0);
});

test('команды: у человека несколько, видимость задач команды', async () => {
  const api = await setup();
  const { mod, designer, dev, A, t2 } = await team(api);
  assert.deepEqual((await api('bootstrap', {})).teams.map(t => t.name),
    ['Product Team', 'UX/UI Designers', 'iOS Development', 'QA Team', 'Release Managers', 'ASO', 'Other']);
  assert.deepEqual(designer.teamIds, ['t_other']); // по умолчанию — Other
  // задача iOS-команды с позицией QA: дизайнер её не видит — ни до, ни после вступления в команду
  const t = await api('createTask', { unitId: A.id, title: 'Сборка', departmentId: 'd_qa', teamId: 't_ios' });
  assert.equal(t.teamId, 't_ios');
  await api.as(designer, async () => {
    assert.ok(!(await api('getBoard', { unitId: A.id })).tasks.some(x => x.id === t.id));
    await assert.rejects(() => api('updatePerson', { id: designer.id, teamIds: ['t_ios'] }), forbidden);
  });
  const p = await api('updatePerson', { id: designer.id, teamIds: ['t_design', 't_ios', 'нет'] });
  assert.deepEqual(p.teamIds, ['t_design', 't_ios']);
  await api.as(designer, async () => {
    assert.ok(!(await api('getBoard', { unitId: A.id })).tasks.some(x => x.id === t.id));  // команда видимости сотруднику не добавляет
  });
  // команду задачи меняет администратор, участник — нет
  await api.as(dev, async () => {
    await assert.rejects(() => api('updateTask', { id: t2.id, patch: { teamId: 't_qa' } }), forbidden);
  });
  await api.as(mod, () => api('updateTask', { id: t2.id, patch: { teamId: 't_qa' } }));
  const hist = (await api('getTaskExtras', { taskId: t2.id })).activity.find(a => a.field === 'teamId');
  assert.equal(hist.toText, 'QA Team');
  // свои команды: создать, удалить — у людей и задач пропадает
  const growth = await api('createTeam', { name: 'Growth' });
  await api('updatePerson', { id: dev.id, teamIds: [growth.id] });
  await api('deleteTeam', { id: 't_ios' });
  const ppl = (await api('bootstrap', {})).people;
  assert.deepEqual(ppl.find(x => x.id === designer.id).teamIds, ['t_design']);
  assert.equal((await api('getBoard', { unitId: A.id })).tasks.find(x => x.id === t.id).teamId, '');
  await api.as(designer, async () => {
    await assert.rejects(() => api('createTeam', { name: 'x' }), forbidden);
  });
});

test('личная доска: шаблоны этапов команд, только свои задачи и своё положение', async () => {
  const api = await setup();
  const { admin, mod, designer, dev, A, t1, t2 } = await team(api);
  const teams = (await api('bootstrap', {})).teams;
  assert.deepEqual(teams.find(t => t.id === 't_design').boardTemplate.map(c => c.name),
    ['To do', 'Design in Progress', 'Review', 'Text', 'Google Drive', 'Done']);
  assert.deepEqual(teams.find(t => t.id === 't_release').boardTemplate.map(c => c.kind), ['todo', 'progress', 'progress', 'progress', 'done']);
  // шаблон меняют админы; пустой — нельзя
  await api.as(designer, async () => {
    await assert.rejects(() => api('updateTeam', { id: 't_design', boardTemplate: [{ name: 'x', kind: 'todo' }] }), forbidden);
  });
  await assert.rejects(() => api('updateTeam', { id: 't_design', boardTemplate: [] }), /хотя бы один/);
  await api.as(mod, async () => { await assert.rejects(() => api('updateTeam', { id: 't_qa', boardTemplate: [{ name: 'x', kind: 'todo' }] }), forbidden); }); // команды меняет только CEO
  const upd = await api.as(admin, () => api('updateTeam', { id: 't_qa', boardTemplate: [{ name: 'Очередь', kind: 'todo' }, { name: 'Ок', kind: 'done', id: 'BAD id' }] }));
  assert.deepEqual(upd.boardTemplate.map(c => c.id), ['s1', 's2']);

  await api.as(designer, async () => {
    const b = await api('getMyBoard', { personId: designer.id });
    assert.deepEqual(b.tasks.map(t => t.id), [t1.id]); // только свои
    assert.equal(b.units[0].id, A.id);
    await api('setMyBoardItem', { personId: designer.id, taskId: t1.id, stage: 's2', order: 3 });
    assert.deepEqual((await api('getMyBoard', { personId: designer.id })).placement[t1.id], { stage: 's2', order: 3 });
    await assert.rejects(() => api('setMyBoardItem', { personId: dev.id, taskId: t2.id, stage: 's1' }), forbidden); // чужая доска
  });
  await api.as(dev, async () => {
    assert.deepEqual((await api('getMyBoard', { personId: dev.id })).placement, {}); // положение дизайнера не видно
    assert.deepEqual((await api('getMyBoard', { personId: designer.id })).placement, {});
  });
});

test('профили: свой профиль, роли меняет только супер-админ', async () => {
  const api = await setup();
  const { admin, mod, designer, dev, B } = await team(api);
  await api.as(designer, async () => {
    await api('updatePerson', { id: designer.id, name: 'Дизайнер Ира', color: '#ec4899' });
    // аватар — свой: маскот или фото data:image; чужое (ссылки, скрипты) не сохраняется
    assert.equal((await api('updatePerson', { id: designer.id, avatar: 'preset:design-2' })).avatar, 'preset:design-2');
    assert.equal((await api('updatePerson', { id: designer.id, avatar: 'data:image/webp;base64,UklGRg==' })).avatar, 'data:image/webp;base64,UklGRg==');
    assert.equal((await api('updatePerson', { id: designer.id, avatar: 'https://evil.example/a.png' })).avatar, '');
    assert.equal((await api('updatePerson', { id: designer.id, avatar: 'data:image/svg+xml;base64,PHN2Zz4=' })).avatar, '');
    // карточка сотрудника: Telegram без @, часовой пояс IANA
    const card = await api('updatePerson', { id: designer.id, telegram: 'https://t.me/ira_design', timezone: 'Europe/Moscow' });
    assert.deepEqual([card.telegram, card.timezone], ['ira_design', 'Europe/Moscow']);
    assert.equal((await api('updatePerson', { id: designer.id, telegram: '@ira_design2' })).telegram, 'ira_design2');
    await assert.rejects(() => api('updatePerson', { id: designer.id, telegram: 'не ник' }));
    assert.equal((await api('updatePerson', { id: designer.id, timezone: 'x; drop' })).timezone, '');
    await assert.rejects(() => api('updatePerson', { id: designer.id, access: 'superadmin' }), forbidden);
    await assert.rejects(() => api('updatePerson', { id: designer.id, positionId: 'd_ios' }), forbidden);
    await assert.rejects(() => api('updatePerson', { id: dev.id, name: 'x' }), forbidden);
    await assert.rejects(() => api('createPerson', { name: 'x' }), forbidden);
    // личная раскладка главной — только своя
    const prefs = await api('setMyPrefs', { personId: designer.id, prefs: { memberHome: { hidden: ['units'] } } });
    assert.deepEqual(prefs.memberHome.hidden, ['units']);
    // две записи разом не затирают друг друга
    await Promise.all([api('setMyPrefs', { personId: designer.id, prefs: { watch: [] } }), api('setMyPrefs', { personId: designer.id, prefs: { myHome: { order: [] } } })]);
    const both = await api('setMyPrefs', { personId: designer.id, prefs: {} });
    assert.deepEqual([both.watch, both.myHome, both.memberHome.hidden], [[], { order: [] }, ['units']]);
    await assert.rejects(() => api('setMyPrefs', { personId: dev.id, prefs: { x: 1 } }), forbidden);
  });
  await api.as(mod, async () => {
    // людей, позиции и доступы PM не меняет — только CEO
    await assert.rejects(() => api('updatePerson', { id: designer.id, positionId: 'd_qa' }), forbidden);
    await assert.rejects(() => api('createPerson', { name: 'Новичок', positionId: 'd_aso' }), forbidden);
    await assert.rejects(() => api('updatePerson', { id: designer.id, access: 'moderator' }), forbidden);
    await assert.rejects(() => api('createPerson', { name: 'x', access: 'moderator' }), forbidden);
    await assert.rejects(() => api('updatePerson', { id: admin.id, name: 'x' }), forbidden);
    // PM управляет своими юнитами, но не создаёт новые и не трогает чужие
    await assert.rejects(() => api('createUnit', { name: 'Charlie', key: 'CHR' }), forbidden);
    await assert.rejects(() => api('setMember', { unitId: B.id, personId: dev.id }), e => e.code === 'NOT_FOUND' || forbidden(e));
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

test('«нужно при создании» — для задач вручную; этапы запроса и дубли создаются', async () => {
  const api = await setup();
  const { admin, mod, A, t1 } = await team(api);
  const brief = await api('createField', { global: true, name: 'Бриф', type: 'text', requiredOnCreate: true });
  await api.as(mod, async () => {
    await assert.rejects(() => api('createTask', { unitId: A.id, title: 'Без брифа' }), /Бриф/);
    const copy = await api('duplicateTask', { id: t1.id });
    assert.equal(copy.title, 'Макет экрана (копия)');
    assert.equal(copy.assigneeId, t1.assigneeId);
    assert.equal(copy.reviewFrom, '');
    const full = await api('createTask', { unitId: A.id, title: 'С брифом', fields: { [brief.id]: 'есть' } });
    assert.equal(full.fields[brief.id], 'есть');
  });
  // этапы запроса CEO — дочерние задачи, создаются без брифа
  const { request } = await api.as(admin, () => api('createApp', { name: 'App', unitId: A.id }));
  assert.ok((await api.as(mod, () => api('decomposeRequest', { taskId: request.id }))).length > 0);
});

test('история: участник пишет только про свои задачи', async () => {
  const api = await setup();
  const { designer, A, link, t1, t2 } = await team(api);
  await api('updateField', { id: link.id, required: false });
  await api.as(designer, async () => {
    const ins = (task, unit) => api.pg.query(
      `insert into activity (id, unit_id, task_id, action, field, from_val, to_val, at) values ($1, $2, $3, 'update', 'status', '"todo"', '"done"', '2026-01-01')`,
      ['a_' + Math.random().toString(36).slice(2), unit, task]);
    await assert.rejects(() => ins(t2.id, A.id), /row-level security/); // чужая задача
    await assert.rejects(() => ins('', A.id), /row-level security/); // запись юнита
    await ins(t1.id, A.id); // своя
    await api('updateTask', { id: t1.id, patch: { status: 'in_progress' } }); // обычный путь пишет историю
  });
  const hist = (await api('getTaskExtras', { taskId: t1.id })).activity.filter(a => a.field === 'status');
  assert.ok(hist.length >= 2);
});

test('приложения видят только CEO, PM и RM: Lead и сотрудник не получают их из базы', async () => {
  const api = await setup();
  const { admin, mod, dev, A } = await team(api);
  const lead = await api('createPerson', { name: 'Лид', email: 'u5@x.ru', access: 'lead', positionId: 'd_ios' });
  await api.pg.query('update people set user_id = $1 where id = $2', [UID(5), lead.id]);
  await api('setMember', { unitId: A.id, personId: lead.id });
  await api.as(admin, () => api('createApp', { name: 'Forest', unitId: A.id }));
  assert.equal((await api.as(mod, () => api('listApps', {}))).length, 1);
  assert.equal((await api.as(dev, () => api('listApps', {}))).length, 0);
  assert.equal((await api.as({ ...lead, uid: UID(5) }, () => api('listApps', {}))).length, 0);
});

test('раздача: подзадача уходит на ревью к ревьюеру позиции из настроек юнита', async () => {
  const api = await setup();
  const { mod, designer, A, link } = await team(api);
  const lead = await api('createPerson', { name: 'Лид', email: 'u6@x.ru', access: 'lead', positionId: 'd_design' });
  await api.pg.query('update people set user_id = $1 where id = $2', [UID(6), lead.id]);
  await api('setMember', { unitId: A.id, personId: lead.id });
  const L = { ...lead, uid: UID(6) };
  const st = (await api('getBoard', { unitId: A.id })).unit.settings;
  await api('updateUnit', { id: A.id, settings: { ...st, review: { ...st.review, byPosition: { d_design: lead.id }, default: '' } } });
  const prog = st.columns.find(c => c.kind === 'progress').id;
  const stage = await api.as(mod, () => api('createTask', { unitId: A.id, title: 'Дизайн', assigneeId: lead.id, status: prog }));
  const [part] = await api.as(L, () => api('splitTask', { taskId: stage.id, items: [{ title: 'Онбординг', assigneeId: designer.id }] }));
  await api.as(designer, () => api('updateTask', { id: part.id, patch: { fields: { [link.id]: 'https://figma.com/x' }, status: st.review.column } }));
  const { rows } = await api.pg.query('select assignee_id from tasks where id = $1', [part.id]);
  assert.equal(rows[0].assignee_id, lead.id); // на ревью у лида
  await api.as(L, () => api('reviewDecision', { taskId: part.id, approve: true }));
  const { rows: st2 } = await api.pg.query('select status from tasks where id = $1', [stage.id]);
  assert.equal(st.columns.find(c => c.id === st2[0].status).kind, 'done'); // этап закрылся сам
});


test('PM видит только приложения из своего списка, CEO его настраивает', async () => {
  const api = await setup();
  const { admin, mod, designer, A } = await team(api);
  const a1 = (await api.as(admin, () => api('createApp', { name: 'Первое', unitId: A.id, noRequest: true }))).app;
  const a2 = (await api.as(admin, () => api('createApp', { name: 'Второе', unitId: A.id, noRequest: true }))).app;
  const names = async () => (await api('listApps', {})).map(a => a.name).sort();
  // новое приложение сразу попадает в список PM юнита
  assert.deepEqual(await api.as(mod, names), ['Второе', 'Первое']);
  // CEO оставляет PM одно приложение
  await api.as(admin, () => api('setPmApps', { personId: mod.id, appIds: [a1.id] }));
  assert.deepEqual(await api.as(mod, names), ['Первое']);
  assert.deepEqual(await api.as(admin, names), ['Второе', 'Первое']);
  // задача по скрытому приложению PM не видна
  await api.as(admin, () => api('createTask', { unitId: A.id, title: 'Скрытая', appId: a2.id }));
  await api.as(admin, () => api('createTask', { unitId: A.id, title: 'Видимая', appId: a1.id }));
  const titles = async () => (await api('getBoard', { unitId: A.id })).tasks.map(t => t.title);
  const seen = await api.as(mod, titles);
  assert.ok(seen.includes('Видимая') && !seen.includes('Скрытая'));
  // менять список может только CEO; список видит только CEO
  await assert.rejects(api.as(mod, () => api('setPmApps', { personId: mod.id, appIds: [a1.id, a2.id] })), forbidden);
  await assert.rejects(api.as(designer, () => api('setPmApps', { personId: mod.id, appIds: [] })), forbidden);
  assert.deepEqual((await api.as(admin, () => api('getPmApps', {})))[mod.id], [a1.id]);
  // пустой список — PM не видит приложений; заметки и история статусов тоже закрыты
  await api.as(admin, () => api('setPmApps', { personId: mod.id, appIds: [] }));
  assert.deepEqual(await api.as(mod, names), []);
  await assert.rejects(api.as(admin, () => api('setPmApps', { personId: designer.id, appIds: [] })));
  // запрос CEO по новому приложению, поставленный на PM, открывает ему это приложение
  const a3 = (await api.as(admin, () => api('createApp', { name: 'Третье', unitId: A.id, pmId: mod.id }))).app;
  assert.ok((await api.as(mod, names)).includes('Третье'));
  assert.ok(a3.id);
});

test('Lead: видит и ведёт только свою зону — позиции + выданные люди', async () => {
  const api = await setup();
  const { admin, mod, designer, dev, A, t2, t3 } = await team(api);
  const lead = await api('createPerson', { name: 'Лид дизайна', email: 'lead@x.ru', access: 'lead', positionId: 'd_design' });
  await api.pg.query('update people set user_id = $1 where id = $2', [UID(7), lead.id]);
  const L = { ...lead, uid: UID(7) };
  await api('setMember', { unitId: A.id, personId: L.id });
  const titles = async () => (await api('getBoard', { unitId: A.id })).tasks.map(t => t.title).sort();
  // позиция: дизайн (t1 у дизайнера, t3 без исполнителя в отделе дизайна); задача разработчика — вне зоны
  assert.deepEqual(await api.as(L, titles), ['Иконка', 'Макет экрана']);
  // CEO выдаёт лиду конкретного человека — его задачи входят в зону
  await api.as(admin, () => api('setLeadPeople', { leadId: L.id, personIds: [dev.id] }));
  assert.deepEqual(await api.as(L, titles), ['Вёрстка', 'Иконка', 'Макет экрана']);
  assert.deepEqual((await api.as(L, () => api('getLeadPeople', {})))[L.id], [dev.id]);
  // лид ведёт задачи зоны: срок и исполнитель, но не название и не чужой юнит
  await api.as(L, () => api('updateTask', { id: t3.id, patch: { dueDate: '2099-01-01', assigneeId: designer.id } }));
  await assert.rejects(api.as(L, () => api('updateTask', { id: t3.id, patch: { title: 'Новое' } })), forbidden);
  // передать нельзя тому, кто вне зоны (PM, не выданный лиду)
  await assert.rejects(api.as(L, () => api('updateTask', { id: t3.id, patch: { assigneeId: mod.id } })), forbidden);
  // задача вне зоны лиду не видна и не меняется
  await api.as(admin, () => api('setLeadPeople', { leadId: L.id, personIds: [] }));
  assert.ok(!(await api.as(L, titles)).includes('Вёрстка'));
  await assert.rejects(api.as(L, () => api('updateTask', { id: t2.id, patch: { dueDate: '2099-01-01' } })));
  // PM юнита выдаёт людей лиду своего юнита; сотрудник и чужой лид — нет; список не для не-лида
  await api.as(mod, () => api('setLeadPeople', { leadId: L.id, personIds: [dev.id] }));
  assert.ok((await api.as(L, titles)).includes('Вёрстка'));
  await assert.rejects(api.as(designer, () => api('setLeadPeople', { leadId: L.id, personIds: [] })), forbidden);
  await assert.rejects(api.as(admin, () => api('setLeadPeople', { leadId: designer.id, personIds: [] })));
  // человек не из юнита лида в зону не попадает
  const out = await api('createPerson', { name: 'Посторонний', positionId: 'd_ios' });
  await api.as(admin, () => api('setLeadPeople', { leadId: L.id, personIds: [out.id, dev.id] }));
  assert.deepEqual((await api.as(admin, () => api('getLeadPeople', {})))[L.id], [dev.id]);
});


test('раздача: ревьюер позиции из настроек юнита (например QA) важнее лида', async () => {
  const api = await setup();
  const { mod, designer, A, link, dev } = await team(api);
  const lead = await api('createPerson', { name: 'Лид', email: 'u6@x.ru', access: 'lead', positionId: 'd_design' });
  await api.pg.query('update people set user_id = $1 where id = $2', [UID(6), lead.id]);
  await api('setMember', { unitId: A.id, personId: lead.id });
  const L = { ...lead, uid: UID(6) };
  const st = (await api('getBoard', { unitId: A.id })).unit.settings;
  await api('updateUnit', { id: A.id, settings: { ...st, review: { ...st.review, byPosition: { d_design: dev.id }, default: '' } } });
  const prog = st.columns.find(c => c.kind === 'progress').id;
  const stage = await api.as(mod, () => api('createTask', { unitId: A.id, title: 'Дизайн', assigneeId: lead.id, status: prog, departmentId: 'd_design' }));
  const [part] = await api.as(L, () => api('splitTask', { taskId: stage.id, items: [{ title: 'Онбординг', assigneeId: designer.id }] }));
  await api.as(designer, () => api('updateTask', { id: part.id, patch: { fields: { [link.id]: 'https://figma.com/x' }, status: st.review.column } }));
  const { rows } = await api.pg.query('select assignee_id from tasks where id = $1', [part.id]);
  assert.equal(rows[0].assignee_id, dev.id);
});

test('лид после «Раздать» видит розданное на своём дашборде', async () => {
  const api = await setup();
  const { mod, designer, A, link } = await team(api);
  const lead = await api('createPerson', { name: 'Лид', email: 'u6@x.ru', access: 'lead', positionId: 'd_design' });
  await api.pg.query('update people set user_id = $1 where id = $2', [UID(6), lead.id]);
  await api('setMember', { unitId: A.id, personId: lead.id });
  const L = { ...lead, uid: UID(6) };
  const st = (await api('getBoard', { unitId: A.id })).unit.settings;
  await api('updateUnit', { id: A.id, settings: { ...st, review: { ...st.review, byPosition: { d_design: lead.id }, default: '' } } });
  const prog = st.columns.find(c => c.kind === 'progress').id;
  const stage = await api.as(mod, () => api('createTask', { unitId: A.id, title: 'Дизайн', assigneeId: lead.id, status: prog }));
  await api.as(L, () => api('splitTask', { taskId: stage.id, items: [{ title: 'Онбординг', assigneeId: designer.id }, { title: 'Пейволл', assigneeId: designer.id }] }));
  const d = await api.as(L, () => api('getMyDashboard', { personId: lead.id, today: '2026-11-02' }));
  assert.equal(d.lead.split.length, 1);
  assert.equal(d.lead.split[0].parts.length, 2);
  // подзадача ушла на ревью — лид видит её в «Ждут вашего ревью», а в «Раздано» она помечена «на ревью у вас»
  const part = d.lead.split[0].parts[0];
  await api.as(designer, () => api('updateTask', { id: part.id, patch: { fields: { [link.id]: 'https://figma.com/x' }, status: st.review.column } }));
  const d2 = await api.as(L, () => api('getMyDashboard', { personId: lead.id, today: '2026-11-02' }));
  assert.equal(d2.lead.reviews.length, 1);
  assert.equal(d2.lead.split[0].parts.filter(c => c.inReview).length, 1);
});


test('юнит создаётся сразу с ревьюерами по позициям', async () => {
  const api = await setup();
  const { designer } = await team(api);
  const u = await api('createUnit', { name: 'Новый', review: { byPosition: { d_design: designer.id }, default: designer.id } });
  const st = (await api('getBoard', { unitId: u.id })).unit.settings;
  assert.equal(st.review.byPosition.d_design, designer.id);
  assert.equal(st.review.default, designer.id);
  assert.ok(st.review.column);
});


test('CEO создаёт юнит сразу с PM, а PM можно добавить в команду из вкладки «Команда»', async () => {
  const api = await setup();
  const { mod } = await team(api);
  const u = await api('createUnit', { name: 'С PM', pmId: mod.id });
  assert.ok(u.members.some(m => m.personId === mod.id));
  const v = await api('createUnit', { name: 'Без PM' });
  assert.equal(v.members.length, 0);
  await api('setMember', { unitId: v.id, personId: mod.id });
  assert.ok((await api('getBoard', { unitId: v.id })).members.some(m => m.personId === mod.id));
});

test('PM собирает команду своего юнита: добавляет и убирает сотрудников, но не чужого юнита и не PM', async () => {
  const api = await setup();
  const { mod, designer, A, B } = await team(api);
  const extra = await api('createPerson', { name: 'Новый', email: 'u7@x.ru', access: 'member', positionId: 'd_design' });
  await api.as(mod, () => api('setMember', { unitId: A.id, personId: extra.id }));
  let m = await api('getBoard', { unitId: A.id });
  assert.ok(m.members.some(x => x.personId === extra.id));
  await api.as(mod, () => api('removeMember', { unitId: A.id, personId: extra.id }));
  m = await api('getBoard', { unitId: A.id });
  assert.ok(!m.members.some(x => x.personId === extra.id));
  // чужой юнит и PM — нельзя
  await api.as(mod, () => assert.rejects(() => api('setMember', { unitId: B.id, personId: extra.id })));
  await api.as(mod, () => api('removeMember', { unitId: A.id, personId: mod.id }));
  m = await api('getBoard', { unitId: A.id });
  assert.ok(m.members.some(x => x.personId === mod.id), 'PM из состава убрать нельзя');
  // сотрудник состав не меняет
  await api.as(designer, () => assert.rejects(() => api('setMember', { unitId: A.id, personId: extra.id })));
});

test('замещение: на период запросы PM и ревью идут заместителю; ставит только CEO', async () => {
  const api = await setup();
  const { admin, mod, designer, dev, A, link } = await team(api);
  await api('updateField', { id: link.id, required: false }).catch(() => api.pg.query('update fields set required = false where id = $1', [link.id]));
  const today = new Date().toISOString().slice(0, 10);
  // PM не ставит замещение
  await api.as(mod, async () => await assert.rejects(() => api('saveDeputy', { personId: mod.id, deputyId: admin.id, from: today, to: today })));
  await assert.rejects(() => api('saveDeputy', { personId: mod.id, deputyId: mod.id, from: today, to: today }), /сам себя/);
  await api('setUnitPm', { unitId: A.id, personId: mod.id });
  // PM в отпуске — за него CEO: новый запрос по приложению — CEO
  const list = await api('saveDeputy', { personId: mod.id, deputyId: admin.id, from: today, to: today, note: 'Отпуск' });
  assert.equal(list.length, 1);
  const { request } = await api('createApp', { unitId: A.id, name: 'Пульт 3' });
  assert.equal(request.assigneeId, admin.id);
  // ревьюер (дизайнер-лид условно: designer) в отпуске — ревью уходит заместителю (dev)
  const st = (await api('getBoard', { unitId: A.id })).unit.settings;
  await api('updateUnit', { id: A.id, settings: { ...st, review: { column: 'review', byPosition: { d_ios: designer.id }, default: '' } } });
  await api('saveDeputy', { personId: designer.id, deputyId: mod.id, from: today, to: today });
  const t = await api('createTask', { unitId: A.id, title: 'Экран', assigneeId: dev.id, departmentId: 'd_ios' });
  const moved = await api.as(dev, () => api('updateTask', { id: t.id, patch: { status: 'review' } }));
  assert.equal(moved.assigneeId, mod.id);
  // замещение закончилось — снова сам PM
  await api('deleteDeputy', { id: list[0].id });
  const r2 = await api('createRequest', { appId: (await api.pg.query("select id from apps where name = 'Пульт 3'")).rows[0].id, type: 'other', title: 'x' });
  assert.equal(r2.assigneeId, mod.id);
});

test('уведомления: по тестовым задачам — только демо-людям без входа; «смотреть как» показывает чужие (только разработчику, без отметки)', async () => {
  const api = await setup();
  const { admin, designer, dev, A } = await team(api);
  await api.pg.query('update people set is_dev = true where id = $1', [admin.id]);
  const demo = await api('createPerson', { name: 'Демо · Лид', access: 'member', positionId: 'd_design' });
  await api('setMember', { unitId: A.id, personId: demo.id });
  await api.pg.query("update fields set required = false where unit_id = $1", [A.id]);
  // тестовая задача: демо-человеку (без входа) уведомление приходит, реальному сотруднику — нет
  const t1 = await api.as(admin, () => api('createTask', { unitId: A.id, title: 'Демо-этап', assigneeId: demo.id, test: true }));
  const t2 = await api.as(admin, () => api('createTask', { unitId: A.id, title: 'Демо для реального', assigneeId: designer.id, test: true }));
  const cnt = async (task, person) => (await api.pg.query("select count(*)::int n from notifications where task_id = $1 and person_id = $2", [task, person])).rows[0].n;
  assert.equal(await cnt(t1.id, demo.id), 1);
  assert.equal(await cnt(t2.id, designer.id), 0);
  // обычная задача дизайнеру; разработчик «смотрит как» дизайнер — видит её, но не отмечает прочитанной
  const t3 = await api.as(admin, () => api('createTask', { unitId: A.id, title: 'Реальная', assigneeId: designer.id }));
  await api.as(admin, async () => {
    assert.ok((await api('getNotifications', { personId: designer.id })).some(n => n.taskId === t3.id));
    assert.ok((await api('heartbeat', { personId: designer.id })).unread >= 1);
    await api('readNotifications', { personId: designer.id });
  });
  assert.equal((await api.pg.query("select count(*)::int n from notifications where task_id = $1 and read_at = ''", [t3.id])).rows[0].n, 1);
  // обычный сотрудник чужие уведомления не видит
  await api.as(dev, async () => assert.ok(!(await api('getNotifications', { personId: designer.id })).some(n => n.taskId === t3.id)));
});

test('уведомления: история — прочитанные остаются (read), старше срока из настроек — нет', async () => {
  const api = await setup();
  const { admin, designer, A } = await team(api);
  await api.pg.query("update fields set required = false where unit_id = $1", [A.id]);
  const t1 = await api('createTask', { unitId: A.id, title: 'Свежая', assigneeId: designer.id });
  const t2 = await api('createTask', { unitId: A.id, title: 'Старая', assigneeId: designer.id });
  await api.as(designer, async () => {
    assert.equal((await api('getNotifications', {})).filter(n => !n.read && [t1.id, t2.id].includes(n.taskId)).length, 2);
    await api('readNotifications', {});
    const list = await api('getNotifications', {});
    assert.ok(list.some(n => n.taskId === t1.id && n.read)); // прочитанное — в истории
    assert.equal((await api('heartbeat', {})).unread, 0);
  });
  // прочитанное 10 дней назад — за пределами 7 дней по умолчанию; при 14 днях — видно
  const old = new Date(Date.now() - 10 * 864e5).toISOString();
  await api.pg.query('update notifications set at = $1 where task_id = $2', [old, t2.id]);
  await api.as(designer, async () => {
    assert.ok(!(await api('getNotifications', {})).some(n => n.taskId === t2.id));
    await api('setMyPrefs', { personId: designer.id, prefs: { notifyDays: 14 } });
    assert.ok((await api('getNotifications', {})).some(n => n.taskId === t2.id && n.read));
  });
  // «смотреть как» — тоже с историей
  await api.pg.query('update people set is_dev = true where id = $1', [admin.id]);
  await api.as(admin, async () => assert.ok((await api('getNotifications', { personId: designer.id })).some(n => n.taskId === t1.id && n.read)));
});

test('запрос CEO и этапы удаляет и убирает в архив только CEO; PM — нет', async () => {
  const api = await setup();
  const { admin, mod, A } = await team(api);
  const { app, request } = await api('createApp', { unitId: A.id, name: 'Пульт 9' });
  const stages = await api.as(mod, () => api('decomposeRequest', { taskId: request.id }));
  await api.as(mod, async () => {
    await assert.rejects(() => api('deleteTask', { id: request.id }));
    await assert.rejects(() => api('deleteTask', { id: stages[0].id }));
    await assert.rejects(() => api('updateTask', { id: request.id, patch: { archived: true } }));
    const own = await api('createTask', { unitId: A.id, title: 'Обычная' });
    assert.equal(await api('deleteTask', { id: own.id }), true); // обычные задачи PM удаляет как раньше
  });
  await api.as(admin, () => api('deleteTask', { id: request.id }));
  assert.ok(app.id);
});

test('мониторинг: ошибку пишет вошедший (от своего имени), читают и чистят только разработчик и CEO', async () => {
  const api = await setup();
  const { admin, designer, dev } = await team(api);
  await api.as(designer, () => api('logClientError', { message: 'TypeError: x is undefined', stack: 'at board.js:1', url: '#/u/1', version: 'abc' }));
  // подделать автора нельзя: база проверяет person_id
  await api.as(designer, () => assert.rejects(() => api.pg.query("insert into client_errors (person_id, message) values ($1, 'fake')", [dev.id])));
  await api.as(dev, async () => assert.equal((await api('getClientErrors', {})).length, 0)); // сотрудник не видит
  const list = await api.as(admin, () => api('getClientErrors', { days: 7 }));
  assert.equal(list.length, 1);
  assert.equal(list[0].personId, designer.id);
  assert.equal(list[0].version, 'abc');
  await api.as(admin, () => api('clearClientErrors', {}));
  assert.equal((await api.pg.query('select count(*)::int n from client_errors')).rows[0].n, 0);
});

test('RM: приложение со статусом «Ревью Apple» без релиза — в «На ревью Apple», итог меняет статус; участнику нельзя', async () => {
  const api = await setup();
  const { admin, designer, A } = await team(api);
  const mk = async () => {
    const p = await api('createPerson', { name: 'Релиз', email: 'u9@x.ru', access: 'rm', positionId: 'd_release' });
    await api.pg.query('update people set user_id = $1 where id = $2', [UID(9), p.id]);
    return { ...p, uid: UID(9) };
  };
  const rm = await mk();
  await api('setMember', { unitId: A.id, personId: rm.id });
  const made = await api.as(admin, () => api('createApp', { name: 'Шагомер', unitId: A.id, status: 'review', noRequest: true }));
  const other = await api.as(admin, () => api('createApp', { name: 'Погода', unitId: A.id, status: 'review', noRequest: true }));
  await api.as(admin, () => api('updateApp', { id: other.app.id, archived: true }));
  const d = await api.as(rm, () => api('getRmDashboard', {}));
  assert.deepEqual(d.review.map(x => [x.appOnly, x.app.name]), [[true, 'Шагомер']]);  // архивное не видно
  await api.as(designer, () => assert.rejects(() => api('appReviewResult', { appId: made.app.id, result: 'live' }), forbidden));
  assert.equal((await api.as(rm, () => api('appReviewResult', { appId: made.app.id, result: 'live' }))).status, 'live');
  assert.equal((await api.as(rm, () => api('getRmDashboard', {}))).review.length, 0);
  // повторно — уже не на ревью
  await api.as(rm, () => assert.rejects(() => api('appReviewResult', { appId: made.app.id, result: 'reject' })));
});

test('переименовать приложение: CEO и PM юнита — да, участник — нет', async () => {
  const api = await setup();
  const { admin, mod, designer, A } = await team(api);
  const { app } = await api.as(admin, () => api('createApp', { name: 'Старое', unitId: A.id, noRequest: true }));
  assert.equal((await api.as(mod, () => api('updateApp', { id: app.id, name: 'Новое' }))).name, 'Новое');
  await api.as(designer, () => assert.rejects(() => api('updateApp', { id: app.id, name: 'Чужое' })));
  assert.equal((await api.as(admin, () => api('listApps', {}))).find(x => x.id === app.id).name, 'Новое');
});

test('Design Spam / удалённые: убирает только CEO, открытые задачи — в архив и обратно при восстановлении', async () => {
  const api = await setup();
  const { admin, mod, A } = await team(api);
  const { app, request } = await api.as(admin, () => api('createApp', { name: 'Спам', unitId: A.id }));
  await api.as(mod, () => assert.rejects(() => api('shelveApp', { id: app.id, shelf: 'spam' }), forbidden));
  const out = await api.as(admin, () => api('shelveApp', { id: app.id, shelf: 'spam' }));
  assert.equal(out.shelf, 'spam');
  const t = async () => (await api.pg.query('select archived from tasks where id = $1', [request.id])).rows[0].archived;
  assert.equal(await t(), true);
  assert.ok(!(await api.as(admin, () => api('listApps', {}))).some(a => a.id === app.id));
  assert.equal((await api.as(admin, () => api('listApps', { archived: true }))).find(a => a.id === app.id).shelf, 'spam');
  // на другую полку — без повторного архива задач
  assert.equal((await api.as(admin, () => api('shelveApp', { id: app.id, shelf: 'sale' }))).shelf, 'sale');
  assert.equal((await api.as(admin, () => api('shelveApp', { id: app.id, shelf: 'deleted' }))).shelf, 'deleted');
  await api.as(mod, () => assert.rejects(() => api('restoreApp', { id: app.id }), forbidden));
  await api.as(admin, () => api('restoreApp', { id: app.id }));
  assert.equal(await t(), false);
  assert.ok((await api.as(admin, () => api('listApps', {}))).some(a => a.id === app.id));
});

test('реджекты: приложение со статусом «Реджект» без релиза видно на экране реджектов', async () => {
  const api = await setup();
  const { admin, A } = await team(api);
  const { app } = await api.as(admin, () => api('createApp', { name: 'Вернули', unitId: A.id, status: 'reject', noRequest: true }));
  const d = await api.as(admin, () => api('getRmDashboard', {}));
  assert.deepEqual(d.rejectedApps.map(x => x.app.id), [app.id]);
  await api.as(admin, () => api('shelveApp', { id: app.id, shelf: 'spam' }));
  assert.equal((await api.as(admin, () => api('getRmDashboard', {}))).rejectedApps.length, 0);
});

test('журнал: события приложений, юнитов, людей и настроек пишет база, с автором; фильтры по типу и приложению', async () => {
  const api = await setup();
  const { admin, mod, A, B } = await team(api);
  const { app, request } = await api.as(admin, () => api('createApp', { name: 'Журнал', unitId: A.id }));
  await api.as(mod, () => api('updateApp', { id: app.id, name: 'Журнал 2' }));
  await api.as(admin, async () => {
    await api('updateApp', { id: app.id, status: 'review' });
    await api('updateApp', { id: app.id, unitId: B.id });
    await api('shelveApp', { id: app.id, shelf: 'sale' });
    await api('restoreApp', { id: app.id });
    await api('updateUnit', { id: B.id, name: 'Bravo 2' });
    await api('createPerson', { name: 'Новичок', email: 'new@x.ru', access: 'member', positionId: 'd_qa' });
  });
  const all = (await api.as(admin, () => api('getActivity', { limit: 100 }))).items;
  const of = (action, field) => all.filter(a => a.action === action && (field === undefined || a.field === field));
  assert.equal(of('app_create')[0].actorId, admin.id);
  const ren = of('app_update', 'name')[0];
  assert.deepEqual([ren.actorId, ren.fromText, ren.toText], [mod.id, 'Журнал', 'Журнал 2']);
  assert.deepEqual([of('app_update', 'status')[0].fromText, of('app_update', 'status')[0].toText], ['В разработке', 'Ревью Apple']);
  assert.deepEqual([of('app_update', 'unit')[0].fromText, of('app_update', 'unit')[0].toText], ['Alpha', 'Bravo 2']);
  assert.equal(of('app_shelve')[0].toText, 'Removed from sale');
  assert.equal(of('app_restore')[0].fromText, 'Removed from sale');
  assert.equal(of('unit_update', 'name')[0].toText, 'Bravo 2');
  assert.equal(of('person_create')[0].ref.name, 'Новичок');
  assert.equal(of('app_create')[0].ref.name, 'Журнал 2');  // имя — живое
  // фильтры
  const st = (await api.as(admin, () => api('getActivity', { kind: 'app_status', limit: 50 }))).items;
  assert.ok(st.length >= 1 && st.every(a => a.action === 'app_update' && a.field === 'status'));
  const byApp = (await api.as(admin, () => api('getActivity', { appId: app.id, limit: 100 }))).items;
  assert.ok(byApp.some(a => a.action === 'app_create') && byApp.some(a => a.task && a.task.id === request.id));
  assert.ok(byApp.every(a => (a.ref && a.ref.id === app.id) || (a.task && a.task.id === request.id) || a.task));
  // удалено навсегда — запись остаётся с именем
  await api.as(admin, () => api('deleteApps', { ids: [app.id] }));
  const del = (await api.as(admin, () => api('getActivity', { kind: 'app_delete', limit: 5 }))).items[0];
  assert.deepEqual([del.ref.name, del.ref.gone], ['Журнал 2', true]);
  // писать в журнал напрямую нельзя
  await api.as(mod, () => assert.rejects(() => api.pg.query("select audit_write('app_create', '', 'x', 'x', '', null, null)")));
});

test('автопроверка App Store: одна ссылка за тик, другие страны, «нет в сторе», круг; включает только CEO', async () => {
  const api = await setup();
  const { admin, mod, A } = await team(api);
  // заглушка pg_net: запрос записывается, ответ кладёт тест
  await api.pg.exec(`create schema if not exists net;
    create table if not exists net._http_response (id bigint primary key, status_code int, content text, timed_out boolean default false);
    create table if not exists net.reqs (id bigserial primary key, url text);
    create or replace function net.http_get(url text) returns bigint language sql as $$ insert into net.reqs (url) values (url) returning id $$;`);
  const tick = async () => (await api.pg.query('select store_check_tick() as r')).rows[0].r;
  const reqs = async () => (await api.pg.query('select id, url from net.reqs order by id')).rows;
  const answer = (id, results) => api.pg.query('insert into net._http_response (id, status_code, content) values ($1, 200, $2)', [id, JSON.stringify({ resultCount: results.length, results })]);
  const a1 = (await api.as(admin, () => api('createApp', { name: 'Есть', unitId: A.id, noRequest: true, storeUrl: 'https://apps.apple.com/de/app/x/id1111111' }))).app;
  const a2 = (await api.as(admin, () => api('createApp', { name: 'Нет', unitId: A.id, noRequest: true, storeUrl: 'https://apps.apple.com/app/y/id2222222' }))).app;
  assert.equal(await tick(), 'off');
  await api.as(mod, () => assert.rejects(() => api('setStoreAutoCheck', { on: true })));
  assert.equal((await api.as(admin, () => api('setStoreAutoCheck', { on: true }))).total, 2);
  // круг: каждое приложение — по разу, в случайном порядке
  const seen = {};
  for (let round = 0; round < 2; round++) {
    assert.equal(await tick(), 'sent');
    let r = (await reqs()).pop();
    const which = /id=1111111/.test(r.url) ? 'de' : 'none';
    if (which === 'de') {
      assert.match(r.url, /country=de$/);  // сначала страна из ссылки
      assert.equal(await tick(), 'waiting');
      await answer(r.id, [{ trackName: 'Есть в сторе', artworkUrl512: 'https://is1-ssl.mzstatic.com/x.png' }]);
      assert.equal(await tick(), 'ok');
      seen.de = true;
    } else {
      // нет нигде: перебирает страны по одной за тик, потом «нет в сторе»
      let n = 0;
      for (;;) {
        await answer(r.id, []);
        const res = await tick();
        n++;
        if (res === 'gone') break;
        assert.equal(res, 'next-country');
        r = (await reqs()).pop();
      }
      assert.ok(n >= 7);
      seen.none = true;
    }
  }
  assert.deepEqual(seen, { de: true, none: true });
  const rows = (await api.pg.query('select id, store_ok, store_name from apps where id in ($1, $2)', [a1.id, a2.id])).rows;
  assert.deepEqual(Object.fromEntries(rows.map(x => [x.id, [x.store_ok, x.store_name]])), { [a1.id]: [true, 'Есть в сторе'], [a2.id]: [false, ''] });
  const st = await api.as(admin, () => api('getStoreAutoCheck', {}));
  assert.equal(st.on, true);
  // круг закончился — следующий тик начинает новый
  assert.equal(await tick(), 'sent');
  assert.equal((await api.as(admin, () => api('getStoreAutoCheck', {}))).checked, 0);
  await api.as(admin, () => api('setStoreAutoCheck', { on: false }));
  assert.equal(await tick(), 'off');
  // вызвать проверку напрямую нельзя
  await api.as(mod, () => assert.rejects(() => api.pg.query('select store_check_tick()')));
});

test('«Поставить в работу»: приложениям без задач — запрос New App PM; с запросом — пропуск; только CEO', async () => {
  const api = await setup();
  const { admin, mod, A } = await team(api);
  const idle = (await api.as(admin, () => api('createApp', { name: 'Без задач', unitId: A.id, status: 'dev', noRequest: true }))).app;
  const busy = (await api.as(admin, () => api('createApp', { name: 'С запросом', unitId: A.id }))).app;
  await api.as(mod, () => assert.rejects(() => api('startAppsWork', { ids: [idle.id] }), forbidden));
  assert.equal((await api.as(admin, () => api('startAppsWork', { ids: [idle.id, busy.id] }))).made, 1);
  const apps = await api.as(admin, () => api('listApps', {}));
  const req = apps.find(a => a.id === idle.id).requests;
  assert.deepEqual(req.map(r => [r.type, r.title, r.assigneeId]), [['new_app', 'New App: Без задач', mod.id]]);
  assert.equal(apps.find(a => a.id === busy.id).requests.length, 1);
});

test('«Новая задача» от CEO: «Кому» — человек из юнита получает обычную задачу у себя; PM — запрос; апдейт — всегда PM', async () => {
  const api = await setup();
  const { admin, mod, designer, A, B } = await team(api);
  const app = (await api.as(admin, () => api('createApp', { name: 'Кому-тест', unitId: A.id, noRequest: true }))).app;
  const t = await api.as(admin, () => api('createRequest', { appId: app.id, type: 'other', title: 'Перерисовать иконку', assigneeId: designer.id }));
  assert.deepEqual([t.kind, t.assigneeId, t.appId], ['', designer.id, app.id]);
  const mine = await api.as(designer, () => api('getMyBoard', { personId: designer.id }));
  assert.ok(mine.tasks.some(x => x.id === t.id && x.title === 'Перерисовать иконку'));
  const r = await api.as(admin, () => api('createRequest', { appId: app.id, type: 'other', title: 'Через PM', pmId: mod.id }));
  assert.deepEqual([r.kind, r.assigneeId], ['request', mod.id]);
  const u = await api.as(admin, () => api('createRequest', { appId: app.id, type: 'update', title: 'Виджет', assigneeId: designer.id }));
  assert.deepEqual([u.kind, u.assigneeId], ['request', mod.id]);
  const outsider = await api.as(admin, () => api('createPerson', { name: 'Чужой', email: 'z@x.ru', access: 'member' }));
  await api.as(admin, () => api('setMember', { unitId: B.id, personId: outsider.id }));
  await api.as(admin, () => assert.rejects(() => api('createRequest', { appId: app.id, type: 'other', title: 'x', assigneeId: outsider.id }), /нет в юните/));
});

test('позиции команды: стандартные команды связаны с позициями, CEO меняет; неизвестные позиции отбрасываются', async () => {
  const api = await setup();
  const { admin } = await team(api);
  const boot = await api.as(admin, () => api('bootstrap', {}));
  const byId = Object.fromEntries(boot.teams.map(t => [t.id, t.departmentIds]));
  assert.deepEqual([byId.t_product, byId.t_design, byId.t_ios, byId.t_qa, byId.t_release], [['d_po'], ['d_design'], ['d_ios'], ['d_qa'], ['d_release']]);
  assert.deepEqual(byId.t_other, ['d_other']);
  const t = await api.as(admin, () => api('createTeam', { name: 'Growth', departmentIds: ['d_design', 'd_nope', 'd_design'] }));
  assert.deepEqual(t.departmentIds, ['d_design']);
  const u = await api.as(admin, () => api('updateTeam', { id: t.id, departmentIds: ['d_ios', 'd_aso'] }));
  assert.deepEqual(u.departmentIds, ['d_ios', 'd_aso']);
});

test('инфо-лист: CEO включает человеку и выбирает поля; человек видит приложения своих юнитов только с этими полями', async () => {
  const api = await setup();
  const { admin, mod, designer, A, B } = await team(api);
  const fields = await api.as(admin, () => api('saveAppFields', { fields: [{ id: 'figma', name: 'Figma', kind: 'link' }, { id: 'github', name: 'GitHub', kind: 'link' }, { id: 'asc', name: 'App Store Connect', kind: 'link' }] }));
  assert.equal(fields.length, 3);
  const a1 = (await api.as(admin, () => api('createApp', { name: 'Бета', unitId: A.id, noRequest: true }))).app;
  const a2 = (await api.as(admin, () => api('createApp', { name: 'Альфа', unitId: A.id, noRequest: true }))).app;
  const b1 = (await api.as(admin, () => api('createApp', { name: 'Чужое', unitId: B.id, noRequest: true }))).app;
  for (const a of [a1, a2, b1]) await api.as(admin, () => api('updateApp', { id: a.id, info: { figma: 'https://figma.com/' + a.id, github: 'https://github.com/x/' + a.id, asc: 'https://appstoreconnect.apple.com/' + a.id } }));

  // выключен — пусто
  assert.deepEqual(await api.as(designer, () => api('getMyInfoList', { personId: designer.id })), { on: false, fields: [], apps: [] });
  // настраивает только CEO
  await api.as(mod, () => assert.rejects(() => api('setInfoList', { personId: designer.id, on: true, fieldIds: ['figma'] }), forbidden));
  await api.as(designer, () => assert.rejects(() => api('getInfoLists', {}), forbidden));

  const set = await api.as(admin, () => api('setInfoList', { personId: designer.id, on: true, fieldIds: ['figma', 'nope', 'figma'] }));
  assert.deepEqual(set.fieldIds, ['figma']);
  const my = await api.as(designer, () => api('getMyInfoList', { personId: designer.id }));
  assert.deepEqual(my.fields.map(f => f.id), ['figma']);
  assert.deepEqual(my.apps.map(a => [a.name, a.values]), [['Альфа', { figma: 'https://figma.com/' + a2.id }], ['Бета', { figma: 'https://figma.com/' + a1.id }]]);
  // в bootstrap человек видит только себя
  assert.deepEqual((await api.as(designer, () => api('bootstrap', {}))).infoListIds, [designer.id]);
  // чужую строку не читает, сам себе не включит
  await api.as(designer, () => assert.rejects(() => api('setInfoList', { personId: designer.id, on: true, fieldIds: ['github'] }), forbidden));
  assert.deepEqual(await api.as(mod, () => api('getMyInfoList', { personId: designer.id })), { on: false, fields: [], apps: [] });

  await api.as(admin, () => api('setInfoList', { personId: designer.id, on: true, fieldIds: ['figma', 'github'] }));
  assert.deepEqual((await api.as(admin, () => api('getInfoLists', {}))), [{ personId: designer.id, fieldIds: ['figma', 'github'] }]);
  await api.as(admin, () => api('setInfoList', { personId: designer.id, on: false }));
  assert.equal((await api.as(designer, () => api('getMyInfoList', { personId: designer.id }))).on, false);
});

test('PM добавили в юнит — видит все его приложения; убрали — не видит; лишние CEO снимает', async () => {
  const api = await setup();
  const { admin, A } = await team(api);
  const a1 = (await api.as(admin, () => api('createApp', { name: 'Раньше-1', unitId: A.id, noRequest: true }))).app;
  const a2 = (await api.as(admin, () => api('createApp', { name: 'Раньше-2', unitId: A.id, noRequest: true }))).app;
  const pm2 = await api.as(admin, () => api('createPerson', { name: 'Новый PM', email: 'pm2@x.ru', access: 'moderator' }));
  await api.pg.query('update people set user_id = $1 where id = $2', [UID(9), pm2.id]);
  const as2 = { ...pm2, uid: UID(9) };
  assert.equal((await api.as(as2, () => api('listApps', {}))).length, 0);
  await api.as(admin, () => api('setMember', { unitId: A.id, personId: pm2.id }));
  assert.deepEqual((await api.as(as2, () => api('listApps', {}))).map(a => a.name).sort(), ['Раньше-1', 'Раньше-2']);
  await api.as(admin, () => api('setPmApps', { personId: pm2.id, appIds: [a1.id] }));
  assert.deepEqual((await api.as(as2, () => api('listApps', {}))).map(a => a.id), [a1.id]);
  await api.as(admin, () => api('removeMember', { unitId: A.id, personId: pm2.id }));
  assert.equal((await api.as(as2, () => api('listApps', {}))).length, 0);
  assert.ok(a2);
});

test('«Смотреть как»: права в базе — как у выбранного человека, только просмотр; включает только разработчик', async () => {
  const api = await setup();
  const { admin, mod, designer, A, B, t1 } = await team(api);
  await api.pg.query('update people set is_dev = true where id = $1', [admin.id]);
  const app = (await api.as(admin, () => api('createApp', { name: 'Видно CEO', unitId: B.id, noRequest: true }))).app;
  const ceoTasks = (await api.as(admin, () => api('getBoard', { unitId: A.id }))).tasks.length;
  assert.ok(ceoTasks >= 3);
  // не разработчик включить не может
  await api.as(mod, () => assert.rejects(() => api('setViewAs', { personId: designer.id }), /прав|разработчик/));
  assert.deepEqual(await api.as(admin, () => api('setViewAs', { personId: designer.id })), { viewAs: designer.id });
  // видит как дизайнер: приложений нет, юнит B закрыт, на доске A — только его задачи
  assert.equal((await api.as(admin, () => api('listApps', {}))).length, 0);
  assert.deepEqual((await api.as(admin, () => api('getBoard', { unitId: A.id }))).tasks.map(t => t.id), [t1.id]);
  // изменения запрещены
  await api.as(admin, () => assert.rejects(() => api('updateApp', { id: app.id, name: 'x' }), /только просмотр|прав|не найдено/));
  await api.as(admin, () => assert.rejects(() => api('updateTask', { id: t1.id, patch: { title: 'x' } }), /только просмотр|прав/));
  await api.as(admin, () => assert.rejects(() => api('addComment', { taskId: t1.id, text: 'от чужого имени' }), /только просмотр/));
  // whoami — по-прежнему настоящий, с отметкой, кого смотрит
  const me = await api.as(admin, () => api('whoami', {}));
  assert.deepEqual([me.id, me.viewAs], [admin.id, designer.id]);
  // вернуться к себе
  await api.as(admin, () => api('setViewAs', { personId: '' }));
  assert.equal((await api.as(admin, () => api('listApps', {}))).length, 1);
  await api.as(admin, () => api('updateApp', { id: app.id, name: 'Снова можно' }));
});

test('обратная связь: пишет любой, видит своё; все предложения — только режим разработчика', async () => {
  const api = await setup();
  const { admin, mod, designer } = await team(api);
  await api.pg.query('update people set is_dev = true where id = $1', [admin.id]);
  const f1 = await api.as(designer, () => api('sendFeedback', { kind: 'bug', text: 'Не открывается карточка' }));
  const f2 = await api.as(mod, () => api('sendFeedback', { kind: 'zzz', text: 'Хочу тёмную тему' }));
  assert.deepEqual([f1.kind, f2.kind, f1.status], ['bug', 'idea', 'new']);
  await api.as(designer, () => assert.rejects(() => api('sendFeedback', { text: '  ' }), /Текст/));
  // своё видит, чужое — нет; разобрать не может
  assert.deepEqual((await api.as(designer, () => api('getMyFeedback', {}))).map(f => f.id), [f1.id]);
  assert.deepEqual((await api.as(designer, () => api('getFeedback', {}))).map(f => f.id), [f1.id]);
  await api.as(designer, () => assert.rejects(() => api('setFeedbackStatus', { id: f1.id, status: 'done' }), forbidden));
  // разработчик видит всё, отмечает и удаляет
  assert.equal((await api.as(admin, () => api('getFeedback', {}))).length, 2);
  await api.as(admin, () => api('setFeedbackStatus', { id: f1.id, status: 'done' }));
  assert.equal((await api.as(designer, () => api('getMyFeedback', {})))[0].status, 'done');
  await api.as(admin, () => api('deleteFeedback', { id: f2.id }));
  assert.equal((await api.as(admin, () => api('getFeedback', {}))).length, 1);
});

test('разнести по этапам: пройденные — готово, текущий — в работе, релиз — RM; уведомлений о прошлом нет; только CEO', async () => {
  const api = await setup();
  const { admin, mod, designer, dev, A } = await team(api);
  const qa = await api.as(admin, () => api('createPerson', { name: 'Тестер', email: 'qa@x.ru', access: 'member', positionId: 'd_qa' }));
  const rm = await api.as(admin, () => api('createPerson', { name: 'Релизный', email: 'rm@x.ru', access: 'rm', positionId: 'd_release' }));
  for (const p of [qa, rm]) await api.as(admin, () => api('setMember', { unitId: A.id, personId: p.id }));
  const mk = async name => (await api.as(admin, () => api('createApp', { name, unitId: A.id, noRequest: true }))).app;
  const [aDev, aRel, aStore, aDesign] = [await mk('В разработке'), await mk('К релизу'), await mk('В сторе'), await mk('Дизайн идёт')];
  await api.as(mod, () => assert.rejects(() => api('placeApps', { items: [{ id: aDev.id, stage: 'dev' }] }), forbidden));
  const r = await api.as(admin, () => api('placeApps', { designerId: designer.id, items: [
    { id: aDev.id, stage: 'dev' }, { id: aRel.id, stage: 'release' }, { id: aStore.id, stage: 'store' }, { id: aDesign.id, stage: 'design' }] }));
  assert.deepEqual([r.made, r.skipped, r.errors], [4, 0, []]);
  const board = (await api.as(admin, () => api('getBoard', { unitId: A.id }))).tasks;
  const unit = (await api.as(admin, () => api('bootstrap', {}))).units.find(u => u.id === A.id);
  const kind = t => (unit.settings.columns.find(c => c.id === t.status) || {}).kind;
  const stagesOf = app => Object.fromEntries(board.filter(t => t.appId === app.id && t.kind === 'stage').map(t => [t.step, kind(t)]));
  const sDev = stagesOf(aDev);
  assert.deepEqual([sDev.design, sDev.art, sDev.ios, sDev.qa], ['done', 'done', 'progress', 'todo']);
  assert.equal(board.find(t => t.appId === aDev.id && t.step === 'design').assigneeId, designer.id);
  assert.equal(board.find(t => t.appId === aDev.id && t.step === 'ios').assigneeId, dev.id);
  const sRel = stagesOf(aRel);
  assert.ok(Object.entries(sRel).every(([k, v]) => (k === 'release' ? v !== 'done' : v === 'done')));
  assert.equal(board.find(t => t.appId === aRel.id && t.step === 'release').assigneeId, rm.id);
  assert.equal(stagesOf(aDesign).design, 'progress');
  const sStore = stagesOf(aStore);
  assert.ok(Object.values(sStore).length && Object.values(sStore).every(v => v === 'done'));
  assert.equal(kind(board.find(t => t.appId === aStore.id && t.kind === 'request')), 'done');
  // дизайнеру — только о текущем дизайне (не о пройденных), PM — ничего о запросах
  const dn = await api.as(designer, () => api('heartbeat', { personId: designer.id }));
  const pmN = await api.as(mod, () => api('heartbeat', { personId: mod.id }));
  assert.ok(dn.unread >= 1 && dn.unread <= 2, 'дизайнер: ' + dn.unread);
  assert.equal(pmN.unread, 0);
  // повторно — пропускает (запрос уже есть)
  assert.equal((await api.as(admin, () => api('placeApps', { items: [{ id: aDev.id, stage: 'dev' }] }))).skipped, 1);
});

test('цифры юнитов из базы совпадают со старым подсчётом — у CEO и у сотрудника (ждущие этапы не считаются)', async () => {
  const api = await setup();
  const { admin, designer, dev, A } = await team(api);
  await api.pg.query('update people set is_dev = true where id = $1', [admin.id]);
  const app = (await api.as(admin, () => api('createApp', { name: 'Счёт', unitId: A.id, noRequest: true }))).app;
  await api.as(admin, () => api('placeApps', { items: [{ id: app.id, stage: 'dev' }] }));
  await api.as(admin, () => api('createTask', { unitId: A.id, title: 'Просрочка', assigneeId: designer.id, dueDate: '2020-01-01' }));
  const pick = b => Object.fromEntries(b.units.map(u => [u.id, { ...u.counts, doneWeek: u.doneWeek }]));
  const today = '2026-11-09';
  const snap = async who => pick(await api.as(who, () => api('bootstrap', { today })));
  const fresh = { admin: await snap(admin), designer: await snap(designer), dev: await snap(dev) };
  await api.pg.query('drop function unit_task_counts(text, text)');
  const old = { admin: await snap(admin), designer: await snap(designer), dev: await snap(dev) };
  assert.deepEqual(fresh, old);
  assert.ok(fresh.admin[A.id].overdue >= 1);
});

test('доска: выполненные — последними порциями (doneLimit), открытые — все; doneTotal — сколько выполненных всего', async () => {
  const api = await setup();
  const { admin, A } = await team(api);
  const board0 = await api.as(admin, () => api('getBoard', { unitId: A.id }));
  const doneCol = board0.unit.settings.columns.find(c => c.kind === 'done').id;
  const openBefore = board0.tasks.length;
  for (let i = 0; i < 60; i++) {
    const t = await api.as(admin, () => api('createTask', { unitId: A.id, title: 'Готово ' + i }));
    await api.pg.query('update tasks set status = $1, done_at = $2 where id = $3', [doneCol, '2026-11-' + String(1 + (i % 28)).padStart(2, '0') + 'T00:00:' + String(i).padStart(2, '0') + '.000Z', t.id]);
  }
  const b = await api.as(admin, () => api('getBoard', { unitId: A.id, doneLimit: 50 }));
  const done = b.tasks.filter(t => t.status === doneCol);
  assert.equal(b.doneTotal, 60);
  assert.equal(done.length, 50);
  assert.equal(b.tasks.length - done.length, openBefore);
  const more = await api.as(admin, () => api('getBoard', { unitId: A.id, doneLimit: 200 }));
  assert.equal(more.tasks.filter(t => t.status === doneCol).length, 60);
});

test('обратная связь: новое предложение — уведомление разработчику (одной строкой), автору — нет; прочитать по виду', async () => {
  const api = await setup();
  const { admin, mod, designer } = await team(api);
  await api.pg.query('update people set is_dev = true where id = $1', [admin.id]);
  await api.as(designer, () => api('sendFeedback', { kind: 'idea', text: 'Первое' }));
  await api.as(mod, () => api('sendFeedback', { kind: 'bug', text: 'Второе' }));
  const n = await api.as(admin, () => api('getNotifications', { personId: admin.id }));
  const fb = n.filter(x => x.kind === 'feedback');
  assert.equal(fb.length, 1);
  assert.deepEqual([fb[0].count, fb[0].read, fb[0].actorId], [2, false, mod.id]);
  assert.equal((await api.as(designer, () => api('getNotifications', { personId: designer.id }))).filter(x => x.kind === 'feedback').length, 0);
  const hb = await api.as(admin, () => api('heartbeat', { personId: admin.id }));
  assert.ok(hb.unread >= 1);
  await api.as(admin, () => api('readNotifications', { kind: 'feedback', personId: admin.id }));
  const after = (await api.as(admin, () => api('getNotifications', { personId: admin.id }))).filter(x => x.kind === 'feedback');
  assert.equal(after[0].read, true);
});
