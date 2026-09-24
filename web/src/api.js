/** Клиент API: методы бэкенда (Supabase или локальная база). Записи идут строго по очереди. */
import { S } from './state.js';
import { getBackend } from './data.js';

let pending = 0;
function setPending(d) {
  pending += d;
  const el = document.getElementById('saving');
  if (el) el.hidden = pending <= 0;
}

export async function call(method, payload) {
  let r;
  try {
    r = await getBackend().call(method, payload || {}, { actorId: S.meId || '' });
  } catch (e) {
    throw new Error(/fetch|network/i.test(String(e && e.message)) ? 'Нет связи с сервером' : String(e && e.message || e));
  }
  if (r.ok) return r.data;
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
      const data = await call(method, typeof payload === 'function' ? payload() : payload);
      return onOk ? onOk(data) : data;
    } finally {
      setPending(-1);
    }
  });
  queue = p.catch(() => {});
  return p;
}
