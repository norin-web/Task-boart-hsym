/**
 * Маршруты:
 *   /                       главная
 *   /my                     мои задачи
 *   /u/:unit[/list|/settings][?task=:id]
 */
import { S, freshFilters } from './state.js';
import { $, h, fill, closeMenu, closeNav, showErr } from './ui.js';
import { renderSidebar } from './views/sidebar.js';
import { renderHome } from './views/home.js';
import { renderMy } from './views/my.js';
import { renderBoardView, loadBoard } from './views/board.js';
import { renderSettings } from './views/settings.js';
import { openTask, closePanel } from './views/task.js';

let rendered = null;
export const currentView = () => rendered;

export function parseLocation() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const task = new URLSearchParams(location.search).get('task');
  if (path === '/my') return { view: 'my' };
  const m = /^\/u\/([\w-]+)(?:\/(list|settings))?$/.exec(path);
  if (m) return { unit: m[1], mode: m[2] || 'board', task: task || null };
  return { view: 'home' };
}

export function routeUrl(r) {
  if (r.unit) return '/u/' + r.unit + (r.mode && r.mode !== 'board' ? '/' + r.mode : '') + (r.task ? '?task=' + encodeURIComponent(r.task) : '');
  return r.view === 'my' ? '/my' : '/';
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
    const key = r.view === 'my' ? 'my' : 'home';
    if (rendered !== key) {
      rendered = key;
      document.title = (key === 'my' ? 'Мои задачи' : 'Главная') + ' · Tasks';
      if (key === 'my') renderMy(); else renderHome();
    }
    return;
  }

  if (!S.board || S.board.unit.id !== r.unit) {
    rendered = 'loading';
    closePanel();
    S.filters = freshFilters();
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

window.addEventListener('popstate', () => {
  S.route = parseLocation();
  render();
});
