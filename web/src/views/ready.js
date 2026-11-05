/**
 * Сводка (#/ready, CEO в полном режиме и PM): общая таблица «что где» — строка на приложение, колонки — этапы (дизайн, разработка, тесты,
 * тексты, релиз), апдейт, ссылки этапов (Figma, Drive…), юнит и статус. Из неё видна очередь на разработку: дизайн закрыт, iOS не начат.
 * Колонки настраиваются у каждого свои (prefs.readyCols): системные, этапы, ссылки, поля приложения и пункты Info.
 * Как в Google Sheets: свои колонки (флажок, список, текст, число, дата, ссылка, человек), свои строки, скрытие строк,
 * группы колонок и группировка строк со сворачиванием. Всё личное и лежит в prefs.readySheet — схема базы не меняется.
 */
import { S, isDev, isStaff, ceoDefault, me, personById, unitById, plural, safeUrl } from '../state.js';
import { $, h, icon, avatar, topbar, showErr, fill, skeleton, modal, toast, menu, confirmDlg } from '../ui.js';
import Sortable from 'sortablejs';
import { call, send } from '../api.js';
import { navigate } from '../router.js';
import { openAppById, appIcon } from './apps.js';

const DAY = 86400000;
const daysSince = iso => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY)) : 0);
const host = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
const fmtDate = d => (d ? new Date(d + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '') : '');

const uid = () => Math.random().toString(36).slice(2, 9);
/** Типы своих колонок: id, подпись, значок. */
const TYPES = [['text', 'Текст', 'edit'], ['number', 'Число', 'rows'], ['checkbox', 'Флажок', 'check'], ['select', 'Выпадающий список', 'chevron'], ['date', 'Дата', 'calendar'], ['link', 'Ссылка', 'link'], ['person', 'Человек', 'user']];
const OPT_COLORS = ['#4f8cff', '#2eeac4', '#a98bff', '#e3f23a', '#ff8a5b', '#ff6b8b', '#8a91a1'];
const GROUPS = [['', 'Не группировать'], ['unit', 'Юнит'], ['status', 'Статус'], ['queue', 'Очередь на разработку'], ['designer', 'Дизайнер']];

/** Личная часть сводки из prefs: свои колонки и строки, значения, скрытые приложения, группировки. */
function sheetOf() {
  const s = (me() && me().prefs && me().prefs.readySheet) || {};
  return { cols: s.cols || [], vals: s.vals || {}, rows: s.rows || [], hide: s.hide || [], group: s.group || '', foldRows: s.foldRows || [], colGroup: s.colGroup || {}, foldCols: s.foldCols || [] };
}

const STAGES = [['design', 'Дизайн'], ['art', 'OB и ASO-графика'], ['ios', 'Разработка'], ['qa', 'Тесты'], ['integr', 'Интеграция'], ['meta', 'Тексты'], ['store', 'Метаданные'], ['retext', 'Тексты в дизайне'], ['l10n', 'Локализации'], ['release', 'Релиз']];

/** Все колонки, которые можно показать: { id, name, type, group, get(row) → значение }. Приложение — всегда первая, не настраивается. */
function allColumns(sheet) {
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
  const mine = sheet.cols.map(c => ({ id: 'cu:' + c.id, name: c.name, type: c.type, group: 'Мои колонки', custom: true, def: c, get: r => (sheet.vals[r.key] || {})[c.id] }));
  return [...stages, ...sys, ...links, ...fields, ...checks, ...mine];
}

/** Какие колонки показаны и в каком порядке: свои из prefs, иначе: дизайнер, ссылки, юнит, этапы, статус, апдейт. */
function chosenIds(cols) {
  const mine = (me() && me().prefs && me().prefs.readyCols) || null;
  const known = new Set(cols.map(c => c.id));
  const links = cols.filter(c => c.id.startsWith('lf:') && /figma|drive|meta|мета/i.test(c.name)).map(c => c.id);
  const base = Array.isArray(mine) ? mine : ['designer', ...links, 'unit', ...STAGES.map(([k]) => 'st:' + k), 'status', 'upd'];
  return base.filter(id => known.has(id));
}

const STAGE_CHIP = { done: ['Готово', 'ok', 'done'], progress: ['В работе', 'go', 'progress'], review: ['Ревью', 'rev', 'review'], todo: ['Не начат', 'idle', 'todo'] };

/** Ячейка-список как в таблице: заливка цветом на всю ячейку и стрелка; клик открывает выбор. */
const pick = (text, cls, onOpen, title) => h('button', { class: 'rd-cell ' + cls, type: 'button', title: title || '', onclick: e => { e.stopPropagation(); onOpen(e.currentTarget); } },
  h('span', { class: 'rd-cell-t' }, text), icon('chevron', 12));

/** Сменить статус этапа прямо в таблице: тот же updateTask, что и на доске, с теми же правилами. */
function stageMenu(row, key, anchor, reload) {
  const t = row.stages[key]; if (!t) return;
  const unit = unitById(row.unitId); const cols = unit && unit.settings ? unit.settings.columns : [];
  const items = ['todo', 'progress', 'review', 'done'].map(kind => ({ kind, col: cols.find(c => c.kind === kind) })).filter(x => x.col)
    .map(({ kind, col }) => ({ label: STAGE_CHIP[kind][0], icon: (t.done ? 'done' : t.kind) === kind ? 'check' : 'blank', action: async () => {
      try { await send('updateTask', { id: t.id, patch: { status: col.id } }); } catch (e) { showErr(e); }
      reload();
    } }));
  menu(anchor, [{ title: 'Статус этапа' }, ...items], { align: 'left' });
}

/** Ячейка по типу колонки. ctx.reload перечитывает таблицу после правки. */
function cell(c, row, ctx) {
  if (c.custom) return customCell(c, row, ctx);
  if (row.free) return h('span', { class: 'muted' }, '—');
  const v = c.get(row);
  switch (c.type) {
    case 'stage': {
      if (!v.t) return h('span', { class: 'muted' }, '—');
      const [text, cls] = v.t.done ? STAGE_CHIP.done : v.ready ? ['В очереди', 'wait'] : v.t.blocked ? ['Ждёт', 'hold'] : STAGE_CHIP[v.t.kind] || STAGE_CHIP.todo;
      return pick(text, cls, a => stageMenu(row, c.id.slice(3), a, ctx.reload));
    }
    case 'upd': return v ? h('span', { class: 'rd-cell ' + (v.done ? 'ok' : 'go'), title: v.title }, h('span', { class: 'rd-cell-t' }, v.done ? 'Готово' : `В работе · ${v.progress}%`)) : h('span', { class: 'muted' }, '—');
    case 'status': {
      const st = S.appStatuses.find(x => x.id === v); if (!st) return h('span', { class: 'muted' }, '—');
      const el = pick(st.name, 'stat', an => menu(an, [{ title: 'Статус приложения' }, ...S.appStatuses.map(x => ({ label: x.name, icon: x.id === v ? 'check' : 'blank',
        action: async () => { try { await send('updateApp', { id: row.appId, status: x.id }); } catch (e) { showErr(e); } ctx.reload(); } }))], { align: 'left' }));
      el.style.setProperty('--c', st.color);
      return el;
    }
    case 'person': { const p = personById(v); return p ? h('span', { class: 'rd-person' }, avatar(p, 'sm'), h('span', null, p.name.split(' ')[0])) : h('span', { class: 'muted' }, '—'); }
    case 'unit': { const u = unitById(v); return u ? h('span', { class: 'rd-unit', style: { '--c': u.color } }, u.name) : h('span', { class: 'muted' }, '—'); }
    case 'link': return v ? h('a', { class: 'rd-link', href: safeUrl(v), target: '_blank', rel: 'noopener', title: v, onclick: e => e.stopPropagation() }, host(v)) : h('span', { class: 'muted' }, '—');
    case 'check': {
      const id = c.id.slice(3), done = (row.checks && row.checks.done) || [];
      return h('button', { class: 'rd-check' + (v ? ' on' : ''), type: 'button', role: 'checkbox', 'aria-checked': String(!!v), title: v ? 'Да' : 'Нет',
        onclick: async e => { e.stopPropagation(); try { await send('updateApp', { id: row.appId, checks: { ...(row.checks || { own: [] }), done: v ? done.filter(x => x !== id) : [...done, id] } }); } catch (er) { showErr(er); } ctx.reload(); } }, v ? icon('check', 13) : null);
    }
    case 'date': return v ? h('span', null, fmtDate(v)) : h('span', { class: 'muted' }, '—');
    case 'wait': { if (!v) return h('span', { class: 'muted' }, '—'); const n = daysSince(v); return h('span', { class: 'rd-wait' + (n >= 7 ? ' late' : '') }, n === 0 ? 'сегодня' : `${n} ${plural(n, ['день', 'дня', 'дней'])}`); }
    default: return v ? h('span', { class: 'rd-text', title: String(v) }, String(v)) : h('span', { class: 'muted' }, '—');
  }
}

/** Ячейка своей колонки: правка прямо в ней. ctx.set(ключ строки, колонка, значение, перерисовать?). */
function customCell(c, row, ctx) {
  const v = c.get(row);
  const d = c.def, id = d.id;
  const done = (val, redraw = true) => ctx.set(row.key, id, val, redraw);
  const input = (type, extra) => h('input', { class: 'rd-in' + (v == null || v === '' ? ' empty' : ''), type, value: v == null ? '' : String(v), 'aria-label': c.name + ': ' + row.appName, ...extra,
    onchange: e => { e.target.classList.toggle('empty', e.target.value === ''); done(type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value.trim(), false); },
    onkeydown: e => { if (e.key === 'Enter') e.target.blur(); } });
  switch (d.type) {
    case 'checkbox':
      return h('button', { class: 'rd-check' + (v ? ' on' : ''), type: 'button', role: 'checkbox', 'aria-checked': String(!!v), 'aria-label': c.name + ': ' + row.appName, title: v ? 'Да' : 'Нет',
        onclick: () => done(!v) }, v ? icon('check', 13) : null);
    case 'select': {
      const opt = (d.options || []).find(o => o.id === v);
      const el = pick(opt ? opt.name : '', opt ? 'stat' : 'idle', an => menu(an, [{ title: c.name },
        ...(d.options || []).map(o => ({ label: o.name, icon: o.id === v ? 'check' : 'blank', action: () => done(o.id) })),
        v && { sep: true }, v && { label: 'Очистить', icon: 'x', action: () => done('') }], { align: 'left' }));
      if (opt) el.style.setProperty('--c', opt.color);
      return el;
    }
    case 'person': {
      const p = personById(v);
      return pick(p ? p.name : '', 'plain', an => menu(an, [{ title: c.name },
        ...S.people.filter(x => x.active).map(x => ({ label: x.name, icon: x.id === v ? 'check' : 'blank', action: () => done(x.id) })),
        v && { sep: true }, v && { label: 'Очистить', icon: 'x', action: () => done('') }], { align: 'left' }));
    }
    case 'date': return input('date');
    case 'number': return input('number');
    case 'link':
      return h('div', { class: 'rd-lcell' }, input('text', { placeholder: 'https://' }),
        v && /^https?:\/\//i.test(v) && h('a', { href: safeUrl(v), target: '_blank', rel: 'noopener', title: 'Открыть ссылку', 'aria-label': 'Открыть ссылку' }, icon('link', 14)));
    default: return input('text');
  }
}

/** Спросить короткое имя (группа колонок). */
function askName(title, initial, ok) {
  let val = initial || '';
  const inp = h('input', { type: 'text', value: val, maxlength: '40', 'aria-label': title, oninput: e => { val = e.target.value; }, onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); go(); } } });
  let closeFn = null;
  const go = () => { if (val.trim() && closeFn) { closeFn(); ok(val.trim()); } };
  modal({ title, cls: 'dlg', body: h('label', { class: 'rd-field' }, h('span', null, 'Название'), inp),
    actions: [{ label: 'Отмена' }, { label: 'Готово', primary: true, action: close => { closeFn = close; go(); } }] });
  setTimeout(() => inp.focus(), 50);
}

/** Окно своей колонки: название, тип и (для списка) варианты. def == null — новая. */
function colDialog(def, apply) {
  let name = def ? def.name : '', type = def ? def.type : 'text';
  let optText = def ? (def.options || []).map(o => o.name).join('\n') : '';
  const types = h('div', { class: 'rd-types', role: 'radiogroup', 'aria-label': 'Тип колонки' });
  const optBox = h('label', { class: 'rd-field' }, h('span', null, 'Варианты списка — по одному в строке'),
    h('textarea', { 'aria-label': 'Варианты списка', placeholder: 'Новое\nВ работе\nГотово', oninput: e => { optText = e.target.value; } }, optText));
  const draw = () => {
    fill(types, ...TYPES.map(([k, label, ic]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(type === k), class: type === k ? 'on' : '', onclick: () => { type = k; draw(); } }, icon(ic, 15), label)));
    optBox.hidden = type !== 'select';
  };
  draw();
  const inp = h('input', { type: 'text', value: name, maxlength: '60', placeholder: 'Название колонки', 'aria-label': 'Название колонки', oninput: e => { name = e.target.value; } });
  modal({
    title: def ? 'Свойства колонки' : 'Новая колонка', cls: 'dlg',
    body: [h('label', { class: 'rd-field' }, h('span', null, 'Название'), inp), h('div', { class: 'rd-field' }, h('span', null, 'Тип'), types), optBox],
    actions: [{ label: 'Отмена' }, { label: def ? 'Сохранить' : 'Добавить', primary: true, action: close => {
      const old = (def && def.options) || [];
      const names = [...new Set(optText.split('\n').map(x => x.trim()).filter(Boolean))].slice(0, 30);
      const options = type === 'select' ? names.map((n, i) => { const o = old.find(x => x.name === n); return o || { id: uid(), name: n, color: OPT_COLORS[i % OPT_COLORS.length] }; }) : [];
      apply({ id: def ? def.id : uid(), name: name.trim() || 'Колонка', type, options });
      close();
    } }],
  });
  setTimeout(() => inp.focus(), 50);
}

/** Окно «Колонки»: галочки и порядок. */
function columnsDialog(cols, ids, apply) {
  let order = [...ids];
  const list = h('div', { class: 'rd-cols' });
  const draw = () => {
    const off = cols.filter(c => !order.includes(c.id));
    const row = (c, i) => h('div', { class: 'rd-col-row', dataset: { id: c.id } },
      i != null ? h('span', { class: 'rd-grip', 'aria-hidden': 'true', title: 'Перетащить' }, icon('grip', 14)) : h('span', { class: 'rd-grip off' }),
      h('input', { type: 'checkbox', checked: i != null, 'aria-label': c.name, onchange: e => { order = e.target.checked ? [...order, c.id] : order.filter(x => x !== c.id); draw(); } }),
      h('span', { class: 'rd-col-name' }, c.name, h('small', { class: 'muted' }, ' · ' + ({ person: 'человек', unit: 'юнит', link: 'ссылка', check: 'галочка', checkbox: 'флажок', select: 'список', number: 'число', date: 'дата', wait: 'срок в очереди', status: 'статус', stage: 'этап', upd: 'апдейт', text: 'текст' }[c.type] || ''))));
    const shown = h('div', { class: 'rd-col-shown' }, ...order.map((id, i) => row(cols.find(c => c.id === id), i)));
    Sortable.create(shown, { handle: '.rd-grip', animation: 150, forceFallback: true, onEnd: e => { const [x] = order.splice(e.oldIndex, 1); order.splice(e.newIndex, 0, x); draw(); } });
    const groups = [...new Set(off.map(c => c.group))];
    fill(list,
      order.length > 0 && h('div', { class: 'rd-col-group' }, 'Показаны'),
      order.length > 0 && shown,
      ...groups.flatMap(g => [h('div', { class: 'rd-col-group' }, g), ...off.filter(c => c.group === g).map(c => row(c, null))]));
  };
  draw();
  modal({
    title: 'Колонки', cls: 'dlg',
    body: [h('p', { class: 'hint', style: { marginTop: 0 } }, 'Название приложения показывается всегда. Ссылки и поля берутся из карточек приложений, их список настраивается в «Настроить карточку».'), list],
    actions: [{ label: 'Отмена' }, { label: 'По умолчанию', action: close => { apply(null); close(); } }, { label: 'Сохранить', primary: true, action: close => { apply(order); close(); } }],
  });
}

const W = { stage: 112, upd: 130, person: 120, unit: 90, status: 130, link: 128, text: 160, check: 80, checkbox: 112, select: 150, number: 100, date: 130, wait: 150 };

export async function renderReady() {
  const main = $('#main');
  if (!isStaff() || ceoDefault()) { location.hash = '#/'; return; }
  const sheet = sheetOf();
  const tools = h('div', { class: 'row rd-tools', style: { gap: '8px' } });
  const body = h('div', { class: 'page ceo-page' }, skeleton());
  // на весь экран: кнопка справа внизу; Esc или та же кнопка возвращает обратно
  const FS_IN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';
  const FS_OUT = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 10l7-7M3 21l7-7M20 14h-6v6M4 10h6V4"/></svg>';
  // настоящий полноэкранный режим браузера: на экране остаётся только страница «Сводка»; Esc или та же кнопка — назад
  const isFs = () => document.fullscreenElement === main;
  const fsBtn = h('button', { class: 'rd-fs', type: 'button' });
  const paintFs = () => {
    fsBtn.innerHTML = isFs() ? FS_OUT : FS_IN;
    fsBtn.title = fsBtn['aria-label'] = isFs() ? 'Свернуть таблицу' : 'Таблица на весь экран';
  };
  fsBtn.onclick = () => { (isFs() ? document.exitFullscreen() : main.requestFullscreen()).catch(() => toast('Браузер не разрешил полноэкранный режим')); };
  const onFsChange = () => (fsBtn.isConnected ? paintFs() : document.removeEventListener('fullscreenchange', onFsChange));
  document.addEventListener('fullscreenchange', onFsChange);
  paintFs();
  fill(main, topbar([h('h1', null, 'Сводка')], [tools]), h('div', { class: 'view-body' }, body), fsBtn);
  let rows = [];
  let unit = '';
  let onlyReady = false;
  let groupNames = [];

  // личные данные таблицы лежат в prefs.readySheet; сохраняем с небольшой задержкой, чтобы набор текста не слал запрос на каждую букву
  let saveT = null;
  const persist = () => {
    const p = me(); if (p) p.prefs = { ...(p.prefs || {}), readySheet: sheet };
    clearTimeout(saveT);
    saveT = setTimeout(() => send('setMyPrefs', { personId: S.meId, prefs: { readySheet: sheet } }).catch(showErr), 300);
  };
  const setOrder = next => {
    const p = me(); if (p) p.prefs = { ...(p.prefs || {}), readyCols: next };
    send('setMyPrefs', { personId: S.meId, prefs: { readyCols: next } }).catch(showErr);
  };
  const setVal = (key, col, val, redraw) => {
    const o = (sheet.vals[key] = sheet.vals[key] || {});
    if (val === '' || val == null || val === false) delete o[col]; else o[col] = val;
    if (!Object.keys(o).length) delete sheet.vals[key];
    persist();
    if (redraw) draw();
  };
  const toggle = (list, x) => (list.includes(x) ? list.filter(y => y !== x) : [...list, x]);

  // колонки: вставка, группы
  const addCol = (def, at) => {
    sheet.cols.push(def);
    const ord = chosenIds(allColumns(sheet)).filter(x => x !== 'cu:' + def.id);
    ord.splice(at == null ? ord.length : at, 0, 'cu:' + def.id);
    setOrder(ord); persist(); draw();
  };
  const setGroup = (colId, name) => {
    const ord = chosenIds(allColumns(sheet));
    sheet.colGroup[colId] = name;
    const rest = ord.filter(x => x !== colId);
    const last = rest.reduce((a, x, i) => (sheet.colGroup[x] === name ? i : a), -1);
    rest.splice(last >= 0 ? last + 1 : ord.indexOf(colId), 0, colId);
    setOrder(rest); persist(); draw();
  };
  const dropGroupName = name => { if (!Object.values(sheet.colGroup).includes(name)) sheet.foldCols = sheet.foldCols.filter(x => x !== name); };
  const unGroup = colId => { const g = sheet.colGroup[colId]; delete sheet.colGroup[colId]; dropGroupName(g); persist(); draw(); };

  const colMenu = (anchor, c, ids, idx) => {
    const g = sheet.colGroup[c.id];
    const groups = [...new Set(Object.values(sheet.colGroup))].filter(x => x !== g);
    menu(anchor, [
      { title: c.name },
      c.custom && { label: 'Свойства и тип…', icon: 'sliders', action: () => colDialog(c.def, def => { sheet.cols = sheet.cols.map(x => (x.id === def.id ? def : x)); persist(); draw(); }) },
      { label: 'Вставить колонку слева', icon: 'plus', action: () => colDialog(null, def => addCol(def, idx)) },
      { label: 'Вставить колонку справа', icon: 'plus', action: () => colDialog(null, def => addCol(def, idx + 1)) },
      { sep: true },
      { title: 'Группа колонок' },
      g && { label: `Убрать из группы «${g}»`, icon: 'x', action: () => unGroup(c.id) },
      ...groups.map(x => ({ label: `В группу «${x}»`, icon: 'layers', action: () => setGroup(c.id, x) })),
      { label: 'В новую группу…', icon: 'layers', action: () => askName('Новая группа колонок', '', n => setGroup(c.id, n)) },
      { sep: true },
      c.custom
        ? { label: 'Удалить колонку', icon: 'trash', danger: true, action: async () => {
          if (!(await confirmDlg(`Колонка «${c.name}» и введённые в неё значения будут удалены.`, { ok: 'Удалить', danger: true, title: 'Удалить колонку?' }))) return;
          const id = c.def.id;
          sheet.cols = sheet.cols.filter(x => x.id !== id);
          for (const k of Object.keys(sheet.vals)) setVal(k, id, '', false);
          const g2 = sheet.colGroup['cu:' + id]; delete sheet.colGroup['cu:' + id]; dropGroupName(g2);
          setOrder(ids.filter(x => x !== c.id)); persist(); draw();
        } }
        : { label: 'Скрыть колонку', icon: 'eye', action: () => { setOrder(ids.filter(x => x !== c.id)); draw(); } },
    ], { align: 'left' });
  };
  const bandMenu = (anchor, name) => menu(anchor, [
    { title: `Группа «${name}»` },
    { label: 'Переименовать', icon: 'edit', action: () => askName('Название группы', name, n => {
      for (const k in sheet.colGroup) if (sheet.colGroup[k] === name) sheet.colGroup[k] = n;
      sheet.foldCols = sheet.foldCols.map(x => (x === name ? n : x)); persist(); draw();
    }) },
    { label: 'Разгруппировать', icon: 'x', action: () => {
      for (const k in sheet.colGroup) if (sheet.colGroup[k] === name) delete sheet.colGroup[k];
      dropGroupName(name); persist(); draw();
    } },
  ], { align: 'left' });

  // строки
  const addRow = () => {
    const id = uid();
    sheet.rows.push({ id, name: 'Новая строка' }); persist(); draw();
    setTimeout(() => { const el = body.querySelector(`[data-row="${id}"] input`); if (el) { el.focus(); el.select(); } }, 30);
  };
  const rowMenu = (anchor, r) => menu(anchor, r.free
    ? [{ label: 'Удалить строку', icon: 'trash', danger: true, action: () => { sheet.rows = sheet.rows.filter(x => x.id !== r.freeId); delete sheet.vals[r.key]; persist(); draw(); } }]
    : [{ label: 'Открыть приложение', icon: 'link', action: () => openAppById(r.appId, load) },
      { label: 'Скрыть строку', icon: 'eye', action: () => { sheet.hide = [...sheet.hide, r.appId]; persist(); draw(); toast('Строка скрыта — вернуть можно в плашке «Скрыто»'); } }], { align: 'left' });
  const groupName = r => {
    switch (sheet.group) {
      case 'unit': { const u = unitById(r.unitId); return u ? u.name : 'Без юнита'; }
      case 'status': { const st = S.appStatuses.find(x => x.id === r.status); return st ? st.name : 'Без статуса'; }
      case 'queue': return r.free ? 'Свои строки' : r.ready ? 'Ждут разработки' : 'Остальные';
      case 'designer': { const p = personById((r.stages.design || {}).assigneeId); return p ? p.name : 'Без дизайнера'; }
      default: return '';
    }
  };

  const draw = () => {
    const cols = allColumns(sheet);
    const ids = chosenIds(cols);
    const shown = ids.map(id => cols.find(c => c.id === id));
    const apps = rows.filter(r => !sheet.hide.includes(r.appId)).map(r => ({ ...r, key: r.appId }));
    const hidden = rows.filter(r => sheet.hide.includes(r.appId));
    const free = sheet.rows.map(f => ({ free: true, key: 'r:' + f.id, freeId: f.id, appName: f.name, stages: {}, links: {}, info: {}, checks: null, ready: false }));
    const inUnit = unit ? apps.filter(r => r.unitId === unit) : apps;
    const queue = inUnit.filter(r => r.ready);
    const list = [...(onlyReady ? queue : inUnit), ...(unit || onlyReady ? [] : free)];
    const units = S.units.filter(u => !u.archived && rows.some(r => r.unitId === u.id));

    // строки по группам
    let blocks = [{ name: '', rs: list }];
    if (sheet.group) {
      const m = new Map();
      for (const r of list) { const n = groupName(r); if (!m.has(n)) m.set(n, []); m.get(n).push(r); }
      blocks = [...m].map(([name, rs]) => ({ name, rs }));
      if (sheet.group === 'queue') blocks.sort((a, b) => (b.name === 'Ждут разработки') - (a.name === 'Ждут разработки'));
    }
    groupNames = blocks.map(b => b.name);

    // колонки: свёрнутая группа — одна узкая колонка
    const items = [];
    for (const c of shown) {
      const g = sheet.colGroup[c.id];
      if (g && sheet.foldCols.includes(g)) { const last = items[items.length - 1]; if (last && last.fold === g) last.n++; else items.push({ fold: g, n: 1 }); } else items.push({ col: c, g });
    }
    const widths = items.map(it => (it.col ? W[it.col.type] || 110 : 64));
    const template = `240px ${widths.map(w => w + 'px').join(' ')} 44px`;
    const total = 240 + widths.reduce((a, b) => a + b, 0) + 44;
    const rowStyle = { gridTemplateColumns: template, width: total + 'px' };

    const groupLabel = (GROUPS.find(x => x[0] === sheet.group) || [])[1];
    fill(tools,
      units.length > 1 && h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Юнит' },
        [['', 'Все'], ...units.map(u => [u.id, u.name, u.color])].map(([id, name, color]) => h('button', { class: unit === id ? 'on' : '', role: 'radio', 'aria-checked': String(unit === id), onclick: () => { unit = id; draw(); } },
          color && h('span', { class: 'dot', style: { background: color } }), name))),
      h('button', { class: 'btn', type: 'button', 'aria-haspopup': 'menu', onclick: e => menu(e.currentTarget, [
        { title: 'Группировать строки по' },
        ...GROUPS.map(([k, name]) => ({ label: name, icon: sheet.group === k ? 'check' : 'blank', action: () => { sheet.group = k; persist(); draw(); } })),
        sheet.group && { sep: true },
        sheet.group && { label: 'Свернуть все группы', icon: 'blank', action: () => { sheet.foldRows = [...new Set([...sheet.foldRows, ...groupNames.map(n => sheet.group + ':' + n)])]; persist(); draw(); } },
        sheet.group && { label: 'Развернуть все группы', icon: 'blank', action: () => { sheet.foldRows = sheet.foldRows.filter(k => !k.startsWith(sheet.group + ':')); persist(); draw(); } },
      ], { align: 'left' }) }, icon('layers', 14), sheet.group ? `Группировка: ${groupLabel}` : 'Группировка'),
      h('button', { class: 'btn', onclick: () => columnsDialog(cols, ids, next => {
        setOrder(next);
        if (!next) toast('Колонки по умолчанию');
        draw();
      }) }, icon('sliders', 14), 'Колонки'),
      h('button', { class: 'btn', type: 'button', onclick: addRow }, icon('plus', 14), 'Строка'));

    const late = queue.filter(r => daysSince(r.readySince) >= 7).length;
    const ctx = { reload: load, set: setVal };
    const moreBtn = r => h('button', { class: 'icon-btn sm rd-more', type: 'button', 'aria-haspopup': 'menu', 'aria-label': 'Действия со строкой', title: 'Действия со строкой', onclick: e => { e.stopPropagation(); rowMenu(e.currentTarget, r); } }, icon('more', 15));
    const rowEl = r => h('div', { class: 'rd-row' + (r.ready ? ' queued' : ''), role: 'row', style: rowStyle },
      r.free
        ? h('div', { class: 'rd-app', dataset: { row: r.freeId } }, h('span', { class: 'rd-free-ic' }, icon('rows', 13)),
          h('input', { class: 'rd-in', type: 'text', value: r.appName, maxlength: '80', 'aria-label': 'Название строки',
            onchange: e => { const f = sheet.rows.find(x => x.id === r.freeId); if (f) { f.name = e.target.value.trim() || 'Без названия'; persist(); } },
            onkeydown: e => { if (e.key === 'Enter') e.target.blur(); } }), moreBtn(r))
        : h('div', { class: 'rd-app' },
          h('button', { class: 'rd-open', type: 'button', title: 'Открыть приложение', onclick: () => openAppById(r.appId, load) },
            appIcon({ name: r.appName, iconUrl: r.iconUrl, color: r.color }, 'xs'), h('span', { class: 'rd-app-name' }, r.appName)), moreBtn(r)),
      items.map(it => (it.col ? cell(it.col, r, ctx) : h('span', { class: 'rd-fold' }))),
      h('span'));

    // шапка-полоса групп колонок
    const runs = [];
    for (let k = 0; k < items.length;) {
      const g = items[k].fold || items[k].g;
      if (!g) { runs.push({ span: 1 }); k++; continue; }
      let n = 1;
      while (k + n < items.length && (items[k + n].fold || items[k + n].g) === g) n++;
      runs.push({ name: g, span: n, folded: !!items[k].fold }); k += n;
    }
    const band = items.some(it => it.fold || it.g) && h('div', { class: 'rd-row rd-band', role: 'row', style: rowStyle }, h('span'),
      runs.map(run => (!run.name ? h('span') : h('div', { class: 'rd-gb' + (run.folded ? ' folded' : ''), style: { gridColumn: `span ${run.span}` } },
        h('button', { type: 'button', title: run.folded ? 'Развернуть группу' : 'Свернуть группу', 'aria-expanded': String(!run.folded), onclick: () => { sheet.foldCols = toggle(sheet.foldCols, run.name); persist(); draw(); } },
          h('span', { class: 'rd-fold-ic' }, icon('chevron', 12)), h('span', null, run.name)),
        !run.folded && h('button', { type: 'button', 'aria-haspopup': 'menu', 'aria-label': 'Действия с группой', onclick: e => { e.stopPropagation(); bandMenu(e.currentTarget, run.name); } }, icon('more', 14))))),
      h('span'));

    const head = h('div', { class: 'rd-row rd-head', role: 'row', style: rowStyle }, h('span', null, 'Приложение'),
      items.map(it => (it.col
        ? h('span', { title: it.col.name }, h('button', { class: 'rd-hbtn', type: 'button', 'aria-haspopup': 'menu', onclick: e => { e.stopPropagation(); colMenu(e.currentTarget, it.col, ids, shown.indexOf(it.col)); } }, h('span', null, it.col.name), icon('chevron', 12)))
        : h('span', { class: 'rd-fold', title: it.fold }))),
      h('span', { class: 'rd-plus' }, h('button', { class: 'rd-hbtn', type: 'button', title: 'Добавить колонку', 'aria-label': 'Добавить колонку', onclick: () => colDialog(null, def => addCol(def)) }, icon('plus', 15))));

    const lines = blocks.flatMap(b => {
      if (!sheet.group) return b.rs.map(rowEl);
      const key = sheet.group + ':' + b.name, folded = sheet.foldRows.includes(key);
      return [h('div', { class: 'rd-grp' + (folded ? ' folded' : ''), style: { width: total + 'px' } },
        h('button', { type: 'button', 'aria-expanded': String(!folded), onclick: () => { sheet.foldRows = toggle(sheet.foldRows, key); persist(); draw(); } },
          h('span', { class: 'rd-fold-ic' }, icon('chevron', 13)), b.name, h('small', null, String(b.rs.length)))), ...(folded ? [] : b.rs.map(rowEl))];
    });

    const old = body.querySelector('.rd-table');
    const pos = old ? [old.scrollLeft, old.scrollTop] : null;
    fill(body,
      h('div', { class: 'rd-sum' },
        h('button', { class: 'rd-queue' + (!onlyReady ? ' on' : ''), type: 'button', 'aria-pressed': String(!onlyReady), title: 'Показать все приложения', onclick: () => { onlyReady = false; draw(); } },
          icon('rows', 13), `Все приложения: ${inUnit.length}`),
        h('button', { class: 'rd-queue' + (onlyReady ? ' on' : ''), type: 'button', 'aria-pressed': String(onlyReady), title: 'Дизайн закрыт, разработка ещё не начата', onclick: () => { onlyReady = !onlyReady; draw(); } },
          icon('layers', 13), `Ждут разработки: ${queue.length}`, late > 0 && h('span', { class: 'rd-late' }, ` · дольше недели ${late}`)),
        hidden.length > 0 && h('button', { class: 'rd-queue', type: 'button', 'aria-haspopup': 'menu', title: 'Строки, скрытые из сводки', onclick: e => menu(e.currentTarget, [
          { title: 'Скрытые строки' },
          ...hidden.map(r => ({ label: r.appName, icon: 'eye', action: () => { sheet.hide = sheet.hide.filter(x => x !== r.appId); persist(); draw(); } })),
          { sep: true }, { label: 'Показать все', icon: 'eye', action: () => { sheet.hide = []; persist(); draw(); } }], { align: 'left' }) },
        icon('eye', 13), `Скрыто: ${hidden.length}`)),
      list.length
        ? h('div', { class: 'table-wrap rd-table', role: 'table' }, band, head, lines,
          h('button', { class: 'rd-addrow', type: 'button', style: { width: total + 'px' }, onclick: addRow }, icon('plus', 14), 'Добавить строку'))
        : h('div', { class: 'card-box empty-state' }, h('h2', null, onlyReady ? 'Очередь пуста' : 'Приложений пока нет'),
          h('p', { class: 'muted' }, onlyReady ? 'Здесь появятся приложения, у которых дизайн закрыт, а разработка ещё не началась.' : 'Они появятся здесь, как только вы создадите приложение.'),
          !onlyReady && isDev() && h('button', { class: 'btn primary', onclick: () => navigate({ view: 'dev' }) }, icon('code', 14), 'Режим разработчика → Демо-процесс')));
    if (pos) { const nw = body.querySelector('.rd-table'); if (nw) { nw.scrollLeft = pos[0]; nw.scrollTop = pos[1]; } }
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
