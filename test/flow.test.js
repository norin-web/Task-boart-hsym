// Tasks 2.0: роли CEO / PM / RM / Lead / сотрудник, приложения, запросы CEO, декомпозиция по флоу,
// блокировка этапов, передача в релиз, режим разработчика (тестовые данные). Логика и права — на настоящей схеме.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createBackend } from '../web/src/backend.js';
import { pgliteClient, AUTH_STUB_SQL, actAs } from '../web/src/pglite-client.js';

const SCHEMA = fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const UID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

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
  api.as = async (person, fn) => {
    await actAs(pg, person ? person.uid : null, person ? person.email : '');
    try { return await fn(); } finally { await actAs(pg, null); }
  };
  api.pg = pg;
  return api;
}

/** Студия: CEO; юнит Gold — PM, RM, лид дизайна, iOS, QA, ASO; юнит RF — свой PM. */
async function studio(api) {
  let n = 0;
  const mk = async (name, access, positionId) => {
    const p = await api('createPerson', { name, email: `p${++n}@x.ru`, access, positionId });
    const uid = UID(n);
    await api.pg.query('update people set user_id = $1 where id = $2', [uid, p.id]);
    return { ...p, uid };
  };
  const ceo = await mk('CEO', 'superadmin', 'd_po');
  const pm = await mk('PM Gold', 'moderator', 'd_po');
  const pmRf = await mk('PM RF', 'moderator', 'd_po');
  const rm = await mk('RM', 'rm', 'd_release');
  const lead = await mk('Лид дизайна', 'lead', 'd_design');
  const ios = await mk('iOS', 'member', 'd_ios');
  const qa = await mk('QA', 'member', 'd_qa');
  const aso = await mk('ASO', 'member', 'd_aso');
  const gold = await api('createUnit', { name: 'Gold', key: 'GLD' });
  const rf = await api('createUnit', { name: 'RF', key: 'RF' });
  for (const p of [pm, rm, lead, ios, qa, aso]) await api('setMember', { unitId: gold.id, personId: p.id });
  await api('setMember', { unitId: rf.id, personId: pmRf.id });
  return { ceo, pm, pmRf, rm, lead, ios, qa, aso, gold, rf };
}

const forbidden = e => e.code === 'FORBIDDEN';

test('New App: CEO → PM юнита → этапы по флоу → блокировки → релиз у RM', async () => {
  const api = await setup();
  const { ceo, pm, pmRf, rm, lead, ios, qa, aso, gold, rf } = await studio(api);

  // CEO создаёт приложение — запрос падает PM юнита
  const { app, request } = await api.as(ceo, () => api('createApp', { name: 'Sleep Sounds', unitId: gold.id }));
  assert.equal(app.status, 'dev');
  assert.equal(request.kind, 'request');
  assert.equal(request.requestType, 'new_app');
  assert.equal(request.assigneeId, pm.id);
  assert.equal(request.appId, app.id);

  // PM другого юнита ни приложения, ни запроса не видит; сотрудник Gold видит приложение своего юнита
  await api.as(pmRf, async () => {
    assert.deepEqual(await api('listApps', {}), []);
    await assert.rejects(() => api('decomposeRequest', { taskId: request.id }), e => e.code === 'NOT_FOUND');
  });
  await api.as(ios, async () => assert.deepEqual((await api('listApps', {})).map(a => a.name), ['Sleep Sounds']));
  // создаёт приложения только CEO
  await api.as(pm, () => assert.rejects(() => api('createApp', { name: 'x', unitId: gold.id }), forbidden));

  // PM раскладывает запрос по флоу
  const stages = await api.as(pm, () => api('decomposeRequest', { taskId: request.id }));
  const by = Object.fromEntries(stages.map(t => [t.step, t]));
  assert.deepEqual(stages.map(t => t.step), ['design', 'ios', 'qa', 'meta', 'release']);
  assert.equal(by.design.assigneeId, lead.id); // лид позиции
  assert.equal(by.ios.assigneeId, ios.id);
  assert.equal(by.qa.assigneeId, qa.id);
  assert.equal(by.meta.assigneeId, aso.id);
  assert.equal(by.release.assigneeId, ''); // релиз — пока не передадут
  assert.deepEqual(by.ios.dependsOn, [by.design.id]);
  assert.deepEqual(by.release.dependsOn.length, 4);
  await api.as(pm, () => assert.rejects(() => api('decomposeRequest', { taskId: request.id }), /уже разложен/));
  const req2 = (await api.as(ceo, () => api('getBoard', { unitId: gold.id }))).tasks.find(t => t.id === request.id);
  assert.equal(req2.status, 'in_progress'); // запрос — в работе

  // iOS заблокирован, пока не закрыт дизайн (никому, даже CEO)
  await api.as(ios, () => assert.rejects(() => api('updateTask', { id: by.ios.id, patch: { status: 'in_progress' } }), /заблокирован.*Дизайн/));
  await api.as(ceo, () => assert.rejects(() => api('updateTask', { id: by.ios.id, patch: { status: 'in_progress' } }), /заблокирован/));
  await api.as(aso, () => api('updateTask', { id: by.meta.id, patch: { status: 'in_progress' } })); // мета — параллельно
  await api.as(lead, () => api('updateTask', { id: by.design.id, patch: { status: 'done' } }));
  await api.as(ios, () => api('updateTask', { id: by.ios.id, patch: { status: 'done' } }));

  // в релиз — только когда всё закрыто
  await api.as(pm, () => assert.rejects(() => api('sendToRelease', { taskId: by.release.id }), /Сначала закройте.*Тестирование/));
  await api.as(qa, () => api('updateTask', { id: by.qa.id, patch: { status: 'done' } }));
  await api.as(aso, () => api('updateTask', { id: by.meta.id, patch: { status: 'done' } }));
  await api.as(ios, () => assert.rejects(() => api('sendToRelease', { taskId: by.release.id }), e => e.code === 'NOT_FOUND' || forbidden(e))); // чужой этап ему не виден
  const rel = await api.as(pm, () => api('sendToRelease', { taskId: by.release.id }));
  assert.equal(rel.assigneeId, rm.id);
  await api.as(rm, async () => {
    const n = await api('getNotifications', {});
    assert.ok(n.some(x => x.taskId === by.release.id && x.kind === 'assigned'));
    await api('updateTask', { id: by.release.id, patch: { status: 'in_progress' } });
  });
  const [summary] = await api.as(ceo, () => api('listApps', {}));
  assert.equal(summary.status, 'release');
  assert.equal(summary.requests[0].progress, 80); // 4 из 5 этапов закрыты
  assert.equal(summary.requests[0].stages.find(s => s.step === 'release').blocked, false);

  // CEO переносит приложение в другой юнит; PM — нет
  await api.as(pm, () => assert.rejects(() => api('updateApp', { id: app.id, unitId: rf.id }), e => e.code === 'NOT_FOUND' || forbidden(e))); // чужой юнит ему не виден
  await api.as(pm, () => assert.rejects(() => api.pg.query('update apps set unit_id = $1 where id = $2', [rf.id, app.id]), /только CEO/));
  await api.as(ceo, () => api('updateApp', { id: app.id, unitId: rf.id }));
  await api.as(pmRf, async () => assert.equal((await api('listApps', {})).length, 1));
});

test('роли: PM — только свои юниты; роли RM и Lead назначает CEO', async () => {
  const api = await setup();
  const { ceo, pm, pmRf, ios, gold, rf } = await studio(api);
  await api.as(pm, async () => {
    assert.deepEqual((await api('bootstrap', {})).units.map(u => u.key), ['GLD']);
    await api('createTask', { unitId: gold.id, title: 'Своя' });
    await assert.rejects(() => api('createTask', { unitId: rf.id, title: 'Чужая' }), e => e.code === 'NOT_FOUND' || forbidden(e));
    await assert.rejects(() => api('createUnit', { name: 'MVP', key: 'MVP' }), forbidden);
    await assert.rejects(() => api('updatePerson', { id: ios.id, access: 'lead' }), forbidden);
  });
  await api.as(ceo, async () => {
    assert.deepEqual((await api('bootstrap', {})).units.map(u => u.key).sort(), ['GLD', 'RF']);
    assert.equal((await api('updatePerson', { id: ios.id, access: 'lead' })).access, 'lead');
  });
  assert.ok(pmRf);
});

test('режим разработчика: тестовые данные видит только он, без уведомлений, удаляются одной кнопкой', async () => {
  const api = await setup();
  const { ceo, pm, ios, gold } = await studio(api);
  // флаг ставит только система
  await api.as(ceo, () => assert.rejects(() => api.pg.query('update people set is_dev = true where id = $1', [ceo.id]), /система/));
  await api.as(ceo, () => assert.rejects(() => api('createApp', { name: 'T', unitId: gold.id, test: true }), forbidden));
  await api.pg.query('update people set is_dev = true where id = $1', [ceo.id]);

  const { app, request } = await api.as(ceo, () => api('createApp', { name: 'Test App', unitId: gold.id, test: true }));
  assert.equal(app.isTest, true);
  assert.equal(request.isTest, true);
  const stages = await api.as(ceo, () => api('decomposeRequest', { taskId: request.id }));
  assert.ok(stages.every(t => t.isTest));
  await api.as(pm, async () => {
    assert.deepEqual(await api('listApps', {}), []); // реальные люди тест не видят
    assert.equal((await api('getNotifications', {})).length, 0); // и уведомлений не получают
  });
  await api.as(ios, async () => assert.equal((await api('getMyBoard', { personId: ios.id })).tasks.length, 0));
  await api.as(pm, () => assert.rejects(() => api('deleteTestData', {}), forbidden));
  const r = await api.as(ceo, () => api('deleteTestData', {}));
  assert.equal(r.tasks, 6); // запрос + 5 этапов
  await api.as(ceo, async () => assert.deepEqual(await api('listApps', {}), []));
});

test('статусы приложения и флоу настраиваются', async () => {
  const api = await setup();
  const { ceo, gold } = await studio(api);
  await api.as(ceo, async () => {
    const list = await api('getAppStatuses', {});
    assert.deepEqual(list.map(x => x.kind), ['dev', 'release', 'review', 'live', 'reject']);
    const next = await api('saveAppStatuses', { statuses: [...list, { name: 'Пауза', color: '#64748b' }] });
    assert.equal(next.length, 6);
    assert.equal(next[5].kind, '');
    await assert.rejects(() => api('saveAppStatuses', { statuses: [] }), /хотя бы один/);
    const flows = await api('saveFlow', { type: 'other', steps: [{ key: 'design', title: 'Макет', positionId: 'd_design' }, { key: 'bad', title: 'x', dependsOn: ['nope', 'design'] }] });
    assert.deepEqual(flows.other.map(s => s.key), ['design', 'bad']);
    assert.deepEqual(flows.other[1].dependsOn, ['design']);
    const { request } = await api('createApp', { name: 'A', unitId: gold.id });
    const r2 = await api('createRequest', { appId: request.appId, type: 'other', title: 'Иконка к празднику' });
    assert.equal((await api('decomposeRequest', { taskId: r2.id })).length, 2);
  });
});

test('CEO: приоритет приложения → запросу → этапам; перенос приложения в другой юнит вместе с задачами', async () => {
  const api = await setup();
  const { ceo, pm, pmRf, gold, rf } = await studio(api);
  await api.as(ceo, () => assert.rejects(() => api('createApp', { name: 'X', unitId: gold.id, priority: 'nope' }), /приоритета/));
  const { app, request } = await api.as(ceo, () => api('createApp', { name: 'Sleep', unitId: gold.id, priority: 'o_high' }));
  assert.equal(app.priority, 'o_high');
  assert.equal(request.fields.f_priority, 'o_high');
  const stages = await api.as(pm, () => api('decomposeRequest', { taskId: request.id }));
  assert.ok(stages.every(t => t.fields.f_priority === 'o_high'));
  // апдейт с другим приоритетом
  const upd = await api.as(ceo, () => api('createRequest', { appId: app.id, type: 'update', priority: 'o_critical' }));
  assert.equal(upd.fields.f_priority, 'o_critical');
  // перенос: все задачи приложения — в RF, открытые запросы — PM RF
  const moved = await api.as(ceo, () => api('updateApp', { id: app.id, unitId: rf.id, priority: 'o_low' }));
  assert.equal(moved.unitId, rf.id);
  assert.equal(moved.priority, 'o_low');
  const rows = (await api.pg.query('select unit_id, kind, assignee_id from tasks where app_id = $1', [app.id])).rows;
  assert.ok(rows.every(r => r.unit_id === rf.id));
  assert.ok(rows.filter(r => r.kind === 'request').every(r => r.assignee_id === pmRf.id));
  await api.as(pm, async () => assert.deepEqual(await api('listApps', {}), []));
});

test('поля приложения: ссылки и тексты, неизвестные не сохраняются', async () => {
  const api = await setup();
  const { ceo, gold } = await studio(api);
  await api.as(ceo, async () => {
    const fields = await api('getAppFields', {});
    assert.deepEqual(fields.map(f => f.id), ['appstore', 'asc', 'figma', 'drive']);
    await api('saveAppFields', { fields: [...fields, { name: 'Bundle ID', kind: 'text' }] });
    const bundle = (await api('getAppFields', {})).find(f => f.name === 'Bundle ID');
    const { app } = await api('createApp', { name: 'A', unitId: gold.id });
    const a = await api('updateApp', { id: app.id, info: { appstore: 'apps.apple.com/app/id1', [bundle.id]: 'com.x.a', hack: 'x' } });
    assert.deepEqual(a.info, { appstore: 'https://apps.apple.com/app/id1', [bundle.id]: 'com.x.a' });
    await assert.rejects(() => api('updateApp', { id: app.id, info: { figma: 'javascript:alert(1)' } }), /https/);
    const b = await api('updateApp', { id: app.id, info: { appstore: '' } });
    assert.deepEqual(b.info, { [bundle.id]: 'com.x.a' });
  });
});

test('дашборд CEO: портфель, требует внимания, работы в ходу, недавно вышло', async () => {
  const api = await setup();
  const { ceo, pm, lead, gold } = await studio(api);
  const day = new Date().toISOString().slice(0, 10);
  const { app: a1, request: r1 } = await api.as(ceo, () => api('createApp', { name: 'Sleep', unitId: gold.id, dueDate: '2020-01-01' }));
  const { app: a2 } = await api.as(ceo, () => api('createApp', { name: 'Weather', unitId: gold.id }));
  const { app: a3 } = await api.as(ceo, () => api('createApp', { name: 'Fit', unitId: gold.id }));
  await api.as(ceo, () => api('updateApp', { id: a2.id, status: 'reject' }));
  await api.as(ceo, () => api('updateApp', { id: a3.id, status: 'live' }));
  const st = Object.fromEntries((await api.as(pm, () => api('decomposeRequest', { taskId: r1.id }))).map(t => [t.step, t]));
  await api.as(lead, () => api('updateTask', { id: st.design.id, patch: { status: 'in_progress' } }));
  // этап мета давно никто не трогал
  await api.pg.query("update tasks set updated_at = '2020-01-01T00:00:00.000Z', due_date = '' where id = $1", [st.meta.id]);
  const d = await api.as(ceo, () => api('getCeoDashboard', { today: day }));
  assert.deepEqual(d.portfolio.byStatus.reject, [a2.id]);
  assert.equal(d.portfolio.byUnit[gold.id].dev, 1);
  const types = d.attention.map(x => x.type);
  assert.equal(types[0], 'reject');
  assert.ok(types.includes('overdue')); // срок запроса прошёл
  assert.ok(d.attention.some(x => x.type === 'stale' && x.task.id === st.meta.id));
  assert.ok(d.attention.some(x => x.type === 'waiting')); // запросы Weather и Fit PM ещё не разложил
  const sleep = d.inProgress.find(x => x.app.id === a1.id);
  assert.equal(sleep.current.step, 'design'); // текущий этап — тот, что в работе
  assert.ok(d.recent.some(x => x.type === 'live' && x.app.id === a3.id));
  assert.equal(d.staleDays, 7);
});
