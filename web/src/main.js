import './styles.css';
import { S, me } from './state.js';
import { $, h, fill, closeMenu, closeNav, isMenuOpen, isModalOpen } from './ui.js';
import { call } from './api.js';
import { parseLocation, render } from './router.js';
import { openPalette, isPaletteOpen } from './views/palette.js';
import { openCreateTask, closeTask } from './views/task.js';
import { openWhoAmI, openShortcuts } from './views/people.js';

async function start() {
  try {
    const d = await call('bootstrap', { today: new Date().toISOString().slice(0, 10) });
    S.units = d.units;
    S.people = d.people;
    S.departments = d.departments;
  } catch (e) {
    fill($('#main'), h('div', { class: 'boot error' }, 'Не удалось загрузить данные: ' + e.message));
    return;
  }
  S.route = parseLocation();
  render();
  // Без авторизации «кто я» хранится в браузере: спросим при первом входе
  if (!me()) openWhoAmI({ welcome: true });
}

document.addEventListener('keydown', e => {
  const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable]');
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openPalette();
    return;
  }
  if (e.key === 'Escape') {
    if (isModalOpen() || isPaletteOpen()) return; // у них свои обработчики
    if (isMenuOpen()) return closeMenu();
    if (document.body.classList.contains('nav-open')) return closeNav();
    if (S.panelTaskId && !typing) return closeTask();
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey || isModalOpen() || isPaletteOpen()) return;
  const k = e.key.toLowerCase();
  if ((k === 'c' || k === 'с') && !S.panelTaskId) { e.preventDefault(); openCreateTask(); }
  else if (k === '/') { const s = $('#board-search'); if (s) { e.preventDefault(); s.focus(); } else { e.preventDefault(); openPalette(); } }
  else if (k === '?') { e.preventDefault(); openShortcuts(); }
});

document.querySelector('.nav-scrim').addEventListener('click', closeNav);

start();
