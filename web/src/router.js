/**
 * Маршруты (в hash — GitHub Pages не умеет отдавать index.html на любые пути):
 *   #/                       главная
 *   #/my                     мои задачи
 *   #/board                  моя доска (личные этапы)
 *   #/admin[?tab=…]          панель админа (модераторы и супер-админы)
 *   #/u/:unit[/list|/settings|/overview][?task=:id]
 */
import { S, isStaff, loadBoardView } from './state.js';
import { $, h, fill, closeMenu, closeNav, showErr } from './ui.js';
import { renderSidebar } from './views/sidebar.js';
import { renderHome } from './views/home.js';
import { renderMy } from './views/my.js';
import { renderMyBoard } from './views/myboard.js';
import { renderAdmin } from './views/admin.js';
import { renderBoardView, loadBoard } from './views/board.js';
import { renderSettings } from './views/settings.js';
import { openTask, closePanel, peekTask } from './views/task.js';

let rendered = null;
export const currentView = () => rendered;

export function parseLocation() {
  const [rawPath, query] = location.hash.replace(/^#/, '').split('?');
  const path = (rawPath || '/').replace(/\/+$/, '') || '/';
  const task = new URLSearchParams(query || '').get('task');
  if (path === '/my') return { view: 'my' };
  if (path === '/board') return { view: 'myboard' };
  if (path === '/admin') return { view: 'admin', tab: new URLSearchParams(query || '').get('tab') || 'overview' };
  const m = /^\/u\/([\w-]+)(?:\/(list|settings|overview))?$/.exec(path);
  if (m) return { unit: m[1], mode: m[2] || 'board', task: task || null };
  return { view: 'home' };
}

export function routeUrl(r) {
  if (r.unit) return '#/u/' + r.unit + (r.mode && r.mode !== 'board' ? '/' + r.mode : '') + (r.task ? '?task=' + encodeURIComponent(r.task) : '');
  if (r.view === 'admin') return '#/admin' + (r.tab && r.tab !== 'overview' ? '?tab=' + r.tab : '');
  return r.view === 'my' ? '#/my' : r.view === 'myboard' ? '#/board' : '#/';
}

export function navigate(r, { replace = false } = {}) {
  if (r.unit && !r.mode) r = { ...r, mode: 'board' };
  S.route = r;
  history[replace ? 'replaceState' : 'pushState'](null, '', routeUrl(r));
  render();
}

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

  if (!r.unit) {
    closePanel();
    S.board = null;
    if (r.view === 'admin' && !isStaff()) return navigate({ view: 'home' }, { replace: true });
    const key = r.view === 'my' || r.view === 'myboard' ? r.view : r.view === 'admin' ? 'admin:' + (r.tab || 'overview') : 'home';
    if (rendered !== key) {
      rendered = key;
      document.title = (r.view === 'my' ? 'Мои задачи' : r.view === 'myboard' ? 'Моя доска' : r.view === 'admin' ? 'Панель админа' : 'Главная') + ' · Tasks';
      if (r.view === 'my') renderMy(); else if (r.view === 'myboard') renderMyBoard(); else if (r.view === 'admin') renderAdmin(r.tab || 'overview'); else renderHome();
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
  const key = r.mode + ':' + r.unit;
  if (rendered !== key) {
    rendered = key;
    document.title = S.board.unit.name + ' · Tasks';
    if (r.mode === 'settings') renderSettings(); else renderBoardView();
  }
  if (r.task && r.mode !== 'settings') {
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
