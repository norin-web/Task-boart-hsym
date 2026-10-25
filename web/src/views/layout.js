/** Настраиваемая раскладка страницы: порядок блоков, видимость и колонка. Хранится в people.prefs у каждого своя. */
import { S, me } from '../state.js';
import { h, icon, modal, fill, showErr } from '../ui.js';
import { call } from '../api.js';

const COLS = [['left', 'Слева'], ['right', 'Справа'], ['full', 'Во всю ширину']];

/** Сохранённая раскладка, дополненная блоками по умолчанию (новые блоки появляются в конце). */
function current(key, defs) {
  const saved = ((me() || {}).prefs || {})[key] || {};
  const known = new Set(defs.map(d => d.id));
  const order = (saved.order || []).filter(id => known.has(id));
  defs.forEach(d => { if (!order.includes(d.id)) order.push(d.id); });
  return {
    order,
    hidden: (saved.hidden || []).filter(id => known.has(id)),
    cols: Object.fromEntries(defs.map(d => [d.id, (saved.cols || {})[d.id] || d.col])),
  };
}

let saveTimer = null;
function save(key, layout) {
  const person = me();
  if (!person) return;
  person.prefs = { ...(person.prefs || {}), [key]: layout };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => call('setMyPrefs', { personId: S.meId, prefs: { [key]: layout } }).catch(showErr), 400);
}

/**
 * Блоки по раскладке. defs: [{ id, title, col: 'left'|'right'|'full', render: () => Node }].
 * Подряд идущие блоки «слева/справа» собираются в двухколоночную сетку; «во всю ширину» её разрывает.
 */
export function renderLayout(key, defs) {
  const L = current(key, defs);
  const byId = Object.fromEntries(defs.map(d => [d.id, d]));
  const out = [];
  let left = [], right = [];
  const flush = () => {
    if (!left.length && !right.length) return;
    out.push(h('div', { class: 'home-grid' + (!left.length || !right.length ? ' one' : '') },
      left.length > 0 && h('div', { class: 'home-col' }, left),
      right.length > 0 && h('div', { class: 'home-col' }, right)));
    left = []; right = [];
  };
  for (const id of L.order) {
    if (L.hidden.includes(id)) continue;
    const node = byId[id].render();
    if (!node) continue;
    const col = L.cols[id];
    if (col === 'full') { flush(); out.push(node); } else (col === 'right' ? right : left).push(node);
  }
  flush();
  return out;
}

/** Окно «Настроить главную»: показать/скрыть, порядок стрелками, колонка. Изменения применяются сразу. */
export function openLayoutEditor(key, defs, onChange) {
  let L = current(key, defs);
  const list = h('div', { class: 'layout-list' });
  const byId = Object.fromEntries(defs.map(d => [d.id, d]));
  const apply = () => { save(key, L); draw(); onChange(); };
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= L.order.length) return;
    [L.order[i], L.order[j]] = [L.order[j], L.order[i]];
    apply();
  };
  const draw = () => fill(list, L.order.map((id, i) => {
    const shown = !L.hidden.includes(id);
    return h('div', { class: 'layout-row' + (shown ? '' : ' off') },
      h('label', { class: 'chk' }, h('input', {
        type: 'checkbox', checked: shown,
        onchange: e => { L.hidden = e.target.checked ? L.hidden.filter(x => x !== id) : [...L.hidden, id]; apply(); },
      }), byId[id].title),
      h('select', { class: 'inp sm', value: L.cols[id], disabled: !shown, onchange: e => { L.cols[id] = e.target.value; apply(); } },
        COLS.map(([v, t]) => h('option', { value: v }, t))),
      h('button', { class: 'icon-btn sm', title: 'Выше', disabled: i === 0, onclick: () => move(i, -1) }, h('span', { class: 'rot-up' }, icon('chevron', 14))),
      h('button', { class: 'icon-btn sm', title: 'Ниже', disabled: i === L.order.length - 1, onclick: () => move(i, 1) }, icon('chevron', 14)));
  }));
  draw();
  modal({
    title: 'Настроить главную',
    body: [h('p', { class: 'hint', style: { marginTop: 0 } }, 'Только для вас. Изменения видны сразу.'), list],
    footLeft: h('button', {
      class: 'link-btn', onclick: () => { L = current('__none', defs); save(key, null); draw(); onChange(); },
    }, 'Как было по умолчанию'),
    actions: [{ label: 'Готово', primary: true }],
  });
}
