import { S, greeting, me, personById, relTime, plural, emptyCounts } from '../state.js';
import { $, h, icon, avatar, topbar, showErr, fill } from '../ui.js';
import { call } from '../api.js';
import { currentView, link, navigate } from '../router.js';
import { renderSidebar } from './sidebar.js';
import { openCreateTask } from './task.js';
import { openCreateUnit, unitMenu } from './units.js';

export async function renderHome() {
  const page = h('div', { class: 'page' }, h('div', { class: 'boot' }, h('span', { class: 'spinner' }), 'Загрузка…'));
  fill($('#main'),
    topbar([h('h1', null, 'Главная')], [
      h('button', { class: 'btn primary', onclick: () => openCreateTask() }, icon('plus', 15), h('span', { class: 'btn-label' }, 'Задача')),
    ]),
    h('div', { class: 'view-body' }, page));

  let d;
  try {
    d = await call('getHome', { today: new Date().toISOString().slice(0, 10) });
  } catch (e) {
    showErr(e);
    return;
  }
  if (currentView() !== 'home') return;
  S.units = d.units;
  S.people = d.people;
  S.departments = d.departments;
  renderSidebar();

  const units = d.units.filter(u => !u.archived);
  const person = me();
  const st = d.stats;
  const dateStr = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

  fill(page, 
    h('div', { class: 'hero' },
      h('div', null,
        h('h1', null, greeting() + (person ? ', ' + person.name.split(' ')[0] : '')),
        h('p', null, dateStr[0].toUpperCase() + dateStr.slice(1) + ' · ' + summary(st))),
      units.length > 0 && h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => navigate({ view: 'my' }) }, icon('user', 15), 'Мои задачи'))),

    h('div', { class: 'stats' },
      stat('К выполнению', st.todo, 'circle', 'var(--st-todo)'),
      stat('В работе', st.in_progress, 'progress', 'var(--st-progress)'),
      stat('Просрочено', st.overdue, 'alert', 'var(--danger)'),
      stat('Сделано за 7 дней', st.doneWeek, 'done', 'var(--st-done)')),

    h('div', { class: 'home-grid' },
      h('section', null,
        h('div', { class: 'section-head' }, h('h2', null, 'Юниты'),
          h('button', { class: 'btn ghost sm', onclick: openCreateUnit }, icon('plus', 14), 'Новый')),
        units.length
          ? h('div', { class: 'unit-grid' }, units.map(unitCard), h('button', { class: 'unit-card add', onclick: openCreateUnit }, icon('plus', 18), 'Новый юнит'))
          : h('div', { class: 'card-box empty-state' },
            h('h2', null, 'Создайте первый юнит'),
            h('p', null, 'Юнит — отдельное пространство со своей доской, задачами и набором полей: проект, команда или направление.'),
            h('button', { class: 'btn primary', onclick: openCreateUnit }, icon('plus', 15), 'Создать юнит'))),
      h('section', null,
        h('div', { class: 'section-head' }, h('h2', null, 'Последние события')),
        d.activity.length
          ? h('div', { class: 'feed' }, d.activity.map(feedItem))
          : h('div', { class: 'feed' }, h('div', { class: 'empty-state', style: { padding: '28px 16px' } }, 'Здесь появятся изменения в задачах')))));
}

function summary(st) {
  const open = st.todo + st.in_progress;
  if (!open) return 'открытых задач нет';
  return open + ' ' + plural(open, ['открытая задача', 'открытые задачи', 'открытых задач']) + (st.overdue ? ', ' + st.overdue + ' просрочено' : '');
}

function stat(label, value, ic, color) {
  return h('div', { class: 'stat' },
    h('div', { class: 'stat-ic', style: { background: `color-mix(in srgb, ${color} 14%, transparent)`, color } }, icon(ic, 18)),
    h('div', null, h('div', { class: 'stat-val' }, value), h('div', { class: 'stat-label' }, label)));
}

function unitCard(u) {
  const c = u.counts || emptyCounts();
  const total = c.todo + c.in_progress + c.done;
  const pct = total ? Math.round((c.done / total) * 100) : 0;
  return link({ unit: u.id, mode: 'board' }, { class: 'unit-card', dataset: { id: u.id } },
    h('div', { class: 'uc-head' },
      h('div', { class: 'uc-icon', style: { background: u.color } }, u.key.slice(0, 2)),
      h('div', { class: 'uc-title' }, h('div', { class: 'uc-name' }, u.name), h('div', { class: 'uc-key' }, u.key)),
      h('button', {
        class: 'icon-btn sm', title: 'Действия',
        onclick: e => { e.preventDefault(); e.stopPropagation(); unitMenu(e.currentTarget, u); },
      }, icon('more'))),
    u.description && h('div', { class: 'uc-desc' }, u.description),
    h('div', { class: 'uc-team' },
      (u.members || []).length
        ? [h('span', { class: 'avatars-stack' }, u.members.slice(0, 6).map(id => avatar(personById(id), 'sm')), u.members.length > 6 && h('span', { class: 'avatar sm more' }, '+' + (u.members.length - 6))),
          h('span', { class: 'hint' }, u.members.length + ' ' + plural(u.members.length, ['участник', 'участника', 'участников']))]
        : h('span', { class: 'hint' }, 'Команда не собрана')),
    h('div', { class: 'uc-foot' },
      h('div', { class: 'uc-counts' },
        h('span', null, h('span', { class: 'dot', style: { background: 'var(--st-todo)' } }), c.todo),
        h('span', null, h('span', { class: 'dot', style: { background: 'var(--st-progress)' } }), c.in_progress),
        h('span', null, h('span', { class: 'dot', style: { background: 'var(--st-done)' } }), c.done),
        c.overdue > 0 && h('span', { style: { color: 'var(--danger)' } }, icon('alert', 12), c.overdue + ' просрочено'),
        h('span', { class: 'spacer' }),
        total > 0 && h('span', null, pct + '%')),
      h('div', { class: 'progress', title: 'Выполнено ' + pct + '%' }, h('div', { style: { width: pct + '%' } }))));
}

export function activityText(a) {
  switch (a.action) {
    case 'create': return 'создание задачи';
    case 'comment': return 'комментарий: «' + (a.toText.length > 90 ? a.toText.slice(0, 90) + '…' : a.toText) + '»';
    case 'archive': return 'задача в архиве';
    case 'unarchive': return 'задача возвращена из архива';
    case 'move': return 'перенос ' + a.fromText + ' → ' + a.toText;
    case 'delete': return 'удаление задачи «' + a.fromText + '»';
    case 'update':
      if (a.field === 'description') return a.label.toLowerCase() + ' изменено';
      return a.label + ': ' + a.fromText + ' → ' + a.toText;
    default: return a.action;
  }
}

function feedItem(a) {
  const p = personById(a.actorId);
  return h('div', { class: 'feed-item' },
    avatar(p, 'sm'),
    h('div', { class: 'feed-body' },
      h('div', { class: 'feed-text' }, h('b', null, p ? p.name : 'Кто-то'), ' · ', activityText(a)),
      a.task && a.unit && link({ unit: a.unit.id, mode: 'board', task: a.task.id }, { class: 'feed-task' },
        h('span', { class: 'unit-dot', style: { background: a.unit.color, margin: 0 } }),
        h('span', { class: 'key-badge' }, a.task.key),
        h('span', { class: 'ft-title' }, a.task.title)),
      h('div', { class: 'feed-when' }, relTime(a.at))));
}
