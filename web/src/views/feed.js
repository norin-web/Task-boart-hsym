/** Лента событий с фильтрами: главная администратора и «Журнал» в панели админа. */
import { S, LS, personById, relTime, fmtDateTime, activeDepts, byOrder } from '../state.js';
import { h, icon, avatar, fill, showErr, toast, menu } from '../ui.js';
import { call } from '../api.js';
import { taskLink } from '../router.js';

const KINDS = [
  ['status', 'Смена статуса'], ['assign', 'Назначения'], ['comment', 'Комментарии'], ['create', 'Создание'],
  ['fields', 'Изменения полей'], ['move', 'Переносы'], ['archive', 'Архив'], ['delete', 'Удаление'],
];

export function activityText(a) {
  switch (a.action) {
    case 'create': return 'создание задачи';
    case 'comment': return 'комментарий: «' + (a.toText.length > 90 ? a.toText.slice(0, 90) + '…' : a.toText) + '»';
    case 'archive': return 'задача в архиве';
    case 'unarchive': return 'задача возвращена из архива';
    case 'move': return 'перенос ' + a.fromText + ' → ' + a.toText;
    case 'delete': return 'удаление задачи «' + a.fromText + '»';
    case 'update':
      if (a.field === 'description') return a.label.toLowerCase() + ' изменено';
      return a.label + ': ' + a.fromText + ' → ' + a.toText;
    default: return a.action;
  }
}

export function feedItem(a) {
  const p = personById(a.actorId);
  return h('div', { class: 'feed-item' },
    avatar(p, 'sm'),
    h('div', { class: 'feed-body' },
      h('div', { class: 'feed-text' }, h('b', null, p ? p.name : 'Кто-то'), ' · ', activityText(a)),
      a.task && a.unit && taskLink(a.unit.id, a.task.id, { class: 'feed-task' },
        h('span', { class: 'unit-dot', style: { background: a.unit.color, margin: 0 } }),
        h('span', { class: 'key-badge' }, a.task.key),
        h('span', { class: 'ft-title' }, a.task.title)),
      h('div', { class: 'feed-when', title: fmtDateTime(a.at) }, relTime(a.at))));
}

/**
 * Лента с фильтрами в одной кнопке-меню (тип, человек, юнит, позиция) и чипами активных фильтров.
 * «Скрыть текущие» прячет прошлые события только у вас. Возвращает элемент.
 */
export function activityFeed({ limit = 15, title = 'Последние события' } = {}) {
  const f = { kind: '', actorId: '', unitId: '', departmentId: '' };
  let items = [];
  let more = false;
  let seq = 0;
  const clearedAt = () => LS.get('feedClearedAt', '');

  const list = h('div', { class: 'feed' });
  const footer = h('div', { class: 'feed-footer' });
  const actions = h('div', { class: 'row', style: { gap: '6px' } });
  const chips = h('div', { class: 'feed-filters' });
  const box = h('section', { class: 'feed-wrap' },
    h('div', { class: 'section-head' }, h('h2', null, title), actions),
    chips, list, footer);

  const GROUPS = [
    ['kind', 'Тип события', 'Все события', () => KINDS],
    ['actorId', 'Человек', 'Все люди', () => S.people.map(p => [p.id, p.name])],
    ['unitId', 'Юнит', 'Все юниты', () => S.units.filter(u => !u.archived).sort(byOrder).map(u => [u.id, u.name])],
    ['departmentId', 'Позиция', 'Все позиции', () => activeDepts().map(d => [d.id, d.name])],
  ];
  const valueText = (key, v) => { const g = GROUPS.find(x => x[0] === key); const o = g[3]().find(x => x[0] === v); return o ? o[1] : v; };
  const set = (key, v) => { f[key] = v; drawFilters(); load(); };

  const pickMenu = (anchor, [key, label, all, options]) => menu(anchor, [
    { title: label },
    { label: all, icon: f[key] ? null : 'check', action: () => set(key, '') },
    ...options().map(([v, t]) => ({ label: t, icon: f[key] === v ? 'check' : null, action: () => set(key, v) })),
  ]);

  const filterMenu = anchor => menu(anchor, [
    { title: 'Фильтр' },
    ...GROUPS.map(g => ({
      label: h('span', { class: 'fm-row' }, g[1], h('span', { class: 'muted' }, f[g[0]] ? valueText(g[0], f[g[0]]) : 'все')),
      icon: g[0] === 'kind' ? 'layers' : g[0] === 'actorId' ? 'user' : g[0] === 'unitId' ? 'board' : 'filter',
      action: () => setTimeout(() => pickMenu(anchor, g), 0),
    })),
    Object.values(f).some(Boolean) && { label: 'Сбросить фильтры', icon: 'x', action: () => { Object.keys(f).forEach(k => { f[k] = ''; }); drawFilters(); load(); } },
    { sep: true },
    { label: 'Скрыть текущие события', icon: 'x', action: () => { LS.set('feedClearedAt', new Date().toISOString()); load(); toast('Лента очищена — новые события появятся здесь'); } },
    clearedAt() && { label: 'Показать скрытые', icon: 'clock', action: () => { LS.set('feedClearedAt', ''); load(); } },
  ]);

  const drawFilters = () => {
    const n = Object.values(f).filter(Boolean).length;
    fill(chips, Object.entries(f).filter(([, v]) => v).map(([k, v]) => h('span', { class: 'chip filter-chip' },
      valueText(k, v), h('button', { class: 'chip-x', title: 'Убрать фильтр', onclick: () => set(k, '') }, icon('x', 11)))),
    clearedAt() && h('span', { class: 'chip filter-chip muted' }, 'скрыты события до ' + fmtDateTime(clearedAt()),
      h('button', { class: 'chip-x', title: 'Показать скрытые', onclick: () => { LS.set('feedClearedAt', ''); load(); } }, icon('x', 11))));
    fill(actions, h('button', {
      class: 'btn ghost sm' + (n ? ' on' : ''), title: 'Фильтр и очистка ленты',
      onclick: e => { e.stopPropagation(); filterMenu(e.currentTarget); },
    }, icon('filter', 13), 'Фильтр', n > 0 && h('span', { class: 'count-badge' }, n)));
  };

  const draw = () => {
    fill(list, items.length ? items.map(feedItem)
      : h('div', { class: 'empty-state', style: { padding: '28px 16px' } },
        Object.values(f).some(Boolean) ? 'Нет событий по этим фильтрам' : clearedAt() ? 'Новых событий нет' : 'Здесь появятся изменения в задачах'));
    fill(footer, more && h('button', { class: 'btn ghost sm', onclick: () => load(true) }, 'Показать ещё'));
  };

  async function load(append = false) {
    const my = ++seq;
    try {
      const res = await call('getActivity', {
        ...f, limit, since: clearedAt() || undefined, before: append && items.length ? items[items.length - 1].at : undefined,
      });
      if (my !== seq) return;
      items = append ? items.concat(res.items) : res.items;
      more = res.more;
      drawFilters();
      draw();
    } catch (e) { showErr(e); }
  }

  drawFilters();
  fill(list, h('div', { class: 'boot' }, h('span', { class: 'spinner' })));
  load();
  return box;
}
