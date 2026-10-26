/**
 * Моя доска (#/board): личное рабочее место. Только задачи, назначенные на меня (из всех юнитов).
 * Колонки: четыре обязательные — To Do / In Progress / Review / Done (одни у всех: по ним синхронизируется статус в юните)
 * и свои между ними (видны только мне; своя колонка считается той обязательной, что слева).
 * Перенос в In Progress / Done меняет статус задачи в юните, в Review — отдаёт на ревью (колонка ревью юнита, ревьюер — по позиции).
 * Свои колонки — people.prefs.myBoard.custom [{ id, name, group, color }]; старт — шаблон моей команды.
 */
import Sortable from 'sortablejs';
import { S, me, activeTeams, between, dueInfo, todayStr, PALETTE } from '../state.js';
import { $, h, icon, topbar, fill, modal, showErr, statusDot, confirmDlg, menu, closeMenu } from '../ui.js';
import { call, send } from '../api.js';
import { currentView } from '../router.js';
import { peekTask } from './task.js';

/** Обязательные колонки: одинаковы у всех, их не убрать и не переставить. */
export const FIXED = [
  { id: 'c_todo', name: 'To Do', group: 'todo', color: 'var(--st-todo)' },
  { id: 'c_progress', name: 'In Progress', group: 'progress', color: 'var(--st-progress)' },
  { id: 'c_review', name: 'Review', group: 'review', color: '#8b5cf6' },
  { id: 'c_done', name: 'Done', group: 'done', color: 'var(--st-done)' },
];
const GROUPS = FIXED.map(c => c.group);
const KIND_GROUP = { todo: 0, progress: 1, done: 3 };

/** Шаблон моей команды (первая из моих команд, у которой он есть). */
function teamTemplate() {
  const mine = (me() && me().teamIds) || [];
  return activeTeams().find(x => mine.includes(x.id) && (x.boardTemplate || []).length) || null;
}

/**
 * Свои колонки из шаблона команды или прежней версии доски (этапы с типом todo / progress / done):
 * этапы с названием обязательной колонки задают группу и пропускаются; остальные встают после текущей группы.
 */
function fromStages(stages) {
  let g = 0;
  const out = [];
  for (const s of stages || []) {
    const fixed = FIXED.findIndex(c => c.name.toLowerCase() === String(s.name || '').trim().toLowerCase());
    if (fixed >= 0) { g = fixed; continue; }
    g = Math.max(g, KIND_GROUP[s.kind] ?? 1);
    out.push({ id: /^[a-z0-9_]{1,40}$/.test(s.id || '') && !s.id.startsWith('c_') ? s.id : 's' + Math.random().toString(36).slice(2, 8), name: s.name, group: GROUPS[g], color: s.color || '' });
  }
  return out;
}

/** Мои свои колонки: сохранённые, иначе — из прежних этапов доски, иначе — из шаблона команды. */
function myCustom() {
  const mb = (me() && me().prefs && me().prefs.myBoard) || null;
  if (mb && Array.isArray(mb.custom)) return mb.custom.filter(c => GROUPS.includes(c.group));
  if (mb && Array.isArray(mb.columns) && mb.columns.length) return fromStages(mb.columns);
  const tpl = teamTemplate();
  return tpl ? fromStages(tpl.boardTemplate) : [];
}

/** Все колонки по порядку: обязательная, за ней — свои этой группы. */
const allColumns = custom => FIXED.flatMap(f => [{ ...f, fixed: true }, ...custom.filter(c => c.group === f.group).map(c => ({ ...c, fixed: false }))]);

let sortables = [];

export async function renderMyBoard() {
  const page = h('div', { class: 'board-wrap myboard' }, h('div', { class: 'boot' }, h('span', { class: 'spinner' }), 'Загрузка…'));
  fill($('#main'),
    topbar([h('h1', null, 'Моя доска')], [
      h('button', { class: 'btn ghost', onclick: () => editColumns(() => renderMyBoard()) }, icon('settings', 15), h('span', { class: 'btn-label' }, 'Колонки')),
    ]),
    h('div', { class: 'view-body' }, page));
  let data;
  try {
    data = await call('getMyBoard', { personId: S.meId, today: todayStr() });
  } catch (e) { showErr(e); return; }
  if (currentView() !== 'myboard') return;
  draw(page, data);
}

/** Группа задачи по её статусу в юните: не начато / в работе / на ревью (колонка ревью юнита) / готово. */
function groupOf(data, t) {
  const u = data.units.find(x => x.id === t.unitId);
  const c = u && (u.columns.find(x => x.id === t.status) || u.columns[0]);
  if (!c) return 'todo';
  if (c.kind === 'done') return 'done';
  if (c.kind === 'todo') return 'todo';
  const review = ((S.units.find(x => x.id === t.unitId) || {}).settings || {}).review || {};
  return review.column && review.column === t.status ? 'review' : 'progress';
}

/** Колонка доски для задачи: моё положение, если оно в той же группе, иначе — обязательная колонка группы. */
function placeOf(data, cols, t) {
  const g = groupOf(data, t);
  const p = data.placement[t.id];
  const own = p && cols.find(c => c.id === p.stage);
  if (own && own.group === g) return { col: own, order: p.order };
  return { col: cols.find(c => c.fixed && c.group === g), order: p ? p.order : t.order };
}

function draw(page, data) {
  sortables.forEach(s => s.destroy());
  sortables = [];
  const cols = allColumns(myCustom());
  const unitById = id => data.units.find(u => u.id === id);
  const items = data.tasks.map(t => ({ t, ...placeOf(data, cols, t) }));

  const card = ({ t }) => {
    const u = unitById(t.unitId);
    const due = dueInfo(t.dueDate, groupOf(data, t) === 'done');
    return h('article', { class: 'card my-card', dataset: { id: t.id }, tabindex: '0', onclick: () => peekTask(t.unitId, t.id) },
      h('div', { class: 'card-title' }, t.title),
      h('div', { class: 'card-foot' },
        u && h('span', { class: 'my-unit', title: 'Юнит' }, h('span', { class: 'dot', style: { background: u.color } }), u.name),
        h('span', { class: 'spacer' }),
        due && h('span', { class: 'due ' + due.cls, title: due.hint }, icon('calendar', 12), due.text)));
  };

  const columnEls = cols.map(c => {
    const mine = items.filter(i => i.col.id === c.id).sort((a, b) => a.order - b.order);
    const list = h('div', { class: 'col-list', dataset: { stage: c.id } }, mine.map(card),
      !mine.length && h('div', { class: 'col-empty' }, c.group === 'review' && c.fixed ? 'Перетащите сюда — уйдёт на ревью' : 'Пусто'));
    sortables.push(Sortable.create(list, {
      group: 'myboard', animation: 150, draggable: '.card', ghostClass: 'sortable-ghost', fallbackClass: 'sortable-drag', forceFallback: true, fallbackTolerance: 4,
      onEnd: evt => onMove(evt, data, cols, page),
    }));
    const color = c.color || FIXED.find(f => f.group === c.group).color;
    return h('section', { class: 'col' + (c.fixed ? ' fixed' : ' own'), style: { '--cc': color } },
      h('div', { class: 'col-head' }, statusDot(color, 9),
        h('span', { class: 'col-name', title: c.fixed ? 'Обязательная колонка — по ней меняется статус в юните' : 'Ваша колонка · считается как «' + FIXED.find(f => f.group === c.group).name + '»' }, c.name),
        h('span', { class: 'col-count' }, mine.length)),
      list);
  });

  fill(page,
    data.tasks.length ? null : h('p', { class: 'hint my-empty' }, 'На вас пока нет задач. Когда вас назначат исполнителем, они появятся здесь.'),
    h('div', { class: 'board my-board' }, columnEls));
}

/** Перенос: запоминаем колонку; если группа другая — меняем статус задачи в юните (не вышло — возвращаем). */
async function onMove(evt, data, cols, page) {
  if (evt.from === evt.to && evt.oldIndex === evt.newIndex) return;
  const id = evt.item.dataset.id;
  const t = data.tasks.find(x => x.id === id);
  const col = cols.find(c => c.id === evt.to.dataset.stage);
  if (!t || !col) return;
  const ids = [...evt.to.querySelectorAll('.card')].map(c => c.dataset.id);
  const i = ids.indexOf(id);
  const ord = x => { const y = data.tasks.find(z => z.id === x); return y && (data.placement[x] ? data.placement[x].order : y.order); };
  const order = between(ord(ids[i - 1]), ord(ids[i + 1]));
  const before = data.placement[id];
  data.placement[id] = { stage: col.id, order };
  try {
    if (col.group !== groupOf(data, t)) {
      const target = statusFor(data.units.find(x => x.id === t.unitId), col.group);
      if (target) Object.assign(t, await send('updateTask', { id: t.id, patch: { status: target } }));
    }
    await send('setMyBoardItem', { personId: S.meId, taskId: id, stage: col.id, order });
  } catch (e) {
    if (before) data.placement[id] = before; else delete data.placement[id];
    showErr(e);
  }
  // на ревью задача уходит ревьюеру — с моей доски она исчезнет при следующей загрузке
  setTimeout(() => draw(page, data), 0);
}

/** Колонка юнита для группы: Review — колонка ревью юнита (нет — первая рабочая), остальные — первая такого типа. */
function statusFor(u, group) {
  if (!u) return '';
  const review = ((S.units.find(x => x.id === u.id) || {}).settings || {}).review || {};
  if (group === 'review') return review.column || (u.columns.find(x => x.kind === 'progress') || {}).id || '';
  const c = u.columns.find(x => x.kind === group && x.id !== review.column) || u.columns.find(x => x.kind === group);
  return c ? c.id : '';
}

/**
 * Колонки доски: обязательные — на месте (не убрать, не переименовать), свои — между ними: название, цвет,
 * перетаскивание за ручку (своя колонка считается той обязательной, под которой стоит). «Как у команды» — шаблон команды.
 */
function editColumns(onDone) {
  let custom = myCustom().map(c => ({ ...c }));
  const tpl = teamTemplate();
  const list = h('div', { class: 'col-edit-list' });
  let sortable = null;
  const draw = () => {
    const rows = allColumns(custom);
    fill(list, rows.map(c => c.fixed
      ? h('div', { class: 'col-edit-row mb-row locked', dataset: { id: c.id } },
        h('span', { class: 'drag-off', title: 'Обязательная колонка' }, icon('lock', 14)),
        h('span', { class: 'swatch', style: { background: c.color } }),
        h('b', { class: 'mb-name' }, c.name),
        h('span', { class: 'muted mb-note' }, 'обязательная · меняет статус в юните'))
      : h('div', { class: 'col-edit-row mb-row', dataset: { id: c.id } },
        h('span', { class: 'drag', title: 'Перетащите, чтобы изменить место' }, icon('grip', 16)),
        h('button', {
          class: 'swatch', title: 'Цвет', style: { background: c.color || FIXED.find(f => f.group === c.group).color },
          onclick: e => { e.stopPropagation(); menu(e.currentTarget, [h('div', { class: 'colors menu-colors' }, PALETTE.map(p => h('button', { class: 'swatch' + (c.color === p ? ' on' : ''), style: { background: p }, onclick: () => { custom.find(x => x.id === c.id).color = p; closeMenu(); draw(); } })))]); },
        }),
        h('input', { class: 'inp', value: c.name, maxlength: 40, placeholder: 'Название', 'aria-label': 'Название колонки', oninput: e => { custom.find(x => x.id === c.id).name = e.target.value; } }),
        h('button', { class: 'icon-btn sm', title: 'Убрать колонку (задачи встанут в обязательную)', onclick: () => { custom = custom.filter(x => x.id !== c.id); draw(); } }, icon('x', 14)))));
    if (sortable) sortable.destroy();
    sortable = Sortable.create(list, {
      handle: '.drag', filter: '.locked', preventOnFilter: false, animation: 150, ghostClass: 'sortable-ghost', forceFallback: true, fallbackTolerance: 4,
      // выше первой обязательной колонки ставить нельзя
      onMove: evt => !(evt.related && evt.related.dataset.id === 'c_todo' && !evt.willInsertAfter),
      onEnd: () => {
        // группа своей колонки — обязательная, под которой она оказалась
        let g = 'todo';
        const next = [];
        for (const el of list.children) {
          const f = FIXED.find(x => x.id === el.dataset.id);
          if (f) { g = f.group; continue; }
          const c = custom.find(x => x.id === el.dataset.id);
          if (c) next.push({ ...c, group: g });
        }
        custom = next;
        draw();
      },
    });
  };
  draw();
  const add = () => {
    custom.push({ id: 's' + Date.now().toString(36), name: '', group: 'progress', color: '' });
    draw();
    const ins = list.querySelectorAll('input.inp');
    const last = [...ins].find(x => !x.value);
    if (last) last.focus();
  };
  modal({
    title: 'Колонки моей доски', wide: true,
    body: [
      h('p', { class: 'hint', style: { marginTop: 0 } }, 'To Do, In Progress, Review и Done — у всех одни: по ним меняется статус задачи в юните (Review — отдаёт на ревью). Свои колонки ставьте между ними — их видите только вы, а считаются они как обязательная колонка над ними.'),
      list,
      h('button', { class: 'btn sm', onclick: add }, icon('plus', 13), 'Своя колонка'),
    ],
    footLeft: tpl && h('button', { class: 'btn ghost sm', onclick: async () => {
      if (!(await confirmDlg('Вернуть колонки как у команды «' + tpl.name + '»?', { ok: 'Вернуть' }))) return;
      custom = fromStages(tpl.boardTemplate);
      draw();
    } }, 'Как у команды'),
    actions: [
      { label: 'Отмена' },
      { label: 'Сохранить', primary: true, action: async close => {
        await savePrefs(custom.map(c => ({ ...c, name: c.name.trim() || 'Колонка' })));
        close();
        onDone();
      } },
    ],
  });
}

async function savePrefs(custom) {
  const p = me();
  const myBoard = { custom };
  p.prefs = { ...(p.prefs || {}), myBoard };
  await send('setMyPrefs', { personId: p.id, prefs: { myBoard } });
}
