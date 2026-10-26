import { S, todayStr, dueInfo, KIND_COLORS, deptById, ACCESS_LABELS, LS, plural } from '../state.js';
import { $, h, icon, topbar, showErr, fill } from '../ui.js';
import { call } from '../api.js';
import { currentView, taskLink, link } from '../router.js';

let showDone = false;

export async function renderMy() {
  const page = h('div', { class: 'page' }, h('div', { class: 'boot' }, h('span', { class: 'spinner' }), 'Загрузка…'));
  const tools = h('div', { class: 'row', style: { gap: '8px' } });
  fill($('#main'), topbar([h('h1', null, 'Мои задачи')], [tools]), h('div', { class: 'view-body' }, page));

  let tasks;
  try {
    tasks = await loadMyTasks();
  } catch (e) {
    showErr(e);
    return;
  }
  if (currentView() !== 'my') return;

  // Вид (по юнитам / по статусу) и «показывать готовые» запоминаем
  let view = LS.get('myView', 'units');
  const draw = () => {
    fill(tools,
      h('div', { class: 'seg' }, [['units', 'По юнитам'], ['status', 'По статусу']].map(([v, t]) =>
        h('button', { class: view === v ? 'on' : '', onclick: () => { view = v; LS.set('myView', v); draw(); } }, t))));
    fill(page, tasks.length > 0 && mySummary(tasks), view === 'units' ? unitGroups(tasks) : taskGroups(tasks));
  };
  draw();
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
  const openDone = new Set();

  const draw = () => fill(box, groups.length ? groups.map(g => {
    const lateN = g.open.filter(late).length;
    const showDone = openDone.has(g.unit.id);
    return h('section', { class: 'ugroup' },
      h('div', { class: 'ugroup-head' },
        h('span', { class: 'uc-icon sm', style: { background: g.unit.color } }, (g.unit.key || g.unit.name).slice(0, 2)),
        h('b', null, g.unit.name),
        h('span', { class: 'count' }, g.open.length ? g.open.length + ' ' + plural(g.open.length, ['открытая', 'открытые', 'открытых']) : 'открытых нет'),
        lateN > 0 && h('span', { class: 'warn-text', style: { fontSize: '12px' } }, lateN + ' просроч.'),
        h('span', { class: 'spacer' }),
        g.done.length > 0 && h('button', { class: 'link-btn', onclick: () => { if (showDone) openDone.delete(g.unit.id); else openDone.add(g.unit.id); draw(); } },
          (showDone ? 'Скрыть' : 'Показать') + ' готовые · ' + g.done.length),
        link({ unit: g.unit.id, mode: 'board' }, { class: 'btn ghost sm' }, 'Доска', icon('arrow', 12))),
      (g.open.length > 0 || showDone) && h('div', { class: 'rows' },
        g.open.sort(byDue).map(t => row(t, { unit: false })),
        showDone && g.done.map(t => row(t, { unit: false, done: true }))));
  }) : h('div', { class: 'card-box empty-state' }, h('h2', null, 'На вас нет задач'), h('p', null, 'Когда вас назначат исполнителем, задачи появятся здесь.')));
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
      : h('div', { class: 'card-box empty-state' }, h('h2', null, 'На вас нет задач'), h('p', null, 'Когда вас назначат исполнителем, задачи появятся здесь.')));
  draw();
  return box;
}

function row(t, { unit = true, done = false } = {}) {
  const due = dueInfo(t.dueDate, t.statusKind === 'done');
  const d = deptById(t.departmentId);
  return taskLink(t.unit.id, t.id, { class: 'trow' + (done ? ' done' : '') },
    h('span', { class: 'dot', title: t.statusName, style: { background: t.statusColor || KIND_COLORS[t.statusKind] } }),
    h('span', { class: 'key-badge' }, t.key),
    h('span', { class: 't-title' }, t.title),
    h('span', { class: 'badge' }, t.statusName),
    d && h('span', { class: 'chip dept-chip', style: { background: `color-mix(in srgb, ${d.color} 16%, transparent)`, color: d.color } }, d.name),
    due && h('span', { class: 'due ' + due.cls, title: due.hint }, icon('calendar', 12), due.text),
    unit && h('span', { class: 'unit-chip' }, h('span', { class: 'unit-dot', style: { background: t.unit.color, margin: 0 } }), t.unit.name));
}

/** Подпись под именем: роль и позиция. */
export function personCaption(p) {
  if (!p) return '';
  const pos = (p.positionIds || [p.positionId]).map(id => (deptById(id) || {}).name).filter(Boolean).join(', ');
  return [p.access !== 'member' ? ACCESS_LABELS[p.access] : '', pos].filter(Boolean).join(' · ');
}
