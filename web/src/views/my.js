import { S, todayStr, dueInfo, KIND_COLORS, KIND_LABELS, deptById, ACCESS_LABELS, LS, plural, isStaff, personById } from '../state.js';
import { $, h, icon, avatar, topbar, showErr, fill, statusIcon, emptyBlock, skeleton } from '../ui.js';
import { call } from '../api.js';
import { currentView, taskLink, link } from '../router.js';

let showDone = false;
let query = '';
// чьи задачи: «На мне» или «Поставил я» (следить за ходом поставленных)
let whose = 'mine';
const empty = () => (whose === 'set'
  ? emptyBlock('Вы пока не ставили задач', { ic: 'list', sub: 'Здесь видно ход задач, которые вы поставили другим' })
  : emptyBlock('На вас нет задач', { ic: 'list', sub: 'Когда вас назначат исполнителем, задачи появятся здесь' }));

export async function renderMy() {
  const page = h('div', { class: 'page' }, skeleton());
  fill($('#main'), topbar([h('h1', null, 'Мои задачи')],
    [isStaff() && h('button', { class: 'btn primary', onclick: () => import('./task.js').then(m => m.openCreateTask({ onCreated: reload })) }, 'Задача')]),
  h('div', { class: 'view-body' }, page));

  whose = isStaff() ? LS.get('myWhose', 'mine') : 'mine';
  const fetchTasks = () => (whose === 'set' ? call('queryTasks', { authorId: S.meId, limit: 500 }) : loadMyTasks());
  let tasks;
  try {
    tasks = await fetchTasks();
  } catch (e) {
    showErr(e);
    return;
  }
  if (currentView() !== 'my') return;
  async function reload() {
    try { tasks = await fetchTasks(); } catch (e) { return showErr(e); }
    if (currentView() === 'my') drawList();
  }

  // Вид (по юнитам / по статусу) и «показывать готовые» запоминаем
  let view = LS.get('myView', 'units');
  showDone = LS.get('myShowDone', false) === true;
  const list = h('div');
  const drawList = () => {
    const q = query.trim().toLowerCase();
    const shown = q ? tasks.filter(t => (t.title + ' ' + t.key).toLowerCase().includes(q)) : tasks;
    fill(list, view === 'units' ? unitGroups(shown) : taskGroups(shown));
  };
  const whoseSeg = isStaff() && h('div', { class: 'seg my-whose' });
  const drawWhose = () => whoseSeg && fill(whoseSeg, [['mine', 'На мне'], ['set', 'Поставил я']].map(([v, t]) =>
    h('button', { class: whose === v ? 'on' : '', onclick: () => { whose = v; LS.set('myWhose', v); drawWhose(); reload(); } }, t)));
  drawWhose();
  const controls = h('div', { class: 'my-controls' },
    whoseSeg,
    h('label', { class: 'my-search' }, icon('search', 15),
      h('input', { type: 'search', placeholder: 'Поиск по задачам', value: query, oninput: e => { query = e.target.value; drawList(); } })),
    h('div', { class: 'seg my-view' }),
    h('button', { class: 'my-toggle', role: 'switch', 'aria-checked': String(showDone), onclick: e => {
      showDone = !showDone; LS.set('myShowDone', showDone); e.currentTarget.setAttribute('aria-checked', String(showDone)); drawList();
    } }, h('span', { class: 'sw' }), 'Показывать готовые'));
  const drawSeg = () => fill(controls.querySelector('.my-view'),
    [['units', 'По юнитам', 'layers'], ['status', 'По статусу', 'progress']].map(([v, t, ic]) =>
      h('button', { class: view === v ? 'on' : '', onclick: () => { view = v; LS.set('myView', v); drawSeg(); drawList(); } }, icon(ic, 14), t)));
  drawSeg();
  fill(page, controls, list);
  drawList();
}

/** Сводка над списком: открыто / в работе / просрочено. */
function mySummary(tasks) {
  const today = todayStr();
  const open = tasks.filter(t => t.statusKind !== 'done');
  const late = open.filter(t => t.dueDate && t.dueDate < today).length;
  const prog = open.filter(t => t.statusKind === 'progress').length;
  return h('div', { class: 'my-summary' },
    h('span', null, h('b', null, open.length), ' ' + plural(open.length, ['открытая', 'открытые', 'открытых'])),
    h('span', null, h('span', { class: 'dot', style: { background: KIND_COLORS.progress } }), h('b', null, prog), ' в работе'),
    late > 0 && h('span', { class: 'warn-text' }, h('b', null, late), ' просрочено'));
}

/** Задачи по юнитам: в каждом — просроченные, в работе, к выполнению; готовые — по кнопке. */
export function unitGroups(tasks) {
  const box = h('div', { class: 'unit-groups' });
  const today = todayStr();
  const late = t => t.statusKind !== 'done' && t.dueDate && t.dueDate < today;
  const rank = t => late(t) ? 0 : t.statusKind === 'progress' ? 1 : t.statusKind === 'todo' ? 2 : 3;
  const byDue = (a, b) => rank(a) - rank(b) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
  const units = new Map();
  for (const t of tasks) {
    if (!units.has(t.unit.id)) units.set(t.unit.id, { unit: t.unit, items: [] });
    units.get(t.unit.id).items.push(t);
  }
  const groups = [...units.values()].map(g => ({ ...g, open: g.items.filter(t => t.statusKind !== 'done'), done: g.items.filter(t => t.statusKind === 'done') }))
    .sort((a, b) => b.open.filter(late).length - a.open.filter(late).length || b.open.length - a.open.length || a.unit.name.localeCompare(b.unit.name));
  const draw = () => fill(box, groups.length ? groups.map(g => {
    const items = [...g.open.sort(byDue), ...(showDone ? g.done : [])];
    if (!items.length) return null;
    return h('section', { class: 'ugroup' + (whose === 'set' ? ' set' : '') },
      h('div', { class: 'ugroup-head' },
        h('span', { class: 'dot', style: { background: g.unit.color } }),
        link({ unit: g.unit.id, mode: 'board' }, { class: 'ug-name' }, g.unit.name),
        h('span', { class: 'spacer' }),
        h('span', { class: 'count' }, items.length + ' ' + plural(items.length, ['задача', 'задачи', 'задач']))),
      h('div', { class: 'rows' }, items.map(t => row(t, { unit: false, done: t.statusKind === 'done' }))));
  }) : empty());
  draw();
  return box;
}

export const loadMyTasks = () => call('queryTasks', { assigneeId: S.meId, limit: 500 });

/** Задачи человека по группам: просрочено, в работе, к выполнению, готово (свёрнуто). */
export function taskGroups(tasks) {
  const box = h('div');
  const today = todayStr();
  const byDue = (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
  const overdue = tasks.filter(t => t.statusKind !== 'done' && t.dueDate && t.dueDate < today).sort(byDue);
  const rest = tasks.filter(t => !overdue.includes(t));
  const groups = [
    { title: 'Просрочено', color: 'var(--danger)', items: overdue },
    { title: 'В работе', color: KIND_COLORS.progress, items: rest.filter(t => t.statusKind === 'progress').sort(byDue) },
    { title: 'К выполнению', color: KIND_COLORS.todo, items: rest.filter(t => t.statusKind === 'todo').sort(byDue) },
    { title: 'Готово', color: KIND_COLORS.done, items: rest.filter(t => t.statusKind === 'done'), collapsible: true },
  ];
  const draw = () => fill(box,
    tasks.length
      ? groups.filter(g => g.items.length).map(g => h('div', { class: 'group' },
        h('button', { class: 'group-head', onclick: g.collapsible ? () => { showDone = !showDone; draw(); } : null },
          h('span', { class: 'dot', style: { background: g.color } }), g.title, h('span', { class: 'count' }, g.items.length),
          g.collapsible && h('span', { class: 'muted', style: { fontWeight: 400 } }, showDone ? '— скрыть' : '— показать')),
        (!g.collapsible || showDone) && h('div', { class: 'rows' }, g.items.map(row))))
      : empty());
  draw();
  return box;
}

function row(t, { unit = true, done = false } = {}) {
  const due = dueInfo(t.dueDate, t.statusKind === 'done');
  const d = deptById(t.departmentId);
  const late = due && due.cls.includes('overdue');
  return taskLink(t.unit.id, t.id, { class: 'trow' + (done ? ' done' : ''), title: [t.key, d && d.name].filter(Boolean).join(' · ') },
    whose !== 'set' && statusIcon(t.statusKind === 'progress' && /ревью/i.test(t.statusName) ? 'review' : t.statusKind, 16),
    h('span', { class: 'trow-key' }, t.key),
    h('span', { class: 't-title' }, t.title),
    whose === 'set' ? h('span', { class: 'trow-status ' + t.statusKind }, KIND_LABELS[t.statusKind]) : h('span', { class: 'trow-status' }, h('span', { class: 'trow-chip' }, t.statusName)),
    h('span', { class: 'trow-due' + (late ? ' danger-text' : due ? '' : ' muted'), title: due ? due.hint : '' },
      due ? [whose !== 'set' && icon('calendar', 14), due.text] : whose === 'set' ? '—' : 'Без срока'),
    whose === 'set' && avatar(personById(t.assigneeId), 'sm'),
    unit && h('span', { class: 'muted trow-unit' }, t.unit.name));
}

/** Подпись под именем: роль и позиция. */
export function personCaption(p) {
  if (!p) return '';
  const pos = (p.positionIds || [p.positionId]).map(id => (deptById(id) || {}).name).filter(Boolean).join(', ');
  return [p.access !== 'member' ? ACCESS_LABELS[p.access] : '', pos].filter(Boolean).join(' · ');
}
