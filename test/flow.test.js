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
  // импорт уже вышедшего приложения: свой статус, без запроса PM
  const imported = await api.as(ceo, () => api('createApp', { name: 'Old App', unitId: gold.id, status: 'live', noRequest: true, storeUrl: 'https://apps.apple.com/app/id6470798112', storeName: 'Remote for Roku' }));
  assert.equal(imported.app.status, 'live');
  assert.equal(imported.app.storeName, 'Remote for Roku');
  assert.equal((await api.as(ceo, () => api('updateApp', { id: imported.app.id, storeName: 'Roku TV Remote' }))).storeName, 'Roku TV Remote');
  assert.equal(imported.request, null);
  await api.as(ceo, () => api('updateApp', { id: imported.app.id, archived: true }));

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
    assert.deepEqual(list.map(x => x.kind), ['dev', 'release', 'review', 'live', '', 'reject']);
    const next = await api('saveAppStatuses', { statuses: [...list, { name: 'Пауза', color: '#64748b' }] });
    assert.equal(next.length, 7);
    assert.equal(next[6].kind, '');
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
  // «Недавнее» — движение по статусам из истории + начало разработки (New App); импорт без смены статуса сюда не попадает
  assert.ok(d.recent.some(x => x.type === 'status' && x.app.id === a3.id && x.from === 'dev' && x.to === 'live'));
  assert.ok(d.recent.some(x => x.type === 'start' && x.app.id === a1.id));
  const imp = await api.as(ceo, () => api('createApp', { name: 'Imported', unitId: gold.id, status: 'live', noRequest: true }));
  assert.ok(!(await api.as(ceo, () => api('getCeoDashboard', { today: day }))).recent.some(x => x.app.id === imp.app.id));
  assert.equal(d.staleDays, 7);
});

test('PM: свой флоу у юнита; разбивка по плану из окна — этапы, исполнители, сроки', async () => {
  const api = await setup();
  const { ceo, pm, pmRf, ios, aso, gold, rf } = await studio(api);
  // PM Gold настраивает свой флоу «Апдейт»: без дизайна; чужой юнит — нельзя
  await api.as(pm, async () => {
    const f = await api('saveFlow', { unitId: gold.id, type: 'update', steps: [
      { key: 'ios', title: 'iOS', positionId: 'd_ios' }, { key: 'qa', title: 'QA', positionId: 'd_qa', dependsOn: ['ios'] },
      { key: 'release', title: 'Релиз', positionId: 'd_release', dependsOn: ['ios', 'qa'], release: true }] });
    assert.deepEqual(f.update.map(s => s.key), ['ios', 'qa', 'release']);
    assert.deepEqual(f.new_app.map(s => s.key), ['design', 'ios', 'qa', 'meta', 'release']); // остальные — по умолчанию
    await assert.rejects(() => api('saveFlow', { unitId: rf.id, type: 'update', steps: [] }), e => e.code === 'NOT_FOUND' || forbidden(e));
  });
  await api.as(pmRf, async () => assert.equal((await api('getFlows', { unitId: rf.id })).update.length, 4)); // у RF — по умолчанию
  const { app } = await api.as(ceo, () => api('createApp', { name: 'A', unitId: gold.id }));
  const upd = await api.as(ceo, () => api('createRequest', { appId: app.id, type: 'update' }));
  assert.deepEqual((await api.as(pm, () => api('decomposeRequest', { taskId: upd.id }))).map(t => t.step), ['ios', 'qa', 'release']);
  // New App по плану: без меты, свой этап, другой исполнитель и срок
  const req = (await api.as(ceo, () => api('createRequest', { appId: app.id, type: 'new_app', title: 'New App 2' })));
  const plan = [
    { key: 'design', title: 'Дизайн', positionId: 'd_design', assigneeId: '', dueDate: '2030-01-10' },
    { key: 'ios', title: 'iOS', positionId: 'd_ios', dependsOn: ['design'], assigneeId: ios.id, dueDate: '2030-01-20' },
    { key: 'promo', title: 'Промо-ролик', positionId: 'd_aso', dependsOn: [], assigneeId: aso.id },
    { key: 'release', title: 'Релиз', positionId: 'd_release', dependsOn: ['design', 'ios', 'promo'], release: true, assigneeId: ios.id },
  ];
  const made = Object.fromEntries((await api.as(pm, () => api('decomposeRequest', { taskId: req.id, plan }))).map(t => [t.step, t]));
  assert.deepEqual(Object.keys(made), ['design', 'ios', 'promo', 'release']);
  assert.equal(made.design.assigneeId, '');
  assert.equal(made.design.dueDate, '2030-01-10');
  assert.equal(made.ios.assigneeId, ios.id);
  assert.equal(made.release.assigneeId, ''); // релиз — только через «Передать в релиз»
  assert.equal(made.release.dependsOn.length, 3);
});

test('дашборд PM: входящие, этапы, проблемы, KPI команды за период', async () => {
  const api = await setup();
  const { ceo, pm, lead, ios, gold } = await studio(api);
  const day = new Date().toISOString().slice(0, 10);
  const { request: inboxReq } = await api.as(ceo, () => api('createApp', { name: 'Inbox', unitId: gold.id }));
  const { request: r } = await api.as(ceo, () => api('createApp', { name: 'Work', unitId: gold.id }));
  const st = Object.fromEntries((await api.as(pm, () => api('decomposeRequest', { taskId: r.id }))).map(t => [t.step, t]));
  // дизайн — в срок; iOS — после срока; ещё одна задача iOS просрочена и висит
  await api.as(pm, () => api('updateTask', { id: st.design.id, patch: { dueDate: '2099-01-01' } }));
  await api.as(lead, () => api('updateTask', { id: st.design.id, patch: { status: 'in_progress' } }));
  await api.as(lead, () => api('updateTask', { id: st.design.id, patch: { status: 'done' } }));
  await api.as(pm, () => api('updateTask', { id: st.ios.id, patch: { dueDate: '2020-01-01' } }));
  await api.as(ios, () => api('updateTask', { id: st.ios.id, patch: { status: 'in_progress' } }));
  await api.as(ios, () => api('updateTask', { id: st.ios.id, patch: { status: 'done' } }));
  const late = await api.as(pm, () => api('createTask', { unitId: gold.id, title: 'Краш', assigneeId: ios.id, dueDate: '2020-01-01' }));
  await api.as(pm, () => api('createTask', { unitId: gold.id, title: 'Ничья' }));
  const d = await api.as(pm, () => api('getPmDashboard', { today: day, period: 'week' }));
  assert.deepEqual(d.inbox.map(x => x.id), [inboxReq.id]);
  assert.equal(d.inbox[0].app.name, 'Inbox');
  const w = d.pipeline.find(x => x.id === r.id);
  assert.equal(w.stages.length, 5);
  assert.equal(w.progress, 40);
  assert.equal(w.releaseReady, false);
  assert.ok(d.problems.some(x => x.type === 'overdue' && x.task.id === late.id));
  assert.ok(d.problems.some(x => x.type === 'unassigned' && x.task.title === 'Ничья'));
  const k = Object.fromEntries(d.team.map(x => [x.personId, x]));
  assert.equal(k[lead.id].done, 1);
  assert.equal(k[lead.id].onTime, 100);
  assert.equal(k[ios.id].done, 1);
  assert.equal(k[ios.id].onTime, 0);
  assert.equal(k[ios.id].overdue, 1);
  assert.ok(k[ios.id].avgDays >= 0);
  assert.ok(!(pm.id in k)); // PM в KPI команды не входит
  assert.equal(d.period.days, 7);
});

test('RM: релиз — поля и чеклист, отправка в Apple, реджект с задачей PM, отправка снова, в сторе', async () => {
  const api = await setup();
  const { ceo, pm, rm, lead, ios, qa, aso, gold } = await studio(api);
  const { app, request } = await api.as(ceo, () => api('createApp', { name: 'Sleep', unitId: gold.id, priority: 'o_high' }));
  const st = Object.fromEntries((await api.as(pm, () => api('decomposeRequest', { taskId: request.id }))).map(t => [t.step, t]));
  await api.as(lead, () => api('setTaskLink', { taskId: st.design.id, fieldId: 'lf_figma', url: 'https://figma.com/x' }));
  for (const [who, k] of [[lead, 'design'], [ios, 'ios'], [qa, 'qa'], [aso, 'meta']]) await api.as(who, () => api('updateTask', { id: st[k].id, patch: { status: 'done' } }));
  const rel = await api.as(pm, () => api('sendToRelease', { taskId: st.release.id }));
  assert.equal(rel.checklist.length, 4); // чеклист релиза студии подставился

  await api.as(rm, async () => {
    let d = await api('getRmDashboard', {});
    assert.equal(d.queue.length, 1);
    assert.deepEqual(d.queue[0].missing, ['Версия', 'Номер сборки', 'Что нового']);
    assert.deepEqual(d.queue[0].checklist, { done: 0, total: 4 });
    const card = await api('getRelease', { taskId: st.release.id });
    assert.equal(card.app.name, 'Sleep');
    assert.deepEqual(card.links.map(l => [l.stage, l.name]), [['Дизайн', 'Figma']]); // ссылки других этапов RM видит
    // напрямую фазу не поменять — только кнопками
    await assert.rejects(() => api.pg.query(`update tasks set release = '{"phase":"live"}' where id = $1`, [st.release.id]), /Недостаточно прав/);
    await assert.rejects(() => api('releaseStep', { taskId: st.release.id, action: 'submit' }), /Версия/);
    await api('saveReleaseValues', { taskId: st.release.id, values: { version: '1.0', build: '42', whatsnew: 'Первый релиз', hack: 'x' } });
    await assert.rejects(() => api('releaseStep', { taskId: st.release.id, action: 'submit' }), /чеклист/);
    await api('updateTask', { id: st.release.id, patch: { checklist: rel.checklist.map(i => ({ ...i, done: true })) } });
    const s1 = await api('releaseStep', { taskId: st.release.id, action: 'submit' });
    assert.equal(s1.task.release.phase, 'submitted');
    assert.deepEqual(s1.task.release.values, { version: '1.0', build: '42', whatsnew: 'Первый релиз' });
    d = await api('getRmDashboard', {});
    assert.equal(d.review.length, 1);
    await assert.rejects(() => api('releaseStep', { taskId: st.release.id, action: 'reject', reason: ' ' }), /причину/);
    const rj = await api('releaseStep', { taskId: st.release.id, action: 'reject', reason: 'Guideline 3.1.2' });
    assert.ok(rj.rejectRequestId);
    assert.equal((await api('getRmDashboard', {})).rejected[0].reason, 'Guideline 3.1.2');
  });
  const appNow = id => api.as(ceo, async () => (await api('listApps', {})).find(a => a.id === id));
  assert.equal((await appNow(app.id)).status, 'reject');
  await api.as(pm, async () => {
    const n = await api('getNotifications', {});
    const fix = (await api('getBoard', { unitId: gold.id })).tasks.find(t => t.title === 'Реджект: Guideline 3.1.2');
    assert.ok(fix && fix.kind === 'request' && fix.assigneeId === pm.id && fix.fields.f_priority === 'o_high');
    assert.ok(n.some(x => x.taskId === fix.id));
  });
  await api.as(rm, async () => {
    await api('releaseStep', { taskId: st.release.id, action: 'resubmit' });
    const done = await api('releaseStep', { taskId: st.release.id, action: 'live' });
    assert.equal(done.task.release.phase, 'live');
    assert.equal(done.task.status, 'done');
    assert.deepEqual(await api('getRmDashboard', {}), { queue: [], review: [], rejected: [] });
  });
  assert.equal((await appNow(app.id)).status, 'live');
  const reqNow = await api.as(ceo, async () => (await api('getBoard', { unitId: gold.id })).tasks.find(t => t.id === request.id));
  assert.equal(reqNow.status, 'done'); // задача CEO закрыта вместе с релизом
  // настройки релиза: CEO и RM, PM — нет
  await api.as(pm, () => assert.rejects(() => api('saveReleaseSettings', { checklist: ['x'] }), forbidden));
  await api.as(rm, async () => assert.deepEqual((await api('saveReleaseSettings', { checklist: ['Сборка', ''] })).checklist, ['Сборка']));
});

test('сотрудник и лид: «Можно начинать», фокус, очередь ревью, загрузка позиции, передача этапа', async () => {
  const api = await setup();
  const { ceo, pm, lead, ios, qa, gold } = await studio(api);
  const des = await api('createPerson', { name: 'Дизайнер', email: 'des@x.ru', access: 'member', positionId: 'd_design' });
  await api.pg.query('update people set user_id = $1 where id = $2', [UID(99), des.id]);
  const designer = { ...des, uid: UID(99) };
  await api('setMember', { unitId: gold.id, personId: designer.id });
  const day = new Date().toISOString().slice(0, 10);
  const { request } = await api.as(ceo, () => api('createApp', { name: 'Sleep', unitId: gold.id }));
  const st = Object.fromEntries((await api.as(pm, () => api('decomposeRequest', { taskId: request.id }))).map(t => [t.step, t]));
  assert.equal(st.design.assigneeId, lead.id);

  // лид передаёт дизайн дизайнеру; не своей позиции и не лиду — нельзя
  await api.as(lead, () => assert.rejects(() => api('handOverTask', { taskId: st.design.id, personId: ios.id }), /этой позиции/));
  await api.as(ios, () => assert.rejects(() => api('handOverTask', { taskId: st.ios.id, personId: designer.id }), /лид/));
  assert.equal((await api.as(lead, () => api('handOverTask', { taskId: st.design.id, personId: designer.id }))).assigneeId, designer.id);
  await api.as(designer, async () => assert.ok((await api('getNotifications', {})).some(n => n.taskId === st.design.id && n.kind === 'assigned')));

  // фокус: просроченное — первым, заблокированные этапы — не в фокусе
  await api.as(pm, () => api('updateTask', { id: st.design.id, patch: { dueDate: '2020-01-01' } }));
  await api.as(designer, async () => {
    const d = await api('getMyDashboard', { personId: designer.id, today: day });
    assert.equal(d.focus[0].id, st.design.id);
    assert.equal(d.focus[0].reason, 'overdue');
    assert.equal(d.lead, null);
  });
  await api.as(ios, async () => assert.ok(!(await api('getMyDashboard', { personId: ios.id, today: day })).focus.some(t => t.id === st.ios.id)));

  // ревью дизайна — у лида: в очереди, «Принять» → готово
  await api('updateUnit', { id: gold.id, settings: { ...(await api('getBoard', { unitId: gold.id })).unit.settings, review: { column: 'review', byPosition: { d_design: lead.id }, default: pm.id } } });
  await api.as(designer, () => api('updateTask', { id: st.design.id, patch: { status: 'review' } }));
  const ld = await api.as(lead, () => api('getMyDashboard', { personId: lead.id, today: day }));
  const rv = ld.lead.reviews.find(x => x.id === st.design.id);
  assert.ok(rv);
  assert.equal(rv.authorId, designer.id);
  assert.equal(rv.acceptStatus, 'done');
  assert.equal(rv.returnStatus, 'in_progress');
  assert.deepEqual(ld.lead.team.map(x => x.personId).sort(), [lead.id, designer.id].sort());
  await api.as(lead, () => api('updateTask', { id: st.design.id, patch: { status: rv.acceptStatus } }));

  // дизайн закрыт → iOS «Можно начинать», QA ещё ждёт
  await api.as(ios, async () => assert.ok((await api('getNotifications', {})).some(n => n.taskId === st.ios.id && n.kind === 'unblocked')));
  await api.as(qa, async () => assert.ok(!(await api('getNotifications', {})).some(n => n.kind === 'unblocked')));
});

test('сменить ответственного за юнит: новый PM в составе, прежний — нет, открытые задачи CEO переходят новому', async () => {
  const api = await setup();
  const { ceo, pm, pmRf, ios, gold } = await studio(api);
  const { request } = await api.as(ceo, () => api('createApp', { name: 'Sleep Sounds', unitId: gold.id }));
  assert.equal(request.assigneeId, pm.id);
  await api.as(ceo, () => api('setUnitPm', { unitId: gold.id, personId: pmRf.id }));
  const members = (await api('getBoard', { unitId: gold.id })).members.map(m => m.personId);
  assert.ok(members.includes(pmRf.id) && !members.includes(pm.id));
  const tasks = (await api('getBoard', { unitId: gold.id })).tasks;
  assert.equal(tasks.find(t => t.id === request.id).assigneeId, pmRf.id);
  await api.as(ceo, () => assert.rejects(() => api('setUnitPm', { unitId: gold.id, personId: ios.id }), /только PM/));
});

test('заметки к приложению: видят те, кто видит приложение; автор — тот, кто пишет; удаляет автор или CEO', async () => {
  const api = await setup();
  const { ceo, pm, pmRf, gold } = await studio(api);
  const { app } = await api.as(ceo, () => api('createApp', { name: 'Notes App', unitId: gold.id }));
  const n = await api.as(pm, () => api('addAppNote', { appId: app.id, text: 'Идея: виджет на экран блокировки' }));
  await api.as(ceo, async () => {
    const list = await api('getAppNotes', { appId: app.id });
    assert.equal(list.length, 1);
    assert.equal(list[0].authorId, pm.id);
  });
  await api.as(pmRf, async () => {
    assert.equal((await api('getAppNotes', { appId: app.id })).length, 0); // чужой юнит — не видно
    await assert.rejects(() => api('deleteAppNote', { id: n.id }), forbidden);
  });
  await api.as(ceo, () => api('deleteAppNote', { id: n.id }));
});

test('иконка из App Store: только картинки Apple; ссылка на стор — в поле «App Store»', async () => {
  const api = await setup();
  const { ceo, gold } = await studio(api);
  const { app } = await api.as(ceo, () => api('createApp', {
    name: 'Store App', unitId: gold.id, storeUrl: 'https://apps.apple.com/us/app/x/id123', iconUrl: 'https://is1-ssl.mzstatic.com/image/thumb/a.png/512x512bb.jpg',
  }));
  assert.ok(app.iconUrl.startsWith('https://is1-ssl.mzstatic.com/'));
  assert.ok(Object.values(app.info).includes('https://apps.apple.com/us/app/x/id123'));
  const bad = await api.as(ceo, () => api('updateApp', { id: app.id, iconUrl: 'https://evil.example.com/x.png' }));
  assert.equal(bad.iconUrl, '');
});

test('удаление приложений: только CEO, вместе с задачами', async () => {
  const api = await setup();
  const { ceo, pm, gold } = await studio(api);
  const { app, request } = await api.as(ceo, () => api('createApp', { name: 'Gone', unitId: gold.id }));
  const keep = await api.as(ceo, () => api('createApp', { name: 'Keep', unitId: gold.id, noRequest: true }));
  await api.as(pm, () => assert.rejects(() => api('deleteApps', { ids: [app.id] }), forbidden));
  const r = await api.as(ceo, () => api('deleteApps', { ids: [app.id] }));
  assert.deepEqual(r, { apps: 1, tasks: 1 });
  await api.as(ceo, async () => {
    assert.deepEqual((await api('listApps', {})).map(a => a.name), ['Keep']);
    await assert.rejects(() => api('getTask', { id: request.id }));
  });
  assert.ok(keep.app.id);
});

test('массовая правка приложений: статус и юнит', async () => {
  const api = await setup();
  const { ceo, pm, gold, rf } = await studio(api);
  const a = await api.as(ceo, () => api('createApp', { name: 'A', unitId: gold.id, noRequest: true }));
  const b = await api.as(ceo, () => api('createApp', { name: 'B', unitId: gold.id }));
  const ids = [a.app.id, b.app.id];
  const r = await api.as(ceo, () => api('updateApps', { ids, status: 'button', unitId: rf.id, priority: 'o_high' }));
  assert.deepEqual(r.map(x => [x.status, x.unitId, x.priority]), [['button', rf.id, 'o_high'], ['button', rf.id, 'o_high']]);
  assert.deepEqual((await api.as(ceo, () => api('updateApps', { ids, priority: '' }))).map(x => x.priority), ['', '']);
  // задачи переехали вместе с приложением
  const apps = await api.as(ceo, () => api('listApps', {}));
  assert.ok(apps.find(x => x.id === b.app.id).requests.every(q => q.unitId === rf.id));
  // PM чужого юнита не может
  await api.as(pm, () => assert.rejects(() => api('updateApps', { ids, status: 'live' })));
});

test('проверка App Store: итог сохраняется, «Обновлено» не трогает; в «Требует внимания» дашборда не дублируется', async () => {
  const api = await setup();
  const { ceo, pmRf, gold } = await studio(api);
  const { app } = await api.as(ceo, () => api('createApp', { name: 'Gone', unitId: gold.id, noRequest: true }));
  const ok = await api.as(ceo, () => api('createApp', { name: 'Ok', unitId: gold.id, noRequest: true }));
  assert.equal(app.storeOk, null);
  await api.as(ceo, () => api('saveStoreCheck', { items: [{ id: app.id, ok: false }, { id: ok.app.id, ok: true, storeName: 'Ok Store' }] }));
  const list = await api.as(ceo, () => api('listApps', {}));
  const gone = list.find(x => x.id === app.id);
  assert.equal(gone.storeOk, false);
  assert.ok(gone.storeCheckedAt);
  assert.equal(gone.updatedAt, app.updatedAt);
  assert.equal(list.find(x => x.id === ok.app.id).storeName, 'Ok Store');
  const d = await api.as(ceo, () => api('getCeoDashboard', {}));
  // пропавшие показывает блок «Проверка App Store», в «Требует внимания» их нет
  assert.ok(!d.attention.some(x => x.app.id === app.id));
  // PM чужого юнита отметку не поставит
  assert.equal((await api.as(pmRf, () => api('saveStoreCheck', { items: [{ id: ok.app.id, ok: false }] }))).saved, 0);
});

test('Info приложения: общие пункты (CEO), отметки и свои пункты у приложения', async () => {
  const api = await setup();
  const { ceo, pm, ios, gold } = await studio(api);
  const items = await api.as(ceo, () => api('saveAppInfoItems', { items: [{ name: 'Продуктовый апдейт' }, { name: 'Новый пейвол' }, { name: ' ' }] }));
  assert.deepEqual(items.map(x => x.name), ['Продуктовый апдейт', 'Новый пейвол']);
  await api.as(pm, () => assert.rejects(() => api('saveAppInfoItems', { items: [] })));
  const { app } = await api.as(ceo, () => api('createApp', { name: 'A', unitId: gold.id, noRequest: true }));
  assert.deepEqual(app.checks, { done: [], own: [] });
  // PM юнита отмечает пункт и добавляет свой
  const upd = await api.as(pm, () => api('updateApp', { id: app.id, checks: { done: [items[0].id], own: [{ name: 'Интеграция с Roku API', done: false }] } }));
  assert.deepEqual(upd.checks.done, [items[0].id]);
  assert.equal(upd.checks.own[0].name, 'Интеграция с Roku API');
  assert.ok(upd.checks.own[0].id);
  // сотрудник отметки не меняет
  await api.as(ios, () => assert.rejects(() => api('updateApp', { id: app.id, checks: { done: [] } })));
  const boot = await api.as(ceo, () => api('bootstrap', {}));
  assert.equal(boot.appInfoItems.length, 2);
});

test('Быстрый доступ: свои поля приложения', async () => {
  const api = await setup();
  const { ceo, pm, ios, gold } = await studio(api);
  const { app } = await api.as(ceo, () => api('createApp', { name: 'A', unitId: gold.id, noRequest: true }));
  assert.deepEqual(app.ownFields, []);
  const upd = await api.as(pm, () => api('updateApp', { id: app.id, ownFields: [{ name: 'RevenueCat', kind: 'link', value: 'app.revenuecat.com/x' }, { name: 'Bundle', kind: 'text', value: 'com.x.a' }, { name: '' }] }));
  assert.deepEqual(upd.ownFields.map(x => [x.name, x.kind, x.value]), [['RevenueCat', 'link', 'https://app.revenuecat.com/x'], ['Bundle', 'text', 'com.x.a']]);
  await api.as(ios, () => assert.rejects(() => api('updateApp', { id: app.id, ownFields: [] })));
});

test('queryTasks по ids — для «Отслеживаю» на дашборде', async () => {
  const api = await setup();
  const { ceo, gold } = await studio(api);
  const a = await api.as(ceo, () => api('createApp', { name: 'A', unitId: gold.id }));
  const b = await api.as(ceo, () => api('createApp', { name: 'B', unitId: gold.id }));
  const got = await api.as(ceo, () => api('queryTasks', { ids: [a.request.id] }));
  assert.deepEqual(got.map(t => t.id), [a.request.id]);
  assert.ok(got[0].statusName && got[0].key);
  assert.deepEqual(await api.as(ceo, () => api('queryTasks', { ids: [] })), []);
  assert.ok(b.request.id);
});
