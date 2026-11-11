/** Настраиваемая раскладка страницы: порядок блоков, видимость и колонка. Хранится в people.prefs у каждого своя. */
import { S, me } from '../state.js';
import Sortable from 'sortablejs';
import { h, icon, fill, showErr } from '../ui.js';
import { call } from '../api.js';

/** Сохранённая раскладка, дополненная блоками по умолчанию (новые блоки появляются в конце). */
function current(key, defs) {
  const saved = ((me() || {}).prefs || {})[key] || {};
  const known = new Set(defs.map(d => d.id));
  const order = (saved.order || []).filter(id => known.has(id));
  const hidden = (saved.hidden || []).filter(id => known.has(id));
  // Новые блоки — в конец; помеченные first (важные уведомления) — в начало; off — сразу в скрытые (включают в настройке)
  defs.forEach(d => {
    if (order.includes(d.id)) return;
    if (d.first) order.unshift(d.id); else order.push(d.id);
    if (d.off && !hidden.includes(d.id)) hidden.push(d.id);
  });
  return {
    order,
    hidden,
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

/**
 * Режим настройки прямо на странице: видны области «Сверху на всю ширину», «Левая», «Правая» и лоток скрытых.
 * Блоки перетаскиваются за шапку между областями; глаз — скрыть/показать. Каждое изменение сохраняется сразу.
 */
/**
 * opts: { title — подпись режима, extra — кнопки в шапке режима (например «+ Свой блок»),
 * onEdit(id) / onDelete(id) — для своих блоков (у def — custom: true) }.
 */
export function editLayout(key, defs, container, onDone, opts = {}) {
  let L = current(key, defs);
  const byId = Object.fromEntries(defs.map(d => [d.id, d]));
  const zones = {
    full: h('div', { class: 'lz-list', dataset: { zone: 'full' } }),
    left: h('div', { class: 'lz-list', dataset: { zone: 'left' } }),
    right: h('div', { class: 'lz-list', dataset: { zone: 'right' } }),
    hidden: h('div', { class: 'lz-list lz-tray', dataset: { zone: 'hidden' } }),
  };
  const sortables = [];

  // Раскладка из DOM: порядок — сверху, слева, справа, затем скрытые
  const collect = () => {
    const order = [], hidden = [], cols = { ...L.cols };
    for (const z of ['full', 'left', 'right', 'hidden']) {
      for (const el of zones[z].querySelectorAll(':scope > .lb')) {
        const id = el.dataset.id;
        order.push(id);
        if (z === 'hidden') hidden.push(id); else cols[id] = z;
      }
    }
    L = { order, hidden, cols };
    save(key, L);
    markEmpty();
  };
  const markEmpty = () => Object.values(zones).forEach(z => z.classList.toggle('empty', !z.querySelector('.lb')));

  const block = id => {
    const d = byId[id];
    const isHidden = () => el.parentElement === zones.hidden;
    const el = h('div', { class: 'lb', dataset: { id } },
      h('div', { class: 'lb-head' },
        h('span', { class: 'lb-grip' }, icon('grip', 14)),
        h('span', { class: 'lb-title' }, d.title),
        d.custom && h('span', { class: 'lb-tag' }, 'свой блок'),
        h('span', { class: 'spacer' }),
        d.custom && opts.onEdit && h('button', { class: 'icon-btn sm', title: 'Изменить блок', onclick: () => opts.onEdit(id) }, icon('edit', 13)),
        d.custom && opts.onDelete && h('button', { class: 'icon-btn sm', title: 'Удалить блок', onclick: () => opts.onDelete(id) }, icon('trash', 13)),
        h('button', {
          class: 'icon-btn sm', title: 'Скрыть / показать',
          onclick: () => {
            if (isHidden()) (L.cols[id] === 'full' ? zones.full : L.cols[id] === 'right' ? zones.right : zones.left).append(el);
            else zones.hidden.append(el);
            collect();
          },
        }, icon('eye', 14), icon('eyeOff', 14))),
      // макет 43: вместо живого содержимого — серые полоски (по числу колонок области)
      h('div', { class: 'lb-skel', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')));
    return el;
  };

  const fillZones = () => {
    Object.values(zones).forEach(z => fill(z));
    for (const id of L.order) (L.hidden.includes(id) ? zones.hidden : zones[L.cols[id]] || zones.left).append(block(id));
    markEmpty();
  };
  fillZones();

  const zone = (z, title, hint) => h('div', { class: 'lz lz-' + z }, h('div', { class: 'lz-label' }, title, hint && h('span', null, hint)), zones[z]);
  const done = () => { sortables.forEach(x => x.destroy()); onDone(); };
  container.classList.add('lz-mode');
  fill(container,
    h('header', { class: 'lz-head' },
      h('button', { class: 'icon-btn back-btn', title: 'Назад: ' + (opts.crumb || 'Дашборд'), 'aria-label': 'Назад: ' + (opts.crumb || 'Дашборд'), onclick: () => { container.classList.remove('lz-mode'); done(); } }, icon('back', 18)),
      h('div', { class: 'lz-titles' }, h('span', { class: 'lz-crumb muted' }, opts.crumb || 'Дашборд'), h('h1', null, opts.title || 'Настройка главной')),
      h('div', { class: 'lz-actions' },
        opts.extra,
        h('button', { class: 'btn ghost', onclick: () => { L = current('__none', defs); save(key, null); fillZones(); } }, 'По умолчанию'),
        h('button', { class: 'btn primary', onclick: () => { container.classList.remove('lz-mode'); done(); } }, 'Готово'))),
    h('p', { class: 'lz-desc muted' }, 'Тяните блоки за шапку между областями. Глаз — убрать в скрытые или вернуть. Сохраняется сразу и видно только вам.'),
    zone('full', 'Сверху, на всю ширину'),
    h('div', { class: 'lz-grid' }, zone('left', 'Левая колонка', 'широкая'), zone('right', 'Правая колонка', 'узкая')),
    h('div', { class: 'lz-note' }, icon('alert', 13), 'На узком экране и телефоне колонки встают друг под другом: сначала левая, потом правая.'),
    zone('hidden', 'Скрытые блоки', opts.hiddenHint || 'перетащите сюда, чтобы убрать с главной'));

  for (const z of Object.values(zones)) {
    sortables.push(Sortable.create(z, {
      group: 'layout', animation: 160, handle: '.lb-head', draggable: '.lb',
      ghostClass: 'lb-ghost', fallbackClass: 'lb-drag', forceFallback: true, fallbackTolerance: 4, scroll: true, bubbleScroll: true, scrollSensitivity: 80, scrollSpeed: 12,
      onEnd: collect,
    }));
  }
}
