import { S, greeting, me, personById, plural, emptyCounts, isStaff, deptById, todayStr, fmtDate, activeDepts, ACCESS_LABELS, relTime, dueInfo } from '../state.js';
import { $, h, icon, avatar, topbar, showErr, fill, toast, menu, closeMenu } from '../ui.js';
import { call } from '../api.js';
import { currentView, link, navigate, taskLink, rerender } from '../router.js';
import { renderSidebar, renderUnread } from './sidebar.js';
import { openCreateTask, peekTask } from './task.js';
import { openCreateUnit, unitMenu } from './units.js';
import { mode } from '../data.js';
import { taskGroups, unitGroups, loadMyTasks, personCaption } from './my.js';
import { activityFeed } from './feed.js';
import { renderLayout, editLayout } from './layout.js';
import { openPeople } from './people.js';
import { focusBlock, reviewsBlock, teamLoadBlock } from './employee.js';

/* ---------- «Новое для вас»: задачи, которые на меня назначили ---------- */

export async function loadNotes() {
  S.notes = await call('getNotifications', { today: todayStr() }).catch(() => []);
  S.unread = S.notes.length;
  renderUnread();
}

/** Отметить прочитанным по задаче (открыли её) — строка в блоке плавно исчезает. */
export function readNote(taskId) {
  if (!S.notes.some(n => n.taskId === taskId)) return;
  S.notes = S.notes.filter(n => n.taskId !== taskId);
  S.unread = Math.max(0, S.unread - 1);
  renderUnread();
  document.querySelectorAll(`[data-note-task="${CSS.escape(taskId)}"]`).forEach(fadeOut);
  call('readNotifications', { taskId }).catch(showErr);
}

function fadeOut(el) {
  el.classList.add('gone');
  setTimeout(() => {
    const box = el.closest('.news');
    el.remove();
    if (box && !box.querySelector('.news-row')) box.closest('section').remove();
  }, 220);
}

/** «на ревью от Дмитрия» / «вернул(а) с ревью Мария» / «назначил(а) Анна». */
function noteText(kind, by) {
  const who = by && by.id !== S.meId ? by.name.split(' ')[0] : '';
  // тип (ревью / возврат) виден плашкой слева — здесь только кто
  if (kind === 'review') return who ? 'отправил(а) ' + who : 'от вас';
  if (kind === 'returned') return who ? 'вернул(а) ' + who : 'вернули';
  if (kind === 'approved') return who ? 'принял(а) ' + who : 'принято';
  if (kind === 'unblocked') return 'предыдущие этапы закрыты';
  return who ? 'назначил(а) ' + who : 'назначено';
}

/** Пульс увидел новые уведомления: блок на главной обновляется сам (без перезагрузки страницы). */
export async function refreshNews() {
  if (currentView() !== 'home') return;
  await loadNotes();
  const old = document.querySelector('.news-sec');
  const fresh = newsBlock();
  if (old && fresh) old.replaceWith(fresh);
  else if (old) old.remove();
  else if (fresh) rerender(); // блока не было — перерисуем главную, он встанет наверх по раскладке
}

const NEWS_BLOCK = {
  id: 'news', title: 'Новое для вас', col: 'full', first: true, empty: 'Появится, когда на вас назначат задачу',
  render: () => newsBlock(),
};

export function newsBlock() {
  if (!S.notes.length) return null;
  const row = n => {
    const by = personById(n.actorId);
    const due = dueInfo(n.dueDate, n.kind === 'approved'); // закрытая — срок без тревоги
    return h('button', {
      class: 'news-row', dataset: { noteTask: n.taskId }, onclick: () => peekTask(n.unit.id, n.taskId),
    },
    h('span', { class: 'news-dot' + (n.kind !== 'assigned' ? ' ' + n.kind : '') }),
    n.kind === 'review' && h('span', { class: 'news-kind review', title: 'Задача пришла вам на ревью' }, icon('eye', 12), 'Ревью'),
    n.kind === 'returned' && h('span', { class: 'news-kind returned', title: 'Ревьюер вернул задачу вам' }, icon('back', 12), 'Вернули'),
    n.kind === 'approved' && h('span', { class: 'news-kind approved', title: 'Ревьюер принял работу — задача закрыта' }, icon('done', 12), 'Закрыта по ревью'),
    n.kind === 'unblocked' && h('span', { class: 'news-kind unblocked', title: 'Этапы, которые нужно было закрыть раньше, закрыты' }, icon('zap', 12), 'Можно начинать'),
    n.kind === 'overdue' && h('span', { class: 'news-kind overdue', title: 'Срок прошёл' }, icon('alert', 12), 'Просрочено'),
    n.kind === 'due_soon' && h('span', { class: 'news-kind soon', title: 'Срок скоро' }, icon('clock', 12), n.dueDate === todayStr() ? 'Срок сегодня' : 'Срок завтра'),
    h('span', { class: 'key-badge' }, n.key),
    h('span', { class: 'news-title' }, n.title),
    due && h('span', { class: 'due ' + due.cls, title: due.hint }, icon('calendar', 12), due.text),
    h('span', { class: 'news-meta' }, h('span', { class: 'unit-dot', style: { background: n.unit.color } }), n.unit.name,
      ...(n.actorId || !['overdue', 'due_soon'].includes(n.kind) ? [' · ', noteText(n.kind, by)] : []), ' · ', relTime(n.at)));
  };
  const readAll = () => {
    S.notes = [];
    S.unread = 0;
    renderUnread();
    call('readNotifications', {}).catch(showErr);
    sec.querySelectorAll('.news-row').forEach(fadeOut);
  };
  const sec = h('section', { class: 'news-sec' },
    h('div', { class: 'section-head' },
      h('h2', null, 'Новое для вас', h('span', { class: 'news-count' }, S.notes.length)),
      h('button', { class: 'btn ghost sm', onclick: readAll }, icon('check', 14), 'Просмотрено всё')),
    h('div', { class: 'news card-box' }, S.notes.map(row)));
  return sec;
}

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
      h('button', { class: 'btn primary', onclick: () => openCreateTask() }, icon('plus', 15), h('span', { class: 'btn-label' }, 'Задача')),
    ]),
    h('div', { class: 'view-body' }, page));

  let d, ov;
  try {
    [d, ov] = await Promise.all([
      call('getHome', { today: todayStr() }),
      call('getOverview', { today: todayStr() }),
      loadNotes(),
    ]);
  } catch (e) {
    showErr(e);
    return;
  }
  if (currentView() !== 'home') return;
  S.units = d.units;
  S.people = d.people;
  S.departments = d.departments;
  if (d.teams) S.teams = d.teams;
  renderSidebar();

  const units = d.units.filter(u => !u.archived);
  const person = me();
  const st = d.stats;
  const dateStr = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

  const unitsBlock = () => h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Юниты'),
      h('button', { class: 'btn ghost sm', onclick: openCreateUnit }, icon('plus', 14), 'Новый')),
    units.length
      ? h('div', { class: 'unit-grid' }, units.map(unitCard), h('button', { class: 'unit-card add', onclick: openCreateUnit }, icon('plus', 18), 'Новый юнит'))
      : h('div', { class: 'card-box empty-state' },
        h('h2', null, 'Создайте первый юнит'),
        h('p', null, 'Юнит — направление студии (Gold, RF, MVP…): его приложения, PM, RM, лиды и сотрудники.'),
        h('div', { class: 'row', style: { justifyContent: 'center' } },
          h('button', { class: 'btn primary', onclick: openCreateUnit }, icon('plus', 15), 'Создать юнит'),
          mode === 'local' && h('button', { class: 'btn', onclick: e => fillDemo(e.currentTarget) }, icon('layers', 15), 'Заполнить демо-данными'))));

  // Блоки главной: каждый может скрыть, переставить и поменять колонку (кнопка «Настроить»)
  const BLOCKS = [
    NEWS_BLOCK,
    { id: 'stats', title: 'Статистика задач', col: 'full', render: () => h('div', { class: 'stats' },
      stat('К выполнению', st.todo, 'circle', 'var(--st-todo)', t => t.statusKind === 'todo'),
      stat('В работе', st.in_progress, 'progress', 'var(--st-progress)', t => t.statusKind === 'progress'),
      stat('Просрочено', st.overdue, 'alert', 'var(--danger)', t => t.statusKind !== 'done' && t.dueDate && t.dueDate < todayStr()),
      stat('Сделано за 7 дней', st.doneWeek, 'done', 'var(--st-done)', t => t.statusKind === 'done' && t.doneAt && t.doneAt >= weekAgo())) },
    { id: 'attention', title: 'Требует внимания', col: 'left', render: () => attentionBlock(ov) },
    { id: 'workload', title: 'Загрузка команды', col: 'left', render: () => workloadBlock(ov) },
    { id: 'units', title: 'Юниты', col: 'left', render: unitsBlock },
    { id: 'feed', title: 'Последние события', col: 'right', render: () => activityFeed({ limit: 15 }) },
  ];

  const draw = () => fill(page,
    h('div', { class: 'hero' },
      h('div', null,
        h('h1', { class: 'row', style: { gap: '10px' } }, greeting() + (person ? ', ' + person.name.split(' ')[0] : ''), roleBadge(person)),
        h('p', null, dateStr[0].toUpperCase() + dateStr.slice(1) + ' · ' + summary(st))),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', title: 'Настроить главную под себя', onclick: () => editLayout('home', BLOCKS, page, draw) }, icon('layers', 15), 'Настроить'),
        h('button', { class: 'btn', onclick: () => navigate({ view: 'my' }) }, icon('user', 15), 'Мои задачи'))),
    renderLayout('home', BLOCKS));
  draw();
}

/** Бейдж роли текущего человека. */
export function roleBadge(p) {
  if (!p) return null;
  return h('span', { class: 'role-badge role-' + p.access }, ACCESS_LABELS[p.access]);
}

/** Что требует внимания: каждый пункт раскрывается и чинится прямо здесь, без перехода в юнит. */
export function attentionBlock(ov) {
  const items = [];
  const name = id => (personById(id) || { name: '—' }).name;
  const members = S.people.filter(p => p.active && p.access === 'member');

  if (ov.overdueTotal) items.push(attItem({
    tone: 'danger', open: true, n: ov.overdueTotal,
    forms: ['просроченная задача', 'просроченные задачи', 'просроченных задач'],
    rows: ov.overdue, row: t => [taskRef(t), h('span', { class: 'muted' }, t.assigneeId ? name(t.assigneeId) : 'без исполнителя'), h('span', { class: 'due overdue' }, fmtDate(t.dueDate))],
  }));

  items.push(attItem({
    n: ov.unassigned, rows: ov.unassignedTasks,
    forms: ['задача без исполнителя', 'задачи без исполнителя', 'задач без исполнителя'],
    row: (t, done) => {
      const team = (ov.unitMembers[t.unit.id] || []).map(personById).filter(p => p && p.active);
      return [taskRef(t), quickSelect(team.length ? 'Назначить…' : 'В юните нет команды', team.map(p => [p.id, p.name]),
        v => call('updateTask', { id: t.id, patch: { assigneeId: v } }).then(() => { t.assigneeId = v; done('Назначено: ' + name(v)); }))];
    },
  }));

  items.push(attItem({
    n: ov.noPosition, rows: ov.noPositionTasks,
    forms: ['задача без позиции — участники её не видят', 'задачи без позиции — участники их не видят', 'задач без позиции — участники их не видят'],
    row: (t, done) => [taskRef(t), quickSelect('Позиция…', activeDepts().map(d => [d.id, d.name]),
      v => call('updateTask', { id: t.id, patch: { departmentId: v } }).then(() => done('Позиция: ' + deptById(v).name)))],
  }));

  items.push(attItem({
    n: ov.unitsNoTeam.length, rows: ov.unitsNoTeam.map(id => S.units.find(u => u.id === id)).filter(Boolean),
    forms: ['юнит без участников', 'юнита без участников', 'юнитов без участников'],
    row: (u, done) => [h('span', { class: 'att-who' }, h('span', { class: 'unit-dot', style: { background: u.color, margin: 0 } }), u.name),
      quickSelect(members.length ? 'Добавить участника…' : 'Нет участников', members.map(p => [p.id, p.name + (deptById(p.positionId) ? ' · ' + deptById(p.positionId).name : '')]),
        v => call('setMember', { unitId: u.id, personId: v, departmentId: personById(v).positionId || '' }).then(() => {
          u.members = [...(u.members || []), v];
          done(name(v) + ' — в юните ' + u.name);
        }))],
  }));

  // Участники без открытых задач — свободные руки. Можно сразу дать задачу без исполнителя из их юнитов.
  const idle = members.filter(p => !(ov.byPerson[p.id] || {}).open);
  items.push(attItem({
    n: idle.length, rows: idle, tone: 'info', icon: 'user',
    forms: ['участник без задач', 'участника без задач', 'участников без задач'],
    row: (p, done) => {
      const free = ov.unassignedTasks.filter(t => (ov.unitMembers[t.unit.id] || []).includes(p.id) && !t.assigneeId);
      return [h('span', { class: 'att-who' }, avatar(p, 'sm'), p.name, h('small', { class: 'muted' }, personCaption(p))),
        quickSelect(free.length ? 'Дать задачу…' : 'Свободных задач нет', free.map(t => [t.id, t.key + ' ' + t.title]),
          v => call('updateTask', { id: v, patch: { assigneeId: p.id } }).then(() => {
            ov.unassignedTasks.find(t => t.id === v).assigneeId = p.id;
            done('Задача назначена: ' + p.name);
          }))];
    },
  }));

  if (mode === 'supabase' && ov.peopleNoLogin.length) items.push(h('button', { class: 'att-item att-info att-simple', onclick: openPeople },
    icon('user', 15), h('span', null, h('b', null, ov.peopleNoLogin.length), ' ' + plural(ov.peopleNoLogin.length, ['человек без входа', 'человека без входа', 'человек без входа'])),
    h('span', { class: 'muted' }, 'Открыть доступы')));

  const list = items.filter(Boolean);
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Требует внимания')),
    list.length ? h('div', { class: 'att' }, list) : attOk());
}

const attOk = () => h('div', { class: 'card-box att-ok' }, icon('done', 16), 'Всё в порядке: просрочек и пробелов нет');

/** Ссылка на задачу — открывает карточку поверх текущего экрана. */
const taskRef = t => taskLink(t.unit.id, t.id, { class: 'att-ref' },
  h('span', { class: 'unit-dot', style: { background: t.unit.color, margin: 0 } }), h('span', { class: 'key-badge' }, t.key), h('span', { class: 'ft-title' }, t.title));

/** Компактный выбор с действием: после успеха строка исчезает. */
function quickSelect(placeholder, options, onPick) {
  const sel = h('select', {
    class: 'inp sm', disabled: !options.length,
    onclick: e => e.stopPropagation(),
    onchange: async e => {
      if (!e.target.value) return;
      sel.disabled = true;
      try { await onPick(e.target.value); } catch (err) { showErr(err); sel.disabled = false; sel.value = ''; }
    },
  }, h('option', { value: '' }, placeholder), options.map(([v, t]) => h('option', { value: v }, t)));
  return sel;
}

/** Пункт «Требует внимания»: заголовок со счётчиком, по клику — строки с быстрыми действиями. */
function attItem({ n, forms, rows, row, tone = 'warn', icon: ic = 'alert', open = false }) {
  if (!n) return null;
  let count = n;
  let left = rows.slice();
  const el = h('div', { class: 'att-item att-' + tone });
  const draw = () => {
    if (!count) {
      el.replaceWith(h('div', { class: 'att-item att-done' }, icon('done', 15), 'Готово'));
      return;
    }
    fill(el,
      h('button', { class: 'att-head', onclick: () => { open = !open; draw(); } },
        icon(ic, 15), h('span', null, h('b', null, count), ' ' + plural(count, forms)),
        h('span', { class: 'att-chev' + (open ? ' on' : '') }, icon('chevron', 14))),
      open && h('div', { class: 'att-list' },
        left.map(r => {
          const line = h('div', { class: 'att-row' });
          const done = msg => {
            left = left.filter(x => x !== r);
            count--;
            toast(msg);
            draw();
          };
          fill(line, row(r, done));
          return line;
        }),
        count > left.length && h('div', { class: 'muted att-more' }, 'и ещё ' + (count - left.length))));
  };
  draw();
  return el;
}

const loadFilter = { pos: '', unit: '' };

/** Загрузка: открытые задачи по людям, фильтр по позиции и юниту. Клик по строке — задачи человека здесь же, «+» — дать задачу. */
export function workloadBlock(ov, { all = false } = {}) {
  const flt = loadFilter; // общий на сессию: после создания задачи страница перерисуется, фильтр останется
  let expanded = all;
  const opened = new Set();
  const body = h('div', { class: 'card-box load' });
  const head = h('div', { class: 'section-head' });
  const zero = { open: 0, inProgress: 0, overdue: 0 };
  const units = S.units.filter(u => !u.archived);
  const countsOf = p => flt.unit ? ((ov.byPersonUnit[p.id] || {})[flt.unit] || zero) : (ov.byPerson[p.id] || zero);
  const give = p => openCreateTask({ assigneeId: p.id, departmentId: p.positionId || '', unitId: flt.unit || undefined, onCreated: () => rerender() });

  const personRow = ({ p, c }, max) => {
    const wrap = h('div', { class: 'load-item' + (opened.has(p.id) ? ' open' : '') });
    const tasks = h('div', { class: 'load-tasks' });
    const loadTasks = async () => {
      fill(tasks, h('div', { class: 'boot', style: { padding: '8px' } }, h('span', { class: 'spinner' })));
      try {
        const list = (await call('queryTasks', { assigneeId: p.id, limit: 200 })).filter(t => t.statusKind !== 'done' && (!flt.unit || t.unit.id === flt.unit));
        if (!opened.has(p.id)) return;
        fill(tasks, list.length ? taskGroups(list) : h('p', { class: 'muted', style: { margin: '4px 0' } }, 'Открытых задач нет'),
          h('button', { class: 'btn ghost sm', style: { marginTop: '6px' }, onclick: () => give(p) }, icon('plus', 13), 'Дать задачу'));
      } catch (e) { showErr(e); }
    };
    const toggle = () => {
      if (opened.has(p.id)) { opened.delete(p.id); wrap.classList.remove('open'); fill(tasks); return; }
      opened.add(p.id); wrap.classList.add('open'); loadTasks();
    };
    if (opened.has(p.id)) loadTasks();
    wrap.append(
      h('div', { class: 'load-line' },
        h('button', { class: 'load-row', onclick: toggle, title: `Открыто ${c.open}, в работе ${c.inProgress}, просрочено ${c.overdue}` },
          avatar(p, 'sm'),
          h('span', { class: 'load-name' }, p.name, h('small', null, personCaption(p))),
          h('div', { class: 'load-bar' },
            h('div', { class: 'load-fill', style: { width: (c.open / max) * 100 + '%' } },
              h('div', { class: 'load-progress', style: { width: c.open ? (c.inProgress / c.open) * 100 + '%' : 0 } }))),
          h('span', { class: 'load-num' }, c.open),
          h('span', { class: 'load-late' + (c.overdue ? '' : ' zero') }, c.overdue ? c.overdue + ' просроч.' : ''))),
      tasks);
    return wrap;
  };

  const pick = (anchor, key, title, allLabel, options) => menu(anchor, [
    { title },
    { label: allLabel, icon: flt[key] ? null : 'check', action: () => { flt[key] = ''; draw(); } },
    ...options.map(([v, t]) => ({ label: t, icon: flt[key] === v ? 'check' : null, action: () => { flt[key] = v; draw(); } })),
  ]);
  const filterBtn = (key, title, allLabel, options) => {
    const cur = options.find(o => o[0] === flt[key]);
    return h('button', { class: 'btn ghost sm' + (cur ? ' on' : ''), onclick: e => { e.stopPropagation(); pick(e.currentTarget, key, title, allLabel, options); } },
      cur ? cur[1] : allLabel, icon('chevron', 12));
  };

  const draw = () => {
    const rows = S.people.filter(p => p.active && p.access === 'member')
      .filter(p => !flt.pos || p.positionId === flt.pos)
      .filter(p => !flt.unit || (ov.unitMembers[flt.unit] || []).includes(p.id))
      .map(p => ({ p, c: countsOf(p) }))
      .sort((a, b) => b.c.open - a.c.open || b.c.overdue - a.c.overdue);
    const max = Math.max(1, ...rows.map(r => r.c.open));
    const shown = expanded ? rows : rows.slice(0, 6);
    const pos = activeDepts().map(d => ({ d, c: ov.byPosition[d.id] || zero })).filter(x => x.c.open);
    fill(head, h('h2', null, 'Загрузка команды'),
      h('div', { class: 'row', style: { gap: '4px' } },
        filterBtn('pos', 'Позиция', 'Все позиции', activeDepts().map(d => [d.id, d.name])),
        filterBtn('unit', 'Юнит', 'Все юниты', units.map(u => [u.id, u.name])),
        rows.length > 6 && h('button', { class: 'btn ghost sm', onclick: () => { expanded = !expanded; draw(); } }, expanded ? 'Свернуть' : 'Все ' + rows.length)));
    fill(body,
      shown.length ? shown.map(r => personRow(r, max)) : h('p', { class: 'muted', style: { margin: 0 } }, flt.pos || flt.unit ? 'Никого по этим фильтрам' : 'Участников пока нет'),
      !flt.unit && !flt.pos && pos.length > 0 && h('div', { class: 'load-pos' }, pos.map(({ d, c }) => h('button', {
        class: 'chip', title: 'Показать только ' + d.name, onclick: () => { flt.pos = d.id; draw(); },
        style: { background: `color-mix(in srgb, ${d.color} 16%, transparent)`, color: d.color },
      }, d.name + ': ' + c.open + (c.overdue ? ' · ' + c.overdue + ' просроч.' : '')))));
  };
  draw();
  return h('section', null, head, body);
}

function summary(st) {
  const open = st.todo + st.in_progress;
  if (!open) return 'открытых задач нет';
  return open + ' ' + plural(open, ['открытая задача', 'открытые задачи', 'открытых задач']) + (st.overdue ? ', ' + st.overdue + ' просрочено' : '');
}

const weekAgo = () => new Date(Date.now() - 7 * 864e5).toISOString();

/** Плашка статистики. С фильтром — кликабельна: список задач в выпадающем меню, каждая открывается поверх. */
function stat(label, value, ic, color, pick) {
  const open = async e => {
    const anchor = e.currentTarget;
    if (anchor.classList.contains('on')) return closeMenu();
    let tasks;
    try { tasks = (await call('queryTasks', { limit: 500 })).filter(pick); } catch (err) { return showErr(err); }
    const byDue = (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
    tasks.sort(label.startsWith('Сделано') ? (a, b) => (b.doneAt || '').localeCompare(a.doneAt || '') : byDue);
    const m = menu(anchor, [
      { title: label + ' · ' + tasks.length },
      ...(tasks.length ? tasks.map(statRow) : [h('div', { class: 'muted', style: { padding: '8px 10px' } }, 'Задач нет')]),
    ]);
    m.classList.add('menu-tasks');
    m.style.left = Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, anchor.getBoundingClientRect().left)) + 'px';
    anchor.classList.add('on');
    new MutationObserver((_, obs) => { if (!m.isConnected) { anchor.classList.remove('on'); obs.disconnect(); } }).observe(document.body, { childList: true });
  };
  return h(pick ? 'button' : 'div', { class: 'stat' + (pick ? ' clickable' : ''), onclick: pick && value ? open : null },
    h('div', { class: 'stat-ic', style: { background: `color-mix(in srgb, ${color} 14%, transparent)`, color } }, icon(ic, 18)),
    h('div', null, h('div', { class: 'stat-val' }, value), h('div', { class: 'stat-label' }, label)));
}

function statRow(t) {
  const due = t.dueDate && fmtDate(t.dueDate);
  const late = t.statusKind !== 'done' && t.dueDate && t.dueDate < todayStr();
  const p = personById(t.assigneeId);
  return h('button', { class: 'menu-item st-row', onclick: () => { closeMenu(); peekTask(t.unit.id, t.id); } },
    h('span', { class: 'unit-dot', style: { background: t.unit.color, margin: 0 } }),
    h('span', { class: 'key-badge' }, t.key),
    h('span', { class: 'ft-title' }, t.title),
    h('span', { class: 'muted st-who' }, p ? p.name : 'без исполнителя'),
    due && h('span', { class: 'due' + (late ? ' overdue' : '') }, due));
}

/** Карточка юнита: команда, задачи по статусам, прогресс. apps — сколько приложений (дашборд CEO). */
export function unitCard(u, { apps, to = 'board' } = {}) {
  const c = u.counts || emptyCounts();
  const total = c.todo + c.in_progress + c.done;
  const pct = total ? Math.round((c.done / total) * 100) : 0;
  return link({ unit: u.id, mode: to }, { class: 'unit-card', dataset: { id: u.id } },
    h('div', { class: 'uc-head' },
      h('div', { class: 'uc-icon', style: { background: u.color } }, u.key.slice(0, 2)),
      h('div', { class: 'uc-title' }, h('div', { class: 'uc-name' }, u.name),
        h('div', { class: 'uc-key' }, apps != null ? apps + ' ' + plural(apps, ['приложение', 'приложения', 'приложений']) : u.key)),
      isStaff() && h('button', {
        class: 'icon-btn sm uc-add', title: 'Новая задача в ' + u.name,
        onclick: e => { e.preventDefault(); e.stopPropagation(); openCreateTask({ unitId: u.id, onCreated: () => rerender() }); },
      }, icon('plus')),
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
  let d, tasks, md;
  try {
    [d, tasks, , md] = await Promise.all([call('getHome', { today: new Date().toISOString().slice(0, 10) }), loadMyTasks(), loadNotes(),
      call('getMyDashboard', { personId: S.meId, today: todayStr() })]);
  } catch (e) {
    showErr(e);
    return;
  }
  if (currentView() !== 'home') return;
  S.units = d.units;
  S.people = d.people;
  S.departments = d.departments;
  if (d.teams) S.teams = d.teams;
  renderSidebar();

  const person = me();
  const pos = person && deptById(person.positionId);
  const units = d.units.filter(u => !u.archived);
  const open = tasks.filter(t => t.statusKind !== 'done');
  const overdue = open.filter(t => t.dueDate && t.dueDate < new Date().toISOString().slice(0, 10)).length;
  const dateStr = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

  const BLOCKS = [
    NEWS_BLOCK,
    { id: 'focus', title: 'Фокус', col: 'left', render: () => focusBlock(md) },
    md.lead && { id: 'reviews', title: 'Ждут вашего ревью', col: 'right', render: () => reviewsBlock(md, () => rerender()) },
    md.lead && { id: 'teamLoad', title: 'Загрузка позиции', col: 'right', render: () => teamLoadBlock(md) },
    { id: 'stats', title: 'Статистика', col: 'full', render: () => h('div', { class: 'stats' },
      stat('Мои открытые задачи', open.length, 'circle', 'var(--st-progress)'),
      stat('Просрочено', overdue, 'alert', 'var(--danger)'),
      stat('Мои юниты', units.length, 'board', 'var(--accent)'),
      stat('Сделано', tasks.length - open.length, 'done', 'var(--st-done)')) },
    { id: 'tasks', title: 'Мои задачи', col: 'left', render: () => h('section', null,
      h('div', { class: 'section-head' }, h('h2', null, 'Мои задачи')), unitGroups(tasks)) },
    { id: 'units', title: 'Мои юниты', col: 'right', render: () => h('section', null,
      h('div', { class: 'section-head' }, h('h2', null, 'Мои юниты')),
      units.length
        ? h('div', { class: 'unit-grid', style: { gridTemplateColumns: '1fr' } }, units.map(unitCard))
        : h('div', { class: 'card-box empty-state' }, h('p', { style: { margin: 0 } }, 'Вас пока не добавили ни в один юнит. Обратитесь к PM.'))) },
  ].filter(Boolean);
  const draw = () => fill(page,
    h('div', { class: 'hero' },
      h('div', null,
        h('h1', null, greeting() + (person ? ', ' + person.name.split(' ')[0] : '')),
        h('p', null, dateStr[0].toUpperCase() + dateStr.slice(1) + (pos ? ' · ' + pos.name : ''))),
      h('button', { class: 'btn ghost', title: 'Настроить дашборд под себя', onclick: () => editLayout('memberHome', BLOCKS, page, draw) }, icon('layers', 15), 'Настроить')),
    renderLayout('memberHome', BLOCKS));
  draw();
}

