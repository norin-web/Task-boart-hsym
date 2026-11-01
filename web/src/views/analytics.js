/**
 * Аналитика (#/analytics, CEO и PM): вся статистика в одном месте — цифры, приложения по статусам, юниты × статусы,
 * загрузка PM, давно не трогали, выпущено за 30 дней, команда и KPI за период, загрузка команды. Сверху — юнит (для блоков по приложениям) и период KPI.
 * Раскладка блоков — своя у каждого (prefs.analytics).
 */
import { S, LS, isSuper, todayStr } from '../state.js';
import { $, h, icon, topbar, showErr, fill, skeleton } from '../ui.js';
import { call } from '../api.js';
import { currentView } from '../router.js';
import { statBlocks, tileTable } from './ceo.js';
import { team, PERIODS } from './pm.js';
import { workloadBlock } from './home.js';
import { renderLayout, editLayout } from './layout.js';
import { statusLines, unitCurves } from './charts.js';

const TILE_TITLES = { apps: 'Приложения', work: 'Задачи в работе', late: 'Просрочено', shipped: 'Выпущено', stale: 'Давно не трогали' };

export async function renderAnalytics(tile) {
  const page = h('div', { class: 'page ceo-page analytics-page' }, skeleton());
  const tools = h('div', { class: 'row an-tools', style: { gap: '8px' } });
  fill($('#main'), topbar([h('h1', null, TILE_TITLES[tile] || 'Аналитика')], [tools]), h('div', { class: 'view-body' }, page));
  let unit = LS.get('anUnit', '');
  let period = PERIODS.some(([k]) => k === LS.get('kpiPeriod', '')) ? LS.get('kpiPeriod', '') : 'month';
  let d, apps, kpi, ov, ser;
  let days = Number(LS.get('anDays', 30)) || 30;

  async function load() {
    try {
      [d, apps, kpi, ov, ser] = await Promise.all([call('getCeoDashboard', { today: todayStr() }), call('listApps', {}), call('getPmDashboard', { today: todayStr(), period }), call('getOverview', { today: todayStr() }), call('getStatusSeries', { today: todayStr(), days, unitId: unit })]);
    } catch (e) { return showErr(e); }
    if (currentView() !== 'analytics:' + (tile || '')) return;
    S.apps = apps.map(({ requests, active, ...a }) => a);
    if (unit && !S.units.some(u => u.id === unit && !u.archived)) unit = '';
    draw();
  }

  const blocks = () => {
    const list = unit ? apps.filter(a => a.unitId === unit) : apps;
    const defs = statBlocks(d, list, load, tile).filter(b => isSuper() || b.id !== 'pmload');
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    const grays = ['#787c87', '#9aa0ad', '#b6bbc6', '#5d6270'];
    const cardOf = (title, control, body) => h('section', null,
      h('div', { class: 'section-head' }, h('h2', null, title), control), h('div', { class: 'card-box' }, body));
    const daysSel = h('select', { class: 'mini-select', 'aria-label': 'Период', onchange: e => { days = Number(e.target.value); LS.set('anDays', days); load(); } },
      [[7, '7 дней'], [30, '30 дней'], [90, '90 дней']].map(([v, t]) => h('option', { value: v, selected: v === days }, t)));
    const byId = Object.fromEntries(defs.map(b => [b.id, b]));
    const chartStatuses = () => cardOf('По статусам', daysSel,
      statusLines({ days: ser.days, aria: 'Приложения по статусам за период',
        series: ser.statuses.map((st, i) => ({ id: st.id, label: st.name, values: ser.counts[st.id], strong: st.kind === 'live', color: st.kind === 'live' ? accent : grays[i % grays.length] })) }));
    const curveUnits = S.units.filter(u => !u.archived && (!unit || u.id === unit));
    const chartUnits = () => cardOf('Юниты × статусы',
      h('div', { class: 'chart-legend' }, curveUnits.map(u => h('span', null, h('i', { style: { background: u.color } }), u.name))),
      unitCurves({ categories: S.appStatuses.map(st => st.name), aria: 'Приложения юнитов по статусам',
        units: curveUnits.map(u => ({ name: u.name, color: u.color, values: S.appStatuses.map(st => list.filter(a => a.unitId === u.id && a.status === st.id).length) })) }));
    const shipped = byId.shipped;
    // как в макете: два графика рядом, ниже — «Команда и KPI» и «Выпущено за 30 дней»
    const idx = defs.findIndex(b => b.id === 'statuses');
    const rest = defs.filter(b => !['statuses', 'byunit', 'shipped'].includes(b.id));
    const out = [];
    for (const b of rest) {
      out.push(b);
      if (b.id === 'kpi') out.push({ id: 'charts', title: 'Графики', col: 'full', render: () => h('div', { class: 'an-grid' }, chartStatuses(), chartUnits()) });
    }
    for (const b of out) if (['pmload', 'stale'].includes(b.id)) b.off = true;
    defs.length = 0; defs.push(...out);
    defs.push({ id: 'kpi-ship', title: 'Команда и «Выпущено»', col: 'full', render: () => h('div', { class: 'an-grid an-grid-32' },
      team(kpi, period, p => { period = p; LS.set('kpiPeriod', p); load(); }), shipped ? shipped.render() : null) });
    defs.push({ id: 'workload', title: 'Загрузка команды', col: 'full', off: true, render: () => workloadBlock(ov, { all: true }) });
    return defs;
  };

  function draw() {
    const units = S.units.filter(u => !u.archived).sort((a, b) => (a.order || 0) - (b.order || 0));
    if (tile) {
      const list = unit ? apps.filter(a => a.unitId === unit) : apps;
      fill(page, statBlocks(d, list, load, tile).find(b => b.id === 'kpi').render(), tileTable(tile, d, list, load));
      return;
    }
    fill(tools,
      units.length > 1 && h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Юнит' },
        [['', 'Все юниты'], ...units.map(u => [u.id, u.name, u.color])].map(([id, name, color]) => h('button', {
          class: unit === id ? 'on' : '', role: 'radio', 'aria-checked': String(unit === id), title: id ? 'Блоки по приложениям — только этот юнит' : '',
          onclick: () => { unit = id; LS.set('anUnit', id); draw(); },
        }, color && h('span', { class: 'dot', style: { background: color } }), name))),
      h('button', { class: 'btn ghost sm', title: 'Какие блоки показывать и где', onclick: () => editLayout('analytics', blocks(), page, draw, { title: 'Настройка аналитики' }) }, icon('layers', 14), 'Настроить'));
    fill(page, renderLayout('analytics', blocks()));
  }

  load();
}
