/**
 * Дашборд RM (главная RM): очередь на релиз (переданные PM — чего не хватает до отправки), на ревью Apple (сколько ждут;
 * «Вышло в стор» / «Реджект» прямо здесь), реджекты (причина, кто исправляет; «Отправить снова»). Клик — карточка релиза.
 */
import { me, personById, greeting, plural, relTime, nameFrom } from '../state.js';
import { $, h, icon, avatar, topbar, showErr, fill, toast, confirmDlg, emptyBlock, skeleton } from '../ui.js';
import { call, send } from '../api.js';
import { currentView } from '../router.js';
import { peekTask } from './task.js';
import { appIcon, prioTag, isHighPrio, appStatusCell, stageDots, openAppById } from './apps.js';
import { watchBlock } from './watch.js';
import { newsBlock, loadNotes } from './home.js';
import { openReleaseSettings, openReleaseHistory, openRejectForm } from './release.js';

/** «от Екатерины»: имя в родительном падеже. */

const days = iso => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 864e5));

export async function renderRmHome() {
  const page = h('div', { class: 'page ceo-page rm-page' }, skeleton());
  const date = (() => { const t = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }); return t.charAt(0).toUpperCase() + t.slice(1); })();
  fill($('#main'),
    topbar([h('div', { class: 'screen-head' }, h('div', { class: 'screen-date' }, date), h('h1', { class: 'screen-title' }, 'Релизы'))], []),
    h('div', { class: 'view-body' }, page));
  async function load() {
    let d;
    let live;
    try { [d, live] = await Promise.all([call('getRmDashboard', {}), call('getReleaseHistory', { result: 'live' }), loadNotes()]); } catch (e) { return showErr(e); }
    if (currentView() !== 'home') return;
    const reviewBlock = section('На ревью Apple', 'На ревью ничего', 'Отправленные в Apple релизы появятся здесь', d.review, x => [
          h('span', { class: 'muted rq-line' }, 'отправлено ' + fmtShort(x.submittedAt) + ' · ждёт ' + (days(x.submittedAt) ? days(x.submittedAt) + ' дн.' : 'с сегодня')),
        ], x => [
          h('button', { class: 'btn danger solid', onclick: () => reject(x) }, 'Реджект'),
          h('button', { class: 'btn success', onclick: () => step(x, 'live') }, 'Вышло в стор')], 1);
    fill(page,
      h('div', { class: 'rm-grid' },
        h('div', { class: 'rm-col' }, section('Очередь на релиз', 'Очередь пуста', 'Когда PM передаст релиз, он появится здесь', d.queue, x => {
          const ready = !x.missing.length && x.checklist.done >= x.checklist.total;
          return [
            ready
              ? h('span', { class: 'ok-text rq-line' }, x.fixedAt ? `Реджект №${x.rejectNo || ''} исправлен, отправьте снова` : 'Готово к отправке')
              : h('span', { class: 'warn-text rq-line' }, ['Не заполнено: ' + x.missing.join(', '), x.checklist.total && x.checklist.done < x.checklist.total && `чеклист ${x.checklist.done}/${x.checklist.total}`].filter(Boolean).join(' · ')),
          ];
        }, x => ((!x.missing.length && x.checklist.done >= x.checklist.total)
          ? h('button', { class: 'btn primary', onclick: () => step(x, x.fixedAt ? 'resubmit' : 'submit') }, 'Отправил в Apple')
          : personById(x.pmId) && h('span', { class: 'muted rm-from' }, 'от ' + nameFrom(personById(x.pmId).name)))),
        section('Реджекты', 'Реджектов нет', 'Когда Apple вернёт релиз, PM получит задачу на исправление', d.rejected, x => {
          return [h('span', { class: 'rq-line' }, h('b', { class: 'danger-text' }, `№${x.rejectNo || ''} · ${x.reason}`),
            h('span', { class: 'muted' }, ' · ' + relTime(x.rejectedAt)))];
        }, x => [h('button', { class: 'btn', title: 'Задача по реджекту закроется, релиз вернётся в очередь', onclick: () => closeReject(x) }, 'Закрыть реджект'),
          h('button', { class: 'btn', onclick: () => step(x, 'resubmit') }, 'Отправил снова')], 0, true)),
        h('div', { class: 'rm-col' }, reviewBlock, storeBlock(live.rows))),
      // свои приложения и задачи «в фокусе» — статус обновляется сам; пустого блока нет
      watchBlock([], { openApp: id => openAppById(id, load), openTask: peekTask, appIcon, appStatusCell, stageDots, release: true }));
  }
  async function step(x, action, reason) {
    try {
      await send('releaseStep', { taskId: x.id, action, reason });
      toast({ close_reject: 'Реджект закрыт — релиз в очереди', live: `«${x.app ? x.app.name : x.title}» в App Store`, resubmit: 'Отправлено снова', reject: 'Реджект: задача ушла PM' }[action]);
      load();
    } catch (e) { showErr(e); }
  }
  async function closeReject(x) {
    if (await confirmDlg('Задача по нему закроется, релиз вернётся в очередь на отправку.', { ok: 'Закрыть реджект', title: `Закрыть реджект №${x.rejectNo || ''}?` })) step(x, 'close_reject');
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
function section(title, hint, sub, rows, line, actions, limit = 0, below = false) {
  const box = h('section');
  let all = false;
  const draw = () => fill(box,
    rows.length > 0 && h('div', { class: 'section-head' }, h('h2', null, title, h('span', { class: 'muted sec-n' }, rows.length))),
    rows.length
      ? h('div', { class: 'card-box att-list' }, (limit && !all ? rows.slice(0, limit) : rows).map(x => h('div', { class: 'rm-row' + (below ? ' below' : '') },
        x.app ? appIcon(x.app, 'sm') : h('span'),
        h('button', { class: 'link-btn rm-main', onclick: () => peekTask(x.unitId, x.id) },
          h('span', { class: 'rm-title' }, h('b', null, x.app ? x.app.name : x.title, x.version ? ' · ' + x.version : ''), x.app && x.app.isTest && h('span', { class: 'test-tag' }, 'тест')),
          line(x)),
        h('div', { class: 'rm-actions' }, actions(x)))),
        limit > 0 && rows.length > limit && h('button', { class: 'rc-more link-btn', onclick: () => { all = !all; draw(); } }, all ? 'Свернуть' : `Показать ещё ${rows.length - limit}`))
      : emptyBlock(hint, { ok: true, sub }));
  draw();
  return box;
}


/**
 * «Релизы в App Store» — последние вышедшие: сначала 2; «Показать ещё» раскрывает до 7;
 * дальше — «Вся история» (окно истории с фильтром «В сторе»).
 */
function storeBlock(rows) {
  const box = h('section');
  let open = false;
  const fmt = iso => (iso ? new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '');
  const row = x => h('button', { class: 'rm-row rm-live', title: x.n > 1 ? `С ${x.n}-й попытки` : 'С первой попытки', onclick: () => peekTask(x.unitId, x.taskId) },
    h('span', { class: 'rm-live-dot' }),
    h('span', { class: 'rm-main' }, h('span', { class: 'rm-title' }, h('b', null, x.app ? x.app.name : x.key, x.version ? ' · ' + x.version : ''))),
    h('span', { class: 'muted rm-live-at' }, fmt(x.at)));
  const draw = () => fill(box,
    h('div', { class: 'section-head' }, h('h2', null, 'Релизы в App Store'),
      h('button', { class: 'link-btn', onclick: () => openReleaseHistory({ result: 'live' }) }, 'История')),
    rows.length
      ? h('div', { class: 'card-box att-list' }, rows.slice(0, open ? 7 : 2).map(row),
        rows.length > 2 && h('div', { class: 'rm-more' },
          h('button', { class: 'link-btn', onclick: () => { open = !open; draw(); } }, open ? 'Свернуть' : `Показать ещё ${Math.min(rows.length, 7) - 2}`),
          open && rows.length > 7 && h('button', { class: 'link-btn', onclick: () => openReleaseHistory({ result: 'live' }) }, `Вся история · ${rows.length}`)))
      : emptyBlock('В стор пока ничего не выходило', { ic: 'app' }));
  draw();
  return box;
}
