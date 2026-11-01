import { S, LS, isStaff, isSuper } from '../state.js';
import { $, h, icon, fill } from '../ui.js';
import { call } from '../api.js';
import { navigate } from '../router.js';
import { openCreateTask, peekTask } from './task.js';
import { openCreateUnit } from './units.js';
import { openShortcuts } from './people.js';
import { mode } from '../data.js';
import { fillDemo } from './home.js';

/** Совпадение с запросом — зелёным, как в макете 26. */
const mark = (text, q) => {
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  return i < 0 ? text : [text.slice(0, i), h('span', { class: 'pal-hl' }, text.slice(i, i + q.length)), text.slice(i + q.length)];
};

export const isPaletteOpen = () => $('#palette-root').children.length > 0;

/** Глобальный поиск (⌘K): задачи, приложения, люди и действия (G02). */
export function openPalette() {
  if (isPaletteOpen()) return;
  const actions = [
    isStaff() && { label: 'Создать задачу', icon: 'plus', hint: 'C', run: () => openCreateTask() },
    isSuper() && { label: 'Новый юнит', icon: 'folder', run: openCreateUnit },
    { label: 'Главная', icon: 'home', run: () => navigate({ view: 'home' }) },
    isStaff() && { label: 'Мои задачи', icon: 'user', run: () => navigate({ view: 'my' }) },
    { label: 'Настройки', icon: 'settings', run: () => navigate({ view: 'settings' }) },
    isStaff() && { label: 'Аналитика', icon: 'chart', run: () => navigate({ view: 'analytics' }) },
    isStaff() && { label: 'Люди и доступы', icon: 'users', run: () => navigate({ view: 'settings', tab: 'people' }) },
    isStaff() && { label: 'Позиции', icon: 'layers', run: () => { LS.set('peopleSub', 'positions'); navigate({ view: 'settings', tab: 'people' }); } },
    isStaff() && { label: 'Журнал событий', icon: 'clock', run: () => navigate({ view: 'settings', tab: 'journal' }) },
    { label: 'Горячие клавиши', icon: 'keyboard', hint: '?', run: openShortcuts },
    mode === 'local' && isStaff() && !S.units.length && { label: 'Заполнить демо-данными', icon: 'layers', run: () => fillDemo() },
  ].filter(Boolean);
  let items = [];
  let sel = 0;
  let tasks = [];
  let apps = S.apps.filter(a => !a.archived);
  let seq = 0;
  let timer = null;

  const inp = h('input', { class: 'palette-inp', placeholder: 'Найти задачу, приложение или человека…', 'aria-label': 'Поиск' });
  const list = h('div', { class: 'palette-list', role: 'listbox' });
  const wrap = h('div', { class: 'palette-wrap', onmousedown: e => { if (e.target === wrap) close(); } },
    h('div', { class: 'palette' },
      h('div', { class: 'palette-top' }, icon('search', 18), inp, h('kbd', null, 'Esc')),
      list));

  function close() {
    wrap.remove();
    clearTimeout(timer);
  }

  function draw() {
    const q = inp.value.trim().toLowerCase();
    const foundApps = (q ? apps.filter(a => a.name.toLowerCase().includes(q)) : []).slice(0, 6)
      .map(a => ({ group: 'Приложения', label: a.name, icon: 'app', run: () => import('./apps.js').then(m => m.openAppById(a.id)) }));
    const people = (q ? S.people.filter(p => p.active && p.name.toLowerCase().includes(q)) : []).slice(0, 6)
      .map(p => ({ group: 'Люди', label: p.name, icon: 'user', run: () => navigate({ view: 'settings', tab: 'people' }) }));
    const acts = actions.filter(a => !q || a.label.toLowerCase().includes(q)).map(a => ({ ...a, group: 'Действия' }));
    const found = tasks.map(t => ({ group: 'Задачи', label: t.title, hint: t.key, dot: t.unit.color, run: () => peekTask(t.unit.id, t.id) }));
    items = [...found, ...foundApps, ...people, ...acts];
    sel = Math.max(0, Math.min(sel, items.length - 1));

    const nodes = [];
    let group = null;
    items.forEach((it, i) => {
      if (it.group !== group) { group = it.group; nodes.push(h('div', { class: 'pal-group' }, group)); }
      nodes.push(h('button', {
        class: 'pal-item' + (i === sel ? ' sel' : ''), role: 'option',
        onmousemove: () => { if (sel !== i) { sel = i; draw(); } },
        onclick: () => { close(); it.run(); },
      },
      it.dot ? h('span', { class: 'unit-dot', style: { background: it.dot } }) : icon(it.icon, 16),
      h('span', { class: 'lbl' }, mark(it.label, q)),
      it.hint && h('span', { class: 'hint' }, it.hint),
      i === sel && h('span', { class: 'pal-enter', 'aria-hidden': 'true' }, '↵')));
    });
    fill(list, ...(nodes.length ? nodes : [h('div', { class: 'pal-empty' }, q.length < 2 ? 'Введите хотя бы 2 символа' : 'Ничего не найдено')]));
    const cur = list.querySelector('.sel');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }

  inp.addEventListener('input', () => {
    sel = 0;
    const q = inp.value.trim();
    clearTimeout(timer);
    if (q.length < 2) { tasks = []; draw(); return; }
    draw();
    const my = ++seq;
    timer = setTimeout(async () => {
      try {
        const res = await call('queryTasks', { q, limit: 8 });
        if (my === seq) { tasks = res; draw(); }
      } catch { /* поиск не критичен */ }
    }, 180);
  });
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = items[sel]; if (it) { close(); it.run(); } }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });

  $('#palette-root').append(wrap);
  draw();
  if (!apps.length) call('listApps', {}).then(list => { apps = list.filter(a => !a.archived); if (isPaletteOpen()) draw(); }).catch(() => {});
  inp.focus();
}
