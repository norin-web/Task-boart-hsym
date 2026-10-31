import Sortable from 'sortablejs';
import { S, LS, byOrder, openCount, me, unitById, personById, activeTeams, isStaff, isSuper, ceoMode, isDev, ACCESS_LABELS, seesApps } from '../state.js';
import { $, h, icon, avatar, menu, closeMenu, showErr, fill, confirmDlg, setBell } from '../ui.js';
import { send } from '../api.js';
import { link, navigate, rerender } from '../router.js';
import { openPalette } from './palette.js';
import { unitMenu, openCreateUnit } from './units.js';
import { openActAs, openMyProfile } from './people.js';
import { personCaption } from './my.js';
import { mode, supabase, resetLocalData } from '../data.js';

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

/* ---------- тема ---------- */

const THEMES = { auto: ['Тема: как в системе', 'monitor'], light: ['Тема: светлая', 'sun'], dark: ['Тема: тёмная', 'moon'] };

export function applyTheme(t) {
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

export const THEME_LIST = THEMES;
export function setTheme(t) {
  LS.set('theme', t);
  applyTheme(t);
  renderSidebar();
}
function cycleTheme() {
  const order = Object.keys(THEMES);
  const next = order[(order.indexOf(LS.get('theme', 'auto')) + 1) % order.length];
  LS.set('theme', next);
  applyTheme(next);
  renderSidebar();
}

/* ---------- сайдбар ---------- */

/** Счётчик новых уведомлений — точкой на колокольчике в шапке, обновляется на месте. */
export function renderUnread() {
  document.querySelectorAll('.bell').forEach(b => {
    const dot = b.querySelector('.bell-dot');
    dot.textContent = S.unread > 99 ? '99+' : S.unread || '';
    dot.hidden = !S.unread;
    b.title = S.unread ? 'Новое для вас: ' + S.unread : 'Уведомления';
  });
}

/** Колокольчик справа вверху: подсвечен, когда есть новое; клик — список «Новое для вас». */
function bell() {
  const b = h('button', { class: 'icon-btn bell', 'aria-haspopup': 'menu', onclick: e => { e.stopPropagation(); openBell(b); } },
    icon('bell', 18), h('span', { class: 'bell-dot', hidden: true }));
  queueMicrotask(renderUnread);
  return b;
}
setBell(bell);

async function openBell(anchor) {
  const { loadNotes, newsBlock } = await import('./home.js');
  await loadNotes();
  const block = newsBlock();
  const m = menu(anchor, [block || h('div', { class: 'bell-empty' }, icon('done', 20), h('b', null, 'Новых уведомлений нет'), h('span', { class: 'muted' }, 'Здесь появятся назначения, ревью и упоминания'))], { cls: 'bell-menu' });
  // открыли задачу — список закрываем
  m.addEventListener('click', e => { if (e.target.closest('.news-row')) closeMenu(); }, true);
}

/** Раскрытые юниты в меню слева — запоминаются. */
const openUnits = () => LS.get('navOpen', []) || [];
function toggleUnit(id) {
  const list = openUnits();
  LS.set('navOpen', list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  renderSidebar();
}
/** Команды юнита: те, в которых состоят его участники. */
export const unitTeams = u => {
  const ids = new Set((u.members || []).flatMap(id => (personById(id) || {}).teamIds || []));
  return activeTeams().filter(t => ids.has(t.id));
};

function unitItem(u, r) {
  const n = openCount(u);
  const overdue = u.counts && u.counts.overdue;
  const open = openUnits().includes(u.id) || (r.unit === u.id && !!r.team);
  const teams = unitTeams(u);
  const here = r.unit === u.id && !r.team;
  const sub = (route, label, ic, on, dot) => link(route, { class: 'nav-sub' + (on ? ' active' : '') },
    dot ? h('span', { class: 'unit-dot sm', style: { background: dot } }) : icon(ic, 14), h('span', { class: 'nav-label' }, label));
  return h('div', { class: 'nav-unit' + (open ? ' open' : ''), dataset: { id: u.id } },
    h('div', { class: 'nav-unit-row' },
      link({ unit: u.id, mode: seesApps() ? 'overview' : 'board' }, {
        // клик по юниту — его обзор (отдельного пункта «Обзор» нет)
        class: 'nav-item unit' + (here && (!seesApps() || !['board', 'list'].includes(r.mode)) ? ' active' : '') + (u.archived ? ' archived' : ''),
        dataset: { id: u.id },
        // правый клик — меню юнита
        oncontextmenu: isStaff() ? e => { e.preventDefault(); unitMenu({ x: e.clientX, y: e.clientY }, u); } : null,
      },
      h('span', { class: 'unit-dot', style: { background: u.color } }),
      h('span', { class: 'nav-label' }, u.name),
      h('span', { class: 'nav-count' + (overdue ? ' warn' : ''), title: overdue ? 'Просрочено: ' + overdue : 'Открытых задач' }, n || '')),
      h('button', { class: 'icon-btn sm nav-chev', title: open ? 'Свернуть' : 'Команды юнита', 'aria-expanded': String(open), onclick: () => toggleUnit(u.id) }, icon('chevron', 14))),
    open && h('div', { class: 'nav-subs' },
      // без обзора (сотрудник) юнит и так открывает доску
      seesApps() && sub({ unit: u.id, mode: 'board' }, 'Доска юнита', 'board', here && ['board', 'list'].includes(r.mode)),
      teams.map(t => sub({ unit: u.id, mode: 'board', team: t.id }, t.name, null, r.unit === u.id && r.team === t.id, t.color))));
}


/** Свёрнутый сайдбар (80 px): выбор запоминаем; подпись и счётчик — в подсказке. */
const collapsed = () => LS.get('sbCollapsed', false) === true;
export const applyCollapse = () => document.body.classList.toggle('sb-collapsed', collapsed());
function toggleCollapse() { LS.set('sbCollapsed', !collapsed()); applyCollapse(); renderSidebar(); }

export function renderSidebar() {
  drawSidebar();
  // свёрнутый сайдбар: подпись и счётчик — в подсказке
  document.querySelectorAll('#sidebar .nav-item, #sidebar .nav-sub').forEach(el => {
    if (el.title) return;
    const label = el.querySelector('.nav-label');
    const count = el.querySelector('.nav-count');
    if (label) el.title = label.textContent + (count && count.textContent ? ' · ' + count.textContent : '');
  });
}

function drawSidebar() {
  const r = S.route;
  const units = S.units.filter(u => !u.archived).sort(byOrder);
  const person = me();
  const [themeLabel, themeIcon] = THEMES[LS.get('theme', 'auto')] || THEMES.auto;
  const list = h('div', { class: 'nav-units' }, units.map(u => unitItem(u, r)));
  const staff = isStaff();
  const ceo = isSuper();
  // CEO в режиме Default — без личных досок и списков задач
  const lite = ceoMode() === 'default';
  const lens = S.realMeId && S.meId !== S.realMeId ? person : null;
  const navLink = (route, ic, label, extra) => link(route, { class: 'nav-item' + (isHere(r, route) ? ' active' : '') }, icon(ic), h('span', { class: 'nav-label' }, label), extra);
  const sec = (label, extra) => h('div', { class: 'nav-section' }, h('span', null, label), extra);

  fill($('#sidebar'),
    h('div', { class: 'brand' }, h('div', { class: 'brand-logo' }, icon('check', 16)), h('span', { class: 'brand-name' }, 'Tasks'),
      h('button', { class: 'icon-btn sm sb-toggle', title: collapsed() ? 'Развернуть меню' : 'Свернуть меню', 'aria-label': collapsed() ? 'Развернуть меню' : 'Свернуть меню', onclick: toggleCollapse }, icon(collapsed() ? 'expand' : 'collapse', 16))),
    lens && h('div', { class: 'lens-bar', role: 'status' }, icon('eye', 14),
      h('span', null, 'Как ', h('b', null, lens.name)),
      h('button', { class: 'link-btn', onclick: () => import('./dev.js').then(m => m.viewAs('')) }, 'Вернуться')),
    ceo && h('div', { class: 'ceo-mode' }, h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Режим CEO' },
      [['default', 'Обзор', 'Приложения и приоритеты — без деталей разработки'], ['admin', 'Полный', 'Всё: доски, задачи, настройки юнитов']].map(([m, label, hint]) =>
        h('button', { class: ceoMode() === m ? 'on' : '', role: 'radio', 'aria-checked': String(ceoMode() === m), title: hint, onclick: () => setCeoMode(m) }, label)))),
    h('button', { class: 'search-btn', onclick: openPalette }, icon('search', 15), h('span', null, 'Поиск'), h('kbd', null, isMac ? '⌘K' : 'Ctrl K')),
    sec('Главное'),
    navLink({ view: 'home' }, person && person.access === 'rm' ? 'rocket' : 'home', staff ? 'Дашборд' : person && person.access === 'rm' ? 'Релизы' : 'Мой дашборд'),
    seesApps() && navLink({ view: 'apps' }, 'app', 'Приложения'),
    staff && navLink({ view: 'analytics' }, 'chart', 'Аналитика'),
    !lite && navLink({ view: 'myboard' }, 'board', 'Моя доска'),
    !lite && staff && navLink({ view: 'my' }, 'list', 'Мои задачи'),
    sec(staff ? 'Юниты' : 'Мои юниты', ceo && h('button', { class: 'icon-btn sm', title: 'Новый юнит', onclick: openCreateUnit }, icon('plus', 14))),
    list,
    !units.length && ceo && h('button', { class: 'nav-item', onclick: openCreateUnit }, icon('plus'), h('span', { class: 'nav-label muted' }, 'Новый юнит')),
    !units.length && !ceo && h('div', { class: 'nav-empty' }, 'Пока нет юнитов'),
    h('div', { class: 'nav-spacer' }),
    sec('Другое'),
    isDev() && h('button', {
      class: 'nav-item dev-item' + (isHere(r, { view: 'dev' }) ? ' active' : ''), title: 'Смотреть как, быстрые сценарии, тестовые данные',
      onclick: () => import('./dev.js').then(m => m.openDevPanel()),
    }, icon('code'), h('span', { class: 'nav-label' }, 'Режим разработчика'), h('kbd', null, isMac ? '⌥D' : 'Alt D')),
    h('button', { class: 'nav-item', onclick: cycleTheme, title: 'Переключить тему' }, icon(themeIcon), h('span', { class: 'nav-label' }, themeLabel)),
    h('button', { class: 'nav-item me', onclick: e => meMenu(e.currentTarget), title: 'Аккаунт', 'aria-haspopup': 'menu' },
      avatar(person, 'sm'),
      h('span', { class: 'nav-label me-label' }, h('span', null, person ? person.name : '—'),
        person && h('small', null, (S.session && S.session.user.email) || personCaption(person) || ACCESS_LABELS[person.access])),
      icon('chevron', 14)));

  if (staff && units.length > 1) {
    Sortable.create(list, {
      animation: 150, delay: 150, delayOnTouchOnly: true, handle: '.nav-unit-row',
      onEnd: () => {
        const ids = [...list.children].map(el => el.dataset.id);
        const all = ids.concat(S.units.filter(u => !ids.includes(u.id)).sort(byOrder).map(u => u.id));
        all.forEach((id, i) => { const u = unitById(id); if (u) u.order = i + 1; });
        send('reorderUnits', { ids: all }).catch(showErr);
      },
    });
  }
}

/** Активен ли пункт меню для маршрута (главная — только без юнита и других экранов). */
const isHere = (r, route) => !r.unit && (route.view === 'home' ? !r.view || r.view === 'home' : r.view === route.view);

/** CEO: Default — только приложения; Admin — всё. Сохраняется в профиле (на всех устройствах). */
export async function setCeoMode(m) {
  const p = me();
  if (!p || ceoMode() === m) return;
  p.prefs = { ...(p.prefs || {}), ceoMode: m };
  renderSidebar(); // переключатель отзывается сразу
  // сохраняем до перерисовки: экраны перечитывают людей с сервера и не должны получить старый режим
  try { await send('setMyPrefs', { personId: p.id, prefs: { ceoMode: m } }); } catch (e) { showErr(e); }
  if (m === 'default' && ((S.route.unit && S.route.mode === 'settings') || ['my', 'myboard'].includes(S.route.view))) navigate({ view: 'home' });
  else rerender();
}

/** Меню аккаунта: сверху кто я (клик — профиль), настройки, дальше локальные действия или выход. */
function meMenu(anchor) {
  const p = me();
  const email = (S.session && S.session.user.email) || (p && p.email) || '';
  menu(anchor, [
    p && h('button', { class: 'menu-item me-card', role: 'menuitem', onclick: () => { closeMenu(); openMyProfile(); } },
      avatar(p), h('span', { class: 'me-card-text' }, h('b', null, email || p.name), h('small', { class: 'muted' }, ACCESS_LABELS[p.access]))),
    { sep: true },
    { label: 'Настройки', icon: 'settings', action: () => navigate({ view: 'settings' }) },
    mode === 'local' && { title: 'Локальный режим: данные только в этом браузере' },
    mode === 'local' && { label: 'Войти как…', icon: 'users', action: openActAs },
    mode === 'local' && { sep: true },
    mode === 'local' && { label: 'Очистить локальную базу', icon: 'trash', danger: true, action: resetLocal },
    mode === 'supabase' && { sep: true },
    mode === 'supabase' && { label: 'Выйти', icon: 'back', action: () => supabase.auth.signOut() },
  ], { cls: 'me-menu' });
}

/** Лёгкое обновление счётчиков без перерисовки (после правок на доске). */
export function updateSidebarCounts() {
  document.querySelectorAll('#sidebar .nav-item.unit').forEach(el => {
    const u = unitById(el.dataset.id);
    const c = el.querySelector('.nav-count');
    if (!u || !c) return;
    c.textContent = openCount(u) || '';
    c.classList.toggle('warn', !!(u.counts && u.counts.overdue));
  });
}

/** Локальный режим: всё стереть и начать с пустой тулзы (вход — «Администратор», супер-админ). */
export async function resetLocal() {
  const ok = await confirmDlg('Стереть все локальные данные этого браузера: юниты, задачи, людей, настройки? Начнётся пустая база. Отменить нельзя.',
    { ok: 'Стереть всё', danger: true, title: 'Очистить локальную базу' });
  if (!ok) return;
  await resetLocalData();
  location.hash = '#/';
  location.reload();
}

applyCollapse();
