import { S, PALETTE, suggestKey, isSuper, activeDepts, ACCESS_LABELS } from '../state.js';
import { h, field, menu, modal, confirmDlg, promptDlg, toast, showErr, colorPicker, personSelect } from '../ui.js';
import { send } from '../api.js';
import { navigate, rerender } from '../router.js';
import { renderSidebar } from './sidebar.js';

export function unitMenu(anchor, u) {
  menu(anchor, [
    { label: 'Открыть', icon: 'arrow', action: () => navigate({ unit: u.id, mode: 'board' }) },
    { label: 'Настройки', icon: 'settings', action: () => navigate({ unit: u.id, mode: 'settings' }) },
    { label: 'Переименовать', icon: 'edit', action: () => renameUnit(u) },
    isSuper() && { label: 'Дублировать (со схемой полей)', icon: 'copy', action: () => duplicateUnit(u) },
    { sep: true },
    ...(u.archived
      ? [{ label: 'Восстановить', icon: 'archive', action: () => archiveUnit(u, false) },
        { label: 'Удалить навсегда', icon: 'trash', danger: true, action: () => deleteUnit(u) }]
      : [{ label: 'Удалить', icon: 'trash', danger: true, action: () => archiveUnit(u, true) }]),
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
    toast(archived ? `«${u.name}» в корзине — его можно восстановить: Настройки → Юниты` : `«${u.name}» восстановлен`,
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

/** После создания остаёмся на месте (панель админа, дашборд…): onCreated или перерисовка экрана; доска — по «Открыть» в тосте. */
export function openCreateUnit(onCreated) {
  const name = h('input', { class: 'inp', placeholder: 'Например, Gold', maxlength: 80 });
  const key = h('input', { class: 'inp mono', placeholder: 'MKT', maxlength: 10 });
  const keyHint = h('span', null, 'KEY-1');
  let keyTouched = false;
  const syncHint = () => { keyHint.textContent = (key.value || 'KEY') + '-1'; };
  name.addEventListener('input', () => { if (!keyTouched) { key.value = name.value.trim() ? suggestKey(name.value) : ''; syncHint(); } });
  key.addEventListener('input', () => { keyTouched = true; key.value = key.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); syncHint(); });
  const color = colorPicker(PALETTE[S.units.length % PALETTE.length]);
  const desc = h('textarea', { class: 'inp', rows: 2, maxlength: 1000, placeholder: 'Чем занимается юнит (необязательно)' });
  const copy = h('select', { class: 'inp' },
    h('option', { value: '' }, 'Стандартная схема (поле «Приоритет»)'),
    S.units.map(u => h('option', { value: u.id }, `Как в «${u.name}»`)));
  // PM юнита: из тех, у кого доступ «PM»; если он один — сразу выбран
  const pms = S.people.filter(p => p.active && (p.access === 'moderator' || p.access === 'superadmin'));
  const pmSel = h('select', { class: 'inp', 'aria-label': 'PM юнита' },
    h('option', { value: '' }, '— выбрать позже —'),
    pms.map(p => h('option', { value: p.id }, `${p.name} · ${ACCESS_LABELS[p.access]}`)));
  // ревьюеры по позициям: дизайн — …, разработка — …; по умолчанию — для остальных
  const who = (empty, dept) => personSelect('', null, { empty, dept, label: 'Ревьюер' });
  const byDept = activeDepts().map(d => ({ d, sel: who('— по умолчанию —', d.id) }));
  const dflt = who('— без ревьюера —');
  const reviewBox = h('div', { class: 'rv-list rv-plain' },
    byDept.map(({ d, sel }) => h('div', { class: 'rv-row' }, h('span', { class: 'rv-label' }, h('span', { class: 'dot', style: { background: d.color } }), d.name), sel)),
    h('div', { class: 'rv-row rv-default' }, h('span', { class: 'rv-label' }, 'По умолчанию'), dflt));

  modal({
    title: 'Новый юнит',
    body: [
      h('div', { class: 'grid2' }, field('Название', name), field('Ключ задач', key, h('span', null, 'Номера задач: ', keyHint))),
      field('Цвет', color.el),
      field('Описание', desc),
      field('Ответственный за юнит', pmSel, 'PM или CEO: ему идут запросы CEO и реджекты. Сменить потом может только CEO.'),
      field('Поля карточки', copy, 'Можно скопировать настройки полей и колонок из существующего юнита.'),
      field('Ревьюеры по позициям', reviewBox, 'Задача, пришедшая в ревью, станет задачей этого человека. Можно изменить позже в настройках юнита.'),
    ],
    wide: true,
    actions: [
      { label: 'Отмена' },
      {
        label: 'Создать юнит', primary: true, action: async close => {
          if (!name.value.trim()) { name.focus(); return; }
          const u = await send('createUnit', { name: name.value, key: key.value, color: color.value(), description: desc.value, pmId: pmSel.value, copyFieldsFrom: copy.value,
            review: { byPosition: Object.fromEntries(byDept.filter(x => x.sel.value).map(x => [x.d.id, x.sel.value])), default: dflt.value } });
          S.units.push(u);
          close();
          renderSidebar();
          toast(`Юнит «${u.name}» создан`, { action: { label: 'Открыть', run: () => navigate({ unit: u.id, mode: 'board' }) } });
          if (typeof onCreated === 'function') onCreated(u); else rerender();
        },
      },
    ],
  });
}

