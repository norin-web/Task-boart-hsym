/**
 * Шаблоны чеклистов — у каждого свои (prefs.clTemplates: [{ id, name, items: [text] }]): лид — для раздачи задач,
 * RM — для релиза. Применяются при «Раздать» и кнопкой «Из шаблона» в чеклисте карточки.
 */
import Sortable from 'sortablejs';
import { S, me, plural } from '../state.js';
import { h, icon, modal, fill, field, toast, showErr } from '../ui.js';
import { send } from '../api.js';

export const clTemplates = () => (((me() || {}).prefs || {}).clTemplates || []);
function save(list) {
  const p = me();
  if (p) p.prefs = { ...(p.prefs || {}), clTemplates: list };
  return send('setMyPrefs', { personId: S.meId, prefs: { clTemplates: list } }).catch(showErr);
}

/** Выбор шаблона: select с «Без чеклиста» и пунктом «Шаблоны…» (редактор). onPick(items | null). */
export function templateSelect(onPick, { empty = 'Без чеклиста' } = {}) {
  const sel = h('select', { class: 'inp cl-tpl-sel', 'aria-label': 'Шаблон чеклиста' });
  const paint = () => fill(sel, h('option', { value: '' }, empty),
    clTemplates().map(t => h('option', { value: t.id }, `${t.name} · ${t.items.length}`)),
    h('option', { value: '__edit' }, 'Шаблоны чеклистов…'));
  paint();
  sel.addEventListener('change', () => {
    if (sel.value === '__edit') { sel.value = ''; openTemplatesEditor(() => paint()); return; }
    const t = clTemplates().find(x => x.id === sel.value);
    onPick(t ? t.items : null);
  });
  sel.items = () => { const t = clTemplates().find(x => x.id === sel.value); return t ? t.items : []; };
  return sel;
}

const MAX_ITEMS = 50;

/** Редактор шаблонов (D06): слева список, справа название и пункты выбранного. */
export function openTemplatesEditor(onDone) {
  const list = clTemplates().map(t => ({ ...t, items: [...t.items] }));
  let cur = list[0] || null;
  const side = h('div', { class: 'ct-side' });
  const main = h('div', { class: 'ct-main' });
  const drawSide = () => fill(side,
    list.map(t => h('button', { class: 'ct-tab' + (t === cur ? ' on' : ''), onclick: () => { cur = t; draw(); } },
      h('b', null, t.name || 'Без названия'), h('span', { class: 'muted' }, `${t.items.length} ${plural(t.items.length, ['пункт', 'пункта', 'пунктов'])}`))),
    h('button', { class: 'ct-add', onclick: () => { cur = { id: 'ct_' + Math.random().toString(36).slice(2, 9), name: '', items: [] }; list.push(cur); draw(); main.querySelector('.ct-name').focus(); } }, icon('plus', 16), 'Шаблон'));
  const drawMain = () => {
    if (!cur) return fill(main, h('p', { class: 'muted ct-none' }, 'Шаблонов пока нет.'));
    const t = cur;
    const add = h('input', {
      class: 'ct-new', maxlength: 300, placeholder: 'Новый пункт', disabled: t.items.length >= MAX_ITEMS,
      onkeydown: e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        e.stopPropagation(); // здесь Enter добавляет пункт, а не сохраняет окно
        if (!add.value.trim()) return;
        t.items.push(add.value.trim());
        draw();
        main.querySelector('.ct-new').focus();
      },
    });
    const rows = h('div', { class: 'ct-items' }, t.items.map((text, i) => h('div', { class: 'ct-item' },
      h('span', { class: 'ct-drag', 'aria-hidden': 'true' }, icon('grip', 14)),
      h('span', { class: 'ct-box', 'aria-hidden': 'true' }),
      h('input', { class: 'ct-text', value: text, maxlength: 300, 'aria-label': 'Пункт', oninput: e => { t.items[i] = e.target.value; } }),
      h('button', { class: 'icon-btn sm', title: 'Убрать пункт', onclick: () => { t.items.splice(i, 1); draw(); } }, icon('x', 14)))));
    fill(main,
      field('Название', h('input', { class: 'inp ct-name', value: t.name, maxlength: 60, oninput: e => { t.name = e.target.value; drawSide(); } })),
      h('div', { class: 'ct-group' },
        h('div', { class: 'ct-head' }, h('span', null, 'Пункты'), h('span', null, `${t.items.length} из ${MAX_ITEMS}`)),
        h('div', { class: 'ct-box-list' }, rows,
          h('label', { class: 'ct-add-row' }, icon('plus', 16), add, h('span', { class: 'muted' }, 'Enter — ещё пункт')))),
      h('button', { class: 'ct-del', onclick: () => { list.splice(list.indexOf(t), 1); cur = list[0] || null; draw(); } }, icon('trash', 14), 'Удалить шаблон'));
    Sortable.create(rows, { handle: '.ct-drag', animation: 120, onEnd: e => { const [x] = t.items.splice(e.oldIndex, 1); t.items.splice(e.newIndex, 0, x); draw(); } });
  };
  const draw = () => { drawSide(); drawMain(); };
  draw();
  modal({
    title: 'Шаблоны чеклистов',
    wide: true,
    body: [h('p', { class: 'hint', style: { margin: '0 0 4px' } }, 'Ваши шаблоны: применяйте при «Раздать» и в чеклисте карточки — «Из шаблона».'), h('div', { class: 'ct-wrap' }, side, main)],
    footLeft: h('span', { class: 'muted ct-foot' }, 'Пустые пункты и шаблоны без названия не сохранятся'),
    actions: [{ label: 'Отмена' }, { label: 'Сохранить', primary: true, action: async close => {
      await save(list.map(t => ({ id: t.id, name: t.name.trim(), items: t.items.map(x => x.trim()).filter(Boolean).slice(0, MAX_ITEMS) })).filter(t => t.name && t.items.length));
      close();
      toast('Шаблоны сохранены');
      if (onDone) onDone();
    } }],
  });
  side.closest('.modal')?.classList.add('ct-modal');
}
