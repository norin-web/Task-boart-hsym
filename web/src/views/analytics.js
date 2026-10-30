/**
 * Аналитика (#/analytics, CEO и PM): вся статистика в одном месте — цифры, приложения по статусам, юниты × статусы,
 * загрузка PM, давно не трогали, выпущено за 30 дней, команда и KPI за период. Сверху — юнит (для блоков по приложениям) и период KPI.
 * Раскладка блоков — своя у каждого (prefs.analytics).
 */
import { S, LS, isSuper, todayStr } from '../state.js';
import { $, h, icon, topbar, showErr, fill } from '../ui.js';
import { call } from '../api.js';
import { currentView } from '../router.js';
import { statBlocks } from './ceo.js';
import { team, PERIODS } from './pm.js';
import { renderLayout, editLayout } from './layout.js';

export async function renderAnalytics() {
  const page = h('div', { class: 'page ceo-page' }, h('div', { class: 'boot' }, h('span', { class: 'spinner' }), 'Загрузка…'));
  const tools = h('div', { class: 'row', style: { gap: '8px' } });
  fill($('#main'), topbar([h('h1', null, 'Аналитика')], [tools]), h('div', { class: 'view-body' }, page));
  let unit = LS.get('anUnit', '');
  let period = PERIODS.some(([k]) => k === LS.get('kpiPeriod', '')) ? LS.get('kpiPeriod', '') : 'month';
  let d, apps, kpi;

  async function load() {
    try {
      [d, apps, kpi] = await Promise.all([call('getCeoDashboard', { today: todayStr() }), call('listApps', {}), call('getPmDashboard', { today: todayStr(), period })]);
    } catch (e) { return showErr(e); }
    if (currentView() !== 'analytics') return;
    S.apps = apps.map(({ requests, active, ...a }) => a);
    if (unit && !S.units.some(u => u.id === unit && !u.archived)) unit = '';
    draw();
  }

  const blocks = () => {
    const list = unit ? apps.filter(a => a.unitId === unit) : apps;
    const defs = statBlocks(d, list, load).filter(b => isSuper() || b.id !== 'pmload');
    defs.push({ id: 'kpi-team', title: 'Команда и KPI', col: 'full',
      render: () => team(kpi, period, p => { period = p; LS.set('kpiPeriod', p); load(); }) });
    return defs;
  };

  function draw() {
    const units = S.units.filter(u => !u.archived).sort((a, b) => (a.order || 0) - (b.order || 0));
    fill(tools,
      units.length > 1 && h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Юнит' },
        [['', 'Все юниты'], ...units.map(u => [u.id, u.name])].map(([id, name]) => h('button', {
          class: unit === id ? 'on' : '', role: 'radio', 'aria-checked': String(unit === id), title: id ? 'Блоки по приложениям — только этот юнит' : '',
          onclick: () => { unit = id; LS.set('anUnit', id); draw(); },
        }, name))),
      h('button', { class: 'btn ghost sm', title: 'Какие блоки показывать и где', onclick: () => editLayout('analytics', blocks(), page, draw, { title: 'Настройка аналитики' }) }, icon('layers', 14), 'Настроить'));
    fill(page, renderLayout('analytics', blocks()));
  }

  load();
}
