import Sortable from 'sortablejs';
import {
  S, LS, taskById, personById, activeFields, colName, colById, colColor, columns, taskKey, isEmpty, optById, maxOrder,
  between, todayStr, isOverdue, taskDone, dueInfo, fmtValue, relTime, unitById, emptyCounts, freshFilters,
  activeDepts, deptById, KINDS, KIND_LABELS, KIND_COLORS, KIND_ICONS, PALETTE,
} from '../state.js';
import { $, h, icon, avatar, topbar, menu, closeMenu, modal, field, confirmDlg, promptDlg, toast, showErr, statusDot, fill } from '../ui.js';
import { call, send } from '../api.js';
import { navigate, link } from '../router.js';
import { updateSidebarCounts } from './sidebar.js';
import { openTask, closePanel, openCreateTask, duplicateTask, deleteTaskUndoable, refreshPanel } from './task.js';

let sortables = [];
let quickInput = null;
const NO_DEPT = '__none';

export async function loadBoard(unitId) {
  const d = await call('getBoard', { unitId });
  S.board = d;
  S.people = d.people;
  S.departments = d.departments;
  S.quick = { status: null, dept: null, text: '' };
  const u = unitById(unitId);
  if (u) Object.assign(u, d.unit, { members: d.members.map(m => m.personId) });
}

/* ================= Каркас экрана ================= */

export function renderBoardView() {
  const u = S.board.unit;
  const mode = S.route.mode;
  fill($('#main'),
    topbar([
      h('span', { class: 'uc-icon sm', style: { background: u.color } }, u.key.slice(0, 2)),
      h('h1', null, u.name),
      h('span', { class: 'key-badge' }, u.key),
      u.archived && h('span', { class: 'badge' }, 'в архиве'),
      teamStack(),
    ], [
      h('div', { class: 'seg', role: 'tablist' },
        link({ unit: u.id, mode: 'board' }, { class: mode === 'board' ? 'on' : '', title: 'Доска' }, icon('board', 15), h('span', { class: 'btn-label' }, 'Доска')),
        link({ unit: u.id, mode: 'list' }, { class: mode === 'list' ? 'on' : '', title: 'Список' }, icon('list', 15), h('span', { class: 'btn-label' }, 'Список'))),
      link({ unit: u.id, mode: 'settings' }, { class: 'icon-btn', title: 'Настройки юнита' }, icon('settings', 17)),
      h('button', { class: 'btn primary', onclick: () => openCreateTask(), title: 'Новая задача (C)' }, icon('plus', 15), h('span', { class: 'btn-label' }, 'Задача')),
    ]),
    filterBar(),
    h('div', { id: 'tasks', class: mode === 'list' ? 'view-body' : 'board' }));
  renderTasks();
}

/** Аватары команды в шапке — клик ведёт в настройки состава. */
function teamStack() {
  const list = S.board.members.map(m => personById(m.personId)).filter(Boolean);
  return link({ unit: S.board.unit.id, mode: 'settings' }, { class: 'team-stack', title: 'Команда: ' + (list.map(p => p.name).join(', ') || 'пока никого') },
    list.slice(0, 5).map(p => avatar(p, 'sm')),
    list.length > 5 && h('span', { class: 'avatar sm more' }, '+' + (list.length - 5)),
    !list.length && h('span', { class: 'hint' }, '+ команда'));
}

/** Перерисовать задачи (доска или список) без пересоздания шапки и фильтров. */
export function renderTasks() {
  const el = $('#tasks');
  if (!el || !S.board) return;
  if (S.route.mode === 'list') renderList(el);
  else if (S.lanes) renderLanes(el);
  else renderColumns(el);
  syncCounts();
}

function syncCounts() {
  const c = emptyCounts();
  const today = todayStr();
  const key = { todo: 'todo', progress: 'in_progress', done: 'done' };
  S.board.tasks.forEach(t => {
    if (t.archived || t._temp) return;
    c[key[colById(t.status).kind]]++;
    if (isOverdue(t, today)) c.overdue++;
  });
  const u = unitById(S.board.unit.id);
  if (u) u.counts = c;
  updateSidebarCounts();
}

/* ================= Фильтры ================= */

function filterBar() {
  const search = h('div', { class: 'search-inp' },
    icon('search', 15),
    h('input', {
      id: 'board-search', class: 'inp', type: 'search', placeholder: 'Поиск по задачам  /', value: S.filters.q,
      oninput: e => { S.filters.q = e.target.value; renderTasks(); drawFilterRest(); },
      onkeydown: e => { if (e.key === 'Escape') { e.target.value = ''; S.filters.q = ''; e.target.blur(); renderTasks(); drawFilterRest(); } },
    }));
  return h('div', { class: 'filterbar' }, search, h('div', { id: 'fb-rest', class: 'row' }, filterRest()));
}

function drawFilterRest() {
  const el = $('#fb-rest');
  if (el) fill(el, filterRest());
}

const toggleIn = (arr, v) => (arr.includes(v) ? arr.filter(x => x !== v) : arr.concat(v));

function filterRest() {
  const f = S.filters;
  const B = S.board.unit.settings.builtins;
  const set = (key, val) => { f[key] = val; renderTasks(); drawFilterRest(); };

  // Исполнители: команда + все, у кого есть задачи в юните
  const ids = [...new Set(S.board.members.map(m => m.personId).concat(S.board.tasks.filter(t => !t.archived && t.assigneeId).map(t => t.assigneeId)))];
  const people = ids.map(personById).filter(Boolean).slice(0, 10);
  const avatars = !B.assignee.hidden && people.length > 0 && h('div', { class: 'avatars', title: 'Фильтр по исполнителю' },
    people.map(p => h('button', { class: 'av-btn' + (f.assignees.includes(p.id) ? ' on' : ''), title: p.name, onclick: () => set('assignees', toggleIn(f.assignees, p.id)) }, avatar(p))),
    h('button', { class: 'av-btn' + (f.assignees.includes(NO_DEPT) ? ' on' : ''), title: 'Без исполнителя', onclick: () => set('assignees', toggleIn(f.assignees, NO_DEPT)) }, avatar(null)));

  const depts = !B.department.hidden && activeDepts().length > 0 && h('div', { class: 'row dept-chips', style: { gap: '4px' } },
    activeDepts().map(d => h('button', {
      class: 'fchip dept' + (f.depts.includes(d.id) ? ' on' : ''), style: { '--dc': d.color },
      onclick: () => set('depts', toggleIn(f.depts, d.id)),
    }, h('span', { class: 'dot', style: { background: d.color } }), d.name)));

  const optFields = activeFields().filter(x => (x.type === 'select' || x.type === 'multiselect') && x.options.length);
  const optCount = f.opts.length;
  const active = !!(f.q || f.assignees.length || f.depts.length || f.overdue || f.archived || optCount);

  return [
    avatars,
    depts,
    optFields.length > 0 && h('button', {
      class: 'fchip' + (optCount ? ' on' : ''),
      onclick: e => { e.stopPropagation(); fieldFilterMenu(e.currentTarget, optFields); },
    }, icon('filter', 13), 'Поля', optCount > 0 && h('span', { class: 'n' }, optCount)),
    !B.dueDate.hidden && h('button', { class: 'fchip' + (f.overdue ? ' on' : ''), onclick: () => set('overdue', !f.overdue) }, icon('alert', 13), 'Просроченные'),
    h('button', { class: 'fchip' + (f.archived ? ' on' : ''), onclick: () => set('archived', !f.archived) }, icon('archive', 13), 'Архив'),
    S.route.mode === 'board' && !B.department.hidden && h('button', {
      class: 'fchip' + (S.lanes ? ' on' : ''), title: 'Разложить задачи по отделам',
      onclick: () => { S.lanes = !S.lanes; LS.set('lanes', S.lanes); renderTasks(); drawFilterRest(); },
    }, icon('rows', 13), 'По отделам'),
    active && h('button', {
      class: 'link-btn', onclick: () => {
        S.filters = freshFilters();
        const s = $('#board-search'); if (s) s.value = '';
        renderTasks(); drawFilterRest();
      },
    }, 'Сбросить'),
  ];
}

function fieldFilterMenu(anchor, fields) {
  const f = S.filters;
  const items = [];
  fields.forEach((fld, i) => {
    if (i) items.push({ sep: true });
    items.push({ title: fld.name });
    fld.options.forEach(o => items.push(h('label', { class: 'chk' },
      h('input', {
        type: 'checkbox', checked: f.opts.includes(o.id),
        onchange: e => {
          f.opts = e.target.checked ? f.opts.concat(o.id) : f.opts.filter(x => x !== o.id);
          renderTasks(); drawFilterRest();
        },
      }),
      h('span', { class: 'dot', style: { background: o.color } }), o.name)));
  });
  menu(anchor, items);
}

export function filterTasks() {
  const f = S.filters;
  const q = f.q.trim().toLowerCase();
  const today = todayStr();
  const groups = {}; // fieldId → выбранные варианты
  for (const id of f.opts) {
    const fld = activeFields().find(x => (x.options || []).some(o => o.id === id));
    if (fld) (groups[fld.id] = groups[fld.id] || []).push(id);
  }
  return S.board.tasks.filter(t => {
    if (t.archived && !f.archived) return false;
    if (f.assignees.length && !f.assignees.includes(t.assigneeId || NO_DEPT)) return false;
    if (f.depts.length && !f.depts.includes(t.departmentId)) return false;
    if (f.overdue && !isOverdue(t, today)) return false;
    for (const fid in groups) {
      const v = t.fields[fid];
      const vals = Array.isArray(v) ? v : v ? [v] : [];
      if (!groups[fid].some(id => vals.includes(id))) return false;
    }
    if (q && !(t.title + ' ' + t.description + ' ' + taskKey(t)).toLowerCase().includes(q)) return false;
    return true;
  });
}

/* ================= Доска ================= */

function beginRender() {
  // Фокус возвращаем в быстрое создание, только если он был на доске (не отбираем у поиска)
  const a = document.activeElement;
  const keepFocus = !a || a === document.body || !!a.closest('#tasks');
  quickInput = null;
  sortables.forEach(s => s.destroy());
  sortables = [];
  return () => {
    if (quickInput && keepFocus && !S.panelTaskId && !$('#modal-root').children.length) {
      quickInput.focus();
      quickInput.setSelectionRange(quickInput.value.length, quickInput.value.length);
    }
  };
}

function makeList(items, status, dept, emptyText) {
  const list = h('div', { class: 'col-list', dataset: { status, dept: dept == null ? '' : dept, lane: dept == null ? '' : '1' } },
    items.map(t => taskCard(t, dept != null)),
    !items.length && emptyText && h('div', { class: 'col-empty' }, emptyText));
  sortables.push(Sortable.create(list, {
    group: 'tasks', animation: 150, delay: 120, delayOnTouchOnly: true,
    draggable: '.card:not(.temp)', ghostClass: 'sortable-ghost', fallbackClass: 'sortable-drag', forceFallback: true, fallbackTolerance: 4,
    onEnd: onDragEnd,
  }));
  return list;
}

function colHead(col, count) {
  return h('div', { class: 'col-head' },
    statusDot(colColor(col), 9),
    h('span', { class: 'col-name', title: KIND_LABELS[col.kind] }, col.name),
    h('span', { class: 'col-count' }, count),
    h('span', { class: 'spacer' }),
    h('button', { class: 'icon-btn sm', title: 'Добавить задачу', onclick: () => openQuickAdd(col.id, null) }, icon('plus', 15)),
    h('button', { class: 'icon-btn sm col-menu-btn', title: 'Настроить колонку', onclick: e => { e.stopPropagation(); columnMenu(e.currentTarget, col); } }, icon('more', 15)));
}

const addColumnBtn = () => h('button', { class: 'col-add', title: 'Добавить колонку', onclick: addColumn }, icon('plus', 18), h('span', null, 'Колонка'));

function renderColumns(board) {
  const done = beginRender();
  board.classList.remove('lanes');
  const tasks = filterTasks();
  const filtered = tasks.length !== S.board.tasks.filter(t => !t.archived).length || S.filters.archived;
  fill(board, columns().map(col => {
    const items = tasks.filter(t => colById(t.status).id === col.id).sort((x, y) => x.order - y.order);
    const quickHere = S.quick.status === col.id && S.quick.dept == null;
    return h('section', { class: 'col', style: { '--cc': colColor(col) } },
      colHead(col, items.length),
      makeList(items, col.id, null, !quickHere && (filtered ? 'Нет задач по фильтру' : 'Перетащите задачу сюда')),
      quickAddEl(col.id, null));
  }), addColumnBtn());
  done();
}

/** Дорожки: строки по отделам, внутри — те же колонки. */
function renderLanes(board) {
  const done = beginRender();
  board.classList.add('lanes');
  const cols = columns();
  const tasks = filterTasks();
  const lanes = activeDepts().map(d => ({ id: d.id, name: d.name, color: d.color }))
    .filter(l => !S.filters.depts.length || S.filters.depts.includes(l.id));
  const orphan = tasks.filter(t => !deptById(t.departmentId) || deptById(t.departmentId).archived);
  if (orphan.length && !S.filters.depts.length) lanes.push({ id: '', name: 'Без отдела', color: 'var(--border-strong)' });

  const grid = h('div', { class: 'lanes-grid', style: { gridTemplateColumns: `repeat(${cols.length}, minmax(272px, 1fr)) 44px` } },
    cols.map(col => h('div', { class: 'lane-col-head', style: { '--cc': colColor(col) } },
      colHead(col, tasks.filter(t => colById(t.status).id === col.id).length))),
    h('div', { class: 'lane-col-head add' }, addColumnBtn()));

  for (const lane of lanes) {
    const inLane = lane.id ? tasks.filter(t => t.departmentId === lane.id) : orphan;
    const collapsed = S.collapsedLanes.has(lane.id);
    grid.append(h('button', {
      class: 'lane-head' + (collapsed ? ' collapsed' : ''), style: { gridColumn: '1 / -1' },
      onclick: () => { collapsed ? S.collapsedLanes.delete(lane.id) : S.collapsedLanes.add(lane.id); renderTasks(); },
    }, icon('chevron', 14), h('span', { class: 'dot', style: { background: lane.color } }), lane.name, h('span', { class: 'col-count' }, inLane.length)));
    if (collapsed) continue;
    for (const col of cols) {
      const items = inLane.filter(t => colById(t.status).id === col.id).sort((x, y) => x.order - y.order);
      grid.append(h('div', { class: 'lane-cell' },
        makeList(items, col.id, lane.id, null),
        quickAddEl(col.id, lane.id, true)));
    }
    grid.append(h('div'));
  }
  fill(board, lanes.length ? grid : h('div', { class: 'card-box empty-state' }, h('h2', null, 'Нет отделов'), h('p', null, 'Добавьте отделы в справочнике «Отделы» в меню слева.')));
  done();
}

function onDragEnd(evt) {
  if (evt.from === evt.to && evt.oldIndex === evt.newIndex) return;
  const t = taskById(evt.item.dataset.id);
  if (!t) return;
  const ids = [...evt.to.querySelectorAll('.card')].map(c => c.dataset.id);
  const i = ids.indexOf(t.id);
  const prev = taskById(ids[i - 1]), next = taskById(ids[i + 1]);
  const patch = { order: between(prev && prev.order, next && next.order) };
  if (evt.to.dataset.status !== t.status) patch.status = evt.to.dataset.status;
  if (evt.to.dataset.lane && evt.to.dataset.dept !== (t.departmentId || '')) patch.departmentId = evt.to.dataset.dept;
  setTimeout(() => patchTask(t, patch, { noCheck: true }), 0); // перерисовка после того, как Sortable закончит
}

export function deptChip(id) {
  const d = deptById(id);
  return d && h('span', { class: 'chip dept-chip', title: 'Отдел', style: { background: `color-mix(in srgb, ${d.color} 16%, transparent)`, color: d.color } }, d.name);
}

function taskCard(t, inLane) {
  const B = S.board.unit.settings.builtins;
  const fields = activeFields();
  const chips = [
    !B.department.hidden && !inLane && deptChip(t.departmentId),
    ...fields.filter(f => f.showOnCard).flatMap(f => fieldChip(f, t)),
  ].filter(Boolean);
  const person = !B.assignee.hidden && personById(t.assigneeId);
  const missing = fields.some(f => f.required && isEmpty(t.fields[f.id]));
  const cl = t.checklist || [];
  const clDone = cl.filter(i => i.done).length;
  const due = !B.dueDate.hidden && dueInfo(t.dueDate, taskDone(t));
  const foot = [
    due && h('span', { class: 'due ' + due.cls, title: due.hint }, icon('calendar', 12), due.text),
    cl.length > 0 && h('span', { class: 'meta-ic' + (clDone === cl.length ? ' done' : ''), title: 'Чеклист' }, icon('checklist', 13), clDone + '/' + cl.length),
    t.commentCount > 0 && h('span', { class: 'meta-ic', title: 'Комментарии' }, icon('message', 13), t.commentCount),
  ].filter(Boolean);

  return h('article', {
    class: 'card' + (t.archived ? ' archived' : '') + (t._temp ? ' temp' : ''), dataset: { id: t.id }, tabindex: '0',
    onclick: () => { if (!t._temp) navigate({ unit: S.board.unit.id, mode: S.route.mode, task: t.id }); },
    onkeydown: e => { if (e.key === 'Enter' && !t._temp) navigate({ unit: S.board.unit.id, mode: S.route.mode, task: t.id }); },
    oncontextmenu: e => { if (t._temp) return; e.preventDefault(); cardMenu({ x: e.clientX, y: e.clientY }, t); },
  },
  h('div', { class: 'card-head' },
    h('span', { class: 'card-key' }, taskKey(t)),
    missing && h('span', { class: 'warn-ic', title: 'Не заполнены обязательные поля' }, icon('alert', 13)),
    t.archived && h('span', { class: 'badge' }, 'архив'),
    !t._temp && h('button', {
      class: 'icon-btn sm card-more', title: 'Действия',
      onclick: e => { e.stopPropagation(); cardMenu(e.currentTarget, t); },
    }, icon('more'))),
  h('div', { class: 'card-title' }, t.title),
  chips.length > 0 && h('div', { class: 'chips' }, chips),
  (foot.length > 0 || person) && h('div', { class: 'card-foot' }, foot, h('span', { class: 'spacer' }), person && avatar(person, 'sm')));
}

export function fieldChip(f, t) {
  const v = t.fields[f.id];
  if (isEmpty(v)) return null;
  const optChip = o => h('span', { class: 'chip', title: f.name, style: { background: `color-mix(in srgb, ${o.color} 16%, transparent)`, color: o.color } }, o.name);
  switch (f.type) {
    case 'select': { const o = optById(f, v); return o ? optChip(o) : null; }
    case 'multiselect': return (Array.isArray(v) ? v : []).map(id => optById(f, id)).filter(Boolean).map(optChip);
    case 'date': return h('span', { class: 'chip', title: f.name }, icon('calendar', 11), fmtValue(f, v));
    case 'checkbox': return v ? h('span', { class: 'chip', title: f.name }, icon('check', 11), f.name) : null;
    case 'person': { const p = personById(v); return p ? h('span', { class: 'chip', title: f.name }, f.name + ': ' + p.name) : null; }
    case 'url': return h('span', { class: 'chip', title: String(v) }, icon('arrow', 11), f.name);
    case 'longtext': return null;
    default: return h('span', { class: 'chip', title: f.name }, f.name + ': ' + String(v).slice(0, 40));
  }
}

export function cardMenu(anchor, t) {
  const cols = columns().filter(c => c.id !== t.status);
  const B = S.board.unit.settings.builtins;
  menu(anchor, [
    { label: 'Открыть', icon: 'arrow', action: () => navigate({ unit: S.board.unit.id, mode: S.route.mode, task: t.id }) },
    { sep: true },
    { title: 'Переместить' },
    ...cols.map(c => ({ label: c.name, icon: KIND_ICONS[c.kind], action: () => patchTask(t, { status: c.id }) })),
    !B.department.hidden && activeDepts().length > 0 && { sep: true },
    !B.department.hidden && activeDepts().length > 0 && { title: 'Отдел' },
    ...(!B.department.hidden ? activeDepts().filter(d => d.id !== t.departmentId).map(d => h('button', {
      class: 'menu-item', onclick: () => { closeMenu(); patchTask(t, { departmentId: d.id }); },
    }, h('span', { class: 'dot', style: { background: d.color, margin: '0 4px' } }), d.name)) : []),
    { sep: true },
    !B.assignee.hidden && S.meId && t.assigneeId !== S.meId && { label: 'Назначить на меня', icon: 'user', action: () => patchTask(t, { assigneeId: S.meId }) },
    !B.assignee.hidden && t.assigneeId && { label: 'Снять исполнителя', icon: 'x', action: () => patchTask(t, { assigneeId: '' }) },
    { label: 'Дублировать', icon: 'copy', action: () => duplicateTask(t) },
    { label: t.archived ? 'Вернуть из архива' : 'В архив', icon: 'archive', action: () => patchTask(t, { archived: !t.archived }) },
    { sep: true },
    { label: 'Удалить', icon: 'trash', danger: true, action: () => deleteTaskUndoable(t) },
  ]);
}

/* ================= Колонки: добавление и настройка ================= */

/** Сохраняет новый набор колонок юнита. remap — куда перенести задачи из удалённых колонок. */
export async function saveColumns(cols, remap) {
  const u = S.board.unit;
  const saved = await send('updateUnit', { id: u.id, settings: { ...u.settings, columns: cols }, statusRemap: remap || {} });
  Object.assign(u, saved);
  const lu = unitById(u.id);
  if (lu) Object.assign(lu, { settings: saved.settings });
  if (remap && Object.keys(remap).length) await reloadBoard();
  else renderTasks();
}

const newColumnId = () => 'c_' + Math.random().toString(36).slice(2, 10);

async function addColumn() {
  const name = await promptDlg('Новая колонка', 'Название', '');
  if (!name) return;
  const cols = columns().map(c => ({ ...c }));
  // Новая колонка «в работе» встаёт перед первой колонкой «готово»
  const doneAt = cols.findIndex(c => c.kind === 'done');
  cols.splice(doneAt < 0 ? cols.length : doneAt, 0, { id: newColumnId(), name, kind: 'progress', color: '' });
  saveColumns(cols).then(() => toast('Колонка «' + name + '» добавлена')).catch(showErr);
}

function columnMenu(anchor, col) {
  const cols = columns();
  const i = cols.findIndex(c => c.id === col.id);
  const patch = changes => saveColumns(cols.map(c => (c.id === col.id ? { ...c, ...changes } : { ...c }))).catch(showErr);
  const move = dir => {
    const next = cols.map(c => ({ ...c }));
    next.splice(i + dir, 0, next.splice(i, 1)[0]);
    saveColumns(next).catch(showErr);
  };
  const colors = h('div', { class: 'colors menu-colors' },
    h('button', {
      class: 'swatch auto' + (!col.color ? ' on' : ''), title: 'По типу колонки', style: { background: KIND_COLORS[col.kind] },
      onclick: () => { closeMenu(); patch({ color: '' }); },
    }, 'A'),
    PALETTE.map(c => h('button', { class: 'swatch' + (col.color === c ? ' on' : ''), style: { background: c }, onclick: () => { closeMenu(); patch({ color: c }); } })));
  menu(anchor, [
    { label: 'Переименовать', icon: 'edit', action: async () => { const name = await promptDlg('Переименовать колонку', 'Название', col.name); if (name && name !== col.name) patch({ name }); } },
    { title: 'Тип колонки' },
    ...KINDS.map(k => ({ label: KIND_LABELS[k] + (col.kind === k ? '  ✓' : ''), icon: KIND_ICONS[k], action: () => { if (col.kind !== k) patch({ kind: k }); } })),
    { title: 'Цвет' },
    colors,
    { sep: true },
    i > 0 && { label: 'Сдвинуть влево', icon: 'back', action: () => move(-1) },
    i < cols.length - 1 && { label: 'Сдвинуть вправо', icon: 'arrow', action: () => move(1) },
    cols.length > 1 && { label: 'Удалить колонку', icon: 'trash', danger: true, action: () => deleteColumn(col) },
  ]);
}

export async function deleteColumn(col) {
  const rest = columns().filter(c => c.id !== col.id);
  const count = S.board.tasks.filter(t => colById(t.status).id === col.id).length;
  if (!count) {
    if (await confirmDlg(`Удалить колонку «${col.name}»?`, { ok: 'Удалить', danger: true })) saveColumns(rest.map(c => ({ ...c }))).catch(showErr);
    return;
  }
  const target = h('select', { class: 'inp' }, rest.map(c => h('option', { value: c.id }, c.name)));
  modal({
    title: `Удалить колонку «${col.name}»`,
    body: [
      h('p', { style: { marginTop: 0 } }, `В колонке ${count} ${count === 1 ? 'задача' : count < 5 ? 'задачи' : 'задач'}. Куда их перенести?`),
      field('Перенести в', target),
    ],
    actions: [
      { label: 'Отмена' },
      { label: 'Удалить и перенести', danger: true, action: async close => { await saveColumns(rest.map(c => ({ ...c })), { [col.id]: target.value }); close(); } },
    ],
  });
}

/* ---------- быстрое создание ---------- */

function openQuickAdd(status, dept) {
  if (S.route.mode !== 'board') return openCreateTask({ status });
  S.quick = { status, dept, text: '' };
  renderTasks();
}

function quickAddEl(status, dept, compact) {
  if (S.quick.status !== status || S.quick.dept !== dept) {
    return h('button', { class: 'quick-btn' + (compact ? ' compact' : ''), onclick: () => openQuickAdd(status, dept) }, icon('plus', 14), compact ? '' : 'Задача');
  }
  const cancel = () => { S.quick = { status: null, dept: null, text: '' }; renderTasks(); };
  const inp = h('textarea', {
    class: 'inp', rows: 2, placeholder: 'Название задачи', value: S.quick.text,
    oninput: e => { S.quick.text = e.target.value; },
    onkeydown: e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitQuick(status, dept); }
      else if (e.key === 'Escape') { e.stopPropagation(); cancel(); }
    },
  });
  quickInput = inp;
  return h('div', { class: 'quick' }, inp,
    h('div', { class: 'quick-actions' },
      h('button', { class: 'btn primary sm', onclick: () => submitQuick(status, dept) }, 'Создать'),
      h('button', { class: 'btn ghost sm', onclick: cancel }, 'Отмена'),
      h('span', { class: 'hint', style: { marginLeft: 'auto' } }, 'Enter ↵')));
}

function submitQuick(status, dept) {
  const title = S.quick.text.trim();
  if (!title) return;
  S.quick.text = '';
  const unitId = S.board.unit.id;
  const departmentId = dept || (S.filters.depts.length === 1 ? S.filters.depts[0] : '');
  const t = {
    id: 'tmp_' + Math.random().toString(36).slice(2), _temp: true, unitId, num: 0, title, description: '',
    status, assigneeId: '', departmentId, dueDate: '', fields: {}, checklist: [], archived: false, updatedAt: '', commentCount: 0,
    order: maxOrder(S.board.tasks.filter(x => x.status === status)) + 1,
  };
  S.board.tasks.push(t);
  renderTasks();
  send('createTask', { unitId, title, status, departmentId }, real => {
    Object.assign(t, real);
    delete t._temp;
    if (S.board && S.board.unit.id === unitId) renderTasks();
  }).catch(e => {
    if (S.board) S.board.tasks = S.board.tasks.filter(x => x !== t);
    renderTasks();
    showErr(e);
  });
}

/* ================= Список ================= */

function renderList(container) {
  const B = S.board.unit.settings.builtins;
  const colIndex = id => columns().indexOf(colById(id));
  const cols = [
    { key: 'key', label: 'Ключ', val: t => t.num, cell: t => h('span', { class: 'key-badge' }, taskKey(t)) },
    { key: 'title', label: B.title.label, cls: 't-title', val: t => t.title.toLowerCase(), cell: t => t.title },
    { key: 'status', label: B.status.label, val: t => colIndex(t.status) * 1e9 + t.order, cell: t => h('span', { class: 'badge' }, statusDot(colColor(colById(t.status)), 7), colName(t.status)) },
    !B.department.hidden && {
      key: 'dept', label: B.department.label, val: t => (deptById(t.departmentId) || { order: 1e9 }).order,
      cell: t => deptChip(t.departmentId) || h('span', { class: 'muted' }, '—'),
    },
    !B.assignee.hidden && {
      key: 'assignee', label: B.assignee.label, val: t => (personById(t.assigneeId) || { name: '￿' }).name.toLowerCase(),
      cell: t => { const p = personById(t.assigneeId); return p ? h('span', { class: 'row', style: { flexWrap: 'nowrap', gap: '6px' } }, avatar(p, 'sm'), p.name) : h('span', { class: 'muted' }, '—'); },
    },
    !B.dueDate.hidden && {
      key: 'due', label: B.dueDate.label, val: t => t.dueDate || '9999',
      cell: t => { const d = dueInfo(t.dueDate, taskDone(t)); return d ? h('span', { class: 'due ' + d.cls, title: d.hint }, d.text) : h('span', { class: 'muted' }, '—'); },
    },
    ...activeFields().filter(f => f.showOnCard && f.type !== 'longtext').map(f => ({
      key: f.id, label: f.name, val: t => fmtValue(f, t.fields[f.id]).toLowerCase(),
      cell: t => { const c = fieldChip(f, t); return c ? h('span', { class: 'chips' }, c) : h('span', { class: 'muted' }, '—'); },
    })),
    { key: 'updated', label: 'Обновлена', val: t => t.updatedAt, cell: t => h('span', { class: 'muted' }, relTime(t.updatedAt)) },
  ].filter(Boolean);

  const sort = S.listSort;
  const col = cols.find(c => c.key === sort.key) || cols[2];
  const tasks = filterTasks().sort((a, b) => {
    const x = col.val(a), y = col.val(b);
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
  });

  fill(container, h('div', { class: 'page', style: { maxWidth: 'none' } },
    tasks.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'tasks' },
        h('thead', null, h('tr', null, cols.map(c => h('th', {
          onclick: () => { S.listSort = { key: c.key, dir: sort.key === c.key ? -sort.dir : 1 }; renderTasks(); },
        }, c.label, sort.key === c.key ? (sort.dir > 0 ? ' ↑' : ' ↓') : '')))),
        h('tbody', null, tasks.map(t => h('tr', {
          class: t.archived ? 'archived' : '',
          onclick: () => { if (!t._temp) navigate({ unit: S.board.unit.id, mode: 'list', task: t.id }); },
          oncontextmenu: e => { e.preventDefault(); cardMenu({ x: e.clientX, y: e.clientY }, t); },
        }, cols.map(c => h('td', { class: c.cls || '' }, c.cell(t))))))))
      : h('div', { class: 'card-box empty-state' },
        h('h2', null, S.board.tasks.length ? 'Ничего не найдено' : 'Задач пока нет'),
        h('p', null, S.board.tasks.length ? 'Попробуйте изменить фильтры.' : 'Создайте первую задачу в этом юните.'),
        !S.board.tasks.length && h('button', { class: 'btn primary', onclick: () => openCreateTask() }, icon('plus', 15), 'Создать задачу'))));
}

/* ================= Изменение задач ================= */

/** Оптимистично применяет patch и отправляет на сервер. */
export function patchTask(t, patch, opts = {}) {
  if (patch.status && patch.status !== t.status && !('order' in patch)) {
    patch.order = maxOrder(S.board.tasks.filter(x => x.status === patch.status)) + 1;
  }
  for (const k in patch) {
    if (k === 'fields') {
      for (const f in patch.fields) {
        if (patch.fields[f] === null) delete t.fields[f]; else t.fields[f] = patch.fields[f];
      }
    } else {
      t[k] = patch[k];
    }
  }
  renderTasks();
  const unitId = t.unitId;
  return send('updateTask',
    () => ({ id: t.id, patch, expectedUpdatedAt: opts.noCheck ? null : t.updatedAt }),
    real => {
      Object.assign(t, real);
      if (S.board && S.board.unit.id === unitId) renderTasks();
      if (S.panelTaskId === t.id) refreshPanel(t, { soft: true });
    }).catch(e => {
    if (e.code === 'CONFLICT' && e.data) return resolveConflict(t, patch, e.data);
    showErr(e);
    reloadBoard();
  });
}

async function resolveConflict(t, patch, server) {
  const overwrite = await confirmDlg(
    `Задачу ${taskKey(t)} только что изменил кто-то другой. Перезаписать вашим изменением или взять их версию?`,
    { ok: 'Перезаписать', cancel: 'Взять их версию', title: 'Конфликт изменений' });
  if (overwrite) {
    t.updatedAt = server.updatedAt;
    patchTask(t, patch);
  } else {
    Object.assign(t, server);
    renderTasks();
    if (S.panelTaskId === t.id) refreshPanel(t);
  }
}

export async function reloadBoard() {
  if (!S.board) return;
  try {
    await loadBoard(S.board.unit.id);
    renderTasks();
    if (S.panelTaskId) {
      if (taskById(S.panelTaskId)) openTask(S.panelTaskId); else closePanel();
    }
  } catch (e) {
    showErr(e);
  }
}
