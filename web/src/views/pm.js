/**
 * Дашборд PM (главная PM): входящие от CEO (разложить по этапам), приложения по этапам (кто, статус, срок каждого;
 * «Передать в релиз»), проблемы (просрочено, долго на ревью, без исполнителя, без движения, готово к релизу)
 * и команда с KPI за неделю / месяц / квартал. Только юниты PM (видимость решает база).
 */
import { S, me, personById, deptById, REQUEST_TYPES, LS, greeting, plural, fmtDate, todayStr } from '../state.js';
import { $, h, icon, avatar, topbar, showErr, fill, emptyBlock, statusIcon, skeleton } from '../ui.js';
import { call } from '../api.js';
import { currentView } from '../router.js';
import { peekTask, openCreateTask } from './task.js';
import { appIcon, prioTag, isHighPrio, openDecomposeDialog, sendRelease, openAppById } from './apps.js';
import { newsBlock, loadNotes } from './home.js';
import { renderLayout, editLayout } from './layout.js';

export const PERIODS = [['week', 'Неделя'], ['month', 'Месяц'], ['quarter', 'Квартал']];
const STATE = {
  done: { icon: 'check', label: 'готово' },
  progress: { icon: 'progress', label: 'в работе' },
  blocked: { icon: 'lock', label: 'ждёт предыдущих' },
  todo: { icon: 'circle', label: 'не начато' },
};
const stateOf = s => (s.done ? 'done' : s.blocked ? 'blocked' : s.kind === 'todo' ? 'todo' : 'progress');

let editHook = null;
export async function renderPmHome() {
  const page = h('div', { class: 'page ceo-page' }, skeleton());
  fill($('#main'),
    topbar([h('div', { class: 'screen-head' }, h('div', { class: 'screen-date' }, (() => { const t = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }); return t.charAt(0).toUpperCase() + t.slice(1); })()),
      h('h1', { class: 'screen-title' }, 'Дашборд'))], [
      h('button', { class: 'btn', title: 'Блоки и порядок дашборда', onclick: () => editHook && editHook() }, icon('layers', 14), 'Настроить'),
      h('button', { class: 'btn primary', onclick: () => openCreateTask({ onCreated: load }), title: 'Новая задача (C)' }, icon('plus', 15), h('span', { class: 'btn-label' }, 'Новая задача'))]),
    h('div', { class: 'view-body' }, page));
  let period = PERIODS.some(([k]) => k === LS.get('kpiPeriod', '')) ? LS.get('kpiPeriod', '') : 'month';
  let d;
  async function load() {
    try { [d] = await Promise.all([call('getPmDashboard', { today: todayStr(), period }), loadNotes()]); } catch (e) { return showErr(e); }
    if (currentView() !== 'home') return;
    draw();
  }
  function setPeriod(p) { period = p; LS.set('kpiPeriod', p); load(); }
  function draw() { fill(page, renderLayout('pmHome', blocks())); }
  const blocks = () => pmBlocks(d, load, draw, period, setPeriod);
  const edit = () => editLayout('pmHome', blocks(), page, draw, { title: 'Настройка дашборда' });
  editHook = edit;
  load();
}

function pmBlocks(d, reload, redraw, period, setPeriod) {
  return [
    { id: 'news', title: 'Новое для вас', col: 'full', off: true, empty: 'Появится, когда что-то придёт вам', render: () => newsBlock() },
    { id: 'inbox', title: 'Входящие от CEO', col: 'full', render: () => inbox(d, reload) },
    { id: 'pipeline', title: 'Приложения по этапам', col: 'left', render: () => pipeline(d, reload, redraw) },
    { id: 'problems', title: 'Проблемы', col: 'right', render: () => problems(d) },
    { id: 'team', title: 'Команда и KPI', col: 'full', render: () => team(d, period, setPeriod) },
  ];
}

/* ---------- входящие от CEO ---------- */

function inbox(d, reload) {
  if (!d.inbox.length) return null;
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Входящие от CEO'), h('span', { class: 'sec-badge' }, d.inbox.length)),
    h('div', { class: 'card-box att-list' }, d.inbox.map(r => h('div', { class: 'ib-row' },
      r.app ? appIcon(r.app, 'md') : h('span'),
      h('button', { class: 'link-btn ib-title', onclick: () => peekTask(r.unitId, r.id) }, h('b', null, r.app ? r.app.name : ''), h('span', { class: 'muted' }, (r.app ? ' · ' : '') + shortTitle(r))),
      (r.app && prioTag(r.app.priority)) || h('span'),
      r.dueDate && h('span', { class: 'ib-due' + (r.dueDate < todayStr() ? ' late' : '') }, icon('calendar', 14), fmtDate(r.dueDate)),
      h('button', {
        class: 'btn soft sm', onclick: () => openDecomposeDialog({ id: r.id, unitId: r.unitId, type: r.type, title: r.title, dueDate: r.dueDate }).then(ok => ok && reload()),
      }, icon('tree', 13), 'Разложить')))));
}

/* ---------- приложения по этапам ---------- */

// «New App: Streaks» → «New App»: название приложения уже стоит рядом
const shortTitle = r => (r.app ? r.title.replace(new RegExp('\\s*[:·—-]\\s*' + r.app.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), '') : r.title) || r.title;

// Раскрытые карточки (этапы списком) — запоминаются только на сессию, по id запроса
const pipelineOpen = new Set();

function pipeline(d, reload, redraw) {
  const rows = [...d.pipeline].sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  const today = todayStr();
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Приложения по этапам')),
    rows.length ? h('div', { class: 'pl-list' }, rows.map(r => {
      const done = r.stages.filter(s => stateOf(s) === 'done').length;
      const total = r.stages.length;
      const open = pipelineOpen.has(r.id);
      return h('div', { class: 'card-box pl-card' },
        h('div', { class: 'pl-head' },
          r.app && h('button', { class: 'link-btn pl-app', onclick: () => openAppById(r.app.id, reload) }, appIcon(r.app, 'md'), h('b', null, r.app.name)),
          h('button', { class: 'link-btn pl-title', title: r.title, onclick: () => peekTask(r.unitId, r.id) }, shortTitle(r)),
          h('span', { class: 'spacer' }),
          r.dueDate && h('span', { class: 'ib-due' + (r.dueDate < today ? ' late' : ''), title: r.progress + '% этапов готово' }, icon('calendar', 14), fmtDate(r.dueDate))),
        // этапы — выпадающим списком-чеклистом (как в карточке задачи), а не чипами в ряд
        total > 0 && h('button', { class: 'pl-toggle' + (open ? ' open' : ''), 'aria-expanded': String(open),
          onclick: () => { open ? pipelineOpen.delete(r.id) : pipelineOpen.add(r.id); redraw(); } },
          h('span', { class: 'progress' }, h('div', { style: { width: Math.round(done / total * 100) + '%' } })),
          h('span', { class: 'pl-count' }, `${done} из ${total}`),
          icon('chevron', 14)),
        open && h('div', { class: 'rq-stages' }, r.stages.map(s => {
          const st = stateOf(s);
          const p = personById(s.assigneeId);
          const late = !s.done && s.dueDate && s.dueDate < today;
          return h('div', { class: 'rq-stage st-' + st },
            statusIcon(st === 'blocked' ? 'todo' : st, 16),
            h('button', { class: 'link-btn rq-stitle', onclick: () => peekTask(s.unitId, s.id) }, s.title.split(' · ')[0]),
            h('span', { class: 'muted rq-state' }, STATE[st].label),
            late && h('span', { class: 'pl-late', title: 'Просрочено' }, fmtDate(s.dueDate)),
            s.step === 'release' && !s.assigneeId
              ? h('span', { class: 'muted rq-who' }, 'RM')
              : p ? avatar(p, 'sm') : h('span', { class: 'rq-who muted' }, '—'));
        })),
        r.releaseReady && h('div', { class: 'pl-release' }, icon('done', 16), h('span', { class: 'grow' }, 'Все этапы закрыты'),
          h('button', { class: 'btn sm', onclick: () => sendRelease(r.stages.find(s => s.step === 'release').id).then(reload) }, icon('rocket', 13), 'Передать в релиз')));
    }))
      : emptyBlock('Нет работ', { ic: 'progress' }));
}

/* ---------- проблемы ---------- */

// Короткая пометка; красным — только просрочка
const PROB = {
  overdue: { cls: 'danger', text: t => 'просрочено, ' + fmtDate(t.dueDate) },
  release: { cls: 'muted', text: () => 'готово к релизу' },
  review: { cls: 'muted', text: () => 'на ревью 2+ дн.' },
  unassigned: { cls: 'muted', text: () => 'без исполнителя' },
  stale: { cls: 'muted', text: t => 'стоит ' + Math.floor((Date.now() - Date.parse(t.updatedAt)) / 864e5) + ' дн.' },
};

function problems(d) {
  const rows = d.problems;
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Проблемы'), rows.length > 0 && h('span', { class: 'sec-badge' }, rows.length)),
    rows.length ? h('div', { class: 'card-box att-list' }, rows.slice(0, 14).map(x => {
      const a = PROB[x.type], t = x.task;
      const p = personById(t.assigneeId);
      return h('button', { class: 'pb-row', onclick: () => peekTask(t.unitId, t.id) },
        h('span', { class: 'pb-main' }, h('span', { class: 'pb-title' }, t.app ? h('b', null, t.app.name + ' · ') : '', t.title.split(' · ')[0]),
          h('span', { class: 'att-what ' + a.cls }, a.text(t))),
        p ? avatar(p, 'sm') : h('span', { class: 'avatar-gap' }));
    }), rows.length > 14 && h('p', { class: 'muted att-more' }, `и ещё ${rows.length - 14}`))
      : emptyBlock('Проблем нет', { ok: true }));
}

/* ---------- команда и KPI ---------- */

export function team(d, period, setPeriod) {
  const rows = [...d.team].map(k => ({ ...k, p: personById(k.personId) })).filter(k => k.p)
    .sort((a, b) => b.done - a.done || b.inProgress - a.inProgress || a.p.name.localeCompare(b.p.name, 'ru'));
  const pct = v => (v === null ? h('span', { class: 'muted' }, '—') : h('span', { class: v < 50 ? 'warn-text' : '' }, v + '%'));
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Команда и KPI'),
      h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Период' }, PERIODS.map(([k, label]) => h('button', {
        class: period === k ? 'on' : '', role: 'tab', 'aria-selected': String(period === k), onclick: () => period !== k && setPeriod(k),
      }, label)))),
    rows.length ? h('div', { class: 'card-box kpi-table', role: 'table', 'aria-label': 'KPI команды' },
      h('div', { class: 'kt-row kt-head', role: 'row' },
        // пояснения колонок — в подсказках, а не текстом под таблицей
        [['Сотрудник'], ['Сделано', 'Закрыто за период'], ['В срок', 'Доля закрытых в срок'], ['Ср. время', 'От «в работе» до «готово»'], ['В работе', 'Сейчас'], ['Просроч.', 'Просрочено сейчас']]
          .map(([t, tip], i) => h('span', { role: 'columnheader', class: i ? 'num' : '', title: tip || '' }, t))),
      rows.map(k => h('div', { class: 'kt-row', role: 'row' },
        h('span', { class: 'kt-who', role: 'cell' }, avatar(k.p, 'md'), h('span', { 'data-pcard': k.p.id }, h('b', null, k.p.name),
          h('small', { class: 'muted' }, (k.p.positionIds || []).map(id => (deptById(id) || {}).name).filter(Boolean).join(', ')))),
        h('span', { class: 'num', role: 'cell', 'data-label': 'Сделано' }, h('b', null, k.done)),
        h('span', { class: 'num', role: 'cell', 'data-label': 'В срок' }, pct(k.onTime)),
        h('span', { class: 'num', role: 'cell', 'data-label': 'Ср. время' }, k.avgDays === null ? h('span', { class: 'muted' }, '—') : k.avgDays + ' дн.'),
        h('span', { class: 'num', role: 'cell', 'data-label': 'В работе' }, k.inProgress),
        h('span', { class: 'num' + (k.overdue ? ' danger-text' : ' muted'), role: 'cell', 'data-label': 'Просроч.' }, k.overdue))))
      : emptyBlock('Сотрудников пока нет', { ic: 'users' }));
}

