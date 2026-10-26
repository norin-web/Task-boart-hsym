/**
 * Флоу юнита (настройки юнита, CEO и PM юнита): для каждого типа запроса CEO (New App / Апдейт / Задача) — этапы
 * по порядку, позиция, после каких этапов (зависимости), какой этап — релиз. По нему PM раскладывает запросы.
 */
import Sortable from 'sortablejs';
import { REQUEST_TYPES, activeDepts } from '../state.js';
import { h, icon, fill, menu, toast, showErr, confirmDlg } from '../ui.js';
import { call, send } from '../api.js';

export function flowSection(unit) {
  const box = h('section', { class: 'card-box' });
  let type = 'new_app';
  let flows = null;
  let steps = [];
  let dirty = false;
  const list = h('div', { class: 'col-edit-list' });
  let sortable = null;

  const load = async () => {
    try { flows = await call('getFlows', { unitId: unit.id }); } catch (e) { return showErr(e); }
    pick(type);
  };
  const pick = t => {
    type = t;
    steps = (flows[t] || []).map(x => ({ ...x, dependsOn: [...x.dependsOn] }));
    dirty = false;
    draw();
  };
  const touch = () => { dirty = true; drawHead(); };
  const head = h('div');
  const drawHead = () => fill(head,
    h('div', { class: 'section-head', style: { marginBottom: '4px' } }, h('h2', null, 'Флоу задач CEO'),
      h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Тип задачи' }, Object.entries(REQUEST_TYPES).map(([k, label]) => h('button', {
        class: type === k ? 'on' : '', role: 'tab', 'aria-selected': String(type === k),
        onclick: async () => { if (k !== type && (!dirty || await confirmDlg('Изменения флоу не сохранены — переключить без сохранения?', { ok: 'Переключить' }))) pick(k); },
      }, label)))),
    h('p', { class: 'hint' }, 'Этапы, на которые PM раскладывает задачу CEO этого типа: позиция, после каких этапов начинается (до этого заблокирован), какой — релиз (уходит RM). Порядок — перетаскиванием. Конкретную разбивку PM ещё поправит в окне «Разложить».'));
  const titleOf = k => (steps.find(s => s.key === k) || {}).title || k;
  const draw = () => {
    drawHead();
    fill(list, steps.length ? steps.map((st, i) => h('div', { class: 'col-edit-row fl-row', dataset: { i } },
      h('span', { class: 'drag', title: 'Перетащите, чтобы изменить порядок' }, icon('grip', 16)),
      h('input', { class: 'inp', value: st.title, maxlength: 120, placeholder: 'Название этапа', 'aria-label': 'Название этапа', oninput: e => { st.title = e.target.value; touch(); } }),
      h('select', { class: 'inp', 'aria-label': 'Позиция', onchange: e => { st.positionId = e.target.value; touch(); } },
        activeDepts().map(d => h('option', { value: d.id, selected: d.id === st.positionId }, d.name))),
      h('button', {
        class: 'btn sm fl-deps', title: 'После каких этапов начинается', disabled: i === 0,
        onclick: e => { e.stopPropagation(); depsMenu(e.currentTarget, st, i); },
      }, st.dependsOn.length ? 'после: ' + st.dependsOn.map(titleOf).join(', ') : 'сразу'),
      h('label', { class: 'chk fl-rel', title: 'Релиз: исполнителя нет, пока PM не передаст RM' },
        h('input', { type: 'radio', name: 'fl-release', checked: !!st.release, onchange: () => { steps.forEach(x => { x.release = x === st; }); touch(); draw(); } }), 'релиз'),
      h('button', { class: 'icon-btn sm', title: 'Удалить этап', onclick: () => { steps.splice(i, 1); steps.forEach(x => { x.dependsOn = x.dependsOn.filter(k => k !== st.key); }); touch(); draw(); } }, icon('x', 14)),
    )) : h('p', { class: 'muted' }, 'Этапов нет — PM будет ставить задачи под этот тип вручную.'));
    if (sortable) sortable.destroy();
    sortable = Sortable.create(list, {
      handle: '.drag', animation: 150, ghostClass: 'sortable-ghost', forceFallback: true, fallbackTolerance: 4,
      onEnd: () => {
        steps = [...list.children].map(r => steps[Number(r.dataset.i)]);
        // зависимости — только на этапы выше
        steps.forEach((x, i) => { x.dependsOn = x.dependsOn.filter(k => steps.slice(0, i).some(y => y.key === k)); });
        touch();
        draw();
      },
    });
  };
  const depsMenu = (anchor, st, i) => {
    const box2 = h('div');
    const drawItems = () => fill(box2, steps.slice(0, i).map(x => {
      const on = st.dependsOn.includes(x.key);
      return h('button', {
        class: 'menu-item aud-item pos-item' + (on ? ' on' : ''), role: 'menuitemcheckbox', 'aria-checked': String(on),
        onclick: () => { st.dependsOn = on ? st.dependsOn.filter(k => k !== x.key) : [...st.dependsOn, x.key]; touch(); drawItems(); draw(); },
      }, h('span', { class: 'aud-check' }, on && icon('check', 13)), x.title);
    }));
    drawItems();
    menu(anchor, [{ title: 'Начинается после' }, box2]);
  };
  const add = () => {
    const ri = steps.findIndex(s => s.release);
    const st = { key: 's' + Date.now().toString(36), title: '', positionId: (activeDepts()[0] || {}).id || '', dependsOn: [], release: false };
    if (ri >= 0) { steps.splice(ri, 0, st); steps[ri + 1].dependsOn.push(st.key); } else steps.push(st);
    touch();
    draw();
    const ins = list.querySelectorAll('.fl-row .inp:first-of-type');
    if (ins[ri >= 0 ? ri : ins.length - 1]) ins[ri >= 0 ? ri : ins.length - 1].focus();
  };
  const save = async btn => {
    btn.disabled = true;
    try {
      flows = await send('saveFlow', { unitId: unit.id, type, steps: steps.map(s => ({ ...s, title: s.title.trim() || 'Этап' })) });
      unit.settings.flows = { ...(unit.settings.flows || {}), [type]: flows[type] };
      pick(type);
      toast(`Флоу «${REQUEST_TYPES[type]}» сохранён`);
    } catch (e) { showErr(e); }
    btn.disabled = false;
  };
  const resetToDefault = async () => {
    try { steps = ((await call('getFlows', {}))[type] || []).map(x => ({ ...x, dependsOn: [...x.dependsOn] })); touch(); draw(); } catch (e) { showErr(e); }
  };
  fill(box, head, list,
    h('div', { class: 'row', style: { gap: '8px', marginTop: '8px' } },
      h('button', { class: 'btn sm', onclick: add }, icon('plus', 13), 'Этап'),
      h('button', { class: 'btn ghost sm', title: 'Подставить флоу студии по умолчанию (сохранится после «Сохранить флоу»)', onclick: resetToDefault }, icon('refresh', 13), 'Как по умолчанию'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary sm', onclick: e => save(e.currentTarget) }, 'Сохранить флоу')));
  load();
  return box;
}

