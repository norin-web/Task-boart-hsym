/**
 * Мониторинг: необработанные ошибки в браузере пользователя → таблица client_errors (видно в «Режим разработчика →
 * Ошибки у пользователей»). Только на проде (Supabase) и после входа; одинаковые — один раз, не больше 20 за сессию;
 * шум (расширения браузера, ResizeObserver) не шлём.
 */
import { call } from './api.js';
import { S } from './state.js';
import { mode } from './data.js';

const NOISE = [/ResizeObserver loop/i, /Script error\.?$/i, /extension:\/\//i];
const seen = new Set();
let sent = 0;

/** Версия сборки — хеш основного файла (index-XXXX.js), чтобы понимать, на какой версии ошибка. */
const version = () => ((document.querySelector('script[type=module][src*="index-"]') || {}).src || '').match(/index-([\w-]+)\.js/)?.[1] || 'dev';

export function report(message, stack = '') {
  if (mode !== 'supabase' || !S.started) return;
  const msg = String(message || '').trim().slice(0, 1000);
  const st = String(stack || '').slice(0, 4000);
  if (!msg || sent >= 20 || NOISE.some(re => re.test(msg) || re.test(st))) return;
  const key = msg + '|' + st.slice(0, 200);
  if (seen.has(key)) return;
  seen.add(key);
  sent++;
  call('logClientError', { message: msg, stack: st, url: location.hash.slice(0, 500), agent: navigator.userAgent.slice(0, 300), version: version() }).catch(() => {});
}

export function initMonitor() {
  document.addEventListener('tasks:apierror', e => report(`${e.detail.method}: ${e.detail.error}`, 'api'));
  window.addEventListener('error', e => report(e.message, e.error && e.error.stack));
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason;
    report((r && r.message) || String(r), r && r.stack);
  });
}
