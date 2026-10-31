/**
 * Дашборд RM (главная RM): очередь на релиз (переданные PM — чего не хватает до отправки), на ревью Apple (сколько ждут;
 * «Вышло в стор» / «Реджект» прямо здесь), реджекты (причина, кто исправляет; «Отправить снова»). Клик — карточка релиза.
 */
import { me, personById, greeting, plural, relTime } from '../state.js';
import { $, h, icon, avatar, topbar, showErr, fill, toast, confirmDlg } from '../ui.js';
import { call, send } from '../api.js';
import { currentView } from '../router.js';
import { peekTask } from './task.js';
import { appIcon, prioTag, isHighPrio, appStatusCell, stageDots, openAppById } from './apps.js';
import { watchBlock } from './watch.js';
import { newsBlock, loadNotes } from './home.js';
import { openReleaseSettings, openReleaseHistory, openRejectForm } from './release.js';

const days = iso => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 864e5));

export async function renderRmHome() {
  const page = h('div', { class: 'page ceo-page' }, h('div', { class: 'boot' }, h('span', { class: 'spinner' }), 'Загрузка…'));
  const date = (() => { const t = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }); return t.charAt(0).toUpperCase() + t.slice(1); })();
  fill($('#main'),
    topbar([h('div', { class: 'screen-head' }, h('div', { class: 'screen-date' }, date), h('h1', { class: 'screen-title' }, 'Релизы'))], []),
    h('div', { class: 'view-body' }, page));
  async function load() {
    let d;
    let live;
    try { [d, live] = await Promise.all([call('getRmDashboard', {}), call('getReleaseHistory', { result: 'live' }), loadNotes()]); } catch (e) { return showErr(e); }
    if (currentView() !== 'home') return;
    fill(page,
      h('div', { class: 'rm-grid' },
        section('Очередь на релиз', 'Очередь пуста', 'Когда PM передаст релиз, он появится здесь', d.queue, x => {
          const pm = personById(x.pmId);
          const ready = !x.missing.length && x.checklist.done >= x.checklist.total;
          return [
            x.fixedAt && h('span', { class: 'ok-text rq-line' }, `реджект №${x.rejectNo || ''} исправлен — отправьте снова`),
            ready
              ? h('span', { class: 'ok-text rq-line' }, 'Готово к отправке')
              : h('span', { class: 'warn-text rq-line' }, ['Не заполнено: ' + x.missing.join(', '), x.checklist.total && x.checklist.done < x.checklist.total && `чеклист ${x.checklist.done}/${x.checklist.total}`].filter(Boolean).join(' · ')),
          ];
        }, x => ((!x.missing.length && x.checklist.done >= x.checklist.total)
          ? h('button', { class: 'btn primary', onclick: () => step(x, x.fixedAt ? 'resubmit' : 'submit') }, 'Отправил в Apple')
          : h('button', { class: 'btn', onclick: () => peekTask(x.unitId, x.id) }, 'Открыть релиз'))),
        section('На ревью Apple', 'На ревью ничего', 'Отправленные в Apple релизы появятся здесь', d.review, x => [
          h('span', { class: 'muted rq-line' }, 'отправлено ' + fmtShort(x.submittedAt) + ' · ждёт ' + (days(x.submittedAt) ? days(x.submittedAt) + ' дн.' : 'с сегодня')),
        ], x => [
          h('button', { class: 'btn danger solid', onclick: () => reject(x) }, 'Реджект'),
          h('button', { class: 'btn success', onclick: () => step(x, 'live') }, 'Вышло в стор')], 3),
        section('Реджекты', 'Реджектов нет', 'Когда Apple вернёт релиз, PM получит задачу на исправление', d.rejected, x => {
          const pm = personById(x.pmId);
          return [h('span', { class: 'rq-line' }, h('span', { class: 'att-what danger' }, `№${x.rejectNo || ''} · ${x.reason}`),
            h('span', { class: 'muted' }, ' · ' + (pm ? pm.name : 'PM') + ' · ' + relTime(x.rejectedAt)))];
        }, x => [h('button', { class: 'btn', title: 'Задача по реджекту закроется, релиз вернётся в очередь', onclick: () => closeReject(x) }, 'Закрыть'),
          h('button', { class: 'btn', onclick: () => step(x, 'resubmit') }, 'Отправил снова')]),
        storeBlock(live.rows)),
      // свои приложения и задачи «в фокусе» — статус обновляется сам; пустого блока нет
      watchBlock([], { openApp: id => openAppById(id, load), openTask: peekTask, appIcon, appStatusCell, stageDots, release: true, prioTag }));
  }
  async function step(x, action, reason) {
    try {
      await send('releaseStep', { taskId: x.id, action, reason });
      toast({ close_reject: 'Реджект закрыт — релиз в очереди', live: `«${x.app ? x.app.name : x.title}» в сторе`, resubmit: 'Отправлено снова', reject: 'Реджект: задача ушла PM' }[action]);
      load();
    } catch (e) { showErr(e); }
  }
  async function closeReject(x) {
    if (await confirmDlg(`Закрыть реджект №${x.rejectNo || ''}? Задача по нему закроется, релиз вернётся в очередь на отправку.`, { ok: 'Закрыть реджект', title: 'Реджект' })) step(x, 'close_reject');
  }
  async function reject(x) {
    let no = 0;
    try { no = (await call('getRelease', { taskId: x.id })).nextRejectNo; } catch { /* номер присвоит база */ }
    openRejectForm({ id: x.id, title: x.title }, x.app ? x.app.name : x.title, no, load);
  }
  load();
}

/** Секция релизов: строки — приложение, релиз, состояние, исполнитель и действия. */
/** limit — сколько строк показать сразу; остальные — «Показать ещё». */
const fmtShort = iso => (iso ? new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '');
function section(title, hint, sub, rows, line, actions, limit = 0) {
  const box = h('section');
  let all = false;
  const draw = () => fill(box,
    h('div', { class: 'section-head' }, h('h2', null, title, rows.length > 0 && h('span', { class: 'muted sec-n' }, rows.length))),
    rows.length
      ? h('div', { class: 'card-box att-list' }, (limit && !all ? rows.slice(0, limit) : rows).map(x => h('div', { class: 'rm-row' },
        x.app ? appIcon(x.app, 'sm') : h('span'),
        h('button', { class: 'link-btn rm-main', onclick: () => peekTask(x.unitId, x.id) },
          h('span', { class: 'rm-title' }, h('b', null, x.app ? x.app.name : x.title), x.app && prioTag(x.app.priority), x.app && x.app.isTest && h('span', { class: 'test-tag' }, 'тест')),
          line(x)),
        h('div', { class: 'rm-actions' }, actions(x), avatar(personById(x.assigneeId), 'sm')))),
        limit > 0 && rows.length > limit && h('button', { class: 'rc-more link-btn', onclick: () => { all = !all; draw(); } }, all ? 'Свернуть' : `Показать ещё ${rows.length - limit}`))
      : h('div', { class: 'card-box empty-state sm center' }, icon('done', 20), h('b', null, hint), h('p', { class: 'muted' }, sub)));
  draw();
  return box;
}


/**
 * «Релизы в App Store» — последние вышедшие: всегда не больше 3; «Показать ещё» раскрывает до 7;
 * дальше — «Вся история» (окно истории с фильтром «В сторе»).
 */
function storeBlock(rows) {
  const box = h('section');
  let open = false;
  const fmt = iso => (iso ? new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '');
  const row = x => h('button', { class: 'rm-row rm-live', onclick: () => peekTask(x.unitId, x.taskId) },
    x.app ? appIcon(x.app, 'sm') : h('span'),
    h('span', { class: 'rm-main' }, h('span', { class: 'rm-title' }, h('b', null, x.app ? x.app.name : x.key), x.version && h('span', { class: 'muted' }, ' v' + x.version)),
      h('span', { class: 'rq-line muted' }, x.n > 1 ? `с ${x.n}-й попытки` : 'с первой попытки')),
    h('span', { class: 'ok-text rm-live-at' }, icon('check', 13), fmt(x.at)));
  const draw = () => fill(box,
    h('div', { class: 'section-head' }, h('h2', null, 'Релизы в App Store', rows.length > 0 && h('span', { class: 'muted sec-n' }, rows.length)),
      h('button', { class: 'link-btn', onclick: () => openReleaseHistory({ result: 'live' }) }, 'История')),
    rows.length
      ? h('div', { class: 'card-box att-list' }, rows.slice(0, open ? 7 : 3).map(row),
        rows.length > 3 && h('div', { class: 'rm-more' },
          h('button', { class: 'link-btn', onclick: () => { open = !open; draw(); } }, open ? 'Свернуть' : `Показать ещё ${Math.min(rows.length, 7) - 3}`),
          open && rows.length > 7 && h('button', { class: 'link-btn', onclick: () => openReleaseHistory({ result: 'live' }) }, `Вся история · ${rows.length}`)))
      : h('div', { class: 'card-box empty-state sm' }, h('p', { class: 'muted' }, 'В стор пока ничего не выходило')));
  draw();
  return box;
}
