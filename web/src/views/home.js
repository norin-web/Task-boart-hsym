import { S, greeting, me, personById, plural, emptyCounts, isStaff, deptById, todayStr, fmtDate, activeDepts, ACCESS_LABELS } from '../state.js';
import { $, h, icon, avatar, topbar, showErr, fill, toast, menu } from '../ui.js';
import { call } from '../api.js';
import { currentView, link, navigate, taskLink, rerender } from '../router.js';
import { renderSidebar } from './sidebar.js';
import { openCreateTask, peekTask } from './task.js';
import { openCreateUnit, unitMenu } from './units.js';
import { mode } from '../data.js';
import { taskGroups, loadMyTasks, personCaption } from './my.js';
import { activityFeed } from './feed.js';
import { openPeople } from './people.js';

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

    signalsBlock(ov),

    h('div', { class: 'home-grid' },
      h('div', { class: 'home-col' },
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

/**
 * Сигналы для админа: что сделать с командой прямо сейчас. 4 главные плашки + мелкие пробелы строкой ниже.
 * Клик открывает под плашками список с действием на месте; исправленная строка исчезает, счётчик уменьшается.
 */
export function signalsBlock(ov) {
  const name = id => (personById(id) || { name: '—' }).name;
  const members = S.people.filter(p => p.active && p.access === 'member');
  const positions = () => activeDepts().map(d => [d.id, d.name]);
  const teamOf = unitId => (ov.unitMembers[unitId] || []).map(personById).filter(p => p && p.active);
  const today = todayStr();

  // Перегружены: открытых заметно больше среднего или 2+ просрочки
  const loads = members.map(p => ov.byPerson[p.id] || { open: 0, overdue: 0 });
  const busy = loads.filter(c => c.open);
  const avg = busy.length ? busy.reduce((n, c) => n + c.open, 0) / busy.length : 0;
  const heavy = c => c.open >= Math.max(4, Math.ceil(avg * 1.5)) || c.overdue >= 2;
  const overloaded = members.filter(p => heavy(ov.byPerson[p.id] || { open: 0, overdue: 0 }));
  const idle = members.filter(p => !(ov.byPerson[p.id] || {}).open);

  const SIG = [
    {
      key: 'unassigned', main: true, tone: 'warn', icon: 'user', n: ov.unassigned, rows: ov.unassignedTasks, tag: 'Без исполнителя',
      forms: ['задача без исполнителя', 'задачи без исполнителя', 'задач без исполнителя'], label: 'Без исполнителя',
      row: (t, done) => {
        const team = teamOf(t.unit.id);
        return [taskRef(t), quickSelect(team.length ? 'Назначить…' : 'В юните нет команды', team.map(p => [p.id, p.name + ' · ' + ((ov.byPerson[p.id] || {}).open || 0)]),
          v => call('updateTask', { id: t.id, patch: { assigneeId: v } }).then(() => { t.assigneeId = v; done('Назначено: ' + name(v)); }))];
      },
    },
    {
      key: 'overdue', main: true, tone: 'danger', icon: 'alert', n: ov.overdueTotal, rows: ov.overdue, tag: 'Просрочено',
      forms: ['просроченная задача', 'просроченные задачи', 'просроченных задач'], label: 'Просрочено',
      row: (t, done) => [taskRef(t), h('span', { class: 'muted att-meta' }, t.assigneeId ? name(t.assigneeId) : 'без исполнителя'),
        h('input', {
          class: 'inp sm', type: 'date', value: t.dueDate, title: 'Перенести срок',
          onchange: async e => {
            const v = e.target.value;
            try {
              await call('updateTask', { id: t.id, patch: { dueDate: v } });
              if (!v || v >= today) done('Срок перенесён' + (v ? ' на ' + fmtDate(v) : ''));
            } catch (err) { showErr(err); e.target.value = t.dueDate; }
          },
        })],
    },
    {
      key: 'idle', main: true, tone: 'info', icon: 'user', n: idle.length, rows: idle, tag: 'Без задач',
      forms: ['участник без задач', 'участника без задач', 'участников без задач'], label: 'Свободны',
      row: (p, done) => {
        const free = ov.unassignedTasks.filter(t => (ov.unitMembers[t.unit.id] || []).includes(p.id) && !t.assigneeId);
        return [personRef(p),
          free.length > 0 && quickSelect('Свободная задача…', free.map(t => [t.id, t.key + ' ' + t.title]),
            v => call('updateTask', { id: v, patch: { assigneeId: p.id } }).then(() => { ov.unassignedTasks.find(t => t.id === v).assigneeId = p.id; done('Задача назначена: ' + p.name); })),
          h('button', { class: 'btn ghost sm', onclick: () => openCreateTask({ assigneeId: p.id, departmentId: p.positionId || '', onCreated: () => done('Задача создана: ' + p.name) }) }, icon('plus', 13), 'Новая')];
      },
    },
    {
      key: 'overloaded', main: true, tone: 'warn', icon: 'progress', n: overloaded.length, rows: overloaded, tag: 'Перегрузка',
      forms: ['перегруженный участник', 'перегруженных участника', 'перегруженных участников'], label: 'Перегружены',
      row: p => {
        const c = ov.byPerson[p.id];
        // Выбор задачи открывает её карточку поверх — там и передаём другому
        const sel = h('select', {
          class: 'inp sm', title: 'Открыть задачу, чтобы передать её',
          onfocus: async () => {
            if (sel.options.length > 1) return;
            try {
              const list = (await call('queryTasks', { assigneeId: p.id, limit: 200 })).filter(t => t.statusKind !== 'done');
              sel.append(...list.map(t => h('option', { value: t.unit.id + '|' + t.id }, t.key + ' ' + t.title)));
            } catch (e) { showErr(e); }
          },
          onchange: e => { const [u, id] = e.target.value.split('|'); e.target.value = ''; if (id) peekTask(u, id); },
        }, h('option', { value: '' }, 'Передать задачу…'));
        return [personRef(p), h('span', { class: 'muted att-meta' }, c.open + ' откр.' + (c.overdue ? ' · ' + c.overdue + ' просроч.' : '')), sel];
      },
    },
    {
      key: 'noPosition', label: 'Без позиции', n: ov.noPosition, rows: ov.noPositionTasks,
      forms: ['задача без позиции', 'задачи без позиции', 'задач без позиции'],
      row: (t, done) => [taskRef(t), quickSelect('Позиция…', positions(),
        v => call('updateTask', { id: t.id, patch: { departmentId: v } }).then(() => done('Позиция: ' + deptById(v).name)))],
    },
    {
      key: 'peopleNoPosition', label: 'Человек без позиции', n: ov.peopleNoPosition.length, rows: ov.peopleNoPosition.map(personById).filter(Boolean),
      forms: ['участник без позиции', 'участника без позиции', 'участников без позиции'],
      row: (p, done) => [personRef(p), quickSelect('Позиция…', positions(),
        v => call('updatePerson', { id: p.id, positionId: v }).then(() => { p.positionId = v; done(p.name + ' — ' + deptById(v).name); }))],
    },
    {
      key: 'unitsNoTeam', label: 'Юнит без команды', n: ov.unitsNoTeam.length, rows: ov.unitsNoTeam.map(id => S.units.find(u => u.id === id)).filter(Boolean),
      forms: ['юнит без команды', 'юнита без команды', 'юнитов без команды'],
      row: (u, done) => [h('span', { class: 'att-who' }, h('span', { class: 'unit-dot', style: { background: u.color, margin: 0 } }), u.name),
        quickSelect(members.length ? 'Добавить участника…' : 'Нет участников', members.map(p => [p.id, p.name + (deptById(p.positionId) ? ' · ' + deptById(p.positionId).name : '')]),
          v => call('setMember', { unitId: u.id, personId: v, departmentId: personById(v).positionId || '' }).then(() => {
            u.members = [...(u.members || []), v];
            done(name(v) + ' в команде ' + u.name);
          }))],
    },
    mode === 'supabase' && { key: 'noLogin', label: 'Без входа', n: ov.peopleNoLogin.length, rows: ov.peopleNoLogin.map(personById).filter(Boolean), row: p => [personRef(p), h('button', { class: 'btn ghost sm', onclick: openPeople }, 'Создать вход')] },
  ].filter(Boolean);

  // Один постоянный список «Что сделать»; плашки только фильтруют его. Строки строятся один раз — без перерисовок.
  let active = null;
  const items = SIG.filter(sg => sg.rows).flatMap(sg => sg.rows.map(r => ({ sg, r })));
  const list = h('div', { class: 'todo-list' });
  const footer = h('div', { class: 'todo-foot' });
  const LIMIT = 8;
  let showAll = false;
  const tileCount = new Map();
  const tagOf = sg => h('span', { class: 'todo-tag sig-' + (sg.tone || 'warn') }, sg.tag || sg.label);

  for (const it of items) {
    it.el = h('div', { class: 'att-row todo-row' });
    fill(it.el, tagOf(it.sg), it.sg.row(it.r, msg => {
      it.done = true;
      it.sg.n--;
      toast(msg);
      it.el.classList.add('leaving');
      setTimeout(() => { it.el.remove(); update(); }, 220);
      updateCounts();
    }));
  }

  const updateCounts = () => SIG.forEach(sg => {
    const el = tileCount.get(sg);
    if (!el) return;
    el.textContent = sg.n;
    el.closest('.signal').classList.toggle('ok', !sg.n);
  });

  const update = () => {
    const vis = items.filter(it => !it.done && (!active || it.sg === active));
    const shown = showAll ? vis : vis.slice(0, LIMIT);
    fill(list, shown.length ? shown.map(it => it.el) : h('div', { class: 'att-ok' }, icon('done', 16), active ? 'Здесь всё сделано' : 'Всё в порядке — делать ничего не нужно'));
    const hidden = SIG.filter(sg => (!active || sg === active) && sg.n > sg.rows.length).reduce((n, sg) => n + sg.n - sg.rows.length, 0);
    fill(footer,
      vis.length > LIMIT && h('button', { class: 'link-btn', onclick: () => { showAll = !showAll; update(); } }, showAll ? 'Свернуть' : 'Показать все ' + vis.length),
      hidden > 0 && h('span', { class: 'muted' }, 'ещё ' + hidden + ' — в юнитах'));
    tiles.querySelectorAll('.signal').forEach(t => t.classList.toggle('on', t._sg === active));
    resetBtn.hidden = !active;
    if (active) fill(resetBtn, active.label, icon('x', 12));
  };

  const tiles = h('div', { class: 'stats signals' }, SIG.filter(x => x.main).map(sg => {
    const val = h('div', { class: 'stat-val' }, sg.n);
    tileCount.set(sg, val);
    const el = h('button', {
      class: 'stat signal sig-' + sg.tone, title: 'Показать только: ' + sg.label,
      onclick: () => { active = active === sg ? null : sg; showAll = false; update(); },
    },
    h('div', { class: 'stat-ic' }, icon(sg.icon, 18)),
    h('div', { class: 'sig-body' }, val, h('div', { class: 'stat-label' }, sg.label)));
    el._sg = sg;
    el.classList.toggle('ok', !sg.n);
    return el;
  }));
  const resetBtn = h('button', { class: 'btn ghost sm on', title: 'Показать всё', onclick: () => { active = null; update(); } });
  const head = h('div', { class: 'section-head' }, h('h2', null, 'Что сделать'), resetBtn);
  update();
  return h('section', { class: 'signals-wrap' }, tiles, head, h('div', { class: 'card-box todo-box' }, list, footer));
}

/** Ссылка на задачу — открывает карточку поверх текущего экрана. */
const taskRef = t => taskLink(t.unit.id, t.id, { class: 'att-ref' },
  h('span', { class: 'unit-dot', style: { background: t.unit.color, margin: 0 } }), h('span', { class: 'key-badge' }, t.key), h('span', { class: 'ft-title' }, t.title));

const personRef = p => h('span', { class: 'att-who' }, avatar(p, 'sm'), p.name, h('small', { class: 'muted' }, personCaption(p)));

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

