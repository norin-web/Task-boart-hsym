import { S, todayStr, dueInfo, KIND_COLORS, KIND_LABELS, deptById, ACCESS_LABELS, LS, plural, isStaff, personById, STEP_NAMES } from '../state.js';
import { $, h, icon, avatar, topbar, showErr, fill, statusIcon, emptyBlock, skeleton } from '../ui.js';
import { call, keep, peek } from '../api.js';
import { currentView, taskLink, link } from '../router.js';
import { renderLayout, editLayout } from './layout.js';
import { onRemote } from '../live.js';

let showDone = false;
let query = '';
// чьи задачи: «На мне» или «Поставил я» (следить за ходом поставленных)
let whose = 'mine';
const empty = () => (whose === 'set'
  ? emptyBlock('Вы пока не ставили задач', { ic: 'list', sub: 'Здесь видно ход задач, которые вы поставили другим' })
  : emptyBlock('На вас нет задач', { ic: 'list', sub: 'Когда вас назначат исполнителем, задачи появятся здесь' }));

export async function renderMy() {
  const page = h('div', { class: 'page' }, skeleton());
  // «Настроить» (вид «По работе»): порядок разделов, какие скрыть, во всю ширину или в колонку — как на дашборде
  let onSetup = () => {};
  const setupBtn = h('button', { class: 'btn my-setup', title: 'Порядок разделов, какие скрыть, во всю ширину или в колонку', onclick: () => onSetup() }, icon('layers', 15), 'Настроить');
  fill($('#main'), topbar([h('h1', null, 'Мои задачи')],
    [setupBtn, isStaff() && h('button', { class: 'btn primary', onclick: () => import('./task.js').then(m => m.openCreateTask({ onCreated: reload })) }, 'Задача')]),
  h('div', { class: 'view-body' }, page));

  whose = isStaff() ? LS.get('myWhose', 'mine') : 'mine';
  const memKey = () => 'my:' + whose;
  const fetchTasks = async () => { const list = await (whose === 'set' ? call('queryTasks', { authorId: S.meId, limit: 500 }) : loadMyTasks()); keep(memKey(), list); return list; };
  // повторный заход — сразу из памяти, свежее — в фоне (в конце, когда экран построен)
  let tasks = peek(memKey());
  const fromMemory = !!tasks;
  if (!tasks) {
    try { tasks = await fetchTasks(); } catch (e) { showErr(e); return; }
  }
  if (currentView() !== 'my') return;
  async function reload({ quiet = false } = {}) {
    const was = quiet ? JSON.stringify(tasks) : '';
    try { tasks = await fetchTasks(); } catch (e) { return quiet ? null : showErr(e); }
    if (currentView() === 'my' && (!quiet || JSON.stringify(tasks) !== was)) { drawTypes(); drawList(); }
  }

  // Вид (по работе / по юнитам / по статусу) и «показывать готовые» запоминаем; «По работе» — только для своих задач
  let view = LS.get('myView2', 'work');
  showDone = LS.get('myShowDone', false) === true;
  const list = h('div');
  // тип задачи: этап (Дизайн, Онбординг и ASO, iOS…), запрос, подзадача, прочее — фильтр «фокус»
  let type = LS.get('myType', '');
  const types = h('div', { class: 'my-types', role: 'radiogroup', 'aria-label': 'Тип задач' });
  const drawTypes = () => {
    const open = tasks.filter(t => showDone || t.statusKind !== 'done');
    const counts = new Map();
    for (const t of open) { const k = typeOf(t); counts.set(k, (counts.get(k) || 0) + 1); }
    const keys = [...counts.keys()].sort((a, b) => typeRank(a) - typeRank(b) || typeName(a).localeCompare(typeName(b), 'ru'));
    if (type && !counts.has(type)) type = '';
    types.hidden = keys.length < 2;
    fill(types, [['', 'Все', open.length], ...keys.map(k => [k, typeName(k), counts.get(k)])].map(([k, label, n]) =>
      h('button', { class: 'fchip' + (type === k ? ' on' : ''), role: 'radio', 'aria-checked': String(type === k), onclick: () => { type = k; LS.set('myType', k); drawTypes(); drawList(); } },
        label, h('span', { class: 'my-type-n' }, n))));
  };
  const drawList = () => {
    const q = query.trim().toLowerCase();
    const byType = type ? tasks.filter(t => typeOf(t) === type) : tasks;
    const shown = q ? byType.filter(t => (t.title + ' ' + t.key).toLowerCase().includes(q)) : byType;
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
      showDone = !showDone; LS.set('myShowDone', showDone); e.currentTarget.setAttribute('aria-checked', String(showDone)); drawTypes(); drawList();
    } }, h('span', { class: 'sw' }), 'Показывать готовые'));
  onSetup = () => {
    const q = query.trim().toLowerCase();
    const byType = type ? tasks.filter(t => typeOf(t) === type) : tasks;
    // настройка — на всю страницу (без фильтров сверху); «Готово» — обратно к списку
    editLayout('myWork', workBlocks(q ? byType.filter(t => (t.title + ' ' + t.key).toLowerCase().includes(q)) : byType), page,
      () => { fill(page, controls, types, list); drawTypes(); drawList(); },
      { title: 'Настройка «Мои задачи»', crumb: 'Мои задачи', hiddenHint: 'перетащите сюда, чтобы не показывать раздел' });
  };
  const drawSeg = () => (setupBtn.hidden = !(view === 'work' && whose !== 'set'), fill(controls.querySelector('.my-view'),
    [whose !== 'set' && ['work', 'По работе', 'list'], ['units', 'По юнитам', 'layers'], ['status', 'По статусу', 'progress']].filter(Boolean).map(([v, t, ic]) =>
      h('button', { class: (view === 'work' && whose === 'set' ? 'units' : view) === v ? 'on' : '', onclick: () => { view = v; LS.set('myView2', v); drawSeg(); drawList(); } }, icon(ic, 14), t))));
  drawSeg();
  fill(page, controls, types, list);
  drawTypes();
  drawList();
  if (fromMemory) reload({ quiet: true });
  onRemote(() => reload({ quiet: true }), () => currentView() === 'my'); // живые обновления
}


/** Тип задачи для фильтра: этап по ключу (design, art, ios…), запрос, подзадача, обычная. */
const typeOf = t => (t.kind === 'request' ? 'req' : t.step === 'part' ? 'part' : t.step ? 'st:' + t.step : 'other');
const typeName = k => (k === 'req' ? 'Запросы' : k === 'part' ? 'Подзадачи' : k === 'other' ? 'Прочее' : STEP_NAMES[k.slice(3)] || k.slice(3));
const STEP_ORDER = Object.keys(STEP_NAMES);
const typeRank = k => (k === 'req' ? -1 : k.startsWith('st:') ? (STEP_ORDER.indexOf(k.slice(3)) + 1 || 50) : k === 'part' ? 90 : 99);

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
    return foldSection('u:' + g.unit.id, whose === 'set' ? 'set' : '', [
      h('span', { class: 'dot', style: { background: g.unit.color } }),
      link({ unit: g.unit.id, mode: 'board' }, { class: 'ug-name' }, g.unit.name),
      h('span', { class: 'spacer' }),
      h('span', { class: 'count' }, items.length + ' ' + plural(items.length, ['задача', 'задачи', 'задач']))],
    h('div', { class: 'rows' }, items.map(t => row(t, { unit: false, done: t.statusKind === 'done' }))));
  }) : empty());
  draw();
  return box;
}

export const loadMyTasks = () => call('queryTasks', { assigneeId: S.meId, limit: 500 });

/** Свёрнутые разделы «Мои задачи» — у каждого свои, в браузере. */
const isFolded = id => !!(LS.get('myFold', {}) || {})[id];
const setFolded = (id, v) => { const f = { ...(LS.get('myFold', {}) || {}) }; if (v) f[id] = 1; else delete f[id]; LS.set('myFold', f); };
/** Раздел со сворачиваемым заголовком: клик по заголовку — свернуть / развернуть (запоминается). */
function foldSection(id, cls, head, body) {
  const sec = h('section', { class: 'ugroup fold ' + cls + (isFolded(id) ? ' folded' : '') });
  const btn = h('div', { class: 'ugroup-head fold-head', role: 'button', tabindex: 0, 'aria-expanded': String(!isFolded(id)),
    onclick: e => { if (e.target.closest('a')) return; toggle(); }, onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } } },
  h('span', { class: 'fold-ic', 'aria-hidden': 'true' }, icon('chevron', 16)), head);
  function toggle() {
    const v = !sec.classList.contains('folded');
    setFolded(id, v);
    sec.classList.toggle('folded', v);
    btn.setAttribute('aria-expanded', String(!v));
  }
  fill(sec, btn, body);
  return sec;
}

/**
 * «По работе»: что разложить (новые приложения, где PM — я, этапов ещё нет), мой дизайн (прогресс по чек-листу),
 * запросы, которые веду как PM (прогресс этапов), и остальное. В каждом разделе — просроченные, в работе, к выполнению.
 */
export function workGroups(tasks) {
  const box = h('div', { class: 'unit-groups work-groups' });
  const defs = workBlocks(tasks);
  const out = renderLayout('myWork', defs);
  fill(box, out.length ? out : empty());
  return box;
}

/** Разделы «По работе» как блоки раскладки: порядок, скрытие и колонку настраивает каждый («Настроить»). */
export function workBlocks(tasks) {
  const today = todayStr();
  const late = t => t.statusKind !== 'done' && t.dueDate && t.dueDate < today;
  const rank = t => late(t) ? 0 : t.statusKind === 'progress' ? 1 : t.statusKind === 'todo' ? 2 : 3;
  const byDue = (a, b) => rank(a) - rank(b) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
  const isReq = t => t.kind === 'request';
  // этап — по самому этапу (у «Метаданных» исполнителя-дизайнера позиция дизайнерская, но это не дизайн);
  // обычная задача и подзадача — по позиции
  const isDesign = t => !isReq(t) && (t.step && t.step !== 'part' ? t.step === 'design' : t.departmentId === 'd_design');
  const checklist = t => { const c = t.checklist || []; return c.length ? { done: c.filter(i => i.done).length, total: c.length } : null; };
  const sections = [
    { id: 'place', title: 'Разложить по этапам', hint: 'Новые приложения и запросы, где PM — вы: этапов ещё нет',
      test: t => isReq(t) && !(t.stages && t.stages.total), prog: () => null },
    { id: 'design', title: 'Дизайн', hint: 'Ваши этапы дизайна: прогресс — по чек-листу', test: isDesign, prog: checklist },
    { id: 'pm', title: 'Веду как PM', hint: 'Разложенные запросы: прогресс — сколько этапов готово', test: t => isReq(t) && t.stages && t.stages.total > 0, prog: t => t.stages },
    { id: 'rest', title: 'Остальное', hint: 'Все прочие задачи на вас', test: () => true, prog: checklist },
  ];
  const taken = new Set();
  return sections.map(sc => {
    const items = tasks.filter(t => !taken.has(t.id) && sc.test(t));
    items.forEach(t => taken.add(t.id));
    const open = items.filter(t => t.statusKind !== 'done').sort(byDue), done = items.filter(t => t.statusKind === 'done');
    return {
      id: sc.id, title: sc.title, col: 'full',
      render: () => {
        const list = [...open, ...(showDone ? done : [])];
        if (!list.length) return null;
        return foldSection('w:' + sc.id, 'wg-' + sc.id, [
          h('span', { title: sc.hint }, sc.title),
          h('span', { class: 'spacer' }),
          open.filter(late).length > 0 && h('span', { class: 'count danger-text' }, 'просрочено ' + open.filter(late).length),
          h('span', { class: 'count' }, open.length + ' ' + plural(open.length, ['задача', 'задачи', 'задач']))],
        h('div', { class: 'rows' }, list.map(t => row(t, { done: t.statusKind === 'done', progress: sc.prog(t), slot: true }))));
      },
    };
  });
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
      ? groups.filter(g => g.items.length).map(g => {
        // «Готово» — по переключателю; остальные группы сворачиваются кликом по заголовку (запоминается)
        const fid = 's:' + g.title;
        const box2 = h('div', { class: 'group' + (!g.collapsible && isFolded(fid) ? ' folded' : '') });
        fill(box2,
          h('button', { class: 'group-head', 'aria-expanded': String(g.collapsible ? showDone : !isFolded(fid)),
            onclick: g.collapsible ? () => { showDone = !showDone; draw(); } : e => { const v = !box2.classList.contains('folded'); setFolded(fid, v); box2.classList.toggle('folded', v); e.currentTarget.setAttribute('aria-expanded', String(!v)); } },
          !g.collapsible && h('span', { class: 'fold-ic', 'aria-hidden': 'true' }, icon('chevron', 14)),
          h('span', { class: 'dot', style: { background: g.color } }), g.title, h('span', { class: 'count' }, g.items.length),
          g.collapsible && h('span', { class: 'muted', style: { fontWeight: 400 } }, showDone ? '— скрыть' : '— показать')),
          (!g.collapsible || showDone) && h('div', { class: 'rows' }, g.items.map(t => row(t))));
        return box2;
      })
      : empty());
  draw();
  return box;
}

function row(t, { unit = true, done = false, progress = null, slot = false } = {}) {
  const due = dueInfo(t.dueDate, t.statusKind === 'done');
  const late = due && due.cls.includes('overdue');
  return taskLink(t.unit.id, t.id, { class: 'trow' + (done ? ' done' : '') },
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
