/**
 * Маршруты (в hash — GitHub Pages не умеет отдавать index.html на любые пути):
 *   #/                       главная
 *   #/my                     мои задачи
 *   #/board                  моя доска (личные этапы)
 *   #/admin                  старый адрес — ведёт в «Настройки»
 *   #/analytics              аналитика (CEO и PM)
 *   #/settings[?tab=…]       настройки: личные и студия
 *   #/u/:unit[/overview|/apps|/list|/team|/settings][?task=:id] — вкладки юнита; без режима — доска
 *   #/u/:unit/t/:team[?task=:id] — доска команды в юните и кто чем занят
 */
import { S, isStaff, isSuper, myAccess, loadBoardView, ceoDefault, seesApps } from './state.js';
import { $, h, fill, icon, closeMenu, closeNav, showErr, setBack } from './ui.js';
import { renderSidebar } from './views/sidebar.js';
import { renderHome } from './views/home.js';
import { renderMy } from './views/my.js';
import { renderMyBoard } from './views/myboard.js';
import { renderApps } from './views/apps.js';
import { renderCeoHome } from './views/ceo.js';
import { renderPmHome } from './views/pm.js';
import { renderRmHome } from './views/rm.js';
import { renderDev } from './views/dev.js';
import { renderPrefs } from './views/prefs.js';
import { renderAnalytics } from './views/analytics.js';
import { renderBoardView, loadBoard } from './views/board.js';
import { renderSettings } from './views/settings.js';
import { renderUnitPage, renderUnitTeam } from './views/unitpage.js';
import { openTask, closePanel, peekTask } from './views/task.js';

let rendered = null;
export const currentView = () => rendered;

export function parseLocation() {
  const [rawPath, query] = location.hash.replace(/^#/, '').split('?');
  const path = (rawPath || '/').replace(/\/+$/, '') || '/';
  const task = new URLSearchParams(query || '').get('task');
  if (path === '/my') return { view: 'my' };
  if (path === '/board') return { view: 'myboard' };
  if (path === '/apps') return { view: 'apps' };
  if (path === '/dev') return { view: 'dev' };
  if (path === '/analytics') return { view: 'analytics' };
  // панель админа переехала в «Настройки → Студия»
  if (path === '/settings' || path === '/admin') return { view: 'settings', tab: new URLSearchParams(query || '').get('tab') || '' };
  const t = /^\/u\/([\w-]+)\/t\/([\w-]+)$/.exec(path);
  if (t) return { unit: t[1], mode: 'board', team: t[2], task: task || null };
  const m = /^\/u\/([\w-]+)(?:\/(list|settings|overview|apps|team))?$/.exec(path);
  if (m) return { unit: m[1], mode: m[2] || 'board', task: task || null };
  return { view: 'home' };
}

export function routeUrl(r) {
  if (r.unit) return '#/u/' + r.unit + (r.team ? '/t/' + r.team : r.mode && r.mode !== 'board' ? '/' + r.mode : '') + (r.task ? '?task=' + encodeURIComponent(r.task) : '');
  if (r.view === 'settings' || r.view === 'admin') return '#/settings' + (r.tab ? '?tab=' + r.tab : '');
  return r.view === 'my' ? '#/my' : r.view === 'myboard' ? '#/board' : r.view === 'apps' ? '#/apps' : r.view === 'dev' ? '#/dev' : r.view === 'analytics' ? '#/analytics' : '#/';
}

export function navigate(r, { replace = false } = {}) {
  if (r.unit && !r.mode) r = { ...r, mode: 'board' };
  S.route = r;
  history[replace ? 'replaceState' : 'pushState'](null, '', routeUrl(r));
  render();
}

/**
 * Иерархия экранов: Дашборд → (Приложения | Аналитика | Мои задачи | Моя доска | Настройки | Юнит) → раздел юнита / команда.
 * Родитель — это «на уровень выше», а не прошлая страница из истории. null — корень.
 */
export function navParent(r = S.route) {
  if (r.unit) {
    const u = S.units.find(x => x.id === r.unit);
    const root = seesApps() ? 'overview' : 'board';
    if (r.team || r.mode !== root) return { route: { unit: r.unit, mode: root }, label: u ? u.name : 'Юнит' };
    return { route: { view: 'home' }, label: 'Дашборд' };
  }
  if (r.view && r.view !== 'home') return { route: { view: 'home' }, label: 'Дашборд' };
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
    if (r.view === 'apps' && !seesApps()) return navigate({ view: 'home' }, { replace: true });
    const view = r.view;
    const key = ['my', 'myboard', 'apps', 'dev', 'analytics'].includes(view) ? view : view === 'settings' ? 'settings:' + (r.tab || '') : 'home';
    if (rendered !== key) {
      rendered = key;
      document.title = ({ my: 'Мои задачи', myboard: 'Моя доска', settings: 'Настройки', analytics: 'Аналитика', apps: 'Приложения', dev: 'Режим разработчика' }[view] || (isStaff() ? 'Дашборд' : myAccess() === 'rm' ? 'Релизы' : 'Главная')) + ' · Tasks';
      if (view === 'my') renderMy(); else if (view === 'myboard') renderMyBoard(); else if (view === 'apps') renderApps(); else if (view === 'dev') renderDev();
      else if (view === 'settings') renderPrefs(r.tab || ''); else if (view === 'analytics') renderAnalytics();
      else if (isSuper()) renderCeoHome(); else if (myAccess() === 'moderator') renderPmHome(); else if (myAccess() === 'rm') renderRmHome(); else renderHome();
    }
    return;
  }

  if (!S.board || S.board.unit.id !== r.unit) {
    rendered = 'loading';
    closePanel();
    loadBoardView(r.unit); // фильтры и дорожки этой доски — как оставили
    fill($('#main'), h('div', { class: 'boot' }, h('span', { class: 'spinner' }), 'Загрузка…'));
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
  const key = r.mode + ':' + r.unit + (r.team ? ':' + r.team : '');
  if (rendered !== key) {
    rendered = key;
    document.title = S.board.unit.name + ' · Tasks';
    if (r.mode === 'settings') renderSettings(); else if (r.mode === 'overview') renderUnitPage();
    else if (r.mode === 'apps') renderApps({ unitId: r.unit }); else if (r.mode === 'team') renderUnitTeam(); else renderBoardView();
  }
  if (r.task && ['board', 'list'].includes(r.mode)) {
    if (S.panelTaskId !== r.task) openTask(r.task);
  } else {
    closePanel();
  }
}

const onLocation = () => {
  const next = parseLocation();
  if (routeUrl(next) === routeUrl(S.route)) return;
  S.route = next;
  render();
};
window.addEventListener('popstate', onLocation);
window.addEventListener('hashchange', onLocation);
