/**
 * Готовы к разработке (#/ready, CEO и PM): приложения, где «Дизайн» закрыт, а «iOS» ещё не начат — очередь на разработку.
 * Колонки настраиваются у каждого свои (prefs.readyCols): системные (дизайнер, юнит, срок…), ссылки этапов (Figma, Drive…),
 * поля приложения и пункты Info; тип колонки (человек, ссылка, текст, галочка, дата) следует из источника.
 */
import { S, isStaff, me, personById, unitById, relTime, plural } from '../state.js';
import { $, h, icon, avatar, topbar, showErr, fill, skeleton, modal, toast } from '../ui.js';
import { call, send } from '../api.js';
import { openAppById, appIcon } from './apps.js';

const DAY = 86400000;
const daysSince = iso => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY)) : 0);
const host = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
const fmtDate = d => (d ? new Date(d + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '') : '');

/** Все колонки, которые можно показать: { id, name, type, group, get(row) → значение }. Приложение — всегда первая, не настраивается. */
function allColumns() {
  const sys = [
    { id: 'designer', name: 'Дизайнер', type: 'person', get: r => r.designerId },
    { id: 'pm', name: 'PM', type: 'person', get: r => r.pmId },
    { id: 'ios', name: 'Разработчик', type: 'person', get: r => r.iosId },
    { id: 'unit', name: 'Юнит', type: 'unit', get: r => r.unitId },
    { id: 'type', name: 'Тип', type: 'badge', get: r => (r.type === 'update' ? 'Апдейт' : r.type === 'new_app' ? 'New App' : 'Задача') },
    { id: 'waiting', name: 'В очереди', type: 'wait', get: r => r.readySince },
    { id: 'due', name: 'Срок', type: 'date', get: r => r.dueDate },
    { id: 'priority', name: 'Приоритет', type: 'text', get: r => r.priority },
    { id: 'status', name: 'Статус приложения', type: 'badge', get: r => ((S.appStatuses.find(s => s.id === r.status) || {}).name || '') },
  ].map(c => ({ ...c, group: 'Основные' }));
  const links = S.linkFields.filter(f => !f.archived).map(f => ({ id: 'lf:' + f.id, name: f.name, type: 'link', group: 'Ссылки этапов', get: r => (r.links || {})[f.id] || '' }));
  const fields = S.appFields.map(f => ({ id: 'af:' + f.id, name: f.name, type: f.kind === 'link' ? 'link' : 'text', group: 'Поля приложения', get: r => (r.info || {})[f.id] || '' }));
  const checks = S.appInfoItems.map(x => ({ id: 'ck:' + x.id, name: x.name, type: 'check', group: 'Info', get: r => !!(r.checks && (r.checks.done || []).includes(x.id)) }));
  return [...sys, ...links, ...fields, ...checks];
}

const DEFAULT_COLS = ['designer', 'unit', 'type', 'waiting', 'due'];

/** Какие колонки показаны и в каком порядке: свои из prefs, иначе по умолчанию + ссылки Figma/Drive. */
function chosenIds(cols) {
  const mine = (me() && me().prefs && me().prefs.readyCols) || null;
  const known = new Set(cols.map(c => c.id));
  const base = Array.isArray(mine) ? mine : [...DEFAULT_COLS.slice(0, 1), ...cols.filter(c => c.type === 'link' && /figma|drive/i.test(c.name) && c.id.startsWith('lf:')).map(c => c.id), ...DEFAULT_COLS.slice(1)];
  return base.filter(id => known.has(id));
}

/** Ячейка по типу колонки. */
function cell(c, row) {
  const v = c.get(row);
  switch (c.type) {
    case 'person': { const p = personById(v); return p ? h('span', { class: 'rd-person' }, avatar(p, 'sm'), h('span', null, p.name.split(' ')[0])) : h('span', { class: 'muted' }, '—'); }
    case 'unit': { const u = unitById(v); return u ? h('span', { class: 'rd-person' }, h('span', { class: 'dot', style: { background: u.color } }), h('span', null, u.name)) : h('span', { class: 'muted' }, '—'); }
    case 'link': return v ? h('a', { class: 'rd-link', href: v, target: '_blank', rel: 'noopener', title: v, onclick: e => e.stopPropagation() }, host(v)) : h('span', { class: 'muted' }, '—');
    case 'check': return h('span', { class: 'rd-check' + (v ? ' on' : ''), title: v ? 'Да' : 'Нет' }, v ? icon('check', 13) : null);
    case 'date': return v ? h('span', null, fmtDate(v)) : h('span', { class: 'muted' }, '—');
    case 'wait': { const n = daysSince(v); return h('span', { class: 'rd-wait' + (n >= 7 ? ' late' : '') }, n === 0 ? 'сегодня' : `${n} ${plural(n, ['день', 'дня', 'дней'])}`); }
    case 'badge': return v ? h('span', { class: 'rd-badge' }, v) : h('span', { class: 'muted' }, '—');
    default: return v ? h('span', { class: 'rd-text', title: String(v) }, String(v)) : h('span', { class: 'muted' }, '—');
  }
}

/** Окно «Колонки»: галочки и порядок. */
function columnsDialog(cols, ids, apply) {
  let order = [...ids];
  const list = h('div', { class: 'rd-cols' });
  const draw = () => {
    const off = cols.filter(c => !order.includes(c.id));
    const row = (c, i) => h('div', { class: 'rd-col-row' },
      h('input', { type: 'checkbox', checked: i != null, 'aria-label': c.name, onchange: e => { order = e.target.checked ? [...order, c.id] : order.filter(x => x !== c.id); draw(); } }),
      h('span', { class: 'rd-col-name' }, c.name, h('small', { class: 'muted' }, ' · ' + ({ person: 'человек', unit: 'юнит', link: 'ссылка', check: 'галочка', date: 'дата', wait: 'срок в очереди', badge: 'метка', text: 'текст' }[c.type] || ''))),
      i != null && h('span', { class: 'rd-col-move' },
        h('button', { class: 'icon-btn sm', type: 'button', title: 'Выше', disabled: i === 0, onclick: () => { [order[i - 1], order[i]] = [order[i], order[i - 1]]; draw(); } }, icon('chevron', 12)),
        h('button', { class: 'icon-btn sm rd-down', type: 'button', title: 'Ниже', disabled: i === order.length - 1, onclick: () => { [order[i + 1], order[i]] = [order[i], order[i + 1]]; draw(); } }, icon('chevron', 12))));
    const groups = [...new Set(off.map(c => c.group))];
    fill(list,
      order.length > 0 && h('div', { class: 'rd-col-group' }, 'Показаны'),
      ...order.map((id, i) => row(cols.find(c => c.id === id), i)),
      ...groups.flatMap(g => [h('div', { class: 'rd-col-group' }, g), ...off.filter(c => c.group === g).map(c => row(c, null))]));
  };
  draw();
  modal({
    title: 'Колонки', cls: 'dlg',
    body: [h('p', { class: 'hint', style: { marginTop: 0 } }, 'Название приложения показывается всегда. Ссылки и поля берутся из карточек приложений, их список настраивается в «Настроить карточку».'), list],
    actions: [{ label: 'Отмена' }, { label: 'По умолчанию', action: close => { apply(null); close(); } }, { label: 'Сохранить', primary: true, action: close => { apply(order); close(); } }],
  });
}

export async function renderReady() {
  const main = $('#main');
  if (!isStaff()) { location.hash = '#/'; return; }
  const tools = h('div', { class: 'row rd-tools', style: { gap: '8px' } });
  const body = h('div', { class: 'page ceo-page' }, skeleton());
  fill(main, topbar([h('h1', null, 'Готовы к разработке')], [tools]), h('div', { class: 'view-body' }, body));
  let rows = [];
  let unit = '';
  const draw = () => {
    const cols = allColumns();
    const ids = chosenIds(cols);
    const shown = ids.map(id => cols.find(c => c.id === id));
    const list = unit ? rows.filter(r => r.unitId === unit) : rows;
    const units = S.units.filter(u => !u.archived && rows.some(r => r.unitId === u.id));
    fill(tools,
      units.length > 1 && h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Юнит' },
        [['', 'Все'], ...units.map(u => [u.id, u.name, u.color])].map(([id, name, color]) => h('button', { class: unit === id ? 'on' : '', role: 'radio', 'aria-checked': String(unit === id), onclick: () => { unit = id; draw(); } },
          color && h('span', { class: 'dot', style: { background: color } }), name))),
      h('button', { class: 'btn', onclick: () => columnsDialog(cols, ids, next => {
        const p = me(); const prefs = { readyCols: next };
        if (p) p.prefs = { ...(p.prefs || {}), readyCols: next };
        send('setMyPrefs', { personId: S.meId, prefs }).catch(showErr);
        if (!next) toast('Колонки по умолчанию');
        draw();
      }) }, icon('sliders', 14), 'Колонки'));
    const template = `minmax(220px, 1.6fr) ${shown.map(c => (c.type === 'text' || c.type === 'link' ? 'minmax(120px, 1fr)' : 'minmax(100px, .7fr)')).join(' ')}`;
    const late = list.filter(r => daysSince(r.readySince) >= 7).length;
    fill(body,
      h('div', { class: 'rd-sum' },
        h('b', null, list.length), ' ' + plural(list.length, ['приложение ждёт', 'приложения ждут', 'приложений ждут']) + ' разработки',
        late > 0 && h('span', { class: 'rd-late' }, ` · дольше недели: ${late}`)),
      list.length
        ? h('div', { class: 'table-wrap rd-table' },
          h('div', { class: 'rd-row rd-head', style: { gridTemplateColumns: template } }, h('span', null, 'Приложение'), shown.map(c => h('span', { title: c.name }, c.name))),
          list.map(r => h('button', { class: 'rd-row', style: { gridTemplateColumns: template }, onclick: () => openAppById(r.appId, load) },
            h('span', { class: 'rd-app' }, appIcon({ name: r.appName, iconUrl: r.iconUrl, color: r.color }, 'xs'), h('span', { class: 'rd-app-name' }, r.appName)),
            shown.map(c => cell(c, r)))))
        : h('div', { class: 'card-box empty-state' }, h('h2', null, 'Очередь пуста'), h('p', { class: 'muted' }, 'Здесь появятся приложения, у которых дизайн закрыт, а разработка ещё не началась.')));
  };
  async function load() {
    try {
      rows = await call('getDevQueue', {});
      draw();
    } catch (e) { showErr(e); }
  }
  load();
}

/** Сколько приложений в очереди — для цифры в меню. */
export const queueCount = () => call('getDevQueue', {}).then(r => r.length).catch(() => 0);
