import Sortable from 'sortablejs';
import { S, LS, byOrder, openCount, me, unitById, isStaff, isSuper, ceoMode, isDev, ACCESS_LABELS } from '../state.js';
import { $, h, icon, avatar, menu, showErr, fill, confirmDlg } from '../ui.js';
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

function applyTheme(t) {
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

function cycleTheme() {
  const order = Object.keys(THEMES);
  const next = order[(order.indexOf(LS.get('theme', 'auto')) + 1) % order.length];
  LS.set('theme', next);
  applyTheme(next);
  renderSidebar();
}

/* ---------- сайдбар ---------- */

/** Счётчик новых назначений у «Главной» — обновляется на месте. */
export function renderUnread() {
  const b = $('#unread-badge');
  if (!b) return;
  b.textContent = S.unread > 99 ? '99+' : S.unread || '';
  b.hidden = !S.unread;
}

function unitItem(u, r) {
  const n = openCount(u);
  const overdue = u.counts && u.counts.overdue;
  return link({ unit: u.id, mode: 'board' }, {
    class: 'nav-item unit' + (r.unit === u.id ? ' active' : '') + (u.archived ? ' archived' : ''),
    dataset: { id: u.id },
    // правый клик — меню юнита
    oncontextmenu: isStaff() ? e => { e.preventDefault(); unitMenu({ x: e.clientX, y: e.clientY }, u); } : null,
  },
  h('span', { class: 'unit-dot', style: { background: u.color } }),
  h('span', { class: 'nav-label' }, u.name),
  h('span', { class: 'nav-count' + (overdue ? ' warn' : ''), title: overdue ? 'Просрочено: ' + overdue : 'Открытых задач' }, n || ''));
}

export function renderSidebar() {
  const r = S.route;
  const units = S.units.filter(u => !u.archived).sort(byOrder);
  const person = me();
  const [themeLabel, themeIcon] = THEMES[LS.get('theme', 'auto')] || THEMES.auto;
  const list = h('div', { class: 'nav-units' }, units.map(u => unitItem(u, r)));
  const staff = isStaff();
  const ceo = isSuper();
  // CEO в режиме Default — только верхний уровень: приложения; остальное — в Admin
  const lite = ceoMode() === 'default';
  const lens = S.realMeId && S.meId !== S.realMeId ? person : null;
  const navLink = (route, ic, label, extra) => link(route, { class: 'nav-item' + (isHere(r, route) ? ' active' : '') }, icon(ic), h('span', { class: 'nav-label' }, label), extra);

  fill($('#sidebar'),
    h('div', { class: 'brand' }, h('div', { class: 'brand-logo' }, icon('check', 16)), h('span', null, 'Tasks')),
    lens && h('div', { class: 'lens-bar', role: 'status' }, icon('eye', 14),
      h('span', null, 'Вы смотрите как ', h('b', null, lens.name), ' · ', ACCESS_LABELS[lens.access]),
      h('button', { class: 'link-btn', onclick: () => import('./dev.js').then(m => m.viewAs('')) }, 'Вернуться')),
    ceo && h('div', { class: 'ceo-mode' }, h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Режим CEO' },
      [['default', 'Default', 'Приложения и приоритеты — без деталей разработки'], ['admin', 'Admin', 'Всё: юниты, доски, задачи, панель админа']].map(([m, label, hint]) =>
        h('button', { class: ceoMode() === m ? 'on' : '', role: 'radio', 'aria-checked': String(ceoMode() === m), title: hint, onclick: () => setCeoMode(m) }, label)))),
    h('button', { class: 'search-btn', onclick: openPalette }, icon('search', 15), h('span', null, 'Поиск'), h('kbd', null, isMac ? '⌘K' : 'Ctrl K')),
    navLink({ view: 'home' }, person && person.access === 'rm' ? 'rocket' : 'home', staff ? 'Дашборд' : person && person.access === 'rm' ? 'Релизы' : 'Мой дашборд',
      h('span', { class: 'nav-badge', id: 'unread-badge', title: 'Новое для вас', hidden: !S.unread }, S.unread || '')),
    navLink({ view: 'apps' }, 'app', 'Приложения'),
    !lite && navLink({ view: 'myboard' }, 'board', 'Моя доска'),
    !lite && staff && navLink({ view: 'my' }, 'user', 'Мои задачи'),
    !lite && staff && navLink({ view: 'admin' }, 'settings', 'Панель админа'),
    !lite && h('div', { class: 'nav-section' },
      h('span', null, staff ? 'Воркспейсы' : 'Мои воркспейсы'),
      ceo && h('button', { class: 'icon-btn sm', title: 'Новый юнит (Gold, RF, MVP…)', onclick: openCreateUnit }, icon('plus', 14))),
    !lite && list,
    !lite && !units.length && ceo && h('button', { class: 'nav-item', onclick: openCreateUnit }, icon('plus'), h('span', { class: 'nav-label muted' }, 'Создать воркспейс')),
    !lite && !units.length && !ceo && h('div', { class: 'nav-empty' }, 'Пока нет воркспейсов'),
    h('div', { class: 'nav-spacer' }),
    isDev() && h('button', {
      class: 'nav-item dev-item' + (isHere(r, { view: 'dev' }) ? ' active' : ''), title: 'Смотреть как, шорткаты-сценарии, тестовые данные',
      onclick: () => import('./dev.js').then(m => m.openDevPanel()),
    }, icon('code'), h('span', { class: 'nav-label' }, 'Режим разработчика'), h('kbd', null, isMac ? '⌥D' : 'Alt D')),

    h('button', { class: 'nav-item', onclick: cycleTheme, title: 'Переключить тему' }, icon(themeIcon), h('span', { class: 'nav-label' }, themeLabel)),
    mode === 'local' && h('div', { class: 'mode-badge', title: 'Supabase не подключён: данные хранятся в этом браузере. См. README.' }, 'Локальный режим: данные только в этом браузере'),
    h('button', { class: 'nav-item me', onclick: e => meMenu(e.currentTarget), title: 'Профиль' },
      avatar(person, 'sm'),
      h('span', { class: 'nav-label me-label' }, h('span', null, person ? person.name : '—'),
        person && h('small', { class: person.access !== 'member' ? 'role-' + person.access : '' }, personCaption(person) || ACCESS_LABELS[person.access]))));

  if (staff && units.length > 1) {
    Sortable.create(list, {
      animation: 150, delay: 150, delayOnTouchOnly: true,
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
async function setCeoMode(m) {
  const p = me();
  if (!p || ceoMode() === m) return;
  p.prefs = { ...(p.prefs || {}), ceoMode: m };
  renderSidebar(); // переключатель отзывается сразу
  // сохраняем до перерисовки: экраны перечитывают людей с сервера и не должны получить старый режим
  try { await send('setMyPrefs', { personId: p.id, prefs: { ceoMode: m } }); } catch (e) { showErr(e); }
  if (m === 'default' && (S.route.unit || ['my', 'myboard', 'admin'].includes(S.route.view))) navigate({ view: 'home' });
  else rerender();
}

function meMenu(anchor) {
  const email = S.session && S.session.user.email;
  menu(anchor, [
    email && { title: email },
    { label: 'Мой профиль', icon: 'user', action: openMyProfile },
    mode === 'local' && { label: 'Войти как…', icon: 'users', action: openActAs },
    mode === 'local' && { sep: true },
    mode === 'local' && { label: 'Очистить локальную базу', icon: 'trash', danger: true, action: resetLocal },
    mode === 'supabase' && { sep: true },
    mode === 'supabase' && { label: 'Выйти', icon: 'back', action: () => supabase.auth.signOut() },
  ]);
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
async function resetLocal() {
  const ok = await confirmDlg('Стереть все локальные данные этого браузера: юниты, задачи, людей, настройки? Начнётся пустая тулза. Отменить нельзя.',
    { ok: 'Стереть всё', danger: true, title: 'Очистить локальную базу' });
  if (!ok) return;
  await resetLocalData();
  location.hash = '#/';
  location.reload();
}
