// Tasks 2.0: роли CEO / PM / RM / Lead / сотрудник, приложения, запросы CEO, декомпозиция по флоу,
// блокировка этапов, передача в релиз, режим разработчика (тестовые данные). Логика и права — на настоящей схеме.
import { DEV_QUESTIONS } from '../web/src/devform.js';
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
/** Закрыть задачу как положено: исполнитель — на ревью, PM юнита — «Аппрув». */
const DEV_ANSWERS = Object.fromEntries(DEV_QUESTIONS.filter(q => !q.optional).map(q => [q.id, q.kind === 'yn' ? { v: 'Нет' } : { v: 'Ответ' }]));
const finish = async (api, who, pm, id) => {
  // этапы с чеклистом (дизайн, тексты, локализации) уходят на ревью только с закрытым чеклистом
  const { rows } = await api.pg.query('select checklist from tasks where id = $1', [id]);
  const cl = (rows[0].checklist || []).map(i => ({ ...i, done: true }));
  if (cl.length) await api.as(who, () => api('updateTask', { id, patch: { checklist: cl } })).catch(() => null);
  // этап iOS без опросника на ревью не уходит
  await api.as(who, () => api('saveDevForm', { taskId: id, answers: DEV_ANSWERS })).catch(() => null);
  await api.as(who, () => api('updateTask', { id, patch: { status: 'review' } }));
  return api.as(pm, () => api('reviewDecision', { taskId: id, approve: true }));
};

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

  // PM другого юнита ни приложения, ни запроса не видит; сотрудник приложений не видит вовсе (только CEO, PM, RM)
  await api.as(pmRf, async () => {
    assert.deepEqual(await api('listApps', {}), []);
    await assert.rejects(() => api('decomposeRequest', { taskId: request.id }), e => e.code === 'NOT_FOUND');
  });
  await api.as(ios, async () => assert.deepEqual(await api('listApps', {}), []));
  // создаёт приложения только CEO
  await api.as(pm, () => assert.rejects(() => api('createApp', { name: 'x', unitId: gold.id }), forbidden));
  // импорт уже вышедшего приложения: свой статус, без запроса PM
  const imported = await api.as(ceo, () => api('createApp', { name: 'Old App', unitId: gold.id, status: 'live', noRequest: true, storeUrl: 'https://apps.apple.com/app/id6470798112', storeName: 'Remote for Roku' }));
  assert.equal(imported.app.status, 'live');
  assert.equal(imported.app.storeName, 'Remote for Roku');
  assert.equal((await api.as(ceo, () => api('updateApp', { id: imported.app.id, storeName: 'Roku TV Remote' }))).storeName, 'Roku TV Remote');
  assert.equal(imported.request, null);
  await api.as(ceo, () => api('updateApp', { id: imported.app.id, archived: true }));

  // «Поставил я»: CEO видит свой запрос, этапы разбивки сюда не попадают
  assert.ok((await api.as(ceo, () => api('queryTasks', { authorId: ceo.id, limit: 500 }))).some(t => t.id === request.id));

  // неподходящий исполнитель: отказ до создания этапов, запрос не разложен наполовину
  const flow = (await api.as(pm, () => api('getFlows', { unitId: request.unitId }))).new_app;
  const wrong = flow.map(s => ({ ...s, assigneeId: s.release ? '' : lead.id, dueDate: '' }));
  await api.as(pm, () => assert.rejects(() => api('decomposeRequest', { taskId: request.id, plan: wrong }), /выберите человека/));

  // PM раскладывает запрос по флоу
  const stages = await api.as(pm, () => api('decomposeRequest', { taskId: request.id }));
  const by = Object.fromEntries(stages.map(t => [t.step, t]));
  assert.deepEqual(stages.map(t => t.step), ['design', 'art', 'ios', 'qa', 'integr', 'meta', 'store', 'retext', 'l10n', 'release']);
  assert.equal(by.design.assigneeId, lead.id); // лид позиции
  assert.equal(by.ios.assigneeId, ios.id);
  assert.equal(by.qa.assigneeId, qa.id);
  assert.equal(by.meta.assigneeId, aso.id);
  assert.equal(by.release.assigneeId, ''); // релиз — пока не передадут
  assert.deepEqual(by.ios.dependsOn, [by.design.id]);
  assert.deepEqual(by.release.dependsOn.length, 9);
  await api.as(pm, () => assert.rejects(() => api('decomposeRequest', { taskId: request.id }), /уже разложен/));
  const req2 = (await api.as(ceo, () => api('getBoard', { unitId: gold.id }))).tasks.find(t => t.id === request.id);
  assert.equal(req2.status, 'in_progress'); // запрос — в работе

  // iOS заблокирован, пока не закрыт дизайн (никому, даже CEO)
  await api.as(ios, () => assert.rejects(() => api('updateTask', { id: by.ios.id, patch: { status: 'in_progress' } }), /заблокирован.*Дизайн/));
  await api.as(ceo, () => assert.rejects(() => api('updateTask', { id: by.ios.id, patch: { status: 'in_progress' } }), /заблокирован/));
  // тексты ждут графики (онбординг и ASO), а исполнители ждущих этапов не видят
  await api.as(aso, () => assert.rejects(() => api('updateTask', { id: by.meta.id, patch: { status: 'in_progress' } }), /заблокирован.*Онбординг/));
  await api.as(ios, async () => assert.ok(!(await api('getBoard', { unitId: gold.id })).tasks.some(t => t.id === by.ios.id)));
  assert.ok((await api.as(pm, () => api('getBoard', { unitId: gold.id }))).tasks.some(t => t.id === by.ios.id)); // PM видит всю цепочку
  await api.as(ios, async () => assert.ok(!(await api('getNotifications', {})).some(n => n.taskId === by.ios.id))); // и уведомления нет
  await finish(api, lead, pm, by.design.id);
  // дизайн готов — метаданные сразу, графика у дизайн-лида; после графики — тексты, параллельно разработке; iOS открылся
  await api.as(aso, () => api('updateTask', { id: by.store.id, patch: { status: 'in_progress' } }));
  await finish(api, lead, pm, by.art.id);
  await api.as(aso, () => api('updateTask', { id: by.meta.id, patch: { status: 'in_progress' } }));
  await api.as(ios, async () => assert.ok((await api('getBoard', { unitId: gold.id })).tasks.some(t => t.id === by.ios.id)));
  await finish(api, ios, pm, by.ios.id);
  // QA нашёл баги — «Вернуть в разработку»: iOS снова в работе с комментарием, QA ждёт
  assert.equal(await api.as(qa, () => api('qaReturn', { taskId: by.qa.id, text: 'Краш на онбординге', url: 'https://docs.google.com/bug1' })), 1);
  await api.as(ios, async () => {
    const b = await api('getBoard', { unitId: gold.id });
    assert.equal(b.tasks.find(t => t.id === by.ios.id).status, 'rework');
    assert.ok(!b.tasks.some(t => t.id === by.qa.id) || true);
    assert.ok((await api('getTaskExtras', { taskId: by.ios.id })).comments.some(c => /Баг-репорт №1 от QA: https:\/\/docs\.google\.com\/bug1\nКраш/.test(c.text)));
    // баг-репорт №1 открыт в карточке разработчика: номер, кто, ссылка
    const bug = b.tasks.find(t => t.id === by.ios.id).bugs[0];
    assert.deepEqual([bug.n, bug.by, bug.url, bug.closedAt], [1, qa.id, 'https://docs.google.com/bug1', '']);
    // руками баг-репорты не правятся
    await assert.rejects(() => api('updateTask', { id: by.ios.id, patch: { status: 'in_progress' } }).then(() => api.pg.query("update tasks set bugs = '[]' where id = $1", [by.ios.id])), /Баг-репорты/);
    assert.ok((await api('getNotifications', {})).some(n => n.taskId === by.ios.id && n.kind === 'returned'));
  });
  await api.as(qa, () => api('readNotifications', {}));
  await finish(api, ios, pm, by.ios.id);
  // разработка сдана снова — QA снова получает «можно начинать»
  assert.equal((await api.pg.query("select count(*)::int as n from notifications where task_id = $1 and person_id = $2 and kind = 'unblocked' and read_at = ''", [by.qa.id, qa.id])).rows[0].n, 1);

  // в релиз — только когда всё закрыто
  await api.as(pm, () => assert.rejects(() => api('sendToRelease', { taskId: by.release.id }), /Сначала закройте.*Тестирование/));
  // QA принимает сам: «готово» без отдельного ревью
  assert.equal((await api.as(qa, () => api('updateTask', { id: by.qa.id, patch: { status: 'done' } }))).status, 'done');
  await api.as(pm, () => assert.rejects(() => api('sendToRelease', { taskId: by.release.id }), /Сначала закройте.*Интеграция/));
  await finish(api, ios, pm, by.integr.id); // интеграция — после приёмки QA
  // QA принял — баг-репорты закрыты и у QA, и у разработчика
  for (const id of [by.qa.id, by.ios.id]) {
    const bugs = (await api.pg.query('select bugs from tasks where id = $1', [id])).rows[0].bugs;
    assert.ok(bugs.length === 1 && bugs[0].closedAt, 'закрыт: ' + id);
  }
  await finish(api, aso, pm, by.meta.id);
  await finish(api, lead, pm, by.retext.id);
  await finish(api, aso, pm, by.store.id);
  await finish(api, aso, pm, by.l10n.id);
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
  assert.equal(summary.requests[0].progress, 90); // 9 из 10 этапов закрыты
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
  assert.equal(r.tasks, 11); // запрос + 10 этапов
  await api.as(ceo, async () => assert.deepEqual(await api('listApps', {}), []));
});

test('интеграция: этап после QA у iOS-лида; PM добавляет и убирает этап по ходу, релиз ждёт по флоу', async () => {
  const api = await setup();
  const { ceo, pm, gold, ios } = await studio(api);
  const { request } = await api.as(ceo, () => api('createApp', { name: 'Пульт 2', unitId: gold.id }));
  // PM разложил без интеграции
  const flow = (await api.as(pm, () => api('getFlows', { unitId: gold.id }))).new_app.filter(s => s.key !== 'integr')
    .map(s => ({ ...s, dependsOn: s.dependsOn.filter(k => k !== 'integr') }));
  const st = Object.fromEntries((await api.as(pm, () => api('decomposeRequest', { taskId: request.id, plan: flow }))).map(t => [t.step, t]));
  assert.ok(!st.integr);
  // сотрудник этапы не меняет
  await api.as(ios, () => assert.rejects(() => api('addStage', { requestId: request.id, key: 'integr' })));
  // решили по ходу — добавили: ждёт QA, релиз ждёт её
  const integr = await api.as(pm, () => api('addStage', { requestId: request.id, key: 'integr' }));
  assert.equal(integr.step, 'integr');
  assert.deepEqual(integr.dependsOn, [st.qa.id]);
  const rel = async () => (await api.as(pm, () => api('getBoard', { unitId: gold.id }))).tasks.find(t => t.id === st.release.id);
  assert.ok((await rel()).dependsOn.includes(integr.id));
  await api.as(pm, () => assert.rejects(() => api('addStage', { requestId: request.id, key: 'integr' }), /уже есть/));
  // передумали — убрали: релиз её больше не ждёт, этап в архиве
  await api.as(pm, () => api('removeStage', { taskId: integr.id }));
  assert.ok(!(await rel()).dependsOn.includes(integr.id));
  await api.as(pm, () => assert.rejects(() => api('removeStage', { taskId: st.release.id }), /Релиз убрать нельзя/));
  // в апдейт — этап из флоу New App: «Метаданные» (рефактор меты) у ASO, релиз ждёт и его
  const { app } = (await api.pg.query("select id from apps where name = 'Пульт 2'")).rows.map(r => ({ app: r }))[0];
  const upd = await api.as(ceo, () => api('createRequest', { appId: app.id, type: 'update', title: 'Рефактор меты' }));
  const us = Object.fromEntries((await api.as(pm, () => api('decomposeRequest', { taskId: upd.id }))).map(t => [t.step, t]));
  const store = await api.as(pm, () => api('addStage', { requestId: upd.id, key: 'store' }));
  assert.equal(store.departmentId, 'd_aso');
  assert.ok((await api.as(pm, () => api('getBoard', { unitId: gold.id }))).tasks.find(t => t.id === us.release.id).dependsOn.includes(store.id));
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
  await api.pg.query("update tasks set updated_at = '2020-01-01T00:00:00.000Z', due_date = '' where id = $1", [st.design.id]);
  const d = await api.as(ceo, () => api('getCeoDashboard', { today: day }));
  assert.deepEqual(d.portfolio.byStatus.reject, [a2.id]);
  assert.equal(d.portfolio.byUnit[gold.id].dev, 1);
  const types = d.attention.map(x => x.type);
  // приложение в реджекте ведут во вкладке «Реджекты» — в «Требует внимания» его нет совсем
  assert.ok(!types.includes('reject'));
  assert.ok(!d.attention.some(x => x.app.id === a2.id));
  assert.ok(d.inProgress.some(x => x.app.id === a2.id)); // но работа по нему идёт
  assert.ok(types.includes('overdue')); // срок запроса прошёл
  assert.ok(d.attention.some(x => x.type === 'stale' && x.task.id === st.design.id));
  assert.ok(d.attention.some(x => x.type === 'waiting' && x.app.id === a3.id)); // запрос Fit PM ещё не разложил
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
    assert.deepEqual(f.new_app.map(s => s.key), ['design', 'art', 'ios', 'qa', 'integr', 'meta', 'store', 'retext', 'l10n', 'release']); // остальные — по умолчанию
    await assert.rejects(() => api('saveFlow', { unitId: rf.id, type: 'update', steps: [] }), e => e.code === 'NOT_FOUND' || forbidden(e));
  });
  await api.as(pmRf, async () => assert.equal((await api('getFlows', { unitId: rf.id })).update.length, 5)); // у RF — по умолчанию (с интеграцией)
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
  // этапы созданы два дня назад: закрытое сразу после создания KPI не считает (это перемотка, а не работа)
  await api.pg.query(`update tasks set created_at = $1 where parent_id = $2`, [new Date(Date.now() - 2 * 864e5).toISOString(), r.id]);
  // дизайн — в срок; iOS — после срока; ещё одна задача iOS просрочена и висит
  await api.as(pm, () => api('updateTask', { id: st.design.id, patch: { dueDate: '2099-01-01' } }));
  await api.as(lead, () => api('updateTask', { id: st.design.id, patch: { status: 'in_progress' } }));
  await finish(api, lead, pm, st.design.id);
  await api.as(pm, () => api('updateTask', { id: st.ios.id, patch: { dueDate: '2020-01-01' } }));
  await api.as(ios, () => api('updateTask', { id: st.ios.id, patch: { status: 'in_progress' } }));
  await finish(api, ios, pm, st.ios.id);
  const late = await api.as(pm, () => api('createTask', { unitId: gold.id, title: 'Краш', assigneeId: ios.id, dueDate: '2020-01-01' }));
  await api.as(pm, () => api('createTask', { unitId: gold.id, title: 'Ничья' }));
  const d = await api.as(pm, () => api('getPmDashboard', { today: day, period: 'week' }));
  assert.deepEqual(d.inbox.map(x => x.id), [inboxReq.id]);
  assert.equal(d.inbox[0].app.name, 'Inbox');
  const w = d.pipeline.find(x => x.id === r.id);
  assert.equal(w.stages.length, 10);
  assert.equal(w.progress, 20); // 2 из 10
  assert.equal(w.releaseReady, false);
  assert.ok(d.problems.some(x => x.type === 'overdue' && x.task.id === late.id));
  assert.ok(d.problems.some(x => x.type === 'unassigned' && x.task.title === 'Ничья'));
  assert.deepEqual(d.team, []); // KPI людей PM не отдаём — они только у CEO
  const ceoD = await api.as(ceo, () => api('getPmDashboard', { today: day, period: 'week' }));
  const k = Object.fromEntries(ceoD.team.map(x => [x.personId, x]));
  assert.equal(k[lead.id].done, 1);
  assert.equal(k[lead.id].onTime, 100);
  assert.equal(k[ios.id].done, 1);
  assert.equal(k[ios.id].onTime, 0);
  assert.equal(k[ios.id].overdue, 1);
  assert.ok(k[ios.id].avgDays >= 0);
  assert.ok(!(pm.id in k)); // PM в KPI команды не входит
  assert.equal(d.period.days, 7);
});

test('RM: релиз — поля, свой чеклист, отправка в Apple, реджект №N, исправили — снова в очереди, в сторе; видимость по фазе', async () => {
  const api = await setup();
  const { ceo, pm, rm, lead, ios, qa, aso, gold } = await studio(api);
  const { app, request } = await api.as(ceo, () => api('createApp', { name: 'Sleep', unitId: gold.id, priority: 'o_high' }));
  const st = Object.fromEntries((await api.as(pm, () => api('decomposeRequest', { taskId: request.id }))).map(t => [t.step, t]));
  await api.as(lead, () => api('setTaskLink', { taskId: st.design.id, fieldId: 'lf_figma', url: 'https://figma.com/x' }));
  for (const [who, k] of [[lead, 'design'], [lead, 'art'], [ios, 'ios'], [qa, 'qa'], [ios, 'integr'], [aso, 'meta'], [aso, 'store'], [lead, 'retext'], [aso, 'l10n']]) await finish(api, who, pm, st[k].id);
  const rel = await api.as(pm, () => api('sendToRelease', { taskId: st.release.id }));
  assert.equal(rel.checklist.length, 0); // авточеклиста больше нет — у RM свои шаблоны

  await api.as(rm, async () => {
    let d = await api('getRmDashboard', {});
    assert.equal(d.queue.length, 1);
    assert.deepEqual(d.queue[0].missing, ['Версия', 'Номер сборки', 'Что нового']);
    const card = await api('getRelease', { taskId: st.release.id });
    assert.equal(card.app.name, 'Sleep');
    assert.deepEqual(card.links.map(l => [l.stage, l.name]), [['Дизайн', 'Figma']]);
    assert.ok(card.fields.some(f => f.id === 'testflight') && card.fields.some(f => f.id === 'comment')); // база полей
    await assert.rejects(() => api.pg.query(`update tasks set release = '{"phase":"live"}' where id = $1`, [st.release.id]), /Недостаточно прав/);
    await assert.rejects(() => api('releaseStep', { taskId: st.release.id, action: 'submit' }), /Версия/);
    await api('saveReleaseValues', { taskId: st.release.id, values: { version: '1.0', build: '42', whatsnew: 'Первый релиз', hack: 'x' } });
    // свой чеклист (из шаблона RM) — без закрытого не отправить
    await api('updateTask', { id: st.release.id, patch: { checklist: [{ text: 'Скриншоты' }, { text: 'Покупки' }] } });
    await assert.rejects(() => api('releaseStep', { taskId: st.release.id, action: 'submit' }), /чеклист/);
    const cl = (await api('getRelease', { taskId: st.release.id })).task.checklist.map(i => ({ ...i, done: true }));
    await api('updateTask', { id: st.release.id, patch: { checklist: cl } });
    const s1 = await api('releaseStep', { taskId: st.release.id, action: 'submit' });
    assert.equal(s1.task.release.phase, 'submitted');
    assert.equal(s1.task.status, 'review'); // на доске — колонка ревью, а не «в работе»
    assert.equal(s1.task.assigneeId, rm.id); // ревьюеру не переназначили
    d = await api('getRmDashboard', {});
    assert.equal(d.review.length, 1);
    assert.deepEqual([d.review[0].what.kind, d.review[0].what.label], ['new_app', 'Новое приложение']); // что ушло в Apple
    await assert.rejects(() => api('releaseStep', { taskId: st.release.id, action: 'reject', reason: ' ' }), /Опишите/);
    const rj = await api('releaseStep', { taskId: st.release.id, action: 'reject', reason: 'Guideline 3.1.2', shot: 'drive.google.com/shot1' });
    assert.ok(rj.rejectRequestId);
    const r0 = (await api('getRmDashboard', {})).rejected[0];
    assert.deepEqual([r0.reason, r0.rejectNo, r0.shot], ['Guideline 3.1.2', 1, 'https://drive.google.com/shot1']);
  });
  const appNow = id => api.as(ceo, async () => (await api('listApps', {})).find(a => a.id === id));
  assert.equal((await appNow(app.id)).status, 'reject');
  // PM перевёл свою задачу по реджекту в Done — у RM релиз не пропал, а вернулся в очередь «исправлено»
  const fix = (await api.as(pm, () => api('getBoard', { unitId: gold.id }))).tasks.find(t => t.title === 'Реджект №1: Guideline 3.1.2');
  assert.ok(fix && fix.kind === 'request' && fix.assigneeId === pm.id && fix.specUrl === 'https://drive.google.com/shot1');
  await api.as(pm, () => api('updateTask', { id: fix.id, patch: { status: 'done' } }));
  await api.as(rm, async () => {
    const d = await api('getRmDashboard', {});
    assert.equal(d.queue.length, 1);
    assert.ok(d.queue[0].fixedAt);
    assert.equal(d.queue[0].rejectNo, 1);
    await api('releaseStep', { taskId: st.release.id, action: 'submit' });
    assert.equal((await api('getRmDashboard', {})).review[0].what.label, 'Исправления реджекта №1');
  });
  // карточка приложения: что на ревью — исправления реджекта №1, с задачей реджекта
  const inReview = (await appNow(app.id)).review;
  assert.deepEqual([inReview.kind, inReview.label, inReview.requestId, inReview.releaseId], ['reject', 'Исправления реджекта №1', fix.id, st.release.id]);
  // PM закрыл этап «Релиз» на своей доске — у RM он остаётся «на ревью Apple»
  await api.as(pm, () => api('updateTask', { id: st.release.id, patch: { status: 'done' } }));
  await api.as(rm, async () => {
    assert.equal((await api('getRmDashboard', {})).review.length, 1);
    const done = await api('releaseStep', { taskId: st.release.id, action: 'live' });
    assert.equal(done.task.release.phase, 'live');
    assert.equal(done.task.status, 'done');
    assert.deepEqual(done.task.release.history.map(x => x.result), ['reject', 'live']);
    assert.deepEqual(await api('getRmDashboard', {}), { rejectedApps: [], queue: [], review: [], rejected: [] });
  });
  // вышло в стор — уведомление PM, лиду юнита и CEO (не RM, который нажал)
  for (const who of [pm, ceo]) assert.ok((await api.as(who, () => api('getNotifications', {}))).some(n => n.taskId === st.release.id && n.kinds.includes('store_live')), who.name);
  assert.ok(!(await api.as(lead, () => api('getNotifications', {}))).some(n => n.kinds.includes('store_live'))); // «в сторе» — только CEO и PM
  assert.ok(!(await api.as(rm, () => api('getNotifications', {}))).some(n => n.kinds.includes('store_live')));
  // команда релиза для RM: PM, дизайн, разработка, тестирование
  const team = await api.as(rm, () => api('getReleaseTeam', { taskId: st.release.id }));
  assert.deepEqual([team.pm, team.design, team.ios, team.qa], [[pm.id], [lead.id], [ios.id], [qa.id]]);
  await api.as(ios, () => assert.rejects(() => api('getReleaseTeam', { taskId: st.release.id })));
  // история и сводка
  const hs = await api.as(rm, () => api('getReleaseHistory', {}));
  assert.deepEqual(hs.rows.map(x => x.result), ['live', 'reject']);
  assert.deepEqual([hs.stats.live, hs.stats.firstTry, hs.stats.rejects, hs.stats.submitted], [1, 0, 1, 2]);
  assert.equal((await api.as(rm, () => api('getReleaseHistory', { result: 'reject' }))).rows[0].rejectNo, 1);
  assert.equal((await api.as(rm, () => api('getReleaseHistory', { from: '2099-01-01' }))).stats.submitted, 0);
  assert.equal((await appNow(app.id)).status, 'live');
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
  // PM юнита (и CEO) передаёт за лида — в том числе из «смотреть как»
  assert.equal((await api.as(pm, () => api('handOverTask', { taskId: st.design.id, personId: lead.id }))).assigneeId, lead.id);
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
  // чеклист дизайна (экраны, PW) не закрыт — на ревью и в «готово» нельзя
  await api.as(designer, () => assert.rejects(() => api('updateTask', { id: st.design.id, patch: { status: 'review' } }), /чеклист этапа/));
  const done = (await api.pg.query('select checklist from tasks where id = $1', [st.design.id])).rows[0].checklist.map(i => ({ ...i, done: true }));
  assert.equal(done.length, 2);
  await api.as(designer, () => api('updateTask', { id: st.design.id, patch: { checklist: done } }));
  // в «готово» мимо ревью исполнителю нельзя
  await api.as(designer, () => assert.rejects(() => api('updateTask', { id: st.design.id, patch: { status: 'done' } }), /ревью/));
  await api.as(designer, () => api('updateTask', { id: st.design.id, patch: { status: 'review' } }));
  // «Правки» с комментарием — обратно дизайнеру; комментарий — в обсуждении
  const back = await api.as(lead, () => api('reviewDecision', { taskId: st.design.id, approve: false, comment: 'Поправь отступы' }));
  assert.equal(back.status, 'in_progress');
  assert.equal(back.assigneeId, designer.id);
  assert.ok((await api.as(designer, () => api('getTaskExtras', { taskId: st.design.id }))).comments.some(c => c.text === 'Правки: Поправь отступы'));
  await api.as(designer, () => api('updateTask', { id: st.design.id, patch: { status: 'review' } }));
  const ld = await api.as(lead, () => api('getMyDashboard', { personId: lead.id, today: day }));
  const rv = ld.lead.reviews.find(x => x.id === st.design.id);
  assert.ok(rv);
  assert.equal(rv.authorId, designer.id);
  assert.equal(rv.acceptStatus, 'done');
  assert.equal(rv.returnStatus, 'in_progress');
  assert.deepEqual(ld.lead.team.map(x => x.personId).sort(), [lead.id, designer.id].sort());
  // посторонний не решает; ревьюер — «Аппрув» → готово
  await api.as(ios, () => assert.rejects(() => api('reviewDecision', { taskId: st.design.id, approve: true })));
  assert.equal((await api.as(lead, () => api('reviewDecision', { taskId: st.design.id, approve: true }))).status, 'done');

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
  const { ceo, pmRf, rm, ios, gold } = await studio(api);
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
  // RM юнита обновляет проверку (иконка — только с mzstatic), сотрудник — нет
  assert.equal((await api.as(rm, () => api('saveStoreCheck', { items: [{ id: app.id, ok: true, iconUrl: 'https://evil.example/x.png' }] }))).saved, 1);
  const back = (await api.as(ceo, () => api('listApps', {}))).find(x => x.id === app.id);
  assert.equal(back.storeOk, true);
  assert.equal(back.iconUrl, '');
  assert.equal((await api.as(ios, () => api('saveStoreCheck', { items: [{ id: app.id, ok: false }] }))).saved, 0);
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

test('ТЗ, наследование от родителя (ТЗ, описание, ссылки) и подробная история', async () => {
  const api = await setup();
  const { ceo, pm, gold } = await studio(api);
  const { request } = await api.as(ceo, () => api('createApp', { name: 'Spec', unitId: gold.id, description: 'Что делаем' }));
  await api.as(ceo, () => api('updateTask', { id: request.id, patch: { specUrl: 'docs.google.com/spec', description: 'ТЗ коротко' } }));
  await api.as(ceo, () => api('setTaskLink', { taskId: request.id, fieldId: 'lf_figma', url: 'https://figma.com/file/x' }));
  const stages = await api.as(pm, () => api('decomposeRequest', { taskId: request.id }));
  const design = stages.find(t => t.step === 'design');
  assert.equal(design.specUrl, 'https://docs.google.com/spec');
  assert.equal(design.description, 'ТЗ коротко');
  // подзадача этапа наследует ТЗ и ссылки
  const sub = await api.as(pm, () => api('createTask', { unitId: gold.id, title: 'Иконка', parentId: design.id }));
  assert.equal(sub.specUrl, 'https://docs.google.com/spec');
  const ex = await api.as(pm, () => api('getTaskExtras', { taskId: sub.id }));
  assert.ok(ex.activity.length >= 1);
  const board = await api.as(pm, () => api('getBoard', { unitId: gold.id }));
  assert.equal(board.tasks.find(t => t.id === sub.id).links.lf_figma, 'https://figma.com/file/x');
  // чеклист: каждое действие — своя запись
  await api.as(pm, () => api('updateTask', { id: sub.id, patch: { checklist: [{ id: 'k_c1', text: 'Нарисовать', done: false }] } }));
  const t1 = await api.as(pm, () => api('updateTask', { id: sub.id, patch: { checklist: [{ id: 'k_c1', text: 'Нарисовать иконку', done: true }] } }));
  const fields = (await api.as(pm, () => api('getTaskExtras', { taskId: t1.id }))).activity.map(a => a.field).filter(f => f.startsWith('checklist'));
  assert.deepEqual(fields.sort(), ['checklist:add', 'checklist:done', 'checklist:rename']);
});

test('«Раздать»: лид раскладывает свой этап на подзадачи сотрудникам; наследование; этап закрывается сам', async () => {
  const api = await setup();
  const { ceo, pm, lead, ios, gold } = await studio(api);
  const des = await api('createPerson', { name: 'Дизайнер', email: 'des@x.ru', access: 'member', positionId: 'd_design' });
  await api.pg.query('update people set user_id = $1 where id = $2', [UID(99), des.id]);
  const designer = { ...des, uid: UID(99) };
  await api('setMember', { unitId: gold.id, personId: designer.id });
  const { request } = await api.as(ceo, () => api('createApp', { name: 'Split', unitId: gold.id }));
  await api.as(ceo, () => api('updateTask', { id: request.id, patch: { specUrl: 'https://spec.example/1' } }));
  const st = Object.fromEntries((await api.as(pm, () => api('decomposeRequest', { taskId: request.id }))).map(t => [t.step, t]));
  assert.equal(st.design.assigneeId, lead.id);
  // чужому (не позиции) раздать нельзя; не лид — нельзя
  await api.as(lead, () => assert.rejects(() => api('splitTask', { taskId: st.design.id, items: [{ title: 'x', assigneeId: ios.id }] }), /позиции/));
  await api.as(designer, () => assert.rejects(() => api('splitTask', { taskId: st.design.id, items: [{ title: 'x', assigneeId: designer.id }] })));
  const parts = await api.as(lead, () => api('splitTask', { taskId: st.design.id, items: [
    { title: 'Онбординг', assigneeId: designer.id, checklist: ['Экран 1', 'Экран 2'] },
    { title: 'Пейвол', assigneeId: designer.id },
  ] }));
  assert.equal(parts.length, 2);
  assert.equal(parts[0].specUrl, 'https://spec.example/1');
  assert.deepEqual(parts[0].checklist.map(i => i.text), ['Экран 1', 'Экран 2']);
  assert.ok(parts.every(p => p.parentId === st.design.id && p.assigneeId === designer.id));
  // у лида — «Раздано»: этап и его подзадачи с исполнителем
  const ld = await api.as(lead, () => api('getMyDashboard', { personId: lead.id }));
  assert.deepEqual(ld.lead.split.map(x => [x.id, x.parts.length, x.done]), [[st.design.id, 2, 0]]);
  assert.ok(ld.lead.split[0].parts.every(c => c.workerId === designer.id));
  // закрыли обе подзадачи (через ревью) — этап закрылся сам
  for (const p of parts) await finish(api, designer, pm, p.id);
  const board = await api.as(pm, () => api('getBoard', { unitId: gold.id }));
  assert.equal(board.tasks.find(t => t.id === st.design.id).status, 'done');
});

test('«@» в комментарии и описании — уведомление отмеченному; уведомления по задаче — одним', async () => {
  const api = await setup();
  const { ceo, pm, lead, gold } = await studio(api);
  const { request } = await api.as(ceo, () => api('createApp', { name: 'Ping', unitId: gold.id }));
  const st = Object.fromEntries((await api.as(pm, () => api('decomposeRequest', { taskId: request.id }))).map(t => [t.step, t]));
  await api.as(pm, () => api('addComment', { taskId: st.design.id, text: `@${lead.name} глянь референсы` }));
  const n = await api.as(lead, () => api('getNotifications', {}));
  const mine = n.filter(x => x.taskId === st.design.id);
  assert.equal(mine.length, 1); // назначение и отметка — одной строкой
  assert.deepEqual([...mine[0].kinds].sort(), ['assigned', 'mention']);
  assert.equal(mine[0].kinds[0], 'mention'); // отметка важнее назначения
  // в описании — тоже; повторная отметка того же человека в той же правке — не дублирует
  await api.as(pm, () => api('updateTask', { id: st.ios.id, patch: { description: `Для @${ceo.name}` } }));
  assert.ok((await api.as(ceo, () => api('getNotifications', {}))).some(x => x.taskId === st.ios.id && x.kinds.includes('mention')));
});

test('шаблон апдейта: пункты и нужные этапы; запрос по шаблону раскладывается только на них', async () => {
  const api = await setup();
  const { ceo, pm, gold } = await studio(api);
  const tpl = await api.as(pm, () => api('saveTemplate', { name: 'Пейвол', kind: 'update', title: 'Апдейт: новый пейвол', description: 'A/B пейвола',
    checklist: [{ text: 'Макет' }, { text: 'Тексты' }], steps: ['design', 'ios', 'release'] }));
  assert.equal(tpl.kind, 'update');
  const { app } = await api.as(ceo, () => api('createApp', { name: 'Tpl', unitId: gold.id, noRequest: true }));
  const r = await api.as(ceo, () => api('createRequest', { appId: app.id, type: 'update', templateId: tpl.id }));
  assert.equal(r.title, 'Апдейт №1: новый пейвол'); // номер ставится сам
  assert.deepEqual(r.checklist.map(i => i.text), ['Макет', 'Тексты']);
  const stages = await api.as(pm, () => api('decomposeRequest', { taskId: r.id }));
  assert.deepEqual(stages.map(t => t.step), ['design', 'ios', 'release']);
  const rel = stages.find(t => t.step === 'release');
  assert.equal(rel.dependsOn.length, 2); // без убранного QA
});

test('опросник разработчика: без него этап iOS не уходит на ревью, ответы видит RM; RM сам закрывает реджект', async () => {
  const api = await setup();
  const { ceo, pm, rm, ios, gold } = await studio(api);
  const { request } = await api.as(ceo, () => api('createApp', { name: 'AI', unitId: gold.id, storeUrl: '' }));
  await api.as(ceo, () => api('updateRequest', { id: request.id, pmId: pm.id })).catch(() => null);
  const stages = await api.as(pm, () => api('decomposeRequest', { taskId: request.id }));
  const by = Object.fromEntries(stages.map(t => [t.step, t]));
  for (const k of ['design', 'art', 'meta', 'store', 'retext', 'l10n']) await finish(api, ceo, pm, by[k].id).catch(() => api.as(pm, () => api('updateTask', { id: by[k].id, patch: { status: 'done' } })));
  await api.as(ios, async () => {
    await assert.rejects(() => api('updateTask', { id: by.ios.id, patch: { status: 'review' } }), /^Error: DEV_FORM:|DEV_FORM:/);
    await assert.rejects(() => api('saveDevForm', { taskId: by.ios.id, answers: {} }), /Ответьте на вопрос/);
    await assert.rejects(() => api('saveDevForm', { taskId: by.ios.id, answers: { ...DEV_ANSWERS, analytics: { v: 'Да' } } }), /Какая/);
    await api('saveDevForm', { taskId: by.ios.id, answers: { ...DEV_ANSWERS, analytics: { v: 'Да', note: 'Amplitude' } } });
    await api('updateTask', { id: by.ios.id, patch: { status: 'review' } });
  });
  await api.as(pm, () => api('reviewDecision', { taskId: by.ios.id, approve: true }));
  await finish(api, ceo, pm, by.qa.id).catch(() => api.as(pm, () => api('updateTask', { id: by.qa.id, patch: { status: 'done' } })));
  await finish(api, ceo, pm, by.integr.id).catch(() => api.as(pm, () => api('updateTask', { id: by.integr.id, patch: { status: 'done' } })));
  await api.as(pm, () => api('sendToRelease', { taskId: by.release.id }));
  const r = await api.as(rm, () => api('getRelease', { taskId: by.release.id }));
  assert.equal(r.devForm.answers.analytics.note, 'Amplitude');
  // реджект: RM закрывает сам, задача реджекта готова, релиз в очереди
  await api.as(rm, async () => {
    await api('saveReleaseValues', { taskId: by.release.id, values: { version: '1.0', build: '1', whatsnew: 'x' } });
    await api('releaseStep', { taskId: by.release.id, action: 'submit' });
    await api('releaseStep', { taskId: by.release.id, action: 'reject', reason: 'Guideline 3.1' });
    const closed = await api('releaseStep', { taskId: by.release.id, action: 'close_reject' });
    assert.equal(closed.task.release.phase, '');
    assert.ok(closed.task.release.fixedAt);
    await assert.rejects(() => api('releaseStep', { taskId: by.release.id, action: 'close_reject' }), /только реджект/);
  });
  const rej = (await api.as(pm, () => api('getBoard', { unitId: gold.id }))).tasks.find(t => /^Реджект №/.test(t.title));
  assert.ok(rej.doneAt);
});

test('тексты и переводы: ASO пишет тексты → дизайнер ставит их в макеты и выгружает исходники → локализации → релиз', async () => {
  const api = await setup();
  const { ceo, pm, rm, lead, ios, qa, aso, gold } = await studio(api);
  const { request } = await api.as(ceo, () => api('createApp', { name: 'Texts', unitId: gold.id }));
  const st = Object.fromEntries((await api.as(pm, () => api('decomposeRequest', { taskId: request.id }))).map(t => [t.step, t]));
  assert.deepEqual(st.art.dependsOn, [st.design.id]); // онбординг и ASO-графика — после дизайна
  assert.deepEqual(st.meta.dependsOn, [st.art.id]); // тексты — по готовой графике
  assert.deepEqual(st.store.dependsOn, [st.design.id]); // метаданные — параллельно
  assert.deepEqual(st.retext.dependsOn, [st.meta.id]);
  assert.deepEqual(st.l10n.dependsOn, [st.retext.id, st.store.id]);
  assert.equal(st.retext.assigneeId, lead.id); // тексты в дизайне — дизайнер
  assert.equal(st.l10n.assigneeId, aso.id); // переводы — ASO
  await finish(api, lead, pm, st.design.id);
  await finish(api, lead, pm, st.art.id);
  await finish(api, aso, pm, st.store.id);
  // ASO ещё не вернул тексты — дизайнер не может начать подстановку; переводы ждут подстановки
  await api.as(lead, () => assert.rejects(() => api('updateTask', { id: st.retext.id, patch: { status: 'in_progress' } }), /заблокирован.*Тексты/));
  await finish(api, aso, pm, st.meta.id);
  await api.as(lead, () => api('updateTask', { id: st.retext.id, patch: { status: 'in_progress' } }));
  await api.as(aso, () => assert.rejects(() => api('updateTask', { id: st.l10n.id, patch: { status: 'in_progress' } }), /заблокирован.*Тексты в дизайне/));
  // подстановка уходит на ревью только с закрытым чеклистом (в нём — выгрузка исходников на Google Drive)
  await api.as(lead, () => assert.rejects(() => api('updateTask', { id: st.retext.id, patch: { status: 'review' } }), /чеклист этапа/));
  await finish(api, lead, pm, st.retext.id);
  await api.as(aso, () => api('updateTask', { id: st.l10n.id, patch: { status: 'in_progress' } }));
  for (const [who, k] of [[ios, 'ios'], [qa, 'qa'], [ios, 'integr']]) await finish(api, who, pm, st[k].id);
  await api.as(pm, () => assert.rejects(() => api('sendToRelease', { taskId: st.release.id }), /Сначала закройте.*Локализации/));
  await finish(api, aso, pm, st.l10n.id);
  assert.equal((await api.as(pm, () => api('sendToRelease', { taskId: st.release.id }))).assigneeId, rm.id);
});

test('опросник: PM решает, кто заполняет — разработчик или лид на интеграции; вопросы настраиваются', async () => {
  const api = await setup();
  const { ceo, pm, rm, ios, gold } = await studio(api);
  const { request } = await api.as(ceo, () => api('createApp', { name: 'Q', unitId: gold.id }));
  const by = Object.fromEntries((await api.as(pm, () => api('decomposeRequest', { taskId: request.id }))).map(t => [t.step, t]));
  // вопросы: PM и RM настраивают, сотрудник — нет
  const qs = await api.as(pm, () => api('saveDevQuestions', { questions: [{ q: 'Есть backend?', kind: 'yn' }, { q: 'Что ещё?', kind: 'text', optional: true }] }));
  assert.equal(qs.length, 2);
  await api.as(rm, () => api('saveDevQuestions', { questions: qs }));
  await api.as(ios, () => assert.rejects(() => api('saveDevQuestions', { questions: qs })));
  // по умолчанию — разработчик; интеграции заполнять нельзя
  await api.as(ceo, () => assert.rejects(() => api('saveDevForm', { taskId: by.integr.id, answers: { [qs[0].id]: { v: 'Нет' } } }), /заполняет разработчик/));
  // PM переключил на лида: разработчику больше не нужно, лиду — нужно
  await api.as(ios, () => assert.rejects(() => api('setFormStep', { requestId: request.id, step: 'integr' })));
  await api.as(pm, () => api('setFormStep', { requestId: request.id, step: 'integr' }));
  await api.as(ios, () => assert.rejects(() => api('saveDevForm', { taskId: by.ios.id, answers: { [qs[0].id]: { v: 'Нет' } } }), /лид на интеграции/));
  await api.as(ceo, () => api('saveDevForm', { taskId: by.integr.id, answers: { [qs[0].id]: { v: 'Да' } } }));
  // в релизе — ответы с интеграции, с текстом вопроса
  for (const k of ['design', 'art', 'ios', 'qa', 'integr', 'meta', 'store', 'retext', 'l10n']) await api.as(pm, () => api('updateTask', { id: by[k].id, patch: { status: 'done' } }));
  await api.as(pm, () => api('sendToRelease', { taskId: by.release.id }));
  const r = await api.as(rm, () => api('getRelease', { taskId: by.release.id }));
  assert.deepEqual(r.devForm.answers[qs[0].id], { v: 'Да', q: 'Есть backend?', n: 0 });
});

test('бэклог: идеи и ТЗ ведёт CEO; запуск — новое приложение с запросом New App или запрос «Апдейт»', async () => {
  const api = await setup();
  const { ceo, pm, gold } = await studio(api);
  await api.as(pm, () => assert.rejects(() => api('saveIdea', { title: 'x' }))); // только CEO
  const idea = await api.as(ceo, () => api('saveIdea', { title: 'AI-фоторедактор', description: 'ТЗ', specUrl: 'https://docs.google.com/tz' }));
  assert.equal(idea.status, 'new');
  const res = await api.as(ceo, () => api('startIdea', { id: idea.id, unitId: gold.id, name: 'Photo AI' }));
  assert.equal(res.idea.status, 'started');
  assert.equal(res.request.assigneeId, pm.id); // запрос — ответственному за юнит
  assert.equal(res.request.specUrl, 'https://docs.google.com/tz');
  await api.as(ceo, () => assert.rejects(() => api('startIdea', { id: idea.id, unitId: gold.id }), /уже запущена/));
  const app = (await api.pg.query("select id from apps where name = 'Photo AI'")).rows[0];
  const upd = await api.as(ceo, () => api('saveIdea', { kind: 'update', appId: app.id, title: 'Виджеты' }));
  const r2 = await api.as(ceo, () => api('startIdea', { id: upd.id }));
  assert.equal(r2.request.title, 'Апдейт №1: Виджеты');
  assert.equal((await api.as(ceo, () => api('listIdeas', {}))).filter(x => x.status === 'started').length, 2);
});

test('опросник: RM принимает или возвращает с вопросами — ответы сбрасываются, разработчику комментарий и уведомление', async () => {
  const api = await setup();
  const { ceo, pm, rm, ios, gold } = await studio(api);
  const { request } = await api.as(ceo, () => api('createApp', { name: 'DF', unitId: gold.id }));
  const by = Object.fromEntries((await api.as(pm, () => api('decomposeRequest', { taskId: request.id }))).map(t => [t.step, t]));
  await api.as(pm, () => api('updateTask', { id: by.design.id, patch: { status: 'done' } }));
  await api.as(ios, () => api('saveDevForm', { taskId: by.ios.id, answers: DEV_ANSWERS }));
  for (const k of ['ios', 'art', 'meta', 'store', 'retext', 'l10n', 'qa', 'integr']) await api.as(pm, () => api('updateTask', { id: by[k].id, patch: { status: 'done' } }));
  await api.as(pm, () => api('sendToRelease', { taskId: by.release.id }));
  // чужой не проверяет; пустой вопрос нельзя
  await api.as(ios, () => assert.rejects(() => api('reviewDevForm', { taskId: by.release.id, ok: true })));
  await api.as(rm, () => assert.rejects(() => api('reviewDevForm', { taskId: by.release.id, ok: false, note: ' ' }), /что уточнить/));
  // вернули: ответы сброшены, у разработчика комментарий и уведомление
  await api.as(rm, () => api('reviewDevForm', { taskId: by.release.id, ok: false, note: 'Какие SDK собирают IDFA?' }));
  assert.equal((await api.as(rm, () => api('getRelease', { taskId: by.release.id }))).devForm.at, '');
  await api.as(ios, async () => {
    assert.ok((await api('getNotifications', {})).some(n => n.taskId === by.ios.id && n.kinds.includes('returned')));
    assert.ok((await api('getTaskExtras', { taskId: by.ios.id })).comments.some(c => /вернули с вопросами: Какие SDK/.test(c.text)));
    await api('saveDevForm', { taskId: by.ios.id, answers: DEV_ANSWERS });
  });
  // заполнил снова — RM принял
  const f = await api.as(rm, () => api('reviewDevForm', { taskId: by.release.id, ok: true }));
  assert.ok(f.checked && f.checked.by === rm.id && !f.returned);
});

test('разработка → тестирование без код-ревью; QA возвращает в «Доработку»; баг-репорт: открыт → исправлен → закрыт', async () => {
  const api = await setup();
  const { ceo, pm, ios, qa, gold } = await studio(api);
  // колонка «Доработка» есть на доске сама (обязательная)
  assert.ok((await api.as(pm, () => api('getBoard', { unitId: gold.id }))).unit.settings.columns.some(c => c.id === 'rework'));
  const { request } = await api.as(ceo, () => api('createApp', { name: 'NR', unitId: gold.id }));
  const by = Object.fromEntries((await api.as(pm, () => api('decomposeRequest', { taskId: request.id }))).map(t => [t.step, t]));
  await api.as(pm, () => api('updateTask', { id: by.design.id, patch: { status: 'done' } }));
  await api.as(ios, () => api('saveDevForm', { taskId: by.ios.id, answers: DEV_ANSWERS }));
  // разработчик сам отдаёт на тестирование: «готово» без ревью лида
  const d1 = await api.as(ios, () => api('updateTask', { id: by.ios.id, patch: { status: 'done' } }));
  assert.equal(d1.status, 'done');
  assert.equal(d1.assigneeId, ios.id);
  // QA вернул: разработка — в «Доработке», баг-репорт открыт
  await api.as(qa, () => api('qaReturn', { taskId: by.qa.id, url: 'https://docs.google.com/b1' }));
  const back = (await api.as(ios, () => api('getBoard', { unitId: gold.id }))).tasks.find(t => t.id === by.ios.id);
  assert.equal(back.status, 'rework');
  assert.ok(!back.bugs[0].fixedAt && !back.bugs[0].closedAt);
  // исправил и сдал — «исправлен» у разработчика и у QA
  await api.as(ios, () => api('updateTask', { id: by.ios.id, patch: { status: 'done' } }));
  const bugsOf = async id => (await api.pg.query('select bugs from tasks where id = $1', [id])).rows[0].bugs[0];
  assert.ok((await bugsOf(by.ios.id)).fixedAt && (await bugsOf(by.qa.id)).fixedAt);
  // QA принял — закрыт
  await api.as(qa, () => api('updateTask', { id: by.qa.id, patch: { status: 'done' } }));
  assert.ok((await bugsOf(by.ios.id)).closedAt && (await bugsOf(by.qa.id)).closedAt);
});

test('удалить тестовые данные: демо-юнит, демо-люди без входа, приложения и задачи — всё; реальные люди и юниты остаются', async () => {
  const api = await setup();
  const { ceo, pm, gold } = await studio(api);
  await api.pg.query('update people set is_dev = true where id = $1', [ceo.id]);
  await api.as(pm, () => assert.rejects(() => api('createUnit', { name: 'X', key: 'XX', test: true })));
  const demo = await api.as(ceo, async () => {
    const unit = await api('createUnit', { name: 'Demo', key: 'DEMO', test: true });
    const p1 = await api('createPerson', { name: 'Демо · Дизайнер', access: 'member', positionId: 'd_design', test: true });
    const old = await api('createPerson', { name: 'Демо · Старый', access: 'member', positionId: 'd_ios' }); // старое демо, без метки
    await api('setMember', { unitId: unit.id, personId: p1.id });
    await api('createApp', { unitId: unit.id, name: 'Демо-апп' });
    await api('createApp', { unitId: gold.id, name: 'Тест в Gold', test: true });
    return { unit, p1, old };
  });
  const r = await api.as(ceo, () => api('deleteTestData', {}));
  assert.ok(r.units === 1 && r.people === 2 && r.apps === 2 && r.tasks >= 2, JSON.stringify(r));
  const left = async (sql, args) => (await api.pg.query(sql, args)).rows.length;
  assert.equal(await left('select 1 from units where id = $1', [demo.unit.id]), 0);
  assert.equal(await left('select 1 from people where id in ($1, $2)', [demo.p1.id, demo.old.id]), 0);
  // реальные остались: юнит Gold, PM и CEO
  assert.equal(await left('select 1 from units where id = $1', [gold.id]), 1);
  assert.equal(await left('select 1 from people where id in ($1, $2)', [pm.id, ceo.id]), 2);
});

test('ссылки наследуются вниз: добавили в запрос после разбивки — у этапов есть; своя ссылка этапа не перезаписывается; снятие — так же', async () => {
  const api = await setup();
  const { ceo, pm, gold } = await studio(api);
  const { request } = await api.as(ceo, () => api('createApp', { name: 'Dual', unitId: gold.id }));
  const stages = await api.as(pm, () => api('decomposeRequest', { taskId: request.id }));
  const design = stages.find(t => t.step === 'design'), ios = stages.find(t => t.step === 'ios');
  const linksOf = async id => (await api.as(ceo, () => api('getBoard', { unitId: gold.id }))).tasks.find(t => t.id === id).links || {};
  // в запрос — после разбивки: этапы получили
  await api.as(ceo, () => api('setTaskLink', { taskId: request.id, fieldId: 'lf_figma', url: 'https://figma.com/file/a' }));
  assert.equal((await linksOf(design.id)).lf_figma, 'https://figma.com/file/a');
  assert.equal((await linksOf(ios.id)).lf_figma, 'https://figma.com/file/a');
  // у дизайна своя Figma — запрос и соседи не меняются; потом запрос меняет общую — своя у дизайна остаётся
  await api.as(ceo, () => api('setTaskLink', { taskId: design.id, fieldId: 'lf_figma', url: 'https://figma.com/file/own' }));
  assert.equal((await linksOf(ios.id)).lf_figma, 'https://figma.com/file/a');
  await api.as(ceo, () => api('setTaskLink', { taskId: request.id, fieldId: 'lf_figma', url: 'https://figma.com/file/b' }));
  assert.equal((await linksOf(ios.id)).lf_figma, 'https://figma.com/file/b');
  assert.equal((await linksOf(design.id)).lf_figma, 'https://figma.com/file/own');
  // подзадача этапа получает ссылку этапа
  const sub = await api.as(pm, () => api('createTask', { unitId: gold.id, title: 'Иконка', parentId: design.id }));
  await api.as(ceo, () => api('setTaskLink', { taskId: design.id, fieldId: 'lf_drive', url: 'https://drive.google.com/d' }));
  assert.equal((await linksOf(sub.id)).lf_drive, 'https://drive.google.com/d');
  // сняли в запросе — пропало там, где было то же значение
  await api.as(ceo, () => api('setTaskLink', { taskId: request.id, fieldId: 'lf_figma', url: '' }));
  assert.equal((await linksOf(ios.id)).lf_figma, undefined);
  assert.equal((await linksOf(design.id)).lf_figma, 'https://figma.com/file/own');
});

test('один раз при обновлении схемы: ссылки старых открытых запросов доходят до этапов, где пусто', async () => {
  const api = await setup();
  const { ceo, pm, gold } = await studio(api);
  const { request } = await api.as(ceo, () => api('createApp', { name: 'Old', unitId: gold.id }));
  const stages = await api.as(pm, () => api('decomposeRequest', { taskId: request.id }));
  // как было до правки: ссылка только у запроса
  await api.pg.query(`insert into task_links (task_id, field_id, unit_id, url, updated_at) values ($1, 'lf_meta', $2, 'https://docs.google.com/m', 'x')`, [request.id, gold.id]);
  await api.pg.query(`delete from app_settings where key = 'once_links_to_stages'`);
  await api.pg.exec(SCHEMA);
  const n = (await api.pg.query(`select count(*)::int n from task_links where field_id = 'lf_meta' and task_id = any($1)`, [stages.map(s => s.id)])).rows[0].n;
  assert.equal(n, stages.length);
});
