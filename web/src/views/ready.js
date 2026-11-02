/**
 * Сводка (#/ready, CEO в полном режиме и PM): общая таблица «что где» — строка на приложение, колонки — этапы (дизайн, разработка, тесты,
 * тексты, релиз), апдейт, ссылки этапов (Figma, Drive…), юнит и статус. Из неё видна очередь на разработку: дизайн закрыт, iOS не начат.
 * Колонки настраиваются у каждого свои (prefs.readyCols): системные, этапы, ссылки, поля приложения и пункты Info.
 */
import { S, isStaff, ceoDefault, me, personById, unitById, plural } from '../state.js';
import { $, h, icon, avatar, topbar, showErr, fill, skeleton, modal, toast } from '../ui.js';
import { call, send } from '../api.js';
import { openAppById, appIcon } from './apps.js';

const DAY = 86400000;
const daysSince = iso => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY)) : 0);
const host = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
const fmtDate = d => (d ? new Date(d + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '') : '');

const STAGES = [['design', 'Дизайн'], ['ios', 'Разработка'], ['qa', 'Тесты'], ['meta', 'Тексты'], ['retext', 'Тексты в дизайне'], ['l10n', 'Локализации'], ['release', 'Релиз']];

/** Все колонки, которые можно показать: { id, name, type, group, get(row) → значение }. Приложение — всегда первая, не настраивается. */
function allColumns() {
  const sys = [
    { id: 'designer', name: 'Дизайнер', type: 'person', get: r => (r.stages.design || {}).assigneeId },
    { id: 'pm', name: 'PM', type: 'person', get: r => r.pmId },
    { id: 'unit', name: 'Юнит', type: 'unit', get: r => r.unitId },
    { id: 'status', name: 'Статус', type: 'status', get: r => r.status },
    { id: 'waiting', name: 'В очереди на разработку', type: 'wait', get: r => r.readySince },
    { id: 'due', name: 'Срок', type: 'date', get: r => r.dueDate },
    { id: 'priority', name: 'Приоритет', type: 'text', get: r => r.priority },
  ].map(c => ({ ...c, group: 'Основные' }));
  const stages = [...STAGES.map(([k, name]) => ({ id: 'st:' + k, name, type: 'stage', group: 'Этапы', get: r => ({ t: r.stages[k], ready: k === 'ios' && r.ready }) })),
    { id: 'upd', name: 'Апдейт', type: 'upd', group: 'Этапы', get: r => r.update }];
  const links = S.linkFields.filter(f => !f.archived).map(f => ({ id: 'lf:' + f.id, name: f.name, type: 'link', group: 'Ссылки этапов', get: r => (r.links || {})[f.id] || '' }));
  const fields = S.appFields.map(f => ({ id: 'af:' + f.id, name: f.name, type: f.kind === 'link' ? 'link' : 'text', group: 'Поля приложения', get: r => (r.info || {})[f.id] || '' }));
  const checks = S.appInfoItems.map(x => ({ id: 'ck:' + x.id, name: x.name, type: 'check', group: 'Info', get: r => !!(r.checks && (r.checks.done || []).includes(x.id)) }));
  return [...stages, ...sys, ...links, ...fields, ...checks];
}

/** Какие колонки показаны и в каком порядке: свои из prefs, иначе: дизайнер, ссылки, юнит, этапы, статус, апдейт. */
function chosenIds(cols) {
  const mine = (me() && me().prefs && me().prefs.readyCols) || null;
  const known = new Set(cols.map(c => c.id));
  const links = cols.filter(c => c.id.startsWith('lf:') && /figma|drive|meta|мета/i.test(c.name)).map(c => c.id);
  const base = Array.isArray(mine) ? mine : ['designer', ...links, 'unit', ...STAGES.map(([k]) => 'st:' + k), 'status', 'upd'];
  return base.filter(id => known.has(id));
}

const STAGE_CHIP = { done: ['Готово', 'ok'], progress: ['В работе', 'go'], review: ['Ревью', 'rev'], todo: ['Не начат', 'idle'] };

/** Ячейка по типу колонки. */
function cell(c, row) {
  const v = c.get(row);
  switch (c.type) {
    case 'stage': {
      if (!v.t) return h('span', { class: 'muted' }, '—');
      const [text, cls] = v.t.done ? STAGE_CHIP.done : v.ready ? ['В очереди', 'wait'] : v.t.blocked ? ['Ждёт', 'hold'] : STAGE_CHIP[v.t.kind] || STAGE_CHIP.todo;
      return h('span', { class: 'rd-chip ' + cls }, text);
    }
    case 'upd': return v ? h('span', { class: 'rd-chip ' + (v.done ? 'ok' : 'go'), title: v.title }, v.done ? 'Готово' : `В работе · ${v.progress}%`) : h('span', { class: 'muted' }, '—');
    case 'status': { const st = S.appStatuses.find(x => x.id === v); return st ? h('span', { class: 'rd-status' }, h('span', { class: 'dot', style: { background: st.color } }), st.name) : h('span', { class: 'muted' }, '—'); }
    case 'person': { const p = personById(v); return p ? h('span', { class: 'rd-person' }, avatar(p, 'sm'), h('span', null, p.name.split(' ')[0])) : h('span', { class: 'muted' }, '—'); }
    case 'unit': { const u = unitById(v); return u ? h('span', { class: 'rd-person' }, h('span', { class: 'dot', style: { background: u.color } }), h('span', null, u.name)) : h('span', { class: 'muted' }, '—'); }
    case 'link': return v ? h('a', { class: 'rd-link', href: v, target: '_blank', rel: 'noopener', title: v, onclick: e => e.stopPropagation() }, host(v)) : h('span', { class: 'muted' }, '—');
    case 'check': return h('span', { class: 'rd-check' + (v ? ' on' : ''), title: v ? 'Да' : 'Нет' }, v ? icon('check', 13) : null);
    case 'date': return v ? h('span', null, fmtDate(v)) : h('span', { class: 'muted' }, '—');
    case 'wait': { if (!v) return h('span', { class: 'muted' }, '—'); const n = daysSince(v); return h('span', { class: 'rd-wait' + (n >= 7 ? ' late' : '') }, n === 0 ? 'сегодня' : `${n} ${plural(n, ['день', 'дня', 'дней'])}`); }
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
      h('span', { class: 'rd-col-name' }, c.name, h('small', { class: 'muted' }, ' · ' + ({ person: 'человек', unit: 'юнит', link: 'ссылка', check: 'галочка', date: 'дата', wait: 'срок в очереди', status: 'статус', stage: 'этап', upd: 'апдейт', text: 'текст' }[c.type] || ''))),
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
  if (!isStaff() || ceoDefault()) { location.hash = '#/'; return; }
  const tools = h('div', { class: 'row rd-tools', style: { gap: '8px' } });
  const body = h('div', { class: 'page ceo-page' }, skeleton());
  fill(main, topbar([h('h1', null, 'Сводка')], [tools]), h('div', { class: 'view-body' }, body));
  let rows = [];
  let unit = '';
  let onlyReady = false;
  const draw = () => {
    const cols = allColumns();
    const ids = chosenIds(cols);
    const shown = ids.map(id => cols.find(c => c.id === id));
    const inUnit = unit ? rows.filter(r => r.unitId === unit) : rows;
    const queue = inUnit.filter(r => r.ready);
    const list = onlyReady ? queue : inUnit;
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
    const late = queue.filter(r => daysSince(r.readySince) >= 7).length;
    const W = { stage: 112, upd: 130, person: 112, unit: 90, status: 130, link: 128, text: 120, check: 80, date: 80, wait: 150 };
    const widths = shown.map(c => W[c.type] || 110);
    const template = `240px ${widths.map(w => w + 'px').join(' ')}`;
    const total = 240 + widths.reduce((a, b) => a + b, 0) + (widths.length + 1) * 12 + 32;
    fill(body,
      h('div', { class: 'rd-sum' },
        h('span', null, h('b', null, inUnit.length), ' ' + plural(inUnit.length, ['приложение', 'приложения', 'приложений'])),
        h('button', { class: 'rd-queue' + (onlyReady ? ' on' : ''), type: 'button', 'aria-pressed': String(onlyReady), title: 'Дизайн закрыт, разработка ещё не начата', onclick: () => { onlyReady = !onlyReady; draw(); } },
          icon('layers', 13), `Ждут разработки: ${queue.length}`, late > 0 && h('span', { class: 'rd-late' }, ` · дольше недели ${late}`))),
      list.length
        ? h('div', { class: 'table-wrap rd-table' },
          h('div', { class: 'rd-row rd-head', style: { gridTemplateColumns: template, width: total + 'px' } }, h('span', null, 'Приложение'), shown.map(c => h('span', { title: c.name }, c.name))),
          list.map(r => h('button', { class: 'rd-row' + (r.ready ? ' queued' : ''), style: { gridTemplateColumns: template, width: total + 'px' }, onclick: () => openAppById(r.appId, load) },
            h('span', { class: 'rd-app' }, appIcon({ name: r.appName, iconUrl: r.iconUrl, color: r.color }, 'xs'), h('span', { class: 'rd-app-name' }, r.appName)),
            shown.map(c => cell(c, r)))))
        : h('div', { class: 'card-box empty-state' }, h('h2', null, onlyReady ? 'Очередь пуста' : 'Приложений пока нет'),
          h('p', { class: 'muted' }, onlyReady ? 'Здесь появятся приложения, у которых дизайн закрыт, а разработка ещё не началась.' : 'Они появятся здесь, как только вы создадите приложение.')));
  };
  async function load() {
    try {
      rows = await call('getPipeline', {});
      draw();
    } catch (e) { showErr(e); }
  }
  load();
}

/** Сколько приложений ждут разработки — для цифры в меню. */
export const queueCount = () => call('getPipeline', {}).then(r => r.filter(x => x.ready).length).catch(() => 0);
