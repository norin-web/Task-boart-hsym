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

test('обязательное поле с колонки: нужно только при переносе в неё и правее', async () => {
  const api = await setup();
  const { admin, designer, A, link, t1 } = await team(api);
  await api('updateField', { id: link.id, requiredFrom: 'done' });
  await api.as(designer, async () => {
    const moved = await api('updateTask', { id: t1.id, patch: { status: 'in_progress' } });
    assert.equal(moved.status, 'in_progress');
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
  const { admin, mod, designer, dev, A, B, t1, t2 } = await team(api);
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
    const list = await api('getNotifications', {});
    assert.deepEqual(list.map(n => [n.taskId, n.actorId, n.key]), [[t.id, admin.id, 'ALP-' + t.num]]);
    assert.equal((await api('heartbeat', {})).unread, 1);
  });
  await api.as(admin, async () => {
    assert.equal((await api('getNotifications', {})).length, 0); // себе не уведомляем
    await api('updateTask', { id: t.id, patch: { assigneeId: dev.id } }); // переназначили — у дизайнера снялось
  });
  await api.as(designer, async () => {
    assert.equal((await api('getNotifications', {})).length, 0);
  });
  await api.as(dev, async () => {
    assert.equal((await api('getNotifications', {}))[0].taskId, t.id);
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
    assert.equal((await api('getNotifications', {})).length, 0);
    assert.equal(await api('readNotifications', {}), 0);
  });
  assert.equal((await api.as(dev, () => api('getNotifications', {}))).length, 1);
});

test('несколько позиций, приоритет — только админы, удаление человека', async () => {
  const api = await setup();
  const { admin, mod, designer, dev, A, t1, t2, link } = await team(api);
  // Product owner + дизайнер видит задачи обеих позиций
  const po = await api('createTask', { unitId: A.id, title: 'Roadmap', departmentId: 'd_po' });
  await api.as(designer, async () => {
    assert.ok(!(await api('getBoard', { unitId: A.id })).tasks.some(t => t.id === po.id));
  });
  await api('updatePerson', { id: designer.id, extraPositionIds: ['d_po'] });
  await api.as(designer, async () => {
    assert.ok((await api('getBoard', { unitId: A.id })).tasks.some(t => t.id === po.id));
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

test('передача вниз: модераторам — уведомление; участник не меняет связи задачи', async () => {
  const api = await setup();
  const { mod, designer, A, B, t1 } = await team(api);
  await api('updateUnit', { id: A.id, settings: { ...A.settings, handoff: { column: 'in_progress', unitId: B.id } } });
  await api('updateTask', { id: t1.id, patch: { status: 'in_progress' } });
  await api.as(mod, async () => {
    const n = await api('getNotifications', {});
    assert.ok(n.some(x => x.kind === 'handoff' && x.unit.id === B.id), JSON.stringify(n.map(x => x.kind)));
  });
  await api.as(designer, async () => {
    await assert.rejects(() => api.pg.query("update tasks set kind = 'app' where id = $1", [t1.id]), /Недостаточно прав/);
  });
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
    assert.equal((await api('getNotifications', {})).filter(n => n.taskId === t2.id).length, 1);
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
    assert.equal((await api('getNotifications', {})).length, 0); // сам себе — без уведомления
    await assert.rejects(() => api('recallReview', { id: t2.id }), /уже не на ревью/);
  });
  await api.as(designer, async () => {
    assert.equal((await api('getNotifications', {})).filter(n => n.taskId === t2.id).length, 0); // у ревьюера снялось
  });
  // ревьюер вернул на доработку — «вернули»
  await api.as(dev, () => api('updateTask', { id: t2.id, patch: { status: 'review' } }));
  await api.as(designer, () => api('updateTask', { id: t2.id, patch: { status: 'in_progress' } }));
  await api.as(dev, async () => {
    assert.equal((await api('getNotifications', {})).find(x => x.taskId === t2.id).kind, 'returned');
    await api('readNotifications', {});
  });
  // снова на ревью и возврат ревьюером — для проверки ниже
  await api.as(dev, () => api('updateTask', { id: t2.id, patch: { status: 'review' } }));
  await api.as(designer, () => api('updateTask', { id: t2.id, patch: { status: 'done' } }));

  // ревьюер перенёс в «готово» — исполнителю «закрыта по ревью», а не «вернули»
  await api.as(dev, async () => {
    const n = (await api('getNotifications', {})).find(x => x.taskId === t2.id);
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
    const n = (await api('getNotifications', {})).find(x => x.taskId === own.id);
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
    assert.equal((await api('getNotifications', { today })).length, 0); // прочитано — не возвращается
  });
  await api.as(dev, async () => {
    await api('readNotifications', {});
    assert.deepEqual((await api('getNotifications', { today })).map(x => x.kind), ['due_soon']);
    assert.deepEqual((await api('getNotifications', { today: '2026-10-27' })).map(x => x.kind), ['overdue']); // «скоро» заменено
  });
  await api('updateTask', { id: t1.id, patch: { dueDate: '2026-10-22' } }); // новый срок — новое уведомление
  await api.as(designer, async () => {
    assert.equal((await api('getNotifications', { today })).length, 1);
  });
  await api('updateTask', { id: t2.id, patch: { status: 'done' } });
  await api.as(dev, async () => {
    await api('readNotifications', {});
    assert.equal((await api('getNotifications', { today: '2026-11-01' })).length, 0); // выполненные не напоминают
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
  // задача iOS-команды с позицией QA: дизайнер её не видит, пока не в iOS Development
  const t = await api('createTask', { unitId: A.id, title: 'Сборка', departmentId: 'd_qa', teamId: 't_ios' });
  assert.equal(t.teamId, 't_ios');
  await api.as(designer, async () => {
    assert.ok(!(await api('getBoard', { unitId: A.id })).tasks.some(x => x.id === t.id));
    await assert.rejects(() => api('updatePerson', { id: designer.id, teamIds: ['t_ios'] }), forbidden);
  });
  const p = await api('updatePerson', { id: designer.id, teamIds: ['t_design', 't_ios', 'нет'] });
  assert.deepEqual(p.teamIds, ['t_design', 't_ios']);
  await api.as(designer, async () => {
    assert.ok((await api('getBoard', { unitId: A.id })).tasks.some(x => x.id === t.id));
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
  const { mod, designer, dev, A, t1, t2 } = await team(api);
  const teams = (await api('bootstrap', {})).teams;
  assert.deepEqual(teams.find(t => t.id === 't_design').boardTemplate.map(c => c.name),
    ['To do', 'Design in Progress', 'Review', 'Text', 'Google Drive', 'Done']);
  assert.deepEqual(teams.find(t => t.id === 't_release').boardTemplate.map(c => c.kind), ['todo', 'progress', 'progress', 'progress', 'done']);
  // шаблон меняют админы; пустой — нельзя
  await api.as(designer, async () => {
    await assert.rejects(() => api('updateTeam', { id: 't_design', boardTemplate: [{ name: 'x', kind: 'todo' }] }), forbidden);
  });
  await assert.rejects(() => api('updateTeam', { id: 't_design', boardTemplate: [] }), /хотя бы один/);
  const upd = await api.as(mod, () => api('updateTeam', { id: 't_qa', boardTemplate: [{ name: 'Очередь', kind: 'todo' }, { name: 'Ок', kind: 'done', id: 'BAD id' }] }));
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
