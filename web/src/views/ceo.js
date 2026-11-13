/**
 * Дашборд CEO (главная CEO в обоих режимах): портфель приложений по статусам и юнитам, что требует внимания,
 * работы в ходу (запросы и текущий этап), что недавно вышло. Клик — карточка приложения или задача поверх.
 */
import { S, LS, isSuper, personById, unitById, REQUEST_TYPES, greeting, me, plural, fmtDate, relTime, todayStr, appStatusById } from '../state.js';
import { $, h, icon, avatar, topbar, showErr, fill, menu, modal, field, emptyBlock, skeleton } from '../ui.js';
import { call, send } from '../api.js';
import { currentView, link } from '../router.js';
import { peekTask } from './task.js';
import { openAppById, openCreateApp, openImportApps, storeCheckBlock, appStatusCell, openNewAppTask, appIcon, prioTag, stageDots, statusPill, appPm } from './apps.js';
import { newsBlock, loadNotes, fillDemo, unitCard } from './home.js';
import { renderLayout, editLayout } from './layout.js';
import { sparkline, openSeries } from './charts.js';
import { openCreateUnit } from './units.js';
import { watchBlock } from './watch.js';
import { mode } from '../data.js';
import { onRemote } from '../live.js';

const units = () => S.units.filter(u => !u.archived).sort((a, b) => (a.order || 0) - (b.order || 0));
const prioRank = id => S.priorityOptions.findIndex(o => o.id === id);
const daysSince = iso => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 864e5));
const daysLate = due => Math.max(1, Math.round((Date.parse(todayStr()) - Date.parse(due)) / 864e5));

let editHook = null;
export async function renderCeoHome() {
  const page = h('div', { class: 'page ceo-page' }, skeleton());
  fill($('#main'),
    topbar([h('h1', { class: 'screen-title' }, greeting() + (me() ? ', ' + me().name.split(' ')[0] : ''))], [
      units().length > 0 && h('button', { class: 'btn', title: 'Блоки, статистика и свои подборки', onclick: () => editHook && editHook() }, 'Настроить'),
      isSuper() && S.apps.some(a => !a.archived) && h('button', { class: 'btn', onclick: () => openNewAppTask(load) }, h('span', { class: 'btn-label' }, 'Новая задача')),
      isSuper() && units().length > 0 && h('button', { class: 'btn primary', onclick: () => openCreateApp(load) }, h('span', { class: 'btn-label' }, 'Новое приложение'))]),
    h('div', { class: 'view-body' }, page));
  // мгновенный показ (Supabase): дашборд прошлого раза — сразу, свежий — когда придёт
  const dashKey = 'ceoDash:' + S.meId;
  let firstLoad = true;
  async function load() {
    const cached = mode === 'supabase' && firstLoad ? LS.get(dashKey, null) : null;
    firstLoad = false;
    if (cached) show(cached);
    let d;
    try { [d] = await Promise.all([call('getCeoDashboard', { today: todayStr() }), loadNotes()]); } catch (e) { if (!cached) showErr(e); return; }
    if (currentView() !== 'home') return;
    if (mode === 'supabase') LS.set(dashKey, d);
    show(d);
  }
  function show(d) {
    const apps = d.apps || [];
    S.apps = apps.map(({ requests, active, ...a }) => a);
    const total = apps.length;
    // без юнитов показывать нечего; юниты есть, а приложений нет — дашборд целиком, сверху подсказка
    if (!units().length) {
      // первый вход (макет 44): «Новое для вас» пустой строкой, карточка пустого состояния и три шага
      const step = (n, title, sub, on) => h('div', { class: 'fr-step' },
        h('span', { class: 'fr-step-n' + (on ? ' on' : '') }, n), h('div', null, h('b', null, title), h('span', null, sub)));
      return fill(page,
        h('div', { class: 'fr-news' }, h('span', { class: 'fr-news-ic' }, icon('bell', 18)),
          h('div', null, h('b', null, 'Новое для вас'), h('span', null, 'Появится, когда что-то придёт вам'))),
        h('div', { class: 'first-run' },
          h('span', { class: 'fr-ic' }, icon('app', 28)),
          h('h2', null, 'Приложений пока нет'),
          h('p', null, isSuper() ? 'Сначала создайте юнит: в нём будут доска, люди и приложения.' + (mode === 'local' ? ' Или заполните всё демо-данными и посмотрите, как это работает.' : '') : 'Когда CEO создаст юниты и приложения, они появятся здесь.'),
          isSuper() && h('div', { class: 'fr-actions' },
            h('button', { class: 'btn primary xl', onclick: openCreateUnit }, icon('plus', 16), 'Создать юнит'),
            mode === 'local' && h('button', { class: 'btn soft xl', onclick: e => fillDemo(e.currentTarget) }, icon('layers', 16), 'Заполнить демо-данными')),
          isSuper() && mode === 'local' && h('small', { class: 'fr-note' }, 'Демо-данные есть только в локальном режиме, без входа в аккаунт'),
          isSuper() && h('div', { class: 'fr-steps' },
            step(1, 'Юнит', 'Название, ключ задач, цвет и колонки доски', true),
            step(2, 'Люди', 'PM, команды и позиции — в «Настройках»'),
            step(3, 'Приложения', 'По одному или списком из App Store'))));
    }
    const blocks = () => ceoBlocks(d, apps, load);
    const edit = () => editLayout('ceoHome', blocks(), page, draw, {
      title: 'Настройка дашборда',
      extra: h('button', { class: 'btn', onclick: () => openBlockEditor(null, edit) }, icon('plus', 14), 'Свой блок'),
      onEdit: id => openBlockEditor(customBlocks().find(b => 'c:' + b.id === id), edit),
      onDelete: id => { setCustomBlocks(customBlocks().filter(b => 'c:' + b.id !== id)); edit(); },
    });
    editHook = edit;
    const draw = () => fill(page,
      !total && h('div', { class: 'card-box empty-state sm' },
        h('p', { style: { margin: 0 } }, 'Приложений пока нет — добавьте новое или уже существующие списком.'),
        isSuper() && h('div', { class: 'row', style: { justifyContent: 'center', gap: '8px' } },
          h('button', { class: 'btn primary sm', onclick: () => openCreateApp(load) }, icon('plus', 14), 'Новое приложение'),
          h('button', { class: 'btn sm', onclick: () => openImportApps(load) }, icon('layers', 14), 'Добавить списком'))),
      renderLayout('ceoHome', blocks()));
    draw();
  }
  load();
  onRemote(() => load(), () => currentView() === 'home'); // живые обновления
}

/* ---------- юниты ---------- */

/** Юниты карточками (команда, задачи, прогресс); «Новый юнит» — кнопкой в заголовке, сетка без карточки-одиночки. */
function portfolio(d, reload) {
  const count = u => S.apps.filter(a => a.unitId === u.id && !a.archived).length;
  return h('section', { class: 'ceo-portfolio' },
    h('div', { class: 'section-head' }, h('h2', null, 'Юниты'),
      isSuper() && h('button', { class: 'btn ghost sm', onclick: () => openCreateUnit(reload) }, 'Новый юнит')),
    h('div', { class: 'unit-grid' }, units().map(u => unitCard(u, { apps: count(u), to: 'overview' }))));
}

/* ---------- требует внимания ---------- */

// Короткая пометка справа; красным — только то, что уже горит
const ATT = {
  reject: { cls: 'danger', text: () => 'реджект' },
  overdue: { cls: 'danger', text: x => `просрочено ${daysLate(x.task.dueDate)} дн.` },
  nopm: { cls: 'muted', text: () => 'нет PM' },
  waiting: { cls: 'muted', text: () => 'не разложено' },
  stale: { cls: 'muted', text: x => `стоит ${daysSince(x.task.updatedAt)} дн.` },
};

/** two — вариант обзора юнита (макет 14б): две строки, справа «Открыть» у реджекта, у остальных — статус приложения. */
export function attention(d, reload, { two = false } = {}) {
  const rows = d.attention;
  const what = x => (x.task && x.task.id !== x.request.id ? x.task.title.split(' · ')[0] : x.request ? x.request.title : '');
  const who = x => personById(x.task ? x.task.assigneeId : x.request ? x.request.assigneeId : '');
  // этапы лежат в юните запроса; реджект — карточка приложения
  const open = x => (x.request ? peekTask(x.request.unitId, x.task ? x.task.id : x.request.id) : openAppById(x.app.id, reload));
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Требует внимания')),
    rows.length
      ? h('div', { class: 'card-box att-list' }, paged(rows, x => {
        const a = ATT[x.type];
        const p = who(x);
        if (two) {
          const st = appStatusById(x.app.status);
          return h('button', { class: 'att-row att-two' + (x.type === 'reject' ? ' hot' : ''), onclick: () => open(x), title: p ? p.name : '' },
            h('span', { class: 'att-main' }, h('b', null, x.app.name),
              h('small', { class: a.cls === 'danger' ? 'danger-text' : 'muted' }, [what(x), a.text(x)].filter(Boolean).join(' · '))),
            x.type === 'reject' ? h('span', { class: 'att-open' }, 'Открыть') : h('span', { class: 'att-chip' }, st ? st.name : ''));
        }
        // как в макете 12: «Приложение · что случилось», справа — статус приложения пилюлей
        return h('button', { class: 'att-row', onclick: () => open(x), title: p ? p.name : '' },
          h('span', { class: 'att-main' }, h('b', null, x.app.name), ' · ', h('span', { class: a.cls === 'danger' ? 'danger-text' : '' }, [what(x), a.text(x)].filter(Boolean).join(', '))),
          appStatusCell(appStatusById(x.app.status), x.app));
      }, 12))
      : emptyBlock('Всё по плану', { ok: true }));
}

/* ---------- работы в ходу ---------- */

/** Длинный список блока — по step строк, «Показать ещё» дорисовывает следующие на месте (без перерисовки дашборда). */
function paged(items, renderRow, step = 15, cls = 'blk-more') {
  const box = h('div', { style: { display: 'contents' } });
  let n = step;
  const draw = () => {
    const rest = items.length - n;
    fill(box, items.slice(0, n).map(renderRow),
      rest > 0 && h('button', { class: cls, type: 'button', onclick: e => { e.stopPropagation(); n += step; draw(); } },
        `Показать ещё ${Math.min(step, rest)}`, rest > step && h('span', { class: 'muted' }, ` · осталось ${rest}`)));
  };
  draw();
  return box;
}

/** Первые limit строк, остальное — «Показать все · N» раскрывает список на месте, «Свернуть» — обратно. */
function folded(items, renderRow, limit = 5) {
  const box = h('div', { style: { display: 'contents' } });
  let open = false;
  const draw = () => fill(box, (open ? items : items.slice(0, limit)).map(renderRow),
    items.length > limit && h('button', { class: 'rc-more link-btn', type: 'button', 'aria-expanded': String(open), onclick: e => { e.stopPropagation(); open = !open; draw(); } },
      open ? 'Свернуть' : `Показать все · ${items.length}`));
  draw();
  return box;
}

export function inProgress(d, reload, { brief = false } = {}) {
  // ближе к финишу — выше: больше готовых этапов сверху; при равном прогрессе — приоритет, потом срок
  const rows = [...d.inProgress].sort((a, b) => (b.request.progress || 0) - (a.request.progress || 0)
    || prioRank(b.request.priority) - prioRank(a.request.priority)
    || (a.request.dueDate || '9999').localeCompare(b.request.dueDate || '9999'));
  const today = todayStr();
  // обзор юнита (C02): короткий список — приложение, работа и этап, полоса прогресса, срок
  if (brief) return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Работы в ходу')),
    rows.length
      ? h('div', { class: 'card-box' }, folded(rows, ({ app, request: r, current }) => h('button', { class: 'wip-brief', onclick: () => openAppById(app.id, reload) },
        appIcon(app, 'sm'),
        h('span', { class: 'wip-brief-main' }, app.name, h('small', null, [REQUEST_TYPES[r.type], current && current.title.split(' · ')[0]].filter(Boolean).join(' · '))),
        h('span', { class: 'wip-brief-bar', 'aria-hidden': 'true' }, h('i', { style: { width: (r.progress || 0) + '%' } })),
        h('span', { class: 'wip-brief-due' + (r.dueDate && r.dueDate < today ? ' danger-text' : '') }, r.dueDate ? fmtDate(r.dueDate) : '—'))))
      : emptyBlock('Нет работ', { ic: 'progress' }));
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Работы в процессе')),
    rows.length
      ? h('div', { class: 'card-box wip-list' },
        h('div', { class: 'wip-row wip-head', 'aria-hidden': 'true' },
          h('span', null, 'Приложение'), h('span', null, 'Задача'), h('span', null, 'Сейчас'), h('span', null, 'Этапы'), h('span', null, 'Срок'), h('span', null, 'PM')),
        paged(rows, ({ app, request: r, current }) => {
          const late = r.dueDate && r.dueDate < today;
          const pm = personById(r.assigneeId);
          return h('button', { class: 'wip-row', onclick: () => openAppById(app.id, reload) },
            // приоритет показываем только высокий — остальное не повод для плашки
            h('span', { class: 'wip-app' }, appIcon(app, 'xs'), h('b', null, app.name), prioTag(r.priority)),
            h('span', { class: 'wip-req' }, h('span', { class: 'wip-title', title: REQUEST_TYPES[r.type] || '' }, r.title)),
            h('span', { class: 'wip-now' }, current ? current.title.split(' · ')[0] : r.stages.length ? 'релиз' : h('span', { class: 'muted' }, 'ждёт PM')),
            h('span', { class: 'wip-stages', title: r.stages.length ? r.progress + '%' : '' }, r.stages.length ? stageDots(r.stages) : h('span', { class: 'muted' }, '—')),
            h('span', { class: 'wip-due' + (late ? ' late' : '') }, r.dueDate ? fmtDate(r.dueDate) : h('span', { class: 'muted' }, '—')),
            pm ? avatar(pm, 'sm') : h('span', { class: 'muted' }, '—'));
        }))
      : emptyBlock('Нет работ', { ic: 'progress' }));
}

/* ---------- недавно вышло ---------- */

/** Что произошло: смена статуса «было → стало», начало разработки, задача по приложению готова. */
function recentWhat(x) {
  if (x.type === 'start') return h('span', { class: 'muted' }, 'Начало разработки');
  if (x.type === 'done') return h('span', { class: 'muted' }, x.request.title + ' — готово');
  const from = appStatusById(x.from), to = appStatusById(x.to);
  // макет 12: «Релиз → Ревью Apple» одним приглушённым текстом, без цветной точки
  return h('span', { class: 'muted' }, (from ? from.name + ' → ' : '') + (to ? to.name : x.to));
}

/** «Недавнее» — движение приложений за 30 дней: 5 последних, остальное — «Показать все». */
export function recent(d, reload, { title = 'Недавнее', empty = 'За 30 дней статусы приложений не менялись' } = {}) {
  const LIMIT = 5;
  const box = h('section');
  let all = false;
  const draw = () => fill(box,
    h('div', { class: 'section-head', title: 'За 30 дней: смена статусов приложений, начало разработки, готовые задачи' },
      h('h2', null, title)),
    d.recent.length
      ? h('div', { class: 'card-box rc-list' }, (all ? d.recent : d.recent.slice(0, LIMIT)).map(x => h('button', { class: 'rc-row', onclick: () => openAppById(x.app.id, reload) },
        h('span', { class: 'rc-main rc-two' }, h('b', null, x.app.name), h('span', { class: 'rc-what' }, recentWhat(x))),
        h('span', { class: 'muted rc-at' }, relTime(x.at)))),
        d.recent.length > LIMIT && h('button', { class: 'rc-more link-btn', onclick: () => { all = !all; draw(); } },
          all ? 'Свернуть' : `Показать все · ${d.recent.length}`))
      : emptyBlock(empty, { ic: 'clock' }));
  draw();
  return box;
}


/* ---------- блоки дашборда ---------- */

const DAY = 864e5;
const ago = iso => (iso ? (Date.now() - Date.parse(iso)) / DAY : Infinity);

/** Числа плиток аналитики: сами плитки и экран за плиткой считают из одного места. */
function figures(d, apps) {
  // вышло за 30 дней — по истории статусов (импорт уже вышедших сюда не попадает)
  const live30 = [...new Map(d.recent.filter(x => x.type === 'status' && (appStatusById(x.to) || {}).kind === 'live' && apps.some(a => a.id === x.app.id))
    .map(x => [x.app.id, { ...(apps.find(a => a.id === x.app.id) || x.app), statusAt: x.at }])).values()];
  return {
    open: apps.flatMap(a => a.requests.filter(r => !r.done).map(r => ({ a, r }))),
    overdue: d.attention.filter(x => x.type === 'overdue' && (!x.app || apps.some(a => a.id === x.app.id))),
    live30,
    done30: apps.flatMap(a => a.requests.filter(r => r.done && ago(r.doneAt) <= 30 && !/^Реджект №/.test(r.title)).map(r => ({ a, r }))),
    stale: apps.filter(a => ago(a.lastActivity) > d.staleDays).sort((x, y) => String(x.lastActivity).localeCompare(String(y.lastActivity))),
  };
}

const appPmName = a => (personById(appPm(a)) || {}).name || '';
const statusText = a => { const st = appStatusById(a.status); return { node: appStatusCell(st, a) }; };

/** Строки экрана плитки: что за цифрой (G03). */
function tileRows(key, d, apps, reload) {
  const { open, overdue, live30, done30, stale } = figures(d, apps);
  const appLine = (a, date) => ({ icon: a, title: a.name, app: (unitById(a.unitId) || {}).name || '', status: statusText(a), who: appPmName(a), date, open: () => openAppById(a.id, reload) });
  const taskOpen = (r, t) => () => peekTask(r.unitId, (t || r).id);
  if (key === 'apps') return { heads: ['Приложение', 'Юнит', 'Статус', 'PM', 'Обновлено'], rows: apps.map(a => appLine(a, a.lastActivity ? relTime(a.lastActivity) : '')) };
  if (key === 'stale') return { heads: ['Приложение', 'Юнит', 'Статус', 'PM', 'Движение'], rows: stale.map(a => appLine(a, relTime(a.lastActivity))) };
  if (key === 'shipped') return { heads: ['Что вышло', 'Приложение', 'Статус', 'Исполнитель', 'Когда'], rows: [
    ...live30.map(a => ({ icon: a, title: a.name, app: 'App Store', status: statusText(a), who: appPmName(a), date: relTime(a.statusAt), open: () => openAppById(a.id, reload) })),
    ...done30.map(({ a, r }) => ({ title: r.title, app: a.name, status: { text: 'Готово', cls: 'ok' }, who: (personById(r.assigneeId) || {}).name || '', date: relTime(r.doneAt), open: taskOpen(r) }))] };
  const heads = ['Задача', 'Приложение', 'Статус', 'Исполнитель', 'Срок'];
  if (key === 'late') return { heads, rows: overdue.map(x => ({ title: (x.task || x.request).title, app: x.app ? x.app.name : '', status: { text: 'Просрочено', cls: 'late' },
    who: (personById((x.task || x.request).assigneeId) || {}).name || '', date: fmtDate((x.task || x.request).dueDate), late: true, open: taskOpen(x.request, x.task) })) };
  const today = todayStr();
  return { heads, rows: open.map(({ a, r }) => {
    const cur = r.stages.find(s => !s.done && !s.blocked) || null;
    return { title: cur ? cur.title : r.title, app: a.name, status: cur ? { text: cur.kind === 'todo' ? 'Не начато' : 'В работе', cls: cur.kind === 'todo' ? '' : 'work' } : { text: 'Ждёт PM' },
      who: (personById((cur || r).assigneeId) || {}).name || '', date: r.dueDate ? fmtDate(r.dueDate) : '', late: !!r.dueDate && r.dueDate < today, open: taskOpen(r, cur) };
  }) };
}

/** Экран плитки (G03): таблица, группировка по приложениям или людям; лишнее — под «Показать ещё». */
export function tileTable(key, d, apps, reload) {
  const LIMIT = 12;
  const { heads, rows } = tileRows(key, d, apps, reload);
  const box = h('section', { class: 'card-box an-tile' });
  let by = 'app', all = false;
  const noun = key === 'apps' || key === 'stale' ? ['приложение', 'приложения', 'приложений'] : ['задача', 'задачи', 'задач'];
  const draw = () => {
    const sorted = [...rows].sort((x, y) => (by === 'who' ? x.who : x.app).localeCompare(by === 'who' ? y.who : y.app, 'ru'));
    const shown = all ? sorted : sorted.slice(0, LIMIT);
    const seg = (id, label) => h('button', { class: by === id ? 'on' : '', onclick: () => { by = id; draw(); } }, label);
    fill(box,
      h('div', { class: 'an-tile-head' }, h('h2', null, rows.length + ' ' + plural(rows.length, noun)),
        h('div', { class: 'an-tile-seg' }, seg('app', 'По приложениям'), seg('who', 'По людям'))),
      rows.length
        ? h('div', { class: 'an-table' },
          h('div', { class: 'an-row an-th' }, heads.map(x => h('span', null, x))),
          shown.map(x => h('button', { class: 'an-row', onclick: x.open },
            h('b', { class: x.icon ? 'an-app' : null }, x.icon && appIcon(x.icon, 'md'), h('span', null, x.title)), h('span', { class: 'an-sub' }, x.app),
            h('span', { class: 'an-st ' + (x.status.cls || '') }, x.status.node || x.status.text),
            h('span', { class: 'an-sub' }, x.who || '—'), h('span', { class: 'an-date' + (x.late ? ' late' : '') }, x.date || '—'))))
        : emptyBlock('Здесь пусто', { ic: 'clock' }),
      rows.length > LIMIT && !all && h('button', { class: 'an-more', onclick: () => { all = true; draw(); } }, `Показать ещё ${rows.length - LIMIT}`),
      rows.length > 0 && h('p', { class: 'muted an-hint' }, 'Плитки сверху переключают список. Клик по строке открывает карточку поверх экрана.'));
  };
  draw();
  return box;
}

/**
 * Статистика для «Аналитики»: цифры, по статусам, юниты × статусы, загрузка PM, давно не трогали, выпущено за 30 дней.
 * d — getCeoDashboard, apps — listApps (уже отфильтрованные по юниту, если выбран).
 */
const daysAgo = at => { const n = Math.max(1, Math.floor((Date.now() - new Date(at)) / 864e5)); return n + ' ' + plural(n, ['день', 'дня', 'дней']) + ' назад'; };

export function statBlocks(d, apps, reload, tile = '') {
  const { open, overdue, live30, done30, stale } = figures(d, apps);
  const stat = (n, label, sub, tone, spark, key) => link({ view: 'analytics', tile: tile === key ? '' : key }, { class: 'cs cs-link' + (tone ? ' ' + tone : '') + (tile === key ? ' on' : '') }, h('div', { class: 'cs-n' }, n), h('div', { class: 'cs-label' }, label), sub && h('div', { class: 'cs-sub muted' }, sub), spark);
  const appRow = (a, right, cls = '') => h('button', { class: ('rc-row ' + cls).trim(), onclick: () => openAppById(a.id, reload) },
    appIcon(a, 'xs'), h('span', { class: 'rc-main' }, h('b', null, a.name)), right);
  const section = (title, body, n) => h('section', null, h('div', { class: 'section-head' }, h('h2', null, title, n != null && h('span', { class: 'muted sec-n' }, n))), body);
  const list = (items, empty) => (items.length ? h('div', { class: 'card-box rc-list' }, items) : emptyBlock(empty, { ic: 'clock' }));
  const pms = S.people.filter(p => p.active && p.access === 'moderator');

  return [
    { id: 'kpi', title: 'Цифры', col: 'full', render: () => h('div', { class: 'cs-row' },
      stat(apps.length, 'Приложения', apps.filter(a => (appStatusById(a.status) || {}).kind === 'live').length + ' в App Store', '', null, 'apps'), stat(open.length, 'Задачи в работе', null, '', sparkline(openSeries(apps.flatMap(a => a.requests))), 'work'),
      stat(overdue.length, 'Просрочено', overdue.length ? 'Требуют внимания' : null, overdue.length ? 'danger' : '', null, 'late'), stat(live30.length + done30.length, 'Выпущено', 'За 30 дней', '', null, 'shipped'),
      stat(stale.length, 'Давно не трогали', d.staleDays + '+ ' + plural(d.staleDays, ['день', 'дня', 'дней']), '', null, 'stale')) },
    { id: 'statuses', title: 'Приложения по статусам', col: 'full', render: () => section('По статусам', h('div', { class: 'card-box st-sum' },
      S.appStatuses.map(st => { const n = apps.filter(a => a.status === st.id).length; return h('div', { class: 'st-sum-row' + (n ? '' : ' zero') }, statusPill(st), h('span', { class: 'st-sum-bar' }, h('span', { style: { width: (apps.length ? n / apps.length * 100 : 0) + '%', background: st.color } })), h('b', null, n)); }))) },
    { id: 'byunit', title: 'Юниты × статусы', col: 'full', render: () => section('Юниты × статусы', h('div', { class: 'card-box mx', style: { '--n': S.appStatuses.length } },
      h('div', { class: 'mx-row mx-head' }, h('span'), S.appStatuses.map(st => h('span', { title: st.name }, st.name))),
      units().map(u => h('div', { class: 'mx-row' }, h('span', { class: 'mx-unit' }, h('span', { class: 'unit-dot', style: { background: u.color, margin: 0 } }), u.name),
        S.appStatuses.map(st => { const n = apps.filter(a => a.unitId === u.id && a.status === st.id).length; return h('span', { class: n ? 'mx-n' : 'mx-n zero' }, n || '—'); }))))) },
    { id: 'pmload', title: 'Загрузка PM', col: 'right', render: () => section('Загрузка PM', list(pms.map(p => {
      const mine = open.filter(x => x.r.assigneeId === p.id);
      const late = mine.filter(x => x.r.dueDate && x.r.dueDate < todayStr()).length;
      return h('div', { class: 'pm-load-row' }, avatar(p, 'sm'), h('b', { 'data-pcard': p.id }, p.name),
        h('span', { class: 'muted' }, mine.length + ' в работе', late > 0 && h('span', { class: 'warn-text' }, ' · ' + late + ' просроч.')));
    }), 'PM нет')) },
    { id: 'stale', title: 'Без движения', col: 'right', render: () => section('Давно не трогали', list(stale.map(a => appRow(a, h('span', { class: 'muted rc-at' }, daysAgo(a.lastActivity)), 'stale-row')), 'Таких нет')) },
    { id: 'shipped', title: 'Выпущено за 30 дней', col: 'right', render: () => {
      // название и подпись в две строки, время — справа: узкая колонка не ломает ряд
      const row = (a, text, at) => h('button', { class: 'rc-row stale-row', onclick: () => openAppById(a.id, reload) },
        appIcon(a, 'xs'), h('span', { class: 'rc-main' }, h('b', null, a.name), h('small', { class: 'muted', style: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, text)),
        h('span', { class: 'muted rc-at' }, relTime(at)));
      return section('Выпущено за 30 дней', list([
        ...live30.map(a => row(a, 'Вышло в App Store', a.statusAt)),
        ...done30.map(({ a, r }) => row(a, r.title, r.doneAt))], 'Пока ничего'));
    } },
  ];
}

/**
 * Блоки дашборда CEO для раскладки: рабочие блоки + свои подборки (c:<id>). Порядок, колонки и видимость — у каждого свои (prefs.ceoHome).
 * Статистика переехала в «Аналитику» (statBlocks).
 */
function ceoBlocks(d, apps, reload) {
  const blocks = [
    { id: 'news', title: 'Новое для вас', col: 'full', empty: 'Появится, когда что-то придёт вам', render: () => newsBlock() },
    { id: 'units', title: 'Юниты', col: 'full', render: () => portfolio(d, reload) },
    // как на A03: слева внимание и работы, справа недавнее и отслеживаемое; проверка App Store включается в настройке
    { id: 'attention', title: 'Требует внимания', col: 'left', render: () => attention(d, reload) },
    { id: 'inprogress', title: 'Работы в процессе', col: 'left', render: () => inProgress(d, reload) },
    { id: 'recent', title: 'Недавнее', col: 'right', render: () => recent(d, reload) },
    { id: 'watch', title: 'Отслеживаю', col: 'right', render: () => watchBlock(apps, { openApp: id => openAppById(id, reload), openTask: peekTask, appIcon, appStatusCell, stageDots }) },
    { id: 'storeCheck', title: 'Проверка App Store', col: 'full', off: true, render: () => storeCheckBlock(apps, reload, { compact: true }) },
  ];
  // свои подборки
  for (const b of customBlocks()) blocks.push({ id: 'c:' + b.id, title: b.name, col: b.col || 'right', custom: true, render: () => customBlock(b, apps, reload) });
  return blocks;
}

/* ---------- свои блоки (подборки приложений по фильтрам) ---------- */

const customBlocks = () => ((me() || {}).prefs || {}).ceoBlocks || [];
function setCustomBlocks(list) {
  const p = me();
  if (p) p.prefs = { ...(p.prefs || {}), ceoBlocks: list };
  send('setMyPrefs', { personId: S.meId, prefs: { ceoBlocks: list } }).catch(showErr);
}
const AGES = [[0, 'Неважно'], [7, 'Больше недели'], [14, 'Больше 2 недель'], [30, 'Больше месяца']];

/** Приложения под фильтр блока: юниты, статусы, менеджеры, приоритеты, «не трогали N дней». */
const matchBlock = (b, a) => {
  const f = b.f || {};
  return (!(f.units || []).length || f.units.includes(a.unitId)) && (!(f.statuses || []).length || f.statuses.includes(a.status))
    && (!(f.pms || []).length || f.pms.includes(appPm(a))) && (!(f.prios || []).length || f.prios.includes(a.priority))
    && (!f.age || ago(a.lastActivity) > f.age);
};

function customBlock(b, apps, reload) {
  const found = apps.filter(a => matchBlock(b, a));
  const head = h('div', { class: 'section-head' }, h('h2', null, b.name, h('span', { class: 'muted sec-n' }, found.length)));
  if (b.view === 'count') {
    return h('section', null, head, h('button', {
      class: 'card-box cb-count', onclick: e => { e.stopPropagation(); menu(e.currentTarget, [{ title: b.name }, ...found.map(a => ({ label: a.name, action: () => openAppById(a.id, reload) }))]); },
    }, h('div', { class: 'cs-n' }, found.length), h('div', { class: 'cs-label muted' }, plural(found.length, ['приложение', 'приложения', 'приложений']))));
  }
  return h('section', null, head, found.length
    ? h('div', { class: 'card-box rc-list' }, found.map(a => h('button', { class: 'rc-row', onclick: () => openAppById(a.id, reload) },
      appIcon(a, 'xs'), h('span', { class: 'rc-main' }, h('b', null, a.name)), statusPill(appStatusById(a.status)))))
    : emptyBlock('Под фильтр ничего не попало', { ic: 'filter' }));
}

/** Окно своего блока: название, фильтры (галочки), вид — список или число. */
function openBlockEditor(b, onSaved) {
  const draft = b ? JSON.parse(JSON.stringify(b)) : { id: Math.random().toString(36).slice(2, 9), name: '', view: 'list', col: 'right', f: {} };
  draft.f = { units: [], statuses: [], pms: [], prios: [], age: 0, ...draft.f };
  const name = h('input', { class: 'inp', value: draft.name, maxlength: 60, placeholder: 'Например, Gold в ревью Apple' });
  const group = (title, key, items) => h('div', { class: 'field' }, h('label', null, title), h('div', { class: 'cb-chips' }, items.map(([id, label, color]) => {
    const btn = h('button', { class: 'cb-chip' + (draft.f[key].includes(id) ? ' on' : ''), type: 'button' }, color && h('span', { class: 'dot', style: { background: color } }), label);
    btn.onclick = () => { draft.f[key] = draft.f[key].includes(id) ? draft.f[key].filter(x => x !== id) : [...draft.f[key], id]; btn.classList.toggle('on'); };
    return btn;
  })));
  const age = h('select', { class: 'inp' }, AGES.map(([v, t]) => h('option', { value: String(v), selected: draft.f.age === v }, t)));
  const view = h('select', { class: 'inp' }, [['list', 'Списком'], ['count', 'Числом']].map(([v, t]) => h('option', { value: v, selected: draft.view === v }, t)));
  modal({
    title: b ? 'Свой блок' : 'Новый блок', wide: true,
    body: [
      h('p', { class: 'hint', style: { marginTop: 0 } }, 'Подборка приложений по фильтрам. Ничего не отмечено — значит все.'),
      field('Название', name),
      group('Юниты', 'units', units().map(u => [u.id, u.name, u.color])),
      group('Статусы', 'statuses', S.appStatuses.map(st => [st.id, st.name, st.color])),
      group('Менеджер', 'pms', S.people.filter(p => p.active && p.access === 'moderator').map(p => [p.id, p.name])),
      group('Приоритет', 'prios', [...S.priorityOptions].reverse().map(o => [o.id, o.name, o.color])),
      h('div', { class: 'grid2' }, field('Не трогали', age), field('Вид', view)),
    ],
    actions: [{ label: 'Отмена' }, {
      label: b ? 'Сохранить' : 'Добавить', primary: true,
      action: close => {
        if (!name.value.trim()) return name.focus();
        draft.name = name.value.trim();
        draft.f.age = Number(age.value);
        draft.view = view.value;
        const list = customBlocks();
        setCustomBlocks(b ? list.map(x => (x.id === b.id ? draft : x)) : [...list, draft]);
        close();
        onSaved();
      },
    }],
  });
}
