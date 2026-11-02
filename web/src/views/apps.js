/**
 * Приложения (Tasks 2.0): канбан — колонки статусы приложения, дорожки юниты (перетаскивание меняет статус и порядок —
 * приоритет внутри колонки; в другую дорожку — перенос в другой юнит, только CEO) и список. Клик — карточка приложения
 * справа: статус, юнит, приоритет, поля быстрого доступа, работы (запросы CEO и их этапы).
 */
import Sortable from 'sortablejs';
import { S, isSuper, isStaff, seesApps, me, personById, unitById, appStatusById, prioById, REQUEST_TYPES, LS, plural, fmtDate, PALETTE, between, todayStr, relTime } from '../state.js';
import { $, h, icon, avatar, topbar, showErr, fill, modal, field, toast, menu, closeMenu, confirmDlg, promptDlg, prioMark, prioSelect, skeleton } from '../ui.js';
import { call, send } from '../api.js';
import { currentView, navigate, navParent } from '../router.js';
import { peekTask } from './task.js';
import { unitHeader } from './unitnav.js';
import { brandIcon, brandOf } from './brand.js';
import { isWatched, toggleWatch, canWatch } from './watch.js';
import { fillDemo } from './home.js';
import { mode } from '../data.js';
import appStoreSvg from '../assets/app-store.svg';  // thesvg.org/icons/app-store

const units = () => S.units.filter(u => !u.archived).sort((a, b) => (a.order || 0) - (b.order || 0));
export const pmsOf = unitId => ((unitById(unitId) || {}).members || []).map(personById).filter(p => p && p.active && p.access === 'moderator');
/** Управляет юнитом: CEO — любым, PM — своим (то же правило в базе). */
const canManage = unitId => isSuper() || (isStaff() && ((unitById(unitId) || {}).members || []).includes(S.meId));

const STAGE_STATE = {
  done: { label: 'готово', icon: 'check' },
  progress: { label: 'в работе', icon: 'progress' },
  blocked: { label: 'ждёт предыдущих', icon: 'lock' },
  todo: { label: 'не начато', icon: 'circle' },
};
const stageState = s => (s.done ? 'done' : s.blocked ? 'blocked' : s.kind === 'todo' ? 'todo' : 'progress');
export const STATUS_KINDS = { dev: 'В разработке', release: 'Релиз', review: 'Ревью Apple', live: 'App Store', reject: 'Реджект', '': 'Свой (без автоматики)' };

/* ---------- мелкие части (их же использует дашборд CEO) ---------- */

export const appIcon = (a, size = 'sm') => (a.iconUrl
  ? h('img', { class: 'uc-icon app-img ' + size, src: a.iconUrl, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })
  : h('span', { class: 'uc-icon ' + size, style: { background: a.color || PALETTE[0] }, 'aria-hidden': 'true' }, a.name.slice(0, 2).toUpperCase()));

/** Поле «App Store» среди полей приложения (ссылка на стор, не App Store Connect). */
export const storeField = () => S.appFields.find(f => f.kind === 'link' && /app ?store/i.test(f.name) && !/connect/i.test(f.name)) || null;

/**
 * Название и иконка из App Store по ссылке вида apps.apple.com/ru/app/…/id123 (открытый iTunes Lookup, CORS разрешён).
 * Возвращает { name, iconUrl } или null.
 */
export async function storeLookup(url) {
  const id = (/id(\d{5,})/.exec(url || '') || [])[1];
  if (!id) return null;
  const country = (/apple\.com\/([a-z]{2})\//i.exec(url) || [])[1] || 'us';
  try {
    const r = await fetch(`https://itunes.apple.com/lookup?id=${id}&country=${country}`);
    const j = await r.json();
    const x = j.results && j.results[0];
    return x ? { name: x.trackName || '', iconUrl: x.artworkUrl512 || x.artworkUrl100 || '' } : null;
  } catch { return null; }
}
/** Приложение в сторе — значок и подпись App Store вместо статуса. */
export const storeBadge = () => h('span', { class: 'store-badge', title: 'В App Store' }, h('img', { src: appStoreSvg, alt: '', width: 18, height: 18 }), 'App Store');
/** Проверка показала, что страницы в сторе нет. */
export const storeGoneBadge = () => h('span', { class: 'store-badge gone', title: 'Страница в App Store не открывается' }, icon('alert', 15), 'Нет в App Store');
/** Статус в списке: пропало из стора — красная пометка; «в сторе» — App Store; остальное — цветная плашка. */
export const appStatusCell = (st, a) => (a && a.storeOk === false ? storeGoneBadge() : st && st.kind === 'live' ? storeBadge() : statusPill(st));
/** Статус приложения: значок формы + слово (цвет только помогает); «ревью Apple» — заливкой. */
const PILL_ICON = { dev: 'progress', release: 'rocket', review: 'eye', live: 'done', reject: 'rejected' };
export const statusPill = st => (st && st.kind === 'live' ? storeBadge() : st
  ? h('span', { class: 'st-pill k-' + (st.kind || 'x'), style: { '--sc': st.color } }, PILL_ICON[st.kind] ? icon(PILL_ICON[st.kind], 14) : h('span', { class: 'dot' }), st.name)
  : h('span', { class: 'muted' }, '—'));
/** Приоритет: цветная метка с названием (не только цветом). */
/** Высокий приоритет — два верхних варианта (High, Critical); плашку показываем только им. */
export const isHighPrio = id => { const i = S.priorityOptions.findIndex(o => o.id === id); return i >= 0 && i >= S.priorityOptions.length - 2; };
/** Приоритет — шевроном цвета варианта (как в Jira); пусто — ничего. */
export const prioTag = id => { const i = S.priorityOptions.findIndex(o => o.id === id); return i < 0 ? null : prioMark(S.priorityOptions[i], i, S.priorityOptions.length, 15); };
/** Этапы точками: готово — залито, в работе — кольцо, ждёт — штрих, не начато — серое; подпись — в title. */
export const stageDots = stages => h('span', { class: 'stage-dots', 'aria-label': `Этапы: ${stages.filter(s => s.done).length} из ${stages.length} готово` },
  stages.map(s => h('span', { class: 'sd sd-' + stageState(s), title: `${s.title.split(' · ')[0]} — ${STAGE_STATE[stageState(s)].label}` })));

/** Иконка поля приложения по названию: Figma, Drive, GitHub, стор — свои, остальное — ссылка. */
const fieldIcon = f => { const n = (f.id + ' ' + f.name).toLowerCase(); return /figma/.test(n) ? 'figma' : /drive|диск/.test(n) ? 'drive' : /git/.test(n) ? 'github' : /store|asc|apple/.test(n) ? 'app' : f.kind === 'text' ? 'edit' : 'link'; };

/** Тип запроса, этапы точками и прогресс. */
function workSummary(r) {
  // текущий этап: начатый, иначе первый незаблокированный; всё готово — релиз
  const cur = r.stages.find(s => !s.done && !s.blocked && s.kind !== 'todo') || r.stages.find(s => !s.done && !s.blocked);
  return [
    h('span', { class: 'ap-req muted' }, REQUEST_TYPES[r.type] || 'Задача'),
    r.stages.length
      ? [h('b', { class: 'ap-stage' }, cur ? cur.title.split(' · ')[0] : 'Релиз'), h('span', { title: r.progress + '%' }, stageDots(r.stages))]
      : h('span', { class: 'muted' }, 'ждёт PM'),
  ];
}

/* ---------- экран ---------- */

/** Список приложений: общий (#/apps) или вкладка юнита (unitId, #/u/:id/apps — шапка юнита, только его приложения). */
export async function renderApps({ unitId = '' } = {}) {
  const body = h('div', { class: 'page apps-page' }, skeleton());
  const tools = h('div', { class: 'row', style: { gap: '8px' } });
  // макет 59: в шапке — настройки и создание, ниже отдельной строкой — поиск, фильтр, группировка и «Выбрать»
  const bar = h('div', { class: 'apps-bar' });
  const viewKey = unitId ? 'apps:' + unitId : 'apps';
  const here = () => currentView() === viewKey;
  const head = () => (unitId ? unitHeader('apps', [tools]) : [topbar([h('h1', null, 'Приложения')], [tools])]);
  fill($('#main'), ...head(), h('div', { class: 'view-body' }, bar, body));

  let apps;
  const load = async () => {
    apps = await call('listApps', unitId ? { unitId } : {});
    const brief = apps.map(({ requests, active, ...a }) => a);
    S.apps = unitId ? [...S.apps.filter(a => a.unitId !== unitId), ...brief] : brief;
  };
  try { await load(); } catch (e) { return showErr(e); }
  if (!here()) return;
  if (unitId) fill($('#main'), ...head(), h('div', { class: 'view-body' }, bar, body));  // счётчик вкладки — по свежему списку
  setTimeout(() => fillFromStore(apps, () => here() && drawList()), 0);

  // Только список: приложения по юнитам в сворачиваемых блоках, поиск по названию сверху
  let q = '';
  // Фильтры (как в Jira): разделы слева — значения с поиском справа; свои наборы — в профиле (prefs.appFilters)
  const EMPTY = { statuses: [], prios: [], pms: [], units: [], store: [], age: 0 };
  const f = { ...EMPTY, workFirst: false, ...LS.get('appsFilter', {}) };
  for (const k of Object.keys(EMPTY)) if (k !== 'age' && !Array.isArray(f[k])) f[k] = [];
  const saveF = () => LS.set('appsFilter', f);
  const storeState = a => (!appStoreUrl(a) ? 'nolink' : a.storeOk === false ? 'gone' : 'ok');
  const active = () => f.statuses.length + f.prios.length + f.pms.length + f.units.length + f.store.length + (f.age ? 1 : 0);
  const chips = h('div', { class: 'feed-filters apps-chips' });
  const filterBtn = h('button', { class: 'btn', 'aria-haspopup': 'dialog', onclick: e => { e.stopPropagation(); filterMenu(e.currentTarget); } });
  const groupBtn = h('button', { class: 'btn ap-group-btn', 'aria-haspopup': 'menu', onclick: e => { e.stopPropagation(); groupMenu(e.currentTarget); } });
  let onlyWork = S.appsHint === 'working';  // пришли с плитки «В работе»: показываем только приложения с открытой работой
  S.appsHint = null;
  const passes = a => (!onlyWork || a.active > 0)
    && (!f.statuses.length || f.statuses.includes(a.status))
    && (!f.prios.length || f.prios.includes(a.priority || ''))
    && (!f.pms.length || f.pms.includes(appPm(a)))
    && (!f.units.length || f.units.includes(a.unitId))
    && (!f.store.length || f.store.includes(storeState(a)))
    && (!f.age || !a.lastActivity || Date.now() - Date.parse(a.lastActivity) > f.age * 864e5);
  const saved = () => (((me() || {}).prefs || {}).appFilters || []);
  const setSaved = list => {
    const p = me();
    if (p) p.prefs = { ...(p.prefs || {}), appFilters: list };
    send('setMyPrefs', { personId: S.meId, prefs: { appFilters: list } }).catch(showErr);
  };
  const apply = next => { Object.assign(f, EMPTY, next); saveF(); drawList(); };  // группировку (workFirst) фильтр не сбрасывает
  const dot = c => h('span', { class: 'dot', style: { background: c } });
  /** Разделы фильтра: [ключ, название, варианты { id, label, mark }, один вариант?]. */
  const sections = () => [
    ['statuses', 'Статус', S.appStatuses.map(st => ({ id: st.id, label: st.name, mark: dot(st.color) }))],
    ['prios', 'Приоритет', [...S.priorityOptions.map((o, i) => ({ id: o.id, label: o.name, mark: prioMark(o, i, S.priorityOptions.length, 15) })).reverse(),
      { id: '', label: 'Без приоритета', mark: h('span', { class: 'prio-mark muted' }, icon('circle', 13)) }]],
    ['pms', 'Менеджер', S.people.filter(p => p.active && p.access === 'moderator').map(p => ({ id: p.id, label: p.name, mark: avatar(p, 'sm') }))],
    !unitId && ['units', 'Юнит', units().map(u => ({ id: u.id, label: u.name, mark: dot(u.color) }))],
    ['store', 'App Store', [{ id: 'ok', label: 'Открывается' }, { id: 'gone', label: 'Нет в App Store' }, { id: 'nolink', label: 'Нет ссылки' }]],
    ['age', 'Не трогали', [[7, 'Больше недели'], [14, 'Больше 2 недель'], [30, 'Больше месяца']].map(([d, label]) => ({ id: d, label })), true],
  ].filter(Boolean);
  const countOf = key => (key === 'age' ? (f.age ? 1 : 0) : f[key].length);
  let fsec = 'statuses';
  function filterMenu(anchor) {
    const box = h('div', { class: 'flt' });
    let q = '';
    const search = h('input', { class: 'inp flt-search', type: 'search', placeholder: 'Поиск', 'aria-label': 'Поиск значения',
      oninput: e => { q = e.target.value.trim().toLowerCase(); paintList(); } });
    const list = h('div', { class: 'flt-list', role: 'group' });
    const nav = h('div', { class: 'flt-nav' });
    const foot = h('div', { class: 'flt-foot' });
    const changed = () => { saveF(); drawList(); paintNav(); paintList(); };
    const pick = (key, id, single) => {
      if (single) f.age = f.age === id ? 0 : id;
      else f[key] = f[key].includes(id) ? f[key].filter(x => x !== id) : [...f[key], id];
      changed();
    };
    const paintNav = () => fill(nav,
      saved().length > 0 && h('button', { class: 'flt-tab' + (fsec === 'saved' ? ' on' : ''), onclick: e => { e.stopPropagation(); fsec = 'saved'; q = ''; search.value = ''; paintNav(); paintList(); } },
        icon('filter', 13), 'Мои фильтры', h('span', { class: 'flt-n muted' }, saved().length)),
      sections().map(([key, label]) => h('button', { class: 'flt-tab' + (fsec === key ? ' on' : ''), onclick: e => { e.stopPropagation(); fsec = key; q = ''; search.value = ''; paintNav(); paintList(); } },
        label, countOf(key) > 0 && h('span', { class: 'flt-n' }, countOf(key)))),
      active() > 0 && h('button', { class: 'flt-save link-btn', onclick: async e => {
        e.stopPropagation();
        closeMenu();
        const name = await promptDlg('Сохранить фильтр', 'Название', '');
        if (name && name.trim()) setSaved([...saved(), { name: name.trim().slice(0, 40), f: { statuses: f.statuses, prios: f.prios, pms: f.pms, units: f.units, store: f.store, age: f.age } }]);
      } }, icon('plus', 13), 'Сохранить как свой'));
    const paintList = () => {
      if (fsec === 'saved') {
        search.hidden = true;
        fill(list, saved().map((sv, i) => h('div', { class: 'af-saved' },
          h('button', { class: 'menu-item', onclick: e => { e.stopPropagation(); apply(sv.f); paintNav(); paintList(); } }, icon('filter', 14), sv.name),
          h('button', { class: 'icon-btn sm', title: 'Удалить', onclick: e => { e.stopPropagation(); setSaved(saved().filter((_, j) => j !== i)); if (!saved().length) fsec = 'statuses'; paintNav(); paintList(); } }, icon('x', 13)))));
        fill(foot, h('button', { class: 'link-btn', onclick: e => { e.stopPropagation(); apply({}); paintNav(); paintList(); } }, 'Сбросить всё'), h('span'));
        return;
      }
      const sec = sections().find(x => x[0] === fsec) || sections()[0];
      const [key, label, opts, single] = sec;
      search.hidden = opts.length < 6;
      search.placeholder = 'Поиск: ' + label.toLowerCase();
      const shown = opts.filter(o => !q || String(o.label).toLowerCase().includes(q));
      const isOn = o => (single ? f.age === o.id : f[key].includes(o.id));
      fill(list, shown.length
        ? shown.map(o => h('button', { class: 'menu-item aud-item' + (isOn(o) ? ' on' : ''), role: single ? 'menuitemradio' : 'menuitemcheckbox', 'aria-checked': String(isOn(o)),
          onclick: e => { e.stopPropagation(); pick(key, o.id, single); } },
          h('span', { class: 'aud-check' + (single ? ' round' : '') }, isOn(o) && icon('check', 13)), o.mark, o.label))
        : h('p', { class: 'muted flt-empty' }, opts.length ? 'Ничего не найдено' : key === 'pms' ? 'PM пока нет' : 'Пусто'));
      fill(foot,
        h('button', { class: 'link-btn', onclick: e => { e.stopPropagation(); apply({}); paintNav(); paintList(); } }, 'Сбросить всё'),
        h('span', { class: 'flt-foot-r' },
          countOf(key) > 0 && h('button', { class: 'link-btn', onclick: e => { e.stopPropagation(); if (single) f.age = 0; else f[key] = []; changed(); } }, 'Очистить'),
          h('span', { class: 'muted' }, `${shown.length} из ${opts.length}`)));
    };
    fill(box, nav, h('div', { class: 'flt-pane' }, search, list), foot);
    paintNav();
    paintList();
    box.addEventListener('click', e => e.stopPropagation());
    menu(anchor, [box], { align: 'left' });
    if (!search.hidden) search.focus();
  }
  /** Группировка списка: «В работе» сверху отдельным разделом или только по юнитам. */
  function groupMenu(anchor) {
    menu(anchor, [{ title: 'Группировка' },
      ...[[true, 'В работе сверху, затем по юнитам'], [false, 'Только по юнитам']].map(([v, label]) => ({
        label, icon: f.workFirst === v ? 'check' : 'blank', action: () => { f.workFirst = v; saveF(); drawList(); },
      }))]);
  }
  const drawFilters = () => {
    const n = active();
    fill(filterBtn, icon('filter', 14), h('span', { class: 'btn-label' }, 'Фильтр'), n > 0 && h('span', { class: 'count-badge' }, n));
    filterBtn.classList.toggle('on', n > 0);
    fill(groupBtn, icon('layers', 14), h('span', { class: 'btn-label' }, 'Группа: ' + (f.workFirst ? 'в работе сверху' : 'по юнитам')));
    const chip = (label, onx) => h('span', { class: 'chip filter-chip' }, label, h('button', { class: 'chip-x', title: 'Убрать', onclick: onx }, icon('x', 11)));
    const drop = (key, id) => () => { f[key] = f[key].filter(x => x !== id); saveF(); drawList(); };
    const label = (key, id) => ((sections().find(x => x[0] === key) || [, , []])[2].find(o => o.id === id) || { label: id || '—' }).label;
    fill(chips,
      ['statuses', 'prios', 'pms', 'units', 'store'].flatMap(key => f[key].map(id => chip(label(key, id), drop(key, id)))),
      onlyWork && chip('В работе', () => { onlyWork = false; drawList(); }),
      f.age > 0 && chip(`не трогали > ${f.age} дн.`, () => { f.age = 0; saveF(); drawList(); }),
      active() > 1 && h('button', { class: 'link-btn', onclick: () => apply({}) }, 'Сбросить всё'));
  };
  // сортировка по колонке (клик по заголовку): { key, dir: -1 по убыванию | 1 по возрастанию } или null — по приоритету
  let sort = LS.get('appsSort', null);
  const onSort = key => {
    sort = !sort || sort.key !== key ? { key, dir: key === 'name' || key === 'pm' ? 1 : -1 } : sort.dir === (key === 'name' || key === 'pm' ? 1 : -1) ? { key, dir: -sort.dir } : null;
    LS.set('appsSort', sort);
    drawList();
  };
  const collapsed = new Set(LS.get('appsCollapsed', []));
  const reload = () => load().then(() => { drawTools(); drawList(); }).catch(showErr);
  // выбор нескольких — чтобы удалить пачкой (только CEO)
  let sel = null;
  const pick = id => { if (sel.has(id)) sel.delete(id); else sel.add(id); drawList(); };
  const setPicking = on => { sel = on ? new Set() : null; drawTools(); drawList(); };
  async function bulk(patch, done, ids = [...sel]) {
    try {
      await send('updateApps', { ids, ...patch });
      toast(`${done}: ${ids.length} ${plural(ids.length, ['приложение', 'приложения', 'приложений'])}`);
      await load();
      drawList();
    } catch (e) { showErr(e); }
  }
  const pickBar = found => h('div', { class: 'pick-bar' },
    h('b', null, 'Выбрано: ' + sel.size),
    h('button', { class: 'link-btn', onclick: () => { const all = found.every(a => sel.has(a.id)); found.forEach(a => (all ? sel.delete(a.id) : sel.add(a.id))); drawList(); } },
      found.length && found.every(a => sel.has(a.id)) ? 'Снять все' : 'Выбрать все' + (q || active() ? ' найденные' : '')),
    h('span', { class: 'spacer' }),
    // массовая правка: статус и юнит
    h('button', { class: 'btn sm', disabled: !sel.size, 'aria-haspopup': 'menu', onclick: e => { e.stopPropagation(); menu(e.currentTarget, [{ title: 'Поставить статус' },
      ...S.appStatuses.map(st => h('button', { class: 'menu-item', role: 'menuitem', onclick: () => { closeMenu(); bulk({ status: st.id }, `Статус «${st.name}»`); } },
        h('span', { class: 'dot', style: { background: st.color } }), st.name))]); } }, 'Статус', icon('chevron', 13)),
    h('button', { class: 'btn sm', disabled: !sel.size, 'aria-haspopup': 'menu', onclick: e => { e.stopPropagation(); menu(e.currentTarget, [{ title: 'Поставить приоритет' },
      ...S.priorityOptions.map((o, i) => o).reverse().map(o => h('button', { class: 'menu-item', role: 'menuitem', onclick: () => { closeMenu(); bulk({ priority: o.id }, `Приоритет «${o.name}»`); } },
        prioMark(o, S.priorityOptions.indexOf(o), S.priorityOptions.length, 15), o.name)),
      { sep: true },
      { label: 'Без приоритета', icon: 'x', action: () => bulk({ priority: '' }, 'Приоритет снят') }]); } }, 'Приоритет', icon('chevron', 13)),
    isSuper() && h('button', { class: 'btn sm', disabled: !sel.size, 'aria-haspopup': 'menu', onclick: e => { e.stopPropagation(); menu(e.currentTarget, [{ title: 'Перенести в юнит' },
      ...units().map(u => ({ label: u.name, icon: 'board', action: async () => {
        const list = apps.filter(a => sel.has(a.id) && a.unitId !== u.id);
        if (!list.length) return toast('Выбранные уже в «' + u.name + '»');
        const withWork = list.filter(a => a.requests.length).length;
        if (withWork && !(await confirmDlg(`Перенести ${list.length} ${plural(list.length, ['приложение', 'приложения', 'приложений'])} в «${u.name}»? Задачи приложений переедут вместе с ними, открытые запросы получит PM «${u.name}».`, { ok: 'Перенести', title: 'Перенос в юнит' }))) return;
        bulk({ unitId: u.id }, `Перенесено в «${u.name}»`, list.map(a => a.id));
      } }))]); } }, 'В юнит', icon('chevron', 13)),
    h('button', { class: 'btn sm danger', disabled: !sel.size, onclick: async () => {
      if (await deleteAppsDlg(apps.filter(a => sel.has(a.id)))) { sel = null; drawTools(); reload(); }
    } }, icon('trash', 14), 'Удалить'),
    h('button', { class: 'btn sm', onclick: () => setPicking(false) }, 'Готово'));
  const search = h('input', {
    class: 'apps-search-inp', type: 'search', placeholder: 'Поиск приложения', 'aria-label': 'Поиск приложения',
    oninput: e => { q = e.target.value.trim().toLowerCase(); drawList(); },
  });
  const toggle = id => {
    if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
    LS.set('appsCollapsed', [...collapsed]);
    drawList();
  };
  const drawList = () => {
    drawFilters();
    if (!apps.length) return fill(body, emptyApps(reload));
    const found = apps.filter(a => (!q || a.name.toLowerCase().includes(q) || (a.storeName || '').toLowerCase().includes(q)) && passes(a));
    // в работе (есть открытый запрос) — отдельным разделом сверху, из юнитов ниже убираются
    const work = f.workFirst ? found.filter(a => a.active > 0) : [];
    const rest = f.workFirst ? found.filter(a => !(a.active > 0)) : found;
    const groups = (unitId ? units().filter(u => u.id === unitId) : [...units(), { id: '', name: 'Без юнита', color: 'var(--border-strong)' }])
      .map(u => ({ u, list: rest.filter(a => (a.unitId || '') === u.id || (!u.id && !unitById(a.unitId))) }))
      .filter(g => g.list.length);
    const workOpen = !!q || !collapsed.has('__work');
    fill(body, !sel && !q && !unitId && storeCheckBlock(apps, reload), sel && pickBar(found), chips, groups.length || work.length ? [appHead(sort, onSort),
      work.length > 0 && h('section', { class: 'ap-group ap-work-group' + (workOpen ? ' open' : '') },
        h('button', { class: 'ap-group-head', 'aria-expanded': String(workOpen), onclick: () => toggle('__work') },
          h('span', { class: 'ap-chev' }, icon('chevron', 14)), icon('progress', 14), h('b', null, 'В работе'),
          h('span', { class: 'muted' }, work.length)),
        workOpen && appTable(work, reload, sel, pick, true, sort)),
      ...groups.map(({ u, list }) => {
      // во вкладке юнита группа одна — без заголовка
      if (unitId) return appTable(list, reload, sel, pick, false, sort);
      const open = !!q || active() > 0 || !collapsed.has(u.id);
      return h('section', { class: 'ap-group' + (open ? ' open' : '') },
        h('button', { class: 'ap-group-head', 'aria-expanded': String(open), onclick: () => toggle(u.id) },
          h('span', { class: 'ap-chev' }, icon('chevron', 14)),
          h('span', { class: 'unit-dot', style: { background: u.color, margin: 0 } }), h('b', null, u.name),
          h('span', { class: 'muted' }, list.length)),
        open && appTable(list, reload, sel, pick, false, sort));
    })] : h('p', { class: 'muted apps-none' }, 'Ничего не найдено'));
  };
  const drawTools = () => {
    fill(tools,
      isSuper() && h('button', { class: 'icon-btn', title: 'Статусы и поля приложения', onclick: e => { e.stopPropagation(); settingsMenu(e.currentTarget, reload); } }, icon('sliders', 16)),
      isSuper() && units().length > 0 && h('button', { class: 'btn', title: 'Уже существующие приложения: название и ссылка на App Store построчно', onclick: () => openImportApps(reload, unitId) }, icon('layers', 14), h('span', { class: 'btn-label' }, 'Добавить списком')),
      isSuper() && units().length > 0 && h('button', { class: 'btn primary', onclick: () => openCreateApp(reload, unitId || undefined) }, icon('plus', 14), h('span', { class: 'btn-label' }, 'Новое приложение')));
    fill(bar,
      h('label', { class: 'apps-search' }, icon('search', 14), search),
      filterBtn,
      groupBtn,
      h('span', { class: 'spacer' }),
      isSuper() && apps.length > 0 && h('button', { class: 'btn' + (sel ? ' on' : ''), title: 'Выбрать несколько приложений, чтобы удалить', onclick: () => setPicking(!sel) }, icon('check', 14), h('span', { class: 'btn-label' }, 'Выбрать')));
  };
  drawTools();
  drawList();
}

function emptyApps(reload) {
  return h('div', { class: 'card-box empty-state' },
    h('h2', null, 'Приложений пока нет'),
    isSuper()
      ? [h('p', { style: { margin: 0 } }, 'Создайте приложение — запрос «New App» сразу уйдёт PM его юнита.'),
        h('div', { class: 'row', style: { justifyContent: 'center', gap: '8px' } },
          units().length
            ? [h('button', { class: 'btn primary', onclick: () => openCreateApp(reload) }, icon('plus', 15), 'Новое приложение'),
              h('button', { class: 'btn', onclick: () => openImportApps(reload) }, icon('layers', 15), 'Добавить списком')]
            : h('span', { class: 'muted' }, 'Сначала нужен юнит (Gold, RF, MVP…): Настройки → Юниты.'),
          mode === 'local' && !units().length && h('button', { class: 'btn', onclick: e => fillDemo(e.currentTarget) }, icon('layers', 15), 'Заполнить демо-данными'))]
      : h('p', { style: { margin: 0 } }, 'Здесь появятся приложения ваших юнитов.'));
}

/* ---------- канбан: статусы × юниты ---------- */


function settingsMenu(anchor, reload) {
  menu(anchor, [
    { label: 'Статусы приложения…', icon: 'progress', action: () => openStatusesEditor(reload) },
    { label: 'Поля приложения…', icon: 'link', action: () => openFieldsEditor(reload) },
    { label: 'Релиз: поля и чеклист…', icon: 'rocket', action: () => import('./release.js').then(m => m.openReleaseSettings()) },
    { label: 'Шаблоны апдейтов…', icon: 'layers', action: () => openUpdateTemplates() },
  ]);
}

/* ---------- список ---------- */

/** Строки с подписанными колонками: приложение · юнит · статус · сейчас в работе · PM. */
/** Подписи колонок списка — одна строка над всеми группами. */
const SORT_COLS = [['name', 'Приложение'], ['status', 'Статус'], ['prio', 'Приоритет'], ['work', 'Сейчас в работе'], ['updated', 'Обновлено'], ['pm', 'PM']];
/** Шапка колонок; клик по колонке — сортировка: по убыванию → по возрастанию → как было (onSort(key)). */
export const appHead = (sort, onSort) => h('div', { class: 'ap-row ap-head', role: 'row' },
  SORT_COLS.map(([key, label]) => {
    const on = sort && sort.key === key;
    return onSort
      ? h('button', { class: 'ap-sort' + (on ? ' on' : ''), role: 'columnheader', 'aria-sort': on ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none', title: 'Сортировать: ' + label.toLowerCase(), onclick: () => onSort(key) },
        label, h('span', { class: 'ap-sort-ic' }, icon('chevron', 12)))
      : h('span', { role: 'columnheader' }, label);
  }), h('span'));
/** Значение для сортировки по колонке. */
const sortVal = (a, key) => {
  switch (key) {
    case 'name': return a.name.toLowerCase();
    // как в колонке: «Нет в App Store» — отдельное состояние после всех статусов (по убыванию — сверху)
    case 'status': return a.storeOk === false ? S.appStatuses.length : S.appStatuses.findIndex(x => x.id === a.status);
    case 'prio': return S.priorityOptions.findIndex(o => o.id === a.priority);
    case 'work': { const r = (a.requests || []).find(x => !x.done); return r ? 1 + (r.progress || 0) / 1000 : 0; }
    case 'updated': return a.lastActivity || '';
    case 'pm': return ((personById(appPm(a)) || {}).name || '').toLowerCase();
    default: return 0;
  }
};

/** Менеджер приложения: PM открытой задачи, иначе PM юнита. */
export const appPm = a => { const req = (a.requests || []).find(r => !r.done); return (req && req.assigneeId) || ((pmsOf(a.unitId)[0] || {}).id) || ''; };

/** sel — режим выбора (Set id): клик по строке отмечает её вместо открытия карточки; withUnit — показать юнит (раздел «В работе»). */
export function appTable(apps, reload, sel, onPick, withUnit, sort) {
  const rank = id => S.priorityOptions.findIndex(o => o.id === id);
  const bySort = (a, b) => { const x = sortVal(a, sort.key), y = sortVal(b, sort.key); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || a.name.localeCompare(b.name, 'ru'); };
  return h('div', { class: 'ap-list' + (sel ? ' picking' : '') },
    [...apps].sort(sort ? bySort : (a, b) => rank(b.priority) - rank(a.priority) || (a.order || 0) - (b.order || 0)).map(a => {
      const st = appStatusById(a.status);
      const req = a.requests.find(r => !r.done) || null;
      const pm = personById(appPm(a));
      const on = !!sel && sel.has(a.id);
      const po = prioById(a.priority);
      return h('button', { class: 'ap-row' + (on ? ' picked' : '') + (po ? ' has-prio' : ''), style: po ? { '--pc': po.color } : null, 'aria-pressed': sel ? String(on) : null, onclick: () => (sel ? onPick(a.id) : openAppCard(a, reload)) },
        h('span', { class: 'ap-name' }, sel && h('span', { class: 'aud-check pick-box' }, on && icon('check', 13)), appIcon(a),
          h('span', { class: 'ap-names' },
            h('span', { class: 'ap-title' }, h('b', null, a.name), a.isTest && h('span', { class: 'test-tag' }, 'тест')),
            (a.storeName || withUnit) && h('small', { class: 'muted ap-store-name', title: a.storeName ? 'В App Store: ' + a.storeName : '' },
              withUnit && unitById(a.unitId) && h('span', { class: 'unit-dot', style: { background: unitById(a.unitId).color, margin: 0 } }),
              withUnit && unitById(a.unitId) && unitById(a.unitId).name + (a.storeName ? ' · ' : ''), a.storeName))),
        h('span', null, appStatusCell(st, a)),
        // приоритет — своей колонкой: шеврон и название, как в Jira
        h('span', { class: 'ap-prio' }, po ? [prioTag(a.priority), h('span', null, po.name)] : h('span', { class: 'muted' }, '—')),
        h('span', { class: 'ap-work' }, req ? workSummary(req) : h('span', { class: 'muted' }, '—')),
        h('span', { class: 'muted ap-upd', title: a.lastActivity ? fmtDate(a.lastActivity.slice(0, 10)) : '' }, a.lastActivity ? relTime(a.lastActivity) : '—'),
        h('span', null, pm ? avatar(pm, 'sm') : h('span', { class: 'muted' }, '—')),
        icon('chevron', 15));
    }));
}

/* ---------- карточка приложения ---------- */

/** Открыть карточку приложения по id (с дашборда CEO): свежие данные — из listApps. */
export async function openAppById(id, onChange) {
  try {
    const a = (await call('listApps', {})).find(x => x.id === id);
    if (!a) return toast('Приложение не найдено — возможно, его перенесли в архив', { type: 'error' });
    openAppCard(a, onChange);
  } catch (e) { showErr(e); }
}

/** Реджект — запрос, который создаёт RM кнопкой «Реджект» (тип «Задача», название «Реджект: причина»). */
const isReject = r => /^Реджект/i.test(r.title);
const byCreated = (x, y) => String(x.createdAt).localeCompare(String(y.createdAt));
/** Карточка приложения: на весь экран (по умолчанию, макет 12б) или широкая панель сбоку (12в). */
const appCardSide = () => LS.get('appCardMode', 'full') === 'side';
/** Открыть карточку так, как выбрано: страница #/app/:id или панель сбоку. */
export function openAppCard(a, onChange) {
  if (appCardSide()) openAppPanel(a, onChange); else navigate({ view: 'app', id: a.id });
}
/** Страница карточки приложения (#/app/:id). */
export async function renderAppPage(id) {
  const main = $('#main');
  fill(main, topbar([h('h1', null, 'Приложение')]), h('div', { class: 'view-body' }, skeleton()));
  try {
    const a = (await call('listApps', {})).find(x => x.id === id);
    if (S.route.view !== 'app' || S.route.id !== id) return;
    if (!a) { toast('Приложение не найдено — возможно, его перенесли в архив', { type: 'error' }); return navigate({ view: 'apps' }, { replace: true }); }
    document.title = a.name + ' · Tasks';
    openAppPanel(a, null, main);
  } catch (e) { showErr(e); }
}

export function openAppPanel(a, onChange, page = null) {
  const root = $('#panel-root');
  const close = () => { document.removeEventListener('keydown', onKey, true); if (page) navigate(navParent().route, { back: true }); else fill(root); };
  const onKey = e => {
    if (e.key !== 'Escape' || document.querySelector('.modal') || document.querySelector('.menu')) return;
    // Esc в поле карточки — отменить правку (поле обработает само) или просто выйти из поля, а не закрывать карточку
    const f = document.activeElement;
    if (f && panel.contains(f) && f.matches('input, textarea, select')) { if (!f.closest('.af-row')) f.blur(); return; }
    e.stopPropagation();
    close();
  };
  if (!page) document.addEventListener('keydown', onKey, true);
  const body = h('div', { class: 'up-body' });
  const side = page ? h('aside', { class: 'app-side' }) : null;  // справа на странице: свойства, команда, даты
  let notes = null;
  let noteBox = null;  // поле заметки — для «Добавить заметку» в меню
  const loadNotes = () => call('getAppNotes', { appId: a.id }).then(list => { notes = list; draw(); }).catch(showErr);
  const refresh = async () => {
    try {
      const list = await call('listApps', {});
      const fresh = list.find(x => x.id === a.id);
      if (!fresh) return close();
      a = fresh;
      const i = S.apps.findIndex(x => x.id === a.id);
      if (i >= 0) S.apps[i] = { ...S.apps[i], ...fresh };
      draw();
      if (onChange) onChange();
    } catch (e) { showErr(e); }
  };
  const save = patch => send('updateApp', { id: a.id, ...patch }).then(refresh).catch(e => { showErr(e); draw(); });
  /** Ссылка на стор → иконка и название из App Store вместе с остальной правкой. */
  const fromStore = async (url, patch = {}) => {
    const info = await storeLookup(url);
    if (!info) { toast('В App Store по этой ссылке ничего не нашлось', { type: 'error' }); return save(patch); }
    toast('Название и иконка — из App Store');
    return save({ ...patch, iconUrl: info.iconUrl, ...(info.name ? { name: info.name } : {}) });
  };

  /** Строка блока «Задачи» (B05): заголовок, под ним этап, исполнитель и срок; клик — задача поверх. */
  const taskLine = r => {
    const cur = r.stages.find(s => !s.done && !s.blocked) || null;
    const who = personById((cur || r).assigneeId);
    return h('button', { class: 'ap-task-row', onclick: () => peekTask(r.unitId, r.id) },
      h('span', { class: 'ap-task-ic', 'aria-hidden': 'true' }),
      h('span', { class: 'ap-task-main' }, h('b', null, r.title),
        h('small', { class: 'muted' }, [cur && cur.title.split(' · ')[0], who && who.name, r.dueDate && 'до ' + fmtDate(r.dueDate)].filter(Boolean).join(' · '))),
      who && avatar(who, 'sm'));
  };

  /** Пронумерованный список (апдейты / реджекты): «#2 Название», этап сейчас, срок; клик — запрос поверх. */
  const numbered = (list, label) => list.map((r, i) => {
    const cur = r.stages.find(s => !s.done && !s.blocked) || null;
    return h('button', { class: 'ap-num-row' + (r.done ? ' done' : ''), onclick: () => peekTask(r.unitId, r.id) },
      h('span', { class: 'ap-num' }, label + ' ' + (i + 1)),
      h('span', { class: 'ap-num-title' }, r.title.replace(/^Реджект:\s*/i, '')),
      h('span', { class: 'ap-num-state muted' }, r.done ? [icon('check', 13), ' готово'] : cur ? cur.title.split(' · ')[0] : r.stages.length ? 'релиз' : 'ждёт PM'),
      h('span', { class: 'muted ap-num-at' }, fmtDate((r.doneAt || r.createdAt || '').slice(0, 10))));
  });

  const draw = () => {
    const u = unitById(a.unitId);
    const ceo = isSuper(), manage = canManage(a.unitId);
    const statusSel = h('select', { class: 'inp', 'aria-label': 'Статус приложения', disabled: !manage, onchange: e => save({ status: e.target.value }) },
      S.appStatuses.map(s => h('option', { value: s.id, selected: s.id === a.status }, s.name)));
    const unitSel = h('select', {
      class: 'inp', 'aria-label': 'Юнит', disabled: !ceo,
      onchange: async e => {
        const dest = unitById(e.target.value);
        const ok = await confirmDlg(`Перенести «${a.name}» в ${dest.name}? Задачи приложения переедут вместе с ним, открытые запросы получит PM ${dest.name}.`, { ok: 'Перенести', title: 'Перенос в другой юнит' });
        if (ok) save({ unitId: dest.id }); else e.target.value = a.unitId;
      },
    }, units().map(x => h('option', { value: x.id, selected: x.id === a.unitId }, x.name)));
    const prioSel = prioSelect(S.priorityOptions, a.priority, v => save({ priority: v }), { disabled: !manage });
    const reqs = [...a.requests].sort(byCreated);
    const updates = reqs.filter(r => r.type === 'update');
    const rejects = reqs.filter(isReject);
    const other = reqs.filter(r => r.type !== 'update' && !isReject(r));
    const open = other.filter(r => !r.done), closed = other.filter(r => r.done);
    const active = reqs.filter(r => !r.done);
    const st = appStatusById(a.status);
    const noteInp = h('textarea', { class: 'inp', rows: 2, placeholder: 'Идея, договорённость, что не забыть…', maxlength: 5000 });
    const addNote = () => {
      if (!noteInp.value.trim()) return noteInp.focus();
      send('addAppNote', { appId: a.id, text: noteInp.value }).then(n => { notes = [n, ...(notes || [])]; draw(); }).catch(showErr);
    };
    noteInp.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addNote(); });
    noteBox = noteInp;
    // блоки карточки — по раскладке человека (порядок и видимость: «⋯» → «Настроить карточку»)
    const parts = {
      props: h('section', { class: 'ap-props' },
        field('Статус', h('div', { class: 'ap-st-chip' }, h('span', { class: 'dot', style: { background: st ? st.color : 'var(--border-strong)' } }), statusSel)), field('Юнит', ceo ? unitSel : h('div', { class: 'ap-static' }, u ? u.name : '—')), field('Приоритет', prioSel)),
      // где приложение сейчас: статус, с какого числа, текущие этапы открытых работ
      now: h('section', null,
        h('div', { class: 'up-head' }, h('h3', null, 'Сейчас')),
        h('div', { class: 'ap-now' },
          h('div', { class: 'ap-now-st' }, statusPill(st), a.statusAt && h('span', { class: 'muted' }, 'с ' + fmtDate(a.statusAt.slice(0, 10))),
            h('span', { class: 'spacer' }), a.lastActivity && h('span', { class: 'muted' }, 'обновлено ' + relTime(a.lastActivity))),
          active.length
            ? active.map(r => {
              const cur = r.stages.find(s => !s.done && !s.blocked) || null;
              const who = personById(cur ? cur.assigneeId : r.assigneeId);
              return h('button', { class: 'ap-now-row', onclick: () => peekTask(r.unitId, cur ? cur.id : r.id) },
                h('span', { class: 'ap-now-what' }, h('b', null, cur ? cur.title.split(' · ')[0] : r.stages.length ? 'Релиз' : 'Ждёт PM'),
                  h('span', { class: 'muted' }, ' · ' + r.title)),
                r.stages.length > 0 && h('span', { class: 'ap-now-bar' },
                  h('span', { class: 'progress' }, h('div', { style: { width: Math.round(r.stages.filter(s => s.done).length / r.stages.length * 100) + '%' } })),
                  h('span', { class: 'muted' }, `${r.stages.filter(s => s.done).length} из ${r.stages.length}`)),
                who ? avatar(who, 'sm') : h('span', { class: 'avatar-gap' }));
            })
            : h('p', { class: 'muted', style: { margin: 0 } }, 'Открытых работ нет'))),
      info: infoBlock(a, manage, ceo, save, draw, () => configure('info')),
      quick: quickBlock(a, manage, ceo, save, fromStore, draw, () => configure('quick')),
      tasks: h('section', null,
        h('div', { class: 'up-head' }, h('h3', null, 'Задачи'),
          ceo && h('button', { class: 'btn ghost sm', onclick: () => openTaskPool(a, refresh) }, icon('plus', 14), 'Поставить задачи')),
        open.length ? open.map(taskLine) : h('p', { class: 'muted' }, 'Задач по приложению нет'),
        closed.length > 0 && h('div', { class: 'ap-closed' }, closed.map(r => h('button', { class: 'ap-done-row', onclick: () => peekTask(r.unitId, r.id) },
          icon('check', 14), h('span', { class: 'ap-done-title' }, r.title))))),
      updates: h('section', null,
        h('div', { class: 'up-head' }, h('h3', null, 'Апдейты', updates.length > 0 && h('span', { class: 'muted sec-n' }, updates.length)),
          ceo && h('button', { class: 'btn ghost sm', onclick: () => openCreateRequest(a, 'update', refresh) }, icon('plus', 14), 'Апдейт')),
        updates.length ? h('div', { class: 'ap-num-list' }, numbered(updates, 'Апдейт')) : h('p', { class: 'muted' }, 'Апдейтов не было')),
      rejects: h('section', null,
        h('div', { class: 'up-head' }, h('h3', null, 'Реджекты', rejects.length > 0 && h('span', { class: 'muted sec-n' }, rejects.length))),
        rejects.length ? h('div', { class: 'ap-num-list' }, numbered(rejects, 'Реджект')) : h('p', { class: 'muted' }, 'Реджектов не было')),
      notes: h('section', null,
        h('div', { class: 'up-head' }, h('h3', null, 'Заметки')),
        h('div', { class: 'ap-note-add' }, noteInp, h('button', { class: 'btn sm', onclick: addNote }, 'Добавить')),
        notes == null ? h('p', { class: 'muted' }, 'Загрузка…') : notes.map(n => {
          const p = personById(n.authorId);
          return h('div', { class: 'ap-note' },
            avatar(p, 'sm'),
            h('div', { class: 'ap-note-body' }, h('div', { class: 'ap-note-meta muted' }, (p ? p.name : '—') + ' · ' + relTime(n.at)), h('div', { class: 'ap-note-text' }, n.text)),
            (n.authorId === S.meId || ceo) && h('button', {
              class: 'icon-btn sm', title: 'Удалить заметку',
              onclick: () => send('deleteAppNote', { id: n.id }).then(() => { notes = notes.filter(x => x !== n); draw(); }).catch(showErr),
            }, icon('x', 13)));
        })),
    };
    const L = appCardLayout();
    if (page) {
      // на странице «Статус / Юнит / Приоритет» уходят в правую колонку, остальные блоки — по раскладке человека
      fill(body, L.order.filter(id => id !== 'props' && !L.hidden.includes(id)).map(id => parts[id]));
      fill(side, parts.props, appTeam(a), appDates(a));
    } else fill(body, L.order.filter(id => !L.hidden.includes(id)).map(id => parts[id]));
  };
  // «Настроить карточку» — сразу на нужной вкладке (пустые Info и Быстрый доступ открывают свою)
  const configure = (tab = 'blocks') => openCardSettings(a, { ceo: isSuper(), manage: canManage(a.unitId), save, redraw: draw, tab });
  const panel = page ? h('div', { class: 'app-page' }) : h('aside', { class: 'panel unit-panel', role: 'dialog', 'aria-label': a.name });
  // шапка: крупная иконка, своё название, название в сторе и ссылка на App Store
  const storeUrl = (() => { const sf = storeField(); return (sf && a.info && a.info[sf.id]) || ''; })();
  const head = () => h('div', { class: 'panel-head app-panel-head' },
    appIcon(a, 'lg'),
    h('div', { class: 'aph-names' },
      h('div', { class: 'aph-title' }, h('h2', null, a.name), a.isTest && h('span', { class: 'test-tag' }, 'тест')),
      a.storeName && h('span', { class: 'muted aph-store', title: 'Название в App Store' }, a.storeName),
      storeUrl && h('a', { class: 'aph-link', href: storeUrl, target: '_blank', rel: 'noopener' },
        h('img', { src: appStoreSvg, alt: '', width: 16, height: 16 }), 'Открыть в App Store', icon('arrowUpRight', 13))),
    h('span', { class: 'spacer' }),
    h('button', { class: 'icon-btn', title: 'Действия', 'aria-haspopup': 'menu', onclick: e => { e.stopPropagation(); menu(e.currentTarget, actions()); } }, icon('more', 18)),
    !page && h('button', { class: 'icon-btn', title: 'Закрыть', onclick: close }, icon('x', 18)));
  // быстрые действия карточки — в одном меню, чтобы не шуметь кнопками
  const actions = () => {
    const ceo = isSuper();
    return [
      // два режима: на весь экран (по умолчанию) и панель сбоку; переключение — сразу, карточка остаётся открытой
      { label: page ? 'Открывать сбоку' : 'Открывать на весь экран', icon: page ? 'panelSide' : 'panelCenter',
        action: () => { LS.set('appCardMode', page ? 'side' : 'full'); close(); openAppCard(a, onChange); } },
      { label: 'Настроить карточку', icon: 'layers', action: () => configure() },
      canWatch() && { label: isWatched('app', a.id) ? 'Не отслеживать на дашборде' : 'Отслеживать на дашборде', icon: 'eye', action: () => toggleWatch('app', a.id, a.unitId, a.name) },
      ceo && { sep: true },
      ceo && { label: 'Поставить задачи', icon: 'plus', action: () => openTaskPool(a, refresh) },
      ceo && { label: 'Апдейт', icon: 'plus', action: () => openCreateRequest(a, 'update', refresh) },
      ceo && { label: 'Реджект', icon: 'plus', action: () => openCreateRequest(a, 'reject', refresh) },
      { label: 'Заметка', icon: 'edit', action: () => { if (noteBox) { noteBox.scrollIntoView({ block: 'center', behavior: 'smooth' }); noteBox.focus({ preventScroll: true }); } } },
      ceo && { sep: true },
      ceo && { label: 'Удалить приложение', icon: 'trash', danger: true, action: async () => { if (await deleteAppsDlg([a])) { close(); if (onChange) onChange(); } } },
    ];
  };
  const headBox = h('div', null, head());
  const backdrop = h('div', { class: 'panel-backdrop', onclick: close });
  draw();
  loadNotes();
  if (page) {
    // страница (макет 12б): шапка в topbar, ниже блоки слева и правая колонка
    const storeA = storeUrl && h('a', { class: 'btn ghost sm aph-store-btn', href: storeUrl, target: '_blank', rel: 'noopener' }, 'Открыть в App Store', icon('arrowUpRight', 13));
    const more = h('button', { class: 'icon-btn', title: 'Действия', 'aria-haspopup': 'menu', onclick: e => { e.stopPropagation(); menu(e.currentTarget, actions()); } }, icon('more', 18));
    const u0 = unitById(a.unitId);
    fill(page, topbar([appIcon(a, 'lg'), h('div', { class: 'app-title' }, h('span', { class: 'app-crumb muted' }, 'Приложения' + (u0 ? ' / ' + u0.name : '')), h('h1', null, a.name, a.isTest && h('span', { class: 'test-tag' }, 'тест')))], [storeA, more]),
      h('div', { class: 'view-body' }, h('div', { class: 'app-page' }, body, side)));
  } else {
    panel.append(headBox, body);
    fill(root, backdrop, panel);
  }
}

/** «Команда» справа на странице — та же, что в карточке релиза: PM, дизайн, разработка, тестирование, тексты (getReleaseTeam). */
function appTeam(a) {
  const box = h('section', { class: 'app-team' });
  const req = (a.requests || []).find(r => !r.done) || (a.requests || [])[0];
  const stage = req && ((req.stages || []).find(s => /релиз/i.test(s.title)) || null);
  const ROLES = [['pm', 'PM'], ['design', 'Дизайн'], ['ios', 'Разработка'], ['qa', 'Тестирование'], ['meta', 'Тексты ASO']];
  const draw = team => fill(box, h('h3', null, 'Команда'),
    ROLES.map(([k, label]) => {
      const people = ((team && team[k]) || []).map(id => personById(id)).filter(Boolean);
      return h('div', { class: 'app-team-row' }, h('span', { class: 'muted' }, label),
        people.length ? h('b', null, people.map(p => p.name).join(', ')) : h('span', { class: 'muted' }, 'Не назначен'));
    }));
  draw(null);
  if (req) call('getReleaseTeam', { taskId: stage ? stage.id : req.id }).then(draw).catch(() => {});
  return box;
}
/** Создана / обновлена — внизу правой колонки. */
function appDates(a) {
  const by = personById(a.createdBy);
  return h('p', { class: 'muted app-dates' },
    a.createdAt && h('span', null, 'Создана ' + fmtDate(String(a.createdAt).slice(0, 10)) + (by ? ' · ' + by.name : '')),
    a.lastActivity && h('span', null, 'Обновлена ' + relTime(a.lastActivity)));
}

/* ---------- раскладка карточки приложения (у каждого своя) ---------- */

const CARD_BLOCKS = [['props', 'Статус, юнит, приоритет'], ['now', 'Сейчас'], ['info', 'Info'], ['quick', 'Быстрый доступ'],
  ['tasks', 'Задачи'], ['updates', 'Апдейты'], ['rejects', 'Реджекты'], ['notes', 'Заметки']];
/** Порядок и скрытые блоки карточки — prefs.appCard; новые блоки встают в конец. */
function appCardLayout() {
  const saved = ((me() || {}).prefs || {}).appCard || {};
  const known = CARD_BLOCKS.map(([id]) => id);
  const order = (saved.order || []).filter(id => known.includes(id));
  known.forEach(id => { if (!order.includes(id)) order.push(id); });
  return { order, hidden: (saved.hidden || []).filter(id => known.includes(id)) };
}
function saveAppCardLayout(L) {
  const p = me();
  if (p) p.prefs = { ...(p.prefs || {}), appCard: L };
  send('setMyPrefs', { personId: S.meId, prefs: { appCard: L } }).catch(showErr);
}
/**
 * «Настроить карточку» (меню «⋯»): вкладки
 *  · Блоки — какие показывать и порядок (только у вас, меняется сразу);
 *  · Быстрый доступ — поля: для всех приложений (CEO) и только у этого (CEO и PM юнита);
 *  · Info — пункты: для всех (CEO) и только у этого. Поля и пункты сохраняются кнопкой «Сохранить».
 */
export function openCardSettings(a, { ceo, manage, save, redraw, tab: start = 'blocks' }) {
  const L = appCardLayout();
  const name = Object.fromEntries(CARD_BLOCKS);
  const fieldsAll = S.appFields.map(x => ({ ...x }));
  const fieldsOwn = (a.ownFields || []).map(x => ({ ...x }));
  const infoAll = S.appInfoItems.map(x => ({ ...x }));
  const infoOwn = ((a.checks || {}).own || []).map(x => ({ ...x }));
  let tab = manage ? start : 'blocks';
  // пришли по «Добавить» из блока — сразу пустая строка для нового пункта / поля (для всех у CEO, иначе — только сюда)
  if (manage && start === 'info') (ceo ? infoAll : infoOwn).push({ id: '', name: '', done: false });
  if (manage && start === 'quick') (ceo ? fieldsAll : fieldsOwn).push({ id: '', name: '', kind: 'link', value: '' });

  // Блоки — сразу
  const blocks = h('div', { class: 'col-edit-list card-layout' });
  const applyBlocks = () => { saveAppCardLayout(L); redraw(); };
  const drawBlocks = () => fill(blocks, L.order.map(id => {
    const on = !L.hidden.includes(id);
    return h('div', { class: 'col-edit-row le-row', dataset: { id } },
      h('span', { class: 'drag', title: 'Перетащите, чтобы изменить порядок' }, icon('grip', 16)),
      h('button', { class: 'menu-item aud-item cl-pick' + (on ? ' on' : ''), role: 'checkbox', 'aria-checked': String(on),
        onclick: () => { L.hidden = on ? [...L.hidden, id] : L.hidden.filter(x => x !== id); drawBlocks(); applyBlocks(); } },
        h('span', { class: 'aud-check' }, on && icon('check', 13)), name[id]));
  }));
  drawBlocks();
  Sortable.create(blocks, { handle: '.drag', animation: 150, forceFallback: true, onEnd: () => { L.order = [...blocks.children].map(el => el.dataset.id); applyBlocks(); } });

  // поля и пункты — редакторы списков (название, для полей ещё тип)
  const fieldEditor = list => listEditor(list, (x, i, draw) => [
    h('input', { class: 'inp', value: x.name, maxlength: 40, placeholder: 'Например, RevenueCat', 'aria-label': 'Название поля', oninput: e => { x.name = e.target.value; } }),
    h('select', { class: 'inp qf-kind', 'aria-label': 'Тип поля', onchange: e => { x.kind = e.target.value; } },
      [['link', 'Ссылка'], ['text', 'Текст']].map(([k, label]) => h('option', { value: k, selected: k === x.kind }, label))),
    h('button', { class: 'icon-btn sm', title: 'Удалить поле (значения сотрутся)', onclick: () => { list.splice(i, 1); draw(); } }, icon('x', 14)),
  ], () => list.push({ id: '', name: '', kind: 'link', value: '' }), 'Поле');
  const itemEditor = list => listEditor(list, (x, i, draw) => [
    h('input', { class: 'inp', value: x.name, maxlength: 120, placeholder: 'Например, Продуктовый апдейт', 'aria-label': 'Пункт', oninput: e => { x.name = e.target.value; } }),
    h('button', { class: 'icon-btn sm', title: 'Удалить пункт (отметки по нему пропадут)', onclick: () => { list.splice(i, 1); draw(); } }, icon('x', 14)),
  ], () => list.push({ id: '', name: '', done: false }), 'Пункт');
  const readOnly = list => h('p', { class: 'muted' }, (list.map(x => x.name).join(', ') || 'Пока нет') + ' · меняет CEO');
  const panes = {
    blocks: [h('p', { class: 'hint' }, 'Какие блоки показывать и в каком порядке — только у вас, во всех карточках приложений.'), blocks],
    quick: [h('h3', { class: 'qf-h' }, 'Для всех приложений'), ceo ? fieldEditor(fieldsAll) : readOnly(fieldsAll),
      h('h3', { class: 'qf-h' }, 'Только у «' + a.name + '»'), fieldEditor(fieldsOwn)],
    info: [h('h3', { class: 'qf-h' }, 'Для всех приложений'), ceo ? itemEditor(infoAll) : readOnly(infoAll),
      h('h3', { class: 'qf-h' }, 'Только у «' + a.name + '»'), itemEditor(infoOwn)],
  };
  const TABS = [['blocks', 'Блоки'], manage && ['quick', 'Быстрый доступ'], manage && ['info', 'Info']].filter(Boolean);
  const seg = h('div', { class: 'seg cs-tabs', role: 'tablist' });
  const body = h('div', { class: 'cs-pane' });
  const show = () => {
    fill(seg, TABS.map(([id, label]) => h('button', { class: tab === id ? 'on' : '', role: 'tab', 'aria-selected': String(tab === id), onclick: () => { tab = id; show(); } }, label)));
    fill(body, panes[tab]);
  };
  show();
  modal({
    title: 'Настроить карточку',
    cls: 'dlg cs-dlg',
    body: [TABS.length > 1 && seg, body],
    footLeft: h('button', { class: 'btn ghost sm', title: 'Блоки — как было по умолчанию', onclick: () => { L.order = CARD_BLOCKS.map(([id]) => id); L.hidden = []; drawBlocks(); applyBlocks(); } }, 'Блоки как было'),
    actions: manage
      ? [{ label: 'Отмена' }, {
        label: 'Сохранить', primary: true,
        action: async close => {
          if (ceo) {
            [S.appFields, S.appInfoItems] = await Promise.all([
              send('saveAppFields', { fields: fieldsAll.filter(x => x.name.trim()) }),
              send('saveAppInfoItems', { items: infoAll.filter(x => x.name.trim()) })]);
          }
          const checks = a.checks || { done: [], own: [] };
          a.ownFields = fieldsOwn.filter(x => x.name.trim());
          a.checks = { ...checks, own: infoOwn.filter(x => x.name.trim()) };
          await save({ ownFields: a.ownFields, checks: a.checks });
          close();
          toast('Карточка настроена');
          redraw();
        },
      }]
      : [{ label: 'Готово' }],
  });
  if (start !== 'blocks') setTimeout(() => { const e = [...body.querySelectorAll('input.inp')].find(x => !x.value); if (e) e.focus(); }, 0);
}

/**
 * Info приложения: пункты-галочки (что у приложения уже есть). Общие пункты (S.appInfoItems) — во всех карточках, отметка у каждого
 * приложения своя; свои пункты — только у этого. Отмечают CEO и PM юнита; состав пунктов — в «Настроить карточку».
 */
function infoBlock(a, manage, ceo, save, redraw, configure) {
  const checks = a.checks || { done: [], own: [] };
  const rows = [
    ...S.appInfoItems.map(x => ({ id: x.id, name: x.name, done: checks.done.includes(x.id), common: true })),
    ...checks.own.map(x => ({ ...x, common: false })),
  ];
  const put = next => { a.checks = next; redraw(); save({ checks: next }); };  // отметка видна сразу, сохранение — следом
  const toggle = r => put(r.common
    ? { ...checks, done: r.done ? checks.done.filter(id => id !== r.id) : [...checks.done, r.id] }
    : { ...checks, own: checks.own.map(x => (x.id === r.id ? { ...x, done: !x.done } : x)) });
  // правка и удаление пункта — иконки справа при наведении: общий пункт — CEO (для всех), свой — CEO и PM юнита
  const saveCommon = items => send('saveAppInfoItems', { items }).then(list => { S.appInfoItems = list; redraw(); }).catch(showErr);
  const rename = async r => {
    const name = await promptDlg(r.common ? 'Пункт Info (для всех приложений)' : 'Пункт Info', 'Название', r.name);
    if (!name || !name.trim() || name.trim() === r.name) return;
    if (r.common) saveCommon(S.appInfoItems.map(x => (x.id === r.id ? { ...x, name: name.trim() } : x)));
    else put({ ...checks, own: checks.own.map(x => (x.id === r.id ? { ...x, name: name.trim() } : x)) });
  };
  const remove = async r => {
    if (r.common) {
      if (await confirmDlg(`Убрать пункт «${r.name}» из Info всех приложений? Отметки по нему пропадут.`, { ok: 'Убрать', danger: true })) saveCommon(S.appInfoItems.filter(x => x.id !== r.id));
    } else put({ ...checks, own: checks.own.filter(x => x.id !== r.id) });
  };
  const done = rows.filter(r => r.done).length;
  return h('section', null,
    h('div', { class: 'up-head' }, h('h3', null, 'Info', rows.length > 0 && h('span', { class: 'muted sec-n' }, `${done} из ${rows.length}`)),
      manage && h('button', { class: 'btn ghost sm', onclick: configure }, icon('plus', 14), 'Пункт')),
    rows.length
      ? h('div', { class: 'info-list' }, rows.map(r => h('div', { class: 'info-row' + (r.done ? ' on' : '') },
        h('button', { class: 'info-check', role: 'checkbox', 'aria-checked': String(r.done), disabled: !manage, onclick: () => toggle(r), title: r.common ? 'Пункт для всех приложений' : 'Пункт только этого приложения' },
          h('span', { class: 'aud-check' }, r.done && icon('check', 13)), h('span', { class: 'info-name' }, r.name)),
        (r.common ? ceo : manage) ? h('span', { class: 'info-acts' },
          h('button', { class: 'icon-btn sm', title: 'Переименовать' + (r.common ? ' (для всех)' : ''), onclick: () => rename(r) }, icon('edit', 13)),
          h('button', { class: 'icon-btn sm danger-ic', title: r.common ? 'Убрать из всех приложений' : 'Удалить пункт', onclick: () => remove(r) }, icon('trash', 13)))
          : h('span'))))
      : h('p', { class: 'muted', style: { margin: 0 } }, 'Пунктов пока нет — добавьте чек-лист: что нужно сделать в этом приложении.'));
}

/** «Поставить задачи» пачкой: несколько строк — каждая уходит PM юнита отдельной задачей. */
function openTaskPool(a, onDone) {
  const rows = h('div', { class: 'pool-rows' });
  const addRow = (focus = true) => {
    const inp = h('input', { class: 'inp', maxlength: 500, placeholder: 'Задача ' + (rows.children.length + 1) });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addRow(); } });
    rows.append(inp);
    if (focus) inp.focus();
  };
  [0, 1, 2].forEach(() => addRow(false));
  const type = h('select', { class: 'inp' }, [['other', 'Задача'], ['update', 'Апдейт']].map(([v, t]) => h('option', { value: v }, t)));
  const pm = pmPicker(a.unitId);
  const due = h('input', { class: 'inp', type: 'date' });
  const prio = prioPicker(a.priority);
  modal({
    title: 'Задачи · ' + a.name,
    body: [h('p', { class: 'hint', style: { marginTop: 0 } }, 'Каждая строка — отдельная задача PM. Enter — ещё строка.'), rows,
      h('button', { class: 'btn sm', style: { marginTop: '6px' }, onclick: () => addRow() }, icon('plus', 13), 'Строка'),
      h('div', { class: 'grid2', style: { marginTop: '14px' } }, field('Тип', type), field('PM', pm.el, pm.hint)),
      h('div', { class: 'grid2' }, field('Срок', due), field('Приоритет', prio))],
    actions: [{ label: 'Отмена' }, {
      label: 'Поставить', primary: true,
      action: async close => {
        const titles = [...rows.querySelectorAll('input')].map(i => i.value.trim()).filter(Boolean);
        if (!titles.length) return rows.querySelector('input').focus();
        for (const title of titles) {
          await send('createRequest', { appId: a.id, type: type.value, title, pmId: pm.el.value, dueDate: due.value, priority: prio.value });
        }
        close();
        toast(`${titles.length} ${plural(titles.length, ['задача ушла', 'задачи ушли', 'задач ушло'])} PM`);
        if (onDone) onDone();
      },
    }],
  });
  rows.querySelector('input').focus();
}

/** Поле быстрого доступа: значение (ссылка открывается в новой вкладке) и правка на месте для CEO и PM юнита. */
/**
 * «Быстрый доступ»: общие поля (S.appFields) и свои поля приложения (ownFields). Состав полей — в «Настроить карточку»:
 * общие правит CEO, свои — CEO и PM юнита. В самой карточке — значения: клик по строке — правка, справа — скопировать.
 */
function quickBlock(a, manage, ceo, save, fromStore, redraw, configure) {
  const own = a.ownFields || [];
  if (!S.appFields.length && !own.length && !manage) return null;
  const putOwn = next => { a.ownFields = next; redraw(); save({ ownFields: next }); };
  return h('section', null,
    h('div', { class: 'up-head' }, h('h3', null, 'Быстрый доступ'),
      manage && (S.appFields.length > 0 || own.length > 0) && h('button', { class: 'btn ghost sm', onclick: configure }, icon('plus', 14), 'Поле')),
    S.appFields.length || own.length
      ? h('div', { class: 'af-list' },
        S.appFields.map(f => infoRow(a, f, manage, v => (f === storeField() && v ? fromStore(v, { info: { [f.id]: v } }) : save({ info: { [f.id]: v } })))),
        own.map(f => infoRow(a, f, manage, v => putOwn(own.map(x => (x.id === f.id ? { ...x, value: v } : x))), { value: f.value })))
      : h('div', { class: 'card-empty' },
        h('span', { class: 'muted' }, 'Ссылки под рукой: App Store, Figma, Google Drive…'),
        manage && h('button', { class: 'btn sm', onclick: configure }, icon('plus', 14), 'Добавить поля')));
}

/** Строка «Быстрого доступа»: ссылка открывается, клик по строке — правка на месте, справа — скопировать значение. */
function infoRow(a, f, editable, onSave, { value } = {}) {
  const v = value !== undefined ? value : a.info[f.id] || '';
  const row = h('div', { class: 'af-row' + (editable ? ' editable' : '') });
  const copy = e => {
    e.stopPropagation();
    (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject())
      .then(() => toast(`${f.name}: скопировано`), () => toast(v));
  };
  const show = () => {
    fill(row,
      h('span', { class: 'af-ic' }, brandIcon(brandOf(f.name, f.id, v), 15, fieldIcon(f))),
      h('span', { class: 'af-name' }, f.name),
      v ? (f.kind === 'link' ? h('a', { class: 'af-val', href: v, target: '_blank', rel: 'noopener', title: v, onclick: e => e.stopPropagation() }, v.replace(/^https?:\/\//, ''))
        : h('span', { class: 'af-val' }, v)) : h('span', { class: 'af-val muted' }, editable ? (f.kind === 'link' ? 'Добавить ссылку' : 'Добавить') : '—'),
      h('span', { class: 'af-acts' },
        v && h('button', { class: 'icon-btn sm', title: 'Скопировать', 'aria-label': 'Скопировать ' + f.name, onclick: copy }, icon('copy', 13))));
    row.onclick = editable ? edit : null;
    row.title = editable ? 'Нажмите, чтобы изменить' : '';
  };
  const edit = () => {
    const inp = h('input', {
      class: 'inp sm', value: v, placeholder: f.kind === 'link' ? 'https://…' : '', maxlength: f.kind === 'link' ? 2000 : 500,
      onkeydown: e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { e.stopPropagation(); show(); } },
      onblur: e => { if (e.target.value.trim() !== v) onSave(e.target.value.trim()); else show(); },
    });
    row.onclick = null;
    row.title = '';
    fill(row, h('span', { class: 'af-ic' }, brandIcon(brandOf(f.name, f.id, v), 15, fieldIcon(f))), h('span', { class: 'af-name' }, f.name), inp);
    inp.focus();
  };
  show();
  return row;
}

/**
 * PM: разложить запрос по флоу юнита — окно предпросмотра: какие этапы оставить, исполнитель и срок каждого,
 * свой этап (после какого). req: { id, unitId, type, title, dueDate }. Возвращает true, если этапы созданы.
 */
export async function openDecomposeDialog(req) {
  let flow;
  try { flow = (await call('getFlows', { unitId: req.unitId }))[req.type] || []; } catch (e) { showErr(e); return false; }
  const u = unitById(req.unitId);
  const team = ((u && u.members) || []).map(personById).filter(p => p && p.active);
  // запрос из шаблона апдейта — отмечены только его этапы (остальные можно включить)
  const only = req.flowSteps || [];
  const steps = flow.map(st => ({ ...st, on: !only.length || only.includes(st.key), assigneeId: st.release ? '' : suggest(st.positionId), dueDate: req.dueDate || '' }));
  function suggest(positionId) {
    const withPos = team.filter(p => (p.positionIds || []).includes(positionId));
    return (withPos.find(p => p.access === 'lead') || withPos[0] || {}).id || '';
  }
  const body = h('div', { class: 'dc-list' });
  const deptName = id => (S.departments.find(d => d.id === id) || {}).name || '—';
  const active = () => steps.filter(s => s.on);
  const syncGo = () => {
    const go = body.closest('.modal')?.querySelector('.modal-foot .btn.primary');
    if (go) { const n = active().length; go.textContent = `Разложить на ${n} ${plural(n, ['этап', 'этапа', 'этапов'])}`; }
  };
  // выбор из меню вместо системного списка: подпись, галочка у текущего
  const pickBtn = (cls, content, items) => h('button', { class: cls, type: 'button', 'aria-haspopup': 'menu', onclick: e => { e.stopPropagation(); menu(e.currentTarget, items(), { cls: 'dc-menu', align: 'left' }); } }, content, icon('chevron', 14));
  const whoPick = st => {
    const fit = team.filter(p => (p.positionIds || []).includes(st.positionId));
    const row = p => ({ label: p.name + (p.access === 'lead' ? ' · лид' : ''), icon: p.id === st.assigneeId ? 'check' : null, action: () => { st.assigneeId = p.id; draw(); } });
    const cur = personById(st.assigneeId);
    return pickBtn('dc-pick', [cur ? avatar(cur, 'sm') : h('span', { class: 'dc-noone' }), h('span', { class: 'dc-pick-name' + (cur ? '' : ' muted') }, cur ? cur.name : 'Исполнитель')], () => [
      { label: 'Без исполнителя', icon: st.assigneeId ? null : 'check', action: () => { st.assigneeId = ''; draw(); } },
      fit.length > 0 && { title: deptName(st.positionId) }, ...fit.map(row),
      !fit.length && h('p', { class: 'muted', style: { padding: '4px 10px', margin: 0 } }, 'В юните нет людей этой позиции')]);
  };
  const datePick = st => {
    const inp = h('input', { type: 'date', value: st.dueDate, disabled: !st.on, 'aria-label': 'Срок', onchange: e => { st.dueDate = e.target.value; draw(); } });
    return h('label', { class: 'dc-date', onclick: () => { try { inp.showPicker(); } catch { /* браузер откроет сам */ } } }, icon('calendar', 14), h('span', null, st.dueDate ? fmtDate(st.dueDate) : 'Срок'), inp);
  };
  const customMeta = st => h('div', { class: 'dc-own' },
    pickBtn('dc-mini', deptName(st.positionId), () => S.departments.filter(d => !d.archived).map(d => ({
      label: d.name, icon: d.id === st.positionId ? 'check' : null,
      action: () => { st.positionId = d.id; st.assigneeId = suggest(d.id); draw(); },
    }))),
    pickBtn('dc-mini', st.dependsOn[0] ? 'После «' + ((steps.find(s => s.key === st.dependsOn[0]) || {}).title || '') + '»' : 'Сразу, параллельно', () => [
      { label: 'Сразу, параллельно', icon: st.dependsOn.length ? null : 'check', action: () => { st.dependsOn = []; draw(); } },
      ...steps.filter(s => s.on && !s.release && s.key !== st.key).map(s => ({
        label: 'После «' + s.title + '»', icon: st.dependsOn[0] === s.key ? 'check' : null, action: () => { st.dependsOn = [s.key]; draw(); },
      }))]));
  const draw = () => {
    const on = active();
    const titleOf = k => (steps.find(s => s.key === k) || {}).title;
    fill(body, steps.map(st => {
      const deps = st.dependsOn.filter(k => on.some(s => s.key === k)).map(titleOf);
      return h('div', { class: 'dc-row' + (st.on ? '' : ' off') + (st.custom ? ' own' : '') },
        h('label', { class: 'dc-on', title: st.on ? 'Убрать этап' : 'Вернуть этап' }, h('input', { type: 'checkbox', checked: st.on, 'aria-label': 'Этап «' + st.title + '»', onchange: e => { st.on = e.target.checked; draw(); } })),
        h('div', { class: 'dc-main' },
          h('input', { class: 'dc-title' + (st.custom ? ' inp' : ''), value: st.title, maxlength: 120, disabled: !st.on, placeholder: 'Название этапа', 'aria-label': 'Название этапа', oninput: e => { st.title = e.target.value; }, onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); } } }),
          st.custom ? customMeta(st) : h('span', { class: 'dc-meta muted', title: deps.join(', ') }, deptName(st.positionId), st.release ? ' · последним' : deps.length ? ' · после: ' + deps.join(', ') : ' · сразу')),
        st.release ? h('span', { class: 'dc-rm muted' }, 'RM, после передачи в релиз') : whoPick(st),
        datePick(st));
    }));
    syncGo();
  };
  draw();
  // свой этап — строкой в этом же окне: встаёт перед релизом, релиз ждёт и его
  const addStep = () => {
    const positionId = (S.departments.find(d => !d.archived) || {}).id || '';
    const st = { key: 'x' + Date.now().toString(36), title: '', positionId, dependsOn: [], release: false, custom: true, on: true, assigneeId: suggest(positionId), dueDate: req.dueDate || '' };
    const ri = steps.findIndex(s => s.release);
    if (ri >= 0) { steps.splice(ri, 0, st); steps[ri + 1].dependsOn = [...steps[ri + 1].dependsOn, st.key]; } else steps.push(st);
    draw();
    const own = [...body.querySelectorAll('.dc-row.own .dc-title')].pop();
    if (own) own.focus();
  };
  return new Promise(resolve => {
    let done = false;
    modal({
      title: 'Разложить по этапам · ' + (req.appName || req.title),
      wide: true,
      body: [h('p', { class: 'hint', style: { marginTop: 0 } }, `Флоу юнита ${u ? u.name : ''}. Уберите лишнее, назначьте исполнителей и сроки. Следующий этап ждёт, пока не закроют предыдущие.`), body],
      footLeft: h('button', { class: 'btn soft', onclick: addStep }, icon('plus', 14), 'Свой этап'),
      actions: [{ label: 'Отмена' }, {
        label: 'Разложить', primary: true,
        action: async close => {
          const on = steps.filter(s => s.on);
          if (!on.length) return toast('Оставьте хотя бы один этап', { type: 'error' });
          const unnamed = on.find(s => s.custom && !s.title.trim());
          if (unnamed) { [...body.querySelectorAll('.dc-row.own .dc-title')].find(i => !i.value.trim())?.focus(); return toast('Назовите свой этап', { type: 'error' }); }
          const keys = new Set(on.map(s => s.key));
          const plan = on.map(s => ({ key: s.key, title: s.title.trim() || 'Этап', positionId: s.positionId, dependsOn: s.dependsOn.filter(k => keys.has(k)), release: s.release, checklist: s.checklist, assigneeId: s.assigneeId, dueDate: s.dueDate }));
          const made = await send('decomposeRequest', { taskId: req.id, plan });
          done = true;
          close();
          toast(`Создано ${made.length} ${plural(made.length, ['этап', 'этапа', 'этапов'])}`);
        },
      }],
      onClose: () => resolve(done),
    });
    body.closest('.modal')?.classList.add('dc-modal');
    syncGo();
  });
}

/** PM: передать этап «Релиз» релиз-менеджеру юнита (когда закрыты все этапы). */
export async function sendRelease(stageId) {
  try {
    const t = await send('sendToRelease', { taskId: stageId });
    toast('Передано в релиз: ' + ((personById(t.assigneeId) || {}).name || 'RM'));
  } catch (e) { showErr(e); }
}

/* ---------- создание ---------- */

/** Выбор PM юнита: по умолчанию — первый PM; пусто — предупреждение (запрос повиснет без исполнителя). */
function pmPicker(unitId) {
  const sel = h('select', { class: 'inp', 'aria-label': 'PM' });
  const hint = document.createTextNode('');
  const draw = id => {
    const pms = pmsOf(id);
    const u = unitById(id);
    hint.textContent = !u ? '' : pms.length > 1 ? `PM юнита «${u.name}»: задача уйдёт выбранному.` : pms.length ? `PM юнита «${u.name}» — задача уйдёт ему.` : '';
    fill(sel, pms.length ? pms.map(p => h('option', { value: p.id }, p.name)) : h('option', { value: '' }, 'Нет PM — добавьте в «Команде»'));
  };
  draw(unitId);
  return { el: sel, hint, setUnit: draw };
}

/** Приоритет: от высокого к низкому, «—» — без приоритета. */
const prioPicker = value => prioSelect(S.priorityOptions, value);

/** unitId — сразу в этот юнит (со страницы юнита). */
export function openCreateApp(onDone, unitId) {
  const list = unitId ? units().filter(u => u.id === unitId) : units();
  const name = h('input', { class: 'inp title-field', maxlength: 120, placeholder: 'Например, Sleep Sounds' });
  // ссылка на App Store (если приложение уже в сторе) — подтягивает название и иконку
  let iconUrl = '', storeName = '';
  const preview = h('span', { class: 'store-preview' });
  const store = h('input', { class: 'inp', type: 'url', placeholder: 'Если приложение уже в сторе' });
  const pull = async () => {
    const info = await storeLookup(store.value);
    if (!info) { fill(preview); iconUrl = ''; return; }
    iconUrl = info.iconUrl;
    storeName = info.name;
    if (info.name && !name.value.trim()) name.value = info.name;
    fill(preview, info.iconUrl && h('img', { class: 'uc-icon app-img sm', src: info.iconUrl, alt: '' }), h('span', { class: 'muted' }, 'из App Store'));
  };
  store.addEventListener('change', pull);
  store.addEventListener('paste', () => setTimeout(pull, 0));
  const unit = h('select', { class: 'inp' }, list.map(u => h('option', { value: u.id }, u.name)));
  const pm = pmPicker(list[0] && list[0].id);
  unit.addEventListener('change', () => pm.setUnit(unit.value));
  const due = h('input', { class: 'inp', type: 'date' });
  const prio = prioPicker('');
  const desc = h('textarea', { class: 'inp', rows: 3, placeholder: 'Что за приложение, рынки, важное для команды' });
  modal({
    title: 'Новое приложение',
    body: [
      // порядок как в макете 35: название, юнит и PM, срок и приоритет, ссылка в стор, описание
      field('Название', name),
      h('div', { class: 'grid2' }, field('Юнит', unit), field('PM', pm.el, pm.hint)),
      h('div', { class: 'grid2' }, field('Срок', due), field('Приоритет', prio)),
      field('Ссылка в App Store', store, preview),
      field('Описание', desc),
    ],
    actions: [{ label: 'Отмена' }, {
      label: 'Создать', primary: true,
      action: async close => {
        if (!name.value.trim()) { name.focus(); return; }
        await send('createApp', { name: name.value, unitId: unit.value, pmId: pm.el.value, dueDate: due.value, priority: prio.value, description: desc.value, storeUrl: store.value.trim(), iconUrl, storeName });
        close();
        toast(`«${name.value.trim()}» создано — задача ушла PM`);
        if (onDone) onDone();
      },
    }],
  });
}

/** Удалить приложения с подтверждением; задачи приложений удаляются вместе с ними. true — удалено. */
export async function deleteAppsDlg(list) {
  const n = list.length;
  const what = n === 1 ? `«${list[0].name}»` : `${n} ${plural(n, ['приложение', 'приложения', 'приложений'])}`;
  const ok = await confirmDlg(`Удалить ${what}? Задачи ${n === 1 ? 'приложения' : 'этих приложений'} (запросы, этапы, реджекты) удалятся вместе с ${n === 1 ? 'ним' : 'ними'}. Отменить нельзя.`,
    { ok: 'Удалить', danger: true, title: n === 1 ? 'Удалить приложение' : 'Удалить приложения' });
  if (!ok) return false;
  try {
    const r = await send('deleteApps', { ids: list.map(a => a.id) });
    toast(`Удалено: ${r.apps} ${plural(r.apps, ['приложение', 'приложения', 'приложений'])}` + (r.tasks ? ` и ${r.tasks} ${plural(r.tasks, ['задача', 'задачи', 'задач'])}` : ''));
    return true;
  } catch (e) { showErr(e); return false; }
}

/* ---------- проверка App Store ---------- */

/** Ссылка на стор у приложения (поле «App Store»). */
export const appStoreUrl = a => { const sf = storeField(); return (sf && a.info && a.info[sf.id]) || ''; };
/**
 * Есть ли приложение в App Store: iTunes Lookup по id, сначала страна из ссылки, потом крупные витрины
 * (приложение может продаваться не везде). { ok, name, iconUrl } или null — сеть не ответила, итог неизвестен.
 */
async function storeCheck(url) {
  const id = (/id(\d{5,})/.exec(url || '') || [])[1];
  if (!id) return { ok: false };
  const own = ((/apple\.com\/([a-z]{2})\//i.exec(url) || [])[1] || '').toLowerCase();
  for (const c of [...new Set([own || 'us', 'us', 'gb', 'de', 'ru', 'fr', 'jp', 'br'])]) {
    try {
      const j = await (await fetch(`https://itunes.apple.com/lookup?id=${id}&country=${c}`)).json();
      const x = j.results && j.results[0];
      if (x) return { ok: true, name: x.trackName || '', iconUrl: x.artworkUrl512 || x.artworkUrl100 || '' };
    } catch { return null; }
  }
  return { ok: false };
}
/** Проверить все приложения со ссылкой на стор и сохранить итог. onStep(done, total). */
export async function runStoreCheck(apps, onStep) {
  const list = apps.filter(a => appStoreUrl(a));
  const items = [];
  let done = 0;
  for (let i = 0; i < list.length; i += 6) {
    await Promise.all(list.slice(i, i + 6).map(async a => {
      const r = await storeCheck(appStoreUrl(a));
      if (r) items.push({ id: a.id, ok: r.ok, storeName: r.name, iconUrl: r.iconUrl });
      onStep(++done, list.length);
    }));
  }
  if (items.length) await send('saveStoreCheck', { items });
  return { total: list.length, gone: items.filter(x => !x.ok).length, failed: list.length - items.length };
}
/**
 * Блок «Проверка App Store»: когда проверяли, сколько открывается, «Обновить»; ниже — приложения, которых нет в сторе
 * (возможно, удалены или сняты с продажи). Страница «Приложения» и дашборд CEO.
 */
export function storeCheckBlock(apps, reload, { compact = false } = {}) {
  const withLink = apps.filter(a => appStoreUrl(a));
  const gone = withLink.filter(a => a.storeOk === false);
  const last = withLink.map(a => a.storeCheckedAt).filter(Boolean).sort().pop() || '';
  const unchecked = withLink.filter(a => a.storeOk == null).length;
  const status = h('span', { class: 'muted sc-sub' },
    !withLink.length ? 'Нет приложений со ссылкой на App Store'
      : last ? `проверено ${relTime(last)} · открываются ${withLink.length - gone.length - unchecked} из ${withLink.length}` + (unchecked ? ` · не проверено ${unchecked}` : '')
        : `${withLink.length} ${plural(withLink.length, ['приложение', 'приложения', 'приложений'])} со ссылкой — ещё не проверяли`);
  const btn = h('button', { class: 'btn sm', disabled: !withLink.length || !seesApps(), onclick: async () => {
    btn.disabled = true;
    try {
      const r = await runStoreCheck(withLink, (d, t) => { fill(btn, h('span', { class: 'spinner' }), `Проверяю ${d}/${t}…`); });
      toast(r.gone ? `Нет в App Store: ${r.gone}` : 'Все приложения открываются в App Store' + (r.failed ? ` · не удалось проверить ${r.failed}` : ''), r.gone ? { type: 'error' } : {});
      reload();
    } catch (e) { showErr(e); btn.disabled = false; }
  } }, 'Обновить');
  // дашборд: заголовок секции как у соседних блоков (с «Обновить»), в карточке — итог; пропавшие — выпадающим списком по красной кнопке
  if (compact) {
    const box = h('div', { class: 'store-check compact' + (gone.length ? ' has-gone' : '') });
    const draw = () => {
      const open = gone.length > 0 && LS.get('storeGoneOpenHome', false);
      fill(box,
        h('div', { class: 'sc-head' },
          h('span', { class: 'sc-ic' }, icon('app', 20)),
          h('span', { class: 'sc-title' }, h('b', null, 'Проверка App Store'), status),
          h('span', { class: 'spacer' }),
          gone.length > 0 && h('button', { class: 'sc-gone-chip' + (open ? ' open' : ''), 'aria-expanded': String(open), onclick: () => { LS.set('storeGoneOpenHome', !open); draw(); } },
            icon('alert', 14), 'Нет в App Store: ' + gone.length, h('span', { class: 'sc-chip-chev' }, icon('chevron', 13))),
          btn),
        open && h('div', { class: 'sc-gone' }, goneRows(gone, reload)));
    };
    draw();
    return h('section', { class: 'sc-section' }, box);
  }
  return h('section', { class: 'store-check' + (gone.length ? ' has-gone' : '') },
    h('div', { class: 'sc-head' },
      h('img', { src: appStoreSvg, alt: '', width: 22, height: 22 }),
      h('span', { class: 'sc-title' }, h('b', null, 'Проверка App Store'), status),
      h('span', { class: 'spacer' }), btn),
    gone.length > 0 && goneList(gone, reload));
}

/** Строки пропавших из стора: приложение (клик — карточка), юнит, ссылка для ручной проверки. */
const goneRows = (gone, reload) => gone.map(a => h('div', { class: 'sc-row' },
  h('button', { class: 'sc-app', onclick: () => openAppCard(a, reload) }, appIcon(a, 'sm'),
    h('span', { class: 'ap-names' }, h('b', null, a.name), a.storeName && h('small', { class: 'muted' }, a.storeName))),
  h('span', { class: 'muted sc-unit' }, (unitById(a.unitId) || {}).name || ''),
  h('a', { class: 'btn ghost sm', href: appStoreUrl(a), target: '_blank', rel: 'noopener', title: 'Проверить ссылку вручную' }, 'Открыть ссылку', icon('arrowUpRight', 13))));

/** «Требует внимания» в проверке App Store — сворачивается заголовком, состояние запоминается. */
function goneList(gone, reload) {
  const box = h('div', { class: 'sc-gone' });
  const draw = () => {
    const open = !LS.get('storeGoneCollapsed', false);
    box.classList.toggle('collapsed', !open);
    fill(box,
      h('button', { class: 'sc-gone-head', 'aria-expanded': String(open), onclick: () => { LS.set('storeGoneCollapsed', open); draw(); } },
        h('span', { class: 'ap-chev' }, icon('chevron', 14)), icon('alert', 14), h('b', null, 'Требует внимания · ' + gone.length),
        h('span', { class: 'muted' }, 'страница в сторе не открывается — возможно, удалено или снято с продажи')),
      open && goneRows(gone, reload));
  };
  draw();
  return box;
}

/**
 * Дозаполнить название в App Store и иконку у приложений со ссылкой на стор (добавленных раньше, без них).
 * CEO и PM сохраняют в базу, остальным — только на экране. Не найденные в сторе за сессию повторно не ищем.
 */
const storeMiss = new Set();
async function fillFromStore(apps, redraw) {
  const sf = storeField();
  if (!sf) return;
  const todo = apps.filter(a => a.info && a.info[sf.id] && (!a.storeName || !a.iconUrl) && !storeMiss.has(a.id));
  for (let i = 0; i < todo.length; i += 6) {
    await Promise.all(todo.slice(i, i + 6).map(async a => {
      const x = await storeLookup(a.info[sf.id]);
      if (!x) { storeMiss.add(a.id); return; }
      const patch = {};
      if (!a.storeName && x.name) patch.storeName = x.name;
      if (!a.iconUrl && x.iconUrl) patch.iconUrl = x.iconUrl;
      if (!Object.keys(patch).length) { storeMiss.add(a.id); return; }
      Object.assign(a, patch);
      if (isStaff()) await send('updateApp', { id: a.id, ...patch }).catch(() => storeMiss.add(a.id));
    }));
    redraw();
  }
}

/** id приложения в App Store из ссылки (…/id123456789). */
const storeId = url => (/id(\d{5,})/.exec(url || '') || [])[1] || '';

/**
 * «Добавить списком» — уже существующие приложения: строка = название и ссылка на App Store (как копируется из таблицы).
 * Иконка — из стора, название — ваше; статус по умолчанию «В сторе», запроса PM не создаётся. Уже добавленные (та же ссылка) пропускаются.
 */
export function openImportApps(onDone, unitId) {
  const list = units();
  const text = h('textarea', { class: 'inp mono', rows: 10, placeholder: 'PDF Converter v5\thttps://apps.apple.com/app/id6670748953\nCall Recorder v6\thttps://apps.apple.com/app/id6578445681' });
  const unit = h('select', { class: 'inp' }, list.map(u => h('option', { value: u.id, selected: u.id === unitId }, u.name)));
  const live = S.appStatuses.find(x => x.kind === 'live');
  const status = h('select', { class: 'inp' }, S.appStatuses.map(st => h('option', { value: st.id, selected: live && st.id === live.id }, st.name)));
  const sf = storeField();
  const known = new Set(S.apps.map(a => storeId(sf && a.info && a.info[sf.id])).filter(Boolean));
  const summary = h('span');
  const parse = () => text.value.split('\n').map(l => {
    const url = (/https?:\/\/\S+/.exec(l) || [''])[0];
    return { name: l.replace(url, '').replace(/\s+/g, ' ').trim(), url };
  }).filter(x => x.name);
  const count = () => {
    const rows = parse();
    const dup = rows.filter(x => known.has(storeId(x.url))).length;
    summary.textContent = rows.length ? `${rows.length} ${plural(rows.length, ['приложение', 'приложения', 'приложений'])}` + (dup ? ` · уже есть: ${dup} — пропустим` : '') : 'Строка: название, затем ссылка (через Tab или пробел)';
  };
  text.addEventListener('input', count);
  count();
  modal({
    title: 'Добавить приложения списком',
    wide: true,
    body: [
      field('Приложения', text, summary),
      h('div', { class: 'grid2' }, field('Юнит', unit, 'Потом можно перенести каждое в свой юнит'), field('Статус', status)),
      h('p', { class: 'hint', style: { margin: 0 } }, 'Иконки подтянутся из App Store, ссылка ляжет в поле «App Store». Задачи PM не создаются.'),
    ],
    actions: [{ label: 'Отмена' }, {
      label: 'Добавить', primary: true,
      action: async close => {
        const rows = parse().filter(x => !known.has(storeId(x.url)));
        if (!rows.length) { text.focus(); return; }
        // иконки из стора — параллельно, создание — по порядку списка
        const icons = await Promise.all(rows.map(x => (x.url ? storeLookup(x.url) : null)));
        let done = 0;
        for (const [i, x] of rows.entries()) {
          await send('createApp', { name: x.name, unitId: unit.value, status: status.value, noRequest: true, storeUrl: x.url, iconUrl: (icons[i] && icons[i].iconUrl) || '', storeName: (icons[i] && icons[i].name) || '' });
          done++;
          known.add(storeId(x.url));
        }
        close();
        toast(`Добавлено: ${done} ${plural(done, ['приложение', 'приложения', 'приложений'])}`);
        if (onDone) onDone();
      },
    }],
  });
}

/** «Новая задача» с дашборда CEO: приложение, тип (апдейт / задача) — уходит PM юнита приложения. */
export function openNewAppTask(onDone, unitId) {
  const list = S.apps.filter(a => !a.archived && (!unitId || a.unitId === unitId)).sort((x, y) => x.name.localeCompare(y.name));
  const app = h('select', { class: 'inp' }, list.map(a => h('option', { value: a.id }, a.name)));
  const type = h('select', { class: 'inp' }, [['other', 'Задача'], ['update', 'Апдейт']].map(([v, t]) => h('option', { value: v }, t)));
  const title = h('input', { class: 'inp', maxlength: 500, placeholder: 'Что сделать' });
  const pm = pmPicker(list[0] && list[0].unitId);
  app.addEventListener('change', () => { const a = list.find(x => x.id === app.value); pm.setUnit(a && a.unitId); });
  const due = h('input', { class: 'inp', type: 'date' });
  const prio = prioPicker('');
  const desc = h('textarea', { class: 'inp', rows: 3 });
  modal({
    title: 'Новая задача',
    body: [field('Название', title), h('div', { class: 'grid2' }, field('Приложение', app), field('Тип', type)),
      h('div', { class: 'grid2' }, field('PM', pm.el, pm.hint), field('Срок', due)), field('Приоритет', prio), field('Описание', desc)],
    actions: [{ label: 'Отмена' }, {
      label: 'Поставить', primary: true,
      action: async close => {
        if (!title.value.trim()) { title.focus(); return; }
        await send('createRequest', { appId: app.value, type: type.value, title: title.value, pmId: pm.el.value, dueDate: due.value, priority: prio.value, description: desc.value });
        close();
        toast('Задача ушла PM');
        if (onDone) onDone();
      },
    }],
  });
  title.focus();
}

/** type: update / other; reject — запрос «Реджект: причина» (как от RM), в разделе «Реджекты». */
function openCreateRequest(a, type, onDone) {
  const reject = type === 'reject';
  if (reject) type = 'other';
  const title = h('input', { class: 'inp', maxlength: 480, placeholder: reject ? 'Причина из письма Apple, например Guideline 3.1.2' : type === 'update' ? 'Например, Апдейт 1.2: виджет' : 'Что сделать' });
  const pm = pmPicker(a.unitId);
  const due = h('input', { class: 'inp', type: 'date' });
  const prio = prioPicker(a.priority);
  const desc = h('textarea', { class: 'inp', rows: 3 });
  // апдейт: свой текст или шаблон (название, описание, пункты и нужные этапы)
  let tplId = '';
  const tplInfo = h('div', { class: 'hint tpl-info' });
  const tplSel = type === 'update' && h('select', { class: 'inp', 'aria-label': 'Шаблон апдейта' });
  const paintTpl = () => tplSel && fill(tplSel, h('option', { value: '' }, 'Свой текст'),
    updateTemplates().map(x => h('option', { value: x.id, selected: x.id === tplId }, x.name)),
    isStaff() && h('option', { value: '__edit' }, 'Шаблоны апдейтов…'));
  paintTpl();
  if (tplSel) tplSel.addEventListener('change', () => {
    if (tplSel.value === '__edit') { tplSel.value = tplId; openUpdateTemplates(paintTpl); return; }
    tplId = tplSel.value;
    const x = updateTemplates().find(y => y.id === tplId);
    if (x) { title.value = x.title || title.value; desc.value = x.description || desc.value; }
    fill(tplInfo, x && [
      x.steps.length > 0 && h('div', null, 'Этапы: ' + x.steps.map(k => (STEP_NAMES[k] || k)).join(' → ')),
      x.checklist.length > 0 && h('div', null, 'Пункты: ' + x.checklist.map(i => i.text).join(' · '))]);
  });
  modal({
    title: (reject ? 'Реджект' : REQUEST_TYPES[type] || 'Задача') + ' · ' + a.name,
    body: [tplSel && field('Шаблон', tplSel, tplInfo), field(reject ? 'Причина' : 'Название', title), h('div', { class: 'grid2' }, field('PM', pm.el, pm.hint), field('Срок', due)),
      field('Приоритет', prio, 'Перейдёт этапам, когда PM разложит задачу'), field('Описание', desc)],
    actions: [{ label: 'Отмена' }, {
      label: 'Поставить', primary: true,
      action: async close => {
        if (reject && !title.value.trim()) { title.focus(); return; }
        await send('createRequest', { appId: a.id, type, title: (reject ? 'Реджект: ' : '') + title.value, pmId: pm.el.value, dueDate: due.value, priority: prio.value, description: desc.value, templateId: tplId });
        close();
        toast('Задача ушла PM');
        if (onDone) onDone();
      },
    }],
  });
}

/* ---------- шаблоны апдейтов ---------- */

const STEP_NAMES = { design: 'Дизайн', ios: 'Разработка iOS', qa: 'Тестирование', meta: 'Тексты OB / PW / ASO', retext: 'Тексты в дизайне', l10n: 'Локализации', release: 'Релиз' };
const updateTemplates = () => S.templates.filter(x => x.kind === 'update').sort((x, y) => (x.order || 0) - (y.order || 0));

/** Шаблоны апдейтов (CEO и PM): название, заголовок задачи, описание, пункты и нужные этапы. */
export function openUpdateTemplates(onDone) {
  const items = updateTemplates().map(x => ({ ...x, lines: x.checklist.map(i => i.text).join('\n'), steps: [...x.steps] }));
  const gone = [];
  const box = h('div', { class: 'cl-tpl-list' });
  const draw = () => fill(box,
    items.length ? items.map((x, i) => h('div', { class: 'cl-tpl' },
      h('div', { class: 'row', style: { gap: '8px' } },
        h('input', { class: 'inp', value: x.name, maxlength: 60, placeholder: 'Название шаблона, например «Новый пейволл»', oninput: e => { x.name = e.target.value; } }),
        h('button', { class: 'icon-btn sm', title: 'Удалить шаблон', onclick: () => { if (x.id) gone.push(x.id); items.splice(i, 1); draw(); } }, icon('trash', 14))),
      h('input', { class: 'inp', value: x.title || '', maxlength: 500, placeholder: 'Название задачи, например «Апдейт: новый пейволл»', oninput: e => { x.title = e.target.value; } }),
      h('textarea', { class: 'inp', rows: 2, placeholder: 'Описание (необязательно)', oninput: e => { x.description = e.target.value; } }, x.description || ''),
      h('textarea', { class: 'inp', rows: 3, placeholder: 'Пункты — по одному в строке', oninput: e => { x.lines = e.target.value; } }, x.lines || ''),
      h('div', { class: 'tpl-steps' }, h('span', { class: 'muted' }, 'Этапы:'), Object.entries(STEP_NAMES).map(([k, label]) => {
        const on = !x.steps.length || x.steps.includes(k);
        return h('button', { class: 'menu-item aud-item' + (on ? ' on' : ''), role: 'checkbox', 'aria-checked': String(on), onclick: () => {
          const cur = x.steps.length ? x.steps : Object.keys(STEP_NAMES);
          x.steps = on ? cur.filter(s => s !== k) : [...cur, k];
          if (x.steps.length === Object.keys(STEP_NAMES).length) x.steps = [];
          draw();
        } }, h('span', { class: 'aud-check' }, on && icon('check', 13)), label);
      }))))
      : h('p', { class: 'muted', style: { margin: 0 } }, 'Шаблонов пока нет.'),
    h('button', { class: 'btn sm', onclick: () => { items.push({ id: '', name: '', title: '', description: '', lines: '', steps: [] }); draw(); } }, icon('plus', 13), 'Шаблон'));
  draw();
  modal({
    title: 'Шаблоны апдейтов',
    wide: true,
    body: [h('p', { class: 'hint', style: { margin: '0 0 10px' } }, 'При постановке апдейта — выбрать шаблон или свой текст. Пункты станут чеклистом задачи, при разбивке останутся только отмеченные этапы.'), box],
    actions: [{ label: 'Отмена' }, { label: 'Сохранить', primary: true, action: async close => {
      for (const id of gone) await send('deleteTemplate', { id });
      S.templates = S.templates.filter(x => !gone.includes(x.id));
      for (const x of items.filter(y => y.name.trim())) {
        const saved = await send('saveTemplate', { id: x.id || undefined, kind: 'update', name: x.name.trim(), title: x.title, description: x.description,
          checklist: String(x.lines || '').split('\n').map(t => t.trim()).filter(Boolean).map(text => ({ text })), steps: x.steps });
        const i = S.templates.findIndex(y => y.id === saved.id);
        if (i >= 0) S.templates[i] = saved; else S.templates.push(saved);
      }
      close();
      toast('Шаблоны апдейтов сохранены');
      if (onDone) onDone();
    } }],
  });
}

/* ---------- настройки (CEO) ---------- */

/** Редактор списка: строки с ручкой перетаскивания; row(item, i, redraw) рисует поля строки. */
function listEditor(items, row, onAdd, addLabel) {
  const list = h('div', { class: 'col-edit-list' });
  const el = h('div');
  let sortable = null;
  const draw = () => {
    fill(list, items.map((x, i) => h('div', { class: 'col-edit-row le-row', dataset: { i } },
      h('span', { class: 'drag', title: 'Перетащите, чтобы изменить порядок' }, icon('grip', 16)), row(x, i, draw))));
    if (sortable) sortable.destroy();
    sortable = Sortable.create(list, {
      handle: '.drag', animation: 150, ghostClass: 'sortable-ghost', forceFallback: true, fallbackTolerance: 4,
      onEnd: () => { const next = [...list.children].map(r => items[Number(r.dataset.i)]); items.splice(0, items.length, ...next); draw(); },
    });
  };
  fill(el, list, h('button', { class: 'btn sm', onclick: () => { onAdd(); draw(); const ins = list.querySelectorAll('input.inp'); if (ins.length) ins[ins.length - 1].focus(); } }, icon('plus', 13), addLabel));
  draw();
  return el;
}

/** Статусы приложения: название, цвет, смысл (связь с ходом работ), порядок. Используемый статус удалить нельзя. */
export function openStatusesEditor(onDone) {
  const items = S.appStatuses.map(x => ({ ...x }));
  const used = id => S.apps.filter(a => a.status === id).length;
  const row = (x, i, redraw) => [
    h('button', {
      class: 'swatch', title: 'Цвет', style: { background: x.color },
      onclick: e => { e.stopPropagation(); menu(e.currentTarget, [h('div', { class: 'colors menu-colors' }, PALETTE.map(p => h('button', { class: 'swatch' + (x.color === p ? ' on' : ''), style: { background: p }, onclick: () => { x.color = p; closeMenu(); redraw(); } })))]); },
    }),
    h('input', { class: 'inp', value: x.name, maxlength: 40, placeholder: 'Название', 'aria-label': 'Название статуса', oninput: e => { x.name = e.target.value; } }),
    h('select', { class: 'inp', 'aria-label': 'Смысл статуса', title: 'Для автоматики: «Релиз» ставится, когда PM передаёт в релиз', onchange: e => { x.kind = e.target.value; } },
      Object.entries(STATUS_KINDS).map(([k, label]) => h('option', { value: k, selected: k === x.kind }, label))),
    h('button', {
      class: 'icon-btn sm', title: used(x.id) ? `Используется: ${used(x.id)} ${plural(used(x.id), ['приложение', 'приложения', 'приложений'])}` : 'Удалить',
      disabled: items.length === 1 || used(x.id) > 0, onclick: () => { items.splice(i, 1); redraw(); },
    }, icon('x', 14)),
  ];
  modal({
    title: 'Статусы приложения',
    wide: true,
    body: [h('p', { class: 'hint', style: { marginTop: 0 } }, 'Колонки канбана приложений. Смысл связывает статус с ходом работ — например, «Релиз» ставится сам, когда PM передаёт приложение RM.'),
      listEditor(items, row, () => items.push({ id: '', name: '', color: PALETTE[items.length % PALETTE.length], kind: '' }), 'Статус')],
    actions: [{ label: 'Отмена' }, {
      label: 'Сохранить', primary: true,
      action: async close => {
        S.appStatuses = await send('saveAppStatuses', { statuses: items.filter(x => x.name.trim()) });
        close();
        toast('Статусы сохранены');
        if (onDone) onDone();
      },
    }],
  });
}

/** Поля приложения (быстрый доступ): название, тип — ссылка или текст, порядок. */
export function openFieldsEditor(onDone) {
  const items = S.appFields.map(x => ({ ...x }));
  const row = (x, i, redraw) => [
    h('input', { class: 'inp', value: x.name, maxlength: 40, placeholder: 'Например, RevenueCat', 'aria-label': 'Название поля', oninput: e => { x.name = e.target.value; } }),
    h('select', { class: 'inp', 'aria-label': 'Тип поля', onchange: e => { x.kind = e.target.value; } },
      [['link', 'Ссылка'], ['text', 'Текст']].map(([k, label]) => h('option', { value: k, selected: k === x.kind }, label))),
    h('button', { class: 'icon-btn sm', title: 'Удалить (значения у приложений сотрутся)', onclick: () => { items.splice(i, 1); redraw(); } }, icon('x', 14)),
  ];
  modal({
    title: 'Поля приложения',
    wide: true,
    body: [h('p', { class: 'hint', style: { marginTop: 0 } }, 'Быстрый доступ в карточке приложения и на карточках канбана (какие показывать — каждый выбирает сам: кнопка «Поля»).'),
      listEditor(items, row, () => items.push({ id: '', name: '', kind: 'link' }), 'Поле')],
    actions: [{ label: 'Отмена' }, {
      label: 'Сохранить', primary: true,
      action: async close => {
        S.appFields = await send('saveAppFields', { fields: items.filter(x => x.name.trim()) });
        close();
        toast('Поля сохранены');
        if (onDone) onDone();
      },
    }],
  });
}
