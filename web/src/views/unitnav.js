/**
 * Навигация внутри юнита: шапка с хлебными крошками («Дашборд / ● Gold») и вкладки
 * Обзор · Приложения · Задачи · Доска · Команда (· Настройки у руководителей). Каждая вкладка — свой адрес #/u/:id/<mode>,
 * поэтому «назад» браузера и крошки возвращают туда, откуда пришли.
 */
import { S, isStaff, seesApps, ceoDefault } from '../state.js';
import { h, icon, topbar } from '../ui.js';
import { link } from '../router.js';

/** Вкладки юнита: [mode, подпись, иконка, число]. Обзор и приложения — тем, кто видит приложения. */
function tabs(u) {
  const apps = (S.apps || []).filter(a => a.unitId === u.id && !a.archived).length;
  return [
    seesApps() && ['overview', 'Обзор', 'home'],
    seesApps() && ['apps', 'Приложения', 'app', apps],
    ['list', 'Задачи', 'list'],
    ['board', 'Доска', 'board'],
    ['team', 'Команда', 'users', S.board ? S.board.members.length : 0],
  ].filter(Boolean);
}

/** Шапка юнита + полоса вкладок; right — кнопки действий справа. Возвращает два узла для fill(#main, …). */
const TITLES = { overview: 'Обзор юнита', apps: 'Приложения юнита', list: 'Задачи юнита', board: 'Доска юнита', team: 'Команда юнита', settings: 'Настройки юнита' };

export function unitHeader(active, right = [], team = null) {
  const u = S.board.unit;
  const sep = () => h('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, '/');
  // настройки юнита — иконкой в шапке (как колокольчик), а не вкладкой среди разделов; доступно в режиме «Полный» у CEO
  const settingsBtn = isStaff() && !ceoDefault() && link({ unit: u.id, mode: 'settings' }, {
    class: 'icon-btn' + (active === 'settings' ? ' on' : ''), title: 'Настройки юнита', 'aria-label': 'Настройки юнита',
  }, icon('settings', 18));
  return [
    topbar([
      h('div', { class: 'unit-head' },
        h('nav', { class: 'crumbs unit-crumbs', 'aria-label': 'Навигация' },
          link({ view: 'home' }, { class: 'crumb' }, 'Дашборд'),
          sep(),
          team ? link({ unit: u.id, mode: seesApps() ? 'overview' : 'board' }, { class: 'crumb' }, u.name) : h('span', { class: 'crumb' }, u.name),
          u.archived && h('span', { class: 'badge' }, 'в архиве')),
        h('h1', null, team ? team.name : TITLES[active] || u.name)),
    ], [settingsBtn, ...right]),
    h('nav', { class: 'unit-tabs', role: 'tablist', 'aria-label': 'Разделы юнита' },
      tabs(u).map(([mode, label, ic, n]) => link({ unit: u.id, mode }, {
        class: 'unit-tab' + (active === mode ? ' on' : ''), role: 'tab', 'aria-selected': String(active === mode),
      }, label, n > 0 && h('span', { class: 'unit-tab-n' }, n)))),
  ];
}
