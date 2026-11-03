import Sortable from 'sortablejs';
import {
  S, taskById, appById, personById, activeFields, missingFor, missingNext, priorityOf, priorityField, byPriority, visibleLinkFields, safeUrl, colName, colById, colColor, columns, taskKey, isEmpty, optById, maxOrder,
  between, todayStr, isOverdue, taskDone, dueInfo, fmtValue, relTime, unitById, emptyCounts, freshFilters, saveBoardView,
  activeDepts, deptById, teamById, KINDS, KIND_LABELS, KIND_COLORS, KIND_ICONS, PALETTE, isStaff, canEditTask, TASK_KINDS, me, ownTeamsOnly
} from '../state.js';
import { $, h, icon, avatar, topbar, menu, closeMenu, modal, field, confirmDlg, promptDlg, toast, showErr, statusDot, statusIcon, fill, prioMark } from '../ui.js';
import { call, send } from '../api.js';
import { navigate, link } from '../router.js';
import { updateSidebarCounts, renderUnread } from './sidebar.js';
import { unitHeader } from './unitnav.js';
import { viewSwitch } from './timeline.js';
import { openTask, closePanel, openCreateTask, duplicateTask, deleteTaskUndoable, refreshPanel } from './task.js';

let sortables = [];
let quickInput = null;
const NO_DEPT = '__none';

export async function loadBoard(unitId) {
  const d = await call('getBoard', { unitId });
  S.board = d;
  S.people = d.people;
  S.departments = d.departments;
  if (d.teams) S.teams = d.teams;
  S.quick = { status: null, dept: null, text: '' };
  const u = unitById(unitId);
  if (u) Object.assign(u, d.unit, { members: d.members.map(m => m.personId) });
}

/* ================= Каркас экрана ================= */

export function renderBoardView() {
  const mode = S.route.mode;
  const team = teamById(S.route.team);
  fill($('#main'),
    ...unitHeader(team ? '' : mode === 'list' ? 'list' : 'board', [
      !team && teamStack(),
      isStaff() && h('button', { class: 'btn primary', onclick: () => openCreateTask(), title: 'Новая задача (C)' }, h('span', { class: 'btn-label' }, 'Задача')),
    ], team),
    team && whoDoesWhat(team),
    !team && h('div', { class: 'vs-line' }, viewSwitch(mode === 'list' ? 'list' : 'board')),
    filterBar(),
    h('div', { id: 'tasks', class: mode === 'list' ? 'view-body' : 'board' }));
  renderTasks();
}

/** Люди команды в этом юните. */
const teamPeople = team => S.board.members.map(m => personById(m.personId)).filter(p => p && (p.teamIds || []).includes(team.id))
  .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

/** Доска команды: кто чем занят — у каждого его задача в работе (или «свободен»), сколько открытых и просрочено. */
function whoDoesWhat(team) {
  const today = todayStr();
  const people = teamPeople(team);
  if (!people.length) return h('div', { class: 'who-strip' }, h('p', { class: 'muted', style: { margin: 0 } }, 'В этом юните у команды нет людей'));
  return h('div', { class: 'who-strip' }, people.map(p => {
    const open = S.board.tasks.filter(t => !t.archived && !taskDone(t) && t.assigneeId === p.id);
    const now = open.find(t => colById(t.status).kind === 'progress');
    const late = open.filter(t => isOverdue(t, today)).length;
    return h('button', { class: 'who-card', title: `Показать задачи: ${p.name}. Открыто ${open.length}, просрочено ${late}`, onclick: () => { S.filters.assignees = S.filters.assignees.includes(p.id) ? [] : [p.id]; renderTasks(); drawFilterRest(); markWho(); }, dataset: { person: p.id } },
      avatar(p, 'sm'),
      h('span', { class: 'who-main' }, h('b', null, p.name),
        h('small', { class: now ? '' : 'muted' }, now ? now.title : open.length ? 'ничего в работе' : 'свободен')),
      null);
  }));
}
function markWho() {
  document.querySelectorAll('.who-card').forEach(el => el.classList.toggle('on', S.filters.assignees.includes(el.dataset.person)));
}

/** Аватары команды в шапке — клик ведёт на вкладку «Команда». */
function teamStack() {
  const list = S.board.members.map(m => personById(m.personId)).filter(Boolean);
  const attrs = { class: 'team-stack', title: 'Команда: ' + (list.map(p => p.name).join(', ') || 'пока никого') };
  return link({ unit: S.board.unit.id, mode: 'team' }, attrs,
    list.slice(0, 5).map(p => avatar(p, 'sm')),
    list.length > 5 && h('span', { class: 'avatar sm more' }, '+' + (list.length - 5)),
    !list.length && h('span', { class: 'hint' }, '+ команда'));
}

/** Перерисовать задачи (доска или список) без пересоздания шапки и фильтров. */
export function renderTasks() {
  const el = $('#tasks');
  if (!el || !S.board) return;
  saveBoardView(S.board.unit.id); // любое изменение фильтров/дорожек приходит сюда — запоминаем для этой доски
  if (S.route.mode === 'list') renderList(el);
  else if (S.lanes && isStaff() && (S.lanes !== 'kind' || S.board.tasks.some(t => t.kind === 'request')) && (S.lanes !== 'app' || S.board.tasks.some(t => t.appId))) renderLanes(el);
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
  // Lead и сотрудник — только люди своих команд и исполнители видимых им задач: чужие команды не раскрываем
  const mine = (me() || {}).teamIds || [];
  const unitPeople = S.board.members.map(m => m.personId)
    .filter(id => !ownTeamsOnly() || id === S.meId || ((personById(id) || {}).teamIds || []).some(t => mine.includes(t)));
  const ids = [...new Set(unitPeople.concat(S.board.tasks.filter(t => !t.archived && t.assigneeId).map(t => t.assigneeId)))];
  const people = ids.map(personById).filter(Boolean).slice(0, 10);
  const onTeam = !!S.route.team; // на доске команды людей выбирают карточками «кто чем занят»
  const hasDepts = !onTeam && isStaff() && !B.department.hidden && activeDepts().length > 0;
  const depts = hasDepts && h('div', { class: 'row dept-chips' },
    h('button', { class: 'fchip' + (f.depts.length ? '' : ' on'), onclick: () => set('depts', []) }, 'Все'),
    activeDepts().map(d => h('button', {
      class: 'fchip dept' + (f.depts.includes(d.id) ? ' on' : ''), style: { '--dc': d.color },
      onclick: () => set('depts', toggleIn(f.depts, d.id)),
    }, d.name)));

  const optFields = activeFields().filter(x => (x.type === 'select' || x.type === 'multiselect') && x.options.length);
  const optCount = f.opts.length;
  const active = !!(f.q || f.assignees.length || f.depts.length || f.overdue || f.open || f.archived || optCount || f.app);
  // приложения, по которым есть задачи на этой доске
  const apps = [...new Set(S.board.tasks.filter(t => t.appId && !t.archived).map(t => t.appId))].map(appById).filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
  const appNow = appById(f.app);

  const filterN = f.assignees.length + (f.overdue ? 1 : 0) + (f.open ? 1 : 0) + (f.archived ? 1 : 0) + optCount + (f.app ? 1 : 0);
  const canLanes = S.route.mode === 'board' && isStaff();
  const laneOpts = canLanes && [
    [false, 'Без группировки', 'columns'],
    !B.department.hidden && [true, 'По позициям', 'rows'],
    S.board.tasks.some(t => t.kind === 'request') && ['kind', 'По типу', 'zap'],
    apps.length > 0 && ['app', 'По приложениям', 'rows'],
  ].filter(Boolean);
  const chk = (label, on, onchange, lead) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: on, onchange: e => onchange(e.target.checked) }), lead, label);
  const filtersMenu = anchor => {
    const items = [];
    const group = (title, nodes) => { if (!nodes.length) return; if (items.length) items.push({ sep: true }); items.push({ title }, ...nodes); };
    group('Исполнитель', !onTeam && !B.assignee.hidden ? [
      ...people.map(p => chk(p.name, f.assignees.includes(p.id), () => set('assignees', toggleIn(f.assignees, p.id)), avatar(p, 'sm'))),
      chk('Без исполнителя', f.assignees.includes(NO_DEPT), () => set('assignees', toggleIn(f.assignees, NO_DEPT))),
    ] : []);
    group('Приложение', apps.length ? [
      { label: appNow ? appNow.name + ' · сменить' : 'Все приложения', icon: 'app', action: () => setTimeout(() => menu(anchor, [{ title: 'Приложение' },
        { label: 'Все приложения', icon: appNow ? null : 'check', action: () => set('app', '') },
        ...apps.map(a => ({ label: a.name, icon: f.app === a.id ? 'check' : 'app', action: () => set('app', a.id) }))]), 0) },
    ] : []);
    optFields.forEach(fld => group(fld.name, fld.options.map(o => chk(o.name, f.opts.includes(o.id),
      on => { f.opts = on ? f.opts.concat(o.id) : f.opts.filter(x => x !== o.id); renderTasks(); drawFilterRest(); },
      h('span', { class: 'dot', style: { background: o.color } })))));
    group('Показывать', [
      !B.dueDate.hidden && chk('Только просроченные', !!f.overdue, v => set('overdue', v)),
      chk('Скрыть выполненные', !!f.open, v => set('open', v)),
      chk('Архив', !!f.archived, v => set('archived', v)),
    ].filter(Boolean));
    menu(anchor, items, { cls: 'fb-menu' });
  };
  const lanesMenu = anchor => menu(anchor, [{ title: 'Группировка' }, ...laneOpts.map(([v, label, ic]) => ({
    label, icon: S.lanes === v || (!S.lanes && v === false) ? 'check' : 'blank',
    action: () => { S.lanes = v; renderTasks(); drawFilterRest(); },
  }))]);
  return [
    depts,
    h('span', { class: 'spacer' }),
    h('div', { class: 'row fb-tools' },
    h('button', { class: 'fchip' + (filterN ? ' on' : ''), onclick: e => { e.stopPropagation(); filtersMenu(e.currentTarget); } },
      icon('filter', 14), 'Фильтры', filterN > 0 && h('span', { class: 'n' }, filterN)),
    canLanes && laneOpts.length > 1 && h('button', { class: 'fchip' + (S.lanes ? ' on' : ''), title: 'Как разложить задачи на доске', onclick: e => { e.stopPropagation(); lanesMenu(e.currentTarget); } },
      icon('rows', 14), S.lanes ? (laneOpts.find(([v]) => v === S.lanes) || [])[1] || 'Группировка' : 'Группировка')),
    active && h('button', {
      class: 'link-btn', onclick: () => {
        S.filters = freshFilters();
        const s = $('#board-search'); if (s) s.value = '';
        renderTasks(); drawFilterRest();
      },
    }, 'Сбросить'),
  ];
}

/** Выполнена давно — дольше, чем юнит держит выполненные на доске. */
const staleDone = t => {
  const days = S.board.unit.settings.hideDoneDays;
  return !!days && !t.archived && taskDone(t) && !!t.doneAt && t.doneAt < new Date(Date.now() - days * 864e5).toISOString();
};
/** Давние выполненные прячем, пока их не показали; поиск и фильтр «Архив» видят всё. */
const hidingOld = () => !S.filters.archived && !S.filters.q.trim() && S.showOldDone !== S.board.unit.id;
/** Сколько давних выполненных скрыто в колонке (с учётом остальных фильтров). */
const hiddenOld = colId => (hidingOld() ? filterTasks({ withOld: true }).filter(t => staleDone(t) && colById(t.status).id === colId).length : 0);

/** «Ещё N выполненных — показать» / «Скрыть давние» под колонкой «Готово». */
function oldDoneToggle(col) {
  if (col.kind !== 'done' || !S.board.unit.settings.hideDoneDays) return null;
  const shown = S.showOldDone === S.board.unit.id;
  const n = hiddenOld(col.id);
  if (!shown && !n) return null;
  if (shown && !S.board.tasks.some(t => staleDone(t) && colById(t.status).id === col.id)) return null;
  return h('button', { class: 'old-done', onclick: () => { S.showOldDone = shown ? '' : S.board.unit.id; renderTasks(); } },
    icon(shown ? 'eyeOff' : 'eye', 13), shown ? 'Скрыть давние' : `Показать давние выполненные · ${n}`);
}

export function filterTasks(opts = {}) {
  const f = S.filters;
  const q = f.q.trim().toLowerCase();
  const today = todayStr();
  const groups = {}; // fieldId → выбранные варианты
  for (const id of f.opts) {
    const fld = activeFields().find(x => (x.options || []).some(o => o.id === id));
    if (fld) (groups[fld.id] = groups[fld.id] || []).push(id);
  }
  const team = teamById(S.route.team);
  const inTeam = team && new Set(teamPeople(team).map(p => p.id));
  return S.board.tasks.filter(t => {
    if (inTeam && !inTeam.has(t.assigneeId)) return false;
    if (t.archived && !f.archived) return false;
    if (!opts.withOld && hidingOld() && staleDone(t)) return false;
    if (f.assignees.length && !f.assignees.includes(t.assigneeId || NO_DEPT)) return false;
    if (f.depts.length && !f.depts.includes(t.departmentId)) return false;
    if (f.overdue && !isOverdue(t, today)) return false;
    if (f.open && taskDone(t)) return false;
    if (f.app && t.appId !== f.app) return false;
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
    draggable: '.card:not(.temp):not(.locked)', ghostClass: 'sortable-ghost', fallbackClass: 'sortable-drag', forceFallback: true, fallbackTolerance: 4,
    onEnd: onDragEnd,
  }));
  return list;
}

/** Значок колонки: ревью — отдельная форма, остальное — по типу колонки. */
const colIconKind = col => (col.id === 'review' || /^(review|ревью|в ревью)$/i.test(col.name) ? 'review' : col.kind);

function colHead(col, count) {
  return h('div', { class: 'col-head' },
    statusIcon(colIconKind(col), 16),
    h('span', { class: 'col-name', title: KIND_LABELS[col.kind] }, col.name),
    h('span', { class: 'col-count' }, count),
    h('span', { class: 'spacer' }),
    isStaff() && h('button', { class: 'icon-btn sm', title: 'Добавить задачу', onclick: () => openQuickAdd(col.id, null) }, icon('plus', 15)),
    isStaff() && h('button', { class: 'icon-btn sm col-menu-btn', title: 'Настроить колонку', onclick: e => { e.stopPropagation(); columnMenu(e.currentTarget, col); } }, icon('more', 15)));
}

function renderColumns(board) {
  const done = beginRender();
  board.classList.remove('lanes');
  const tasks = filterTasks();
  const filtered = tasks.length !== S.board.tasks.filter(t => !t.archived && !(hidingOld() && staleDone(t))).length || S.filters.archived;
  fill(board, columns().map(col => {
    const items = tasks.filter(t => colById(t.status).id === col.id).sort(byPriority());
    const quickHere = S.quick.status === col.id && S.quick.dept == null;
    return h('section', { class: 'col', style: { '--cc': colColor(col) } },
      colHead(col, items.length),
      quickAddEl(col.id, null),
      makeList(items, col.id, null, !quickHere && (S.route.team ? 'Здесь пусто' : filtered ? 'Нет задач по фильтру' : 'Пусто')),
      oldDoneToggle(col));
  }));
  done();
}

/** Дорожки: строки по отделам, внутри — те же колонки. */
function renderLanes(board) {
  const done = beginRender();
  board.classList.add('lanes');
  const cols = columns();
  const tasks = filterTasks();
  // Дорожки по типу (запросы CEO / задачи и этапы), по приложениям или по отделам
  const byKind = S.lanes === 'kind', byApp = S.lanes === 'app';
  const laneKind = t => (t.kind === 'request' ? 'request' : '');
  let lanes, orphan = [];
  if (byKind) {
    lanes = [{ id: 'request', name: TASK_KINDS.request.plural, color: TASK_KINDS.request.color },
      { id: '', name: 'Задачи', color: 'var(--border-strong)' }].filter(l => tasks.some(t => laneKind(t) === l.id));
  } else if (byApp) {
    lanes = [...new Set(tasks.map(t => t.appId).filter(Boolean))].map(id => appById(id) || { id, name: 'Приложение', color: '' })
      .sort((a, b) => a.name.localeCompare(b.name)).map(a => ({ id: a.id, name: a.name, color: a.color || 'var(--border-strong)' }));
    orphan = tasks.filter(t => !t.appId);
    if (orphan.length) lanes.push({ id: '', name: 'Без приложения', color: 'var(--border-strong)' });
  } else {
    lanes = activeDepts().map(d => ({ id: d.id, name: d.name, color: d.color }))
      .filter(l => !S.filters.depts.length || S.filters.depts.includes(l.id));
    orphan = tasks.filter(t => !deptById(t.departmentId) || deptById(t.departmentId).archived);
    if (orphan.length && !S.filters.depts.length) lanes.push({ id: '', name: 'Без позиции', color: 'var(--border-strong)' });
  }

  const grid = h('div', { class: 'lanes-grid', style: { gridTemplateColumns: `repeat(${cols.length}, minmax(216px, 1fr))` } },
    cols.map(col => h('div', { class: 'lane-col-head', style: { '--cc': colColor(col) } },
      colHead(col, tasks.filter(t => colById(t.status).id === col.id).length), oldDoneToggle(col))));

  for (const lane of lanes) {
    const inLane = byKind ? tasks.filter(t => laneKind(t) === lane.id) : byApp ? (lane.id ? tasks.filter(t => t.appId === lane.id) : orphan)
      : lane.id ? tasks.filter(t => t.departmentId === lane.id) : orphan;
    const collapsed = S.collapsedLanes.has(lane.id);
    grid.append(h('button', {
      class: 'lane-head' + (collapsed ? ' collapsed' : ''), style: { gridColumn: '1 / -1' },
      onclick: () => { collapsed ? S.collapsedLanes.delete(lane.id) : S.collapsedLanes.add(lane.id); renderTasks(); },
    }, icon('chevron', 14), h('span', { class: 'dot', style: { background: lane.color } }), lane.name, h('span', { class: 'col-count' }, inLane.length)));
    if (collapsed) continue;
    for (const col of cols) {
      const items = inLane.filter(t => colById(t.status).id === col.id).sort(byPriority());
      grid.append(h('div', { class: 'lane-cell' },
        // в дорожках по типу перенос между дорожками тип не меняет — список как у колонки
        makeList(items, col.id, byKind || byApp ? null : lane.id, null),
        !byKind && !byApp && quickAddEl(col.id, lane.id, true)));
    }
    grid.append(h('div'));
  }
  fill(board, lanes.length ? grid : h('div', { class: 'card-box empty-state' }, h('h2', null, 'Нет позиций'), h('p', null, 'Позиции настраиваются в Настройки → Люди и доступы → Позиции.')));
  done();
}

function onDragEnd(evt) {
  // плейсхолдер «Пусто» — не карточка; убираем сразу, иначе он на миг виден под брошенной картой и та прыгает при перерисовке
  const ph = evt.to.querySelector(':scope > .col-empty');
  if (ph) ph.remove();
  if (evt.from === evt.to && evt.oldIndex === evt.newIndex) return;
  const t = taskById(evt.item.dataset.id);
  if (!t) return;
  const ids = [...evt.to.querySelectorAll('.card')].map(c => c.dataset.id);
  const i = ids.indexOf(t.id);
  const prev = taskById(ids[i - 1]), next = taskById(ids[i + 1]);
  const patch = { order: between(prev && prev.order, next && next.order) };
  if (evt.to.dataset.status !== t.status) patch.status = evt.to.dataset.status;
  if (evt.to.dataset.lane && evt.to.dataset.dept !== (t.departmentId || '')) patch.departmentId = evt.to.dataset.dept;
  // Участник не может сменить статус, пока не заполнены обязательные поля — возвращаем и открываем карточку
  const missing = patch.status && !isStaff() && missingFor(t, patch.status);
  // В «готово» с открытым чеклистом участнику нельзя (если так настроен юнит) — возвращаем карточку на место
  const openCl = patch.status && !isStaff() && S.board.unit.settings.checklistBeforeDone && colById(patch.status).kind === 'done'
    && (t.checklist || []).some(i => !i.done);
  if (openCl) {
    setTimeout(() => {
      renderTasks();
      toast('Сначала закройте чеклист', { type: 'error' });
      navigate({ unit: S.board.unit.id, mode: S.route.mode, task: t.id });
    }, 0);
    return;
  }
  if (missing && missing.length) {
    setTimeout(() => {
      renderTasks();
      toast('Сначала заполните: ' + missing.map(f => f.name).join(', '), { type: 'error' });
      navigate({ unit: S.board.unit.id, mode: S.route.mode, task: t.id });
    }, 0);
    return;
  }
  setTimeout(() => patchTask(t, patch, { noCheck: true }), 0); // перерисовка после того, как Sortable закончит
}

export function deptChip(id) {
  const d = deptById(id);
  return d && h('span', { class: 'chip tag dept-chip', title: 'Позиция', style: { '--dc': d.color } }, d.name);
}

function taskCard(t, inLane) {
  const B = S.board.unit.settings.builtins;
  const fields = activeFields();
  const chips = [
    !B.department.hidden && !inLane && deptChip(t.departmentId),
    ...fields.filter(f => f.showOnCard && f.role !== 'priority').flatMap(f => fieldChip(f, t)),  // приоритет — шевроном
  ].filter(Boolean);
  const person = !B.assignee.hidden && personById(t.assigneeId);
  const missing = missingNext(t);
  const prio = priorityOf(t);
  const pf = priorityField();
  const prioEl = prio && prioMark(prio.opt, (pf.options || []).indexOf(prio.opt), (pf.options || []).length, 15);
  const cl = t.checklist || [];
  const clDone = cl.filter(i => i.done).length;
  const due = !B.dueDate.hidden && dueInfo(t.dueDate, taskDone(t));
  // этап, который ждёт незакрытые предыдущие (зависимости — задачи этого же юнита)
  const waits = taskDone(t) ? [] : (t.dependsOn || []).map(taskById).filter(d => d && !taskDone(d)).map(d => d.title.split(' · ')[0]);

  return h('article', {
    class: 'card' + (t.archived ? ' archived' : '') + (taskDone(t) ? ' done' : '') + (t._temp ? ' temp' : '') + (canEditTask(t) ? '' : ' locked')
      + (prio ? ' prio' : ''),
    style: prio ? { '--prio': prio.opt.color } : null, dataset: { id: t.id }, tabindex: '0',
    onclick: () => { if (!t._temp) navigate({ unit: S.board.unit.id, mode: S.route.mode, task: t.id }); },
    onkeydown: e => { if (e.key === 'Enter' && !t._temp) navigate({ unit: S.board.unit.id, mode: S.route.mode, task: t.id }); },
    oncontextmenu: e => { if (t._temp) return; e.preventDefault(); cardMenu({ x: e.clientX, y: e.clientY }, t); },
  },
  // Ключ задачи на доске не показываем — он в открытой карточке
  h('div', { class: 'card-top' },
    h('div', { class: 'card-title' }, t.title),
    missing.length > 0 && h('span', { class: 'warn-ic', title: 'Для следующей колонки заполните: ' + missing.map(f => f.name).join(', ') }, icon('alert', 13)),
    t.archived && h('span', { class: 'badge' }, 'архив'),
    !t._temp && h('button', {
      class: 'icon-btn sm card-more', title: 'Действия',
      onclick: e => { e.stopPropagation(); cardMenu(e.currentTarget, t); },
    }, icon('more'))),
  // вторая строка, как в макете: «откуда · состояние» — запрос CEO у этапа, «Запрос · 0 из 7» у самого запроса
  (t.parent || TASK_KINDS[t.kind] || waits.length > 0) && h('div', { class: 'card-sub', title: t.parent ? t.parent.unit.name + ' · ' + t.parent.key : '' },
    [t.parent && t.parent.title, !t.parent && TASK_KINDS[t.kind] && TASK_KINDS[t.kind].short + (t.tree ? ` · ${t.tree.done} из ${t.tree.total}` : ''),
      waits.length > 0 && h('span', { title: 'Этап ждёт: ' + waits.join(', ') }, 'ждёт')].filter(Boolean)
      .flatMap((x, i) => (i ? [' · ', x] : [x]))),
  // низ: позиция, чеклист, остальное — тихим текстом; срок только когда горит; справа приоритет и исполнитель
  h('div', { class: 'card-foot' },
    chips,
    cl.length > 0 && h('span', { class: 'meta-ic' + (clDone === cl.length ? ' done' : ''), title: 'Чеклист' }, clDone + '/' + cl.length),
    t.tree && !TASK_KINDS[t.kind] && h('span', { class: 'meta-ic tree-ic' + (t.tree.done === t.tree.total ? ' done' : t.tree.overdue ? ' late' : ''),
      title: `Подзадачи ниже: готово ${t.tree.done} из ${t.tree.total}` + (t.tree.overdue ? `, просрочено ${t.tree.overdue}` : '') }, icon('tree', 13), t.tree.done + '/' + t.tree.total),
    t.commentCount > 0 && h('span', { class: 'meta-ic', title: 'Комментарии' }, icon('message', 13), t.commentCount),
    due && due.cls && h('span', { class: 'due ' + due.cls, title: due.hint }, due.text),
    ...visibleLinkFields().filter(f => t.links && t.links[f.id]).map(f => h('a', {
      class: 'meta-ic card-link', href: safeUrl(t.links[f.id]), target: '_blank', rel: 'noopener noreferrer', title: f.name,
      onclick: e => e.stopPropagation(), onpointerdown: e => e.stopPropagation(),
    }, icon(f.kind === 'link' ? 'link' : f.kind, 13))),
    h('span', { class: 'spacer' }), prioEl, person && avatar(person, 'sm')));
}

export function fieldChip(f, t) {
  const v = t.fields[f.id];
  if (isEmpty(v)) return null;
  const optChip = o => h('span', { class: 'chip tag', title: f.name, style: { '--dc': o.color } }, o.name);
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
  const open = { label: 'Открыть', icon: 'arrow', action: () => navigate({ unit: S.board.unit.id, mode: S.route.mode, task: t.id }) };
  // Из «Готово» — быстро вернуть в работу (в последнюю колонку перед готовыми)
  const back = taskDone(t) && [...columns()].reverse().find(c => c.kind !== 'done');
  const reopen = back && canEditTask(t) && { label: `Вернуть в «${back.name}»`, icon: 'back', action: () => patchTask(t, { status: back.id }) };
  const recall = canRecall(t) && { label: 'Забрать из ревью', icon: 'back', action: () => recallReview(t) };
  if (!isStaff()) {
    // Участник: открыть и (в своей задаче) перенести в колонку
    return menu(anchor, [open, reopen, recall, ...(canEditTask(t) ? [{ sep: true }, { title: 'Переместить' },
      ...cols.map(c => ({ label: c.name, icon: KIND_ICONS[c.kind], action: () => patchTask(t, { status: c.id }) }))] : [])]);
  }
  menu(anchor, [
    open,
    reopen,
    recall,
    { sep: true },
    { title: 'Переместить' },
    ...cols.map(c => ({ label: c.name, icon: KIND_ICONS[c.kind], action: () => patchTask(t, { status: c.id }) })),
    !B.department.hidden && activeDepts().length > 0 && { sep: true },
    !B.department.hidden && activeDepts().length > 0 && { title: 'Позиция' },
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
    ...KINDS.map(k => ({ label: h('span', { class: 'fm-row' }, KIND_LABELS[k], col.kind === k && icon('check', 14)), icon: KIND_ICONS[k], action: () => { if (col.kind !== k) patch({ kind: k }); } })),
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
    if (await confirmDlg('', { title: `Удалить колонку «${col.name}»?`, ok: 'Удалить', danger: true })) saveColumns(rest.map(c => ({ ...c }))).catch(showErr);
    return;
  }
  const target = h('select', { class: 'inp' }, rest.map(c => h('option', { value: c.id }, c.name)));
  modal({
    title: `Удалить колонку «${col.name}»`,
    cls: 'dlg',
    body: [
      h('p', { class: 'hint' }, `В колонке ${count} ${count === 1 ? 'задача' : count < 5 ? 'задачи' : 'задач'}. Куда их перенести?`),
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
  if (!isStaff()) return null;
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
  const cols = [
    { key: 'key', label: 'Ключ', val: t => t.num, cell: t => h('span', { class: 'key-badge' }, taskKey(t)) },
    { key: 'title', label: B.title.label, cls: 't-title', val: t => t.title.toLowerCase(), cell: t => t.title },
    !B.department.hidden && {
      key: 'dept', label: B.department.label, val: t => (deptById(t.departmentId) || { order: 1e9 }).order,
      cell: t => h('span', { class: 'muted' }, (deptById(t.departmentId) || {}).name || '—'),
    },
    !B.assignee.hidden && {
      key: 'assignee', label: B.assignee.label, val: t => (personById(t.assigneeId) || { name: '￿' }).name.toLowerCase(),
      cell: t => { const p = personById(t.assigneeId); return p ? p.name : h('span', { class: 'muted' }, '—'); },
    },
    !B.dueDate.hidden && {
      key: 'due', label: B.dueDate.label, val: t => t.dueDate || '9999',
      cell: t => { const d = dueInfo(t.dueDate, taskDone(t)); return d ? h('span', { class: 'due ' + d.cls, title: d.hint }, d.text) : h('span', { class: 'muted' }, '—'); },
    },
    ...activeFields().filter(f => f.showOnCard && f.type !== 'longtext').map(f => ({
      key: f.id, label: f.name, val: t => fmtValue(f, t.fields[f.id]).toLowerCase(),
      cell: t => { const c = fieldChip(f, t); return c ? h('span', { class: 'chips' }, c) : h('span', { class: 'muted' }, '—'); },
    })),
  ].filter(Boolean);

  // Задачи сгруппированы по колонкам доски (в их порядке); сортировка по заголовку — внутри группы
  const sort = S.listSort;
  const col = cols.find(c => c.key === sort.key);
  // По умолчанию — как на доске: приоритет, затем ручной порядок
  const tasks = filterTasks().sort(col ? (a, b) => {
    const x = col.val(a), y = col.val(b);
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
  } : byPriority());
  const groups = columns().map(c => ({ c, list: tasks.filter(t => colById(t.status) === c), more: oldDoneToggle(c) })).filter(g => g.list.length || g.more);
  const taskRow = t => h('tr', {
    class: (t.archived ? 'archived' : '') + (taskDone(t) ? ' done' : ''),
    onclick: () => { if (!t._temp) navigate({ unit: S.board.unit.id, mode: 'list', task: t.id }); },
    oncontextmenu: e => { e.preventDefault(); cardMenu({ x: e.clientX, y: e.clientY }, t); },
  }, cols.map(c => h('td', { class: (c.cls || '') + ' c-' + c.key }, c.cell(t))));

  fill(container, h('div', { class: 'page', style: { maxWidth: 'none' } },
    tasks.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'tasks unit-list' },
        h('thead', null, h('tr', null, cols.map(c => h('th', { class: 'c-' + c.key,
          onclick: () => { S.listSort = { key: c.key, dir: sort.key === c.key ? -sort.dir : 1 }; renderTasks(); },
        }, c.label, sort.key === c.key ? (sort.dir > 0 ? ' ↑' : ' ↓') : '')))),
        groups.map(({ c, list, more }) => h('tbody', { class: 'grp' },
          h('tr', { class: 'grp-head' }, h('td', { colspan: cols.length },
            h('span', { class: 'grp-name' }, statusDot(colColor(c), 8), c.name + ' · ' + list.length))),
          list.map(taskRow),
          more && h('tr', { class: 'grp-more' }, h('td', { colspan: cols.length }, more))))))
      : h('div', { class: 'card-box empty-state' },
        h('h2', null, S.board.tasks.length ? 'Ничего не найдено' : 'Задач пока нет'),
        h('p', null, S.board.tasks.length ? 'Попробуйте изменить фильтры.' : isStaff() ? 'Создайте первую задачу в этом юните.' : 'Здесь появятся задачи юнита, когда вас назначат.'),
        !S.board.tasks.length && isStaff() && h('button', { class: 'btn primary', onclick: () => openCreateTask() }, icon('plus', 15), 'Создать задачу'))));
}

/* ================= Изменение задач ================= */

/** Оптимистично применяет patch и отправляет на сервер. */
/** Задача на ревью, и отправил её я — могу забрать обратно (что-то забыл). */
export const canRecall = t => !!S.meId && t.reviewFrom === S.meId && t.status === (S.board.unit.settings.review || {}).column;

export function recallReview(t) {
  return send('recallReview', { id: t.id }).then(real => {
    Object.assign(t, real);
    renderTasks();
    if (S.panelTaskId === t.id) refreshPanel(t);
    toast('Задача снова у вас: «' + colName(t.status) + '»');
  }).catch(showErr);
}

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
      // Сервер мог назначить задачу на меня сам (ревью) — счётчик новых сразу, не дожидаясь пульса
      if (real.assigneeId === S.meId && t.assigneeId !== S.meId) { S.unread += 1; renderUnread(); }
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
