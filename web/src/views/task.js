import {
  S, LS, me, taskById, personById, activeFields, missingNext, taskKey, isEmpty, optById, dueInfo, fmtDateTime, relTime, addDays,
  unitById, safeUrl, visibleLinkFields, REQUEST_TYPES, appById, isSuper, ceoDefault, KIND_COLORS, whoName, teamById, activeTeams, colById, colColor, taskDone, activeDepts, deptById, isStaff, canEditTask, fmtValue,
} from '../state.js';
import { $, h, append, icon, avatar, autosize, field, linkify, menu, modal, confirmDlg, toast, showErr, statusDot, fill, prioSelect } from '../ui.js';
import { call, send } from '../api.js';
import { navigate, rerender } from '../router.js';
import { renderTasks, patchTask, reloadBoard, loadBoard, canRecall, recallReview } from './board.js';
import { addMemberDialog } from './people.js';
import { openCreateUnit } from './units.js';
import { activityText } from './feed.js';
import { readNote } from './home.js';
import { releaseBlock, releaseHidden } from './release.js';
import { brandIcon, brandOf } from './brand.js';
import { isWatched, toggleWatch, canWatch } from './watch.js';
import { reviewButtons } from './review.js';
import { clTemplates, templateSelect, openTemplatesEditor } from './cltemplates.js';
import { attachMentions } from './mention.js';

/* ================= Панель задачи ================= */

export function closePanel() {
  S.panelTaskId = null;
  S.peek = false;
  fill($('#panel-root'));
}

export function closeTask() {
  if (S.peek) {
    // Карточка была открыта поверх страницы: закрываем; страницу под ней обновляем, только если задачу меняли
    const t = taskById(S.panelTaskId);
    const changed = !t || t.updatedAt !== S.peekStamp;
    closePanel();
    if (changed) rerender();
    return;
  }
  if (S.board) navigate({ unit: S.board.unit.id, mode: S.route.mode === 'settings' ? 'board' : S.route.mode });
}

/** Открыть задачу поверх текущей страницы (главная, панель админа, мои задачи). На доске этого юнита — как обычно. */
export async function peekTask(unitId, taskId) {
  if (S.route.unit === unitId) return navigate({ unit: unitId, mode: S.route.mode === 'settings' ? 'board' : S.route.mode, task: taskId });
  try {
    if (!S.board || S.board.unit.id !== unitId) await loadBoard(unitId);
  } catch (e) {
    return showErr(e);
  }
  S.peek = true;
  S.peekStamp = (taskById(taskId) || {}).updatedAt;
  openTask(taskId);
}

/** Где открывается карточка задачи: справа (по умолчанию) или по центру. Запоминается в браузере. */
const cardCenter = () => LS.get('cardMode', 'side') === 'center';

export function openTask(id) {
  const t = taskById(id);
  if (!t) {
    toast('Задача не найдена — возможно, её удалили или перенесли', { type: 'error' });
    return closeTask();
  }
  S.panelTaskId = id;
  readNote(id);
  fill($('#panel-root'),
    h('div', { class: 'panel-backdrop' + (cardCenter() ? ' center' : ''), onclick: closeTask }),
    buildPanel(t));
}

/** soft — обновить только служебную информацию, не трогая поля ввода (чтобы не сбить фокус). */
export function refreshPanel(t, { soft = false } = {}) {
  if (S.panelTaskId !== t.id) return;
  if (soft) {
    const meta = $('#task-meta');
    if (meta) fill(meta, ...metaLines(t));
    return;
  }
  openTask(t.id);
}

function buildPanel(t) {
  const u = S.board.unit;
  const B = u.settings.builtins;

  const staff = isStaff();
  const editable = canEditTask(t);
  const title = autosize(h('textarea', {
    class: 'title-inp', rows: 1, value: t.title, maxlength: 500, 'aria-label': B.title.label, readonly: !staff,
    onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } },
    onchange: e => {
      const v = e.target.value.trim();
      if (!v) { e.target.value = t.title; return; }
      patchTask(t, { title: v });
    },
  }));

  // карточка релиза: блоки по настройке RM («Настроить карточку релиза»)
  const relHide = id => t.step === 'release' && releaseHidden().includes(id);
  const main = h('div', { class: 'panel-main' },
    title,
    // я — ревьюер этой задачи: решение явными кнопками
    t.reviewFrom && t.reviewFrom !== S.meId && t.assigneeId === S.meId && t.status === ((unitById(t.unitId) || u).settings.review || {}).column
      ? h('div', { class: 'review-bar' }, icon('eye', 15),
        h('span', null, 'На ревью от ', h('b', null, (personById(t.reviewFrom) || {}).name || 'автора')),
        h('span', { class: 'spacer' }),
        reviewButtons(t, res => { Object.assign(t, res); if (S.board && S.board.unit.id === t.unitId) renderTasks(); refreshPanel(t); }))
      : canRecall(t)
      ? h('div', { class: 'readonly-note recall' }, icon('eye', 14),
        h('span', null, 'На ревью у ' + ((personById(t.assigneeId) || {}).name || 'ревьюера') + '. Что-то забыли?'),
        h('button', { class: 'btn sm', onclick: () => recallReview(t) }, icon('back', 13), 'Забрать из ревью'))
      : !editable && h('div', { class: 'readonly-note' }, icon('alert', 14), 'Только просмотр: менять можно свои задачи'),
    // тестирование: нашли баги — вернуть предыдущий этап (разработку) в работу со списком багов
    t.step === 'qa' && !taskDone(t) && (t.assigneeId === S.meId || isStaff()) && h('div', { class: 'qa-bar' }, icon('alert', 15),
      h('span', null, 'Нашли баги?'), h('span', { class: 'spacer' }),
      h('button', { class: 'btn sm', onclick: () => openQaReturn(t) }, icon('back', 13), 'Вернуть в разработку')),
    t.step === 'release' && t.assigneeId && releaseBlock(t, () => reloadBoard().catch(() => {})),
    t.kind === 'request' || t.kind === 'stage' ? [flowBlock(t), t.kind === 'stage' && treeBlock(t)] : treeBlock(t),
    !B.description.hidden && !relHide('description') && descriptionBlock(t, B.description.label, editable),
    !relHide('spec') && specBlock(t, editable),
    !relHide('tasklinks') && linksBlock(t, editable),
    !relHide('checklist') && checklistBlock(t, editable),
    discussionBlock(t, editable));

  const head = h('div', { class: 'panel-head' },
    h('div', { class: 'crumbs' },
      h('button', { class: 'unit-link', title: 'Открыть доску юнита', onclick: openUnitBoard }, h('span', { class: 'unit-dot', style: { background: u.color, margin: 0 } }), u.name),
      h('span', null, '/'),
      h('span', { class: 'key-badge' }, taskKey(t)),
      t.archived && h('span', { class: 'badge' }, 'в архиве')),
    h('span', { class: 'spacer' }),
    h('button', { class: 'icon-btn', title: 'Действия', 'aria-haspopup': 'menu', onclick: e => { e.stopPropagation(); panelMenu(e.currentTarget, t, staff); } }, icon('more', 18)),
    h('button', { class: 'icon-btn', title: 'Закрыть (Esc)', onclick: closeTask }, icon('x', 18)));

  return h('aside', { class: 'panel' + (cardCenter() ? ' center' : ''), role: 'dialog', 'aria-label': taskKey(t) },
    head,
    h('div', { class: 'panel-body' }, main, sideBlock(t, { staff, editable })));
}

/** Связи задачи: откуда она (цепочка родителей) и подзадачи с прогрессом. Пусто — блока нет. */
function treeBlock(t) {
  const box = h('div', { class: 'tree-block' });
  const u = S.board.unit;
  const statusChip = n => h('span', { class: 'chip st-chip', style: { '--sc': n.statusColor || KIND_COLORS[n.statusKind] } }, n.statusName);
  const row = n => h('button', { class: 'tree-row', style: { '--depth': n.depth - 1 }, onclick: () => peekTask(n.unit.id, n.id) },
    h('span', { class: 'dot', style: { background: n.statusColor || KIND_COLORS[n.statusKind] } }),
    h('span', { class: 'tree-title' + (n.statusKind === 'done' ? ' done' : '') }, n.title),
    n.unit && n.unit.id !== u.id && h('span', { class: 'unit-chip' }, h('span', { class: 'unit-dot', style: { background: n.unit.color, margin: 0 } }), n.unit.name),
    statusChip(n),
    n.assigneeId && avatar(personById(n.assigneeId), 'sm'));
  async function load() {
    let tree;
    try { tree = await call('getTaskTree', { id: t.id }); } catch { return; }
    if (S.panelTaskId !== t.id) return;
    const tasks = tree.descendants.filter(n => !n.archived);
    const done = tasks.filter(n => n.statusKind === 'done').length;
    fill(box,
      tree.ancestors.length > 0 && h('div', { class: 'tree-up' }, icon('tree', 13),
        tree.ancestors.map((a, i) => [i > 0 && h('span', { class: 'muted' }, '›'),
          h('button', { class: 'link-btn', title: a.unit ? a.unit.name : '', onclick: () => peekTask(a.unit.id, a.id) }, a.title)])),
      tasks.length > 0 && h('div', { class: 'tree-head' },
        h('span', { class: 'sub-title', style: { margin: 0 } }, 'Подзадачи'),
        h('span', { class: 'muted' }, `${done} из ${tasks.length} готово`)),
      tasks.length > 0 && h('div', { class: 'progress tree-progress' }, h('div', { style: { width: Math.round(done / tasks.length * 100) + '%' } })),
      tasks.length > 0 && h('div', { class: 'tree-group' }, tasks.map(row)));
  }
  load();
  return box;
}

/**
 * Tasks 2.0: запрос CEO — приложение, этапы флоу (состояние, блокировки), «Разложить по флоу»;
 * этап — к какому запросу относится, чего ждёт, у релиза — «Передать в релиз» (когда всё закрыто).
 */
function flowBlock(t) {
  const box = h('div', { class: 'tree-block flow-block' });
  const app = appById(t.appId);
  const manage = isSuper() || (isStaff() && (S.board.members || []).some(m => m.personId === S.meId)); // CEO или PM юнита
  const appTag = app && h('span', { class: 'flow-app' }, h('span', { class: 'uc-icon xs', style: { background: app.color } }, app.name.slice(0, 2).toUpperCase()), app.name);
  const reload = () => { load(); reloadBoard().catch(() => {}); };
  const stateOf = (n, all) => {
    if (n.statusKind === 'done') return 'done';
    const blocked = (n.dependsOn || []).some(id => { const d = all.find(x => x.id === id); return d && d.statusKind !== 'done'; });
    return blocked ? 'blocked' : n.statusKind === 'todo' ? 'todo' : 'progress';
  };
  const LABEL = { done: 'готово', progress: 'в работе', blocked: 'ждёт предыдущих', todo: 'не начато' };
  const ICON = { done: 'check', progress: 'progress', blocked: 'lock', todo: 'circle' };
  const stageRow = (n, all) => {
    const st = stateOf(n, all);
    const releaseReady = n.step === 'release' && !n.assigneeId && st !== 'blocked' && st !== 'done';
    return h('div', { class: 'rq-stage st-' + st + (n.id === t.id ? ' current' : '') },
      h('span', { class: 'rq-ic', title: LABEL[st] }, icon(ICON[st], 13)),
      h('button', { class: 'link-btn rq-stitle', onclick: () => peekTask(n.unit.id, n.id) }, n.title.split(' · ')[0]),
      h('span', { class: 'muted rq-state' }, LABEL[st]),
      releaseReady && manage
        ? h('button', { class: 'btn primary sm', onclick: () => import('./apps.js').then(m => m.sendRelease(n.id)).then(reload) }, icon('rocket', 13), 'Передать в релиз')
        : n.assigneeId ? avatar(personById(n.assigneeId), 'sm') : h('span', { class: 'muted rq-who' }, n.step === 'release' ? 'RM' : '—'));
  };
  async function load() {
    let tree;
    try { tree = await call('getTaskTree', { id: t.kind === 'stage' && t.parentId ? t.parentId : t.id }); } catch { return; }
    if (S.panelTaskId !== t.id) return;
    const req = tree.task;
    const stages = tree.descendants.filter(n => n.depth === 1 && n.kind === 'stage' && !n.archived);
    const done = stages.filter(n => stateOf(n, stages) === 'done').length;
    const me = stages.find(n => n.id === t.id);
    const waits = me && stateOf(me, stages) === 'blocked'
      ? stages.filter(n => (me.dependsOn || []).includes(n.id) && stateOf(n, stages) !== 'done').map(n => n.title.split(' · ')[0]) : [];
    fill(box,
      h('div', { class: 'tree-head' },
        h('span', { class: 'sub-title', style: { margin: 0 } }, t.kind === 'request' ? (REQUEST_TYPES[t.requestType] || 'Запрос') + ' · этапы' : 'Этап запроса'),
        appTag, stages.length > 0 && h('span', { class: 'muted' }, `${done} из ${stages.length} готово`)),
      t.kind === 'stage' && h('div', { class: 'tree-up' }, icon('tree', 13),
        h('button', { class: 'link-btn', onclick: () => peekTask(req.unit.id, req.id) }, req.title)),
      waits.length > 0 && h('div', { class: 'readonly-note flow-wait' }, icon('lock', 14),
        h('span', null, 'Этап заблокирован: сначала закройте ', h('b', null, waits.join(', ')), '. До этого его нельзя сдвинуть из «не начато».')),
      stages.length > 0 && h('div', { class: 'progress' }, h('div', { style: { width: Math.round(done / stages.length * 100) + '%' } })),
      stages.length > 0 && h('div', { class: 'rq-stages' }, stages.map(n => stageRow(n, stages))),
      t.kind === 'request' && !stages.length && h('div', { class: 'rq-empty' },
        h('span', { class: 'muted' }, manage ? 'Разложите задачу по этапам флоу: дизайн → iOS → QA, мета параллельно, релиз последним.' : 'PM ещё не разложил задачу по этапам.'),
        manage && h('button', { class: 'btn primary sm', onclick: () => import('./apps.js')
          .then(m => m.openDecomposeDialog({ id: t.id, unitId: t.unitId, type: t.requestType, title: t.title, dueDate: t.dueDate })).then(ok => ok && reload()) },
        icon('tree', 13), 'Разложить по флоу')));
  }
  load();
  return box;
}

/** Кому лид может передать задачу: люди юнита с позицией задачи (кроме него). */
function handoverPeople(t) {
  return (S.board.members || []).map(m => personById(m.personId))
    .filter(p => p && p.active && p.id !== S.meId && (!t.departmentId || (p.positionIds || []).includes(t.departmentId)))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

/** QA: «Вернуть в разработку» — список багов уйдёт комментарием в этап разработки, он снова в работе, тестирование ждёт. */
function openQaReturn(t) {
  const ta = h('textarea', { class: 'inp', rows: 6, maxlength: 5000, placeholder: '1. Краш при открытии онбординга\n2. Кнопка «Купить» не реагирует на iPhone SE\n…' });
  modal({
    title: 'Вернуть в разработку',
    body: [h('p', { class: 'hint', style: { margin: '0 0 8px' } }, 'Этап разработки снова будет в работе у исполнителя, баги — комментарием в нём. Тестирование подождёт исправлений.'),
      field('Баги', ta)],
    actions: [{ label: 'Отмена' }, { label: 'Вернуть', primary: true, action: async close => {
      if (!ta.value.trim()) { ta.focus(); return; }
      await send('qaReturn', { taskId: t.id, text: ta.value.trim() });
      close();
      toast('Вернули в разработку');
      if (S.board && S.board.unit.id === t.unitId) await reloadBoard().catch(() => {});
      refreshPanel(t);
    } }],
  });
  setTimeout(() => ta.focus(), 0);
}

/** Команда релиза (для RM): PM, дизайн, разработка, тестирование, мета — кто делал приложение. */
function releaseTeamBlock(t) {
  const box = h('div', { class: 'rel-team' });
  const ROLES = [['pm', 'PM'], ['design', 'Дизайн'], ['ios', 'Разработка'], ['qa', 'Тестирование'], ['meta', 'Мета (ASO)']];
  call('getReleaseTeam', { taskId: t.id }).then(team => {
    if (S.panelTaskId !== t.id) return;
    fill(box, h('div', { class: 'rel-team-title' }, 'Команда'),
      ROLES.filter(([k]) => (team[k] || []).length).map(([k, label]) => h('div', { class: 'prop' }, h('label', null, label),
        h('div', { class: 'rel-team-people' }, team[k].map(id => personById(id)).filter(Boolean).map(p => h('span', { class: 'rel-person' }, avatar(p, 'sm'), p.name))))));
  }).catch(() => fill(box));
  return box;
}

/** Меню «Из шаблона»: свои шаблоны чеклистов; onPick(items). */
function templateMenu(anchor, onPick) {
  const list = clTemplates();
  menu(anchor, [{ title: 'Шаблон чеклиста' },
    ...list.map(x => ({ label: `${x.name} · ${x.items.length}`, icon: 'checklist', action: () => onPick(x.items) })),
    !list.length && h('p', { class: 'muted', style: { padding: '4px 10px', margin: 0 } }, 'Шаблонов пока нет'),
    { sep: true },
    { label: 'Шаблоны чеклистов…', icon: 'settings', action: () => openTemplatesEditor() }]);
}

/**
 * «Раздать» (лид — свой этап): строки «что сделать — кому — срок — шаблон чеклиста». Сотрудники — люди позиции в юните,
 * рядом — сколько у них открытых задач. ТЗ, описание и ссылки подзадачи берут из этапа; этап закроется, когда закроют все.
 */
function openSplit(t, people) {
  const load = id => (S.board && S.board.unit.id === t.unitId ? S.board.tasks.filter(x => !x.archived && !taskDone(x) && x.assigneeId === id).length : null);
  const rows = h('div', { class: 'split-rows' });
  const lines = [];
  const add = (focus = true) => {
    const title = h('input', { class: 'inp', maxlength: 500, placeholder: 'Что сделать, например «Онбординг»' });
    const who = h('select', { class: 'inp', 'aria-label': 'Кому' }, h('option', { value: '' }, '— кому —'),
      people.map(p => { const n = load(p.id); return h('option', { value: p.id }, p.name + (n == null ? '' : ` · ${n} в работе`)); }));
    if (people.length === 1) who.value = people[0].id;
    const due = h('input', { class: 'inp', type: 'date', value: t.dueDate || '', 'aria-label': 'Срок' });
    const tpl = templateSelect(() => {});
    const row = h('div', { class: 'split-row' }, title, who, due, tpl,
      h('button', { class: 'icon-btn sm', title: 'Убрать строку', onclick: () => { lines.splice(lines.indexOf(line), 1); row.remove(); } }, icon('x', 14)));
    const line = { title, who, due, tpl };
    lines.push(line);
    rows.append(row);
    title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); add(); } });
    if (focus) title.focus();
  };
  add(false);
  modal({
    title: 'Раздать · ' + t.title,
    wide: true,
    body: [
      h('p', { class: 'hint', style: { margin: '0 0 10px' } }, 'Подзадачи получат ТЗ, описание и ссылки этого этапа. Вы — ревьюер; этап закроется сам, когда примете все подзадачи.'),
      h('div', { class: 'split-head muted' }, h('span', null, 'Что сделать'), h('span', null, 'Кому'), h('span', null, 'Срок'), h('span', null, 'Чеклист'), h('span')),
      rows,
      h('button', { class: 'btn sm', onclick: () => add() }, icon('plus', 13), 'Строка'),
    ],
    actions: [{ label: 'Отмена' }, {
      label: 'Раздать', primary: true,
      action: async close => {
        const items = lines.map(l => ({ title: l.title.value.trim(), assigneeId: l.who.value, dueDate: l.due.value, checklist: l.tpl.items() })).filter(x => x.title);
        if (!items.length) { lines[0] && lines[0].title.focus(); return; }
        if (items.some(x => !x.assigneeId)) { toast('Выберите, кому каждая подзадача', { type: 'error' }); return; }
        const created = await send('splitTask', { taskId: t.id, items });
        close();
        toast(`Роздано: ${created.length}`);
        if (S.board && S.board.unit.id === t.unitId) { await reloadBoard().catch(() => {}); }
        refreshPanel(t);
      },
    }],
  });
}

async function handOver(t, p) {
  try {
    const saved = await send('handOverTask', { taskId: t.id, personId: p.id });
    Object.assign(t, saved);
    toast('Передано: ' + p.name);
    await reloadBoard().catch(() => {});
    if (S.panelTaskId === t.id) openTask(t.id);
  } catch (e) { showErr(e); }
}

/** Перейти на доску юнита (из карточки, открытой поверх дашборда — с этой же задачей). */
function openUnitBoard(t) {
  const unitId = S.board.unit.id;
  const taskId = t && t.id ? t.id : null;
  S.peek = false;
  closePanel();
  navigate({ unit: unitId, mode: 'board', task: taskId });
}

/** Действия карточки задачи — одним меню «⋯»: вид, ссылка, доска; руководителю ещё дубль, перенос, архив, удаление. */
function panelMenu(anchor, t, staff) {
  const others = S.board.units.filter(x => x.id !== S.board.unit.id && !x.archived);
  menu(anchor, [
    { label: cardCenter() ? 'Открывать справа' : 'Открывать по центру', icon: cardCenter() ? 'panelSide' : 'panelCenter', action: () => { LS.set('cardMode', cardCenter() ? 'side' : 'center'); openTask(t.id); } },
    { label: 'Скопировать ссылку', icon: 'link', action: () => copyLink(t) },
    S.peek && !ceoDefault() && { label: 'Открыть на доске юнита', icon: 'board', action: () => openUnitBoard(t) },
    canWatch() && { label: isWatched('task', t.id) ? 'Не отслеживать на дашборде' : 'Отслеживать на дашборде', icon: 'eye', action: () => toggleWatch('task', t.id, t.unitId, t.title) },
    staff && { sep: true },
    staff && { label: 'Дублировать', icon: 'copy', action: () => duplicateTask(t) },
    staff && others.length > 0 && { label: 'Перенести в другой юнит…', icon: 'arrow', action: () => moveTaskDialog(t) },
    staff && { label: t.archived ? 'Вернуть из архива' : 'В архив', icon: 'archive', action: () => { patchTask(t, { archived: !t.archived }); refreshPanel(t); } },
    staff && { sep: true },
    staff && { label: 'Удалить', icon: 'trash', danger: true, action: () => deleteTaskUndoable(t) },
  ]);
}

function copyLink(t) {
  const url = location.origin + location.pathname + '#/u/' + t.unitId + '?task=' + t.id;
  (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
    .then(() => toast('Ссылка на ' + taskKey(t) + ' скопирована'), () => toast(url));
}

/* ---------- ссылки ---------- */

/** Ссылки задачи (Figma, GitHub…): только поля, открытые позиции человека. Правка на месте: карандаш → поле → Enter. */
function linksBlock(t, editable) {
  const fields = visibleLinkFields();
  const links = t.links || (t.links = {});
  if (!fields.length || (!editable && !fields.some(f => links[f.id]))) return null;
  const box = h('div', { class: 'block' });
  const row = f => {
    const url = links[f.id] || '';
    const el = h('div', { class: 'link-row' });
    const view = () => fill(el,
      h('span', { class: 'lf-ic' }, brandIcon(brandOf(f.name, f.kind, url), 15, f.kind === 'link' ? 'link' : f.kind)),
      h('span', { class: 'link-name' }, f.name),
      url
        ? h('a', { class: 'link-url', href: safeUrl(url), target: '_blank', rel: 'noopener noreferrer', title: url }, url.replace(/^https?:\/\/(www\.)?/, ''))
        : editable ? h('button', { class: 'link-add', onclick: edit }, 'Добавить ссылку') : h('span', { class: 'muted' }, '—'),
      editable && url && h('button', { class: 'icon-btn sm link-edit', title: 'Изменить', onclick: edit }, icon('edit', 13)));
    const edit = () => {
      const inp = h('input', { class: 'inp sm', value: url, placeholder: 'https://…', maxlength: 2000 });
      const save = async () => {
        const v = inp.value.trim();
        if (v === url) return view();
        inp.disabled = true;
        try {
          const saved = await send('setTaskLink', { taskId: t.id, fieldId: f.id, url: v });
          if (saved) links[f.id] = saved; else delete links[f.id];
          if (!S.peek) renderTasks();
          fill(box, ...draw());
        } catch (e) { inp.disabled = false; showErr(e); }
      };
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        if (e.key === 'Escape') { e.stopPropagation(); view(); }
      });
      fill(el, h('span', { class: 'lf-ic' }, brandIcon(brandOf(f.name, f.kind, url), 15, f.kind === 'link' ? 'link' : f.kind)), h('span', { class: 'link-name' }, f.name), inp,
        h('button', { class: 'btn primary sm', onclick: save }, 'OK'),
        h('button', { class: 'btn ghost sm', onclick: view }, 'Отмена'));
      inp.focus();
      inp.select();
    };
    view();
    return el;
  };
  const draw = () => [h('div', { class: 'block-title' }, 'Ссылки'),
    h('div', { class: 'links' }, fields.filter(f => editable || links[f.id]).map(row))];
  fill(box, ...draw());
  return box;
}

/* ---------- описание ---------- */

function descriptionBlock(t, label, editable) {
  const box = h('div', { class: 'block' });
  const view = () => fill(box,
    h('div', { class: 'block-title' }, label, h('span', { class: 'spacer' }),
      editable && t.description && h('button', { class: 'link-btn', onclick: edit }, 'Изменить')),
    t.description
      ? h('div', { class: 'desc-view' + (editable ? '' : ' readonly'), title: editable ? 'Нажмите, чтобы изменить' : '', onclick: e => { if (editable && !e.target.closest('a') && !getSelection().toString()) edit(); } }, linkify(t.description))
      : editable ? h('button', { class: 'desc-empty', onclick: edit }, 'Добавьте описание: контекст, ссылки, критерии готовности…') : h('p', { class: 'muted' }, 'Описания нет'));
  const edit = () => {
    const ta = attachMentions(autosize(h('textarea', { class: 'inp desc-edit', value: t.description, maxlength: 20000 })), t.unitId);
    const save = () => { if (ta.value.trim() !== t.description) patchTask(t, { description: ta.value.trim() }); view(); };
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
      if (e.key === 'Escape') { e.stopPropagation(); view(); }
    });
    fill(box, 
      h('div', { class: 'block-title' }, label),
      ta,
      h('div', { class: 'edit-actions' },
        h('button', { class: 'btn primary sm', onclick: save }, 'Сохранить'),
        h('button', { class: 'btn ghost sm', onclick: view }, 'Отмена'),
        h('span', { class: 'hint' }, '⌘/Ctrl + Enter — сохранить')));
    ta.focus();
  };
  view();
  return box;
}

/* ---------- ТЗ ---------- */

/** ТЗ задачи — ссылка: открыть, скопировать, правка кликом по строке. Наследуется этапами и подзадачами от родителя. */
function specBlock(t, editable) {
  const box = h('div', { class: 'block' });
  const view = () => {
    const url = t.specUrl || '';
    fill(box,
      h('div', { class: 'block-title' }, 'ТЗ'),
      url
        ? h('div', { class: 'spec-row' + (editable ? ' editable' : ''), title: editable ? 'Нажмите, чтобы изменить' : '', onclick: e => { if (editable && !e.target.closest('a, button')) edit(); } },
          h('span', { class: 'lf-ic' }, brandIcon(brandOf(url), 15, 'link')),
          h('a', { class: 'spec-url', href: safeUrl(url), target: '_blank', rel: 'noopener noreferrer', title: url }, url.replace(/^https?:\/\/(www\.)?/, '')),
          h('button', { class: 'icon-btn sm', title: 'Скопировать', onclick: () => (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Ссылка на ТЗ скопирована'), () => toast(url)) }, icon('copy', 13)))
        : editable ? h('button', { class: 'desc-empty spec-empty', onclick: edit }, icon('link', 14), 'Добавить ссылку на ТЗ')
          : h('p', { class: 'muted' }, 'ТЗ нет'));
  };
  const edit = () => {
    const inp = h('input', { class: 'inp', type: 'url', value: t.specUrl || '', placeholder: 'https://docs.google.com/…', maxlength: 2000 });
    const save = () => { const v = inp.value.trim(); if (v !== (t.specUrl || '')) patchTask(t, { specUrl: v }).then(() => refreshPanel(t)); else view(); };
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key === 'Escape') { e.stopPropagation(); view(); }
    });
    inp.addEventListener('blur', save);
    fill(box, h('div', { class: 'block-title' }, 'ТЗ'), inp);
    inp.focus();
  };
  view();
  return box;
}

/* ---------- чеклист ---------- */

function checklistBlock(t, editable) {
  const box = h('div', { class: 'block' });
  if (!editable) {
    const items = t.checklist || [];
    if (!items.length) return null;
    return append(box, h('div', { class: 'block-title' }, 'Чеклист', h('span', { class: 'muted', style: { fontWeight: 400 } }, items.filter(i => i.done).length + ' из ' + items.length)),
      h('div', { class: 'cl-list' }, items.map(it => h('div', { class: 'cl-item' + (it.done ? ' done' : '') },
        h('input', { type: 'checkbox', checked: it.done, disabled: true }), h('span', { class: 'cl-text' }, it.text)))));
  }
  const update = (next, focusAdd) => { patchTask(t, { checklist: next }); draw(focusAdd); };
  const draw = focusAdd => {
    const items = t.checklist || [];
    const done = items.filter(i => i.done).length;
    const pct = items.length ? Math.round((done / items.length) * 100) : 0;
    const add = h('input', {
      class: 'inp cl-add', placeholder: 'Добавить пункт и нажать Enter', maxlength: 300,
      onkeydown: e => {
        if (e.key !== 'Enter' || !e.target.value.trim()) return;
        e.preventDefault();
        update(items.concat({ id: 'k_' + Math.random().toString(36).slice(2, 12), text: e.target.value.trim(), done: false }), true);
      },
    });
    fill(box, 
      h('div', { class: 'block-title' }, 'Чеклист',
        items.length > 0 && h('span', { class: 'muted', style: { fontWeight: 400 } }, done + ' из ' + items.length),
        h('span', { class: 'spacer' }),
        h('button', { class: 'link-btn', onclick: e => { e.stopPropagation(); templateMenu(e.currentTarget, list => update(items.concat(list.map(text => ({ id: 'k_' + Math.random().toString(36).slice(2, 12), text, done: false }))))); } }, 'Из шаблона'),
        done > 0 && h('button', { class: 'link-btn', onclick: () => update(items.filter(i => !i.done)) }, 'Убрать выполненные')),
      items.length > 0 && h('div', { class: 'progress' }, h('div', { style: { width: pct + '%' } })),
      h('div', { class: 'cl-list' }, items.map(it => h('div', { class: 'cl-item' + (it.done ? ' done' : '') },
        h('input', { type: 'checkbox', checked: it.done, onchange: e => update(items.map(x => (x === it ? { ...x, done: e.target.checked } : x))) }),
        h('input', {
          class: 'cl-text', value: it.text, maxlength: 300,
          onkeydown: e => { if (e.key === 'Enter') e.target.blur(); },
          onchange: e => {
            const v = e.target.value.trim();
            update(v ? items.map(x => (x === it ? { ...x, text: v } : x)) : items.filter(x => x !== it));
          },
        }),
        h('button', { class: 'icon-btn sm cl-del', title: 'Удалить пункт', onclick: () => update(items.filter(x => x !== it)) }, icon('x', 14))))),
      add);
    if (focusAdd) add.focus();
  };
  draw();
  return box;
}

/* ---------- комментарии и история ---------- */

function discussionBlock(t, editable) {
  let tab = 'comments';
  let data = null;
  let editing = null;
  const box = h('div', { class: 'block' });

  const load = async () => {
    try {
      data = await call('getTaskExtras', { taskId: t.id });
      t.commentCount = data.comments.length;
      if (S.panelTaskId === t.id) draw();
    } catch (e) { showErr(e); }
  };

  const tabBtn = (id, label, n) => h('button', { class: 'tab' + (tab === id ? ' on' : ''), onclick: () => { tab = id; draw(); } },
    label, n ? h('span', { class: 'muted' }, ' ' + n) : null);

  const comment = c => {
    const p = personById(c.authorId);
    const isEditing = editing === c.id;
    let ta;
    return h('div', { class: 'comment' },
      avatar(p),
      h('div', { class: 'comment-main' },
        h('div', { class: 'comment-head' },
          h('b', null, whoName(c.authorId)),
          h('span', { class: 'when', title: fmtDateTime(c.at) }, relTime(c.at) + (c.editedAt ? ' · изменено' : '')),
          !isEditing && (isStaff() || c.authorId === S.meId) && h('span', { class: 'actions' },
            h('button', { class: 'link-btn', onclick: () => { editing = c.id; draw(); } }, 'Изменить'),
            h('button', { class: 'link-btn danger', onclick: () => removeComment(c) }, 'Удалить'))),
        isEditing
          ? [
            ta = attachMentions(autosize(h('textarea', { class: 'inp', value: c.text, style: { marginTop: '6px' } })), t.unitId),
            h('div', { class: 'edit-actions' },
              h('button', {
                class: 'btn primary sm', onclick: () => {
                  const text = ta.value.trim();
                  if (!text) return;
                  send('updateComment', { id: c.id, text }).then(saved => { Object.assign(c, saved); editing = null; draw(); }).catch(showErr);
                },
              }, 'Сохранить'),
              h('button', { class: 'btn ghost sm', onclick: () => { editing = null; draw(); } }, 'Отмена')),
          ]
          : h('div', { class: 'comment-text' }, linkify(c.text))));
  };

  const removeComment = async c => {
    if (!(await confirmDlg('Удалить комментарий?', { ok: 'Удалить', danger: true }))) return;
    data.comments = data.comments.filter(x => x !== c);
    t.commentCount = data.comments.length;
    draw();
    renderTasks();
    send('deleteComment', { id: c.id }).catch(e => { showErr(e); load(); });
  };

  const composer = () => {
    const ta = attachMentions(autosize(h('textarea', { class: 'inp', rows: 2, placeholder: 'Написать комментарий… (@ — отметить человека)', maxlength: 5000 })), t.unitId);
    const submit = () => {
      const text = ta.value.trim();
      if (!text) return;
      ta.value = '';
      send('addComment', () => ({ taskId: t.id, text })).then(c => {
        data.comments.push(c);
        t.commentCount = data.comments.length;
        renderTasks();
        load(); // подтянуть запись в историю
      }).catch(e => { ta.value = text; showErr(e); });
    };
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } });
    return h('div', { class: 'composer' },
      avatar(personById(S.meId)),
      h('div', { class: 'grow' }, ta,
        h('div', { class: 'row' },
          h('button', { class: 'btn primary sm', onclick: submit }, icon('send', 13), 'Отправить'),
          h('span', { class: 'hint' }, '⌘/Ctrl + Enter'))));
  };

  const history = () => (data.activity.length
    ? h('div', { class: 'timeline' }, data.activity.map(a => {
      return h('div', { class: 'tl-item' },
        h('span', { class: 'tl-dot' }),
        h('div', null,
          h('div', null, h('b', null, whoName(a.actorId)), ' · ', activityText(a)),
          h('div', { class: 'tl-when', title: fmtDateTime(a.at) }, relTime(a.at))));
    }))
    : h('p', { class: 'muted' }, 'Пока пусто'));

  const draw = () => {
    fill(box, 
      h('div', { class: 'tabs' }, tabBtn('comments', 'Комментарии', data ? data.comments.length : t.commentCount), tabBtn('history', 'История')),
      !data
        ? h('div', { class: 'muted' }, 'Загрузка…')
        : tab === 'comments'
          ? [data.comments.map(comment), editable ? composer() : !data.comments.length && h('p', { class: 'muted' }, 'Комментариев нет')]
          : history());
  };
  draw();
  load();
  return box;
}

/* ---------- свойства (правая колонка) ---------- */

/** Значение только для чтения в правой колонке. */
const ro = node => h('div', { class: 'ro-value' }, node || h('span', { class: 'muted' }, '—'));

function sideBlock(t, { staff, editable }) {
  const u = S.board.unit;
  const B = u.settings.builtins;
  const props = h('div', { class: 'props' });
  const prop = (label, control, opts = {}) => {
    if (opts.empty) (control.querySelector('.inp') || control).classList.add('empty-req');
    props.append(h('div', { class: 'prop' }, h('label', { class: opts.required ? 'req' : '' }, label), control, opts.after));
  };

  const dot = statusDot(colColor(colById(t.status)), 9);
  prop(B.status.label, h('div', { class: 'status-wrap' }, dot,
    h('select', {
      class: 'inp', value: colById(t.status).id, disabled: !editable,
      onchange: e => { dot.style.background = colColor(colById(e.target.value)); patchTask(t, { status: e.target.value }); },
    }, u.settings.columns.map(c => h('option', { value: c.id }, c.name)))));

  // Порядок: Статус → Исполнитель → Срок → Приоритет и поля. «Команды» в карточке нет (не нужна — решение заказчика);
  // позиция не показывается — её ставит исполнитель (основная позиция), видимость считается по ней.

  if (!B.assignee.hidden && !staff) {
    const p = personById(t.assigneeId);
    // лид может отдать свою задачу сотруднику своей позиции в этом юните
    const handover = me() && me().access === 'lead' && t.assigneeId === S.meId && !taskDone(t) && handoverPeople(t);
    prop(B.assignee.label, ro(p && h('span', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } }, avatar(p, 'sm'), p.name)), {
      after: handover && handover.length > 0 && h('div', { class: 'quick-chips' },
        h('button', { class: 'quick-chip primary', title: 'Разложить на подзадачи сотрудникам позиции', onclick: () => openSplit(t, handover) }, icon('layers', 12), 'Раздать'),
        h('button', {
          class: 'quick-chip', onclick: e => { e.stopPropagation(); menu(e.currentTarget, [{ title: 'Передать целиком' },
            ...handover.map(x => ({ label: x.name, icon: 'user', action: () => handOver(t, x) }))]); },
        }, icon('users', 12), 'Передать целиком')),
    });
  } else if (!B.assignee.hidden) {
    prop(B.assignee.label, assigneeSelect(t.assigneeId, v => {
      const p = personById(v);
      // команды ещё нет — берём первую команду исполнителя
      const patch = { assigneeId: v };
      if (p && !t.teamId && (p.teamIds || []).length) patch.teamId = p.teamIds[0];
      patchTask(t, patch).then(() => refreshPanel(t));
    }), {
      after: S.meId && t.assigneeId !== S.meId && h('div', { class: 'quick-chips' }, h('button', {
        class: 'quick-chip', onclick: () => { patchTask(t, { assigneeId: S.meId }); refreshPanel(t); },
      }, icon('user', 12), 'Назначить на меня')),
    });
  }

  if (!B.dueDate.hidden && !staff) {
    const info = dueInfo(t.dueDate, taskDone(t));
    prop(B.dueDate.label, ro(info && h('span', { class: 'due ' + info.cls, title: info.hint }, icon('calendar', 12), info.text)));
  } else if (!B.dueDate.hidden) {
    const info = dueInfo(t.dueDate, taskDone(t));
    const setDue = v => { patchTask(t, { dueDate: v }); refreshPanel(t); };
    prop(B.dueDate.label, h('input', { class: 'inp', type: 'date', value: t.dueDate, onchange: e => setDue(e.target.value) }), {
      after: h('div', { class: 'quick-chips' },
        info && info.hint && h('span', { class: 'quick-note' + (info.cls === 'overdue' ? ' overdue' : '') }, info.hint),
        !t.dueDate && [
          h('button', { class: 'quick-chip', onclick: () => setDue(addDays(0)) }, 'Сегодня'),
          h('button', { class: 'quick-chip', onclick: () => setDue(addDays(1)) }, 'Завтра'),
          h('button', { class: 'quick-chip', onclick: () => setDue(addDays(7)) }, 'Через неделю'),
        ],
        t.dueDate && h('button', { class: 'quick-chip', title: 'Убрать срок', onclick: () => setDue('') }, icon('x', 11), 'Убрать')),
    });
  }

  const blocking = missingNext(t);
  // приоритет — сразу после срока, остальные поля — следом
  [...activeFields()].sort((a, b) => (b.role === 'priority') - (a.role === 'priority')).forEach(f => {
    const v = t.fields[f.id];
    prop(f.name, editable && (staff || !f.staffOnly)
      ? fieldInput(f, v, val => patchTask(t, { fields: { [f.id]: isEmpty(val) ? null : val } }))
      : ro(isEmpty(v) ? null : f.type === 'url' && safeUrl(v) ? h('a', { href: safeUrl(v), target: '_blank', rel: 'noopener noreferrer' }, v) : fmtValue(f, v)),
    { required: f.required, empty: editable && blocking.includes(f) });
  });

  return h('div', { class: 'panel-side' }, props, t.step === 'release' && releaseTeamBlock(t), h('div', { class: 'side-meta', id: 'task-meta' }, metaLines(t)));
}

function metaLines(t) {
  const author = personById(t.createdBy);
  return [
    h('div', null, 'Создана ' + fmtDateTime(t.createdAt) + (author ? ' · ' + author.name : '')),
    h('div', null, 'Обновлена ' + relTime(t.updatedAt)),
  ];
}

/* ---------- контролы полей ---------- */

/** Отдел: select с цветной точкой. */
/** Команда задачи: выбор с цветной точкой. */
export function teamSelect(value, onChange) {
  const t = teamById(value);
  const dot = h('span', { class: 'dot', style: { background: t ? t.color : 'var(--border-strong)' } });
  const list = activeTeams();
  if (t && t.archived) list.push(t);
  return h('div', { class: 'status-wrap' }, dot, h('select', {
    class: 'inp', value: value || '',
    onchange: e => { const nt = teamById(e.target.value); dot.style.background = nt ? nt.color : 'var(--border-strong)'; onChange(e.target.value); },
  }, h('option', { value: '' }, '— без команды —'), list.map(x => h('option', { value: x.id }, x.name))));
}

export function deptSelect(value, onChange) {
  const d = deptById(value);
  const dot = h('span', { class: 'dot', style: { background: d ? d.color : 'var(--border-strong)' } });
  const list = activeDepts();
  if (d && d.archived) list.push(d);
  return h('div', { class: 'status-wrap' }, dot, h('select', {
    class: 'inp', value: value || '',
    onchange: e => { const nd = deptById(e.target.value); dot.style.background = nd ? nd.color : 'var(--border-strong)'; onChange(e.target.value); },
  }, h('option', { value: '' }, '— без позиции —'), list.map(x => h('option', { value: x.id }, x.name))));
}

/**
 * Исполнитель: только участники команды (юнита). Текущий исполнитель вне команды тоже показывается.
 * ids — состав, если не текущая доска (например, форма создания с главной).
 */
export function assigneeSelect(value, onChange, { ids, unitId, teamId } = {}) {
  const team = ids || S.board.members.map(m => m.personId);
  // teamId — показываем только людей этой команды; текущий исполнитель остаётся в списке
  const ofTeam = p => !teamId || (p.teamIds || []).includes(teamId);
  const people = team.map(personById).filter(p => p && ((p.active && ofTeam(p)) || p.id === value));
  const outsider = value && !team.includes(value) && personById(value);
  const sel = h('select', {
    class: 'inp', value: value || '',
    onchange: async e => {
      if (e.target.value === '__add') {
        e.target.value = value || '';
        const added = await addMemberDialog(unitId || S.board.unit.id);
        if (added) {
          value = added;
          e.target.insertBefore(h('option', { value: added }, personById(added).name), e.target.querySelector('option[value="__add"]'));
          e.target.value = added;
          onChange(added);
        }
        return;
      }
      value = e.target.value;
      onChange(value);
    },
  },
  h('option', { value: '' }, '— не назначен —'),
  people.map(p => h('option', { value: p.id }, p.name + (ofTeam(p) ? '' : ' (не из этой команды)'))),
  outsider && h('option', { value: outsider.id }, outsider.name + ' (не в юните)'),
  h('option', { value: '__add' }, '＋ Добавить в команду…'));
  return sel;
}

/** Человек для поля типа «Человек»: активные люди (и текущее значение, даже если отключён). */
export function personSelect(value, onChange) {
  const people = S.people.filter(p => p.active || p.id === value);
  return h('select', { class: 'inp', value: value || '', onchange: e => onChange(e.target.value) },
    h('option', { value: '' }, '— не выбран —'),
    people.map(p => h('option', { value: p.id }, p.name + (p.active ? '' : ' (неактивен)'))));
}

/** Контрол для кастомного поля. onChange(value) — пустое значение означает «очистить». */
export function fieldInput(f, v, onChange) {
  // приоритет — свой список с шевронами (как по всей системе), не нативный select
  if (f.role === 'priority' && f.type === 'select') return prioSelect(f.options || [], v || '', id => onChange(id || null));
  switch (f.type) {
    case 'longtext':
      return autosize(h('textarea', { class: 'inp', rows: 2, value: v == null ? '' : String(v), onchange: e => onChange(e.target.value.trim()) }));
    case 'number':
      return h('input', {
        class: 'inp', type: 'number', step: 'any', value: v === '' || v == null || !isFinite(Number(v)) ? '' : Number(v),
        onchange: e => onChange(e.target.value === '' ? null : Number(e.target.value)),
      });
    case 'date':
      return h('input', { class: 'inp', type: 'date', value: /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '', onchange: e => onChange(e.target.value) });
    case 'checkbox':
      return h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!v, onchange: e => onChange(e.target.checked || null) }), 'Да');
    case 'url': {
      const a = h('a', { class: 'icon-btn', target: '_blank', rel: 'noopener noreferrer', title: 'Открыть', href: safeUrl(v) || '#', hidden: !safeUrl(v) }, icon('arrow', 15));
      return h('div', { class: 'row', style: { flexWrap: 'nowrap', gap: '4px' } },
        h('input', {
          class: 'inp', type: 'url', placeholder: 'https://…', value: v == null ? '' : String(v),
          onchange: e => {
            const val = e.target.value.trim();
            onChange(val);
            a.hidden = !safeUrl(val);
            a.href = safeUrl(val) || '#';
          },
        }), a);
    }
    case 'select':
      return h('select', { class: 'inp', value: optById(f, v) ? v : '', onchange: e => onChange(e.target.value) },
        h('option', { value: '' }, '—'),
        f.options.map(o => h('option', { value: o.id }, o.name)));
    case 'multiselect': {
      let cur = (Array.isArray(v) ? v : []).filter(id => optById(f, id));
      const box = h('div', { class: 'row', style: { gap: '6px' } });
      const draw = () => fill(box, ...(f.options.length ? f.options.map(o => {
        const on = cur.includes(o.id);
        return h('button', {
          type: 'button', class: 'opt-toggle' + (on ? ' on' : ''), style: on ? { background: o.color } : null,
          onclick: () => { cur = on ? cur.filter(x => x !== o.id) : cur.concat(o.id); draw(); onChange(cur.slice()); },
        }, o.name);
      }) : [h('span', { class: 'hint' }, 'Нет вариантов — добавьте их в настройках поля')]));
      draw();
      return box;
    }
    case 'person':
      return personSelect(v, onChange);
    default:
      return h('input', { class: 'inp', value: v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v), onchange: e => onChange(e.target.value.trim()) });
  }
}

/* ================= Создание задачи ================= */

export function openCreateTask(opts = {}) {
  if (!isStaff()) return toast('Создавать задачи могут CEO и PM');
  const units = S.units.filter(u => !u.archived);
  if (!units.length) {
    toast('Сначала создайте юнит');
    return openCreateUnit();
  }
  // opts.parent — родительская задача (подзадача: например, ручная задача под запросом CEO)
  const inBoard = !!S.board && (!opts.unitId || opts.unitId === S.board.unit.id);
  // С дашборда для конкретного человека — его первый юнит, исполнитель и позиция подставлены
  const ownUnit = opts.assigneeId && units.find(u => (u.members || []).includes(opts.assigneeId));
  let unit = inBoard ? S.board.unit : unitById(opts.unitId) || ownUnit || units[0];
  const draft = {
    status: opts.status || '', assigneeId: opts.assigneeId || '', dueDate: '', fields: {}, links: {}, teamId: '',
    departmentId: opts.departmentId || (S.filters.depts.length === 1 && inBoard ? S.filters.depts[0] : ''),
  };

  const title = autosize(h('textarea', { class: 'inp title-field', rows: 1, placeholder: 'Что нужно сделать?', maxlength: 500, value: opts.title || '' }));
  title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submitBtn().click(); } });
  const desc = autosize(h('textarea', { class: 'inp', rows: 3, placeholder: 'Описание (необязательно)', maxlength: 20000 }));
  // ТЗ — ссылкой; у подзадачи пусто = возьмётся ТЗ родителя
  const spec = h('input', { class: 'inp', type: 'url', maxlength: 2000, placeholder: opts.parent && opts.parent.specUrl ? 'ТЗ — как у родителя' : 'Ссылка на ТЗ (необязательно)' });
  const more = h('label', { class: 'chk hint' }, h('input', { type: 'checkbox' }), 'Создать ещё одну');
  // Шаблон: подставляет название, описание, позицию, срок и чеклист — дальше можно править
  let used = null;
  const tplNote = h('span', { class: 'hint' });
  const applyTemplate = tpl => {
    used = used === tpl ? null : tpl;
    if (used) {
      title.value = tpl.title || tpl.name;
      desc.value = tpl.description;
      if (tpl.departmentId) draft.departmentId = tpl.departmentId;
      if (tpl.teamId) draft.teamId = tpl.teamId;
      if (tpl.assigneeId) draft.assigneeId = tpl.assigneeId;
      draft.links = { ...tpl.links };
      draft.dueDate = tpl.dueDays >= 0 ? addDays(tpl.dueDays) : draft.dueDate;
      draft.checklist = tpl.checklist.map(i => ({ text: i.text }));
    } else {
      draft.checklist = [];
      draft.links = {};
    }
    tplNote.textContent = draft.checklist && draft.checklist.length ? 'Чеклист из шаблона: ' + draft.checklist.length + ' п.' : '';
    tplRow.querySelectorAll('.quick-chip').forEach(b => b.classList.toggle('on', b.dataset.id === (used && used.id)));
    title.dispatchEvent(new Event('input'));
    desc.dispatchEvent(new Event('input'));
    drawProps();
    drawLinks();
    title.focus();
  };
  const taskTpls = S.templates.filter(x => x.kind !== 'update');
  const tplRow = taskTpls.length > 0 && h('div', { class: 'quick-chips tpl-row' },
    h('span', { class: 'quick-note' }, 'Шаблон:'),
    taskTpls.map(tpl => h('button', { class: 'quick-chip', dataset: { id: tpl.id }, onclick: () => applyTemplate(tpl) }, tpl.name)),
    tplNote);
  const props = h('div', { class: 'grid2' });

  const drawProps = () => {
    const B = unit.settings.builtins;
    fill(props, 
      !inBoard && field('Юнит', h('select', {
        class: 'inp', value: unit.id,
        onchange: e => { unit = unitById(e.target.value); drawProps(); },
      }, units.map(u => h('option', { value: u.id }, u.name + ' · ' + u.key)))),
      field(B.status.label, h('select', { class: 'inp', value: draft.status || unit.settings.columns[0].id, onchange: e => { draft.status = e.target.value; } },
        unit.settings.columns.map(c => h('option', { value: c.id }, c.name)))),
      !B.assignee.hidden && field(B.assignee.label, assigneeSelect(draft.assigneeId, v => {
        draft.assigneeId = v;
        const p = personById(v);
        // команда — его первая, если не выбрана; позиция — основная, если выбранная не его
        if (p && !draft.teamId && (p.teamIds || []).length) draft.teamId = p.teamIds[0];
        if (p && !(p.positionIds || [p.positionId]).includes(draft.departmentId)) draft.departmentId = p.positionId;
        drawProps();
      }, inBoard ? {} : { ids: unit.members || [], unitId: unit.id })),
      // позицию не спрашиваем — её подставит исполнитель (или шаблон)
      !B.dueDate.hidden && field(B.dueDate.label, h('input', { class: 'inp', type: 'date', value: draft.dueDate, onchange: e => { draft.dueDate = e.target.value; } })),
      inBoard && [...activeFields()].sort((a, b) => (b.role === 'priority') - (a.role === 'priority')).map(f => field(f.name + (f.required || f.requiredOnCreate ? ' *' : ''),
        fieldInput(f, draft.fields[f.id], v => { if (isEmpty(v)) delete draft.fields[f.id]; else draft.fields[f.id] = v; }))),
      !inBoard && h('div', { class: 'hint', style: { gridColumn: '1 / -1' } }, 'Дополнительные поля юнита можно заполнить в карточке после создания.'));
  };
  drawProps();

  // Ссылки сразу при создании (то, что видно мне по позиции); шаблон подставляет свои
  const linksBox = h('div');
  const drawLinks = () => {
    const fields = visibleLinkFields();
    fill(linksBox, fields.length > 0 && h('div', { class: 'field', style: { marginTop: '14px' } }, h('label', null, 'Ссылки'),
      h('div', { class: 'links' }, fields.map(f => h('div', { class: 'link-row' },
        h('span', { class: 'lf-ic' }, brandIcon(brandOf(f.name, f.kind), 15, f.kind === 'link' ? 'link' : f.kind)), h('span', { class: 'link-name' }, f.name),
        h('input', {
          class: 'inp sm', value: draft.links[f.id] || '', placeholder: 'https://…', maxlength: 2000,
          oninput: e => { if (e.target.value.trim()) draft.links[f.id] = e.target.value.trim(); else delete draft.links[f.id]; },
        }))))));
  };
  drawLinks();

  const close = modal({
    title: opts.parent ? 'Подзадача' : 'Новая задача',
    wide: true,
    body: [
      opts.parent && h('div', { class: 'parent-note' }, icon('tree', 13), 'Часть «', h('b', null, opts.parent.title), '»',
        h('span', { class: 'muted' }, ' · ' + opts.parent.key)),
      tplRow, title, h('div', { style: { height: '10px' } }), desc, h('div', { style: { height: '8px' } }), spec, h('div', { style: { height: '14px' } }), props, linksBox],
    footLeft: more,
    actions: [
      { label: 'Отмена' },
      {
        label: 'Создать', primary: true, action: async () => {
          const text = title.value.trim();
          if (!text) { title.focus(); return; }
          const { links, ...rest } = draft;
          const task = await send('createTask', {
            unitId: unit.id, title: text, description: desc.value, specUrl: spec.value.trim(), ...rest,
            parentId: opts.parent ? opts.parent.id : '', appId: opts.parent && opts.parent.appId ? opts.parent.appId : '',
          });
          // ссылки — отдельной таблицей, после создания задачи
          task.links = {};
          for (const [fieldId, url] of Object.entries(links)) {
            task.links[fieldId] = await send('setTaskLink', { taskId: task.id, fieldId, url }).catch(e => { showErr(e); return ''; });
            if (!task.links[fieldId]) delete task.links[fieldId];
          }
          const key = unit.key + '-' + task.num;
          if (S.board && S.board.unit.id === unit.id) {
            S.board.tasks.push(task);
            renderTasks();
          }
          if (more.querySelector('input').checked) {
            title.value = ''; desc.value = '';
            if (used) applyTemplate(used); // сбросить шаблон
            title.focus();
            toast('Создана ' + key);
            return;
          }
          close();
          if (S.board && S.board.unit.id === unit.id && !opts.parent) {
            toast('Создана ' + key, { action: { label: 'Открыть', run: () => navigate({ unit: unit.id, mode: S.route.mode, task: task.id }) } });
          } else {
            // Не уводим со страницы: задачу можно открыть поверх
            toast('Создана ' + key, { action: { label: 'Открыть', run: () => peekTask(unit.id, task.id) } });
            if (opts.onCreated) opts.onCreated(task);
          }
        },
      },
    ],
  });
  const submitBtn = () => $('#modal-root .modal-foot .btn.primary');
  title.focus();
  return close;
}

/* ================= Действия ================= */

export function duplicateTask(t) {
  const unitId = t.unitId;
  send('duplicateTask', { id: t.id }).then(copy => {
    if (!S.board || S.board.unit.id !== unitId) return;
    S.board.tasks.push(copy);
    renderTasks();
    navigate({ unit: unitId, mode: S.route.mode, task: copy.id });
    toast('Создана копия ' + taskKey(copy));
  }).catch(showErr);
}

/** Удаление с возможностью отмены: на сервер уходит через 5 секунд. */
export function deleteTaskUndoable(t) {
  const key = taskKey(t);
  S.board.tasks = S.board.tasks.filter(x => x !== t);
  if (S.panelTaskId === t.id) closeTask();
  renderTasks();
  let undone = false;
  const timer = setTimeout(() => {
    if (!undone) send('deleteTask', () => ({ id: t.id })).catch(e => { showErr(e); reloadBoard(); });
  }, 5000);
  toast('Задача ' + key + ' удалена', {
    duration: 5000,
    action: {
      label: 'Отменить', run: () => {
        undone = true;
        clearTimeout(timer);
        if (S.board && S.board.unit.id === t.unitId) { S.board.tasks.push(t); renderTasks(); }
      },
    },
  });
}

function moveTaskDialog(t) {
  const others = S.board.units.filter(x => x.id !== S.board.unit.id && !x.archived);
  const sel = h('select', { class: 'inp' }, others.map(u => h('option', { value: u.id }, u.name + ' · ' + u.key)));
  modal({
    title: 'Перенести ' + taskKey(t),
    body: [
      field('В юнит', sel),
      h('p', { class: 'hint', style: { margin: 0 } }, 'Задача получит новый номер. Значения полей, которых нет в том юните, скроются, но не удалятся — при переносе обратно они вернутся.'),
    ],
    actions: [
      { label: 'Отмена' },
      {
        label: 'Перенести', primary: true, action: async close => {
          const target = others.find(u => u.id === sel.value);
          const moved = await send('moveTask', { id: t.id, unitId: target.id });
          close();
          S.board.tasks = S.board.tasks.filter(x => x.id !== t.id);
          closeTask();
          renderTasks();
          toast('Перенесено в «' + target.name + '» как ' + target.key + '-' + moved.num, {
            action: { label: 'Открыть', run: () => navigate({ unit: target.id, mode: 'board', task: moved.id }) },
          });
        },
      },
    ],
  });
}
