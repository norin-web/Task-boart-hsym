/**
 * Источник данных.
 *   supabase — если заданы VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY: общая база команды, вход по email.
 *   local    — иначе: та же схема Postgres (PGlite) прямо в браузере, данные только на этом устройстве.
 *              Входа нет — «Войти как» переключает, от чьего имени работают правила доступа.
 */
import { createBackend, ApiError } from './backend.js';

const URL_ = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const mode = URL_ && KEY ? 'supabase' : 'local';
export let supabase = null;
let backend = null;
let pg = null;
let actAsFn = null;
let localActor = null;

/** Вызов серверной функции Supabase с понятными ошибками. */
async function invoke(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let msg = error.message || 'Ошибка серверной функции';
    try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch { /* тело не JSON */ }
    if (/Failed to send|not found|404/i.test(msg)) msg = `Серверная функция ${name} не развёрнута в Supabase — см. README, раздел «Аккаунты»`;
    throw new ApiError(msg, 'FUNCTION');
  }
  if (data && data.error) throw new ApiError(data.error, 'FUNCTION');
  return data;
}

/**
 * Замок на локальную базу (Web Locks): держим, пока открыта вкладка. takeOver — забрать у другой вкладки;
 * у неё замок отнимается, и она перезагружается в экран «открыто в другой вкладке», ничего не записав.
 */
function holdLocalLock(takeOver) {
  if (!navigator.locks) return Promise.resolve(true);
  return new Promise(resolve => {
    navigator.locks.request('tasks-local-db', takeOver ? { steal: true } : { ifAvailable: true }, lock => {
      if (!lock) { resolve(false); return null; }
      resolve(true);
      return new Promise(() => {}); // держим до закрытия вкладки
    }).catch(() => location.reload()); // замок забрала другая вкладка
  });
}

export async function initBackend(opts = {}) {
  if (mode === 'supabase') {
    const { createClient } = await import('@supabase/supabase-js');
    supabase = createClient(URL_, KEY, { auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true } });
    backend = createBackend(supabase, { invoke });
    return;
  }
  // Локальная база — одна на браузер, и две вкладки затирают данные друг друга: работает только одна
  if (!(await holdLocalLock(opts.takeOver))) throw new ApiError('Tasks уже открыт в другой вкладке', 'LOCKED');
  const [{ PGlite }, { pgliteClient, AUTH_STUB_SQL, actAs }, schema] = await Promise.all([
    import('@electric-sql/pglite'),
    import('./pglite-client.js'),
    import('../../supabase/schema.sql?raw'),
  ]);
  pg = new PGlite('idb://tasks-local');
  await pg.waitReady;
  actAsFn = actAs;
  // Заглушка Supabase Auth + схема (идемпотентна — применяем при каждом запуске)
  await pg.exec(AUTH_STUB_SQL);
  await pg.exec(schema.default);
  backend = createBackend(pgliteClient(pg));
}

/** Локальный режим: стереть базу этого браузера (все юниты, задачи, люди) и начать с нуля. */
export async function resetLocalData() {
  if (mode !== 'local') return;
  if (pg) await pg.close();
  await new Promise(resolve => {
    const q = indexedDB.deleteDatabase('/pglite/tasks-local');
    q.onsuccess = q.onerror = q.onblocked = () => resolve();
  });
  Object.keys(localStorage).filter(k => k.startsWith('tm.') && k !== 'tm.theme').forEach(k => localStorage.removeItem(k));
}

export function getBackend() {
  if (!backend) throw new Error('Хранилище ещё не готово');
  return backend;
}

/* ---------- локальный режим: «Войти как» ---------- */

/** Все люди (без учёта прав) — для выбора, от чьего имени работать. */
export async function localPeople() {
  await actAsFn(pg, null);
  const r = await pg.query(`select id, name, email, access, position_id, active, is_dev, color, avatar from people order by is_dev desc,
    case access when 'superadmin' then 0 when 'moderator' then 1 when 'rm' then 2 when 'lead' then 3 else 4 end, name`);
  if (localActor) await actAsFn(pg, localActor.uid);
  return r.rows;
}

/**
 * Работать от имени человека: правила доступа (RLS) применяются как к нему.
 * Без personId — аккаунт «Разработчик» (CEO с режимом разработчика; создаётся, если его нет).
 */
export async function localLogin(personId) {
  await actAsFn(pg, null);
  const devId = await ensureDevAccount();
  if (!personId) personId = devId;
  await pg.query('update people set user_id = gen_random_uuid() where id = $1 and user_id is null', [personId]);
  const r = await pg.query('select id, user_id, email from people where id = $1', [personId]);
  if (!r.rows[0]) throw new Error('Человек не найден');
  localActor = { id: r.rows[0].id, uid: r.rows[0].user_id };
  await actAsFn(pg, localActor.uid, r.rows[0].email);
  return localActor.id;
}

/**
 * Локальная тулза — среда разработчика: отдельный аккаунт «Разработчик» (CEO + режим разработчика) в «Войти как».
 * Старый «Администратор» (пустая тулза до этой версии) становится им. Возвращает его id.
 */
async function ensureDevAccount() {
  // прежний «Администратор» пустой тулзы — это и есть аккаунт разработчика
  await pg.query(`update people set name = 'Разработчик', role = 'Режим разработчика', is_dev = true, active = true,
    prefs = prefs || '{"ceoMode": "admin"}'::jsonb where name = 'Администратор' and access = 'superadmin' and email = ''`);
  const dev = await pg.query(`select id from people where is_dev and active order by (name = 'Разработчик') desc, created_at limit 1`);
  if (dev.rows[0]) {
    await pg.query('update people set is_dev = (id = $1) where is_dev or id = $1', [dev.rows[0].id]); // разработчик — один
    return dev.rows[0].id;
  }
  const id = 'p_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  await pg.query(`insert into people (id, name, role, access, is_dev, prefs, created_at)
    values ($1, 'Разработчик', 'Режим разработчика', 'superadmin', true, '{"ceoMode": "admin"}', $2)`, [id, new Date().toISOString()]);
  return id;
}

/** Выполнить fn без ограничений прав (заполнение демо-данными), затем вернуться к текущему человеку. */
export async function asSystem(fn) {
  await actAsFn(pg, null);
  try { return await fn(); } finally { if (localActor) await actAsFn(pg, localActor.uid); }
}
