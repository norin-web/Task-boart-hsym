/**
 * Живые обновления (как в Jira): база сама присылает изменения задач, приложений и уведомлений (Supabase Realtime),
 * открытый экран тихо обновляется — без перезагрузки и без ожидания опроса. Права — те же, что у чтения (RLS):
 * человек получает только то, что ему видно. Свои правки не возвращаются эхом: экран их уже показал.
 * В локальном режиме (PGlite) рассылки нет — там одна вкладка.
 */
import { mode, supabase } from './data.js';

/** id, которые я только что менял сам: их эхо из базы пропускаем (экран уже показал правку). */
const mine = new Map();
export function markMine(id) {
  if (!id) return;
  mine.set(String(id), Date.now());
}
const isMine = id => {
  const at = mine.get(String(id));
  if (!at) return false;
  if (Date.now() - at > 6000) { mine.delete(String(id)); return false; }
  return true;
};

let channel = null;
let timer = null;
const batch = { tables: new Set(), units: new Set(), ids: new Set(), apps: new Set() };

/** Изменения копим полсекунды и отдаём экранам одним событием tasks:remote { tables, units, ids, apps }. */
function flush() {
  timer = null;
  // вкладка в фоне — копим дальше и отдаём, когда её откроют
  if (document.hidden) return;
  const detail = { tables: [...batch.tables], units: [...batch.units], ids: [...batch.ids], apps: [...batch.apps] };
  for (const s of Object.values(batch)) s.clear();
  if (detail.tables.length) document.dispatchEvent(new CustomEvent('tasks:remote', { detail }));
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && batch.tables.size && !timer) timer = setTimeout(flush, 300); });

function onChange(table, payload) {
  const row = payload.new && Object.keys(payload.new).length ? payload.new : payload.old || {};
  if (!row.id || (table !== 'notifications' && isMine(row.id))) return;
  batch.tables.add(table);
  if (row.unit_id) batch.units.add(row.unit_id);
  batch.ids.add(row.id);
  if (table === 'apps') batch.apps.add(row.id); else if (row.app_id) batch.apps.add(row.app_id);
  if (!timer) timer = setTimeout(flush, 500);
}

export function startLive() {
  if (mode !== 'supabase' || !supabase || channel) return;
  channel = supabase.channel('tasks-live');
  for (const table of ['tasks', 'apps', 'notifications']) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, p => onChange(table, p));
  }
  channel.subscribe();
  // вкладка проснулась — канал мог отвалиться; экраны и так сверяются при возврате (память экранов)
}

/**
 * Экран подписывается на живые изменения: fn({ tables, units, ids }) — пока still() (экран открыт).
 * Ушли с экрана — подписка снимается сама при следующем событии.
 */
export function onRemote(fn, still, tables = ['tasks', 'apps']) {
  const handler = e => {
    if (!still()) { document.removeEventListener('tasks:remote', handler); return; }
    if (e.detail.tables.some(t => tables.includes(t))) fn(e.detail);
  };
  document.addEventListener('tasks:remote', handler);
}
