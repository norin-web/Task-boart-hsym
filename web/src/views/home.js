import { S, greeting, me, personById, plural, emptyCounts, isStaff, deptById, todayStr, fmtDate, activeDepts, ACCESS_LABELS } from '../state.js';
import { $, h, icon, avatar, topbar, showErr, fill } from '../ui.js';
import { call } from '../api.js';
import { currentView, link, navigate } from '../router.js';
import { renderSidebar } from './sidebar.js';
import { openCreateTask } from './task.js';
import { openCreateUnit, unitMenu } from './units.js';
import { mode } from '../data.js';
import { taskGroups, loadMyTasks, personCaption } from './my.js';
import { activityFeed } from './feed.js';

/** Локальный режим: заполнить пустую базу демо-командами и перезагрузить. */
export async function fillDemo(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Заполняем…'; }
  try {
    const { seedDemo } = await import('../demo.js');
    await seedDemo();
    location.hash = '#/';
    location.reload();
  } catch (e) {
    showErr(e);
    if (btn) btn.disabled = false;
  }
}

export async function renderHome() {
  if (!isStaff()) return renderMemberHome();
  const page = h('div', { class: 'page' }, h('div', { class: 'boot' }, h('span', { class: 'spinner' }), 'Загрузка…'));
  fill($('#main'),
    topbar([h('h1', null, 'Главная')], [
      h('button', { class: 'btn', onclick: () => navigate({ view: 'admin' }) }, icon('settings', 15), h('span', { class: 'btn-label' }, 'Панель админа')),
      h('button', { class: 'btn primary', onclick: () => openCreateTask() }, icon('plus', 15), h('span', { class: 'btn-label' }, 'Задача')),
    ]),
    h('div', { class: 'view-body' }, page));

  let d, ov;
  try {
    [d, ov] = await Promise.all([
      call('getHome', { today: todayStr() }),
      call('getOverview', { today: todayStr() }),
    ]);
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
        h('h1', { class: 'row', style: { gap: '10px' } }, greeting() + (person ? ', ' + person.name.split(' ')[0] : ''), roleBadge(person)),
        h('p', null, dateStr[0].toUpperCase() + dateStr.slice(1) + ' · ' + summary(st))),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => navigate({ view: 'my' }) }, icon('user', 15), 'Мои задачи'))),

    h('div', { class: 'stats' },
      stat('К выполнению', st.todo, 'circle', 'var(--st-todo)'),
      stat('В работе', st.in_progress, 'progress', 'var(--st-progress)'),
      stat('Просрочено', st.overdue, 'alert', 'var(--danger)'),
      stat('Сделано за 7 дней', st.doneWeek, 'done', 'var(--st-done)')),

    h('div', { class: 'home-grid' },
      h('div', { class: 'home-col' },
        attentionBlock(ov),
        workloadBlock(ov),
        h('section', null,
          h('div', { class: 'section-head' }, h('h2', null, 'Юниты'),
            h('button', { class: 'btn ghost sm', onclick: openCreateUnit }, icon('plus', 14), 'Новый')),
          units.length
            ? h('div', { class: 'unit-grid' }, units.map(unitCard), h('button', { class: 'unit-card add', onclick: openCreateUnit }, icon('plus', 18), 'Новый юнит'))
            : h('div', { class: 'card-box empty-state' },
              h('h2', null, 'Создайте первый юнит'),
              h('p', null, 'Юнит — это команда: своя доска и задачи, участники из разных отделов (ASO, Design, iOS…).'),
              h('div', { class: 'row', style: { justifyContent: 'center' } },
                h('button', { class: 'btn primary', onclick: openCreateUnit }, icon('plus', 15), 'Создать юнит'),
                mode === 'local' && h('button', { class: 'btn', onclick: e => fillDemo(e.currentTarget) }, icon('layers', 15), 'Заполнить демо-данными'))))),
      activityFeed({ limit: 15 })));
}

/** Бейдж роли текущего человека. */
export function roleBadge(p) {
  if (!p) return null;
  return h('span', { class: 'role-badge role-' + p.access }, ACCESS_LABELS[p.access]);
}

/** Что требует внимания администратора — каждый пункт кликабелен. */
export function attentionBlock(ov) {
  const items = [];
  const name = id => (personById(id) || { name: '—' }).name;
  if (ov.overdueTotal) items.push(h('div', { class: 'att-item att-danger' },
    h('div', { class: 'att-head' }, icon('alert', 15), h('b', null, ov.overdueTotal + ' ' + plural(ov.overdueTotal, ['просроченная задача', 'просроченные задачи', 'просроченных задач']))),
    h('div', { class: 'att-list' }, ov.overdue.slice(0, 5).map(t => link({ unit: t.unit.id, mode: 'board', task: t.id }, { class: 'att-task' },
      h('span', { class: 'key-badge' }, t.key), h('span', { class: 'ft-title' }, t.title),
      h('span', { class: 'muted' }, t.assigneeId ? name(t.assigneeId) : 'без исполнителя'),
      h('span', { class: 'due overdue' }, fmtDate(t.dueDate)))))));
  const simple = (n, text, onclick, tone = 'warn') => n > 0 && items.push(h('button', { class: 'att-item att-' + tone + ' att-simple', onclick },
    icon(tone === 'info' ? 'user' : 'alert', 15), h('span', null, h('b', null, n), ' ' + text), icon('arrow', 14)));
  simple(ov.unassigned, plural(ov.unassigned, ['задача без исполнителя', 'задачи без исполнителя', 'задач без исполнителя']), () => navigate({ view: 'admin', tab: 'overview' }));
  simple(ov.noPosition, plural(ov.noPosition, ['задача без позиции — участники её не видят', 'задачи без позиции — участники их не видят', 'задач без позиции — участники их не видят']), () => navigate({ view: 'admin', tab: 'overview' }));
  simple(ov.peopleNoPosition.length, plural(ov.peopleNoPosition.length, ['участник без позиции', 'участника без позиции', 'участников без позиции']), () => navigate({ view: 'admin', tab: 'people' }));
  simple(ov.unitsNoTeam.length, plural(ov.unitsNoTeam.length, ['юнит без команды', 'юнита без команды', 'юнитов без команды']), () => navigate({ view: 'admin', tab: 'units' }));
  if (mode === 'supabase') simple(ov.peopleNoLogin.length, plural(ov.peopleNoLogin.length, ['человек без входа', 'человека без входа', 'человек без входа']), () => navigate({ view: 'admin', tab: 'people' }), 'info');
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Требует внимания')),
    items.length ? h('div', { class: 'att' }, items) : h('div', { class: 'card-box att-ok' }, icon('done', 16), 'Всё в порядке: просрочек и пробелов нет'));
}

/** Загрузка: открытые задачи по людям (кто перегружен, у кого просрочки). */
export function workloadBlock(ov, { all = false } = {}) {
  const rows = S.people.filter(p => p.active && p.access === 'member')
    .map(p => ({ p, c: ov.byPerson[p.id] || { open: 0, inProgress: 0, overdue: 0 } }))
    .sort((a, b) => b.c.open - a.c.open || b.c.overdue - a.c.overdue);
  const shown = all ? rows : rows.slice(0, 6);
  const max = Math.max(1, ...rows.map(r => r.c.open));
  const pos = activeDepts().map(d => ({ d, c: ov.byPosition[d.id] || { open: 0, overdue: 0 } })).filter(x => x.c.open);
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Загрузка команды'),
      !all && rows.length > 6 && h('button', { class: 'btn ghost sm', onclick: () => navigate({ view: 'admin' }) }, 'Все ' + rows.length)),
    h('div', { class: 'card-box load' },
      shown.length ? shown.map(({ p, c }) => h('div', { class: 'load-row' },
        avatar(p, 'sm'),
        h('span', { class: 'load-name' }, p.name, h('small', null, personCaption(p))),
        h('div', { class: 'load-bar', title: `Открыто ${c.open}, в работе ${c.inProgress}, просрочено ${c.overdue}` },
          h('div', { class: 'load-fill', style: { width: (c.open / max) * 100 + '%' } },
            h('div', { class: 'load-progress', style: { width: c.open ? (c.inProgress / c.open) * 100 + '%' : 0 } }))),
        h('span', { class: 'load-num' }, c.open),
        h('span', { class: 'load-late' + (c.overdue ? '' : ' zero') }, c.overdue ? c.overdue + ' просроч.' : ''))) : h('p', { class: 'muted', style: { margin: 0 } }, 'Участников пока нет'),
      pos.length > 0 && h('div', { class: 'load-pos' }, pos.map(({ d, c }) => h('span', { class: 'chip', style: { background: `color-mix(in srgb, ${d.color} 16%, transparent)`, color: d.color } },
        d.name + ': ' + c.open + (c.overdue ? ' · ' + c.overdue + ' просроч.' : ''))))));
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
      isStaff() && h('button', {
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


/** Дашборд участника: его юниты (доска и бэклог своей позиции) и его задачи. */
async function renderMemberHome() {
  const page = h('div', { class: 'page' }, h('div', { class: 'boot' }, h('span', { class: 'spinner' }), 'Загрузка…'));
  fill($('#main'), topbar([h('h1', null, 'Мой дашборд')], []), h('div', { class: 'view-body' }, page));
  let d, tasks;
  try {
    [d, tasks] = await Promise.all([call('getHome', { today: new Date().toISOString().slice(0, 10) }), loadMyTasks()]);
  } catch (e) {
    showErr(e);
    return;
  }
  if (currentView() !== 'home') return;
  S.units = d.units;
  S.people = d.people;
  S.departments = d.departments;
  renderSidebar();

  const person = me();
  const pos = person && deptById(person.positionId);
  const units = d.units.filter(u => !u.archived);
  const open = tasks.filter(t => t.statusKind !== 'done');
  const overdue = open.filter(t => t.dueDate && t.dueDate < new Date().toISOString().slice(0, 10)).length;
  const dateStr = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

  fill(page,
    h('div', { class: 'hero' },
      h('div', null,
        h('h1', null, greeting() + (person ? ', ' + person.name.split(' ')[0] : '')),
        h('p', null, dateStr[0].toUpperCase() + dateStr.slice(1) + (pos ? ' · ' + pos.name : '')))),
    h('div', { class: 'stats' },
      stat('Мои открытые задачи', open.length, 'circle', 'var(--st-progress)'),
      stat('Просрочено', overdue, 'alert', 'var(--danger)'),
      stat('Мои юниты', units.length, 'board', 'var(--accent)'),
      stat('Сделано', tasks.length - open.length, 'done', 'var(--st-done)')),
    h('div', { class: 'home-grid' },
      h('section', null,
        h('div', { class: 'section-head' }, h('h2', null, 'Мои задачи')),
        taskGroups(tasks)),
      h('section', null,
        h('div', { class: 'section-head' }, h('h2', null, 'Мои юниты')),
        units.length
          ? h('div', { class: 'unit-grid', style: { gridTemplateColumns: '1fr' } }, units.map(unitCard))
          : h('div', { class: 'card-box empty-state' }, h('p', { style: { margin: 0 } }, 'Вас пока не добавили ни в один юнит. Обратитесь к модератору.')))));
}

