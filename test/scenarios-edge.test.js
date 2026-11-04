// Крайние случаи жизненного цикла: повторные реджекты, перенос приложения, уход людей, юнит без RM или PM.
import { DEV_QUESTIONS } from '../web/src/devform.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createBackend } from '../web/src/backend.js';
import { pgliteClient, AUTH_STUB_SQL, actAs } from '../web/src/pglite-client.js';

const SCHEMA = fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const UID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DEV_ANSWERS = Object.fromEntries(DEV_QUESTIONS.filter(q => !q.optional).map(q => [q.id, q.kind === 'yn' ? { v: 'Нет' } : { v: 'Ответ' }]));

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
let n = 0;
async function person(api, name, access, positionId) {
  const p = await api('createPerson', { name, email: `p${++n}@x.ru`, access, positionId });
  await api.pg.query('update people set user_id = $1 where id = $2', [UID(n), p.id]);
  return { ...p, uid: UID(n) };
}
async function team(api, unit, withRm = true, withPm = true) {
  const T = {};
  if (withPm) T.pm = await person(api, 'PM', 'moderator', 'd_po');
  if (withRm) T.rm = await person(api, 'RM', 'rm', 'd_release');
  T.lead = await person(api, 'Лид', 'lead', 'd_design');
  T.ios = await person(api, 'iOS', 'member', 'd_ios');
  T.qa = await person(api, 'QA', 'member', 'd_qa');
  T.aso = await person(api, 'ASO', 'member', 'd_aso');
  for (const p of Object.values(T)) await api('setMember', { unitId: unit.id, personId: p.id });
  return T;
}
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
const mustFail = (p, re) => p.then(() => { throw new Error('ожидали отказ, а действие прошло'); }, e => { if (re) assert.match(e.message, re); });
const stagesOf = async (api, pm, req) => Object.fromEntries((await api.as(pm, () => api('decomposeRequest', { taskId: req.id }))).map(t => [t.step, t]));
const toRelease = async (api, who, st) => {
  for (const [k, p] of [['design', who.lead], ['art', who.lead], ['ios', who.ios], ['qa', who.qa], ['integr', who.ios], ['meta', who.aso], ['store', who.aso], ['retext', who.lead], ['l10n', who.aso]]) await finish(api, p, who.pm, st[k].id);
  return api.as(who.pm, () => api('sendToRelease', { taskId: st.release.id }));
};
const ready = (api, who, st) => api.as(who.rm, async () => {
  await api('saveReleaseValues', { taskId: st.release.id, values: { version: '1.0', build: '1', whatsnew: 'Первый выпуск' } });
});

test('крайние случаи: реджекты, перенос, уход людей, юнит без RM или PM', async () => {
  const api = await setup();
  const ceo = await person(api, 'CEO', 'superadmin', 'd_po');
  const gold = await api('createUnit', { name: 'Gold', key: 'GLD' });
  const who = await team(api, gold);
  const { app, request } = await api.as(ceo, () => api('createApp', { name: 'A', unitId: gold.id }));
  const st = await stagesOf(api, who.pm, request);
  await toRelease(api, who, st);
  await ready(api, who, st);

  // два реджекта подряд: номера по приложению растут
  await api.as(who.rm, () => api('releaseStep', { taskId: st.release.id, action: 'submit' }));
  const r1 = await api.as(who.rm, () => api('releaseStep', { taskId: st.release.id, action: 'reject', reason: 'Первая причина' }));
  const rejectNos = async () => (await api.as(who.rm, () => api('getRelease', { taskId: st.release.id }))).task.release.history.map(h => h.rejectNo).filter(Boolean);
  await check('реджект №1', async () => assert.deepEqual(await rejectNos(), [1]));
  // отправили снова, не дожидаясь PM: его задача закрывается сама
  await api.as(who.rm, () => api('releaseStep', { taskId: st.release.id, action: 'resubmit' }));
  await check('задача PM по реджекту закрылась при повторной отправке', async () => {
    const t = (await api.as(who.pm, () => api('getBoard', { unitId: gold.id }))).tasks.find(x => x.id === r1.rejectRequestId);
    assert.ok(t && t.status === 'done', 'статус: ' + (t && t.status));
  });
  const r2 = await api.as(who.rm, () => api('releaseStep', { taskId: st.release.id, action: 'reject', reason: 'Вторая причина' }));
  await check('реджект №2', async () => assert.deepEqual(await rejectNos(), [1, 2]));
  await check('история релиза: две попытки с реджектом и третья впереди', async () => {
    const h = await api.as(who.rm, () => api('getRelease', { taskId: st.release.id }));
    assert.equal(h.task.release.history.length, 2);
  });
  await check('реджект без причины запрещён', async () => {
    await api.as(who.rm, () => api('releaseStep', { taskId: st.release.id, action: 'close_reject' }));
    await api.as(who.rm, () => api('releaseStep', { taskId: st.release.id, action: 'resubmit' }));
    await mustFail(api.as(who.rm, () => api('releaseStep', { taskId: st.release.id, action: 'reject', reason: '  ' })), /Опишите/);
  });
  await api.as(who.rm, () => api('releaseStep', { taskId: st.release.id, action: 'live' }));

  // юнит без RM: передать в релиз нельзя, сообщение понятное
  const lone = await api('createUnit', { name: 'Lone', key: 'LNE' });
  const noRm = await team(api, lone, false, true);
  const a2 = await api.as(ceo, () => api('createApp', { name: 'B', unitId: lone.id }));
  const s2 = await stagesOf(api, noRm.pm, a2.request);
  for (const [k, p] of [['design', noRm.lead], ['art', noRm.lead], ['ios', noRm.ios], ['qa', noRm.qa], ['integr', noRm.ios], ['meta', noRm.aso], ['store', noRm.aso], ['retext', noRm.lead], ['l10n', noRm.aso]]) await finish(api, p, noRm.pm, s2[k].id);
  await check('юнит без RM: понятный отказ', () => mustFail(api.as(noRm.pm, () => api('sendToRelease', { taskId: s2.release.id })), /нет релиз-менеджера/));

  // юнит без PM: запрос никому не уходит — это видно
  const orphan = await api('createUnit', { name: 'NoPm', key: 'NPM' });
  await check('юнит без PM: приложение создаётся, запрос без исполнителя', async () => {
    const x = await api.as(ceo, () => api('createApp', { name: 'C', unitId: orphan.id }));
    assert.equal(x.request.assigneeId, '');
  });

  // перенос приложения в другой юнит: этапы переезжают, но исполнители — нет
  const rf = await api('createUnit', { name: 'RF', key: 'RF' });
  const rfT = await team(api, rf);
  const a3 = await api.as(ceo, () => api('createApp', { name: 'D', unitId: gold.id }));
  const s3 = await stagesOf(api, who.pm, a3.request);
  await api.as(ceo, () => api('updateApp', { id: a3.app.id, unitId: rf.id }));
  await check('после переноса этапы в новом юните', async () => {
    const b = await api.as(rfT.pm, () => api('getBoard', { unitId: rf.id }));
    assert.ok(b.tasks.some(t => t.id === s3.design.id));
  });
  await check('после переноса этап не остаётся на человеке из старого юнита', async () => {
    const b = await api.as(rfT.pm, () => api('getBoard', { unitId: rf.id }));
    const t = b.tasks.find(x => x.id === s3.design.id);
    assert.ok(!t.assigneeId || [rfT.lead.id].includes(t.assigneeId), 'исполнитель остался из старого юнита: ' + t.assigneeId);
  });
  await check('запрос после переноса получил PM нового юнита', async () => {
    const b = await api.as(rfT.pm, () => api('getBoard', { unitId: rf.id }));
    assert.equal(b.tasks.find(x => x.id === a3.request.id).assigneeId, rfT.pm.id);
  });

  // уход человека: отключённый исполнитель этапа
  const a4 = await api.as(ceo, () => api('createApp', { name: 'E', unitId: gold.id }));
  const s4 = await stagesOf(api, who.pm, a4.request);
  const des2 = await person(api, 'Дизайнер', 'member', 'd_design');
  await api('setMember', { unitId: gold.id, personId: des2.id });
  await api.as(ceo, () => api('updatePerson', { id: des2.id, active: false }));
  await check('отключённого человека не назначить на этап', () => mustFail(api.as(who.pm, () => api('updateTask', { id: s4.retext.id, patch: { assigneeId: des2.id } })), /отключён/));

  await check('убранный из юнита участник теряет доступ к доске', async () => {
    await api.as(ceo, () => api('removeMember', { unitId: gold.id, personId: who.aso.id }));
    const seen = await api.as(who.aso, () => api('getBoard', { unitId: gold.id })).then(b => b.tasks.length, () => 0);
    assert.equal(seen, 0, 'задачи видны: ' + seen);
  });

  assert.deepEqual(failed, [], '\n' + failed.join('\n'));
});

test('статусы приложений во времени: ряд по дням из журнала смены статусов', async () => {
  const api = await setup();
  const ceo = await person(api, 'CEO', 'superadmin', 'd_po');
  const gold = await api('createUnit', { name: 'Gold', key: 'GLD' });
  await api.as(ceo, () => api('createApp', { name: 'Live', unitId: gold.id, status: 'live', noRequest: true }));
  const { app } = await api.as(ceo, () => api('createApp', { name: 'Dev', unitId: gold.id }));
  const s = await api.as(ceo, () => api('getStatusSeries', { days: 7 }));
  assert.equal(s.days.length, 7);
  const last = i => Object.fromEntries(Object.entries(s.counts).map(([k, v]) => [k, v[i]]));
  const end = last(6);
  assert.equal(end.live, 1);
  assert.equal(end.dev, 1);
  assert.equal(Object.values(end).reduce((a, b) => a + b, 0), 2); // каждое приложение — ровно в одном статусе
  // добавленное списком уже в сторе было и раньше — весь период в «В сторе»; новое — только с дня создания
  assert.deepEqual(s.counts.live, [1, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(s.counts.dev.slice(0, 6), [0, 0, 0, 0, 0, 0]);
  assert.ok(app.id);
});

test('реджект: RM закрывает сам (задачи PM нет, релиз в очереди), скриншоты файлами видны CEO и PM', async () => {
  const api = await setup();
  const ceo = await person(api, 'CEO', 'superadmin', 'd_po');
  const gold = await api('createUnit', { name: 'Gold', key: 'GLD' });
  const who = await team(api, gold);
  const { request } = await api.as(ceo, () => api('createApp', { name: 'A', unitId: gold.id }));
  const st = await stagesOf(api, who.pm, request);
  await toRelease(api, who, st);
  await ready(api, who, st);
  await api.as(who.rm, () => api('releaseStep', { taskId: st.release.id, action: 'submit' }));
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const r = await api.as(who.rm, async () => {
    const res = await api('releaseStep', { taskId: st.release.id, action: 'reject', reason: 'Метаданные', self: true });
    await api('addTaskFiles', { taskId: st.release.id, tag: 'reject:1', files: [{ name: 'a.png', data: png }] });
    await assert.rejects(() => api('addTaskFiles', { taskId: st.release.id, tag: 'reject:1', files: [{ name: 'x', data: 'data:text/html,<b>' }] }), /только картинки/);
    return res;
  });
  assert.equal(r.task.release.rejectNo, 1);
  assert.equal(r.task.release.phase, ''); // релиз снова в очереди
  // задачи «Реджект №1» у PM нет в работе: она закрыта и назначена на RM, PM уведомлений о ней не получил
  const req = (await api.pg.query("select assignee_id, done_at from tasks where id = $1", [r.rejectRequestId])).rows[0];
  assert.ok(req.done_at && req.assignee_id === who.rm.id);
  assert.ok(!(await api.as(who.pm, () => api('getNotifications', {}))).some(n => n.taskId === r.rejectRequestId));
  // история и скриншоты
  const hist = await api.as(ceo, () => api('getReleaseHistory', { result: 'reject' }));
  const row = hist.rows.find(x => x.rejectNo === 1);
  assert.ok(row.selfClosed && row.shots === 1);
  assert.equal((await api.as(who.pm, () => api('getTaskFiles', { taskId: st.release.id, tag: 'reject:1' }))).length, 1);
  // и снова можно отправить
  await api.as(who.rm, () => api('releaseStep', { taskId: st.release.id, action: 'resubmit' }));
});
