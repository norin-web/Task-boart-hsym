/**
 * Настройки → Графики (F15, F16): свои графики аналитики — у каждого свои, видны только ему (prefs.charts).
 * Слева список в порядке аналитики: перетащить — порядок, глаз — скрыть. Справа редактор выбранного:
 * название, превью «Так будет на аналитике», что считать, разбить по, вид, шаг, период, что показывать.
 * Правки сохраняются сразу; новый график появляется в списке по «Добавить».
 */
import Sortable from 'sortablejs';
import { S, me, todayStr } from '../state.js';
import { h, icon, fill, showErr, confirmDlg } from '../ui.js';
import { call, send } from '../api.js';
import { METRICS, SPLITS, VIEWS, STEPS, PERIODS, SPLITS_OF, PRESETS, viewAllowed, chartMeta, cleanChart, chartsOf } from '../chartdefs.js';
import { renderChart, chartLegend, chartSeries } from './charts.js';

/** Что открыть в редакторе при входе: id графика или 'new' (кнопки на аналитике). */
export const editChart = id => { S.chartEdit = id; };

let saveTimer = 0;
function save(list) {
  const p = me();
  if (p) p.prefs = { ...(p.prefs || {}), charts: list };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => send('setMyPrefs', { personId: S.meId, prefs: { charts: list } }).catch(showErr), 300);
}

export function chartsSection() {
  let list = chartsOf((me() || {}).prefs);
  let sel = S.chartEdit === 'new' ? 'new' : list.some(c => c.id === S.chartEdit) ? S.chartEdit : (list[0] || {}).id || 'new';
  S.chartEdit = null;
  let draft = null; // новый график до «Добавить»: metric пустой — ещё не выбрано, что считать
  const newDraft = () => ({ ...cleanChart({ view: 'bars', step: 'week', days: 30 }), title: '', metric: '' });
  if (sel === 'new') draft = newDraft();

  const side = h('div', { class: 'ch-list' });
  const editor = h('div', { class: 'card-box ch-editor' });
  const root = h('div', { class: 'ch-page' }, side, editor);

  const commit = () => { list = list.map(cleanChart); save(list); };
  const current = () => (sel === 'new' ? draft : list.find(c => c.id === sel));

  function drawList() {
    const rows = h('div', { class: 'ch-rows' }, list.map(c => h('div', {
      class: 'ch-row' + (c.id === sel ? ' on' : '') + (c.off ? ' off' : ''), dataset: { id: c.id }, role: 'button', tabindex: '0',
      onclick: () => { sel = c.id; draft = null; drawList(); drawEditor(); },
      onkeydown: e => { if (e.key === 'Enter') e.currentTarget.click(); },
    },
    h('span', { class: 'ch-drag', 'aria-hidden': 'true' }, icon('grip', 14)),
    h('span', { class: 'ch-text' }, h('b', null, c.title), h('small', null, chartMeta(c))),
    h('button', { class: 'icon-btn sm', type: 'button', title: c.off ? 'Показать на аналитике' : 'Скрыть с аналитики', 'aria-pressed': String(!c.off),
      onclick: e => { e.stopPropagation(); c.off = !c.off; commit(); drawList(); } }, icon(c.off ? 'eyeOff' : 'eye', 16)))));
    fill(side,
      h('p', { class: 'ch-cap muted' }, 'Порядок как на аналитике · видны только вам'),
      rows,
      sel === 'new'
        ? h('div', { class: 'ch-row ch-new on' }, icon('plus', 14), h('b', null, 'Новый график · не сохранён'))
        : h('button', { class: 'ch-add', type: 'button', onclick: () => { sel = 'new'; draft = newDraft(); drawList(); drawEditor(); } }, icon('plus', 14), 'Новый график'));
    Sortable.create(rows, {
      animation: 150, handle: '.ch-drag', ghostClass: 'sortable-ghost', forceFallback: true, fallbackTolerance: 4,
      onEnd: () => { const order = [...rows.children].map(r => r.dataset.id); list.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)); commit(); },
    });
  }

  /** Чипы выбора: on — выбранный, off — нельзя для этой метрики. */
  const chips = (label, items, value, ok, pick) => h('div', { class: 'ch-field' }, h('label', null, label),
    h('div', { class: 'ch-chips', role: 'radiogroup', 'aria-label': label }, items.map(([id, name]) => h('button', {
      class: 'ch-chip' + (id === value ? ' on' : ''), type: 'button', role: 'radio', 'aria-checked': String(id === value), disabled: !ok(id),
      title: ok(id) ? '' : 'Для этого не считается', onclick: () => pick(id),
    }, name))));

  const VIEW_IC = {
    lines: '<path d="M2 20 L10 20 L14 12 L24 12 L28 6 L38 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    curves: '<path d="M2 20 C12 20 14 4 20 4 C26 4 28 20 38 20" fill="none" stroke="currentColor" stroke-width="2"/>',
    bars: '<g fill="currentColor"><rect x="4" y="12" width="7" height="12" rx="2"/><rect x="16" y="4" width="7" height="20" rx="2"/><rect x="28" y="9" width="7" height="15" rx="2"/></g>',
  };
  /** Значок вида: маленькая картинка линий, кривых или столбцов; «Число» — цифрой. */
  const vic = (id, cls = '', w = 40, hh = 24) => {
    if (id === 'number') return h('span', { class: 'ch-num ' + cls }, '12');
    const el = h('span', { class: 'ch-vic ' + cls });
    el.innerHTML = `<svg viewBox="0 0 40 24" width="${w}" height="${hh}" aria-hidden="true">${VIEW_IC[id]}</svg>`;
    return el;
  };
  const viewTile = ([id, name], c, pick) => {
    const ic = vic(id);
    return h('button', { class: 'ch-view' + (c.view === id ? ' on' : ''), type: 'button', role: 'radio', 'aria-checked': String(c.view === id),
      disabled: !viewAllowed(id, c.step), title: viewAllowed(id, c.step) ? '' : 'Линии — только по времени', onclick: () => pick(id) }, ic, name);
  };
  const select = (label, items, value, pick, disabled) => h('div', { class: 'ch-field' }, h('label', null, label),
    h('select', { class: 'inp', disabled: !!disabled, onchange: e => pick(e.target.value) }, items.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value) }, t))));

  let seq = 0;
  function drawEditor() {
    const c = current();
    if (!c) return fill(editor, h('div', { class: 'empty-state' }, h('h2', null, 'Графиков нет'), h('p', null, 'Добавьте первый — он появится на аналитике')));
    const isNew = sel === 'new';
    const set = patch => {
      Object.assign(c, patch);
      if (c.metric) Object.assign(c, cleanChart(c), { id: c.id, title: c.title });
      if (!isNew) { commit(); drawList(); }
      drawEditor();
    };
    const name = h('input', { class: 'inp ch-name', maxlength: 80, value: c.title, placeholder: 'Например, Релизы по месяцам', 'aria-label': 'Название',
      oninput: e => { c.title = e.target.value; if (!isNew) { commit(); const row = side.querySelector(`.ch-row[data-id="${c.id}"] b`); if (row) row.textContent = c.title || 'График'; } } });
    const preview = h('div', { class: 'ch-preview-body' });
    const legend = h('div', { class: 'ch-legend' });
    const seriesBox = h('div');

    const actions = isNew
      ? h('div', { class: 'row ch-actions' },
        h('button', { class: 'btn ghost danger-text', type: 'button', onclick: () => { sel = (list[0] || {}).id || 'new'; draft = sel === 'new' ? newDraft() : null; drawList(); drawEditor(); } }, 'Отмена'),
        h('button', { class: 'btn primary', type: 'button', disabled: !c.metric, onclick: () => {
          const made = cleanChart({ ...c, title: c.title.trim() || (METRICS.find(m => m[0] === c.metric) || [])[1] });
          list.push(made); commit(); sel = made.id; draft = null; drawList(); drawEditor();
        } }, 'Добавить'))
      : h('button', { class: 'btn ghost danger-text ch-del', type: 'button', onclick: async () => {
        if (!(await confirmDlg(`Удалить график «${c.title}»?`, { ok: 'Удалить', danger: true, title: 'Удалить график' }))) return;
        list = list.filter(x => x.id !== c.id); commit(); sel = (list[0] || {}).id || 'new'; draft = sel === 'new' ? newDraft() : null; drawList(); drawEditor();
      } }, icon('trash', 14), 'Удалить график');

    const m = c.metric;
    fill(editor,
      h('div', { class: 'ch-head' }, h('div', { class: 'ch-field ch-name-f' }, h('label', null, 'Название'), name), actions),
      h('div', { class: 'ch-preview' }, h('div', { class: 'ch-preview-top' }, h('span', { class: 'muted' }, 'Так будет на аналитике'), legend), preview),
      isNew && !m && h('div', { class: 'ch-presets' }, h('label', null, 'Готовые'),
        PRESETS.map(p => h('button', { class: 'ch-preset', type: 'button', onclick: () => set({ ...p, title: p.title }) },
          vic(p.icon, 'sm', 20, 14),
          h('b', null, p.title), h('small', { class: 'muted' }, p.hint)))),
      h('div', { class: 'ch-params' },
        h('div', { class: 'ch-col' },
          chips('Что считать', METRICS, m, () => true, id => set({ metric: id })),
          chips('Разбить по', SPLITS, m ? c.split : '', id => !!m && SPLITS_OF[m].includes(id), id => set({ split: id, hide: [] })),
          m && seriesBox),
        h('div', { class: 'ch-col' },
          h('div', { class: 'ch-field' }, h('label', null, 'Вид'), h('div', { class: 'ch-views', role: 'radiogroup', 'aria-label': 'Вид' }, VIEWS.map(v => viewTile(v, c, id => set({ view: id }))))),
          h('div', { class: 'ch-two' },
            select('Шаг', STEPS, c.step, v => set({ step: v })),
            select('Период', PERIODS, c.days, v => set({ days: Number(v) }), m === 'apps' && c.step === 'total')))));

    if (!m) {
      fill(preview, h('div', { class: 'ch-empty' }, vic('bars', 'lg', 40, 28), h('b', null, 'Выберите, что считать'),
        h('span', { class: 'muted' }, 'Или начните с готового — ниже. Превью меняется сразу, как вы что-то выбираете')));
      return;
    }
    const my = ++seq;
    fill(preview, h('div', { class: 'chart-skel' }));
    call('getChartData', { chart: c, today: todayStr() }).then(data => {
      if (my !== seq) return;
      fill(preview, renderChart(data, c, { height: 216 }));
      fill(legend, chartLegend(data, c));
      // что показывать: ряды этого графика галочками (одиночный ряд — нечего выбирать)
      if (data.series.length > 1) fill(seriesBox, h('div', { class: 'ch-field' }, h('label', null, 'Что показывать'),
        h('div', { class: 'ch-chips' }, data.series.map((s, i) => {
          const on = !c.hide.includes(s.id);
          const color = (chartSeries({ series: data.series }, { ...c, hide: [] })[i] || {}).color;
          return h('label', { class: 'ch-check' }, h('input', { type: 'checkbox', checked: on, onchange: e => set({ hide: e.target.checked ? c.hide.filter(x => x !== s.id) : [...c.hide, s.id] }) }),
            h('i', { style: { background: color } }), s.name);
        }))));
    }).catch(showErr);
  }

  drawList();
  drawEditor();
  return root;
}
