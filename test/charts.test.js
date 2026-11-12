// Свои графики аналитики: getChartData считает по метрике, разбивке и шагу; видно только то, что человек видит.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createBackend } from '../web/src/backend.js';
import { pgliteClient, AUTH_STUB_SQL, actAs } from '../web/src/pglite-client.js';
import { cleanChart, chartsOf, DEFAULT_CHARTS } from '../web/src/chartdefs.js';

const SCHEMA = fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const UID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TODAY = new Date().toISOString().slice(0, 10);
const daysAgo = k => new Date(Date.now() - k * 864e5).toISOString();

async function setup() {
  const pg = new PGlite();
  await pg.exec(AUTH_STUB_SQL);
  await pg.exec(SCHEMA);
  const backend = createBackend(pgliteClient(pg));
  const api = async (method, payload) => {
    const r = await backend.call(method, payload);
    if (!r.ok) throw Object.assign(new Error(`${method}: ${r.error}`), { code: r.code });
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
  const p = await api('createPerson', { name, email: `c${++n}@x.ru`, access, positionId });
  await api.pg.query('update people set user_id = $1 where id = $2', [UID(n), p.id]);
  return { ...p, uid: UID(n) };
}
const chart = (api, who, c, unitId) => api.as(who, () => api('getChartData', { chart: c, today: TODAY, unitId }));

test('настройка графика приводится к допустимой: чужая разбивка и линии «Итогом» не проходят', () => {
  const c = cleanChart({ metric: 'tasks', split: 'pm', view: 'lines', step: 'total', days: 13 });
  assert.equal(c.split, 'unit'); // у задач нет PM
  assert.equal(c.view, 'bars'); // линии — только по времени
  assert.equal(c.days, 30);
  assert.deepEqual(chartsOf({}).map(x => x.id), DEFAULT_CHARTS.map(x => x.id));
  assert.deepEqual(chartsOf({ charts: [{ id: 'mine', metric: 'rejects' }] }).map(x => x.id), ['mine']);
});

test('графики: приложения по юнитам и статусам, задачи по неделям, реджекты, просрочки, видимость PM', async () => {
  const api = await setup();
  const ceo = await person(api, 'CEO', 'superadmin', 'd_po');
  const pm = await person(api, 'PM Gold', 'moderator', 'd_po');
  const dev = await person(api, 'Dev', 'member', 'd_ios');
  const gold = await api('createUnit', { name: 'Gold', key: 'GLD' });
  const rf = await api('createUnit', { name: 'RF', key: 'RF' });
  for (const [u, who] of [[gold, pm], [gold, dev], [rf, dev]]) await api('setMember', { unitId: u.id, personId: who.id });

  await api.as(ceo, () => api('createApp', { name: 'Live Gold', unitId: gold.id, status: 'live', noRequest: true }));
  await api.as(ceo, () => api('createApp', { name: 'Live RF', unitId: rf.id, status: 'live', noRequest: true }));
  await api.as(ceo, () => api('createApp', { name: 'Dev Gold', unitId: gold.id, pmId: pm.id }));

  // «Юниты × статусы»: ось — статусы, ряды — юниты
  const units = await chart(api, ceo, { metric: 'apps', split: 'unit', view: 'curves', step: 'total' });
  const live = units.x.findIndex(x => x.key === 'live'), devI = units.x.findIndex(x => x.key === 'dev');
  const G = units.series.find(s => s.id === gold.id), R = units.series.find(s => s.id === rf.id);
  assert.equal(G.name, 'Gold');
  assert.equal(G.values[live], 1);
  assert.equal(G.values[devI], 1);
  assert.equal(R.values[live], 1);

  // по дням: на сегодня 3 приложения, разбивка по статусам
  const st = await chart(api, ceo, { metric: 'apps', split: 'status', view: 'lines', step: 'day', days: 7 });
  assert.equal(st.x.length, 7);
  assert.equal(st.total, 3);

  // аналитика и графики — только у CEO, PM их не получает
  await assert.rejects(chart(api, pm, { metric: 'apps', split: 'unit', view: 'bars', step: 'total' }), e => e.code === 'FORBIDDEN');

  // задачи: закрыта сегодня и 10 дней назад; просрочена одна
  const t1 = await api.as(ceo, () => api('createTask', { unitId: gold.id, title: 'A', assigneeId: dev.id }));
  const t2 = await api.as(ceo, () => api('createTask', { unitId: rf.id, title: 'B', assigneeId: dev.id }));
  await api.as(ceo, () => api('createTask', { unitId: gold.id, title: 'C', assigneeId: dev.id, dueDate: new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10) }));
  await api.pg.query("update tasks set done_at = $1, started_at = $2 where id = $3", [daysAgo(0), daysAgo(2), t1.id]);
  await api.pg.query("update tasks set done_at = $1, started_at = $2 where id = $3", [daysAgo(10), daysAgo(14), t2.id]);
  const byWeek = await chart(api, ceo, { metric: 'tasks', split: 'unit', view: 'bars', step: 'week', days: 30 });
  assert.equal(byWeek.x.length, 5);
  assert.equal(byWeek.total, 2);
  assert.equal(byWeek.series.find(s => s.id === gold.id).values.at(-1), 1);
  const cycle = await chart(api, ceo, { metric: 'cycle', split: 'none', view: 'number', step: 'total', days: 30 });
  assert.equal(cycle.unit, 'дн.');
  assert.equal(cycle.total, 3); // (2 + 4) / 2
  const late = await chart(api, ceo, { metric: 'overdue', split: 'person', view: 'bars', step: 'total', days: 30 });
  assert.equal(late.x[0].label, 'Dev');
  assert.equal(late.series[0].values[0], 1);

  // реджекты и релизы — из истории попыток релиза
  const rel = await api.as(ceo, () => api('createTask', { unitId: gold.id, title: 'Релиз' }));
  await api.pg.query("update tasks set step = 'release', release = $1 where id = $2", [JSON.stringify({ history: [
    { n: 1, result: 'reject', at: daysAgo(5) }, { n: 2, result: 'reject', at: daysAgo(40) }, { n: 3, result: 'live', at: daysAgo(1) }] }), rel.id]);
  const rej = await chart(api, ceo, { metric: 'rejects', split: 'none', view: 'number', step: 'total', days: 30 });
  assert.equal(rej.total, 1);
  const rel90 = await chart(api, ceo, { metric: 'releases', split: 'unit', view: 'bars', step: 'month', days: 90 });
  assert.equal(rel90.total, 1);

  // юнит с аналитики сужает всё
  const onlyRf = await chart(api, ceo, { metric: 'tasks', split: 'unit', view: 'bars', step: 'week', days: 30 }, rf.id);
  assert.ok(onlyRf.series.every(s => s.id === rf.id));
});

test('графики «Задачи» и «Время в работе»: без запросов, без этапов, перемотанных при разнесении, без этапа, розданного на подзадачи', async () => {
  const api = await setup();
  const ceo = await person(api, 'CEO', 'superadmin', 'd_po');
  const gold = await api('createUnit', { name: 'Gold', key: 'GLD' });
  // приложение «уже в работе»: «Разнести по этапам» закрывает пройденные этапы разом — это не работа за день
  const app = (await api.as(ceo, () => api('createApp', { name: 'Импорт', unitId: gold.id, noRequest: true }))).app;
  await api.as(ceo, () => api('placeApps', { items: [{ id: app.id, stage: 'qa' }] }));
  const placedDone = (await api.pg.query(`select count(*)::int n from tasks where app_id = $1 and kind = 'stage' and done_at <> ''`, [app.id])).rows[0].n;
  assert.ok(placedDone > 0);
  // настоящая работа: задача, взятая в работу неделю назад и закрытая сегодня
  const t = await api.as(ceo, () => api('createTask', { unitId: gold.id, title: 'Работа' }));
  const b = await api.as(ceo, () => api('getBoard', { unitId: gold.id }));
  const cols = b.unit.settings.columns;
  await api.as(ceo, () => api('updateTask', { id: t.id, patch: { status: cols.find(c => c.kind === 'progress').id } }));
  await api.pg.query(`update tasks set started_at = $1, created_at = $1 where id = $2`, [daysAgo(7), t.id]);
  await api.as(ceo, () => api('updateTask', { id: t.id, patch: { status: cols.find(c => c.kind === 'done').id } }));
  // этап, розданный на подзадачи: считается подзадача, не сам этап
  const stage = (await api.pg.query(`select id from tasks where app_id = $1 and kind = 'stage' and done_at = '' order by created_at limit 1`, [app.id])).rows[0];
  const part = await api.as(ceo, () => api('createTask', { unitId: gold.id, title: 'Подзадача', parentId: stage.id }));
  await api.pg.query(`update tasks set step = 'part', created_at = $1, started_at = $1 where id = $2`, [daysAgo(3), part.id]);
  await api.as(ceo, () => api('updateTask', { id: part.id, patch: { status: cols.find(c => c.kind === 'done').id } }));
  await api.pg.query(`update tasks set done_at = $1 where id = $2`, [new Date().toISOString(), stage.id]);

  const d = await chart(api, ceo, { metric: 'tasks', split: 'none', step: 'total', days: 30 });
  assert.equal(d.series[0].values.reduce((a, b) => a + b, 0), 2); // «Работа» и подзадача
  const cyc = await chart(api, ceo, { metric: 'cycle', split: 'none', step: 'total', days: 30 });
  assert.ok(cyc.total >= 3 && cyc.total <= 7, 'среднее — по настоящей работе, без нулей от перемотки: ' + cyc.total);
});
