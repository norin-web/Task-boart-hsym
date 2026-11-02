/**
 * Проверка по дизайну: `npm run design`.
 * Снимает экраны на демо-данных с датой из макетов, сравнивает с листами Paper (test/design/baseline),
 * строит отчёт design-report/index.html и проверяет размеры из макетов (test/design/metrics.mjs).
 * Код выхода 1 — если не сошёлся хоть один размер; процент отличия от макета только показывается.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { SCREENS, NOTES } from './screens.mjs';
import { METRICS } from './metrics.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const BASE_DIR = path.join(ROOT, 'test/design/baseline');
const OUT = path.join(ROOT, 'design-report');
const URL_ = process.env.DESIGN_URL || 'http://localhost:5177/';
const only = process.argv.slice(2);

const up = async () => { try { return (await fetch(URL_)).ok; } catch { return false; } };
let server = null;
if (!(await up())) {
  server = spawn('npx', ['vite'], { cwd: ROOT, stdio: 'ignore', detached: true });
  for (let i = 0; i < 60 && !(await up()); i++) await new Promise(r => setTimeout(r, 500));
}

fs.rmSync(OUT, { recursive: true, force: true });
for (const d of ['code', 'diff', 'design']) fs.mkdirSync(path.join(OUT, d), { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
await ctx.route(/mzstatic|itunes\.apple/, r => r.abort()); // иконки из стора: в макетах буквы
const page = await ctx.newPage();
// дата как на листах; только сдвиг часов — таймеры настоящие, иначе локальная база не успевает записаться
await page.addInitScript(fixed => {
  const R = Date, off = fixed - R.now();
  window.Date = class extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } };
}, Date.parse('2026-10-30T18:00:00+03:00'));
const logs = [];
page.on('pageerror', e => logs.push(String(e.message || e)));
const diag = [];
page.on('console', m => diag.push(m.type() + ': ' + m.text().slice(0, 160)));

// чистая база → демо-данные → вход как Анна
await page.goto(URL_);
await page.waitForFunction(() => document.querySelector('#sidebar .nav-item'), null, { timeout: 60000 });
await page.evaluate(async () => {
  const { seedDemo } = await import('/src/demo.js');
  await seedDemo();
});
await page.waitForTimeout(3000);
await page.reload();
await page.waitForFunction(() => document.querySelector('#sidebar .nav-item'), null, { timeout: 60000 });
const ids = await page.evaluate(async () => {
  const { call } = await import('/src/api.js');
  const apps = await call('listApps', {});
  const carrot = apps.find(a => /CARROT/.test(a.name)), streaks = apps.find(a => a.name === 'Streaks');
  const stage = streaks.requests[0].stages.find(s => /^Дизайн/.test(s.title));
  const release = carrot.requests[0].stages.find(s => /^Релиз/.test(s.title));
  const { people } = await call('bootstrap', { today: new Date().toISOString().slice(0, 10) });
  const pm = people.find(x => x.name === 'Екатерина Соколова'), pm2 = people.find(x => x.name === 'Олег Никитин');
  const rm = people.find(x => x.access === 'rm');
  const lead = people.find(x => x.name === 'Мария Иванова'), member = people.find(x => x.name === 'Алексей Морозов'), julia = people.find(x => x.name === 'Юлия Павлова');
  return { carrot: carrot.id, streaks: streaks.id, mvp: streaks.unitId, rf: carrot.unitId, stage: stage.id, release: release.id, ceo: localStorage.getItem('tm.localActor'), pm: JSON.stringify(pm.id), pm2: JSON.stringify(pm2.id), rm: JSON.stringify(rm.id), lead: JSON.stringify(lead.id), member: JSON.stringify(member.id), julia: JSON.stringify(julia.id) };
});

// служебное режима разработчика в снимках не нужно: в макетах его нет
const hideDev = () => page.addStyleTag({ content: '.dev-item, .view-as, .lens-bar { display: none !important; }' });
await hideDev();

const go = async hash => {
  const low = role === 'lead' || role === 'member'; // аналитика им закрыта: прыжок через неё увёл бы на главную
  await page.evaluate(([h, bounce]) => {
    document.body.click(); // закрывает меню аккаунта в сайдбаре
    document.querySelectorAll('#palette-root > *, #modal-root > *, #panel-root > *, .menu').forEach(e => e.remove()); // окна прошлого экрана
    location.hash = bounce;
    setTimeout(() => { location.hash = h; }, 50);
  }, [hash, low ? '#/settings' : '#/analytics']);
  await page.waitForTimeout(low ? 2000 : 900);
};

// Перезагрузка посреди записи в локальную базу (IndexedDB) иногда вешает следующий запуск: сперва дожидаемся очереди
// запросов (лёгкий запрос встаёт после всех записей), при зависании — ещё одна попытка
const reloadSafe = async () => {
  await page.evaluate(async () => { try { const { call } = await import('/src/api.js'); await call('whoami', {}); } catch { /* ещё не вошли */ } }).catch(() => {});
  await page.waitForTimeout(300);
  for (let i = 0; i < 4; i++) {
    if (i < 2) await page.reload(); else await page.goto(URL_ + '#/settings');
    try { await page.waitForFunction(() => document.querySelector('#sidebar .nav-item'), null, { timeout: 25000 }); return; } catch {
      if (process.env.DIAG) { await page.screenshot({ path: process.env.DIAG + '/hang-' + i + '.png' }); console.log('ЗАВИСЛО', i, (await page.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => '?')).replace(/\n/g, ' / '), '| консоль:', diag.slice(-8).join(' || ')); }
    }
  }
  throw new Error('страница не загрузилась после четырёх попыток');
};

// вход за роль листа: экраны без `as` — за CEO
let role = 'ceo', seeded = false, seededLead = false;
const loginAs = async as => {
  if (as === role) return;
  role = as;
  // входящие от CEO: новые запросы в юнитах PM
  if (as === 'pm' && !seeded) {
    seeded = true;
    await page.evaluate(async unitId => {
      const { call } = await import('/src/api.js');
      for (const [name, dueDate] of [['Tide', '2026-12-14'], ['Things Mini', '2026-10-29'], ['Forest Mini', '2026-11-20']]) await call('createApp', { name, unitId, requestTitle: 'New App', priority: 'o_high', dueDate });
    }, ids.mvp);
    await page.waitForTimeout(1500);
  }
  const actor = async who => {
    await page.evaluate(id => localStorage.setItem('tm.localActor', id), who);
    await reloadSafe();
  };
  // задачи Lead и сотрудника: в демо их нет, а листы показывают фокус, ревью и «Раздано»
  if (as === 'lead' && !seededLead) {
    seededLead = true;
    await actor(ids.ceo);
    const made = await page.evaluate(async ({ unitId, lead, member, julia }) => {
      const { call } = await import('/src/api.js');
      const { S, todayStr, addDays } = await import('/src/state.js');
      const st = S.units.find(u => u.id === unitId).settings, prog = st.columns.find(c => c.kind === 'progress').id;
      const add = (title, assigneeId, dueDate, status) => call('createTask', { unitId, title, assigneeId, dueDate, status });
      const t1 = await add('Экраны онбординга', lead, todayStr(), prog);
      await add('Иконка приложения', lead, addDays(1), prog);
      await add('Экран настроек', lead, addDays(-2), prog);
      await add('Подключить покупки', member, todayStr(), prog);
      await add('Исправить вход', member, addDays(1), prog);
      return { t1: t1.id, review: st.review.column, julia };
    }, { unitId: ids.mvp, lead: JSON.parse(ids.lead), member: JSON.parse(ids.member), julia: JSON.parse(ids.julia) });
    await actor(ids.lead);
    const parts = await page.evaluate(async ({ t1, julia }) => {
      const { call } = await import('/src/api.js');
      const { addDays } = await import('/src/state.js');
      return (await call('splitTask', { taskId: t1, items: [{ title: 'Первый экран', assigneeId: julia, dueDate: addDays(1) }, { title: 'Экран выбора', assigneeId: julia, dueDate: addDays(3) }] })).map(x => x.id);
    }, made);
    await actor(ids.julia);
    await page.evaluate(async ({ id, status }) => { const { call } = await import('/src/api.js'); await call('updateTask', { id, patch: { status } }); }, { id: parts[0], status: made.review });
    await page.waitForTimeout(800);
  }
  await actor(ids[as]);
  await hideDev();
};

const results = [], checks = [];
const snap = async s => {
  if (only.length && !only.includes(s.code)) return;
  await loginAs(s.as || 'ceo');
  await page.setViewportSize({ width: 1440, height: s.height || 900 });
  await go(typeof s.route === 'function' ? s.route(ids) : s.route);
  if (s.act) { await s.act(page, ids); await page.waitForTimeout(500); }
  const shot = path.join(OUT, 'code', s.code + '.png');
  await page.screenshot({ path: shot });
  const r = { ...s, route: undefined, act: undefined, diff: null };
  const basePath = path.join(BASE_DIR, s.code + '.png');
  if (fs.existsSync(basePath)) {
    fs.copyFileSync(basePath, path.join(OUT, 'design', s.code + '.png'));
    const a = PNG.sync.read(fs.readFileSync(basePath)), b = PNG.sync.read(fs.readFileSync(shot));
    const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
    const crop = p => { const o = new PNG({ width: w, height: h }); PNG.bitblt(p, o, 0, 0, w, h, 0, 0); return o; };
    const A = crop(a), B = crop(b), D = new PNG({ width: w, height: h });
    const n = pixelmatch(A.data, B.data, D.data, w, h, { threshold: 0.2, alpha: 0.15 });
    fs.writeFileSync(path.join(OUT, 'diff', s.code + '.png'), PNG.sync.write(D));
    r.diff = +(n / (w * h) * 100).toFixed(1);
  }
  // на листах линии между строками прямые: линия со скруглением — лишнее из старых стилей
  const bent = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => {
    const c = getComputedStyle(e), line = k => parseFloat(c['border' + k + 'Width']) > 0 && c['border' + k + 'Style'] !== 'none';
    if (line('Left') || line('Right') || !e.getBoundingClientRect().width) return false;
    return (line('Top') && parseFloat(c.borderTopLeftRadius) > 0) || (line('Bottom') && parseFloat(c.borderBottomLeftRadius) > 0);
  }).map(e => e.tagName.toLowerCase() + '.' + [...e.classList].join('.')));
  bent.forEach(sel => checks.push({ screen: s.code, sel, prop: 'линия со скруглением', want: 'нет', got: 'есть', ok: false }));
  results.push(r);
  console.log(s.code.padEnd(4), r.diff == null ? 'нет листа' : r.diff + '%');
};

// размеры из макетов
const measure = async m => {
  if (only.length && !only.includes(m.screen)) return;
  const s = SCREENS.find(x => x.code === m.screen);
  await loginAs(s.as || 'ceo');
  await page.setViewportSize({ width: 1440, height: s.height || 900 });
  await go(typeof s.route === 'function' ? s.route(ids) : s.route);
  if (s.act) { await s.act(page, ids); await page.waitForTimeout(400); }
  for (const c of m.checks) {
    // экран мог ещё грузиться (данные приходят после отрисовки шапки) — ждём элемент, кроме проверок «его нет»
    if (!c.absent) await page.waitForSelector(c.sel, { state: 'attached', timeout: 8000 }).catch(() => {});
    const got = await page.evaluate(({ sel, prop, noText }) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      if (noText) return e.innerText.includes(noText) ? 'есть' : 'нет';
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height }[prop] ?? getComputedStyle(e)[prop];
    }, c);
    const ok = c.absent ? got === null : got !== null && (typeof c.want === 'number' ? Math.abs(got - c.want) <= (c.tol ?? 1) : String(got) === String(c.want));
    checks.push({ screen: m.screen, ...c, got: typeof got === 'number' ? Math.round(got * 10) / 10 : got, ok });
  }
};

// сначала всё за CEO: данные для других ролей не должны попасть в его экраны
const roleOf = code => SCREENS.find(x => x.code === code).as || 'ceo';
for (const pass of [x => x === 'ceo', x => x !== 'ceo']) {
  for (const s of SCREENS) if (pass(s.as || 'ceo')) await snap(s);
  for (const m of METRICS) if (pass(roleOf(m.screen))) await measure(m);
}
await browser.close();
if (server) process.kill(-server.pid);

const bad = checks.filter(c => !c.ok);
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ results, checks, logs }, null, 1));
fs.writeFileSync(path.join(OUT, 'index.html'), fs.readFileSync(path.join(ROOT, 'test/design/report.html'), 'utf8')
  .replace('/*DATA*/', 'const DATA = ' + JSON.stringify({ results, checks, logs, notes: NOTES }).replace(/</g, '\\u003c') + ';'));
console.log(`\nЭкранов: ${results.length}. Размеров: ${checks.length - bad.length} из ${checks.length} совпало.`);
bad.forEach(c => console.log(`  ✗ ${c.screen} ${c.sel} ${c.prop}: макет ${c.want}, код ${c.got}`));
if (logs.length) console.log('Ошибки страницы:', logs.length, logs[0]);
console.log('Отчёт: design-report/index.html');
process.exit(bad.length ? 1 : 0);
