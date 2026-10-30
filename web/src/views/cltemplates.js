/**
 * Шаблоны чеклистов — у каждого свои (prefs.clTemplates: [{ id, name, items: [text] }]): лид — для раздачи задач,
 * RM — для релиза. Применяются при «Раздать» и кнопкой «Из шаблона» в чеклисте карточки.
 */
import { S, me } from '../state.js';
import { h, icon, modal, fill, toast, showErr } from '../ui.js';
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

/** Редактор шаблонов: название и пункты (по строке). */
export function openTemplatesEditor(onDone) {
  const list = clTemplates().map(t => ({ ...t, items: [...t.items] }));
  const box = h('div', { class: 'cl-tpl-list' });
  const draw = () => fill(box,
    list.length ? list.map((t, i) => h('div', { class: 'cl-tpl' },
      h('div', { class: 'row', style: { gap: '8px' } },
        h('input', { class: 'inp', value: t.name, maxlength: 60, placeholder: 'Название шаблона', oninput: e => { t.name = e.target.value; } }),
        h('button', { class: 'icon-btn sm', title: 'Удалить шаблон', onclick: () => { list.splice(i, 1); draw(); } }, icon('trash', 14))),
      h('textarea', { class: 'inp', rows: Math.max(3, t.items.length + 1), placeholder: 'Пункты — по одному в строке', oninput: e => { t.items = e.target.value.split('\n'); } }, t.items.join('\n'))))
      : h('p', { class: 'muted', style: { margin: 0 } }, 'Шаблонов пока нет.'),
    h('button', { class: 'btn sm', onclick: () => { list.push({ id: 'ct_' + Math.random().toString(36).slice(2, 9), name: '', items: [] }); draw(); const ins = box.querySelectorAll('input'); ins[ins.length - 1].focus(); } }, icon('plus', 13), 'Шаблон'));
  draw();
  modal({
    title: 'Шаблоны чеклистов',
    wide: true,
    body: [h('p', { class: 'hint', style: { margin: '0 0 10px' } }, 'Ваши шаблоны — применяйте при «Раздать» и в чеклисте карточки («Из шаблона»).'), box],
    actions: [{ label: 'Отмена' }, { label: 'Сохранить', primary: true, action: async close => {
      await save(list.map(t => ({ id: t.id, name: t.name.trim(), items: t.items.map(x => x.trim()).filter(Boolean).slice(0, 50) })).filter(t => t.name && t.items.length));
      close();
      toast('Шаблоны сохранены');
      if (onDone) onDone();
    } }],
  });
}
