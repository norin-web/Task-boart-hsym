import Sortable from 'sortablejs';
import { S, LS, byOrder, openCount, me, unitById, personById, activeTeams, isStaff, isSuper, ceoMode, ceoDefault, isDev, ACCESS_LABELS, seesApps, ownTeamsOnly, myAccess } from '../state.js';
import { $, h, icon, avatar, menu, closeMenu, showErr, fill, confirmDlg, setBell } from '../ui.js';
import { call, send } from '../api.js';
import { link, navigate, rerender, sectionRoute } from '../router.js';
import { openPalette } from './palette.js';
import { unitMenu, openCreateUnit } from './units.js';
import { openActAs, openMyProfile, openTeamDialog } from './people.js';
import { personCaption } from './my.js';
import { mode, supabase, resetLocalData } from '../data.js';

// цифры меню: одним лёгким запросом navCounts раз в 30 с (раньше — Сводка, экран реджектов и все мои задачи целиком)
let navN = { ready: 0, rejects: 0, mine: 0 }, navAt = 0, navWait = null;
const navEls = { ready: new Set(), rejects: new Set(), mine: new Set() };
function fetchNavCounts() {
  navAt = Date.now();
  navWait = call('navCounts', { personId: S.meId }).then(n => {
    navN = n;
    for (const k of Object.keys(navEls)) for (const e of navEls[k]) {
      if (!e.isConnected) { navEls[k].delete(e); continue; }
      e.textContent = n[k] || '';
      if (k === 'rejects') e.classList.toggle('danger', !!n[k]);
    }
  }).catch(() => {}).finally(() => { navWait = null; });
}
function navCount(key, danger) {
  const el = h('span', { class: 'nav-count' + (danger && navN[key] ? ' danger' : '') }, navN[key] || '');
  navEls[key].add(el);
  if (Date.now() - navAt > 30000 && !navWait) fetchNavCounts();
  return el;
}
// живые обновления: задачи или приложения поменялись — цифры меню пересчитываем (не чаще раза в 5 секунд)
document.addEventListener('tasks:remote', e => {
  const t = e.detail.tables;
  if ((t.includes('tasks') || t.includes('apps')) && !navWait && Date.now() - navAt > 5000) fetchNavCounts();
});

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

/* ---------- тема ---------- */

const THEMES = { auto: ['Тема: как в системе', 'monitor'], light: ['Тема: светлая', 'sun'], dark: ['Тема: тёмная', 'moon'] };

// Тёмная тема скрыта: любое значение превращается в светлую
export function applyTheme() { document.documentElement.dataset.theme = 'light'; }

export const THEME_LIST = THEMES;
export function setTheme(t) {
  LS.set('theme', t);
  applyTheme(t);
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
  const block = newsBlock({ history: true });
  const m = menu(anchor, [block || h('div', { class: 'bell-empty' }, icon('done', 20), h('b', null, 'Уведомлений нет'), h('span', { class: 'muted' }, 'Здесь появятся назначения, ревью и упоминания'))], { cls: 'bell-menu' });
  // открыли задачу — список закрываем
  m.addEventListener('click', e => { if (e.target.closest('.news-row')) closeMenu(); }, true);
}

/**
 * Список команд текущего юнита в меню слева — открыт по умолчанию (переход в юнит сразу его открывает),
 * но его можно свернуть; выбор запоминается в браузере per-юнит.
 */
const closedUnits = () => LS.get('navClosed', []) || [];
function toggleUnit(id) {
  const list = closedUnits();
  LS.set('navClosed', list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  renderSidebar();
}
/** Команды юнита: те, в которых состоят его участники. */
export const unitTeams = u => {
  if (myAccess() === 'member' || myAccess() === 'rm') return [];  // релиз-менеджеру команды не нужны, только юнит; у сотрудника только свои задачи: досок команд ему не показываем
  const ids = new Set((u.members || []).flatMap(id => (personById(id) || {}).teamIds || []));
  const mine = (me() || {}).teamIds || [];
  return activeTeams().filter(t => ids.has(t.id) && (!ownTeamsOnly() || mine.includes(t.id)));
};

function unitItem(u, r) {
  const inside = r.unit === u.id; // на странице юнита или его команды: список команд остаётся открытым
  const here = inside && !r.team;
  const teams = unitTeams(u);
  const canExpand = inside && (teams.length > 0 || isSuper());
  const open = canExpand && !closedUnits().includes(u.id);
  // подпункты — только текст: команды юнита, «+ Новая команда» на странице юнита
  const sub = (route, label, on) => link(route, { class: 'nav-sub' + (on ? ' active' : '') }, h('span', { class: 'nav-label' }, label));
  return h('div', { class: 'nav-unit' + (open ? ' open' : ''), dataset: { id: u.id } },
    link({ unit: u.id, mode: seesApps() ? 'overview' : 'board' }, {
      // клик по юниту — его обзор; по уже открытому юниту — ещё и сворачивает/разворачивает список команд, без отдельной стрелки
      class: 'nav-item unit nav-unit-row' + (here ? ' active' : '') + (u.archived ? ' archived' : ''),
      dataset: { id: u.id },
      onclick: canExpand && here ? () => toggleUnit(u.id) : null,
      // правый клик — меню юнита
      oncontextmenu: isStaff() ? e => { e.preventDefault(); unitMenu({ x: e.clientX, y: e.clientY }, u); } : null,
    },
    h('span', { class: 'unit-dot', style: { background: u.color } }),
    h('span', { class: 'nav-label' }, u.name),
    h('span', { class: 'nav-abbr', 'aria-hidden': 'true' }, String(u.key || u.name || '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase()),  // в свёрнутом сайдбаре (макет 05б): точка + две буквы

    // стрелка есть у каждого юнита (макет 12): у текущего — разворачивает команды, у остальных — только указывает на вложенность
    h('span', { class: 'nav-chev', 'aria-hidden': 'true' }, icon('chevron', 14))),
    open && h('div', { class: 'nav-subs' },
      teams.map(t => sub({ unit: u.id, mode: 'board', team: t.id }, t.name, r.unit === u.id && r.team === t.id)),
      isSuper() && h('button', { class: 'nav-sub add', onclick: () => openTeamDialog(u) }, icon('plus', 14), h('span', { class: 'nav-label' }, 'Новая команда'))));
}


/** Свёрнутый сайдбар (80 px): выбор запоминаем; подпись и счётчик — в подсказке. */
const collapsed = () => LS.get('sbCollapsed', false) === true;
export const applyCollapse = () => document.body.classList.toggle('sb-collapsed', collapsed());
function toggleCollapse() { LS.set('sbCollapsed', !collapsed()); applyCollapse(); renderSidebar(); }

export function renderSidebar() {
  // список в сайдбаре перерисовывается целиком — запоминаем прокрутку, иначе выбор команды в юните «прыгает»
  const keep = document.querySelector('#sidebar .nav-scroll');
  const top = keep ? keep.scrollTop : 0;
  drawSidebar();
  const now = document.querySelector('#sidebar .nav-scroll');
  if (now && top) now.scrollTop = top;
  // свёрнутый сайдбар: подпись и счётчик — в подсказке
  document.querySelectorAll('#sidebar .nav-item, #sidebar .nav-sub').forEach(el => {
    if (el.title) return;
    const label = el.querySelector('.nav-label');
    const count = el.querySelector('.nav-count');
    if (label) el.title = label.textContent + (count && count.textContent ? ' · ' + count.textContent : '');
  });
}

function drawSidebar() {
  const r = sectionRoute(S.route);  // внутренний экран подсвечивает раздел, откуда в него зашли
  const units = S.units.filter(u => !u.archived).sort(byOrder);
  const person = me();
  const list = h('div', { class: 'nav-units' }, units.map(u => unitItem(u, r)));
  const staff = isStaff();
  const ceo = isSuper();
  // CEO в режиме Default — без личных досок и списков задач
  const lite = ceoMode() === 'default';
  const lens = S.realMeId && S.meId !== S.realMeId ? person : null;
  const navLink = (route, ic, label, extra) => link(route, { class: 'nav-item' + (isHere(r, route) ? ' active' : '') }, icon(ic), h('span', { class: 'nav-label' }, label), extra);
  // сколько открытых задач на мне: число у «Мои задачи» (RM) и «Моя доска» (Lead, сотрудник)
  // сколько приложений ждут разработки (дизайн закрыт, iOS не начат) — число у «Готовы к разработке»
  const readyCount = () => navCount('ready');
  // сколько реджектов открыто — число у «Реджекты» (CEO и релиз-менеджер)
  const rejectCount = () => navCount('rejects', true);
  const myCount = () => navCount('mine');
  const sec = (label, extra) => h('div', { class: 'nav-section' }, h('span', null, label), extra);

  const meBtn = h('button', { class: 'nav-item me', onclick: e => { e.stopPropagation(); meMenu(); }, title: 'Аккаунт', 'aria-haspopup': 'menu', 'aria-expanded': String(meOpen) },
    avatar(person, 'lg'),
    h('span', { class: 'nav-label me-label' }, h('span', null, person ? person.name : '—'),
      person && h('small', null, (S.session && S.session.user.email) || personCaption(person) || ACCESS_LABELS[person.access])),
    icon('chevron', 14));

  fill($('#sidebar'),
    h('div', { class: 'nav-top' },
      h('div', { class: 'brand' }, h('div', { class: 'brand-logo' }, icon('check', 16)), h('span', { class: 'brand-name' }, 'Tasks'),
        h('button', { class: 'icon-btn sm sb-toggle', title: collapsed() ? 'Развернуть меню' : 'Свернуть меню', 'aria-label': collapsed() ? 'Развернуть меню' : 'Свернуть меню', onclick: toggleCollapse }, icon(collapsed() ? 'expand' : 'collapse', 16))),
      lens && h('div', { class: 'lens-bar', role: 'status', title: mode === 'supabase' ? 'Права — как у этого человека; только просмотр, изменения не сохраняются' : '' }, icon('eye', 14),
        h('span', null, 'Как ', h('b', null, lens.name)),
        h('button', { class: 'link-btn', onclick: () => import('./dev.js').then(m => m.viewAs('')) }, 'Вернуться')),
      ceo && h('div', { class: 'ceo-mode' }, h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Режим CEO' },
        [['default', 'Обзор', 'Приложения и приоритеты — без деталей разработки'], ['admin', 'Полный', 'Всё: доски, задачи, настройки юнитов']].map(([m, label, hint]) =>
          h('button', { class: ceoMode() === m ? 'on' : '', role: 'radio', 'aria-checked': String(ceoMode() === m), title: hint, onclick: () => setCeoMode(m) }, label))))),
    h('div', { class: 'nav-scroll' },
      h('button', { class: 'search-btn', onclick: openPalette }, icon('search', 15), h('span', null, 'Поиск'), h('kbd', null, isMac ? '⌘K' : 'Ctrl K')),
      navLink({ view: 'home' }, person && person.access === 'rm' ? 'rocket' : 'home', staff ? 'Дашборд' : person && person.access === 'rm' ? 'Релизы' : 'Мой дашборд'),
      seesApps() && navLink({ view: 'apps' }, 'app', 'Приложения'),
      staff && !ceoDefault() && navLink({ view: 'ready' }, 'rows', 'Сводка', readyCount()),
      ceo && navLink({ view: 'backlog' }, 'layers', 'Бэклог'),
      (ceo || (person && person.access === 'rm')) && navLink({ view: 'rejects' }, 'rejected', 'Реджекты', rejectCount()),
      ceo && navLink({ view: 'analytics' }, 'chart', 'Аналитика'),
      !lite && navLink({ view: 'myboard' }, 'board', 'Моя доска', !staff && !(person && person.access === 'rm') && myCount()),
      // «Мои задачи» — и у CEO в «Обзоре»: что разложить и свой дизайн под рукой
      (staff || (person && person.access === 'rm')) && navLink({ view: 'my' }, 'list', 'Мои задачи', !staff && myCount()),
      // инфо-лист: включает CEO, пункт в меню — сам человек (prefs.infoListNav)
      (S.infoListIds || []).includes(S.meId) && person && (person.prefs || {}).infoListNav &&
        navLink({ view: 'infolist' }, 'link', 'Инфо-лист'),
      sec(staff || (person && person.access === 'rm') ? 'Юниты' : 'Мои юниты', ceo && h('button', { class: 'icon-btn sm', title: 'Новый юнит', onclick: openCreateUnit }, icon('plus', 14))),
      list,
      !units.length && h('div', { class: 'nav-empty' }, 'Юнитов пока нет'),
      !units.length && !ceo && h('div', { class: 'nav-empty' }, 'Пока нет юнитов')),
    h('div', { class: 'nav-bottom' },
      h('div', { class: 'nav-sep', role: 'separator' }),
      isDev() && h('button', {
        class: 'nav-item dev-item' + (isHere(r, { view: 'dev' }) ? ' active' : ''), title: 'Смотреть как, быстрые сценарии, тестовые данные',
        onclick: () => import('./dev.js').then(m => m.openDevPanel()),
      }, icon('code'), h('span', { class: 'nav-label' }, 'Режим разработчика'), h('kbd', null, isMac ? '⌥D' : 'Alt D')),
      meOpen && meMenuPanel(),
      meBtn));

  if (meOpen) setTimeout(() => document.addEventListener('click', closeMe, { once: true }), 0);

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
/** Меню аккаунта раскрывается внутри сайдбара (над кнопкой аккаунта), а не поверх страницы всплывающим окном. */
let meOpen = false;
function closeMe() { if (meOpen) { meOpen = false; renderSidebar(); } }
function meMenu() { meOpen = !meOpen; renderSidebar(); }

function renderMenuItems(items) {
  return items.filter(Boolean).map(it => {
    if (it instanceof Node) return it;
    if (it.sep) return h('div', { class: 'menu-sep' });
    if (it.title) return h('div', { class: 'menu-label' }, it.title);
    return h('button', {
      class: 'menu-item' + (it.danger ? ' danger' : ''), role: 'menuitem',
      onclick: e => { e.stopPropagation(); it.action(); },
    }, it.icon && icon(it.icon, 15), it.label);
  });
}

function meMenuPanel() {
  const p = me();
  const email = (S.session && S.session.user.email) || (p && p.email) || '';
  return h('div', { class: 'menu inline-menu me-menu', role: 'menu', onclick: e => e.stopPropagation() },
    renderMenuItems([
      p && h('button', { class: 'menu-item me-card', role: 'menuitem', onclick: () => { closeMe(); openMyProfile(); } },
        avatar(p), h('span', { class: 'me-card-text' }, h('b', null, email || p.name), h('small', { class: 'muted' }, ACCESS_LABELS[p.access] + ' · профиль'))),
      { sep: true },
      { label: 'Настройки', icon: 'settings', action: () => { closeMe(); navigate({ view: 'settings' }); } },
      { label: 'Горячие клавиши', icon: 'keyboard', action: () => { closeMe(); import('./people.js').then(m => m.openShortcuts()); } },
      mode === 'local' && { title: 'Локальный режим: данные только в этом браузере' },
      mode === 'local' && { label: 'Войти как…', icon: 'users', action: () => { closeMe(); openActAs(); } },
      mode === 'local' && { sep: true },
      mode === 'local' && { label: 'Очистить базу', icon: 'trash', danger: true, action: () => { closeMe(); resetLocal(); } },
      mode === 'supabase' && { sep: true },
      mode === 'supabase' && { label: 'Выйти', icon: 'back', danger: true, action: () => supabase.auth.signOut() },
    ]));
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
