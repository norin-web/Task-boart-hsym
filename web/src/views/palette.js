import { S, byOrder } from '../state.js';
import { $, h, icon, fill } from '../ui.js';
import { call } from '../api.js';
import { navigate } from '../router.js';
import { openCreateTask } from './task.js';
import { openCreateUnit } from './units.js';
import { openPeople, openShortcuts, openDepartments } from './people.js';

export const isPaletteOpen = () => $('#palette-root').children.length > 0;

/** Глобальный поиск (⌘K): задачи всех юнитов, юниты и команды. */
export function openPalette() {
  if (isPaletteOpen()) return;
  const actions = [
    { label: 'Создать задачу', icon: 'plus', hint: 'C', run: () => openCreateTask() },
    { label: 'Новый юнит', icon: 'folder', run: openCreateUnit },
    { label: 'Главная', icon: 'home', run: () => navigate({ view: 'home' }) },
    { label: 'Мои задачи', icon: 'user', run: () => navigate({ view: 'my' }) },
    { label: 'Люди', icon: 'users', run: openPeople },
    { label: 'Отделы', icon: 'layers', run: openDepartments },
    { label: 'Горячие клавиши', icon: 'keyboard', hint: '?', run: openShortcuts },
  ];
  let items = [];
  let sel = 0;
  let tasks = [];
  let seq = 0;
  let timer = null;

  const inp = h('input', { class: 'palette-inp', placeholder: 'Найти задачу, юнит или команду…', 'aria-label': 'Поиск' });
  const list = h('div', { class: 'palette-list', role: 'listbox' });
  const wrap = h('div', { class: 'palette-wrap', onmousedown: e => { if (e.target === wrap) close(); } },
    h('div', { class: 'palette' },
      h('div', { class: 'palette-top' }, icon('search', 18), inp, h('kbd', null, 'Esc')),
      list,
      h('div', { class: 'palette-foot' }, h('span', null, '↑↓ выбрать'), h('span', null, '↵ открыть'))));

  function close() {
    wrap.remove();
    clearTimeout(timer);
  }

  function draw() {
    const q = inp.value.trim().toLowerCase();
    const units = S.units.filter(u => !u.archived).sort(byOrder)
      .filter(u => !q || (u.name + ' ' + u.key).toLowerCase().includes(q)).slice(0, 6)
      .map(u => ({ group: 'Юниты', label: u.name, hint: u.key, dot: u.color, run: () => navigate({ unit: u.id, mode: 'board' }) }));
    const acts = actions.filter(a => !q || a.label.toLowerCase().includes(q)).map(a => ({ ...a, group: 'Действия' }));
    const found = tasks.map(t => ({ group: 'Задачи', label: t.title, hint: t.key, dot: t.unit.color, run: () => navigate({ unit: t.unit.id, mode: 'board', task: t.id }) }));
    items = [...found, ...units, ...acts];
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
      h('span', { class: 'lbl' }, it.label),
      it.hint && h('span', { class: 'hint' }, it.hint)));
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
  inp.focus();
}
