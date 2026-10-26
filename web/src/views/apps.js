/**
 * Приложения (Tasks 2.0): список приложений — юнит, статус, что сейчас в работе (запрос CEO и его этапы).
 * Клик — карточка приложения справа: статус, юнит, работы; CEO ставит задачи PM, PM раскладывает по флоу и передаёт в релиз.
 */
import { S, isSuper, isStaff, personById, unitById, appStatusById, REQUEST_TYPES, LS, plural, fmtDate, PALETTE } from '../state.js';
import { $, h, icon, avatar, topbar, showErr, fill, modal, field, toast, menu } from '../ui.js';
import { call, send } from '../api.js';
import { currentView } from '../router.js';
import { peekTask } from './task.js';
import { fillDemo } from './home.js';
import { mode } from '../data.js';

const units = () => S.units.filter(u => !u.archived).sort((a, b) => (a.order || 0) - (b.order || 0));
const pmsOf = unitId => ((unitById(unitId) || {}).members || []).map(personById).filter(p => p && p.active && p.access === 'moderator');
/** Управляет юнитом: CEO — любым, PM — своим (то же правило в базе). */
const canManage = unitId => isSuper() || (isStaff() && ((unitById(unitId) || {}).members || []).includes(S.meId));

const STAGE_STATE = {
  done: { label: 'готово', icon: 'check' },
  progress: { label: 'в работе', icon: 'progress' },
  blocked: { label: 'ждёт предыдущих', icon: 'lock' },
  todo: { label: 'не начато', icon: 'circle' },
};
const stageState = s => (s.done ? 'done' : s.blocked ? 'blocked' : s.kind === 'todo' ? 'todo' : 'progress');

export async function renderApps() {
  const body = h('div', { class: 'page' }, h('div', { class: 'boot' }, h('span', { class: 'spinner' }), 'Загрузка…'));
  const tools = h('div', { class: 'row', style: { gap: '8px' } });
  fill($('#main'), topbar([h('h1', null, 'Приложения')], [tools]), h('div', { class: 'view-body' }, body));

  let apps;
  const load = async () => {
    apps = await call('listApps', {});
    S.apps = apps.map(({ requests, active, ...a }) => a);
  };
  try { await load(); } catch (e) { return showErr(e); }
  if (currentView() !== 'apps') return;

  let unitFilter = units().some(u => u.id === LS.get('appsUnit', '')) ? LS.get('appsUnit', '') : '';
  const reload = () => load().then(draw).catch(showErr);
  const draw = () => {
    const list = units();
    fill(tools,
      list.length > 1 && h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Юнит' },
        [['', 'Все'], ...list.map(u => [u.id, u.name])].map(([id, name]) => h('button', {
          class: unitFilter === id ? 'on' : '', role: 'tab', 'aria-selected': String(unitFilter === id),
          onclick: () => { unitFilter = id; LS.set('appsUnit', id); draw(); },
        }, name))),
      isSuper() && list.length > 0 && h('button', { class: 'btn primary sm', onclick: () => openCreateApp(reload) }, icon('plus', 14), 'Новое приложение'));
    const shown = apps.filter(a => !unitFilter || a.unitId === unitFilter);
    fill(body, shown.length ? appTable(shown, reload) : emptyApps(reload));
  };
  draw();
}

function emptyApps(reload) {
  return h('div', { class: 'card-box empty-state' },
    h('h2', null, 'Приложений пока нет'),
    isSuper()
      ? [h('p', { style: { margin: 0 } }, 'Создайте приложение — запрос «New App» сразу уйдёт PM его юнита.'),
        h('div', { class: 'row', style: { justifyContent: 'center', gap: '8px' } },
          units().length
            ? h('button', { class: 'btn primary', onclick: () => openCreateApp(reload) }, icon('plus', 15), 'Новое приложение')
            : h('span', { class: 'muted' }, 'Сначала нужен юнит (Gold, RF, MVP…) — режим Admin → Воркспейсы → +.'),
          mode === 'local' && !units().length && h('button', { class: 'btn', onclick: e => fillDemo(e.currentTarget) }, icon('layers', 15), 'Заполнить демо-данными'))]
      : h('p', { style: { margin: 0 } }, 'Здесь появятся приложения ваших юнитов.'));
}

/** Строки с подписанными колонками: приложение · юнит · статус · сейчас в работе · PM. */
function appTable(apps, reload) {
  return h('div', { class: 'ap-list' },
    h('div', { class: 'ap-row ap-head', 'aria-hidden': 'true' },
      h('span', null, 'Приложение'), h('span', null, 'Юнит'), h('span', null, 'Статус'), h('span', null, 'Сейчас в работе'), h('span', null, 'PM'), h('span')),
    apps.map(a => {
      const u = unitById(a.unitId);
      const st = appStatusById(a.status);
      const req = a.requests.find(r => !r.done) || null;
      const pm = req ? personById(req.assigneeId) : null;
      return h('button', { class: 'ap-row', onclick: () => openAppPanel(a, reload) },
        h('span', { class: 'ap-name' }, appIcon(a), h('b', null, a.name), a.isTest && h('span', { class: 'test-tag' }, 'тест')),
        h('span', { class: 'ap-unit' }, u ? [h('span', { class: 'unit-dot', style: { background: u.color, margin: 0 } }), u.name] : h('span', { class: 'muted' }, '—')),
        h('span', null, statusPill(st)),
        h('span', { class: 'ap-work' }, req ? workSummary(req) : h('span', { class: 'muted' }, 'Нет открытых задач')),
        h('span', null, pm ? avatar(pm, 'sm') : h('span', { class: 'muted' }, '—')),
        icon('chevron', 15));
    }));
}

const appIcon = (a, size = 'sm') => h('span', { class: 'uc-icon ' + size, style: { background: a.color || PALETTE[0] } }, a.name.slice(0, 2).toUpperCase());
const statusPill = st => (st ? h('span', { class: 'st-pill', style: { '--sc': st.color } }, h('span', { class: 'dot' }), st.name) : h('span', { class: 'muted' }, '—'));

/** Тип запроса, этапы точками (с подписью состояния) и прогресс. */
function workSummary(r) {
  return [
    h('span', { class: 'ap-type' }, REQUEST_TYPES[r.type] || 'Задача'),
    r.stages.length
      ? h('span', { class: 'stage-dots', 'aria-label': `Этапы: ${r.stages.filter(s => s.done).length} из ${r.stages.length} готово` },
        r.stages.map(s => h('span', { class: 'sd sd-' + stageState(s), title: `${s.title} — ${STAGE_STATE[stageState(s)].label}` })))
      : h('span', { class: 'muted' }, 'ждёт PM'),
    r.stages.length > 0 && h('span', { class: 'muted ap-pct' }, r.progress + '%'),
  ];
}

/* ---------- карточка приложения ---------- */

export function openAppPanel(a, onChange) {
  const root = $('#panel-root');
  const close = () => { document.removeEventListener('keydown', onKey, true); fill(root); };
  const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.modal') && !document.querySelector('.menu')) { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  const body = h('div', { class: 'up-body' });
  const refresh = async () => {
    try {
      const list = await call('listApps', {});
      const fresh = list.find(x => x.id === a.id);
      if (!fresh) return close();
      a = fresh;
      draw();
      if (onChange) onChange();
    } catch (e) { showErr(e); }
  };
  const save = patch => send('updateApp', { id: a.id, ...patch }).then(refresh).catch(showErr);

  const draw = () => {
    const u = unitById(a.unitId);
    const ceo = isSuper(), manage = canManage(a.unitId);
    const statusSel = h('select', { class: 'inp', 'aria-label': 'Статус приложения', disabled: !manage, onchange: e => save({ status: e.target.value }) },
      S.appStatuses.map(s => h('option', { value: s.id, selected: s.id === a.status }, s.name)));
    const unitSel = h('select', { class: 'inp', 'aria-label': 'Юнит', disabled: !ceo, onchange: e => save({ unitId: e.target.value }) },
      units().map(x => h('option', { value: x.id, selected: x.id === a.unitId }, x.name)));
    const open = a.requests.filter(r => !r.done), closed = a.requests.filter(r => r.done);
    fill(body,
      h('section', { class: 'ap-props' },
        field('Статус', statusSel), field('Юнит', ceo ? unitSel : h('div', { class: 'ap-static' }, u ? u.name : '—'))),
      h('section', null,
        h('div', { class: 'up-head' }, h('h3', null, 'Работы'),
          ceo && h('button', { class: 'btn ghost sm', onclick: e => requestMenu(e.currentTarget, a, refresh) }, icon('plus', 14), 'Поставить задачу')),
        open.length ? open.map(r => requestCard(r, refresh)) : h('p', { class: 'muted' }, 'Открытых задач нет.')),
      closed.length > 0 && h('section', null,
        h('div', { class: 'up-head' }, h('h3', null, 'Сделано')),
        closed.map(r => h('button', { class: 'ap-done-row', onclick: () => peekTask(r.unitId, r.id) },
          icon('check', 14), h('span', { class: 'ap-type' }, REQUEST_TYPES[r.type] || 'Задача'), h('span', { class: 'ap-done-title' }, r.title)))));
  };
  draw();
  fill(root,
    h('div', { class: 'panel-backdrop', onclick: close }),
    h('aside', { class: 'panel unit-panel', role: 'dialog', 'aria-label': a.name },
      h('div', { class: 'panel-head' },
        appIcon(a), h('b', null, a.name), a.isTest && h('span', { class: 'test-tag' }, 'тест'), h('span', { class: 'spacer' }),
        h('button', { class: 'icon-btn', title: 'Закрыть', onclick: close }, icon('x', 18))),
      body));
}

/** Запрос CEO: тип, название, PM; этапы с состоянием; действия PM — «Разложить по флоу», «Передать в релиз». */
function requestCard(r, refresh) {
  const pm = personById(r.assigneeId);
  const manage = canManage(r.unitId);
  return h('div', { class: 'rq' },
    h('div', { class: 'rq-head' },
      h('span', { class: 'ap-type' }, REQUEST_TYPES[r.type] || 'Задача'),
      h('button', { class: 'link-btn rq-title', onclick: () => peekTask(r.unitId, r.id) }, r.title),
      h('span', { class: 'spacer' }),
      r.dueDate && h('span', { class: 'muted rq-due' }, icon('calendar', 12), fmtDate(r.dueDate)),
      pm ? avatar(pm, 'sm') : h('span', { class: 'warn-text rq-nopm' }, 'нет PM')),
    r.stages.length
      ? [h('div', { class: 'progress' }, h('div', { style: { width: r.progress + '%' } })),
        h('div', { class: 'rq-stages' }, r.stages.map(s => stageRow(r, s, manage, refresh)))]
      : h('div', { class: 'rq-empty' },
        h('span', { class: 'muted' }, 'PM ещё не разложил задачу по этапам.'),
        manage && h('button', { class: 'btn primary sm', onclick: () => decompose(r.id).then(refresh) }, icon('tree', 13), 'Разложить по флоу')));
}

function stageRow(r, s, manage, refresh) {
  const state = stageState(s);
  const p = personById(s.assigneeId);
  const releaseReady = s.step === 'release' && !s.assigneeId && !s.blocked && !s.done;
  return h('div', { class: 'rq-stage st-' + state },
    h('span', { class: 'rq-ic', title: STAGE_STATE[state].label }, icon(STAGE_STATE[state].icon, 13)),
    h('button', { class: 'link-btn rq-stitle', onclick: () => peekTask(r.unitId, s.id) }, s.title.split(' · ')[0]),
    h('span', { class: 'muted rq-state' }, STAGE_STATE[state].label),
    releaseReady && manage
      ? h('button', { class: 'btn primary sm', onclick: () => sendRelease(s.id).then(refresh) }, icon('rocket', 13), 'Передать в релиз')
      : p ? avatar(p, 'sm') : h('span', { class: 'muted rq-who' }, s.step === 'release' ? 'RM' : '—'));
}

/** PM: разложить запрос по флоу (этапы с зависимостями и исполнителями). */
export async function decompose(requestId) {
  try {
    const made = await send('decomposeRequest', { taskId: requestId });
    toast(`Создано ${made.length} ${plural(made.length, ['этап', 'этапа', 'этапов'])}`);
  } catch (e) { showErr(e); }
}

/** PM: передать этап «Релиз» релиз-менеджеру юнита (когда закрыты все этапы). */
export async function sendRelease(stageId) {
  try {
    const t = await send('sendToRelease', { taskId: stageId });
    toast('Передано в релиз: ' + ((personById(t.assigneeId) || {}).name || 'RM'));
  } catch (e) { showErr(e); }
}

/* ---------- создание ---------- */

function requestMenu(anchor, a, done) {
  menu(anchor, [
    { title: 'Задача PM юнита' },
    { label: 'Апдейт', icon: 'refresh', action: () => openCreateRequest(a, 'update', done) },
    { label: 'Другая задача', icon: 'plus', action: () => openCreateRequest(a, 'other', done) },
  ]);
}

/** Выбор PM юнита: по умолчанию — первый PM; пусто — предупреждение (запрос повиснет без исполнителя). */
function pmPicker(unitId) {
  const sel = h('select', { class: 'inp', 'aria-label': 'PM' });
  const draw = id => {
    const pms = pmsOf(id);
    fill(sel, pms.length ? pms.map(p => h('option', { value: p.id }, p.name)) : h('option', { value: '' }, 'В юните нет PM — добавьте в Структуре'));
  };
  draw(unitId);
  return { el: sel, setUnit: draw };
}

export function openCreateApp(onDone) {
  const list = units();
  const name = h('input', { class: 'inp', maxlength: 120, placeholder: 'Например, Sleep Sounds' });
  const unit = h('select', { class: 'inp' }, list.map(u => h('option', { value: u.id }, u.name)));
  const pm = pmPicker(list[0] && list[0].id);
  unit.addEventListener('change', () => pm.setUnit(unit.value));
  const due = h('input', { class: 'inp', type: 'date' });
  const desc = h('textarea', { class: 'inp', rows: 3, placeholder: 'Что за приложение, рынки, важное для команды' });
  modal({
    title: 'Новое приложение',
    body: [
      field('Название', name),
      h('div', { class: 'grid2' }, field('Юнит', unit), field('PM', pm.el, 'Получит задачу «New App»')),
      field('Срок', due),
      field('Описание', desc),
    ],
    actions: [{ label: 'Отмена' }, {
      label: 'Создать', primary: true,
      action: async close => {
        if (!name.value.trim()) { name.focus(); return; }
        await send('createApp', { name: name.value, unitId: unit.value, pmId: pm.el.value, dueDate: due.value, description: desc.value });
        close();
        toast(`«${name.value.trim()}» создано — задача ушла PM`);
        if (onDone) onDone();
      },
    }],
  });
}

function openCreateRequest(a, type, onDone) {
  const title = h('input', { class: 'inp', maxlength: 500, placeholder: type === 'update' ? 'Например, Апдейт 1.2: виджет' : 'Что сделать' });
  const pm = pmPicker(a.unitId);
  const due = h('input', { class: 'inp', type: 'date' });
  const desc = h('textarea', { class: 'inp', rows: 3 });
  modal({
    title: (REQUEST_TYPES[type] || 'Задача') + ' · ' + a.name,
    body: [field('Название', title), h('div', { class: 'grid2' }, field('PM', pm.el), field('Срок', due)), field('Описание', desc)],
    actions: [{ label: 'Отмена' }, {
      label: 'Поставить', primary: true,
      action: async close => {
        await send('createRequest', { appId: a.id, type, title: title.value, pmId: pm.el.value, dueDate: due.value, description: desc.value });
        close();
        toast('Задача ушла PM');
        if (onDone) onDone();
      },
    }],
  });
}
