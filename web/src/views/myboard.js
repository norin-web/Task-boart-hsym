/**
 * Моя доска (#/board): личное рабочее место. Только задачи, назначенные на меня (из всех юнитов),
 * по моим этапам. Этапы — свои (people.prefs.myBoard), старт — шаблон моей команды.
 * Тип этапа (не начато / в работе / готово) двигает статус задачи в юните; мелкие этапы видны только мне.
 */
import Sortable from 'sortablejs';
import { S, me, activeTeams, between, dueInfo, KIND_LABELS, KIND_COLORS, todayStr } from '../state.js';
import { $, h, icon, topbar, fill, modal, toast, showErr, statusDot, confirmDlg } from '../ui.js';
import { call, send } from '../api.js';
import { currentView } from '../router.js';
import { peekTask } from './task.js';
import { columnsEditor } from './settings.js';

const DEFAULT = [
  { id: 's1', name: 'Нужно сделать', kind: 'todo', color: '' },
  { id: 's2', name: 'В работе', kind: 'progress', color: '' },
  { id: 's3', name: 'Готово', kind: 'done', color: '' },
];

/** Шаблон моей команды (первая из моих команд, у которой он есть). */
function teamTemplate() {
  const mine = (me() && me().teamIds) || [];
  const t = activeTeams().find(x => mine.includes(x.id) && (x.boardTemplate || []).length);
  return t ? { team: t, columns: t.boardTemplate } : { team: null, columns: DEFAULT };
}
const myColumns = () => {
  const saved = me() && me().prefs && me().prefs.myBoard && me().prefs.myBoard.columns;
  return saved && saved.length ? saved : teamTemplate().columns;
};

let sortables = [];

export async function renderMyBoard() {
  const page = h('div', { class: 'board-wrap myboard' }, h('div', { class: 'boot' }, h('span', { class: 'spinner' }), 'Загрузка…'));
  const tpl = teamTemplate();
  fill($('#main'),
    topbar([h('h1', null, 'Моя доска'), tpl.team && h('span', { class: 'badge', title: 'Стартовые этапы — от команды' }, tpl.team.name)], [
      h('button', { class: 'btn ghost', onclick: () => editStages(() => renderMyBoard()) }, icon('settings', 15), h('span', { class: 'btn-label' }, 'Этапы')),
    ]),
    h('div', { class: 'view-body' }, page));
  let data;
  try {
    data = await call('getMyBoard', { personId: S.meId, today: todayStr() });
  } catch (e) { showErr(e); return; }
  if (currentView() !== 'myboard') return;
  draw(page, data);
}

/** Тип статуса задачи в её юните. */
const unitKind = (data, t) => {
  const u = data.units.find(x => x.id === t.unitId);
  const c = u && (u.columns.find(x => x.id === t.status) || u.columns[0]);
  return c ? c.kind : 'todo';
};

/** Колонка моей доски для задачи: моё положение, если его тип совпадает со статусом в юните, иначе первый этап того же типа. */
function placeOf(data, cols, t) {
  const kind = unitKind(data, t);
  const p = data.placement[t.id];
  const own = p && cols.find(c => c.id === p.stage);
  if (own && own.kind === kind) return { col: own, order: p.order };
  return { col: cols.find(c => c.kind === kind) || cols[0], order: p ? p.order : t.order };
}

function draw(page, data) {
  sortables.forEach(s => s.destroy());
  sortables = [];
  const cols = myColumns();
  const unitById = id => data.units.find(u => u.id === id);
  const items = data.tasks.map(t => ({ t, ...placeOf(data, cols, t) }));

  const card = ({ t }) => {
    const u = unitById(t.unitId);
    const due = dueInfo(t.dueDate, unitKind(data, t) === 'done');
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
      !mine.length && h('div', { class: 'col-empty' }, 'Пусто'));
    sortables.push(Sortable.create(list, {
      group: 'myboard', animation: 150, draggable: '.card', ghostClass: 'sortable-ghost', fallbackClass: 'sortable-drag', forceFallback: true, fallbackTolerance: 4,
      onEnd: evt => onMove(evt, data, cols, page),
    }));
    return h('section', { class: 'col', style: { '--cc': c.color || KIND_COLORS[c.kind] } },
      h('div', { class: 'col-head' }, statusDot(c.color || KIND_COLORS[c.kind], 9), h('span', { class: 'col-name', title: KIND_LABELS[c.kind] }, c.name), h('span', { class: 'col-count' }, mine.length)),
      list);
  });

  fill(page,
    data.tasks.length ? null : h('p', { class: 'hint my-empty' }, 'На вас пока нет задач. Когда вас назначат исполнителем, они появятся здесь.'),
    h('div', { class: 'board my-board' }, columnEls));
}

/** Перенос: запоминаем этап; если тип этапа другой — меняем статус задачи в юните (не вышло — возвращаем). */
async function onMove(evt, data, cols, page) {
  if (evt.from === evt.to && evt.oldIndex === evt.newIndex) return;
  const id = evt.item.dataset.id;
  const t = data.tasks.find(x => x.id === id);
  const col = cols.find(c => c.id === evt.to.dataset.stage);
  if (!t || !col) return;
  const ids = [...evt.to.querySelectorAll('.card')].map(c => c.dataset.id);
  const i = ids.indexOf(id);
  const ord = id => { const x = data.tasks.find(y => y.id === id); return x && (data.placement[id] ? data.placement[id].order : x.order); };
  const order = between(ord(ids[i - 1]), ord(ids[i + 1]));
  const before = data.placement[id];
  data.placement[id] = { stage: col.id, order };
  try {
    const uk = unitKind(data, t);
    if (col.kind !== uk) {
      const u = data.units.find(x => x.id === t.unitId);
      const target = pickStatus(u, col.kind);
      if (target) Object.assign(t, await send('updateTask', { id: t.id, patch: { status: target } }));
    }
    await send('setMyBoardItem', { personId: S.meId, taskId: id, stage: col.id, order });
  } catch (e) {
    if (before) data.placement[id] = before; else delete data.placement[id];
    showErr(e);
  }
  setTimeout(() => draw(page, data), 0); // перерисовка после того, как Sortable закончит
}

/** Колонка юнита для типа: «в работе» — первая рабочая, кроме колонки ревью; остальное — первая такого типа. */
function pickStatus(u, kind) {
  if (!u) return '';
  const review = ((S.units.find(x => x.id === u.id) || {}).settings || {}).review || {};
  const c = u.columns.find(x => x.kind === kind && x.id !== review.column) || u.columns.find(x => x.kind === kind);
  return c ? c.id : '';
}

/** Свои этапы: название, тип, цвет, порядок. «Как у команды» — вернуть шаблон. */
function editStages(onDone) {
  const tpl = teamTemplate();
  const ed = columnsEditor(myColumns().map(c => ({ ...c })));
  modal({
    title: 'Этапы моей доски', wide: true,
    body: [
      h('p', { class: 'hint', style: { marginTop: 0 } }, 'Доска только ваша — этапы никто, кроме вас, не видит. Тип этапа (не начато / в работе / готово) двигает статус задачи в юните.'),
      ed.el,
    ],
    footLeft: h('button', { class: 'btn ghost sm', onclick: async () => {
      if (!(await confirmDlg('Вернуть этапы как у команды' + (tpl.team ? ' «' + tpl.team.name + '»' : '') + '? Задачи встанут по типу.', { ok: 'Вернуть' }))) return;
      await savePrefs(null);
      document.querySelector('.modal-wrap') && document.querySelector('.modal-wrap').remove();
      onDone();
    } }, 'Как у команды'),
    actions: [
      { label: 'Отмена' },
      { label: 'Сохранить', primary: true, action: async close => {
        const columns = ed.value();
        if (!columns.some(c => c.kind === 'todo') || !columns.some(c => c.kind === 'done')) return toast('Нужен хотя бы один этап «не начато» и один «готово»', { type: 'error' });
        await savePrefs(columns);
        close();
        onDone();
      } },
    ],
  });
}

async function savePrefs(columns) {
  const p = me();
  const myBoard = columns ? { columns } : null;
  p.prefs = { ...(p.prefs || {}), myBoard };
  await send('setMyPrefs', { personId: p.id, prefs: { myBoard } });
}
