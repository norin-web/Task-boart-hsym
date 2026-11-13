/** Клиент API: методы бэкенда (Supabase или локальная база). Записи идут строго по очереди. */
import { S } from './state.js';
import { getBackend } from './data.js';
import { markMine } from './live.js';
import { timeCall } from './perf.js';

let pending = 0;
function setPending(d) {
  pending += d;
  const el = document.getElementById('saving');
  if (el) el.hidden = pending <= 0;
}

export async function call(method, payload) {
  let r;
  try {
    r = await timeCall(method, () => getBackend().call(method, payload || {}, { actorId: S.meId || '' }));
  } catch (e) {
    throw new Error(/fetch|network/i.test(String(e && e.message)) ? 'Нет связи с сервером' : String(e && e.message || e));
  }
  if (r.ok) return r.data;
  // неожиданные ошибки (база не по правилам, сбой кода) — в мониторинг (monitor.js); отказы по правам и правилам — нет
  if ((r.code === 'DB' || r.code === 'INTERNAL') && method !== 'logClientError') {
    document.dispatchEvent(new CustomEvent('tasks:apierror', { detail: { method, error: r.error } }));
  }
  const e = new Error(/Failed to fetch|NetworkError/i.test(r.error) ? 'Нет связи с сервером' : r.error || 'Ошибка сервера');
  e.code = r.code;
  e.data = r.data;
  throw e;
}

// Очередь записей: например, правка только что созданной задачи уйдёт после её создания и уже с настоящим id.
let queue = Promise.resolve();

/** payload может быть функцией — тогда он вычисляется в момент отправки. */
export function send(method, payload, onOk) {
  const p = queue.then(async () => {
    setPending(1);
    try {
      const body = typeof payload === 'function' ? payload() : payload;
      // свою правку живые обновления не вернут эхом (экран её уже показал)
      if (body) for (const k of ['id', 'taskId', 'appId', 'requestId']) if (body[k]) markMine(body[k]);
      const data = await call(method, body);
      if (data && typeof data === 'object' && data.id) markMine(data.id);
      return onOk ? onOk(data) : data;
    } finally {
      setPending(-1);
    }
  });
  queue = p.catch(() => {});
  return p;
}

/*
 * Память экранов (как в Jira): открытый раньше экран показываем сразу из памяти вкладки, свежие данные грузим в фоне
 * и перерисовываем, только если что-то поменялось. Живёт до перезагрузки страницы; ключ — экран и человек.
 */
const memo = new Map();

/**
 * key — экран (например, 'pm-home'), fetch() — загрузка, apply(data, fromMemory) — показать.
 * still() — экран ещё открыт (иначе свежие данные только запоминаем). Ошибка при показанной памяти — тихо (данные уже на экране).
 */
const seqs = new Map(); // последний запрос по экрану: более старый ответ, пришедший позже, отбрасываем
export async function swr(key, fetch, apply, { still = () => true } = {}) {
  const k = (S.meId || '') + ':' + key;
  const my = (seqs.get(k) || 0) + 1;
  seqs.set(k, my);
  const had = memo.get(k);
  if (had) apply(had.data, true);
  let data;
  try { data = await fetch(); } catch (e) { if (!had && seqs.get(k) === my) throw e; return; }
  if (seqs.get(k) !== my) return;
  const json = safeJson(data);
  memo.set(k, { data, json });
  if (!still()) return;
  if (!had || had.json !== json) apply(data, false);
}
const safeJson = v => { try { return JSON.stringify(v); } catch { return String(Math.random()); } };

/** Забыть экран (после своей правки, чтобы при возврате не мелькнуло старое). Без ключа — всё. */
export function forget(key) {
  if (!key) { memo.clear(); return; }
  memo.delete((S.meId || '') + ':' + key);
}

/** Взять экран из памяти (или undefined) — для экранов, которые строятся по шагам и обновляются сами. */
export const peek = key => (memo.get((S.meId || '') + ':' + key) || {}).data;
/** Запомнить данные экрана. */
export const keep = (key, data) => memo.set((S.meId || '') + ':' + key, { data, json: safeJson(data) });
