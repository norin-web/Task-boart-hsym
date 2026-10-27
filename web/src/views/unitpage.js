/**
 * Страница юнита (#/u/:id/overview): приложения юнита, ответственный (PM), что в работе и что требует внимания.
 * Отсюда — новое приложение и задача в юнит, смена ответственного, доска и настройки юнита.
 */
import { S, isSuper, isStaff, todayStr, ACCESS_LABELS, ceoDefault } from '../state.js';
import { $, h, icon, avatar, topbar, showErr, fill, menu, toast } from '../ui.js';
import { call, send } from '../api.js';
import { currentView, navigate } from '../router.js';
import { setCeoMode } from './sidebar.js';
import { appHead, appTable, openCreateApp, openNewAppTask, pmsOf } from './apps.js';
import { attention, inProgress } from './ceo.js';

export async function renderUnitPage() {
  const u = S.board.unit;
  const key = 'overview:' + u.id;
  const page = h('div', { class: 'page unit-page' }, h('div', { class: 'boot' }, h('span', { class: 'spinner' }), 'Загрузка…'));
  const actions = h('div', { class: 'row', style: { gap: '8px' } });
  fill($('#main'),
    topbar([h('span', { class: 'uc-icon sm', style: { background: u.color } }, u.key.slice(0, 2)), h('h1', null, u.name)], [actions]),
    h('div', { class: 'view-body' }, page));

  // доска и настройки — режим Admin у CEO: переключаем и переходим
  const go = async mode => {
    if (ceoDefault()) await setCeoMode('admin');
    navigate({ unit: u.id, mode });
  };

  async function load() {
    let apps, d;
    try {
      [apps, d] = await Promise.all([call('listApps', { unitId: u.id }), call('getCeoDashboard', { today: todayStr() })]);
    } catch (e) { return showErr(e); }
    if (currentView() !== key) return;
    // приложения юнита — в общий список (их ищут формы «Новая задача»)
    S.apps = [...S.apps.filter(a => a.unitId !== u.id), ...apps.map(({ requests, active, ...a }) => a)];
    const mine = x => x.app && x.app.unitId === u.id;
    const ud = { ...d, attention: d.attention.filter(mine), inProgress: d.inProgress.filter(mine) };

    fill(actions,
      isStaff() && h('button', { class: 'btn', onclick: () => go('board') }, icon('board', 15), h('span', { class: 'btn-label' }, 'Доска')),
      isStaff() && h('button', { class: 'btn', onclick: () => go('settings') }, icon('settings', 15), h('span', { class: 'btn-label' }, 'Настройки')),
      isSuper() && h('button', {
        class: 'btn', disabled: !apps.length, title: apps.length ? '' : 'Сначала приложение — задача ставится по нему',
        onclick: () => openNewAppTask(load, u.id),
      }, icon('plus', 15), h('span', { class: 'btn-label' }, 'Новая задача')),
      isSuper() && h('button', { class: 'btn primary', onclick: () => openCreateApp(load, u.id) }, icon('plus', 15), h('span', { class: 'btn-label' }, 'Новое приложение')));

    fill(page,
      u.description && h('p', { class: 'muted unit-desc' }, u.description),
      h('div', { class: 'home-grid' },
        h('div', { class: 'home-col' },
          h('section', null,
            h('div', { class: 'section-head' }, h('h2', null, 'Приложения', apps.length > 0 && h('span', { class: 'muted sec-n' }, apps.length))),
            apps.length ? h('div', null, appHead(), appTable(apps, load)) : h('div', { class: 'card-box empty-state sm' }, h('p', { class: 'muted' }, 'Приложений пока нет'))),
          inProgress(ud, load)),
        h('div', { class: 'home-col' }, owner(u, load), attention(ud, load))));
  }

  load();
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
