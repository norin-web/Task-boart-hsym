/**
 * Навигация внутри юнита: шапка с хлебными крошками («Дашборд / ● Gold») и вкладки
 * Обзор · Приложения · Задачи · Команда (· Настройки у руководителей). «Задачи» — одна вкладка: список и доска переключаются
 * внутри экрана, вкладка открывает вид, выбранный последним. Каждая вкладка — свой адрес #/u/:id/<mode>,
 * поэтому «назад» браузера и крошки возвращают туда, откуда пришли.
 */
import { S, LS, me, isStaff, seesApps, ownTeamsOnly } from '../state.js';
import { h, icon, topbar, unitIcon } from '../ui.js';
import { link } from '../router.js';

/** Вкладки юнита: [mode, подпись, иконка, число]. Обзор и приложения — тем, кто видит приложения. */
function tabs(u) {
  const apps = (S.apps || []).filter(a => a.unitId === u.id && !a.archived).length;
  return [
    seesApps() && ['overview', 'Обзор', 'home'],
    seesApps() && ['apps', 'Приложения', 'app', apps],
    [LS.get('tasksMode', 'board') === 'list' ? 'list' : 'board', 'Задачи', 'list', 0, 'tasks'],
    !ownTeamsOnly() && (me() || {}).access !== 'rm' && ['team', 'Команда', 'users', S.board ? S.board.members.length : 0],
    isStaff() && ['settings', 'Настройки', 'settings'],
  ].filter(Boolean);
}

/** Шапка юнита + полоса вкладок; right — кнопки действий справа. Возвращает два узла для fill(#main, …). */
const TITLES = { overview: 'Обзор юнита', apps: 'Приложения юнита', list: 'Задачи юнита', board: 'Задачи юнита', team: 'Команда юнита', settings: 'Настройки юнита' };

export function unitHeader(active, right = [], team = null) {
  const u = S.board.unit;
  const sep = () => h('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, '/');
  return [
    topbar([
      // своя картинка юнита — слева от заголовка (без картинки заголовок как был)
      u.icon && unitIcon(u, 'lg'),
      h('div', { class: 'unit-head' },
        h('nav', { class: 'crumbs unit-crumbs', 'aria-label': 'Навигация' },
          link({ view: 'home' }, { class: 'crumb' }, (me() || {}).access === 'rm' ? 'Релизы' : 'Дашборд'),
          sep(),
          team ? link({ unit: u.id, mode: seesApps() ? 'overview' : 'board' }, { class: 'crumb' }, u.name) : h('span', { class: 'crumb' }, u.name),
          u.archived && h('span', { class: 'badge' }, 'в архиве')),
        h('h1', null, team ? team.name : TITLES[active] || u.name)),
    ], [...right, isStaff() && active !== 'settings' && link({ unit: u.id, mode: 'settings' }, { class: 'icon-btn', title: 'Настройки юнита', 'aria-label': 'Настройки юнита' }, icon('settings', 17))]),
    h('nav', { class: 'unit-tabs', role: 'tablist', 'aria-label': 'Разделы юнита' },
      tabs(u).map(([mode, label, ic, n, id]) => {
        const on = id === 'tasks' ? ['list', 'board'].includes(active) : active === mode;
        return link({ unit: u.id, mode }, { class: 'unit-tab' + (on ? ' on' : ''), role: 'tab', 'aria-selected': String(on) },
          label, n > 0 && h('span', { class: 'unit-tab-n' }, n));
      })),
  ];
}
