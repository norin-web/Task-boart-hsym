/** Панель админа (#/admin): обзор, люди и доступы, юниты, позиции, журнал. Для модераторов и супер-админов. */
import { S, me, byOrder, emptyCounts, personById, todayStr, isSuper, ACCESS_LABELS } from '../state.js';
import { $, h, icon, avatar, topbar, showErr, fill } from '../ui.js';
import { call } from '../api.js';
import { currentView, link, navigate } from '../router.js';
import { renderSidebar } from './sidebar.js';
import { signalsBlock, workloadBlock, roleBadge } from './home.js';
import { peopleManager, positionsManager } from './people.js';
import { activityFeed } from './feed.js';
import { openCreateUnit, unitMenu } from './units.js';

const TABS = [
  ['overview', 'Обзор', 'home'],
  ['people', 'Люди и доступы', 'users'],
  ['units', 'Юниты', 'board'],
  ['positions', 'Позиции', 'layers'],
  ['journal', 'Журнал', 'clock'],
];

export async function renderAdmin(tab) {
  if (!TABS.some(t => t[0] === tab)) tab = 'overview';
  const page = h('div', { class: 'page' }, h('div', { class: 'boot' }, h('span', { class: 'spinner' }), 'Загрузка…'));
  const key = 'admin:' + tab;
  fill($('#main'),
    topbar([h('h1', null, 'Панель админа'), roleBadge(me())], []),
    h('nav', { class: 'admin-tabs' }, TABS.map(([id, label, ic]) =>
      link({ view: 'admin', tab: id }, { class: 'admin-tab' + (id === tab ? ' on' : '') }, icon(ic, 15), label))),
    h('div', { class: 'view-body' }, page));

  // Свежие люди, юниты и позиции — общая основа всех вкладок
  let d, ov;
  try {
    [d, ov] = await Promise.all([
      call('getHome', { today: todayStr() }),
      tab === 'overview' || tab === 'units' ? call('getOverview', { today: todayStr() }) : null,
    ]);
  } catch (e) {
    showErr(e);
    return;
  }
  if (currentView() !== key) return;
  S.units = d.units;
  S.people = d.people;
  S.departments = d.departments;
  renderSidebar();

  switch (tab) {
    case 'people': fill(page, h('div', { class: 'card-box' }, peopleManager({ search: true }))); break;
    case 'positions': fill(page, h('div', { class: 'card-box', style: { maxWidth: '720px' } }, positionsManager())); break;
    case 'units': fill(page, unitsTable(ov)); break;
    case 'journal': fill(page, h('div', { style: { maxWidth: '760px' } }, activityFeed({ limit: 40, title: 'Журнал событий' }))); break;
    default: fill(page, overview(d, ov));
  }
}

function overview(d, ov) {
  const active = d.people.filter(p => p.active);
  const count = access => active.filter(p => p.access === access).length;
  const units = d.units.filter(u => !u.archived);
  const kpi = (label, value, to) => link(to, { class: 'kpi' }, h('div', { class: 'kpi-val' }, value), h('div', { class: 'kpi-label' }, label));
  return h('div', { class: 'admin-overview' },
    h('div', { class: 'kpis' },
      kpi('Людей в команде', active.length, { view: 'admin', tab: 'people' }),
      kpi(ACCESS_LABELS.superadmin + 'ы', count('superadmin'), { view: 'admin', tab: 'people' }),
      kpi(ACCESS_LABELS.moderator + 'ы', count('moderator'), { view: 'admin', tab: 'people' }),
      kpi('Участники', count('member'), { view: 'admin', tab: 'people' }),
      kpi('Юниты', units.length, { view: 'admin', tab: 'units' }),
      kpi('Открытых задач', d.stats.todo + d.stats.in_progress, { view: 'home' }),
      kpi('Просрочено', d.stats.overdue, { view: 'home' })),
    signalsBlock(ov),
    h('div', { class: 'home-grid' },
      h('div', { class: 'home-col' }, workloadBlock(ov, { all: true })),
      h('div', { class: 'home-col' },
        h('section', null,
          h('div', { class: 'section-head' }, h('h2', null, 'Быстрые действия')),
          h('div', { class: 'quick-actions-grid' },
            link({ view: 'admin', tab: 'people' }, { class: 'qa' }, icon('user', 16), 'Добавить человека'),
            h('button', { class: 'qa', onclick: openCreateUnit }, icon('plus', 16), 'Новый юнит'),
            link({ view: 'admin', tab: 'positions' }, { class: 'qa' }, icon('layers', 16), 'Позиции'),
            link({ view: 'admin', tab: 'journal' }, { class: 'qa' }, icon('clock', 16), 'Журнал событий'))),
        h('section', null,
          h('div', { class: 'section-head' }, h('h2', null, 'Ваши права')),
          h('div', { class: 'card-box rights' },
            right(true, 'Юниты, команды, задачи, поля и колонки'),
            right(true, 'Люди: добавление, позиции, вход и отключение'),
            right(isSuper(), 'Роли: назначение модераторов и супер-админов'),
            right(isSuper(), 'Профили супер-админов'))))));
}

const right = (ok, text) => h('div', { class: 'right-row' + (ok ? '' : ' no') }, icon(ok ? 'check' : 'x', 14), text);

function unitsTable(ov) {
  const units = [...S.units].sort((a, b) => (a.archived - b.archived) || byOrder(a, b));
  const noTeam = new Set(ov ? ov.unitsNoTeam : []);
  return h('div', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Юниты'), h('button', { class: 'btn primary sm', onclick: openCreateUnit }, icon('plus', 14), 'Юнит')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'tasks admin-units' },
      h('thead', null, h('tr', null, ['Юнит', 'Команда', 'Открыто', 'Просрочено', 'Готово', ''].map(t => h('th', null, t)))),
      h('tbody', null, units.map(u => {
        const c = u.counts || emptyCounts();
        const total = c.todo + c.in_progress + c.done;
        const team = (u.members || []).map(personById).filter(Boolean);
        return h('tr', { class: u.archived ? 'archived' : '', onclick: e => { if (!e.target.closest('button')) navigate({ unit: u.id, mode: 'board' }); } },
          h('td', null, h('span', { class: 'row', style: { gap: '8px', flexWrap: 'nowrap' } },
            h('span', { class: 'uc-icon sm', style: { background: u.color } }, u.key.slice(0, 2)),
            h('span', null, h('b', null, u.name), ' ', h('span', { class: 'muted' }, u.key)),
            u.archived && h('span', { class: 'badge' }, 'архив'))),
          h('td', null, team.length
            ? h('span', { class: 'avatars-stack', title: team.map(p => p.name).join(', ') }, team.slice(0, 6).map(p => avatar(p, 'sm')))
            : h('span', { class: noTeam.has(u.id) ? 'warn-text' : 'muted' }, 'нет команды')),
          h('td', null, c.todo + c.in_progress),
          h('td', null, c.overdue ? h('span', { class: 'warn-text' }, c.overdue) : h('span', { class: 'muted' }, '0')),
          h('td', null, total ? Math.round((c.done / total) * 100) + '%' : '—'),
          h('td', { style: { width: '120px', textAlign: 'right' } },
            link({ unit: u.id, mode: 'settings' }, { class: 'btn ghost sm' }, 'Настройки'),
            h('button', { class: 'icon-btn sm', title: 'Действия', onclick: e => { e.stopPropagation(); unitMenu(e.currentTarget, u); } }, icon('more'))));
      })))));
}
