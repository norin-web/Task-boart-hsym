/**
 * Таймлайн юнита (макет 27): задачи полосами по дням — от создания до срока. Четыре недели, шаг — неделя.
 * Вид доски юнита: переключатель «Доска / Список / Таймлайн» (#/u/:id/timeline).
 */
import { S, personById, colById, deptById, colColor, todayStr, taskKey, taskDone, fmtDate } from '../state.js';
import { $, h, icon, avatar, statusIcon, fill } from '../ui.js';
import { link } from '../router.js';

import { openCreateTask, peekTask } from './task.js';
import { isStaff } from '../state.js';

const DAY = 864e5;
const WEEKS = 4;
const DOW = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

const toDate = s => new Date(s.slice(0, 10) + 'T00:00:00');
const dayIndex = d => Math.round(d / DAY);
const mondayOf = d => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };

let shift = 0; // недель от текущей

/** Переключатель вида юнита: Доска · Список · Таймлайн. */
export function viewSwitch(active) {
  const u = S.board.unit;
  const item = (mode, label, ic) => link({ unit: u.id, mode }, { class: 'vs-item' + (active === mode ? ' on' : '') }, icon(ic, 14), label);
  return h('nav', { class: 'view-switch', 'aria-label': 'Вид' }, item('board', 'Доска', 'board'), item('list', 'Список', 'list'), item('timeline', 'Таймлайн', 'calendar'));
}

export function renderTimeline() {
  const draw = () => {
    const today = toDate(todayStr());
    const start = new Date(mondayOf(today).getTime() + shift * 7 * DAY);
    const n = WEEKS * 7;
    const s0 = dayIndex(start), e0 = s0 + n - 1;
    const tIdx = dayIndex(today);
    const days = Array.from({ length: n }, (_, i) => new Date(start.getTime() + i * DAY));

    // полоса задачи: от создания (но не раньше, чем срок) до срока; без срока — день создания
    const items = S.board.tasks.filter(t => !t.archived).map(t => {
      const created = t.createdAt ? dayIndex(toDate(t.createdAt)) : tIdx;
      const due = t.dueDate ? dayIndex(toDate(t.dueDate)) : null;
      const a = due != null ? Math.min(created, due) : created;
      const b = due != null ? due : created;
      return { t, a, b, open: due == null };
    }).filter(x => x.b >= s0).sort((x, y) => x.a - y.a || x.b - y.b);

    const col = i => ((i - s0) / n) * 100;
    // цвет полосы — позиция исполнителя; закрытая задача серая
    const colorOf = t => (taskDone(t) ? '#787C87' : (deptById(t.departmentId) || {}).color || colColor(colById(t.status)));
    const move = (e, weeks) => { e.stopPropagation(); shift += weeks; draw(); };
    const open = t => peekTask(S.board.unit.id, t.id);
    const bar = ({ t, a, b }) => {
      // задача позже видимых недель: подпись с датой и стрелка к ней
      if (a > e0) return h('div', { class: 'tl-row tl-later' },
        h('button', { class: 'tl-later-text', title: taskKey(t), onclick: () => open(t) }, t.title.split(' · ')[0] + ' · ' + fmtDate(t.dueDate || t.createdAt.slice(0, 10))),
        h('button', { class: 'tl-go', title: 'Показать', style: { background: colorOf(t) }, onclick: e => move(e, Math.ceil((a - e0) / 7)) }, icon('chevron', 13)));
      const ca = Math.max(a, s0), cb = Math.min(b, e0);
      const kind = colById(t.status).kind;
      const p = personById(t.assigneeId);
      return h('div', { class: 'tl-row' },
        h('button', {
          class: 'tl-bar' + (a < s0 ? ' cut-l' : '') + (b > e0 ? ' cut-r' : ''),
          style: { left: col(ca) + '%', width: ((cb - ca + 1) / n) * 100 + '%', '--bc': colorOf(t) },
          title: taskKey(t) + ' · ' + t.title,
          onclick: () => open(t),
        },
        a < s0 && h('span', { class: 'tl-edge', role: 'button', title: 'Раньше', onclick: e => move(e, -1) }, icon('chevron', 13)),
        kind !== 'todo' && statusIcon(kind, 14),
        h('span', { class: 'tl-title' }, t.title),
        b > e0 && p && avatar(p, 'xs'),
        b > e0 && h('span', { class: 'tl-edge', role: 'button', title: 'Позже', onclick: e => move(e, 1) }, icon('chevron', 13))),
        b <= e0 && p && h('span', { class: 'tl-who', style: { left: `calc(${col(cb + 1)}% + 8px)` } }, avatar(p, 'xs')));
    };

    const head = days.map((d, i) => h('div', { class: 'tl-day' + (dayIndex(d) === tIdx ? ' today' : '') + ([0, 6].includes(d.getDay()) ? ' wk' : '') },
      h('small', null, DOW[d.getDay()]), h('b', null, d.getDate())));
    const weekend = days.map((d, i) => [
      [0, 6].includes(d.getDay()) && h('i', { class: 'tl-wk', style: { left: col(s0 + i) + '%', width: 100 / n + '%' } }),
      i > 0 && d.getDay() === 1 && h('i', { class: 'tl-week', style: { left: col(s0 + i) + '%' } })]).flat();
    const todayLine = tIdx >= s0 && tIdx <= e0 && h('i', { class: 'tl-today', style: { left: col(tIdx) + (50 / n) + '%' } });

    fill($('#main'),
      ...unitHeader('board', [isStaff() && h('button', { class: 'btn primary', onclick: () => openCreateTask() }, 'Задача')]),
      h('div', { class: 'view-body tl-page' },
        h('div', { class: 'tl-bar-top' }, viewSwitch('timeline'), h('span', { class: 'spacer' }),
          h('div', { class: 'tl-nav' },
            h('button', { class: 'icon-btn', title: 'Неделей раньше', onclick: () => { shift--; draw(); } }, icon('back', 14)),
            h('button', { class: 'tl-today-btn', onclick: () => { shift = 0; draw(); } }, 'Сегодня, ' + today.getDate() + ' ' + MONTHS[today.getMonth()]),
            h('button', { class: 'icon-btn', title: 'Неделей позже', onclick: () => { shift++; draw(); } }, icon('arrow', 14)))),
        h('div', { class: 'tl-card' },
          h('div', { class: 'tl-head', style: { gridTemplateColumns: `repeat(${n}, 1fr)` } }, head),
          h('div', { class: 'tl-body' }, weekend, todayLine,
            items.length ? items.map(bar) : h('p', { class: 'muted tl-empty' }, 'В эти недели задач нет — сдвиньте период или создайте задачу')))));
  };
  draw();
}
