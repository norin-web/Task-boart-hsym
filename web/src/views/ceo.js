/**
 * Дашборд CEO (главная CEO в обоих режимах): портфель приложений по статусам и юнитам, что требует внимания,
 * работы в ходу (запросы и текущий этап), что недавно вышло. Клик — карточка приложения или задача поверх.
 */
import { S, isSuper, personById, unitById, REQUEST_TYPES, greeting, me, plural, fmtDate, relTime, todayStr } from '../state.js';
import { $, h, icon, avatar, topbar, showErr, fill, menu } from '../ui.js';
import { call } from '../api.js';
import { currentView } from '../router.js';
import { peekTask } from './task.js';
import { openAppById, openCreateApp, appIcon, prioTag, stageDots } from './apps.js';
import { newsBlock, loadNotes, fillDemo } from './home.js';
import { openCreateUnit } from './units.js';
import { mode } from '../data.js';

const units = () => S.units.filter(u => !u.archived).sort((a, b) => (a.order || 0) - (b.order || 0));
const prioRank = id => S.priorityOptions.findIndex(o => o.id === id);
const daysSince = iso => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 864e5));
const daysLate = due => Math.max(1, Math.round((Date.parse(todayStr()) - Date.parse(due)) / 864e5));

export async function renderCeoHome() {
  const page = h('div', { class: 'page ceo-page' }, h('div', { class: 'boot' }, h('span', { class: 'spinner' }), 'Загрузка…'));
  fill($('#main'),
    topbar([h('h1', null, 'Дашборд')], [isSuper() && units().length > 0 && h('button', { class: 'btn primary', onclick: () => openCreateApp(load) }, icon('plus', 15), h('span', { class: 'btn-label' }, 'Новое приложение'))]),
    h('div', { class: 'view-body' }, page));
  async function load() {
    let d;
    try { [d] = await Promise.all([call('getCeoDashboard', { today: todayStr() }), loadNotes()]); } catch (e) { return showErr(e); }
    if (currentView() !== 'home') return;
    const total = Object.values(d.portfolio.byStatus).reduce((n, l) => n + l.length, 0);
    const person = me();
    fill(page,
      h('div', { class: 'ceo-hello' },
        h('h2', null, greeting() + (person ? ', ' + person.name.split(' ')[0] : '')),
        h('p', { class: 'muted' }, total ? `${total} ${plural(total, ['приложение', 'приложения', 'приложений'])} · ${d.inProgress.length} ${plural(d.inProgress.length, ['работа', 'работы', 'работ'])} в ходу`
          : 'Приложений пока нет')),
      newsBlock(),
      !total && h('div', { class: 'card-box empty-state' },
        h('h2', null, 'Портфель пуст'),
        h('p', null, units().length ? 'Создайте приложение — задача «New App» сразу уйдёт PM его юнита.' : 'Сначала юниты — направления студии (Gold, RF, MVP…), потом приложения.'),
        h('div', { class: 'row', style: { justifyContent: 'center', gap: '8px' } },
          isSuper() && (units().length
            ? h('button', { class: 'btn primary', onclick: () => openCreateApp(load) }, icon('plus', 15), 'Новое приложение')
            : h('button', { class: 'btn primary', onclick: openCreateUnit }, icon('plus', 15), 'Создать юнит')),
          mode === 'local' && !units().length && h('button', { class: 'btn', onclick: e => fillDemo(e.currentTarget) }, icon('layers', 15), 'Заполнить демо-данными'))),
      total > 0 && portfolio(d, load),
      total > 0 && h('div', { class: 'home-grid' },
        h('div', { class: 'home-col' }, attention(d, load), inProgress(d, load)),
        h('div', { class: 'home-col' }, recent(d, load))));
  }
  load();
}

/* ---------- портфель ---------- */

/** Плитки по статусам (клик — список приложений) и таблица «юниты × статусы». */
function portfolio(d, reload) {
  const statuses = d.statuses;
  const appsOf = ids => ids.map(id => S.apps.find(a => a.id === id)).filter(Boolean);
  const listMenu = (anchor, title, list) => menu(anchor, [{ title }, h('div', { class: 'kp-list' },
    list.length ? list.map(a => h('button', { class: 'kp-row kp-link', onclick: () => openAppById(a.id, reload) },
      appIcon(a, 'xs'), h('span', { class: 'kp-name' }, a.name), h('span', { class: 'kp-sub muted' }, (unitById(a.unitId) || {}).name || '')))
      : h('p', { class: 'muted kp-empty' }, 'Пусто'))]);
  const unitRows = units().filter(u => d.portfolio.byUnit[u.id]);
  return h('section', { class: 'ceo-portfolio' },
    h('div', { class: 'section-head' }, h('h2', null, 'Портфель')),
    h('div', { class: 'pf-tiles' }, statuses.map(st => {
      const ids = d.portfolio.byStatus[st.id] || [];
      return h('button', {
        class: 'pf-tile' + (ids.length ? '' : ' empty'), style: { '--sc': st.color },
        onclick: e => { e.stopPropagation(); listMenu(e.currentTarget, st.name, appsOf(ids)); },
      }, h('span', { class: 'pf-count' }, ids.length), h('span', { class: 'pf-name' }, h('span', { class: 'dot' }), st.name));
    })),
    unitRows.length > 0 && h('div', { class: 'pf-table card-box', role: 'table', 'aria-label': 'Приложения по юнитам и статусам' },
      h('div', { class: 'pf-row pf-head', role: 'row', style: { '--n': statuses.length } },
        h('span', { role: 'columnheader' }, 'Юнит'), statuses.map(st => h('span', { role: 'columnheader', title: st.name }, st.name))),
      unitRows.map(u => h('div', { class: 'pf-row', role: 'row', style: { '--n': statuses.length } },
        h('span', { class: 'pf-unit', role: 'cell' }, h('span', { class: 'unit-dot', style: { background: u.color, margin: 0 } }), u.name),
        statuses.map(st => {
          const n = (d.portfolio.byUnit[u.id] || {})[st.id] || 0;
          return n ? h('button', { class: 'pf-cell', role: 'cell', onclick: e => { e.stopPropagation(); listMenu(e.currentTarget, `${u.name} · ${st.name}`, S.apps.filter(a => a.unitId === u.id && a.status === st.id)); } }, n)
            : h('span', { class: 'pf-cell zero', role: 'cell' }, '—');
        })))));
}

/* ---------- требует внимания ---------- */

const ATT = {
  reject: { icon: 'alert', cls: 'danger', text: x => 'реджект Apple' },
  overdue: { icon: 'clock', cls: 'danger', text: x => `просрочено на ${daysLate(x.task.dueDate)} ${plural(daysLate(x.task.dueDate), ['день', 'дня', 'дней'])}` },
  nopm: { icon: 'user', cls: 'warn', text: x => 'нет PM в юните — некому разложить' },
  waiting: { icon: 'tree', cls: 'warn', text: x => 'PM ещё не разложил по этапам' },
  stale: { icon: 'clock', cls: 'muted', text: x => `без движения ${daysSince(x.task.updatedAt)} ${plural(daysSince(x.task.updatedAt), ['день', 'дня', 'дней'])}` },
};

function attention(d, reload) {
  const rows = d.attention;
  const what = x => (x.task && x.task.id !== x.request.id ? x.task.title.split(' · ')[0] : x.request ? x.request.title : '');
  const who = x => personById(x.task ? x.task.assigneeId : x.request ? x.request.assigneeId : '');
  // этапы лежат в юните запроса; реджект — карточка приложения
  const open = x => (x.request ? peekTask(x.request.unitId, x.task ? x.task.id : x.request.id) : openAppById(x.app.id, reload));
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Требует внимания', rows.length > 0 && h('span', { class: 'news-count' }, rows.length))),
    rows.length
      ? h('div', { class: 'card-box att-list' }, rows.slice(0, 12).map(x => {
        const a = ATT[x.type];
        const p = who(x);
        return h('button', { class: 'att-row', onclick: () => open(x) },
          h('span', { class: 'att-ic ' + a.cls }, icon(a.icon, 14)),
          appIcon(x.app, 'xs'),
          h('span', { class: 'att-main' }, h('b', null, x.app.name), what(x) && h('span', { class: 'muted' }, ' · ' + what(x))),
          h('span', { class: 'att-what ' + a.cls }, a.text(x)),
          p ? avatar(p, 'sm') : h('span', { class: 'avatar-gap' }));
      }), rows.length > 12 && h('p', { class: 'muted att-more' }, `и ещё ${rows.length - 12}`))
      : h('div', { class: 'card-box empty-state sm' }, icon('check', 18), h('p', null, `Всё идёт по плану: реджектов, просрочек и работ без движения ${d.staleDays}+ дней нет.`)));
}

/* ---------- работы в ходу ---------- */

function inProgress(d, reload) {
  const rows = [...d.inProgress].sort((a, b) => prioRank(b.request.priority) - prioRank(a.request.priority)
    || (a.request.dueDate || '9999').localeCompare(b.request.dueDate || '9999'));
  const today = todayStr();
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Работы в ходу')),
    rows.length
      ? h('div', { class: 'card-box wip-list' },
        h('div', { class: 'wip-row wip-head', 'aria-hidden': 'true' },
          h('span', null, 'Приложение'), h('span', null, 'Задача'), h('span', null, 'Сейчас'), h('span', null, 'Этапы'), h('span', null, 'Срок'), h('span', null, 'PM')),
        rows.map(({ app, request: r, current }) => {
          const late = r.dueDate && r.dueDate < today;
          const pm = personById(r.assigneeId);
          return h('button', { class: 'wip-row', onclick: () => openAppById(app.id, reload) },
            h('span', { class: 'wip-app' }, appIcon(app, 'xs'), h('b', null, app.name), prioTag(r.priority)),
            h('span', { class: 'wip-req' }, h('span', { class: 'ap-type' }, REQUEST_TYPES[r.type] || 'Задача'), h('span', { class: 'wip-title' }, r.title)),
            h('span', { class: 'wip-now' }, current ? current.title.split(' · ')[0] : r.stages.length ? 'релиз' : h('span', { class: 'warn-text' }, 'ждёт PM')),
            h('span', { class: 'wip-stages' }, r.stages.length ? [stageDots(r.stages), h('span', { class: 'muted ap-pct' }, r.progress + '%')] : h('span', { class: 'muted' }, '—')),
            h('span', { class: 'wip-due' + (late ? ' late' : '') }, r.dueDate ? fmtDate(r.dueDate) : h('span', { class: 'muted' }, '—')),
            pm ? avatar(pm, 'sm') : h('span', { class: 'muted' }, '—'));
        }))
      : h('div', { class: 'card-box empty-state sm' }, h('p', null, 'Открытых задач по приложениям нет.')));
}

/* ---------- недавно вышло ---------- */

function recent(d, reload) {
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Недавно вышло'), h('span', { class: 'muted' }, '14 дней')),
    d.recent.length
      ? h('div', { class: 'card-box rc-list' }, d.recent.map(x => h('button', { class: 'rc-row', onclick: () => openAppById(x.app.id, reload) },
        h('span', { class: 'rc-ic' + (x.type === 'live' ? ' live' : '') }, icon(x.type === 'live' ? 'rocket' : 'check', 14)),
        h('span', { class: 'rc-main' }, h('b', null, x.app.name),
          h('span', { class: 'muted' }, x.type === 'live' ? ' — в сторе' : ' · ' + x.request.title + ' — готово')),
        h('span', { class: 'muted rc-at' }, relTime(x.at)))))
      : h('div', { class: 'card-box empty-state sm' }, h('p', null, 'За две недели ничего не вышло.')));
}

