/**
 * Замер скорости экранов (включается ссылкой ?perf=1, выключается ?perf=0; хранится в браузере).
 * На каждый экран: сколько грузился (от перехода до затишья в сети), сколько вызовов API и HTTP-запросов к базе,
 * сколько данных пришло, самые долгие запросы. Панель внизу справа; «Скопировать отчёт» — текстом для разбора.
 * Никуда ничего не отправляет: всё остаётся в этой вкладке.
 */
const KEY = 'tm.perf';
const params = new URLSearchParams(location.search);
if (params.get('perf') === '1') localStorage.setItem(KEY, '1');
if (params.get('perf') === '0') localStorage.removeItem(KEY);
export const perfOn = (() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } })();

const screens = [];     // завершённые экраны
let cur = null;         // текущий экран
let inflight = 0;
let idleTimer = null;
const IDLE = 700;       // сеть молчит столько — экран считаем загруженным

const now = () => performance.now();

function startScreen(name) {
  if (!perfOn) return;
  finish();
  cur = { name, start: now(), end: 0, calls: [], http: [] };
  schedule();
}
function finish() {
  if (!cur) return;
  if (cur.calls.length || cur.http.length) screens.unshift(cur);
  if (screens.length > 30) screens.length = 30;
  cur = null;
  draw();
}
function schedule() {
  clearTimeout(idleTimer);
  if (inflight > 0) return;
  idleTimer = setTimeout(() => { if (cur && inflight === 0) { cur.done = true; draw(); } }, IDLE);
}

/** Вызов API (метод backend): время целиком, включая несколько запросов к базе внутри. */
export async function timeCall(method, fn) {
  if (!perfOn) return fn();
  const t0 = now(); const s = cur;
  try { return await fn(); } finally {
    const ms = now() - t0;
    if (s) { s.calls.push({ method, ms, at: t0 - s.start }); s.end = Math.max(s.end, now() - s.start); }
    draw();
  }
}

// HTTP-запросы к базе (Supabase): перехватываем fetch — время и размер ответа
if (perfOn && typeof window !== 'undefined' && window.fetch) {
  const orig = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = String((input && input.url) || input || '');
    const isDb = /supabase\.co/.test(url) && !/realtime/.test(url);
    if (!isDb) return orig(input, init);
    const s = cur; const t0 = now();
    inflight++; clearTimeout(idleTimer);
    try {
      const res = await orig(input, init);
      // размер: читаем копию ответа (только в режиме замера)
      res.clone().arrayBuffer().then(buf => {
        const rec = { path: shortPath(url), ms: now() - t0, kb: buf.byteLength / 1024, at: s ? t0 - s.start : 0 };
        if (s) { s.http.push(rec); s.end = Math.max(s.end, now() - s.start); }
        draw();
      }).catch(() => {});
      return res;
    } finally {
      inflight--; schedule();
    }
  };
}
const shortPath = url => {
  try {
    const u = new URL(url);
    const p = u.pathname.replace(/^\/rest\/v1\//, '').replace(/^\/auth\/v1\//, 'auth/');
    const sel = u.searchParams.get('select');
    return p + (sel ? ' [' + (sel.length > 40 ? sel.slice(0, 40) + '…' : sel) + ']' : '');
  } catch { return url.slice(0, 60); }
};

/* ---------- панель ---------- */
let box = null, open = true;
const fmt = ms => (ms >= 1000 ? (ms / 1000).toFixed(1) + ' с' : Math.round(ms) + ' мс');
const sum = (list, k) => list.reduce((a, x) => a + x[k], 0);
function rowsOf() { return [cur, ...screens].filter(Boolean); }
function line(s) {
  const kb = sum(s.http, 'kb');
  const slow = [...s.http].sort((a, b) => b.ms - a.ms)[0];
  return { name: s.name, total: s.end, calls: s.calls.length, http: s.http.length, kb, slow, done: s !== cur || s.done };
}
function draw() {
  if (!perfOn || typeof document === 'undefined' || !document.body) return;
  if (!box) {
    box = document.createElement('div');
    box.id = 'perf-panel';
    box.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:9999;max-width:520px;font:12px/1.35 -apple-system,system-ui,sans-serif;background:rgba(17,19,24,.92);color:#fff;border-radius:12px;padding:10px 12px;box-shadow:0 6px 24px rgba(0,0,0,.25)';
    document.body.append(box);
  }
  const list = rowsOf().slice(0, 8).map(line);
  box.innerHTML = '';
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:' + (open ? '6px' : '0');
  head.innerHTML = '<b style="flex:1">Замер скорости</b>';
  const btn = (t, f) => { const b = document.createElement('button'); b.textContent = t; b.style.cssText = 'border:0;border-radius:8px;padding:3px 8px;background:#2a2f3a;color:#fff;font:inherit;cursor:pointer'; b.onclick = f; return b; };
  head.append(btn('Скопировать отчёт', copyReport), btn('Сброс', () => { screens.length = 0; draw(); }), btn(open ? '—' : '+', () => { open = !open; draw(); }));
  box.append(head);
  if (!open) return;
  const t = document.createElement('table');
  t.style.cssText = 'border-collapse:collapse;width:100%';
  t.innerHTML = '<tr style="opacity:.6"><td>Экран</td><td align=right>Загрузка</td><td align=right>API</td><td align=right>Запросов</td><td align=right>КБ</td><td>Самый долгий</td></tr>'
    + list.map(x => `<tr><td>${esc(x.name)}${x.done ? '' : ' …'}</td><td align=right><b>${fmt(x.total)}</b></td><td align=right>${x.calls}</td><td align=right>${x.http}</td><td align=right>${Math.round(x.kb)}</td><td style="opacity:.75;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${x.slow ? fmt(x.slow.ms) + ' ' + esc(x.slow.path) : ''}</td></tr>`).join('');
  box.append(t);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function copyReport() {
  const lines = [];
  lines.push(`Замер скорости · ${new Date().toLocaleString('ru-RU')} · ${location.host}`);
  for (const s of rowsOf().reverse()) {
    const x = line(s);
    lines.push('', `${x.name}: ${fmt(x.total)} · API ${x.calls} · запросов ${x.http} · ${Math.round(x.kb)} КБ`);
    for (const c of [...s.calls].sort((a, b) => b.ms - a.ms).slice(0, 6)) lines.push(`  API ${c.method}: ${fmt(c.ms)} (с ${fmt(c.at)})`);
    for (const r of [...s.http].sort((a, b) => b.ms - a.ms).slice(0, 8)) lines.push(`  ${fmt(r.ms)} · ${r.kb.toFixed(1)} КБ · ${r.path} (с ${fmt(r.at)})`);
  }
  const text = lines.join('\n');
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(
    () => { const b = box && box.querySelector('button'); if (b) { b.textContent = 'Скопировано'; setTimeout(draw, 1500); } },
    () => { window.prompt('Скопируйте отчёт', text); });
}

// первый экран — запуск приложения (вход, bootstrap)
if (perfOn) startScreen('Запуск');

/** Начало экрана — из роутера при каждом переходе. */
export const perfScreen = name => startScreen(name);
