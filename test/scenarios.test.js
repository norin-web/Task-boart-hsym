// Сценарии по ролям и позициям: кто что видит и может на каждом этапе жизни приложения —
// от создания до релиза, реджекта и апдейта. Каждая проверка записывается отдельно: падение одной не прячет остальные.
import { DEV_QUESTIONS } from '../web/src/devform.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createBackend } from '../web/src/backend.js';
import { pgliteClient, AUTH_STUB_SQL, actAs } from '../web/src/pglite-client.js';
import { batchClient } from '../web/src/batch.js';
// TM_BATCH=1 — все чтения через пакет (read_batch), как на общей базе
const client = pg => (process.env.TM_BATCH ? batchClient(pgliteClient(pg)) : pgliteClient(pg));

const SCHEMA = fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const UID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DEV_ANSWERS = Object.fromEntries(DEV_QUESTIONS.filter(q => !q.optional).map(q => [q.id, q.kind === 'yn' ? { v: 'Нет' } : { v: 'Ответ' }]));

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
  api.as = async (person, fn) => {
    await actAs(pg, person ? person.uid : null, person ? person.email : '');
    try { return await fn(); } finally { await actAs(pg, null); }
  };
  api.pg = pg;
  return api;
}

async function studio(api) {
  let n = 0;
  const mk = async (name, access, positionId) => {
    const p = await api('createPerson', { name, email: `p${++n}@x.ru`, access, positionId });
    await api.pg.query('update people set user_id = $1 where id = $2', [UID(n), p.id]);
    return { ...p, uid: UID(n) };
  };
  const P = {
    ceo: await mk('CEO', 'superadmin', 'd_po'), pm: await mk('PM Gold', 'moderator', 'd_po'), pmRf: await mk('PM RF', 'moderator', 'd_po'),
    rm: await mk('RM', 'rm', 'd_release'), lead: await mk('Лид дизайна', 'lead', 'd_design'), des: await mk('Дизайнер', 'member', 'd_design'),
    ios: await mk('iOS', 'member', 'd_ios'), qa: await mk('QA', 'member', 'd_qa'), aso: await mk('ASO', 'member', 'd_aso'),
    out: await mk('Посторонний', 'member', 'd_ios'),
  };
  const gold = await api('createUnit', { name: 'Gold', key: 'GLD' });
  const rf = await api('createUnit', { name: 'RF', key: 'RF' });
  for (const k of ['pm', 'rm', 'lead', 'des', 'ios', 'qa', 'aso']) await api('setMember', { unitId: gold.id, personId: P[k].id });
  // ревью: дизайн проверяет лид дизайна, остальное — PM юнита
  const set0 = (await api('getBoard', { unitId: gold.id })).unit.settings;
  await api('updateUnit', { id: gold.id, settings: { ...set0, review: { column: 'review', byPosition: { d_design: P.lead.id }, default: P.pm.id } } });
  await api('setMember', { unitId: rf.id, personId: P.pmRf.id });
  await api('setMember', { unitId: rf.id, personId: P.out.id });
  return { ...P, gold, rf };
}

/** Закрыть этап как положено: чеклист, опросник (iOS), ревью, аппрув. */
async function finish(api, who, pm, id) {
  const { rows } = await api.pg.query('select checklist from tasks where id = $1', [id]);
  const cl = (rows[0].checklist || []).map(i => ({ ...i, done: true }));
  if (cl.length) await api.as(who, () => api('updateTask', { id, patch: { checklist: cl } })).catch(() => null);
  await api.as(who, () => api('saveDevForm', { taskId: id, answers: DEV_ANSWERS })).catch(() => null);
  await api.as(who, () => api('updateTask', { id, patch: { status: 'review' } }));
  return api.as(pm, () => api('reviewDecision', { taskId: id, approve: true }));
}

const failed = [];
const check = async (label, fn) => { try { await fn(); } catch (e) { failed.push(`${label} → ${e.message.split('\n')[0]}`); } };
const denied = (e, re) => { assert.ok(e instanceof Error, 'ожидали отказ'); if (re) assert.match(e.message, re); return true; };
const mustFail = (promise, re) => promise.then(() => { throw new Error('ожидали отказ, а действие прошло'); }, e => denied(e, re));

test('сценарии: роли × позиции × жизненный цикл приложения', async () => {
  const api = await setup();
  const S = await studio(api);
  const { ceo, pm, pmRf, rm, lead, des, ios, qa, aso, out, gold } = S;

  // ---------- создание приложения ----------
  await check('участник не создаёт приложение', () => mustFail(api.as(ios, () => api('createApp', { name: 'X', unitId: gold.id }))));
  await check('RM не создаёт приложение', () => mustFail(api.as(rm, () => api('createApp', { name: 'X', unitId: gold.id }))));
  await check('PM не создаёт приложение (это делает CEO)', () => mustFail(api.as(pm, () => api('createApp', { name: 'X', unitId: gold.id }))));
  const { app, request } = await api.as(ceo, () => api('createApp', { name: 'Sleep', unitId: gold.id, priority: 'o_high' }));
  await check('запрос получил PM юнита', async () => assert.equal(request.assigneeId, pm.id));
  await check('чужой PM не видит запрос', async () => assert.ok(!(await api.as(pmRf, () => api('getBoard', { unitId: gold.id }).catch(() => ({ tasks: [] })))).tasks.some(t => t.id === request.id)));
  await check('посторонний (другой юнит) не видит доску Gold', async () => assert.ok(!(await api.as(out, () => api('getBoard', { unitId: gold.id }).catch(() => ({ tasks: [] })))).tasks.length));

  // ---------- разбивка по этапам ----------
  await check('участник не раскладывает запрос', () => mustFail(api.as(ios, () => api('decomposeRequest', { taskId: request.id }))));
  await check('чужой PM не раскладывает запрос', () => mustFail(api.as(pmRf, () => api('decomposeRequest', { taskId: request.id }))));
  const st = Object.fromEntries((await api.as(pm, () => api('decomposeRequest', { taskId: request.id }))).map(t => [t.step, t]));
  await check('10 этапов: дизайн, графика, iOS, QA, интеграция, тексты, метаданные, тексты в дизайне, локализации, релиз', async () => assert.deepEqual(Object.keys(st), ['design', 'art', 'ios', 'qa', 'integr', 'meta', 'store', 'retext', 'l10n', 'release']));
  await check('чеклист дизайна: экраны и PW; графики — OB и ASO', async () => { assert.equal(st.design.checklist.length, 2); assert.equal(st.art.checklist.length, 2); });
  await check('у каждого этапа исполнитель своей позиции', async () => {
    assert.equal(st.design.assigneeId, lead.id); assert.equal(st.ios.assigneeId, ios.id); assert.equal(st.qa.assigneeId, qa.id);
    assert.equal(st.meta.assigneeId, aso.id); assert.equal(st.retext.assigneeId, lead.id); assert.equal(st.l10n.assigneeId, aso.id); assert.equal(st.release.assigneeId, '');
  });

  // ---------- разграничение по позициям ----------
  await check('PM не ставит на этап дизайна QA', () => mustFail(api.as(pm, () => api('updateTask', { id: st.design.id, patch: { assigneeId: qa.id } })), /позиц|не «/i));
  await check('PM не ставит на этап iOS дизайнера', () => mustFail(api.as(pm, () => api('updateTask', { id: st.ios.id, patch: { assigneeId: des.id } }))));
  await check('релиз ведёт только RM', () => mustFail(api.as(pm, () => api('updateTask', { id: st.release.id, patch: { assigneeId: aso.id } })), /релиз-менеджер/i));
  await check('RM без позиции Release Manager создать нельзя', () => mustFail(api('createPerson', { name: 'RM2', email: 'rm2@x.ru', access: 'rm', positionId: 'd_ios' }), /Release Manager/));
  await check('ждущие этапы исполнители не видят', async () => {
    for (const [who, k] of [[ios, 'ios'], [qa, 'qa'], [aso, 'meta'], [rm, 'release']]) {
      const tasks = (await api.as(who, () => api('getBoard', { unitId: gold.id }))).tasks;
      assert.ok(!tasks.some(t => t.id === st[k].id), `${k} виден раньше времени`);
    }
  });
  await check('каждый видит свой этап: лид — дизайн', async () => assert.ok((await api.as(lead, () => api('getBoard', { unitId: gold.id }))).tasks.some(t => t.id === st.design.id)));
  await check('PM видит всю цепочку', async () => assert.equal((await api.as(pm, () => api('getBoard', { unitId: gold.id }))).tasks.filter(t => t.step).length, 10));
  await check('iOS не двигает чужой этап (дизайн)', () => mustFail(api.as(ios, () => api('updateTask', { id: st.design.id, patch: { status: 'in_progress' } }))));
  await check('сотрудник не создаёт задачи', () => mustFail(api.as(des, () => api('createTask', { unitId: gold.id, title: 'x' }))));
  await check('лид не создаёт задачи', () => mustFail(api.as(lead, () => api('createTask', { unitId: gold.id, title: 'x' }))));
  await check('исполнитель не меняет название и срок', () => mustFail(api.as(lead, () => api('updateTask', { id: st.design.id, patch: { title: 'Мой этап' } }))));

  // ---------- блокировки и поток этапов ----------
  await check('нельзя в работу заблокированное (iOS до дизайна)', () => mustFail(api.as(ios, () => api('updateTask', { id: st.ios.id, patch: { status: 'in_progress' } })), /заблокирован/));
  await check('дизайн: на ревью только с закрытым чеклистом', () => mustFail(api.as(lead, () => api('updateTask', { id: st.design.id, patch: { status: 'review' } })), /чеклист/));
  await check('исполнитель не закрывает мимо ревью', () => mustFail(api.as(lead, () => api('updateTask', { id: st.design.id, patch: { status: 'done' } }))));
  await finish(api, lead, pm, st.design.id);
  await finish(api, lead, pm, st.art.id); // онбординг и ASO-графика — тексты ждут её
  await finish(api, aso, pm, st.store.id); // метаданные стора
  await check('после дизайна: iOS и ASO видят свои этапы', async () => {
    assert.ok((await api.as(ios, () => api('getBoard', { unitId: gold.id }))).tasks.some(t => t.id === st.ios.id));
    assert.ok((await api.as(aso, () => api('getBoard', { unitId: gold.id }))).tasks.some(t => t.id === st.meta.id));
  });
  await check('ASO получил «Можно начинать»', async () => assert.ok((await api.as(aso, () => api('getNotifications', {}))).some(n => n.taskId === st.meta.id && n.kind === 'unblocked')));
  await check('QA ещё не видит тестирование', async () => assert.ok(!(await api.as(qa, () => api('getBoard', { unitId: gold.id }))).tasks.some(t => t.id === st.qa.id)));
  await check('тексты в дизайне ждут тексты ASO', () => mustFail(api.as(lead, () => api('updateTask', { id: st.retext.id, patch: { status: 'in_progress' } })), /заблокирован/));
  await finish(api, aso, pm, st.meta.id);
  await check('лид получил «Можно начинать» по текстам в дизайне', async () => assert.ok((await api.as(lead, () => api('getNotifications', {}))).some(n => n.taskId === st.retext.id && n.kind === 'unblocked')));
  await check('лид раздаёт подстановку текстов дизайнеру', async () => {
    const made = await api.as(lead, () => api('splitTask', { taskId: st.retext.id, items: [{ title: 'Подставить тексты OB и PW', assigneeId: des.id }, { title: 'Подставить тексты ASO и выгрузить на Google Drive', assigneeId: des.id }] }));
    assert.equal(made.length, 2);
  });
  await check('разданные подзадачи видит дизайнер', async () => assert.ok((await api.as(des, () => api('getBoard', { unitId: gold.id }))).tasks.filter(t => t.step === 'part').length >= 2));
  await check('подзадачу нельзя раздать человеку другой позиции', () => mustFail(api.as(lead, () => api('splitTask', { taskId: st.retext.id, items: [{ title: 'x', assigneeId: ios.id }] }))));
  const parts = (await api.as(pm, () => api('getBoard', { unitId: gold.id }))).tasks.filter(t => t.step === 'part' && t.parentId === st.retext.id);
  for (const p of parts) await finish(api, des, lead, p.id).catch(e => failed.push('подзадача: ' + e.message));
  await check('этап «Тексты в дизайне» закрылся сам, когда закрыты все подзадачи', async () => {
    const t = (await api.as(pm, () => api('getBoard', { unitId: gold.id }))).tasks.find(x => x.id === st.retext.id);
    assert.ok(t && t.statusKind === 'done' || t.status === 'done', 'статус: ' + (t && t.status));
  });
  await check('QA возвращает баги в разработку', async () => {
    await finish(api, ios, pm, st.ios.id);
    assert.equal(await api.as(qa, () => api('qaReturn', { taskId: st.qa.id, text: 'Краш на онбординге' })), 1);
  });
  await finish(api, ios, pm, st.ios.id);
  await finish(api, qa, pm, st.qa.id);
  await finish(api, ios, pm, st.integr.id);
  await check('локализации ждут текстов в дизайне — теперь открыты', async () => assert.ok((await api.as(aso, () => api('getBoard', { unitId: gold.id }))).tasks.some(t => t.id === st.l10n.id)));
  await check('релиз нельзя передать, пока не закрыты локализации', () => mustFail(api.as(pm, () => api('sendToRelease', { taskId: st.release.id })), /Локализации/));
  await finish(api, aso, pm, st.l10n.id);

  // ---------- релиз ----------
  await check('участник не передаёт в релиз', () => mustFail(api.as(ios, () => api('sendToRelease', { taskId: st.release.id }))));
  const rel = await api.as(pm, () => api('sendToRelease', { taskId: st.release.id }));
  await check('релиз ушёл RM', async () => assert.equal(rel.assigneeId, rm.id));
  await check('RM получил уведомление', async () => assert.ok((await api.as(rm, () => api('getNotifications', {}))).some(n => n.taskId === st.release.id)));
  await check('статус приложения — «Релиз»', async () => assert.equal((await api.as(ceo, () => api('listApps', {}))).find(a => a.id === app.id).status, 'release'));
  await check('PM не отправляет в Apple (это RM)', () => mustFail(api.as(pm, () => api('releaseStep', { taskId: st.release.id, action: 'submit' }))));
  await check('без обязательных полей и чеклиста в Apple не отправить', () => mustFail(api.as(rm, () => api('releaseStep', { taskId: st.release.id, action: 'submit' }))));
  await api.as(rm, () => api('saveReleaseValues', { taskId: st.release.id, values: { version: '1.0', build: '1', whatsnew: 'Первый выпуск' } }));
  await check('RM видит опросник и ссылки команды', async () => { const r = await api.as(rm, () => api('getRelease', { taskId: st.release.id })); assert.ok(r.devForm && Object.keys(r.devForm).length, 'опросник пуст'); });
  await check('команда релиза: PM, дизайн, iOS, QA, тексты', async () => { const t = await api.as(rm, () => api('getReleaseTeam', { taskId: st.release.id })); assert.ok(t.design.length && t.ios.length && t.qa.length && t.meta.length); });
  await api.as(rm, () => api('releaseStep', { taskId: st.release.id, action: 'submit' }).catch(async e => { throw e; }));
  await check('в Apple отправлено — статус «Ревью Apple»', async () => assert.equal((await api.as(ceo, () => api('listApps', {}))).find(a => a.id === app.id).status, 'review'));

  // ---------- реджект ----------
  const rj = await api.as(rm, () => api('releaseStep', { taskId: st.release.id, action: 'reject', reason: 'Guideline 3.1.2' }));
  await check('реджект: PM получил задачу', async () => { assert.ok(rj.rejectRequestId); assert.equal((await api.as(pm, () => api('getBoard', { unitId: gold.id }))).tasks.find(t => t.id === rj.rejectRequestId).assigneeId, pm.id); });
  await check('PM не закрывает реджект за RM через релиз', () => mustFail(api.as(ios, () => api('releaseStep', { taskId: st.release.id, action: 'close_reject' }))));
  await api.as(rm, () => api('releaseStep', { taskId: st.release.id, action: 'close_reject' }));
  await api.as(rm, () => api('releaseStep', { taskId: st.release.id, action: 'resubmit' }));
  await api.as(rm, () => api('releaseStep', { taskId: st.release.id, action: 'live' }));
  await check('приложение в сторе, запрос CEO закрыт', async () => {
    assert.equal((await api.as(ceo, () => api('listApps', {}))).find(a => a.id === app.id).status, 'live');
    const t = (await api.as(ceo, () => api('getBoard', { unitId: gold.id }))).tasks.find(x => x.id === request.id);
    assert.ok(t && (t.statusKind === 'done' || t.status === 'done'), 'запрос: ' + (t && t.status));
  });
  await check('вышедшему приложению не отправить «live» второй раз', () => mustFail(api.as(rm, () => api('releaseStep', { taskId: st.release.id, action: 'live' }))));

  // ---------- апдейт ----------
  const upd = await api.as(ceo, () => api('createRequest', { appId: app.id, type: 'update', title: 'Апдейт 1.1' }));
  await check('апдейты нумеруются сами по приложению', async () => {
    assert.equal(upd.title, 'Апдейт №1: 1.1');
    const u2 = await api.as(ceo, () => api('createRequest', { appId: app.id, type: 'update', title: 'Виджеты' }));
    assert.equal(u2.title, 'Апдейт №2: Виджеты');
  });
  const us = Object.fromEntries((await api.as(pm, () => api('decomposeRequest', { taskId: upd.id }))).map(t => [t.step, t]));
  await check('в апдейте нет текстов и локализаций', async () => assert.deepEqual(Object.keys(us), ['design', 'ios', 'qa', 'integr', 'release']));
  await check('участник не ставит запрос на апдейт', () => mustFail(api.as(ios, () => api('createRequest', { appId: app.id, type: 'update', title: 'x' }))));

  // ---------- сводки: ни одна не падает ни у одной роли ----------
  const today = new Date().toISOString().slice(0, 10);
  const smoke = {
    ceo: [['getHome', { today }], ['getCeoDashboard', { today }], ['listApps', {}], ['getOverview', {}]],
    pm: [['getHome', { today }], ['getPmDashboard', { today, period: 'week' }], ['listApps', {}]],
    rm: [['getHome', { today }], ['getRmDashboard', { today }], ['listApps', {}]],
    lead: [['getHome', { today }], ['getMyDashboard', { personId: lead.id, today }], ['getMyBoard', { personId: lead.id }]],
    ios: [['getHome', { today }], ['getMyDashboard', { personId: ios.id, today }], ['getMyBoard', { personId: ios.id }]],
    aso: [['getMyDashboard', { personId: aso.id, today }], ['getMyBoard', { personId: aso.id }]],
    qa: [['getMyDashboard', { personId: qa.id, today }], ['getMyBoard', { personId: qa.id }]],
    des: [['getMyDashboard', { personId: des.id, today }], ['getMyBoard', { personId: des.id }]],
  };
  for (const [who, calls] of Object.entries(smoke)) for (const [m, payload] of calls) await check(`сводка ${m} у ${who}`, () => api.as(S[who], () => api(m, payload)));
  await api.as(pm, () => api('addAppNote', { appId: app.id, text: 'Договорились о цене' }));
  await check('заметки к приложению видят PM и RM, но не лид и не сотрудник', async () => {
    assert.equal((await api.as(rm, () => api('getAppNotes', { appId: app.id }))).length, 1);
    assert.equal((await api.as(lead, () => api('getAppNotes', { appId: app.id }))).length, 0);
    assert.equal((await api.as(ios, () => api('getAppNotes', { appId: app.id }))).length, 0);
  });
  await check('сотрудник не пишет заметки к приложению', () => mustFail(api.as(ios, () => api('addAppNote', { appId: app.id, text: 'x' }))));

  // ---------- удаление ----------
  await check('PM не удаляет приложение', () => mustFail(api.as(pm, () => api('deleteApps', { ids: [app.id] }))));
  await check('участник не удаляет юнит', () => mustFail(api.as(ios, () => api('deleteUnit', { id: gold.id }))));

  assert.deepEqual(failed, [], '\n' + failed.join('\n'));
});
