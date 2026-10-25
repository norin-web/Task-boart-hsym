import { S, me, todayStr, dueInfo, KIND_COLORS, deptById, ACCESS_LABELS } from '../state.js';
import { $, h, icon, avatar, topbar, showErr, fill } from '../ui.js';
import { call } from '../api.js';
import { currentView, link } from '../router.js';

let showDone = false;

export async function renderMy() {
  const person = me();
  const page = h('div', { class: 'page' }, h('div', { class: 'boot' }, h('span', { class: 'spinner' }), 'Загрузка…'));
  fill($('#main'),
    topbar([h('h1', null, 'Мои задачи')], [
      person && h('span', { class: 'row', style: { gap: '8px' } }, avatar(person, 'sm'), person.name),
    ]),
    h('div', { class: 'view-body' }, page));

  let tasks;
  try {
    tasks = await loadMyTasks();
  } catch (e) {
    showErr(e);
    return;
  }
  if (currentView() !== 'my') return;
  fill(page, taskGroups(tasks));
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

function row(t) {
  const due = dueInfo(t.dueDate, t.statusKind === 'done');
  const d = deptById(t.departmentId);
  return link({ unit: t.unit.id, mode: 'board', task: t.id }, { class: 'trow' },
    h('span', { class: 'dot', title: t.statusName, style: { background: t.statusColor || KIND_COLORS[t.statusKind] } }),
    h('span', { class: 'key-badge' }, t.key),
    h('span', { class: 't-title' }, t.title),
    h('span', { class: 'badge' }, t.statusName),
    d && h('span', { class: 'chip dept-chip', style: { background: `color-mix(in srgb, ${d.color} 16%, transparent)`, color: d.color } }, d.name),
    due && h('span', { class: 'due ' + due.cls, title: due.hint }, icon('calendar', 12), due.text),
    h('span', { class: 'unit-chip' }, h('span', { class: 'unit-dot', style: { background: t.unit.color, margin: 0 } }), t.unit.name));
}

/** Подпись под именем: роль и позиция. */
export function personCaption(p) {
  if (!p) return '';
  const pos = deptById(p.positionId);
  return [p.access !== 'member' ? ACCESS_LABELS[p.access] : '', pos ? pos.name : ''].filter(Boolean).join(' · ');
}
