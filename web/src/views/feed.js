/** Лента событий с фильтрами: главная администратора и «Журнал» в панели админа. */
import { S, LS, personById, relTime, fmtDateTime, activeDepts, byOrder } from '../state.js';
import { h, icon, avatar, fill, showErr, toast, menu, modal, field } from '../ui.js';
import { call } from '../api.js';
import { taskLink } from '../router.js';

const KINDS = [
  ['status', 'Смена статуса'], ['assign', 'Назначения'], ['comment', 'Комментарии'], ['create', 'Создание'],
  ['fields', 'Изменения полей'], ['move', 'Переносы'], ['archive', 'Архив'], ['delete', 'Удаление'],
];

/** Период ленты: границы в ISO (локальные сутки). to — не включительно. */
const dayStart = (offset = 0) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d; };
const PERIODS = [
  ['today', 'Сегодня', () => ({ from: dayStart() })],
  ['yesterday', 'Вчера', () => ({ from: dayStart(-1), to: dayStart() })],
  ['7d', 'Последние 7 дней', () => ({ from: dayStart(-6) })],
  ['30d', 'Последние 30 дней', () => ({ from: dayStart(-29) })],
  ['month', 'Этот месяц', () => { const d = dayStart(); d.setDate(1); return { from: d }; }],
];
/** Более строгая из двух границ: для since — поздняя, для before — ранняя. */
const bound = (iso, date, later) => {
  const vals = [iso, date ? new Date(date - (later ? 1 : 0)).toISOString() : ''].filter(Boolean).sort();
  return vals.length ? vals[later ? vals.length - 1 : 0] : undefined;
};
const fmtDay = d => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

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
      if (a.field.startsWith('link:')) return 'ссылка ' + a.label + ' ' + a.toText;
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
  let period = null; // { label, from?: Date, to?: Date }
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

  const setPeriod = p => { period = p; drawFilters(); load(); };
  const periodMenu = anchor => menu(anchor, [
    { title: 'Период' },
    { label: 'За всё время', icon: period ? null : 'check', action: () => setPeriod(null) },
    ...PERIODS.map(([id, label, make]) => ({ label, icon: period && period.id === id ? 'check' : null, action: () => setPeriod({ id, label, ...make() }) })),
    { sep: true },
    { label: 'Свой период…', icon: period && period.id === 'custom' ? 'check' : 'calendar', action: customPeriod },
  ]);
  function customPeriod() {
    const from = h('input', { class: 'inp', type: 'date', value: period && period.from ? isoDay(period.from) : isoDay(dayStart(-6)) });
    const to = h('input', { class: 'inp', type: 'date', value: period && period.to ? isoDay(new Date(period.to - 1)) : isoDay(dayStart()) });
    modal({
      title: 'Период событий',
      body: h('div', { class: 'row', style: { gap: '12px', flexWrap: 'wrap' } }, field('С', from), field('По (включительно)', to)),
      actions: [{ label: 'Отмена' }, {
        label: 'Применить', primary: true, action: close => {
          const a = from.value ? new Date(from.value + 'T00:00') : null;
          let b = to.value ? new Date(to.value + 'T00:00') : null;
          if (a && b && b < a) throw new Error('Дата «по» раньше даты «с»');
          if (b) b = new Date(b.getFullYear(), b.getMonth(), b.getDate() + 1);
          if (!a && !b) { setPeriod(null); return close(); }
          const last = b && new Date(b - 1);
          const label = a && b ? (isoDay(a) === isoDay(last) ? fmtDay(a) : `${fmtDay(a)} — ${fmtDay(last)}`) : a ? 'с ' + fmtDay(a) : 'по ' + fmtDay(new Date(b - 1));
          setPeriod({ id: 'custom', label, from: a, to: b });
          close();
        },
      }],
    });
  }

  const pickMenu = (anchor, [key, label, all, options]) => menu(anchor, [
    { title: label },
    { label: all, icon: f[key] ? null : 'check', action: () => set(key, '') },
    ...options().map(([v, t]) => ({ label: t, icon: f[key] === v ? 'check' : null, action: () => set(key, v) })),
  ]);

  const filterMenu = anchor => menu(anchor, [
    { title: 'Фильтр' },
    { label: h('span', { class: 'fm-row' }, 'Период', h('span', { class: 'muted' }, period ? period.label : 'всё время')), icon: 'calendar', action: () => setTimeout(() => periodMenu(anchor), 0) },
    ...GROUPS.map(g => ({
      label: h('span', { class: 'fm-row' }, g[1], h('span', { class: 'muted' }, f[g[0]] ? valueText(g[0], f[g[0]]) : 'все')),
      icon: g[0] === 'kind' ? 'layers' : g[0] === 'actorId' ? 'user' : g[0] === 'unitId' ? 'board' : 'filter',
      action: () => setTimeout(() => pickMenu(anchor, g), 0),
    })),
    (period || Object.values(f).some(Boolean)) && { label: 'Сбросить фильтры', icon: 'x', action: () => { Object.keys(f).forEach(k => { f[k] = ''; }); period = null; drawFilters(); load(); } },
    { sep: true },
    { label: 'Скрыть текущие события', icon: 'x', action: () => { LS.set('feedClearedAt', new Date().toISOString()); load(); toast('Лента очищена — новые события появятся здесь'); } },
    clearedAt() && { label: 'Показать скрытые', icon: 'clock', action: () => { LS.set('feedClearedAt', ''); load(); } },
  ]);

  const drawFilters = () => {
    const n = Object.values(f).filter(Boolean).length + (period ? 1 : 0);
    fill(chips,
    period && h('span', { class: 'chip filter-chip' }, icon('calendar', 11), period.label,
      h('button', { class: 'chip-x', title: 'Убрать период', onclick: () => setPeriod(null) }, icon('x', 11))),
    Object.entries(f).filter(([, v]) => v).map(([k, v]) => h('span', { class: 'chip filter-chip' },
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
        period || Object.values(f).some(Boolean) ? 'Нет событий по этим фильтрам' : clearedAt() ? 'Новых событий нет' : 'Здесь появятся изменения в задачах'));
    fill(footer, more && h('button', { class: 'btn ghost sm', onclick: () => load(true) }, 'Показать ещё'));
  };

  async function load(append = false) {
    const my = ++seq;
    try {
      const res = await call('getActivity', {
        ...f, limit, since: bound(clearedAt(), period && period.from, true), before: bound(append && items.length ? items[items.length - 1].at : '', period && period.to, false),
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
