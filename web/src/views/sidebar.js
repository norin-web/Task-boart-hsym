import Sortable from 'sortablejs';
import { S, LS, byOrder, openCount, me, unitById, isStaff, ACCESS_LABELS } from '../state.js';
import { $, h, icon, avatar, menu, showErr, fill, confirmDlg } from '../ui.js';
import { send } from '../api.js';
import { link } from '../router.js';
import { openPalette } from './palette.js';
import { openCreateUnit, unitMenu } from './units.js';
import { openPeople, openActAs, openDepartments, openMyProfile } from './people.js';
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

function unitItem(u, r, depth = 0) {
  const n = openCount(u);
  const overdue = u.counts && u.counts.overdue;
  return link({ unit: u.id, mode: 'board' }, {
    class: 'nav-item unit' + (r.unit === u.id ? ' active' : '') + (u.archived ? ' archived' : '') + (depth ? ' sub' : ''),
    dataset: { id: u.id }, style: depth ? { '--depth': Math.min(depth, 4) } : null,
    // правый клик — меню юнита (в т. ч. «Входит в…» — место в дереве)
    oncontextmenu: isStaff() ? e => { e.preventDefault(); unitMenu({ x: e.clientX, y: e.clientY }, u); } : null,
  },
  h('span', { class: 'unit-dot', style: { background: u.color } }),
  h('span', { class: 'nav-label' }, u.name),
  h('span', { class: 'nav-count' + (overdue ? ' warn' : ''), title: overdue ? 'Просрочено: ' + overdue : 'Открытых задач' }, n || ''));
}

export function renderSidebar() {
  const r = S.route;
  // Юниты деревом: верхние, под каждым — его юниты ниже (родитель не виден участнику — юнит считается верхним)
  const visible = S.units.filter(u => !u.archived);
  const ids = new Set(visible.map(u => u.id));
  const units = [];
  const walk = (list, depth) => list.sort(byOrder).forEach(u => {
    units.push({ u, depth });
    walk(visible.filter(x => x.parentId === u.id), depth + 1);
  });
  walk(visible.filter(u => !u.parentId || !ids.has(u.parentId)), 0);
  const person = me();
  const [themeLabel, themeIcon] = THEMES[LS.get('theme', 'auto')] || THEMES.auto;
  const list = h('div', { class: 'nav-units' }, units.map(({ u, depth }) => unitItem(u, r, depth)));
  const staff = isStaff();

  fill($('#sidebar'),
    h('div', { class: 'brand' }, h('div', { class: 'brand-logo' }, icon('check', 16)), h('span', null, 'Tasks')),
    h('button', { class: 'search-btn', onclick: openPalette }, icon('search', 15), h('span', null, 'Поиск'), h('kbd', null, isMac ? '⌘K' : 'Ctrl K')),
    link({ view: 'home' }, { class: 'nav-item' + (!r.unit && (!r.view || r.view === 'home') ? ' active' : '') }, icon('home'), h('span', { class: 'nav-label' }, staff ? 'Главная' : 'Мой дашборд'),
      h('span', { class: 'nav-badge', id: 'unread-badge', title: 'Новые задачи на вас', hidden: !S.unread }, S.unread || '')),
    staff && link({ view: 'my' }, { class: 'nav-item' + (r.view === 'my' ? ' active' : '') }, icon('user'), h('span', { class: 'nav-label' }, 'Мои задачи')),
    staff && link({ view: 'admin' }, { class: 'nav-item' + (r.view === 'admin' ? ' active' : '') }, icon('settings'), h('span', { class: 'nav-label' }, 'Панель админа')),
    h('div', { class: 'nav-section' },
      h('span', null, staff ? 'Юниты' : 'Мои юниты'),
      staff && h('button', { class: 'icon-btn sm', title: 'Новый юнит', onclick: openCreateUnit }, icon('plus', 14))),
    list,
    !units.length && staff && h('button', { class: 'nav-item', onclick: openCreateUnit }, icon('plus'), h('span', { class: 'nav-label muted' }, 'Создать юнит')),
    !units.length && !staff && h('div', { class: 'nav-empty' }, 'Пока нет юнитов'),
    h('div', { class: 'nav-spacer' }),

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
