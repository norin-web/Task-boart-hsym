/**
 * «Отслеживаю» на дашборде CEO: выбранные приложения и задачи со статусом «сейчас». Блок сам обновляется каждые 20 секунд
 * (и при возвращении на вкладку), изменившаяся строка подсвечивается. Список — у каждого свой (prefs.watch: [{ t: app | task, id, unitId }]).
 * Добавить — кнопкой в блоке (поиск по приложениям и задачам) или «⋯» → «Отслеживать» в карточке приложения / задачи.
 */
import { S, me, personById, appStatusById, relTime, fmtDate, todayStr } from '../state.js';
import { h, icon, avatar, fill, modal, toast, showErr } from '../ui.js';
import { call, send } from '../api.js';

const REFRESH = 20e3;

export const watchList = () => (((me() || {}).prefs || {}).watch || []);
export const isWatched = (t, id) => watchList().some(x => x.t === t && x.id === id);
function setWatch(list) {
  const p = me();
  if (p) p.prefs = { ...(p.prefs || {}), watch: list };
  return send('setMyPrefs', { personId: S.meId, prefs: { watch: list } }).catch(showErr);
}
/** Добавить / убрать из «Отслеживаю». */
export function toggleWatch(t, id, unitId, name) {
  const on = isWatched(t, id);
  setWatch(on ? watchList().filter(x => !(x.t === t && x.id === id)) : [...watchList(), { t, id, unitId: unitId || '' }]);
  toast(on ? `«${name}» больше не отслеживается` : `«${name}» — в «Отслеживаю» на дашборде`);
  document.dispatchEvent(new CustomEvent('tasks:watch'));
}

/** Короткий «снимок» строки — чтобы заметить изменение при обновлении. */
const snapApp = a => { const r = (a.requests || []).find(x => !x.done); const cur = r && r.stages.find(s => !s.done && !s.blocked); return [a.status, a.storeOk, r && r.id, cur && cur.id, r && r.progress].join('|'); };
const snapTask = t => [t.status, t.assigneeId, t.dueDate].join('|');

/**
 * Блок «Отслеживаю». apps — уже загруженные приложения дашборда (listApps), openApp / openTask — открыть карточку.
 */
export function watchBlock(apps, { openApp, openTask, appIcon, appStatusCell, stageDots }) {
  const box = h('section', { class: 'watch' });
  const prev = new Map();
  let appsNow = apps, tasks = [], at = Date.now(), timer = null, busy = false;

  async function refresh(force) {
    if (busy || (!force && document.hidden)) return;
    if (!document.body.contains(box)) { clearInterval(timer); document.removeEventListener('tasks:watch', onChange); document.removeEventListener('visibilitychange', onVis); return; }
    busy = true;
    try {
      const w = watchList();
      const taskIds = w.filter(x => x.t === 'task').map(x => x.id);
      [appsNow, tasks] = await Promise.all([
        w.some(x => x.t === 'app') ? call('listApps', {}) : Promise.resolve(appsNow),
        taskIds.length ? call('queryTasks', { ids: taskIds }) : Promise.resolve([]),
      ]);
      at = Date.now();
      draw();
    } catch { /* сеть моргнула — следующая попытка по таймеру */ } finally { busy = false; }
  }
  const onChange = () => refresh(true);
  const onVis = () => { if (!document.hidden) refresh(false); };

  function rowApp(a) {
    const r = (a.requests || []).find(x => !x.done);
    const cur = r && (r.stages.find(s => !s.done && !s.blocked && s.kind !== 'todo') || r.stages.find(s => !s.done && !s.blocked));
    return [
      appIcon(a, 'sm'),
      h('span', { class: 'w-main' }, h('b', null, a.name), h('small', { class: 'muted' }, r ? r.title : 'Открытых работ нет')),
      h('span', null, appStatusCell(appStatusById(a.status), a)),
      h('span', { class: 'w-now' }, r ? [h('b', null, cur ? cur.title.split(' · ')[0] : r.stages.length ? 'Релиз' : 'ждёт PM'), r.stages.length > 0 && stageDots(r.stages)] : h('span', { class: 'muted' }, '—')),
      h('span', { class: 'muted w-at' }, a.lastActivity ? relTime(a.lastActivity) : '—'),
    ];
  }
  function rowTask(t) {
    const late = t.dueDate && t.dueDate < todayStr() && t.statusKind !== 'done';
    const who = personById(t.assigneeId);
    return [
      h('span', { class: 'key-badge w-key' }, t.key),
      h('span', { class: 'w-main' }, h('b', null, t.title), h('small', { class: 'muted' }, t.unit ? t.unit.name : '')),
      h('span', { class: 'w-st' }, h('span', { class: 'dot', style: { background: t.statusColor || 'var(--muted)' } }), t.statusName),
      h('span', { class: 'w-now' }, who ? [avatar(who, 'sm'), h('span', null, who.name)] : h('span', { class: 'muted' }, 'без исполнителя'),
        t.dueDate && h('span', { class: late ? 'danger-text' : 'muted' }, ' · ' + fmtDate(t.dueDate))),
      h('span', { class: 'muted w-at' }, t.updatedAt ? relTime(t.updatedAt) : '—'),
    ];
  }

  function draw() {
    const w = watchList();
    const items = w.map(x => {
      if (x.t === 'app') { const a = appsNow.find(y => y.id === x.id); return a && { x, key: 'a:' + a.id, snap: snapApp(a), cells: rowApp(a), open: () => openApp(a.id), name: a.name }; }
      const t = tasks.find(y => y.id === x.id);
      return t && { x, key: 't:' + t.id, snap: snapTask(t), cells: rowTask(t), open: () => openTask(t.unitId, t.id), name: t.title };
    }).filter(Boolean);
    const gone = w.length - items.length;
    fill(box,
      h('div', { class: 'section-head' },
        h('h2', null, 'Отслеживаю', items.length > 0 && h('span', { class: 'muted sec-n' }, items.length)),
        h('span', { class: 'w-live muted', title: 'Обновляется само каждые 20 секунд' }, h('span', { class: 'w-dot' }), 'обновлено ' + relTime(new Date(at).toISOString())),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn ghost sm', onclick: () => openWatchPicker(appsNow, () => refresh(true)) }, icon('plus', 14), 'Добавить')),
      items.length
        ? h('div', { class: 'card-box w-list' }, items.map(it => {
          const changed = prev.has(it.key) && prev.get(it.key) !== it.snap;
          prev.set(it.key, it.snap);
          return h('div', { class: 'w-row' + (it.x.t === 'task' ? ' task' : '') + (changed ? ' changed' : ''), title: changed ? 'Только что изменилось' : '' },
            h('button', { class: 'w-open', onclick: it.open }, it.cells),
            h('button', { class: 'icon-btn sm w-x', title: 'Не отслеживать', onclick: () => toggleWatch(it.x.t, it.x.id, it.x.unitId, it.name) }, icon('x', 14)));
        }), gone > 0 && h('p', { class: 'muted w-gone' }, `Ещё ${gone} — удалены, в архиве или нет доступа`))
        : h('div', { class: 'card-box empty-state sm' },
          h('p', { class: 'muted', style: { margin: 0 } }, 'Добавьте приложения и задачи, за которыми следите, — статус и текущий этап будут здесь и обновляются сами.'),
          h('button', { class: 'btn sm', onclick: () => openWatchPicker(appsNow, () => refresh(true)) }, icon('plus', 14), 'Добавить')));
  }

  draw();
  refresh(true);
  timer = setInterval(() => refresh(false), REFRESH);
  document.addEventListener('tasks:watch', onChange);
  document.addEventListener('visibilitychange', onVis);
  return box;
}

/** Выбор, что отслеживать: поиск по приложениям и задачам (название или ключ задачи), клик — добавить / убрать. */
function openWatchPicker(apps, onDone) {
  const q = h('input', { class: 'inp', type: 'search', placeholder: 'Приложение или задача: название, ключ GLD-12…', 'aria-label': 'Поиск' });
  const list = h('div', { class: 'w-pick' });
  let tasks = [], seq = 0;
  const row = (t, id, unitId, name, left, sub) => {
    const on = isWatched(t, id);
    return h('button', { class: 'menu-item aud-item w-pick-row' + (on ? ' on' : ''), role: 'checkbox', 'aria-checked': String(on),
      onclick: () => { toggleWatch(t, id, unitId, name); draw(); } },
      h('span', { class: 'aud-check' }, on && icon('check', 13)), left, h('span', { class: 'w-pick-name' }, name, sub && h('small', { class: 'muted' }, sub)));
  };
  const draw = () => {
    const s = q.value.trim().toLowerCase();
    const found = apps.filter(a => !s || a.name.toLowerCase().includes(s) || (a.storeName || '').toLowerCase().includes(s)).slice(0, s ? 20 : 8);
    fill(list,
      h('div', { class: 'menu-label' }, 'Приложения'),
      found.length ? found.map(a => row('app', a.id, a.unitId, a.name, h('span', { class: 'app-ic-slot' }, a.iconUrl ? h('img', { class: 'uc-icon app-img xs', src: a.iconUrl, alt: '' }) : icon('app', 14)), a.storeName))
        : h('p', { class: 'muted w-pick-empty' }, 'Не найдено'),
      s.length >= 2 && [h('div', { class: 'menu-label' }, 'Задачи'),
        tasks.length ? tasks.map(t => row('task', t.id, t.unitId, t.title, h('span', { class: 'key-badge' }, t.key), t.unit && t.unit.name + ' · ' + t.statusName))
          : h('p', { class: 'muted w-pick-empty' }, 'Не найдено')]);
  };
  q.addEventListener('input', async () => {
    const s = q.value.trim();
    const my = ++seq;
    draw();
    if (s.length < 2) return;
    try { const r = await call('queryTasks', { q: s, limit: 15 }); if (my === seq) { tasks = r; draw(); } } catch (e) { showErr(e); }
  });
  draw();
  modal({ title: 'Отслеживать на дашборде', body: [q, list], actions: [{ label: 'Готово' }], onClose: onDone });
}
