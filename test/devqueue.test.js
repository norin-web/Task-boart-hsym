// Очередь на разработку: дизайн закрыт, iOS не начат; видят CEO и PM (PM — только приложения из своего списка).
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
  const api = async (method, payload) => {
    const r = await backend.call(method, payload, {});
    if (!r.ok) throw Object.assign(new Error(`${method}: ${r.error}`), { code: r.code });
    return r.data;
  };
  api.as = async (person, fn) => { await actAs(pg, person.uid, person.email); try { return await fn(); } finally { await actAs(pg, null); } };
  api.pg = pg;
  return api;
}
let n = 0;
async function person(api, name, access, positionId) {
  const p = await api('createPerson', { name, email: `q${++n}@x.ru`, access, positionId });
  await api.pg.query('update people set user_id = $1 where id = $2', [UID(n), p.id]);
  return { ...p, uid: UID(n), email: `q${n}@x.ru` };
}
async function finish(api, who, pm, id) {
  const { rows } = await api.pg.query('select checklist from tasks where id = $1', [id]);
  const cl = (rows[0].checklist || []).map(i => ({ ...i, done: true }));
  if (cl.length) await api.as(who, () => api('updateTask', { id, patch: { checklist: cl } })).catch(() => null);
  await api.as(who, () => api('saveDevForm', { taskId: id, answers: DEV_ANSWERS })).catch(() => null);
  await api.as(who, () => api('updateTask', { id, patch: { status: 'review' } }));
  await api.as(pm, () => api('reviewDecision', { taskId: id, approve: true }));
}

test('очередь на разработку: появляется после дизайна, уходит со стартом iOS', async () => {
  const api = await setup();
  const ceo = await person(api, 'CEO', 'superadmin', 'd_po');
  const pm = await person(api, 'PM', 'moderator', 'd_po');
  const lead = await person(api, 'Лид', 'lead', 'd_design');
  const ios = await person(api, 'iOS', 'member', 'd_ios');
  const gold = await api('createUnit', { name: 'Gold', key: 'GLD' });
  for (const p of [pm, lead, ios]) await api('setMember', { unitId: gold.id, personId: p.id });
  const { app, request } = await api.as(ceo, () => api('createApp', { name: 'Alpha', unitId: gold.id }));
  const st = Object.fromEntries((await api.as(pm, () => api('decomposeRequest', { taskId: request.id }))).map(t => [t.step, t]));
  assert.equal((await api.as(ceo, () => api('getDevQueue', {}))).length, 0, 'до дизайна очереди нет');
  await finish(api, lead, pm, st.design.id);
  const q = await api.as(ceo, () => api('getDevQueue', {}));
  assert.equal(q.length, 1);
  assert.equal(q[0].appId, app.id);
  assert.equal(q[0].designerId, st.design.assigneeId);
  assert.equal((await api.as(pm, () => api('getDevQueue', {}))).length, 1, 'PM юнита видит очередь');
  await api.as(ios, () => api('updateTask', { id: st.ios.id, patch: { status: 'in_progress' } }));
  assert.equal((await api.as(ceo, () => api('getDevQueue', {}))).length, 0, 'iOS начат — из очереди ушло');
});
