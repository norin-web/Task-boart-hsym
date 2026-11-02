/**
* Сценарии: `npm run scenarios` (начало — как в run.mjs: демо-данные, вход за роль).
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
const OUT = path.join(ROOT, 'scenario-report');
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
  const low = true; // в сценариях роли разные, «Аналитика» есть не у всех — прыгаем через настройки, они есть у всех
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


/* ================= Сценарии: живые цепочки работы по ролям ================= */
const SHOTS = path.join(OUT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const issues = [];
let step = 0;
const people = await page.evaluate(async () => { const { call } = await import('/src/api.js'); return (await call('bootstrap', { today: new Date().toISOString().slice(0, 10) })).people.map(p => ({ id: p.id, name: p.name, access: p.access })); });
const P = n => people.find(p => p.name === n) || (() => { throw new Error('нет человека ' + n); })();
const api = (m, x) => page.evaluate(async ([m, x]) => { const { call } = await import('/src/api.js'); return call(m, x); }, [m, x]);
const as = async name => {
  role = 'x:' + name;
  await page.evaluate(id => localStorage.setItem('tm.localActor', JSON.stringify(id)), P(name).id);
  await reloadSafe();
  await hideDev();
};
const say = t => console.log(`\n▶ ${t}`);
const must = (ok, text) => { if (!ok) issues.push({ where: 'проверка', what: text }); console.log((ok ? '  ✓ ' : '  ✗ ') + text); };

/** Снимок экрана и автопроверка вёрстки: что видно человеку на этом шаге. */
async function audit(name, { mobile = false } = {}) {
  if (mobile) {
    await page.setViewportSize({ width: 390, height: 844 });
    // как на телефоне: экран отрисован под узкую ширину, а не сжат после широкой (кроме открытых окон)
    if (!(await page.locator('#panel-root > *, #modal-root > *').count())) await go(await page.evaluate(() => location.hash));
  }
  await page.waitForTimeout(500);
  const file = `${String(++step).padStart(3, '0')}-${name.replace(/[^\p{L}\p{N}]+/gu, '-')}${mobile ? '-m' : ''}.png`;
  await page.screenshot({ path: path.join(SHOTS, file), fullPage: !mobile });
  const found = await page.evaluate(() => {
    const out = [];
    const vis = e => { const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; };
    const label = e => (e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '')) + ' «' + (e.innerText || '').trim().slice(0, 40) + '»';
    if (document.documentElement.scrollWidth > innerWidth + 1) out.push('страница шире экрана: ' + document.documentElement.scrollWidth + ' > ' + innerWidth);
    for (const e of document.querySelectorAll('body *')) {
      if (!vis(e) || e.closest('#sidebar.collapsed, svg')) continue;
      const c = getComputedStyle(e);
      const own = [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
      // текст обрезан без многоточия
      if (own.length > 2 && e.scrollWidth > e.clientWidth + 2 && ['hidden', 'clip'].includes(c.overflowX) && c.textOverflow !== 'ellipsis' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName)) out.push('текст обрезан: ' + label(e));
      // столбик по букве
      const lh = parseFloat(c.lineHeight) || 16;
      if (own.length >= 6 && e.getBoundingClientRect().width < 40 && e.getBoundingClientRect().height > lh * 4) out.push('текст столбиком: ' + label(e));
      // линия со скруглением
      const line = k => parseFloat(c['border' + k + 'Width']) > 0 && c['border' + k + 'Style'] !== 'none';
      if (!line('Left') && !line('Right') && ((line('Top') && parseFloat(c.borderTopLeftRadius) > 0) || (line('Bottom') && parseFloat(c.borderBottomLeftRadius) > 0))) out.push('линия со скруглением: ' + label(e));
      // пустая кнопка
      if (e.tagName === 'BUTTON' && !e.innerText.trim() && !e.querySelector('svg, img, .avatar, .av, .dot, .sw, .unit-dot') && !e.getAttribute('aria-label') && !e.title) out.push('пустая кнопка: ' + label(e));
    }
    const shownModals = [...document.querySelectorAll('#modal-root .modal-wrap')].filter(vis).length;
    if (shownModals > 1) out.push('окно поверх окна: ' + shownModals);
    return [...new Set(out)].slice(0, 25);
  });
  if (logs.length) { found.push(...logs.map(l => 'ошибка страницы: ' + l)); logs.length = 0; }
  for (const f of found) issues.push({ where: file, what: f });
  console.log(`  ${found.length ? '⚠' : '·'} ${file}${found.length ? ' — ' + found.length + ' замеч.' : ''}`);
  if (mobile) await page.setViewportSize({ width: 1440, height: 900 });
}
const open = async hash => { await go(hash); await page.waitForTimeout(700); };
const peek = async t => { await page.evaluate(async t => { const { peekTask } = await import('/src/views/task.js'); await peekTask(t.unitId, t.id); }, t); await page.waitForTimeout(900); };
const closePanels = () => page.evaluate(() => { document.querySelectorAll('#panel-root > *, #modal-root > *, .menu').forEach(e => e.remove()); });
/* ---- нажатия как у человека ---- */
const ui = async (what, fn) => { try { await fn(); return true; } catch (e) { must(false, `не удалось нажать: ${what} — ${String(e.message).split('\n')[0].slice(0, 120)}`); return false; } };
const statusUI = (colId, what) => ui(what, async () => { await page.selectOption('.panel-side .status-wrap select', colId, { timeout: 5000 }); await page.waitForTimeout(900); });
const approveUI = what => ui(what, async () => { await page.click('.review-bar button.rv-ok, .review-bar button:has-text("Аппрув")', { timeout: 5000 }); await page.waitForTimeout(1200); });
const commentUI = (text, what) => ui(what, async () => { await page.fill('.composer textarea', text, { timeout: 5000 }); await page.click('.composer button:has-text("Отправить")'); await page.waitForTimeout(800); });
const statusOf = async id => (await api('queryTasks', { ids: [id] }))[0];
const notes = async () => (await api('getNotifications', {})).map(n => n.kind + ':' + n.title);
const units = await page.evaluate(async () => { const { S } = await import('/src/state.js'); return Object.fromEntries(S.units.map(u => [u.name, u])); });
const MVP = units.MVP;
const col = kind => MVP.settings.columns.find(c => c.kind === kind).id;
const REVIEW = MVP.settings.review.column;
const today = () => page.evaluate(async () => (await import('/src/state.js')).todayStr());
const addDays = n => page.evaluate(async n => (await import('/src/state.js')).addDays(n), n);
await page.setViewportSize({ width: 1440, height: 900 });
// CEO работает в полном режиме — как владелец; в обзорном нет «Моих задач» и досок
await page.evaluate(async id => { const { send } = await import('/src/api.js'); await send('setMyPrefs', { personId: id, prefs: { ceoMode: 'admin' } }); }, P('Анна Смирнова').id);
/** Сценарий целиком: упал шаг — записываем и идём к следующему сценарию. */
const scenario = async (title, fn) => { if (process.env.ONLY && !process.env.ONLY.split(',').some(n => title.startsWith(n + '.'))) return; say(title); try { await fn(); } catch (e) { must(false, 'сценарий прерван: ' + String(e.message).split('\n')[0].slice(0, 160)); await closePanels().catch(() => {}); } };

/* ---------- 1. CEO поручает PM исследование ключей ---------- */
await scenario('1. CEO поручает PM исследование ключей для приложения', async () => {
await as('Анна Смирнова');
await open('#/my');
await page.evaluate(async () => { const { openCreateTask } = await import('/src/views/task.js'); openCreateTask(); });
await page.waitForTimeout(500);
await page.selectOption('.modal select >> nth=0', { label: 'MVP' });
await page.fill('.modal textarea.title-field', 'Исследование ключей · Streaks');
await page.fill('.modal textarea.inp:not(.title-field)', 'Собрать 50 ключей для US, конкуренты и объёмы.');
await page.locator('.modal .sel-av select').selectOption({ label: 'Екатерина Соколова' }).catch(e => must(false, 'выбор исполнителя в окне: ' + e.message.slice(0, 80)));
await audit('CEO · новая задача заполнена');
await page.click('.modal-foot .btn.primary'); await page.waitForTimeout(1200);
const keys = (await api('queryTasks', { q: 'Исследование ключей', limit: 5 }))[0];
must(!!keys, 'задача создана из окна');
must(keys && keys.reviewerId === P('Анна Смирнова').id, 'ревьюер по умолчанию — CEO, кто поставил');
await audit('CEO · Мои задачи после создания');
await as('Екатерина Соколова');
must((await notes()).some(n => /^assigned:Исследование ключей/.test(n)), 'PM получил уведомление о новой задаче');
await open('#/'); await audit('PM · дашборд с новой задачей');
await open('#/my'); await audit('PM · Мои задачи');
await peek(keys); await audit('PM · карточка задачи');
await statusUI(col('progress'), 'PM: статус «В работе» в карточке');
await commentUI('Взяла, к пятнице будет таблица.', 'PM: комментарий');
must((await api('getTaskExtras', { taskId: keys.id })).comments.some(c => /к пятнице/.test(c.text)), 'комментарий сохранился');
await statusUI(REVIEW, 'PM: статус «В ревью» в карточке');
await audit('PM · карточка после отправки на ревью');
await closePanels();
must((await statusOf(keys.id) || {}).statusKind !== 'todo', 'статус сменился из карточки');
await as('Анна Смирнова');
must((await notes()).some(n => /^review:Исследование ключей/.test(n)), 'CEO получил «на ревью»');
await open('#/'); await audit('CEO · дашборд, задача на ревью');
await peek(keys); await audit('CEO · карточка на ревью');
await approveUI('CEO: «Аппрув» в карточке');
await closePanels();
await as('Екатерина Соколова');
must((await notes()).some(n => /^approved:Исследование ключей/.test(n)), 'PM получил «принято»');
await as('Анна Смирнова');
await open('#/my');
await page.locator('.my-whose button').nth(1).click(); await page.waitForTimeout(800);
await page.locator('.my-toggle').click(); await page.waitForTimeout(500);
must(await page.locator('.trow', { hasText: 'Исследование ключей' }).count() > 0, 'закрытая задача видна в «Поставил я» с «Показывать готовые»');
await audit('CEO · Поставил я, готовые');
await audit('CEO · Поставил я', { mobile: true });

});

/* ---------- 2. Новое приложение: от бэклога до App Store ---------- */
await scenario('2. CEO заводит новое приложение, PM раскладывает, команда делает, RM выпускает', async () => {
const { app, request } = await api('createApp', { name: 'Pulse Timer', unitId: MVP.id });
must(request.assigneeId === P('Екатерина Соколова').id, 'запрос упал PM юнита');
await as('Екатерина Соколова');
await open('#/'); await audit('PM · входящие от CEO');
await page.locator('.ib-row', { hasText: 'Pulse Timer' }).locator('button:has-text("Разложить")').click();
await page.waitForTimeout(800);
await audit('PM · окно Разложить');
await page.click('.modal-foot .btn.primary'); await page.waitForTimeout(1500);
const stages = (await api('getBoard', { unitId: MVP.id })).tasks.filter(t => t.parentId === request.id || (t.parent && t.parent.id === request.id));
const by = Object.fromEntries(stages.map(t => [t.step, t]));
must(['design', 'ios', 'qa', 'release'].every(s => by[s]), 'этапы созданы: ' + Object.keys(by).join(', '));
await open(`#/u/${MVP.id}`); await audit('PM · доска юнита после раскладки');
await open(`#/u/${MVP.id}/overview`); await audit('PM · обзор юнита');

const DEV = await page.evaluate(async () => { const { DEV_QUESTIONS } = await import('/src/devform.js'); return Object.fromEntries(DEV_QUESTIONS.filter(q => !q.optional).map(q => [q.id, q.kind === 'yn' ? { v: 'Нет' } : { v: 'Ответ' }])); });
/** Исполнитель закрывает этап: чеклист, опросник для iOS, на ревью; ревьюер принимает. */
async function finish(stage, who) {
  // этап закрывает тот, на кого он назначен сейчас (раскладка могла отдать его лиду позиции)
  if (!who) {
    await as('Екатерина Соколова'); // PM видит всю цепочку
    let cur = (await api('queryTasks', { ids: [stage.id] }))[0];
    if (!cur.assigneeId) {
      const pos = people.find(p => p.access === 'member' && p.id !== P('Юлия Павлова').id) || people[0];
      await api('updateTask', { id: cur.id, patch: { assigneeId: pos.id } });
      must(false, `этап «${cur.title.split(' · ')[0]}» после раскладки остался без исполнителя`);
      cur = (await api('queryTasks', { ids: [stage.id] }))[0];
    }
    who = people.find(p => p.id === cur.assigneeId).name;
  }
  await as(who);
  const t = (await api('queryTasks', { ids: [stage.id] }))[0];
  if (!t) { must(false, `${who} не видит этап «${stage.title}»`); return; }
  // розданный этап закрывается сам, когда приняты все подзадачи
  if (t.statusKind === 'done') { must(true, `«${t.title.split(' · ')[0]}» закрылся сам после подзадач`); return; }
  if ((t.checklist || []).length) await api('updateTask', { id: t.id, patch: { checklist: t.checklist.map(i => ({ ...i, done: true })) } });
  if (t.step === 'ios') await api('saveDevForm', { taskId: t.id, answers: DEV });
  if (t.statusKind === 'todo') await api('updateTask', { id: t.id, patch: { status: col('progress') } });
  await open('#/'); await audit(`${who} · дашборд с этапом «${t.title.split(' · ')[0]}»`);
  const hero = page.locator('.fc-hero', { hasText: t.title.split(' · ')[0] });
  if (await hero.count()) await ui(`${who}: «Отдать на ревью» на дашборде`, async () => { await hero.locator('button:has-text("Отдать на ревью")').click({ timeout: 5000 }); await page.waitForTimeout(1200); });
  else { await peek(t); await statusUI(REVIEW, `${who}: статус «В ревью» в карточке`); await closePanels(); }
  if ((await statusOf(t.id) || {}).status !== REVIEW && !(await statusOf(t.id) || {}).reviewFrom) { must(false, `${who}: «${t.title.split(' · ')[0]}» не ушла на ревью через интерфейс`); await api('updateTask', { id: t.id, patch: { status: REVIEW } }); }
  const after = (await api('queryTasks', { ids: [t.id] }))[0];
  const reviewer = people.find(p => p.id === after.assigneeId);
  must(!!reviewer && reviewer.name !== who, `«${t.title.split(' · ')[0]}» ушёл на ревью к ${reviewer ? reviewer.name : '—'}`);
  if (!reviewer || reviewer.name === who) return;
  await as(reviewer.name);
  must((await notes()).some(n => n.startsWith('review:')), `${reviewer.name} получил уведомление о ревью`);
  await open('#/'); await audit(`${reviewer.name} · ревью «${t.title.split(' · ')[0]}»`);
  await peek(t); await approveUI(`${reviewer.name}: «Аппрув» в карточке`); await closePanels();
  if ((await statusOf(t.id) || {}).statusKind !== 'done' && (await statusOf(t.id))) { const x = await statusOf(t.id); if (x.status === REVIEW) { must(false, `${reviewer.name}: «Аппрув» не закрыл «${t.title.split(' · ')[0]}»`); await api('reviewDecision', { taskId: t.id, approve: true }); } }
}

// дизайн: лид раздаёт часть дизайнеру
await as('Мария Иванова');
await peek(by.design); await audit('Lead дизайна · этап Дизайн');
await closePanels();
await peek(by.design);
await ui('Lead: «Раздать» в карточке', async () => {
  await page.waitForSelector('.quick-chip.primary', { state: 'attached', timeout: 5000 });
  await page.evaluate(() => document.querySelector('.quick-chip.primary').click()); await page.waitForTimeout(500);
  await page.fill('.sp-dlg .split-row input.inp', 'Онбординг');
  await page.selectOption('.sp-dlg .split-row select.inp >> nth=0', P('Юлия Павлова').id);
  await audit('Lead · окно Раздать заполнено');
  await page.locator('.sp-dlg .btn.primary', { hasText: 'Раздать' }).last().click({ timeout: 5000 }); await page.waitForTimeout(1500);
});
await closePanels();
let parts = (await api('queryTasks', { q: 'Онбординг', limit: 5 })).filter(x => x.parentId === by.design.id);
if (!parts.length) { must(false, 'подзадача не создана через окно «Раздать»'); parts = await api('splitTask', { taskId: by.design.id, items: [{ title: 'Онбординг', assigneeId: P('Юлия Павлова').id, dueDate: await addDays(2) }] }); }
await open('#/'); await audit('Lead · дашборд после «Раздать»');
for (const part of parts) await finish(part, 'Юлия Павлова');
await finish(by.design, 'Мария Иванова');

// разработка → QA возвращает → снова разработка → QA принимает
await finish(by.ios);
await as('Екатерина Соколова');
const qaNow = (await api('queryTasks', { ids: [by.qa.id] }))[0];
const qaName = people.find(p => p.id === qaNow.assigneeId).name;
await as(qaName);
await open('#/'); await audit(`QA ${qaName} · дашборд`);
await api('qaReturn', { taskId: by.qa.id, text: 'Краш на экране таймера' });
await as('Екатерина Соколова');
const iosNow = (await api('queryTasks', { ids: [by.ios.id] }))[0];
const iosName = people.find(p => p.id === iosNow.assigneeId).name;
await as(iosName);
must((await notes()).some(n => n.startsWith('returned:')), `${iosName} получил «вернули» от QA`);
await peek(by.ios); await audit('iOS · карточка после возврата QA');
await closePanels();
await finish(by.ios);
await finish(by.qa);
for (const s of ['meta', 'retext', 'l10n']) if (by[s]) await finish(by[s]);

// релиз
await as('Екатерина Соколова');
await api('sendToRelease', { taskId: by.release.id });
await as('Сергей Волков');
must((await notes()).some(n => n.startsWith('assigned:')), 'RM получил релиз');
await open('#/'); await audit('RM · дашборд, релиз в очереди');
await audit('RM · дашборд', { mobile: true });
const relData = await api('getRelease', { taskId: by.release.id });
const values = Object.fromEntries(relData.fields.map(f => [f.id, f.kind === 'link' ? 'https://example.com/pulse' : '1.0']));
await api('saveReleaseValues', { taskId: by.release.id, values });
const relTask = (await api('queryTasks', { ids: [by.release.id] }))[0];
if ((relTask.checklist || []).length) await api('updateTask', { id: relTask.id, patch: { checklist: relTask.checklist.map(i => ({ ...i, done: true })) } });
await peek(relTask); await audit('RM · карточка релиза готова к отправке');
await ui('RM: «Отправить в Apple» в карточке', async () => { await page.click('.rl-actions button:has-text("Отправить в Apple")', { timeout: 5000 }); await page.waitForTimeout(1500); });
await closePanels();
const phase = async () => ((await api('getRelease', { taskId: by.release.id })).task.release || {}).phase || '';
if (await phase() === '') { must(false, 'кнопка «Отправить в Apple» не отправила релиз'); await api('releaseStep', { taskId: by.release.id, action: 'submit' }); }
must(await phase() === 'submitted', 'после «Отправить в Apple» релиз на ревью Apple');
await open('#/'); await audit('RM · на ревью Apple');
await peek(relTask);
await page.evaluate(async t => { const { openRejectForm } = await import('/src/views/release.js'); openRejectForm(t, 'Pulse Timer', 1); }, relTask);
await page.waitForTimeout(500);
await audit('RM · окно реджекта поверх карточки');
await page.fill('.modal textarea', 'Guideline 2.1 — краш при запуске');
await page.click('.modal-foot .btn.danger'); await page.waitForTimeout(1200);
must(await phase() === 'rejected', 'после реджекта фаза «реджект»');
await closePanels();
await as('Екатерина Соколова');
must((await notes()).some(n => /реджект|store_reject|assigned/.test(n)), 'PM получил задачу по реджекту');
await open('#/'); await audit('PM · дашборд с реджектом');
const fix = (await api('queryTasks', { q: 'Реджект', limit: 10 })).find(t => t.unit.id === MVP.id && t.statusKind !== 'done');
must(!!fix, 'у PM есть задача «Реджект №1»');
if (fix) { await api('updateTask', { id: fix.id, patch: { status: REVIEW } }).catch(() => null); const f2 = (await api('queryTasks', { ids: [fix.id] }))[0]; if (f2.statusKind !== 'done') await api('updateTask', { id: fix.id, patch: { status: col('done') } }).catch(e => must(false, 'закрыть реджект: ' + e.message.slice(0, 80))); }
await as('Сергей Волков');
must(await phase() === '', 'PM закрыл задачу по реджекту — релиз вернулся в очередь RM');
await open('#/'); await audit('RM · реджект исправлен, в очереди');
await ui('RM: «Отправил в Apple» на дашборде после исправления', async () => { await page.locator('.rm-row', { hasText: 'Pulse Timer' }).locator('button:has-text("Отправил в Apple")').click({ timeout: 5000 }); await page.waitForTimeout(1500); });
if (await phase() !== 'submitted') await api('releaseStep', { taskId: by.release.id, action: 'resubmit' }).catch(e => must(false, 'отправить снова: ' + e.message.slice(0, 80)));
must(await phase() === 'submitted', 'после «Отправить снова» релиз снова на ревью Apple');
await open('#/');
await peek(relTask);
await ui('RM: «Вышло в стор» в карточке релиза', async () => { await page.click('.rl-live-btn', { timeout: 5000 }); await page.waitForTimeout(1500); });
await closePanels();
if (await phase() !== 'live') await api('releaseStep', { taskId: by.release.id, action: 'live' }).catch(e => must(false, 'вышло в стор: ' + e.message.slice(0, 80)));
must(await phase() === 'live', 'после «Вышло в стор» релиз в App Store');
await open('#/'); await audit('RM · вышло в App Store');
await page.evaluate(async () => { const { openReleaseHistory } = await import('/src/views/release.js'); openReleaseHistory(); }); await page.waitForTimeout(800);
await audit('RM · история релизов');
await closePanels();
await as('Анна Смирнова');
must((await notes()).some(n => n.startsWith('store_live:')), 'CEO узнал о выходе в App Store');
await open('#/apps'); await audit('CEO · приложения');
await open('#/analytics'); await audit('CEO · аналитика');

});

/* ---------- 3. Видимость по ролям ---------- */
await scenario('3. Кто что видит', async () => {
await as('Алексей Морозов');
must((await api('listApps', {})).length === 0, 'сотрудник не получает приложения');
await open('#/'); await audit('Сотрудник · дашборд');
await open(`#/u/${MVP.id}`); await audit('Сотрудник · доска юнита');
await audit('Сотрудник · доска юнита', { mobile: true });
must(!(await page.evaluate(() => [...document.querySelectorAll('.nav-sub')].some(e => /UX\/UI/.test(e.textContent)))), 'сотрудник не видит чужие команды в сайдбаре');
// кто не создаёт задачи (Lead, RM, сотрудник) — ни одной кнопки создания ни на одном экране
for (const who of ['Алексей Морозов', 'Дмитрий Козлов', 'Сергей Волков']) {
  await as(who);
  const routes = ['#/', '#/board', '#/my', ...(await api('bootstrap', { today: '2026-10-30' })).units.flatMap(u => [`#/u/${u.id}`, `#/u/${u.id}/list`, `#/u/${u.id}/board`])];
  const seen = [];
  for (const r of routes) {
    await open(r);
    seen.push(...(await page.evaluate(() => [...document.querySelectorAll('#main button, #main a')].filter(b => b.offsetParent)
      .map(b => (b.innerText.trim() || b.title || '').replace(/\s+/g, ' ')).filter(t => /Созда|^Задача$|Новая задача|Новое прил|Новый юнит|Добавить задачу|Добавить списком/.test(t)))).map(t => `${r}: ${t}`));
  }
  must(!seen.length, `${who.split(' ')[0]}: нет кнопок создания` + (seen.length ? ' — ' + seen.slice(0, 3).join('; ') : ''));
}
await as('Дмитрий Козлов');
must((await api('listApps', {})).length === 0, 'Lead не получает приложения');
await open('#/'); await audit('Lead iOS · дашборд');
await as('Павел Орлов');
await open('#/board'); await audit('ASO · моя доска');

});

/* ---------- 4. Руками: доска, поиск, колокольчик, окна создания ---------- */
await scenario('4. Доска, поиск, колокольчик, окна', async () => {
await as('Екатерина Соколова');
const from = col('todo'), to = col('progress');
await api('createTask', { unitId: MVP.id, title: 'Проверка перетаскивания', assigneeId: P('Екатерина Соколова').id, status: from });
await open(`#/u/${MVP.id}`);
const card = page.locator(`.col-list[data-status="${from}"] .card:not(.locked):not(.temp)`, { hasText: 'Проверка перетаскивания' }).first();
const target = page.locator(`.col-list[data-status="${to}"]`).first();
if (await card.count() && await target.count()) {
  await card.scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
  const title = (await card.locator('.card-title').textContent()).trim();
  const a = await card.boundingBox(), b = await target.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(a.x + a.width / 2 + (b.x + b.width / 2 - a.x - a.width / 2) * i / 12, a.y + 20 + (b.y + 40 - a.y - 20) * i / 12); await page.waitForTimeout(30); }
  await page.mouse.up(); await page.waitForTimeout(1500);
  const moved = (await api('queryTasks', { q: title.slice(0, 40), limit: 5 })).find(x => x.title === title);
  must(moved && moved.status === to, `перетаскивание на доске меняет статус («${title.slice(0, 30)}»)`);
  await audit('PM · доска после перетаскивания');
} else must(false, 'на доске MVP нет карточки в «К работе» или колонки «В работе»');

await page.keyboard.press('Meta+k'); await page.waitForTimeout(300);
must(await page.locator('.palette-inp').count() > 0, '⌘K открывает поиск');
await page.fill('.palette-inp', 'Streaks'); await page.waitForTimeout(900);
await audit('PM · поиск ⌘K');
must(await page.locator('.pal-item').count() > 0, 'поиск находит «Streaks»');
await page.keyboard.press('Enter'); await page.waitForTimeout(1200);
must(await page.locator('#panel-root > *, #modal-root > *').count() > 0, 'Enter в поиске открывает найденное');
await closePanels();

await open('#/');
await ui('PM: колокольчик', async () => { await page.click('.icon-btn.bell', { timeout: 5000 }); await page.waitForTimeout(800); });
must(await page.locator('.bell-menu').count() > 0, 'колокольчик открывает «Новое для вас»');
await audit('PM · колокольчик');
const row = page.locator('.bell-menu .news-row').first();
if (await row.count()) { await row.click(); await page.waitForTimeout(1200); must(await page.locator('.bell-menu').count() === 0, 'клик по уведомлению закрывает колокольчик'); await audit('PM · открыто из колокольчика'); }
await closePanels();

await as('Алексей Морозов');
await page.keyboard.press('Meta+k'); await page.waitForTimeout(300);
await page.fill('.palette-inp', 'CARROT'); await page.waitForTimeout(900);
must(!(await page.locator('.pal-group', { hasText: 'Приложения' }).count()), 'сотрудник не находит приложения в поиске');
await audit('Сотрудник · поиск без приложений');
await page.keyboard.press('Escape'); await closePanels();

await as('Анна Смирнова');
await open('#/');
await page.evaluate(async () => { const { openCreateApp } = await import('/src/views/apps.js'); openCreateApp(); }); await page.waitForTimeout(600);
await audit('CEO · окно Новое приложение');
await ui('CEO: создать приложение окном', async () => {
  await page.fill('#modal-root .modal-wrap:last-child input.inp >> nth=0', 'Night Owl');
  await page.locator('#modal-root .btn.primary', { hasText: 'Создать' }).last().click({ timeout: 5000 }); await page.waitForTimeout(1500);
});
must((await api('listApps', {})).some(x => x.name === 'Night Owl'), 'приложение создано через окно');
await closePanels();
await page.evaluate(async () => { const { openCreateUnit } = await import('/src/views/units.js'); openCreateUnit(); }); await page.waitForTimeout(600);
await audit('CEO · окно Новый юнит');
await ui('CEO: создать юнит окном', async () => {
  await page.fill('#modal-root input[placeholder="Например, Gold"]', 'Lab');
  await page.locator('#modal-root .btn.primary').last().click({ timeout: 5000 }); await page.waitForTimeout(1500);
});
const lab = (await api('bootstrap', { today: '2026-10-30' })).units.find(u => u.name === 'Lab');
must(!!lab, 'юнит создан через окно');
await closePanels();
if (lab) {
  await page.evaluate(async u => { const { openTeamDialog } = await import('/src/views/people.js'); openTeamDialog(u); }, lab); await page.waitForTimeout(600);
  await audit('CEO · окно Новая команда');
  await closePanels();
}
await page.evaluate(async () => { const { addPersonDialog } = await import('/src/views/people.js'); addPersonDialog(); }); await page.waitForTimeout(600);
await audit('CEO · окно Добавить человека');
await ui('CEO: добавить человека окном', async () => {
  await page.fill('#modal-root input[placeholder="Имя и фамилия"]', 'Тест Тестов');
  await page.locator('#modal-root .btn.primary', { hasText: 'Добавить' }).last().click({ timeout: 5000 }); await page.waitForTimeout(1500);
});
must((await api('bootstrap', { today: '2026-10-30' })).people.some(p => p.name === 'Тест Тестов'), 'человек добавлен через окно');
await closePanels();
});

/* ---------- 5. Телефон: главные экраны всех ролей ---------- */
await scenario('5. Телефон', async () => {
for (const [who, screens] of [
  ['Анна Смирнова', ['#/', '#/apps', '#/analytics', '#/settings']],
  ['Екатерина Соколова', ['#/', '#/my', `#/u/${MVP.id}`]],
  ['Сергей Волков', ['#/', '#/my', '#/settings']],
  ['Мария Иванова', ['#/', '#/board']],
  ['Алексей Морозов', ['#/', '#/board', '#/my']],
]) {
  await as(who);
  for (const hsh of screens) { await open(hsh); await audit(`${who.split(' ')[0]} · ${hsh}`, { mobile: true }); }
}
});

/* ---------- 6. Свои графики: аналитика → Настройки → Графики → обратно ---------- */
await scenario('6. Свои графики', async () => {
await as('Анна Смирнова');
await open('#/analytics');
must(await page.locator('.an-chart').count() >= 2, 'на аналитике графики по умолчанию');
await audit('CEO · аналитика с графиками');
await ui('CEO: кнопка настройки у графика', async () => { await page.locator('.an-gear').first().click({ timeout: 5000 }); await page.waitForSelector('.ch-editor', { timeout: 5000 }); });
must(/tab=charts/.test(await page.evaluate(() => location.hash)), 'кнопка у графика ведёт в Настройки → Графики');
await audit('CEO · Настройки → Графики');
await ui('CEO: новый график из готового', async () => {
  await page.click('.ch-add'); await page.waitForSelector('.ch-presets');
  await audit('CEO · новый график');
  await page.locator('.ch-preset', { hasText: 'Реджекты за месяц' }).click(); await page.waitForTimeout(800);
  await page.locator('.ch-actions .btn.primary', { hasText: 'Добавить' }).click(); await page.waitForTimeout(800);
});
must(await page.locator('.ch-row b', { hasText: 'Реджекты за месяц' }).count() === 1, 'новый график в списке');
await ui('CEO: смена вида на столбцы', async () => { await page.locator('.ch-view', { hasText: 'Столбцы' }).click(); await page.waitForTimeout(1200); });
must((await page.locator('.ch-row.on small').textContent()).includes('столбцы'), 'вид сохранился в списке');
await audit('CEO · график отредактирован');
await audit('CEO · Настройки → Графики', { mobile: true });
await page.waitForTimeout(800);
await reloadSafe();
await open('#/analytics');
must(await page.locator('.an-chart h2', { hasText: 'Реджекты за месяц' }).count() === 1, 'график на аналитике после перезагрузки');
await audit('CEO · аналитика со своим графиком');
await as('Екатерина Соколова');
await open('#/settings?tab=charts');
must(await page.locator('.ch-editor').count() === 1, 'у PM есть «Графики»');
must(!(await page.locator('.ch-row b', { hasText: 'Реджекты за месяц' }).count()), 'графики CEO не видны PM');
for (const who of ['Алексей Морозов', 'Мария Иванова']) {
  await as(who);
  await open('#/settings?tab=charts');
  must(!(await page.locator('.prefs-tab', { hasText: 'Графики' }).count()) && !(await page.locator('.ch-editor').count()), `${who.split(' ')[0]}: «Графиков» нет`);
}
});

/* ---------- итог ---------- */
const byWhat = {};
for (const i of issues) (byWhat[i.what] = byWhat[i.what] || []).push(i.where);
const report = Object.entries(byWhat).map(([what, where]) => ({ what, where: [...new Set(where)] }));
fs.writeFileSync(path.join(OUT, 'issues.json'), JSON.stringify(report, null, 1));
console.log(`\nЭкранов: ${step}. Замечаний: ${report.length}.`);
for (const r of report) console.log(`  • ${r.what}\n      ${r.where.slice(0, 4).join(', ')}${r.where.length > 4 ? ` и ещё ${r.where.length - 4}` : ''}`);
console.log(`Снимки: ${SHOTS}`);
await browser.close(); if (server) process.kill(-server.pid);
process.exit(report.length ? 1 : 0);
