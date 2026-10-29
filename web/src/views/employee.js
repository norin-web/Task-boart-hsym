/**
 * Блоки «Моего дашборда» сотрудника и лида: фокус (что делать сейчас), очередь ревью лида («Принять» / «Вернуть»)
 * и загрузка людей позиции лида. Данные — getMyDashboard.
 */
import { personById, deptById, prioById, fmtDate, plural } from '../state.js';
import { h, icon, avatar, toast, showErr } from '../ui.js';
import { send } from '../api.js';
import { peekTask } from './task.js';
import { appIcon, prioTag, isHighPrio } from './apps.js';

// Красным — только просрочка; остальное — серым
const REASON = {
  overdue: { label: 'просрочено', cls: 'danger' },
  today: { label: 'сегодня', cls: 'muted' },
  tomorrow: { label: 'завтра', cls: 'muted' },
  progress: { label: 'в работе', cls: 'muted' },
};

/** Фокус: просроченное, сроки сегодня и завтра, начатое — по важности; заблокированные этапы сюда не попадают. */
export function focusBlock(d) {
  const rows = d.focus;
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Фокус', rows.length > 0 && h('span', { class: 'muted sec-n' }, rows.length))),
    rows.length ? h('div', { class: 'card-box att-list' }, rows.map(t => {
      const r = REASON[t.reason];
      return h('button', { class: 'fc-row', onclick: () => peekTask(t.unitId, t.id) },
        t.app ? appIcon(t.app, 'xs') : h('span'),
        h('span', { class: 'fc-main' }, h('span', { class: 'fc-title' }, t.title), h('span', { class: 'muted fc-sub' }, (t.app ? t.app.name + ' · ' : '') + t.statusName)),
        prioTag(t.priority) || h('span'),
        h('span', { class: 'fc-when ' + r.cls }, t.reason === 'overdue' ? 'срок ' + fmtDate(t.dueDate) : r.label));
    })) : h('div', { class: 'card-box empty-state sm' }, h('p', { class: 'muted' }, 'Горящего нет')));
}

/** Очередь ревью лида: чья задача, «Принять» (в готово) и «Вернуть» (автору, в колонку перед ревью). */
export function reviewsBlock(d, reload) {
  const rows = d.lead.reviews;
  const act = async (t, status, done) => {
    try { await send('updateTask', { id: t.id, patch: { status } }); toast(done); reload(); } catch (e) { showErr(e); }
  };
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Ждут вашего ревью', rows.length > 0 && h('span', { class: 'muted sec-n' }, rows.length))),
    rows.length ? h('div', { class: 'card-box att-list' }, rows.map(t => {
      const author = personById(t.authorId);
      return h('div', { class: 'rv-row' },
        author ? avatar(author, 'sm') : h('span'),
        h('button', { class: 'link-btn fc-main', onclick: () => peekTask(t.unitId, t.id) },
          h('span', { class: 'fc-title' }, t.title), h('span', { class: 'muted fc-sub' }, (author ? author.name : '') + (t.app ? ' · ' + t.app.name : ''))),
        h('div', { class: 'rv-actions' },
          t.acceptStatus && h('button', { class: 'btn primary sm', onclick: () => act(t, t.acceptStatus, 'Принято — задача закрыта') }, icon('check', 13), 'Принять'),
          h('button', { class: 'btn sm', onclick: () => act(t, t.returnStatus, 'Вернули автору') }, icon('back', 13), 'Вернуть')));
    })) : h('div', { class: 'card-box empty-state sm' }, h('p', { class: 'muted' }, 'Ревью никто не ждёт')));
}

/** Загрузка людей позиции лида в его юнитах: открыто, в работе, ждут, просрочено. */
export function teamLoadBlock(d) {
  const rows = d.lead.team.map(x => ({ ...x, p: personById(x.personId) })).filter(x => x.p);
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Загрузка позиции')),
    rows.length ? h('div', { class: 'card-box tl-list' }, rows.map(x => h('div', { class: 'tl-row' },
      avatar(x.p, 'sm'),
      h('span', { class: 'tl-name' }, h('b', null, x.p.name), h('small', { class: 'muted' }, (x.p.positionIds || []).map(id => (deptById(id) || {}).name).filter(Boolean).join(', '))),
      h('span', { class: 'tl-nums' },
        h('span', { title: 'Открытых задач' }, h('b', null, x.open), ' ' + plural(x.open, ['задача', 'задачи', 'задач'])),
        x.inProgress > 0 && h('span', { class: 'muted' }, x.inProgress + ' в работе'),
        x.waiting > 0 && h('span', { class: 'muted' }, x.waiting + ' ждут'),
        x.overdue > 0 && h('span', { class: 'warn-text' }, x.overdue + ' просроч.')))))
      : h('div', { class: 'card-box empty-state sm' }, h('p', { class: 'muted' }, 'Никого нет')));
}
