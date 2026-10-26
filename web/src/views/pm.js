/**
 * Дашборд PM (главная PM): входящие от CEO (разложить по этапам), приложения по этапам (кто, статус, срок каждого;
 * «Передать в релиз»), проблемы (просрочено, долго на ревью, без исполнителя, без движения, готово к релизу)
 * и команда с KPI за неделю / месяц / квартал. Только юниты PM (видимость решает база).
 */
import { S, me, personById, deptById, REQUEST_TYPES, LS, greeting, plural, fmtDate, todayStr } from '../state.js';
import { $, h, icon, avatar, topbar, showErr, fill } from '../ui.js';
import { call } from '../api.js';
import { currentView } from '../router.js';
import { peekTask, openCreateTask } from './task.js';
import { appIcon, prioTag, openDecomposeDialog, sendRelease, openAppById } from './apps.js';
import { newsBlock, loadNotes } from './home.js';

const PERIODS = [['week', 'Неделя'], ['month', 'Месяц'], ['quarter', 'Квартал']];
const STATE = {
  done: { icon: 'check', label: 'готово' },
  progress: { icon: 'progress', label: 'в работе' },
  blocked: { icon: 'lock', label: 'ждёт предыдущих' },
  todo: { icon: 'circle', label: 'не начато' },
};
const stateOf = s => (s.done ? 'done' : s.blocked ? 'blocked' : s.kind === 'todo' ? 'todo' : 'progress');

export async function renderPmHome() {
  const page = h('div', { class: 'page ceo-page' }, h('div', { class: 'boot' }, h('span', { class: 'spinner' }), 'Загрузка…'));
  fill($('#main'),
    topbar([h('h1', null, 'Дашборд')], [h('button', { class: 'btn primary', onclick: () => openCreateTask({ onCreated: load }), title: 'Новая задача (C)' }, icon('plus', 15), h('span', { class: 'btn-label' }, 'Задача'))]),
    h('div', { class: 'view-body' }, page));
  let period = PERIODS.some(([k]) => k === LS.get('kpiPeriod', '')) ? LS.get('kpiPeriod', '') : 'month';
  async function load() {
    let d;
    try { [d] = await Promise.all([call('getPmDashboard', { today: todayStr(), period }), loadNotes()]); } catch (e) { return showErr(e); }
    if (currentView() !== 'home') return;
    const person = me();
    const units = S.units.filter(u => !u.archived).map(u => u.name);
    fill(page,
      h('div', { class: 'ceo-hello' },
        h('h2', null, greeting() + (person ? ', ' + person.name.split(' ')[0] : '')),
        h('p', { class: 'muted' }, (units.length ? units.join(' · ') + ' · ' : '') + `${d.pipeline.length} ${plural(d.pipeline.length, ['работа', 'работы', 'работ'])} в ходу`
          + (d.inbox.length ? ` · ${d.inbox.length} ждут разбивки` : ''))),
      newsBlock(),
      inbox(d, load),
      h('div', { class: 'home-grid' },
        h('div', { class: 'home-col' }, pipeline(d, load)),
        h('div', { class: 'home-col' }, problems(d))),
      team(d, period, p => { period = p; LS.set('kpiPeriod', p); load(); }));
  }
  load();
}

/* ---------- входящие от CEO ---------- */

function inbox(d, reload) {
  if (!d.inbox.length) return null;
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Входящие от CEO', h('span', { class: 'news-count' }, d.inbox.length))),
    h('div', { class: 'card-box att-list' }, d.inbox.map(r => h('div', { class: 'ib-row' },
      r.app ? appIcon(r.app, 'xs') : h('span'),
      h('button', { class: 'link-btn ib-title', onclick: () => peekTask(r.unitId, r.id) }, h('b', null, r.app ? r.app.name : ''), h('span', { class: 'muted' }, (r.app ? ' · ' : '') + r.title)),
      r.app && prioTag(r.app.priority),
      r.dueDate && h('span', { class: 'muted ib-due' + (r.dueDate < todayStr() ? ' late' : '') }, icon('calendar', 12), fmtDate(r.dueDate)),
      h('button', {
        class: 'btn primary sm', onclick: () => openDecomposeDialog({ id: r.id, unitId: r.unitId, type: r.type, title: r.title, dueDate: r.dueDate }).then(ok => ok && reload()),
      }, icon('tree', 13), 'Разложить')))));
}

/* ---------- приложения по этапам ---------- */

function pipeline(d, reload) {
  const rows = [...d.pipeline].sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  const today = todayStr();
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Приложения по этапам')),
    rows.length ? h('div', { class: 'pl-list' }, rows.map(r => h('div', { class: 'card-box pl-card' },
      h('div', { class: 'pl-head' },
        r.app && h('button', { class: 'link-btn pl-app', onclick: () => openAppById(r.app.id, reload) }, appIcon(r.app, 'xs'), h('b', null, r.app.name)),
        h('span', { class: 'ap-type' }, REQUEST_TYPES[r.type] || 'Задача'),
        h('button', { class: 'link-btn pl-title', onclick: () => peekTask(r.unitId, r.id) }, r.title),
        h('span', { class: 'spacer' }),
        r.dueDate && h('span', { class: 'muted ib-due' + (r.dueDate < today ? ' late' : '') }, icon('calendar', 12), fmtDate(r.dueDate)),
        h('span', { class: 'muted ap-pct' }, r.progress + '%')),
      h('div', { class: 'pl-steps' }, r.stages.map(s => {
        const st = stateOf(s);
        const p = personById(s.assigneeId);
        const late = !s.done && s.dueDate && s.dueDate < today;
        return h('button', { class: 'pl-step st-' + st, title: `${s.title} — ${STATE[st].label}`, onclick: () => peekTask(s.unitId, s.id) },
          h('span', { class: 'pl-ic' }, icon(STATE[st].icon, 12)),
          h('span', { class: 'pl-name' }, s.title.split(' · ')[0]),
          s.step === 'release' && !s.assigneeId
            ? h('span', { class: 'muted pl-who' }, 'RM')
            : p ? avatar(p, 'sm') : h('span', { class: 'warn-text pl-who', title: 'Без исполнителя' }, '?'),
          late && h('span', { class: 'pl-late', title: 'Просрочено' }, fmtDate(s.dueDate)));
      })),
      r.releaseReady && h('div', { class: 'pl-release' }, icon('check', 14), 'Все этапы закрыты',
        h('button', { class: 'btn primary sm', onclick: () => sendRelease(r.stages.find(s => s.step === 'release').id).then(reload) }, icon('rocket', 13), 'Передать в релиз')))))
      : h('div', { class: 'card-box empty-state sm' }, h('p', null, d.inbox.length ? 'Разложите входящие — здесь появится ход работ.' : 'Работ по приложениям сейчас нет.')));
}

/* ---------- проблемы ---------- */

const PROB = {
  overdue: { icon: 'clock', cls: 'danger', text: t => 'просрочено, срок ' + fmtDate(t.dueDate) },
  release: { icon: 'rocket', cls: 'warn', text: () => 'готово — передайте в релиз' },
  review: { icon: 'eye', cls: 'warn', text: () => 'на ревью больше 2 дней' },
  unassigned: { icon: 'user', cls: 'warn', text: () => 'без исполнителя' },
  stale: { icon: 'clock', cls: 'muted', text: t => 'без движения ' + Math.floor((Date.now() - Date.parse(t.updatedAt)) / 864e5) + ' дн.' },
};

function problems(d) {
  const rows = d.problems;
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Проблемы', rows.length > 0 && h('span', { class: 'news-count' }, rows.length))),
    rows.length ? h('div', { class: 'card-box att-list' }, rows.slice(0, 14).map(x => {
      const a = PROB[x.type], t = x.task;
      const p = personById(t.assigneeId);
      return h('button', { class: 'pb-row', onclick: () => peekTask(t.unitId, t.id) },
        h('span', { class: 'att-ic ' + a.cls }, icon(a.icon, 14)),
        h('span', { class: 'pb-main' }, h('span', { class: 'pb-title' }, t.app ? h('b', null, t.app.name + ' · ') : '', t.title.split(' · ')[0]),
          h('span', { class: 'att-what ' + a.cls }, a.text(t))),
        p ? avatar(p, 'sm') : h('span', { class: 'avatar-gap' }));
    }), rows.length > 14 && h('p', { class: 'muted att-more' }, `и ещё ${rows.length - 14}`))
      : h('div', { class: 'card-box empty-state sm' }, icon('check', 18), h('p', null, 'Проблем нет: просрочек, зависших ревью и задач без исполнителя нет.')));
}

/* ---------- команда и KPI ---------- */

function team(d, period, setPeriod) {
  const rows = [...d.team].map(k => ({ ...k, p: personById(k.personId) })).filter(k => k.p)
    .sort((a, b) => b.done - a.done || b.inProgress - a.inProgress || a.p.name.localeCompare(b.p.name, 'ru'));
  const pct = v => (v === null ? h('span', { class: 'muted' }, '—') : h('span', { class: v >= 80 ? 'ok-text' : v >= 50 ? '' : 'warn-text' }, v + '%'));
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Команда и KPI'),
      h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Период' }, PERIODS.map(([k, label]) => h('button', {
        class: period === k ? 'on' : '', role: 'tab', 'aria-selected': String(period === k), onclick: () => period !== k && setPeriod(k),
      }, label)))),
    rows.length ? h('div', { class: 'card-box kpi-table', role: 'table', 'aria-label': 'KPI команды' },
      h('div', { class: 'kt-row kt-head', role: 'row' },
        ['Сотрудник', 'Сделано', 'В срок', 'Ср. время', 'В работе', 'Просрочено'].map((t, i) => h('span', { role: 'columnheader', class: i ? 'num' : '' }, t))),
      rows.map(k => h('div', { class: 'kt-row', role: 'row' },
        h('span', { class: 'kt-who', role: 'cell' }, avatar(k.p, 'sm'), h('span', null, h('b', null, k.p.name),
          h('small', { class: 'muted' }, (k.p.positionIds || []).map(id => (deptById(id) || {}).name).filter(Boolean).join(', ')))),
        h('span', { class: 'num', role: 'cell' }, h('b', null, k.done)),
        h('span', { class: 'num', role: 'cell' }, pct(k.onTime)),
        h('span', { class: 'num', role: 'cell' }, k.avgDays === null ? h('span', { class: 'muted' }, '—') : k.avgDays + ' дн.'),
        h('span', { class: 'num', role: 'cell' }, k.inProgress),
        h('span', { class: 'num' + (k.overdue ? ' warn-text' : ''), role: 'cell' }, k.overdue))),
      h('p', { class: 'hint kt-note' }, `За ${PERIODS.find(([k]) => k === period)[1].toLowerCase()}: «Сделано» и «В срок» — закрытые задачи в ваших юнитах; «Ср. время» — от «в работе» до «готово»; «В работе» и «Просрочено» — сейчас.`))
      : h('div', { class: 'card-box empty-state sm' }, h('p', null, 'В ваших юнитах пока нет сотрудников — добавьте их в составе юнита.')));
}

