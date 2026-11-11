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

  // Вид (по работе / по юнитам / по статусу) и «показывать готовые» запоминаем; «По работе» — только для своих задач
  let view = LS.get('myView2', 'work');
  showDone = LS.get('myShowDone', false) === true;
  const list = h('div');
  const drawList = () => {
    const q = query.trim().toLowerCase();
    const shown = q ? tasks.filter(t => (t.title + ' ' + t.key).toLowerCase().includes(q)) : tasks;
    const v = view === 'work' && whose === 'set' ? 'units' : view;
    fill(list, v === 'work' ? workGroups(shown) : v === 'units' ? unitGroups(shown) : taskGroups(shown));
  };
  const whoseSeg = isStaff() && h('div', { class: 'seg my-whose' });
  const drawWhose = () => whoseSeg && fill(whoseSeg, [['mine', 'На мне'], ['set', 'Поставил я']].map(([v, t]) =>
    h('button', { class: whose === v ? 'on' : '', onclick: () => { whose = v; LS.set('myWhose', v); drawWhose(); drawSeg(); reload(); } }, t)));
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
    [whose !== 'set' && ['work', 'По работе', 'list'], ['units', 'По юнитам', 'layers'], ['status', 'По статусу', 'progress']].filter(Boolean).map(([v, t, ic]) =>
      h('button', { class: (view === 'work' && whose === 'set' ? 'units' : view) === v ? 'on' : '', onclick: () => { view = v; LS.set('myView2', v); drawSeg(); drawList(); } }, icon(ic, 14), t)));
  drawSeg();
  fill(page, controls, list);
  drawList();
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
  const draw = () => fill(box, groups.some(g => g.open.length || showDone) ? groups.map(g => {
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

/**
 * «По работе»: что разложить (новые приложения, где PM — я, этапов ещё нет), мой дизайн (прогресс по чек-листу),
 * запросы, которые веду как PM (прогресс этапов), и остальное. В каждом разделе — просроченные, в работе, к выполнению.
 */
export function workGroups(tasks) {
  const box = h('div', { class: 'unit-groups work-groups' });
  const today = todayStr();
  const late = t => t.statusKind !== 'done' && t.dueDate && t.dueDate < today;
  const rank = t => late(t) ? 0 : t.statusKind === 'progress' ? 1 : t.statusKind === 'todo' ? 2 : 3;
  const byDue = (a, b) => rank(a) - rank(b) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
  const isReq = t => t.kind === 'request';
  const isDesign = t => !isReq(t) && (t.step === 'design' || t.departmentId === 'd_design');
  const checklist = t => { const c = t.checklist || []; return c.length ? { done: c.filter(i => i.done).length, total: c.length } : null; };
  const sections = [
    { id: 'place', title: 'Разложить по этапам', hint: 'Новые приложения и запросы, где PM — вы: этапов ещё нет',
      test: t => isReq(t) && !(t.stages && t.stages.total), prog: () => null },
    { id: 'design', title: 'Дизайн', hint: 'Ваши этапы дизайна: прогресс — по чек-листу', test: isDesign, prog: checklist },
    { id: 'pm', title: 'Веду как PM', hint: 'Разложенные запросы: прогресс — сколько этапов готово', test: t => isReq(t) && t.stages && t.stages.total > 0, prog: t => t.stages },
    { id: 'rest', title: 'Остальное', test: () => true, prog: checklist },
  ];
  const taken = new Set();
  const groups = sections.map(sc => {
    const items = tasks.filter(t => !taken.has(t.id) && sc.test(t));
    items.forEach(t => taken.add(t.id));
    return { ...sc, open: items.filter(t => t.statusKind !== 'done').sort(byDue), done: items.filter(t => t.statusKind === 'done') };
  });
  const shown = groups.map(g => ({ ...g, items: [...g.open, ...(showDone ? g.done : [])] })).filter(g => g.items.length);
  fill(box, shown.length ? shown.map(g => h('section', { class: 'ugroup wg-' + g.id },
    h('div', { class: 'ugroup-head', title: g.hint || '' },
      h('span', null, g.title),
      h('span', { class: 'spacer' }),
      g.open.filter(late).length > 0 && h('span', { class: 'count danger-text' }, 'просрочено ' + g.open.filter(late).length),
      h('span', { class: 'count' }, g.open.length + ' ' + plural(g.open.length, ['задача', 'задачи', 'задач']))),
    h('div', { class: 'rows' }, g.items.map(t => row(t, { done: t.statusKind === 'done', progress: g.prog(t), slot: true }))))) : empty());
  return box;
}

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

function row(t, { unit = true, done = false, progress = null, slot = false } = {}) {
  const due = dueInfo(t.dueDate, t.statusKind === 'done');
  const d = deptById(t.departmentId);
  const late = due && due.cls.includes('overdue');
  return taskLink(t.unit.id, t.id, { class: 'trow' + (done ? ' done' : ''), title: [t.key, d && d.name].filter(Boolean).join(' · ') },
    whose !== 'set' && statusIcon(t.statusKind === 'progress' && /ревью/i.test(t.statusName) ? 'review' : t.statusKind, 16),
    h('span', { class: 'trow-key' }, t.key),
    h('span', { class: 't-title' }, t.title),
    progress ? h('span', { class: 'trow-prog', title: `Готово ${progress.done} из ${progress.total}` },
      h('span', { class: 'trow-bar' }, h('i', { style: { width: Math.round(progress.done / progress.total * 100) + '%' } })),
      h('span', { class: 'muted' }, `${progress.done}/${progress.total}`))
      : slot && h('span', { class: 'trow-prog', 'aria-hidden': 'true' }), // пустое место — колонки разделов «По работе» стоят ровно
    whose === 'set' ? h('span', { class: 'trow-status st-' + t.statusKind }, KIND_LABELS[t.statusKind]) : h('span', { class: 'trow-status' }, h('span', { class: 'trow-chip' }, t.step === 'release' && (t.release || {}).phase === 'submitted' ? 'Ревью Apple' : t.statusName)),
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
