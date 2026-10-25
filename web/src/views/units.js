import { S, PALETTE, suggestKey, byOrder, unitById, descendantUnits } from '../state.js';
import { h, field, menu, modal, confirmDlg, promptDlg, toast, showErr, colorPicker } from '../ui.js';
import { send } from '../api.js';
import { navigate, rerender } from '../router.js';
import { renderSidebar } from './sidebar.js';

export function unitMenu(anchor, u) {
  menu(anchor, [
    { label: 'Открыть', icon: 'arrow', action: () => navigate({ unit: u.id, mode: 'board' }) },
    { label: 'Настройки', icon: 'settings', action: () => navigate({ unit: u.id, mode: 'settings' }) },
    { label: 'Переименовать', icon: 'edit', action: () => renameUnit(u) },
    { label: 'Дублировать (со схемой полей)', icon: 'copy', action: () => duplicateUnit(u) },
    { label: 'Входит в…', icon: 'tree', action: () => setTimeout(() => parentMenu(anchor, u), 0) },
    { label: 'Команды внутри…', icon: 'users', action: () => teamUnitsDialog(u) },
    { sep: true },
    ...(u.archived
      ? [{ label: 'Восстановить', icon: 'archive', action: () => archiveUnit(u, false) },
        { label: 'Удалить навсегда', icon: 'trash', danger: true, action: () => deleteUnit(u) }]
      : [{ label: 'Удалить', icon: 'trash', danger: true, action: () => archiveUnit(u, true) }]),
  ]);
}

/** Команды внутри юнита (Design, iOS… в MVP): по юниту на команду справочника, люди команды — в составе. */
export function teamUnitsDialog(u) {
  const have = new Set(S.units.filter(x => x.parentId === u.id && x.teamId).map(x => x.teamId));
  const teams = (S.teams || []).filter(t => !t.archived);
  // по умолчанию — производственные команды (Design, iOS, ASO, QA, Release), без Product и Other
  const core = ['t_design', 't_ios', 't_aso', 't_qa', 't_release'];
  const picked = new Set(teams.filter(t => !have.has(t.id) && (core.includes(t.id) || !teams.some(x => core.includes(x.id)))).map(t => t.id));
  const list = h('div', { class: 'team-pick' }, teams.map(t => h('label', { class: 'chk' + (have.has(t.id) ? ' muted' : '') },
    h('input', { type: 'checkbox', checked: have.has(t.id) || picked.has(t.id), disabled: have.has(t.id), onchange: e => { if (e.target.checked) picked.add(t.id); else picked.delete(t.id); } }),
    h('span', { class: 'dot', style: { background: t.color } }), t.name, have.has(t.id) && ' — уже есть')));
  modal({
    title: `Команды внутри «${u.name}»`,
    body: [h('p', { class: 'hint', style: { marginTop: 0 } }, 'У каждой команды будет своя доска внутри юнита, люди команды попадут в её состав. Наборы задач, разбитые в этот юнит, сами разложат задачи по командам. У юнита появится «Сводка» по всем командам.'), list],
    actions: [{ label: 'Отмена' }, {
      label: 'Создать', primary: true, action: async close => {
        if (!picked.size) return close();
        await send('setupTeamUnits', { unitId: u.id, teamIds: [...picked] });
        close();
        const d = await send('bootstrap', {});
        S.units = d.units;
        renderSidebar();
        toast(`Команды созданы внутри «${u.name}»`);
        navigate({ unit: u.id, mode: 'overview' });
      },
    }],
  });
}

/** Место юнита в дереве: под каким юнитом он стоит (себя и своих потомков выбрать нельзя). */
function parentMenu(anchor, u) {
  const blocked = new Set([u.id, ...descendantUnits(u.id).map(x => x.id)]);
  const set = parentId => send('updateUnit', { id: u.id, parentId }).then(saved => {
    Object.assign(u, saved);
    const lu = unitById(u.id); if (lu) Object.assign(lu, saved);
    rerender();
    renderSidebar();
    toast(parentId ? `«${u.name}» теперь внутри «${unitById(parentId).name}»` : `«${u.name}» — на верхнем уровне`);
  }).catch(showErr);
  menu(anchor, [
    { title: `«${u.name}» входит в` },
    { label: 'Верхний уровень', icon: u.parentId ? null : 'check', action: () => u.parentId && set('') },
    ...S.units.filter(x => !x.archived && !blocked.has(x.id)).sort(byOrder)
      .map(x => ({ label: x.name, icon: u.parentId === x.id ? 'check' : null, action: () => u.parentId !== x.id && set(x.id) })),
  ]);
}

async function renameUnit(u) {
  const name = await promptDlg('Переименовать юнит', 'Название', u.name);
  if (!name || name === u.name) return;
  send('updateUnit', { id: u.id, name }).then(saved => {
    Object.assign(u, saved);
    if (S.board && S.board.unit.id === u.id) Object.assign(S.board.unit, saved);
    rerender();
  }).catch(showErr);
}

function duplicateUnit(u) {
  send('duplicateUnit', { id: u.id }).then(nu => {
    S.units.push(nu);
    rerender();
    toast(`Создан «${nu.name}»`, { action: { label: 'Открыть', run: () => navigate({ unit: nu.id, mode: 'board' }) } });
  }).catch(showErr);
}

export function archiveUnit(u, archived) {
  send('updateUnit', { id: u.id, archived }).then(saved => {
    Object.assign(u, saved);
    if (S.board && S.board.unit.id === u.id) Object.assign(S.board.unit, saved);
    toast(archived ? `«${u.name}» в корзине — его можно восстановить в панели админа` : `«${u.name}» восстановлен`,
      archived ? { action: { label: 'Отменить', run: () => archiveUnit(u, false) } } : {});
    if (archived && S.route.unit === u.id) navigate({ view: 'home' }); else rerender();
  }).catch(showErr);
}

export async function deleteUnit(u) {
  const n = u.counts ? u.counts.todo + u.counts.in_progress + u.counts.done : 0;
  const ok = await confirmDlg(
    `Удалить юнит «${u.name}»${n ? ` и ${n} задач` : ''} вместе с полями, комментариями и историей? Восстановить будет нельзя.`,
    { ok: 'Удалить навсегда', danger: true, title: 'Удаление юнита' });
  if (!ok) return;
  send('deleteUnit', { id: u.id }).then(() => {
    S.units = S.units.filter(x => x.id !== u.id);
    toast('Юнит удалён');
    if (S.route.unit === u.id) navigate({ view: 'home' }); else rerender();
  }).catch(showErr);
}

export function openCreateUnit() {
  const name = h('input', { class: 'inp', placeholder: 'Например, Маркетинг', maxlength: 80 });
  const key = h('input', { class: 'inp mono', placeholder: 'MKT', maxlength: 10 });
  const keyHint = h('span', null, 'KEY-1');
  let keyTouched = false;
  const syncHint = () => { keyHint.textContent = (key.value || 'KEY') + '-1'; };
  name.addEventListener('input', () => { if (!keyTouched) { key.value = name.value.trim() ? suggestKey(name.value) : ''; syncHint(); } });
  key.addEventListener('input', () => { keyTouched = true; key.value = key.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); syncHint(); });
  const color = colorPicker(PALETTE[S.units.length % PALETTE.length]);
  const desc = h('textarea', { class: 'inp', rows: 2, maxlength: 1000, placeholder: 'Чем занимается юнит (необязательно)' });
  const parent = h('select', { class: 'inp' }, h('option', { value: '' }, '— верхний уровень —'),
    S.units.filter(u => !u.archived).sort(byOrder).map(u => h('option', { value: u.id }, u.name)));
  const copy = h('select', { class: 'inp' },
    h('option', { value: '' }, 'Стандартная схема (поле «Приоритет»)'),
    S.units.map(u => h('option', { value: u.id }, `Как в «${u.name}»`)));

  modal({
    title: 'Новый юнит',
    body: [
      h('div', { class: 'grid2' }, field('Название', name), field('Ключ задач', key, h('span', null, 'Номера задач: ', keyHint))),
      h('div', { class: 'grid2' }, field('Цвет', color.el), field('Входит в', parent, 'Юнит ниже: сюда раскладывают задачи сверху.')),
      field('Описание', desc),
      field('Поля карточки', copy, 'Можно скопировать настройки полей и колонок из существующего юнита.'),
    ],
    wide: true,
    actions: [
      { label: 'Отмена' },
      {
        label: 'Создать юнит', primary: true, action: async close => {
          if (!name.value.trim()) { name.focus(); return; }
          let u = await send('createUnit', { name: name.value, key: key.value, color: color.value(), description: desc.value, copyFieldsFrom: copy.value });
          if (parent.value) u = { ...u, ...(await send('updateUnit', { id: u.id, parentId: parent.value })) };
          S.units.push(u);
          close();
          renderSidebar();
          navigate({ unit: u.id, mode: 'board' });
        },
      },
    ],
  });
}

