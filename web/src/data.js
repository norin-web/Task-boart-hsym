/**
 * Источник данных.
 *   supabase — если заданы VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY: общая база команды, вход по email.
 *   local    — иначе: та же схема Postgres (PGlite) прямо в браузере, данные только на этом устройстве.
 */
import { createBackend } from './backend.js';

const URL_ = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const mode = URL_ && KEY ? 'supabase' : 'local';
export let supabase = null;
let backend = null;

export async function initBackend() {
  if (mode === 'supabase') {
    const { createClient } = await import('@supabase/supabase-js');
    supabase = createClient(URL_, KEY, { auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true } });
    backend = createBackend(supabase);
    return;
  }
  const [{ PGlite }, { pgliteClient }, schema] = await Promise.all([
    import('@electric-sql/pglite'),
    import('./pglite-client.js'),
    import('../../supabase/schema.sql?raw'),
  ]);
  const pg = new PGlite('idb://tasks-local');
  await pg.waitReady;
  // Роли, которые в Supabase есть из коробки; схема идемпотентна — применяем при каждом запуске
  await pg.exec(`
    do $$ begin create role anon; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated; exception when duplicate_object then null; end $$;`);
  await pg.exec(schema.default);
  backend = createBackend(pgliteClient(pg));
}

export function getBackend() {
  if (!backend) throw new Error('Хранилище ещё не готово');
  return backend;
}
