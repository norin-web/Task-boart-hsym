/**
 * Дашборд CEO (главная CEO в обоих режимах): портфель приложений по статусам и юнитам, что требует внимания,
 * работы в ходу (запросы и текущий этап), что недавно вышло. Клик — карточка приложения или задача поверх.
 */
import { S, isSuper, personById, unitById, REQUEST_TYPES, greeting, me, plural, fmtDate, relTime, todayStr, appStatusById } from '../state.js';
import { $, h, icon, avatar, topbar, showErr, fill, menu, modal, field } from '../ui.js';
import { call, send } from '../api.js';
import { currentView } from '../router.js';
import { peekTask } from './task.js';
import { openAppById, openCreateApp, openImportApps, storeCheckBlock, appStatusCell, openNewAppTask, appIcon, prioTag, stageDots, statusPill, appPm } from './apps.js';
import { newsBlock, loadNotes, fillDemo, unitCard } from './home.js';
import { renderLayout, editLayout } from './layout.js';
import { openCreateUnit } from './units.js';
import { watchBlock } from './watch.js';
import { mode } from '../data.js';

const units = () => S.units.filter(u => !u.archived).sort((a, b) => (a.order || 0) - (b.order || 0));
const prioRank = id => S.priorityOptions.findIndex(o => o.id === id);
const daysSince = iso => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 864e5));
// «высокий» — два верхних варианта приоритета (High, Critical)
const isHigh = id => { const i = prioRank(id); return i >= 0 && i >= S.priorityOptions.length - 2; };
const daysLate = due => Math.max(1, Math.round((Date.parse(todayStr()) - Date.parse(due)) / 864e5));

export async function renderCeoHome() {
  const page = h('div', { class: 'page ceo-page' }, h('div', { class: 'boot' }, h('span', { class: 'spinner' }), 'Загрузка…'));
  fill($('#main'),
    topbar([h('h1', null, 'Дашборд')], [
      isSuper() && S.apps.some(a => !a.archived) && h('button', { class: 'btn', onclick: () => openNewAppTask(load) }, icon('plus', 15), h('span', { class: 'btn-label' }, 'Новая задача')),
      isSuper() && units().length > 0 && h('button', { class: 'btn primary', onclick: () => openCreateApp(load) }, icon('plus', 15), h('span', { class: 'btn-label' }, 'Новое приложение'))]),
    h('div', { class: 'view-body' }, page));
  async function load() {
    let d, apps;
    try { [d, apps] = await Promise.all([call('getCeoDashboard', { today: todayStr() }), call('listApps', {}), loadNotes()]); } catch (e) { return showErr(e); }
    if (currentView() !== 'home') return;
    S.apps = apps.map(({ requests, active, ...a }) => a);
    const total = apps.length;
    const person = me();
    // без юнитов показывать нечего; юниты есть, а приложений нет — дашборд целиком, сверху подсказка
    if (!units().length) {
      return fill(page,
        h('div', { class: 'ceo-hello' }, h('h2', null, greeting() + (person ? ', ' + person.name.split(' ')[0] : ''))),
        newsBlock(),
        h('div', { class: 'card-box empty-state' },
          h('h2', null, 'Приложений пока нет'),
          !units().length && h('p', null, 'Сначала создайте юнит.'),
          h('div', { class: 'row', style: { justifyContent: 'center', gap: '8px' } },
            isSuper() && (units().length
              ? h('button', { class: 'btn primary', onclick: () => openCreateApp(load) }, icon('plus', 15), 'Новое приложение')
              : h('button', { class: 'btn primary', onclick: openCreateUnit }, icon('plus', 15), 'Создать юнит')),
            mode === 'local' && !units().length && h('button', { class: 'btn', onclick: e => fillDemo(e.currentTarget) }, icon('layers', 15), 'Заполнить демо-данными'))));
    }
    const blocks = () => ceoBlocks(d, apps, load);
    const edit = () => editLayout('ceoHome', blocks(), page, draw, {
      title: 'Настройка дашборда',
      extra: h('button', { class: 'btn sm', onclick: () => openBlockEditor(null, edit) }, icon('plus', 14), 'Свой блок'),
      onEdit: id => openBlockEditor(customBlocks().find(b => 'c:' + b.id === id), edit),
      onDelete: id => { setCustomBlocks(customBlocks().filter(b => 'c:' + b.id !== id)); edit(); },
    });
    const draw = () => fill(page,
      h('div', { class: 'ceo-hello row' }, h('h2', null, greeting() + (person ? ', ' + person.name.split(' ')[0] : '')),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn ghost sm', title: 'Блоки, статистика и свои подборки', onclick: edit }, icon('layers', 14), 'Настроить')),
      !total && h('div', { class: 'card-box empty-state sm' },
        h('p', { style: { margin: 0 } }, 'Приложений пока нет — добавьте новое или уже существующие списком.'),
        isSuper() && h('div', { class: 'row', style: { justifyContent: 'center', gap: '8px' } },
          h('button', { class: 'btn primary sm', onclick: () => openCreateApp(load) }, icon('plus', 14), 'Новое приложение'),
          h('button', { class: 'btn sm', onclick: () => openImportApps(load) }, icon('layers', 14), 'Добавить списком'))),
      renderLayout('ceoHome', blocks()));
    draw();
  }
  load();
}

/* ---------- юниты ---------- */

/** Юниты карточками (команда, задачи, прогресс); последняя — «Новый юнит». */
function portfolio(d, reload) {
  const count = u => S.apps.filter(a => a.unitId === u.id && !a.archived).length;
  return h('section', { class: 'ceo-portfolio' },
    h('div', { class: 'section-head' }, h('h2', null, 'Юниты')),
    h('div', { class: 'unit-grid' }, units().map(u => unitCard(u, { apps: count(u), to: 'overview' })),
      isSuper() && h('button', { class: 'unit-card add', onclick: () => openCreateUnit(reload) }, icon('plus', 18), 'Новый юнит')));
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

export function attention(d, reload) {
  const rows = d.attention;
  const what = x => (x.task && x.task.id !== x.request.id ? x.task.title.split(' · ')[0] : x.request ? x.request.title : '');
  const who = x => personById(x.task ? x.task.assigneeId : x.request ? x.request.assigneeId : '');
  // этапы лежат в юните запроса; реджект — карточка приложения
  const open = x => (x.request ? peekTask(x.request.unitId, x.task ? x.task.id : x.request.id) : openAppById(x.app.id, reload));
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Требует внимания', rows.length > 0 && h('span', { class: 'muted sec-n' }, rows.length))),
    rows.length
      ? h('div', { class: 'card-box att-list' }, rows.slice(0, 12).map(x => {
        const a = ATT[x.type];
        const p = who(x);
        return h('button', { class: 'att-row', onclick: () => open(x) },
          appIcon(x.app, 'xs'),
          h('span', { class: 'att-main' }, h('b', null, x.app.name), what(x) && h('span', { class: 'muted' }, ' · ' + what(x))),
          h('span', { class: 'att-what ' + a.cls }, a.text(x)),
          p ? avatar(p, 'sm') : h('span', { class: 'avatar-gap' }));
      }), rows.length > 12 && h('p', { class: 'muted att-more' }, `и ещё ${rows.length - 12}`))
      : h('div', { class: 'card-box empty-state sm' }, h('p', { class: 'muted' }, 'Всё по плану')));
}

/* ---------- работы в ходу ---------- */

export function inProgress(d, reload) {
  const rows = [...d.inProgress].sort((a, b) => prioRank(b.request.priority) - prioRank(a.request.priority)
    || (a.request.dueDate || '9999').localeCompare(b.request.dueDate || '9999'));
  const today = todayStr();
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Работы в ходу')),
    rows.length
      ? h('div', { class: 'card-box wip-list' },
        h('div', { class: 'wip-row wip-head', 'aria-hidden': 'true' },
          h('span', null, 'Приложение'), h('span', null, 'Задача'), h('span', null, 'Сейчас'), h('span', null, 'Этапы'), h('span', null, 'Срок'), h('span', null, 'PM')),
        rows.map(({ app, request: r, current }) => {
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
      : h('div', { class: 'card-box empty-state sm' }, h('p', { class: 'muted' }, 'Нет работ')));
}

/* ---------- недавно вышло ---------- */

/** Что произошло: смена статуса «было → стало», начало разработки, задача по приложению готова. */
function recentWhat(x) {
  if (x.type === 'start') return h('span', { class: 'muted' }, 'начало разработки');
  if (x.type === 'done') return h('span', { class: 'muted' }, x.request.title + ' — готово');
  const from = appStatusById(x.from), to = appStatusById(x.to);
  return h('span', { class: 'rc-move' }, from && h('span', { class: 'muted' }, from.name + ' → '),
    h('span', { class: 'rc-to', style: { '--sc': to ? to.color : 'var(--muted)' } }, to ? to.name : x.to));
}

/** «Недавнее» — движение приложений за 30 дней: 5 последних, остальное — «Показать все». */
export function recent(d, reload, { title = 'Недавнее', empty = 'За 30 дней статусы приложений не менялись' } = {}) {
  const LIMIT = 5;
  const box = h('section');
  let all = false;
  const draw = () => fill(box,
    h('div', { class: 'section-head', title: 'За 30 дней: смена статусов приложений, начало разработки, готовые задачи' },
      h('h2', null, title, d.recent.length > 0 && h('span', { class: 'muted sec-n' }, d.recent.length))),
    d.recent.length
      ? h('div', { class: 'card-box rc-list' }, (all ? d.recent : d.recent.slice(0, LIMIT)).map(x => h('button', { class: 'rc-row', onclick: () => openAppById(x.app.id, reload) },
        appIcon(x.app, 'xs'),
        h('span', { class: 'rc-main rc-two' }, h('b', null, x.app.name), h('span', { class: 'rc-what' }, recentWhat(x))),
        h('span', { class: 'muted rc-at' }, relTime(x.at)))),
        d.recent.length > LIMIT && h('button', { class: 'rc-more link-btn', onclick: () => { all = !all; draw(); } },
          all ? 'Свернуть' : `Показать все · ${d.recent.length}`))
      : h('div', { class: 'card-box empty-state sm' }, h('p', { class: 'muted' }, empty)));
  draw();
  return box;
}


/* ---------- блоки дашборда ---------- */

const DAY = 864e5;
const ago = iso => (iso ? (Date.now() - Date.parse(iso)) / DAY : Infinity);

/**
 * Статистика для «Аналитики»: цифры, по статусам, юниты × статусы, загрузка PM, давно не трогали, выпущено за 30 дней.
 * d — getCeoDashboard, apps — listApps (уже отфильтрованные по юниту, если выбран).
 */
export function statBlocks(d, apps, reload) {
  const open = apps.flatMap(a => a.requests.filter(r => !r.done).map(r => ({ a, r })));
  const stat = (n, label, sub, tone) => h('div', { class: 'cs' + (tone ? ' ' + tone : '') }, h('div', { class: 'cs-n' }, n), h('div', { class: 'cs-label' }, label), sub && h('div', { class: 'cs-sub muted' }, sub));
  const appRow = (a, right) => h('button', { class: 'rc-row', onclick: () => openAppById(a.id, reload) },
    appIcon(a, 'xs'), h('span', { class: 'rc-main' }, h('b', null, a.name)), right);
  const section = (title, body, n) => h('section', null, h('div', { class: 'section-head' }, h('h2', null, title, n != null && h('span', { class: 'muted sec-n' }, n))), body);
  const list = (items, empty) => (items.length ? h('div', { class: 'card-box rc-list' }, items) : h('div', { class: 'card-box empty-state sm' }, h('p', { class: 'muted' }, empty)));
  const overdue = d.attention.filter(x => x.type === 'overdue' && (!x.app || apps.some(a => a.id === x.app.id))).length;
  // вышло за 30 дней — по истории статусов (импорт уже вышедших сюда не попадает)
  const live30 = [...new Map(d.recent.filter(x => x.type === 'status' && (appStatusById(x.to) || {}).kind === 'live' && apps.some(a => a.id === x.app.id))
    .map(x => [x.app.id, { ...(apps.find(a => a.id === x.app.id) || x.app), statusAt: x.at }])).values()];
  const done30 = apps.flatMap(a => a.requests.filter(r => r.done && ago(r.doneAt) <= 30).map(r => ({ a, r })));
  const stale = apps.filter(a => ago(a.lastActivity) > d.staleDays).sort((x, y) => String(x.lastActivity).localeCompare(String(y.lastActivity)));
  const pms = S.people.filter(p => p.active && p.access === 'moderator');

  return [
    { id: 'kpi', title: 'Цифры', col: 'full', render: () => h('div', { class: 'cs-row' },
      stat(apps.length, 'приложений'), stat(open.length, 'задач в работе'),
      stat(overdue, 'просрочено', null, overdue ? 'danger' : ''), stat(live30.length + done30.length, 'выпущено за 30 дней'),
      stat(stale.length, 'не трогали', d.staleDays + '+ дн.')) },
    { id: 'statuses', title: 'Приложения по статусам', col: 'full', render: () => section('По статусам', h('div', { class: 'card-box st-sum' },
      S.appStatuses.map(st => { const n = apps.filter(a => a.status === st.id).length; return h('div', { class: 'st-sum-row' + (n ? '' : ' zero') }, statusPill(st), h('span', { class: 'st-sum-bar' }, h('span', { style: { width: (apps.length ? n / apps.length * 100 : 0) + '%', background: st.color } })), h('b', null, n)); }))) },
    { id: 'byunit', title: 'Юниты × статусы', col: 'full', render: () => section('Юниты × статусы', h('div', { class: 'card-box mx', style: { '--n': S.appStatuses.length } },
      h('div', { class: 'mx-row mx-head' }, h('span'), S.appStatuses.map(st => h('span', { title: st.name }, st.name))),
      units().map(u => h('div', { class: 'mx-row' }, h('span', { class: 'mx-unit' }, h('span', { class: 'unit-dot', style: { background: u.color, margin: 0 } }), u.name),
        S.appStatuses.map(st => { const n = apps.filter(a => a.unitId === u.id && a.status === st.id).length; return h('span', { class: n ? 'mx-n' : 'mx-n zero' }, n || '—'); }))))) },
    { id: 'pmload', title: 'Загрузка PM', col: 'right', render: () => section('Загрузка PM', list(pms.map(p => {
      const mine = open.filter(x => x.r.assigneeId === p.id);
      const late = mine.filter(x => x.r.dueDate && x.r.dueDate < todayStr()).length;
      return h('div', { class: 'rc-row' }, avatar(p, 'sm'), h('span', { class: 'rc-main', 'data-pcard': p.id }, h('b', null, p.name)),
        h('span', { class: 'muted rc-at' }, mine.length + ' в работе', late > 0 && h('span', { class: 'warn-text' }, ' · ' + late + ' просроч.')));
    }), 'PM нет')) },
    { id: 'stale', title: 'Забытые приложения', col: 'right', render: () => section('Давно не трогали', list(stale.map(a => appRow(a, h('span', { class: 'muted rc-at' }, relTime(a.lastActivity)))), 'Таких нет'), stale.length || null) },
    { id: 'shipped', title: 'Выпущено за 30 дней', col: 'right', render: () => section('Выпущено за 30 дней', list([
      ...live30.map(a => appRow(a, h('span', { class: 'muted rc-at' }, 'в сторе · ' + relTime(a.statusAt)))),
      ...done30.map(({ a, r }) => appRow(a, h('span', { class: 'muted rc-at' }, r.title.slice(0, 40) + ' · ' + relTime(r.doneAt))))], 'Пока ничего')) },
  ];
}

/**
 * Блоки дашборда CEO для раскладки: рабочие блоки + свои подборки (c:<id>). Порядок, колонки и видимость — у каждого свои (prefs.ceoHome).
 * Статистика переехала в «Аналитику» (statBlocks).
 */
function ceoBlocks(d, apps, reload) {
  const blocks = [
    { id: 'news', title: 'Новое для вас', col: 'full', first: true, empty: 'Появится, когда что-то придёт вам', render: () => newsBlock() },
    { id: 'units', title: 'Юниты', col: 'full', render: () => portfolio(d, reload) },
    { id: 'storeCheck', title: 'Проверка App Store', col: 'full', render: () => storeCheckBlock(apps, reload, { compact: true }) },
    { id: 'watch', title: 'Отслеживаю', col: 'full', render: () => watchBlock(apps, { openApp: id => openAppById(id, reload), openTask: peekTask, appIcon, appStatusCell, stageDots }) },
    // внимание и недавнее — рядом, широкая таблица работ — на всю ширину под ними
    { id: 'attention', title: 'Требует внимания', col: 'left', render: () => attention(d, reload) },
    { id: 'recent', title: 'Недавнее', col: 'right', render: () => recent(d, reload) },
    { id: 'inprogress', title: 'Работы в ходу', col: 'full', render: () => inProgress(d, reload) },
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
    : h('div', { class: 'card-box empty-state sm' }, h('p', { class: 'muted' }, 'Под фильтр ничего не попало')));
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
