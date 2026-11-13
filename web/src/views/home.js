import { S, greeting, me, isSuper, personById, plural, emptyCounts, isStaff, deptById, todayStr, fmtDate, activeDepts, ACCESS_LABELS, relTime, dueInfo, setPeople } from '../state.js';
import { $, h, icon, avatar, topbar, showErr, fill, toast, menu, closeMenu, modal, emptyBlock, skeleton, unitIcon } from '../ui.js';
import { call, swr } from '../api.js';
import { currentView, link, navigate, taskLink, rerender } from '../router.js';
import { renderSidebar, renderUnread } from './sidebar.js';
import { openCreateTask, peekTask } from './task.js';
import { openCreateUnit, unitMenu } from './units.js';
import { mode } from '../data.js';
import { taskGroups, unitGroups, loadMyTasks, personCaption } from './my.js';
import { activityFeed } from './feed.js';
import { appIcon } from './apps.js';
import { renderLayout, editLayout } from './layout.js';
import { openPeople } from './people.js';
import { focusBlock, reviewsBlock, teamLoadBlock, splitBlock, sentBlock } from './employee.js';

/* ---------- «Новое для вас»: задачи, которые на меня назначили ---------- */

/** S.history — уведомления с историей (прочитанные за N дней, read: true); S.notes — только новые (блок на главной). */
export async function loadNotes() {
  S.history = await call('getNotifications', { today: todayStr(), personId: S.meId }).catch(() => []);
  S.notes = S.history.filter(n => !n.read);
  S.unread = S.notes.length;
  renderUnread();
}

/** Отметить прочитанным по задаче (открыли её): на главной строка уходит, в колокольчике — остаётся приглушённой. */
export function readNote(taskId) {
  if (!S.notes.some(n => n.taskId === taskId)) return;
  S.notes = S.notes.filter(n => n.taskId !== taskId);
  (S.history || []).forEach(n => { if (n.taskId === taskId) n.read = true; });
  S.unread = Math.max(0, S.unread - 1);
  renderUnread();
  document.querySelectorAll(`[data-note-task="${CSS.escape(taskId)}"]`).forEach(fadeOut);
  document.querySelectorAll(`[data-hist-task="${CSS.escape(taskId)}"]`).forEach(el => el.classList.add('read'));
  call('readNotifications', { taskId, personId: S.meId }).catch(showErr);
}

function fadeOut(el) {
  el.classList.add('gone');
  setTimeout(() => {
    const box = el.closest('.news');
    el.remove();
    if (box && !box.querySelector('.news-row')) box.closest('section').remove();
  }, 220);
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

const NEWS_DANGER = ['overdue', 'returned', 'store_reject'];

/** Новые предложения (обратная связь) — одной строкой; клик открывает раздел «Обратная связь» и отмечает прочитанным. */
function feedbackRow(n, history) {
  const by = personById(n.actorId);
  const text = n.count > 1 ? ['Новые предложения по улучшению: ', h('b', null, String(n.count))]
    : by ? [h('b', null, by.name.split(' ')[0]), ' предложил(а) улучшение'] : ['Новое предложение по улучшению'];
  return h('button', {
    class: 'news-row' + (n.read ? ' read' : ''), dataset: history ? { histTask: 'feedback' } : { noteTask: 'feedback' },
    onclick: () => { readFeedbackNotes(); navigate({ view: 'dev' }); },
  },
  by ? avatar(by, 'lg') : h('span', { class: 'news-noapp' }),
  h('span', { class: 'news-body' }, h('span', { class: 'news-sentence' }, text), h('span', { class: 'news-sub' }, ['Обратная связь', relTime(n.at)].join(' · '))),
  !n.read && h('span', { class: 'news-dot' }));
}

/** Отметить прочитанными уведомления о предложениях (открыли «Обратную связь»). */
export function readFeedbackNotes() {
  if (!S.notes || !S.notes.some(n => n.feedback)) return;
  S.notes = S.notes.filter(n => !n.feedback);
  (S.history || []).forEach(n => { if (n.feedback) n.read = true; });
  S.unread = Math.max(0, S.unread - 1);
  renderUnread();
  document.querySelectorAll('[data-note-task="feedback"]').forEach(fadeOut);
  document.querySelectorAll('[data-hist-task="feedback"]').forEach(el => el.classList.add('read'));
  call('readNotifications', { kind: 'feedback', personId: S.meId }).catch(showErr);
}

/**
 * «Новое для вас» на главной — только новые. history: true — колокольчик: новые и прочитанные за N дней
 * (прочитанные приглушены, без точки), «Прочитать все» не убирает строки, а приглушает их.
 */
export function newsBlock({ history = false } = {}) {
  const src = () => (history ? S.history || [] : S.notes);
  if (!src().length) return null;
  const row = n => (n.feedback ? feedbackRow(n, history) : taskRow(n));
  const taskRow = n => {
    const by = personById(n.actorId);
    const who = by && by.id !== S.meId ? h('b', null, by.name.split(' ')[0]) : null;
    const q = '«' + n.title + '»';
    const di = dueInfo(n.dueDate, n.kind === 'approved');
    // предложение, как в макете: «<b>Екатерина</b> назначила вас на «…»»; без автора — безлично
    const text = {
      assigned: who ? [who, ' назначил(а) вас на ', q] : ['Вас назначили на ', q],
      handoff: who ? [who, ' поставил(а) вам ', n.title] : ['Вам поставили ', n.title],
      review: who ? [who, ' отдал(а) на ревью ', q] : ['На ревью: ', q],
      returned: who ? [who, ' вернул(а) на доработку ', q] : ['Вернули на доработку ', q],
      approved: who ? [who, ' принял(а) ', q] : ['Принято: ', q],
      task_done: who ? [who, ' закрыл(а) ', q] : ['Закрыта задача ', q],
      mention: who ? [who, ' упомянул(а) вас в ', q] : ['Вас упомянули в ', q],
      unblocked: ['Можно начинать ', q],
      due_soon: ['Срок ' + (n.dueDate === todayStr() ? 'сегодня' : 'завтра') + ': ', q],
      overdue: ['Просрочено: ', q],
      store_live: ['Вышло в App Store: ', q],
      store_reject: ['Реджект Apple: ', q],
    }[n.kind] || [q];
    return h('button', {
      class: 'news-row' + (n.read ? ' read' : ''), dataset: history ? { histTask: n.taskId } : { noteTask: n.taskId }, onclick: () => peekTask(n.unit.id, n.taskId),
      title: `${n.key} · ${n.unit.name}`,
    },
    by ? avatar(by, 'lg') : n.app ? appIcon(n.app, 'sm') : h('span', { class: 'news-noapp' }),
    h('span', { class: 'news-body' },
      h('span', { class: 'news-sentence' }, text),
      h('span', { class: 'news-sub' }, [n.unit.name, relTime(n.at), di && di.cls === 'overdue' && 'срок ' + fmtDate(n.dueDate)].filter(Boolean).join(' · '))),
    !n.read && h('span', { class: 'news-dot' + (NEWS_DANGER.includes(n.kind) ? ' danger' : '') }));
  };
  const readAll = () => {
    S.notes = [];
    (S.history || []).forEach(n => { n.read = true; });
    S.unread = 0;
    renderUnread();
    call('readNotifications', { personId: S.meId }).catch(showErr);
    if (history) {
      sec.querySelectorAll('.news-row').forEach(el => { el.classList.add('read'); el.querySelector('.news-dot')?.remove(); });
      readBtn.remove(); title.textContent = 'Уведомления';
      document.querySelectorAll('[data-note-task]').forEach(fadeOut); // и блок «Новое для вас» на главной
    }
    else sec.querySelectorAll('.news-row').forEach(fadeOut);
  };
  // колонка «что случилось» — только если хоть у одной строки есть подпись (иначе не занимает место)
  const list = h('div', { class: 'news card-box' + (history ? ' news-hist' : '') });
  const title = h('h2', null, history ? (S.unread ? 'Новых: ' + S.unread : 'Уведомления') : 'Новое для вас · ' + S.notes.length);
  const readBtn = (!history || S.unread > 0) ? h('button', { class: 'link-btn', onclick: readAll }, 'Прочитать все') : null;
  const sec = h('section', { class: 'news-sec' }, h('div', { class: 'section-head' }, title, readBtn), list);
  // длинный список: 2 строки (в колокольчике — 6), «Ещё N» раскрывает до 15 (40), больше — «Все уведомления» окном
  const LIMIT = history ? 6 : 2, MAX = history ? 40 : 15;
  let all = false;
  function drawList() {
    const items = src();
    const n = items.length;
    fill(list, (all ? items.slice(0, MAX) : items.slice(0, LIMIT)).map(row),
      n > LIMIT && h('div', { class: 'news-more-row' },
        h('button', { class: 'link-btn news-more', 'aria-expanded': String(all), onclick: () => { all = !all; drawList(); } },
          all ? 'Свернуть' : 'Показать ещё ' + (Math.min(n, MAX) - LIMIT)),
        all && n > MAX && h('button', { class: 'link-btn news-more', onclick: () => openAllNews(row, items) }, 'Все уведомления · ' + n)));
    list.classList.toggle('expanded', all);
  }
  drawList();
  return sec;
}

/** Все непрочитанные отдельным окном (когда их больше 15). */
function openAllNews(row, items) {
  const list = h('div', { class: 'news card-box news-all' }, items.map(row));
  const close = modal({ title: 'Уведомления · ' + items.length, cls: 'dlg', body: list, actions: [{ label: 'Закрыть', primary: true, action: c => c() }] });
  list.addEventListener('click', e => { if (e.target.closest('.news-row')) close(); });
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
  const page = h('div', { class: 'page' }, skeleton());
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
  setPeople(d.people);
  S.departments = d.departments;
  if (d.teams) S.teams = d.teams;
  renderSidebar();

  const units = d.units.filter(u => !u.archived);
  const person = me();
  const st = d.stats;
  const dateStr = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

  const unitsBlock = () => h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Юниты'),
      isSuper() && h('button', { class: 'btn ghost sm', onclick: openCreateUnit }, icon('plus', 14), 'Новый')),
    units.length
      ? h('div', { class: 'unit-grid' }, units.map(unitCard), isSuper() && h('button', { class: 'unit-card add', onclick: openCreateUnit }, icon('plus', 18), 'Новый юнит'))
      : h('div', { class: 'card-box empty-state' },
        h('h2', null, isSuper() ? 'Создайте первый юнит' : 'Юнитов пока нет'),
        h('p', null, 'Юнит — направление студии (Gold, RF, MVP…): его приложения, PM, RM, лиды и сотрудники.'),
        h('div', { class: 'row', style: { justifyContent: 'center' } },
          isSuper() && h('button', { class: 'btn primary', onclick: openCreateUnit }, icon('plus', 15), 'Создать юнит'),
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
      return [h('span', { class: 'att-who', 'data-pcard': p.id }, avatar(p, 'sm'), p.name, h('small', { class: 'muted' }, personCaption(p))),
        quickSelect(free.length ? 'Поставить задачу…' : 'Свободных задач нет', free.map(t => [t.id, t.key + ' ' + t.title]),
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
const HEAVY = 5; // с этого числа открытых задач полоса предупреждает

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
          h('button', { class: 'btn ghost sm', style: { marginTop: '6px' }, onclick: () => give(p) }, icon('plus', 13), 'Поставить задачу'));
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
            h('div', { class: 'load-fill' + (c.open >= HEAVY ? ' heavy' : ''), style: { width: (c.open / max) * 100 + '%' } })),
          h('span', { class: 'load-num' + (c.open ? '' : ' muted') }, c.open ? c.open + ' ' + plural(c.open, ['задача', 'задачи', 'задач']) : 'нет задач')),
        h('button', { class: 'btn sm load-give', onclick: () => give(p) }, 'Поставить задачу')),
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
    fill(head, h('h2', null, 'Загрузка команды'),
      h('div', { class: 'row', style: { gap: '4px' } },
        filterBtn('pos', 'Позиция', 'Все позиции', activeDepts().map(d => [d.id, d.name])),
        filterBtn('unit', 'Юнит', 'Все юниты', units.map(u => [u.id, u.name])),
        rows.length > 6 && h('button', { class: 'btn ghost sm', onclick: () => { expanded = !expanded; draw(); } }, expanded ? 'Свернуть' : 'Все ' + rows.length)));
    fill(body,
      shown.length ? shown.map(r => personRow(r, max)) : h('p', { class: 'muted', style: { margin: 0 } }, flt.pos || flt.unit ? 'Никого по этим фильтрам' : 'Участников пока нет'));
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
    h('div', { class: 'stat-ic' }, icon(ic, 18)),
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
  const people = (u.members || []).length;
  const sub = [apps != null ? apps + ' ' + plural(apps, ['приложение', 'приложения', 'приложений']) : u.key,
    people ? people + ' ' + plural(people, ['участник', 'участника', 'участников']) : 'команда не собрана'].join(' · ');
  return link({ unit: u.id, mode: to }, { class: 'unit-card', dataset: { id: u.id },
    title: `К выполнению ${c.todo} · В работе ${c.in_progress} · Готово ${c.done}` },
    h('div', { class: 'uc-head' },
      unitIcon(u),
      h('div', { class: 'uc-title' }, h('div', { class: 'uc-name' }, u.name),
        h('div', { class: 'uc-key' }, sub, c.overdue > 0 && h('span', { class: 'uc-late' }, ' · ' + c.overdue + ' просрочено'))),
      // действия — по наведению, как в макете 12 (в покое у карточки нет кнопок)
      isStaff() && h('button', {
        class: 'icon-btn sm uc-menu', title: 'Действия',
        onclick: e => { e.preventDefault(); e.stopPropagation(); unitMenu(e.currentTarget, u); },
      }, icon('more'))),
    u.description && h('div', { class: 'uc-desc' }, u.description),
    // в покое — прогресс, при наведении — счётчики (макет 12, карточка Gold); оба в одной ячейке — высота карточки не прыгает
    h('div', { class: 'uc-stats' },
      h('div', { class: 'uc-foot' },
        h('div', { class: 'progress', title: 'Выполнено ' + pct + '%' }, h('div', { style: { width: pct + '%' } })),
        h('span', { class: 'uc-pct' }, pct + '%')),
      h('div', { class: 'uc-counts' },
        h('span', null, 'В работе ' + c.in_progress), h('span', { class: 'spacer' }),
        h('span', null, 'На ревью ' + (c.review || 0)), h('span', null, 'Готово ' + c.done))));
}


/** Дашборд участника: его юниты (доска и бэклог своей позиции) и его задачи. */
async function renderMemberHome() {
  const page = h('div', { class: 'page' }, skeleton());
  let editHook = null;
  fill($('#main'), topbar([h('div', { class: 'screen-head' }, h('div', { class: 'screen-date' }, (() => { const t = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }); return t.charAt(0).toUpperCase() + t.slice(1); })()),
    h('h1', { class: 'screen-title' }, 'Мой дашборд'))], [h('button', { class: 'btn', title: 'Настроить дашборд под себя', onclick: () => editHook && editHook() }, 'Настроить')]), h('div', { class: 'view-body' }, page));
  // повторный заход — сразу из памяти, свежее — в фоне
  try {
    await swr('member-home', () => Promise.all([call('getHome', { today: new Date().toISOString().slice(0, 10) }), loadMyTasks(), loadNotes(),
      call('getMyDashboard', { personId: S.meId, today: todayStr() })]), show, { still: () => currentView() === 'home' });
  } catch (e) { showErr(e); }

  function show([d, tasks, , md]) {
    S.units = d.units;
    setPeople(d.people);
    S.departments = d.departments;
    if (d.teams) S.teams = d.teams;
    renderSidebar();

    const units = d.units.filter(u => !u.archived);
    const open = tasks.filter(t => t.statusKind !== 'done');
    const overdue = open.filter(t => t.dueDate && t.dueDate < new Date().toISOString().slice(0, 10)).length;

    const BLOCKS = [
      { ...NEWS_BLOCK, off: true },
      { id: 'focus', title: 'Фокус', col: 'full', render: () => focusBlock(md, () => rerender()) },
      (me() || {}).access === 'member' && { id: 'sent', title: 'Отправлено на ревью', col: 'left', render: () => sentBlock(md, () => rerender()) },
      md.lead && { id: 'reviews', title: 'Ждут вашего ревью', col: 'left', render: () => reviewsBlock(md, () => rerender()) },
      md.lead && { id: 'split', title: 'Раздано', col: 'left', off: true, render: () => splitBlock(md) },
      md.lead && { id: 'teamLoad', title: 'Загрузка позиции', col: 'right', render: () => teamLoadBlock(md) },
      { id: 'stats', title: 'Статистика', col: 'full', off: true, render: () => h('div', { class: 'cs-row' },
        h('div', { class: 'cs' }, h('div', { class: 'cs-n' }, open.length), h('div', { class: 'cs-label' }, 'открытых задач')),
        h('div', { class: 'cs' + (overdue ? ' danger' : '') }, h('div', { class: 'cs-n' }, overdue), h('div', { class: 'cs-label' }, 'просрочено')),
        h('div', { class: 'cs' }, h('div', { class: 'cs-n' }, tasks.length - open.length), h('div', { class: 'cs-label' }, 'сделано')),
        h('div', { class: 'cs' }, h('div', { class: 'cs-n' }, units.length), h('div', { class: 'cs-label' }, plural(units.length, ['юнит', 'юнита', 'юнитов'])))) },
      { id: 'tasks', title: 'Мои задачи', col: 'left', off: true, render: () => h('section', null,
        h('div', { class: 'section-head' }, h('h2', null, 'Мои задачи')), unitGroups(tasks)) },
      { id: 'units', title: 'Мои юниты', col: 'right', off: true, render: () => h('section', null,
        h('div', { class: 'section-head' }, h('h2', null, 'Мои юниты')),
        units.length
          ? h('div', { class: 'unit-grid', style: { gridTemplateColumns: '1fr' } }, units.map(unitCard))
          : emptyBlock('Юнитов пока нет', { ic: 'board' })) },
    ].filter(Boolean);
    editHook = () => editLayout('memberHome', BLOCKS, page, draw);
    const draw = () => fill(page, renderLayout('memberHome', BLOCKS));
    draw();
  }
}

