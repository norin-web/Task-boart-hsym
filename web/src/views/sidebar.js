import Sortable from 'sortablejs';
import { S, LS, byOrder, openCount, me, unitById } from '../state.js';
import { $, h, icon, avatar, menu, showErr, fill } from '../ui.js';
import { send } from '../api.js';
import { link } from '../router.js';
import { openPalette } from './palette.js';
import { openCreateUnit } from './units.js';
import { openPeople, openWhoAmI, openDepartments, openMyProfile } from './people.js';
import { mode, supabase } from '../data.js';

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

function unitItem(u, r) {
  const n = openCount(u);
  const overdue = u.counts && u.counts.overdue;
  return link({ unit: u.id, mode: 'board' }, {
    class: 'nav-item unit' + (r.unit === u.id ? ' active' : '') + (u.archived ? ' archived' : ''),
    dataset: { id: u.id },
  },
  h('span', { class: 'unit-dot', style: { background: u.color } }),
  h('span', { class: 'nav-label' }, u.name),
  h('span', { class: 'nav-count' + (overdue ? ' warn' : ''), title: overdue ? 'Просрочено: ' + overdue : 'Открытых задач' }, n || ''));
}

export function renderSidebar() {
  const r = S.route;
  const units = S.units.filter(u => !u.archived).sort(byOrder);
  const archived = S.units.filter(u => u.archived);
  const person = me();
  const [themeLabel, themeIcon] = THEMES[LS.get('theme', 'auto')] || THEMES.auto;
  const list = h('div', { class: 'nav-units' }, units.map(u => unitItem(u, r)));

  fill($('#sidebar'),
    h('div', { class: 'brand' }, h('div', { class: 'brand-logo' }, icon('check', 16)), h('span', null, 'Tasks')),
    h('button', { class: 'search-btn', onclick: openPalette }, icon('search', 15), h('span', null, 'Поиск'), h('kbd', null, isMac ? '⌘K' : 'Ctrl K')),
    link({ view: 'home' }, { class: 'nav-item' + (!r.unit && r.view !== 'my' ? ' active' : '') }, icon('home'), h('span', { class: 'nav-label' }, 'Главная')),
    link({ view: 'my' }, { class: 'nav-item' + (r.view === 'my' ? ' active' : '') }, icon('user'), h('span', { class: 'nav-label' }, 'Мои задачи')),
    h('div', { class: 'nav-section' },
      h('span', null, 'Юниты'),
      h('button', { class: 'icon-btn sm', title: 'Новый юнит', onclick: openCreateUnit }, icon('plus', 14))),
    list,
    !units.length && h('button', { class: 'nav-item', onclick: openCreateUnit }, icon('plus'), h('span', { class: 'nav-label muted' }, 'Создать юнит')),
    archived.length > 0 && h('button', {
      class: 'nav-item', onclick: () => { S.showArchivedUnits = !S.showArchivedUnits; renderSidebar(); },
    }, icon('archive'), h('span', { class: 'nav-label' }, 'Архив'), h('span', { class: 'nav-count' }, archived.length)),
    S.showArchivedUnits && archived.map(u => unitItem(u, r)),
    h('div', { class: 'nav-spacer' }),
    h('button', { class: 'nav-item', onclick: openPeople }, icon('users'), h('span', { class: 'nav-label' }, 'Люди')),
    h('button', { class: 'nav-item', onclick: openDepartments }, icon('layers'), h('span', { class: 'nav-label' }, 'Отделы')),
    h('button', { class: 'nav-item', onclick: cycleTheme, title: 'Переключить тему' }, icon(themeIcon), h('span', { class: 'nav-label' }, themeLabel)),
    mode === 'local' && h('div', { class: 'mode-badge', title: 'Supabase не подключён: данные хранятся в этом браузере. См. README.' }, 'Локальный режим: данные только в этом браузере'),
    h('button', { class: 'nav-item me', onclick: e => meMenu(e.currentTarget), title: 'Профиль' },
      avatar(person, 'sm'), h('span', { class: 'nav-label' }, person ? person.name : 'Кто вы?')));

  if (units.length > 1) {
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
    mode === 'local' && { label: 'Сменить пользователя', icon: 'users', action: () => openWhoAmI() },
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
