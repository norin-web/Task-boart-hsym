// Edge Function admin-users: код функции запускается в Node с поддельным клиентом Supabase
// (Deno.serve и npm:-импорт подменяются), чтобы проверить порядок «права → изменения аккаунта».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SRC = fs.readFileSync(new URL('../supabase/functions/admin-users/index.ts', import.meta.url), 'utf8')
  .replace(/^import \{ createClient \} from 'npm:@supabase\/supabase-js@2';$/m, 'const { createClient } = globalThis.__supabase;');

/** Поддельный Supabase: таблица people и аккаунты входа; журнал всех изменений аккаунтов. */
function fakeSupabase({ people, users, tokens }) {
  const changes = [];
  const table = rows => {
    const q = { filters: [], patch: null, row: null, n: Infinity };
    const match = () => rows.filter(r => q.filters.every(f => f(r))).slice(0, q.n);
    const b = {
      select: () => b,
      eq: (c, v) => (q.filters.push(r => r[c] === v), b),
      is: (c, v) => (q.filters.push(r => (r[c] ?? null) === v), b),
      ilike: (c, v) => (q.filters.push(r => String(r[c] || '').toLowerCase() === String(v).toLowerCase()), b),
      limit: n => ((q.n = n), b),
      maybeSingle: async () => ({ data: match()[0] || null }),
      update: patch => ((q.patch = patch), b),
      insert: row => ((q.row = row), b),
      then: (ok, bad) => {
        if (q.patch) { match().forEach(r => Object.assign(r, q.patch)); return Promise.resolve({ error: null }).then(ok, bad); }
        if (q.row) { rows.push(q.row); return Promise.resolve({ error: null }).then(ok, bad); }
        return Promise.resolve({ data: match() }).then(ok, bad);
      },
    };
    return b;
  };
  const client = {
    from: () => table(people),
    auth: {
      getUser: async t => (tokens[t] ? { data: { user: { id: tokens[t] } }, error: null } : { data: {}, error: { message: 'bad' } }),
      admin: {
        createUser: async ({ email }) => {
          if (users.some(u => u.email === email)) return { error: { message: 'User already registered' } };
          const u = { id: 'auth_' + (users.length + 1), email };
          users.push(u);
          changes.push(['createUser', email]);
          return { data: { user: u }, error: null };
        },
        listUsers: async () => ({ data: { users } }),
        updateUserById: async (id, attrs) => (changes.push(['updateUser', id, Object.keys(attrs).join(',')]), { error: null }),
        deleteUser: async id => (changes.push(['deleteUser', id]), { error: null }),
      },
    },
  };
  return { client, changes };
}

async function loadFunction(fake) {
  let handler;
  globalThis.Deno = { serve: h => { handler = h; }, env: { get: () => 'x' } };
  globalThis.__supabase = { createClient: () => fake.client };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'admin-users-')), 'index.ts');
  fs.writeFileSync(file, SRC);
  await import(file);
  return async (token, body) => {
    const res = await handler(new Request('http://x', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }));
    return { status: res.status, body: await res.json() };
  };
}

function world() {
  const people = [
    { id: 'p_super', email: 'boss@x.ru', access: 'superadmin', active: true, user_id: 'auth_boss' },
    { id: 'p_mod', email: 'mod@x.ru', access: 'moderator', active: true, user_id: 'auth_mod' },
    // супер-админ, который ещё ни разу не входил: аккаунт есть, к профилю не привязан
    { id: 'p_super2', email: 'boss2@x.ru', access: 'superadmin', active: true, user_id: null },
  ];
  const users = [{ id: 'auth_boss', email: 'boss@x.ru' }, { id: 'auth_mod', email: 'mod@x.ru' }, { id: 'auth_boss2', email: 'boss2@x.ru' }];
  return fakeSupabase({ people, users, tokens: { MOD: 'auth_mod', BOSS: 'auth_boss' } });
}

test('admin-users: модератор не может сменить пароль супер-админу через «создать аккаунт»', async () => {
  const fake = world();
  const call = await loadFunction(fake);
  // профиль супер-админа указан явно
  let r = await call('MOD', { action: 'create', email: 'boss@x.ru', password: '12345678', personId: 'p_super' });
  assert.equal(r.status, 403);
  // свободный профиль супер-админа находится по email
  r = await call('MOD', { action: 'create', email: 'boss2@x.ru', password: '12345678' });
  assert.equal(r.status, 403);
  assert.deepEqual(fake.changes, []); // аккаунты не тронуты
  // прямой сброс пароля супер-админу — тоже нет
  r = await call('MOD', { action: 'password', personId: 'p_super', password: '12345678' });
  assert.equal(r.status, 403);
  assert.deepEqual(fake.changes, []);
});

test('admin-users: PM входы не создаёт, супер-админ — создаёт и привязывает супер-админа', async () => {
  const fake = world();
  const call = await loadFunction(fake);
  let r = await call('MOD', { action: 'create', email: 'new@x.ru', password: '12345678', name: 'Новый' });
  assert.equal(r.status, 403);
  r = await call('BOSS', { action: 'create', email: 'boss2@x.ru', password: '12345678' });
  assert.equal(r.status, 200);
  assert.equal(r.body.person.id, 'p_super2');
  assert.equal(r.body.person.user_id, 'auth_boss2');
});
