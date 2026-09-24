import { S, PALETTE, suggestKey } from '../state.js';
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
    { sep: true },
    { label: u.archived ? 'Вернуть из архива' : 'В архив', icon: 'archive', action: () => archiveUnit(u, !u.archived) },
    { label: 'Удалить', icon: 'trash', danger: true, action: () => deleteUnit(u) },
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
    toast(archived ? 'Юнит перенесён в архив' : 'Юнит возвращён', archived ? { action: { label: 'Отменить', run: () => archiveUnit(u, false) } } : {});
    rerender();
  }).catch(showErr);
}

export async function deleteUnit(u) {
  const n = u.counts ? u.counts.todo + u.counts.in_progress + u.counts.done : 0;
  const ok = await confirmDlg(
    `Удалить юнит «${u.name}»${n ? ` и ${n} задач` : ''} вместе с полями, комментариями и историей? Это нельзя отменить. Если юнит может ещё понадобиться — лучше отправить его в архив.`,
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
  const copy = h('select', { class: 'inp' },
    h('option', { value: '' }, 'Стандартная схема (поле «Приоритет»)'),
    S.units.map(u => h('option', { value: u.id }, `Как в «${u.name}»`)));

  modal({
    title: 'Новый юнит',
    body: [
      h('div', { class: 'grid2' }, field('Название', name), field('Ключ задач', key, h('span', null, 'Номера задач: ', keyHint))),
      field('Цвет', color.el),
      field('Описание', desc),
      field('Поля карточки', copy, 'Можно скопировать настройки полей и колонок из существующего юнита.'),
    ],
    wide: true,
    actions: [
      { label: 'Отмена' },
      {
        label: 'Создать юнит', primary: true, action: async close => {
          if (!name.value.trim()) { name.focus(); return; }
          const u = await send('createUnit', { name: name.value, key: key.value, color: color.value(), description: desc.value, copyFieldsFrom: copy.value });
          S.units.push(u);
          close();
          renderSidebar();
          navigate({ unit: u.id, mode: 'board' });
        },
      },
    ],
  });
}

