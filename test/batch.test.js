import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createBackend } from '../web/src/backend.js';
import { pgliteClient, AUTH_STUB_SQL } from '../web/src/pglite-client.js';
import { batchClient } from '../web/src/batch.js';

const SCHEMA = fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');

test('пакетное чтение (read_batch) отдаёт то же, что отдельные запросы, и собирает их в один', async () => {
  const pg = new PGlite();
  await pg.exec(AUTH_STUB_SQL);
  await pg.exec(SCHEMA);
  const raw = pgliteClient(pg);
  let batches = 0;
  const counted = { from: t => raw.from(t), rpc: (fn, a) => { if (fn === 'read_batch') batches++; return raw.rpc(fn, a); } };
  const plain = createBackend(raw), batched = createBackend(batchClient(counted));
  const api = be => async (m, p) => { const r = await be.call(m, p || {}); if (!r.ok) throw new Error(`${m}: ${r.error}`); return r.data; };
  const A = api(plain), B = api(batched);

  const units = [];
  for (const name of ['Gold', 'RF', 'MVP']) units.push(await A('createUnit', { name }));
  for (let i = 0; i < 5; i++) await A('createApp', { unitId: units[i % 3].id, name: `App ${i}` });
  await A('createTask', { unitId: units[0].id, title: 'Обычная задача' });

  const day = { today: '2026-11-13' };
  const calls = [['bootstrap', day], ['listApps', {}], ['listApps', { full: true }], ['getPipeline', {}], ['getCeoDashboard', day],
    ['navCounts', day], ['getBoard', { unitId: units[0].id, ...day }], ['queryTasks', { open: true }]];
  for (const [m, p] of calls) {
    batches = 0;
    assert.deepEqual(await B(m, p), await A(m, p), `${m}: пакет отдал другое`);
    if (m === 'bootstrap') assert.equal(batches, 1, 'bootstrap — одним пакетом');
  }

  // условия и порядок: eq/neq/in/is/order desc/range/maybeSingle; пустой in — ничего
  const b = batchClient(raw);
  const [x, y, z, w] = await Promise.all([
    b.from('units').select('id,key').neq('key', 'GOLD').order('key', { ascending: false }).range(0, 0),
    b.from('fields').select('id').is('unit_id', null).maybeSingle(),
    b.from('units').select('id').in('id', []),
    b.from('units').select('id').eq('archived', false).order('id').limit(2),
  ]);
  const keys = units.map(u => u.key).filter(k => k !== 'GOLD').sort().reverse();
  assert.deepEqual(x.data.map(r => r.key), keys.slice(0, 1));
  assert.equal(y.data.id, 'f_priority');
  assert.deepEqual(z.data, []);
  assert.equal(w.data.length, 2);

  // чужие таблицы и выдуманные условия — отказ базы
  await assert.rejects(async () => { const r = await raw.rpc('read_batch', { p_queries: [{ t: 'pg_authid', c: '*' }] }); if (r.error) throw new Error(r.error.message); }, /недоступна/);
  await assert.rejects(async () => { const r = await raw.rpc('read_batch', { p_queries: [{ t: 'units', f: [['id', 'like', 'x']] }] }); if (r.error) throw new Error(r.error.message); }, /не поддерживается/);
});
