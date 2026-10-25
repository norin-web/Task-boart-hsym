/** Лента событий с фильтрами: главная администратора и «Журнал» в панели админа. */
import { S, LS, personById, relTime, fmtDateTime, activeDepts, byOrder } from '../state.js';
import { h, icon, avatar, fill, showErr, toast } from '../ui.js';
import { call } from '../api.js';
import { link } from '../router.js';

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
      a.task && a.unit && link({ unit: a.unit.id, mode: 'board', task: a.task.id }, { class: 'feed-task' },
        h('span', { class: 'unit-dot', style: { background: a.unit.color, margin: 0 } }),
        h('span', { class: 'key-badge' }, a.task.key),
        h('span', { class: 'ft-title' }, a.task.title)),
      h('div', { class: 'feed-when', title: fmtDateTime(a.at) }, relTime(a.at))));
}

/**
 * Лента с фильтрами (человек, юнит, позиция, тип), «Очистить» (скрывает прошлые события только у вас),
 * «Показать ещё». Возвращает элемент.
 */
export function activityFeed({ limit = 15, title = 'Последние события' } = {}) {
  const f = { actorId: '', unitId: '', departmentId: '', kind: '' };
  let items = [];
  let more = false;
  let seq = 0;
  const clearedAt = () => LS.get('feedClearedAt', '');

  const list = h('div', { class: 'feed' });
  const footer = h('div', { class: 'feed-footer' });
  const actions = h('div', { class: 'row', style: { gap: '6px' } });
  const filters = h('div', { class: 'feed-filters' });
  const box = h('section', { class: 'feed-wrap' },
    h('div', { class: 'section-head' }, h('h2', null, title), actions),
    filters, list, footer);

  const select = (key, placeholder, options) => h('select', {
    class: 'inp sm' + (f[key] ? ' on' : ''), value: f[key], title: placeholder,
    onchange: e => { f[key] = e.target.value; drawFilters(); load(); },
  }, h('option', { value: '' }, placeholder), options.map(([v, t]) => h('option', { value: v }, t)));

  const drawFilters = () => {
    const active = Object.values(f).some(Boolean);
    fill(filters,
      select('actorId', 'Все люди', S.people.map(p => [p.id, p.name])),
      select('unitId', 'Все юниты', S.units.filter(u => !u.archived).sort(byOrder).map(u => [u.id, u.name])),
      select('departmentId', 'Все позиции', activeDepts().map(d => [d.id, d.name])),
      select('kind', 'Все события', KINDS),
      active && h('button', { class: 'link-btn', onclick: () => { Object.keys(f).forEach(k => { f[k] = ''; }); drawFilters(); load(); } }, 'Сбросить'));
    fill(actions,
      clearedAt() && h('button', { class: 'btn ghost sm', title: 'Показать события до очистки', onclick: () => { LS.set('feedClearedAt', ''); load(); } }, 'Показать скрытые'),
      h('button', {
        class: 'btn ghost sm', title: 'Скрыть текущие события (только у вас; история не удаляется)',
        onclick: () => { LS.set('feedClearedAt', new Date().toISOString()); load(); toast('Лента очищена — новые события появятся здесь'); },
      }, icon('x', 13), 'Очистить'));
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
