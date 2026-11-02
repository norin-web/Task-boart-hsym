/**
 * Маршруты (в hash — GitHub Pages не умеет отдавать index.html на любые пути):
 *   #/                       главная
 *   #/my                     мои задачи
 *   #/board                  моя доска (личные этапы)
 *   #/admin                  старый адрес — ведёт в «Настройки»
 *   #/analytics[/:tile]      аналитика (CEO и PM); плитка — список за цифрой
 *   #/app/:id                карточка приложения на весь экран
 *   #/settings[?tab=…]       настройки: личные и студия
 *   #/u/:unit[/overview|/apps|/list|/team|/settings][?task=:id] — вкладки юнита; без режима — доска
 *   #/u/:unit/t/:team[?task=:id] — доска команды в юните и кто чем занят
 */
import { S, me, isStaff, isSuper, myAccess, loadBoardView, freshFilters, ceoDefault, seesApps, ownTeamsOnly } from './state.js';
import { $, h, fill, icon, closeMenu, closeNav, showErr, setBack, skeleton } from './ui.js';
import { renderSidebar } from './views/sidebar.js';
import { renderHome } from './views/home.js';
import { renderMy } from './views/my.js';
import { renderMyBoard } from './views/myboard.js';
import { renderApps, renderAppPage } from './views/apps.js';
import { renderCeoHome } from './views/ceo.js';
import { renderPmHome } from './views/pm.js';
import { renderRmHome } from './views/rm.js';
import { renderDev } from './views/dev.js';
import { renderPrefs } from './views/prefs.js';
import { renderAnalytics } from './views/analytics.js';
import { renderBoardView, loadBoard } from './views/board.js';
import { renderTimeline } from './views/timeline.js';
import { renderSettings } from './views/settings.js';
import { renderUnitPage, renderUnitTeam } from './views/unitpage.js';
import { openTask, closePanel, peekTask } from './views/task.js';

let rendered = null;
export const currentView = () => rendered;
let renderedF = '';

export function parseLocation() {
  const [rawPath, query] = location.hash.replace(/^#/, '').split('?');
  const path = (rawPath || '/').replace(/\/+$/, '') || '/';
  const task = new URLSearchParams(query || '').get('task');
  const f = new URLSearchParams(query || '').get('f');  // что хотели увидеть: late | open | working
  if (path === '/my') return { view: 'my' };
  if (path === '/board') return { view: 'myboard' };
  if (path === '/apps') return { view: 'apps' };
  const ap = /^\/app\/([\w-]+)$/.exec(path);
  if (ap) return { view: 'app', id: ap[1] };
  if (path === '/dev') return { view: 'dev' };
  if (path === '/analytics') return { view: 'analytics' };
  const an = /^\/analytics\/(apps|work|late|shipped|stale)$/.exec(path);
  if (an) return { view: 'analytics', tile: an[1] };
  // панель админа переехала в «Настройки → Студия»
  if (path === '/settings' || path === '/admin') return { view: 'settings', tab: new URLSearchParams(query || '').get('tab') || '' };
  const t = /^\/u\/([\w-]+)\/t\/([\w-]+)$/.exec(path);
  if (t) return { unit: t[1], mode: 'board', team: t[2], task: task || null };
  const m = /^\/u\/([\w-]+)(?:\/(list|settings|overview|apps|team|timeline))?$/.exec(path);
  if (m) return { unit: m[1], mode: m[2] || 'board', task: task || null, f: f || null };
  return { view: 'home' };
}

export function routeUrl(r) {
  if (r.unit) {
    const q = [r.task && 'task=' + encodeURIComponent(r.task), r.f && 'f=' + encodeURIComponent(r.f)].filter(Boolean).join('&');
    return '#/u/' + r.unit + (r.team ? '/t/' + r.team : r.mode && r.mode !== 'board' ? '/' + r.mode : '') + (q ? '?' + q : '');
  }
  if (r.view === 'settings' || r.view === 'admin') return '#/settings' + (r.tab ? '?tab=' + r.tab : '');
  if (r.view === 'app') return '#/app/' + r.id;
  return r.view === 'my' ? '#/my' : r.view === 'myboard' ? '#/board' : r.view === 'apps' ? '#/apps' : r.view === 'dev' ? '#/dev' : r.view === 'analytics' ? '#/analytics' + (r.tile ? '/' + r.tile : '') : '#/';
}

// откуда открыли карточку приложения: «Назад» ведёт туда, а не всегда в список
let appFrom = null;
const LABELS = { home: 'Дашборд', apps: 'Приложения', analytics: 'Аналитика', my: 'Мои задачи', myboard: 'Моя доска', settings: 'Настройки' };

export function navigate(r, { replace = false } = {}) {
  if (r.unit && !r.mode) r = { ...r, mode: 'board' };
  if (r.view === 'app' && S.route && S.route.view !== 'app') appFrom = S.route;
  S.route = r;
  history[replace ? 'replaceState' : 'pushState'](null, '', routeUrl(r));
  render();
}

/**
 * «Назад» — только с экрана, куда зашли внутрь раздела: приложение, плитка аналитики, настройки.
 * Разделы сайдбара, команды в нём и вкладки юнита переключаются сами, кнопка там не нужна. Родитель — уровень выше, а не история. null — кнопки нет.
 */
export function navParent(r = S.route) {
  if (r.unit) return null;
  if (r.view === 'app') {
    const from = appFrom || { view: 'apps' };
    return { route: from, label: from.unit ? (S.units.find(x => x.id === from.unit) || {}).name || 'Юнит' : LABELS[from.view] || 'Назад' };
  }
  if (r.view === 'analytics' && r.tile) return { route: { view: 'analytics' }, label: 'Аналитика' };
  if (r.view === 'settings') return { route: { view: 'home' }, label: myAccess() === 'rm' ? 'Релизы' : 'Дашборд' };
  return null;
}

setBack(() => {
  const up = navParent();
  return up && h('button', { class: 'icon-btn back-btn', title: 'Назад: ' + up.label, 'aria-label': 'Назад: ' + up.label, onclick: () => navigate(up.route) }, icon('back', 18));
});

/** Ссылка, которая работает и как обычная (новая вкладка по ⌘/Ctrl-клику), и как SPA-переход. */
export function link(route, attrs, ...kids) {
  return h('a', {
    ...attrs,
    href: routeUrl(route),
    onclick: e => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
      e.preventDefault();
      if (attrs && attrs.onclick) attrs.onclick(e);
      navigate(route);
    },
  }, ...kids);
}

/**
 * Ссылка на задачу: по клику открывает карточку поверх текущей страницы (без перехода на доску),
 * ⌘/Ctrl-клик — в новой вкладке.
 */
export function taskLink(unitId, taskId, attrs, ...kids) {
  return h('a', {
    ...attrs,
    href: routeUrl({ unit: unitId, mode: 'board', task: taskId }),
    onclick: e => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
      e.preventDefault();
      peekTask(unitId, taskId);
    },
  }, ...kids);
}

/** Принудительно перерисовать текущий экран (после смены людей, темы и т.п.). */
export function rerender() {
  rendered = null;
  render();
}

export async function render() {
  const r = S.route;
  closeMenu();
  closeNav();
  renderSidebar();

  // CEO в режиме Default: дашборд, приложения и страницы юнитов — личные доски и «мои задачи» не показываем; задача — поверх
  if (ceoDefault() && ((r.unit && r.mode === 'settings') || ['my', 'myboard'].includes(r.view))) {
    navigate({ view: 'home' }, { replace: true });
    if (r.unit && r.task) peekTask(r.unit, r.task);
    return;
  }
  if (!r.unit) {
    closePanel();
    S.board = null;
    if (r.view === 'analytics' && !isStaff()) return navigate({ view: 'home' }, { replace: true });
    if ((r.view === 'apps' || r.view === 'app') && !seesApps()) return navigate({ view: 'home' }, { replace: true });
    const view = r.view;
    const key = view === 'app' ? 'app:' + r.id : view === 'analytics' ? 'analytics:' + (r.tile || '') : ['my', 'myboard', 'apps', 'dev'].includes(view) ? view : view === 'settings' ? 'settings:' + (r.tab || '') : 'home';
    if (rendered !== key) {
      rendered = key;
      document.title = ({ my: 'Мои задачи', myboard: 'Моя доска', settings: 'Настройки', analytics: 'Аналитика', apps: 'Приложения', dev: 'Режим разработчика' }[view] || (isStaff() ? 'Дашборд' : myAccess() === 'rm' ? 'Релизы' : 'Главная')) + ' · Tasks';
      if (view === 'my') renderMy(); else if (view === 'myboard') renderMyBoard(); else if (view === 'apps') renderApps(); else if (view === 'app') renderAppPage(r.id); else if (view === 'dev') renderDev();
      else if (view === 'settings') renderPrefs(r.tab || ''); else if (view === 'analytics') renderAnalytics(r.tile);
      else if (isSuper()) renderCeoHome(); else if (myAccess() === 'moderator') renderPmHome(); else if (myAccess() === 'rm') renderRmHome(); else renderHome();
    }
    return;
  }

  if (!S.board || S.board.unit.id !== r.unit) {
    rendered = 'loading';
    closePanel();
    loadBoardView(r.unit); // фильтры и дорожки этой доски — как оставили
    fill($('#main'), h('div', { class: 'page' }, skeleton()));
    try {
      await loadBoard(r.unit);
    } catch (e) {
      showErr(e.code === 'NOT_FOUND' ? new Error('Юнит не найден — возможно, его удалили') : e);
      return navigate({ view: 'home' }, { replace: true });
    }
    if (S.route !== r) return;
    renderSidebar();
  }

  if (r.mode === 'settings' && !isStaff()) return navigate({ unit: r.unit, mode: 'board' }, { replace: true });
  if (['overview', 'apps'].includes(r.mode) && !seesApps()) return navigate({ unit: r.unit, mode: 'board' }, { replace: true });
  if (ownTeamsOnly() && (r.mode === 'team' || (r.team && !((me() || {}).teamIds || []).includes(r.team)))) return navigate({ unit: r.unit, mode: 'board' }, { replace: true });
  const key = r.mode + ':' + r.unit + (r.team ? ':' + r.team : '');
  const fkey = r.f || '';  // фильтр из адреса не входит в ключ экрана (по ключу экраны сверяют, что страница не устарела)
  if (rendered !== key || renderedF !== fkey) {
    rendered = key;
    renderedF = fkey;
    if (r.f) applyRouteFilter(r);
    document.title = S.board.unit.name + ' · Tasks';
    if (r.mode === 'settings') renderSettings(); else if (r.mode === 'overview') renderUnitPage();
    else if (r.mode === 'apps') renderApps({ unitId: r.unit }); else if (r.mode === 'team') renderUnitTeam(); else if (r.mode === 'timeline') renderTimeline(); else renderBoardView();
  }
  if (r.task && ['board', 'list', 'timeline'].includes(r.mode)) {
    if (S.panelTaskId !== r.task) openTask(r.task);
  } else {
    closePanel();
  }
}

/** Переход с плитки («Просрочено», «Открытых задач», «В работе») открывает экран уже с нужным фильтром. */
function applyRouteFilter(r) {
  if (r.mode === 'list' || r.mode === 'board') {
    S.filters = freshFilters();
    if (r.f === 'late') S.filters.overdue = true;
    if (r.f === 'open') S.filters.open = true;
    S.fbMore = true;  // фильтры спрятаны под «Ещё фильтры» — раскрываем, чтобы чип был виден
  }
  if (r.mode === 'apps') S.appsHint = r.f;
}

const onLocation = () => {
  if (!S.started) return; // приложение ещё загружается: первый показ сделает main.js по текущему адресу
  const next = parseLocation();
  if (routeUrl(next) === routeUrl(S.route)) return;
  S.route = next;
  render();
};
window.addEventListener('popstate', onLocation);
window.addEventListener('hashchange', onLocation);
