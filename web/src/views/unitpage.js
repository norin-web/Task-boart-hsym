/**
 * Вкладки юнита «Обзор» (#/u/:id/overview) и «Команда» (#/u/:id/team). Шапка с крошками и вкладками — unitnav.js.
 * Обзор: описание, цифры, что в работе и что требует внимания, ответственный и команда коротко.
 * Команда: люди юнита — роль, позиция, открытые задачи в юните; добавить участника — руководителям.
 */
import { S, isSuper, isStaff, todayStr, ACCESS_LABELS, personById, deptById, taskDone, plural } from '../state.js';
import { $, h, icon, avatar, showErr, fill, menu, toast } from '../ui.js';
import { call, send } from '../api.js';
import { currentView, link } from '../router.js';
import { openCreateApp, openNewAppTask, pmsOf } from './apps.js';
import { attention, inProgress } from './ceo.js';
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
    const ud = { ...d, attention: d.attention.filter(mine), inProgress: d.inProgress.filter(mine) };
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
        stat(late, 'просрочено', 'list', late ? 'danger' : ''),
        stat(S.board.members.length, 'в команде', 'team')),
      h('div', { class: 'home-grid' },
        h('div', { class: 'home-col' }, inProgress(ud, load), attention(ud, load)),
        h('div', { class: 'home-col' }, owner(u, load), teamBrief(u))));
  }

  load();
}

/** Команда коротко на обзоре: аватары и переход на вкладку «Команда». */
function teamBrief(u) {
  const list = S.board.members.map(m => personById(m.personId)).filter(Boolean);
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Команда', list.length > 0 && h('span', { class: 'muted sec-n' }, list.length)),
      link({ unit: u.id, mode: 'team' }, { class: 'btn ghost sm' }, 'Вся команда')),
    h('div', { class: 'card-box owner-box' },
      list.length
        ? h('div', { class: 'team-brief' }, list.slice(0, 12).map(p => h('span', { title: p.name }, avatar(p, 'sm'))), list.length > 12 && h('span', { class: 'muted' }, '+' + (list.length - 12)))
        : h('p', { class: 'muted', style: { margin: 0 } }, 'Команда не собрана')));
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
          h('span', { class: 'team-who' }, h('b', null, p.name), h('small', { class: 'muted' }, ACCESS_LABELS[p.access] || '')),
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
        ? pms.map(p => h('div', { class: 'owner-row' }, avatar(p, 'sm'), h('b', null, p.name), h('span', { class: 'muted' }, ACCESS_LABELS[p.access])))
        : h('p', { class: 'muted', style: { margin: 0 } }, 'Не назначен')));
}
