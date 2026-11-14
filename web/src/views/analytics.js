/**
 * Аналитика (#/analytics, CEO и PM): вся статистика в одном месте — цифры, приложения по статусам, юниты × статусы,
 * загрузка PM, давно не трогали, выпущено за 30 дней, команда и KPI за период, загрузка команды. Сверху — юнит (для блоков по приложениям) и период KPI.
 * Раскладка блоков — своя у каждого (prefs.analytics). Графики — свои (prefs.charts): что в них, настраивается в «Настройки → Графики».
 */
import { S, LS, isSuper, todayStr, me } from '../state.js';
import { $, h, icon, topbar, showErr, fill, skeleton } from '../ui.js';
import { call, send, swr } from '../api.js';
import { currentView, navigate } from '../router.js';
import { statBlocks, tileTable } from './ceo.js';
import { team, PERIODS } from './pm.js';
import { workloadBlock } from './home.js';
import { renderLayout, editLayout } from './layout.js';
import { renderChart, chartLegend } from './charts.js';
import { chartsOf, PERIODS as CHART_PERIODS, cleanChart } from '../chartdefs.js';
import { editChart } from './chartsettings.js';

/** Открыть график (или новый) в «Настройки → Графики». */
const toChartSettings = id => { editChart(id); navigate({ view: 'settings', tab: 'charts' }); };

/** Карточка своего графика: название, легенда, период (если по времени) и кнопка в настройки; данные — по запросу. */
function chartCard(c, unit, onDays) {
  const legend = h('span', { class: 'chart-legend-slot' });
  const body = h('div', { class: 'chart-skel' });
  const timed = !(c.metric === 'apps' && c.step === 'total');
  const days = timed && h('label', { class: 'an-days' }, h('select', { 'aria-label': 'Период', onchange: e => onDays(Number(e.target.value)) },
    CHART_PERIODS.map(([v, t]) => h('option', { value: v, selected: v === c.days }, t))), icon('chevron', 14));
  const card = h('section', { class: 'an-chart' },
    h('div', { class: 'section-head' }, h('h2', null, c.title), legend, days,
      h('button', { class: 'icon-btn sm an-gear', type: 'button', title: 'Настроить график', 'aria-label': 'Настроить график «' + c.title + '»', onclick: () => toChartSettings(c.id) }, icon('sliders', 14))),
    h('div', { class: 'card-box' }, body));
  call('getChartData', { chart: c, today: todayStr(), unitId: unit }).then(data => {
    fill(body, renderChart(data, c));
    body.className = '';
    fill(legend, chartLegend(data, c));
  }).catch(showErr);
  return card;
}

const TILE_TITLES = { apps: 'Приложения', work: 'Задачи в работе', late: 'Просрочено', shipped: 'Выпущено', stale: 'Давно не трогали' };

export async function renderAnalytics(tile) {
  const page = h('div', { class: 'page ceo-page analytics-page' }, skeleton());
  const tools = h('div', { class: 'row an-tools', style: { gap: '8px' } });
  fill($('#main'), topbar([h('h1', null, TILE_TITLES[tile] || 'Аналитика')], [tools]), h('div', { class: 'view-body' }, page));
  let unit = LS.get('anUnit', '');
  let period = PERIODS.some(([k]) => k === LS.get('kpiPeriod', '')) ? LS.get('kpiPeriod', '') : 'month';
  let d, apps, kpi, ov;

  async function load() {
    // повторный заход — сразу из памяти, свежее — в фоне
    try {
      // приложения — из дашборда CEO (он их уже загружает); «Загрузка команды» (getOverview) — только если блок включён
      await swr('analytics:' + period, () => Promise.all([call('getCeoDashboard', { today: todayStr() }), call('getPmDashboard', { today: todayStr(), period })]),
        r => { [d, kpi] = r; apps = d.apps || []; show(); }, { still: () => currentView() === 'analytics:' + (tile || '') });
    } catch (e) { showErr(e); }
  }
  let ovLoading = false;
  function loadOverview() {
    if (ovLoading) return;
    ovLoading = true;
    call('getOverview', { today: todayStr() }).then(r => { ov = r; if (currentView() === 'analytics:' + (tile || '')) draw(); }).catch(showErr).finally(() => { ovLoading = false; });
  }
  function show() {
    S.apps = apps.map(({ requests, active, ...a }) => a);
    if (unit && !S.units.some(u => u.id === unit && !u.archived)) unit = '';
    draw();
  }

  const blocks = () => {
    const list = unit ? apps.filter(a => a.unitId === unit) : apps;
    const defs = statBlocks(d, list, load, tile).filter(b => isSuper() || b.id !== 'pmload');
    const byId = Object.fromEntries(defs.map(b => [b.id, b]));
    // свои графики по порядку из настроек; скрытые не рисуем; новый график добавляется в Настройки → Графики
    const charts = () => {
      const list = chartsOf((me() || {}).prefs);
      const setDays = (c, v) => {
        const next = list.map(x => (x.id === c.id ? cleanChart({ ...x, days: v }) : x));
        const p = me(); if (p) p.prefs = { ...(p.prefs || {}), charts: next };
        send('setMyPrefs', { personId: S.meId, prefs: { charts: next } }).catch(showErr);
        draw();
      };
      return h('div', { class: 'an-grid' }, list.filter(c => !c.off).map(c => chartCard(c, unit, v => setDays(c, v))));
    };
    const shipped = byId.shipped;
    // как в макете: два графика рядом, ниже — «Команда и KPI» и «Выпущено за 30 дней»
    const rest = defs.filter(b => !['statuses', 'byunit', 'shipped'].includes(b.id));
    const out = [];
    for (const b of rest) {
      out.push(b);
      if (b.id === 'kpi') out.push({ id: 'charts', title: 'Графики', col: 'full', render: charts });
    }
    for (const b of out) if (['pmload', 'stale'].includes(b.id)) b.off = true;
    defs.length = 0; defs.push(...out);
    defs.push({ id: 'kpi-ship', title: 'Команда и «Выпущено»', col: 'full', render: () => h('div', { class: 'an-grid an-grid-32' },
      team(kpi, period, p => { period = p; LS.set('kpiPeriod', p); load(); }), shipped ? shipped.render() : null) });
    defs.push({ id: 'workload', title: 'Загрузка команды', col: 'full', off: true, render: () => (ov ? workloadBlock(ov, { all: true }) : (loadOverview(), skeleton())) });
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
      h('button', { class: 'btn', title: 'Какие блоки показывать и где', onclick: () => editLayout('analytics', blocks(), page, draw, { title: 'Настройка аналитики' }) }, icon('layers', 14), 'Настроить'));
    fill(page, renderLayout('analytics', blocks()));
  }

  load();
}
