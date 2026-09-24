/** Клиент API: POST /api/<method>. Записи идут строго по очереди. */
import { S } from './state.js';

let pending = 0;
function setPending(d) {
  pending += d;
  const el = document.getElementById('saving');
  if (el) el.hidden = pending <= 0;
}

export async function call(method, payload) {
  let res;
  try {
    res = await fetch('/api/' + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Actor': S.meId || '' },
      body: JSON.stringify(payload || {}),
    });
  } catch {
    throw new Error('Нет связи с сервером');
  }
  let r;
  try { r = await res.json(); } catch { throw new Error('Сервер ответил ошибкой (' + res.status + ')'); }
  if (r.ok) return r.data;
  const e = new Error(r.error || 'Ошибка сервера');
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
