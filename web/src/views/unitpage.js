/**
 * Вкладки юнита «Обзор» (#/u/:id/overview) и «Команда» (#/u/:id/team). Шапка с крошками и вкладками — unitnav.js.
 * Обзор: описание, цифры, что в работе и что требует внимания, ответственный и команда коротко.
 * Команда: люди юнита — роль, позиция, открытые задачи в юните; добавить участника — руководителям.
 */
import { S, isSuper, isStaff, todayStr, ACCESS_LABELS, personById, deptById, taskDone, plural, columns, colColor, appStatusById } from '../state.js';
import { $, h, icon, avatar, showErr, fill, menu, toast, emptyBlock } from '../ui.js';
import { call, send } from '../api.js';
import { currentView, link } from '../router.js';
import { openCreateApp, openNewAppTask, pmsOf, appIcon, appStatusCell, openAppCard } from './apps.js';
import { attention, inProgress, recent } from './ceo.js';
import { unitHeader } from './unitnav.js';
import { addMemberDialog } from './people.js';

export async function renderUnitPage() {
  const u = S.board.unit;
  const key = 'overview:' + u.id;
  const page = h('div', { class: 'page unit-page' }, h('div', { class: 'boot' }, h('span', { class: 'spinner' }), 'Загрузка…'));
  const actions = h('div', { class: 'row', style: { gap: '8px' } });
  const draw = () => fill($('#main'), ...unitHeader('overview', [actions]), h('div', { class: 'view-body' }, page));
  draw();

  async function load() {
    let apps, d;
    try {
      [apps, d] = await Promise.all([call('listApps', { unitId: u.id }), call('getCeoDashboard', { today: todayStr() })]);
    } catch (e) { return showErr(e); }
    if (currentView() !== key) return;
    // приложения юнита — в общий список (их ищут формы «Новая задача» и счётчик вкладки)
    S.apps = [...S.apps.filter(a => a.unitId !== u.id), ...apps.map(({ requests, active, ...a }) => a)];
    draw();
    const mine = x => x.app && x.app.unitId === u.id;
    const ud = { ...d, attention: d.attention.filter(mine), inProgress: d.inProgress.filter(mine), recent: d.recent.filter(mine) };
    const open = S.board.tasks.filter(t => !t.archived && !taskDone(t));
    const today = todayStr();
    const late = open.filter(t => t.dueDate && t.dueDate < today).length;
    const stat = (n, label, mode, tone) => link({ unit: u.id, mode }, { class: 'cs' + (tone ? ' ' + tone : '') }, h('div', { class: 'cs-n' }, n), h('div', { class: 'cs-label' }, label));

    fill(actions,
      isSuper() && h('button', {
        class: 'btn', disabled: !apps.length, title: apps.length ? '' : 'Сначала приложение — задача ставится по нему',
        onclick: () => openNewAppTask(load, u.id),
      }, icon('plus', 15), h('span', { class: 'btn-label' }, 'Новая задача')),
      isSuper() && h('button', { class: 'btn primary', onclick: () => openCreateApp(load, u.id) }, icon('plus', 15), h('span', { class: 'btn-label' }, 'Новое приложение')));

    fill(page,
      u.description && h('p', { class: 'muted unit-desc' }, u.description),
      h('div', { class: 'cs-row unit-stats' },
        stat(apps.length, plural(apps.length, ['приложение', 'приложения', 'приложений']), 'apps'),
        stat(apps.filter(a => a.active > 0).length, 'в работе', 'apps'),
        stat(open.length, 'открытых задач', 'list'),
        stat(late, 'просрочено', 'list', late ? 'danger' : '')),
      h('div', { class: 'home-grid' },
        h('div', { class: 'home-col' }, inProgress(ud, load), appsBrief(u, apps, load), attention(ud, load)),
        h('div', { class: 'home-col' }, tasksByColumn(u, open), teamBrief(u), owner(u, load), recent(ud, load, { empty: 'За 30 дней статусы приложений юнита не менялись' }))));
  }

  load();
}

/** Команда на обзоре: кто, позиция и сколько задач в работе; самые загруженные сверху. */
function teamBrief(u) {
  const today = todayStr();
  const rows = S.board.members.map(m => {
    const p = personById(m.personId);
    const t = p ? S.board.tasks.filter(x => !x.archived && !taskDone(x) && x.assigneeId === p.id) : [];
    return p && { p, pos: (deptById(m.departmentId) || deptById(p.positionId) || {}).name || '', n: t.length, late: t.filter(x => x.dueDate && x.dueDate < today).length };
  }).filter(Boolean).sort((a, b) => b.n - a.n || a.p.name.localeCompare(b.p.name, 'ru'));
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Команда', rows.length > 0 && h('span', { class: 'muted sec-n' }, rows.length)),
      link({ unit: u.id, mode: 'team' }, { class: 'btn ghost sm' }, 'Вся команда')),
    rows.length
      ? h('div', { class: 'card-box team-list' }, rows.slice(0, 6).map(x => h('div', { class: 'team-row compact' },
        avatar(x.p, 'sm'),
        h('span', { class: 'team-who' }, h('b', null, x.p.name), h('small', { class: 'muted' }, x.pos || ACCESS_LABELS[x.p.access] || '')),
        h('span', { class: 'team-load' + (x.late ? ' warn-text' : x.n ? '' : ' muted') }, x.n ? x.n + (x.late ? ` · ${x.late} просроч.` : '') : '—'))),
        rows.length > 6 && link({ unit: u.id, mode: 'team' }, { class: 'rc-more link-btn' }, `Ещё ${rows.length - 6}`))
      : emptyBlock('Команда не собрана', { ic: 'users' }));
}

/** Задачи юнита по колонкам доски: полоса и цифры; клик — на вкладку «Задачи». */
function tasksByColumn(u, open) {
  const all = S.board.tasks.filter(t => !t.archived);
  const cols = columns().map(c => ({ c, n: all.filter(t => t.status === c.id).length }));
  const total = all.length;
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Задачи', h('span', { class: 'muted sec-n' }, `${open.length} открыто`)),
      link({ unit: u.id, mode: 'list' }, { class: 'btn ghost sm' }, 'Все задачи')),
    total
      ? h('div', { class: 'card-box col-sum' },
        h('div', { class: 'col-sum-bar', 'aria-hidden': 'true' }, cols.filter(x => x.n).map(x => h('span', { style: { flex: x.n, background: colColor(x.c) } }))),
        h('div', { class: 'col-sum-list' }, cols.map(x => h('span', { class: 'col-sum-item' + (x.n ? '' : ' zero') },
          h('span', { class: 'dot', style: { background: colColor(x.c) } }), x.c.name, h('b', null, x.n)))))
      : emptyBlock('Задач пока нет', { ic: 'list' }));
}

/** Приложения юнита коротко: иконка, название, статус; клик — карточка. Все — на вкладке «Приложения». */
function appsBrief(u, apps, reload) {
  const LIMIT = 8;
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Приложения', apps.length > 0 && h('span', { class: 'muted sec-n' }, apps.length)),
      link({ unit: u.id, mode: 'apps' }, { class: 'btn ghost sm' }, 'Все приложения')),
    apps.length
      ? h('div', { class: 'card-box app-brief' }, apps.slice(0, LIMIT).map(a => h('button', { class: 'app-brief-row', onclick: () => openAppCard(a, reload) },
        appIcon(a, 'sm'),
        h('span', { class: 'app-brief-name' }, h('b', null, a.name), a.storeName && h('small', { class: 'muted' }, a.storeName)),
        appStatusCell(appStatusById(a.status), a))),
        apps.length > LIMIT && link({ unit: u.id, mode: 'apps' }, { class: 'rc-more link-btn' }, `Ещё ${apps.length - LIMIT}`))
      : emptyBlock('Приложений пока нет', { ic: 'app' }));
}

/** Вкладка «Команда»: участники юнита — роль, позиция в юните, открытые и просроченные задачи здесь. */
export function renderUnitTeam() {
  const u = S.board.unit;
  const today = todayStr();
  const body = h('div', { class: 'page unit-page' });
  const draw = () => {
    const rows = S.board.members.map(m => ({ m, p: personById(m.personId) })).filter(x => x.p)
      .sort((a, b) => a.p.name.localeCompare(b.p.name, 'ru'));
    const mine = id => S.board.tasks.filter(t => !t.archived && !taskDone(t) && t.assigneeId === id);
    fill($('#main'), ...unitHeader('team', [
      isStaff() && h('button', { class: 'btn primary', onclick: async () => { if (await addMemberDialog(u.id)) draw(); } }, icon('plus', 15), h('span', { class: 'btn-label' }, 'Участник')),
    ]), h('div', { class: 'view-body' }, body));
    fill(body, rows.length
      ? h('div', { class: 'card-box team-list' }, rows.map(({ m, p }) => {
        const t = mine(p.id), late = t.filter(x => x.dueDate && x.dueDate < today).length;
        return h('div', { class: 'team-row' },
          avatar(p, 'sm'),
          h('span', { class: 'team-who', 'data-pcard': p.id }, h('b', null, p.name), h('small', { class: 'muted' }, ACCESS_LABELS[p.access] || '')),
          h('span', { class: 'muted team-pos' }, (deptById(m.departmentId) || deptById(p.positionId) || {}).name || '—'),
          h('span', { class: 'team-load' }, t.length ? `${t.length} ${plural(t.length, ['задача', 'задачи', 'задач'])}` : h('span', { class: 'muted' }, 'нет задач'),
            late > 0 && h('span', { class: 'warn-text' }, ` · просрочено ${late}`)));
      }))
      : h('div', { class: 'card-box empty-state' }, h('p', { style: { margin: 0 } }, 'Команда не собрана'),
        isStaff() && h('button', { class: 'btn primary', onclick: async () => { if (await addMemberDialog(u.id)) draw(); } }, icon('plus', 15), 'Добавить участника')));
  };
  draw();
}

/** Ответственный за юнит (PM) и «Сменить» — только CEO. */
function owner(u, reload) {
  const pms = pmsOf(u.id);
  const pick = anchor => {
    const all = S.people.filter(p => p.active && p.access === 'moderator');
    menu(anchor, [
      { title: 'Ответственный за юнит' },
      ...all.map(p => ({
        label: p.name, icon: pms.some(x => x.id === p.id) ? 'check' : null,
        action: () => send('setUnitPm', { unitId: u.id, personId: p.id }).then(members => {
          u.members = members.map(m => m.personId);
          const lu = S.units.find(x => x.id === u.id);
          if (lu) lu.members = u.members;
          toast(`Ответственный — ${p.name}`);
          reload();
        }).catch(showErr),
      })),
      !all.length && h('p', { class: 'muted', style: { padding: '4px 10px', margin: 0 } }, 'Нет людей с ролью ' + ACCESS_LABELS.moderator),
    ]);
  };
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Ответственный'),
      isSuper() && h('button', { class: 'btn ghost sm', onclick: e => { e.stopPropagation(); pick(e.currentTarget); } }, 'Сменить')),
    h('div', { class: 'card-box owner-box' },
      pms.length
        ? pms.map(p => h('div', { class: 'owner-row' }, avatar(p, 'sm'), h('b', { 'data-pcard': p.id }, p.name), h('span', { class: 'muted' }, ACCESS_LABELS[p.access])))
        : h('p', { class: 'muted', style: { margin: 0 } }, 'Не назначен')));
}
