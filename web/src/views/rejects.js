/**
 * Реджекты (CEO и релиз-менеджер): всё, что Apple вернул, в одном месте, чтобы ничего не терялось.
 * Открытые — у PM на исправлении или уже исправлены и ждут повторной отправки; закрытые — история.
 * Данные: getRmDashboard (что открыто сейчас) + getReleaseHistory (все реджекты).
 */
import { isSuper, personById, unitById, fmtDate, plural, safeUrl, appStatusById } from '../state.js';
import { $, h, icon, fill, topbar, toast, showErr, confirmDlg, emptyBlock, skeleton, menu } from '../ui.js';
import { call, send, swr } from '../api.js';
import { currentView } from '../router.js';
import { peekTask } from './task.js';
import { appIcon, openAppById, shelveAppDlg, deleteAppsDlg, SHELVES, SHELF_ACTION, shelfDone } from './apps.js';
import { openShots } from './shots.js';
import { onRemote } from '../live.js';

const DAY = 864e5;
const daysAgo = iso => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / DAY)) : 0);
const agoText = iso => { const n = daysAgo(iso); return n === 0 ? 'сегодня' : `${n} ${plural(n, ['день', 'дня', 'дней'])} назад`; };
const LATE_DAYS = 3; // столько дней реджект без движения — подсвечиваем красным

let tab = 'open';

export async function renderRejects() {
  const main = $('#main');
  const body = h('div', { class: 'page ceo-page rj-page' }, skeleton());
  fill(main, topbar([h('h1', null, 'Реджекты')], []), h('div', { class: 'view-body' }, body));
  let rows = [];
  let appRejects = [];  // приложения со статусом «Реджект» без реджекта релиза (добавлены сразу с этим статусом)
  let appResent = [];   // такие же, снова в «Ревью Apple» после «Реджекта» — отправлены повторно
  let shelved = [];     // убранные CEO: Design Spam [4.3] и удалённые

  // повторный заход — сразу из памяти, свежее — в фоне
  const load = () => swr('rejects', () => Promise.all([call('getRmDashboard', {}), call('getReleaseHistory', { result: 'reject' }), call('listApps', { archived: true, bare: true })]),
    show, { still: () => currentView() === 'rejects' }).catch(showErr);
  const show = ([dash, hist, gone]) => {
    {
      appRejects = dash.rejectedApps || [];
      appResent = (dash.review || []).filter(x => x.appOnly && x.afterReject).map(x => ({ ...x, at: x.submittedAt }));
      shelved = gone;
      // состояние реджекта — по текущей фазе его релиза (если это последний реджект релиза):
      // rejected (у PM) или '' (исправлен / RM исправляет сам, ждёт отправки) — открыт; submitted — отправлено повторно; иначе закрыт
      const active = new Map([...(dash.queue || []), ...(dash.review || []).filter(x => !x.appOnly), ...(dash.rejected || [])].map(x => [x.id, x]));
      rows = (hist.rows || []).map(x => {
        const a = active.get(x.taskId);
        const latest = !!a && (a.rejectNo || 0) === (x.rejectNo || 0);
        const state = !latest ? 'closed' : a.phase === 'submitted' ? 'resent' : a.phase === 'rejected' || !a.phase ? 'open' : 'closed';
        const open = state === 'open';
        return { ...x, state, open, fixed: open && !a.phase, resentAt: state === 'resent' ? a.submittedAt : '', pmId: open ? a.pmId : '',
          shot: x.shot || (open ? a.shot : ''), requestId: x.requestId || (open ? a.rejectRequestId : '') };
      });
      // открытый реджект, которого нет в истории (старые данные), всё равно показываем
      for (const a of dash.rejected || []) {
        if (!rows.some(r => r.taskId === a.id && r.open)) rows.push({ taskId: a.id, requestId: a.rejectRequestId || '', unitId: a.unitId, app: a.app, rejectNo: a.rejectNo, reason: a.reason, at: a.rejectedAt, shot: a.shot, state: 'open', open: true, fixed: false, pmId: a.pmId });
      }
      draw();
    }
  };

  async function step(x, action) {
    try {
      await send('releaseStep', { taskId: x.taskId, action });
      toast({ close_reject: 'Реджект закрыт — релиз в очереди', resubmit: 'Отправлено снова' }[action]);
      load();
    } catch (e) { showErr(e); }
  }
  async function closeReject(x) {
    if (await confirmDlg('Задача по нему закроется, релиз вернётся в очередь на отправку.', { ok: 'Закрыть реджект', title: `Закрыть реджект №${x.rejectNo || ''}?` })) step(x, 'close_reject');
  }

  const row = x => {
    const pm = personById(x.pmId);
    const late = x.open && !x.fixed && daysAgo(x.at) >= LATE_DAYS;
    const u = unitById(x.unitId);
    // карточка реджекта = задача PM «Реджект №N»: причина, статус работы над ним, исполнитель, комментарии; у RM её нет — открываем релиз
    const openCard = () => (x.requestId && isSuper() ? peekTask(x.unitId, x.requestId) : peekTask(x.unitId, x.taskId));
    return h('div', { class: 'rj-row' + (x.fixed ? ' fixed' : '') + (late ? ' late' : '') + (x.open ? '' : ' closed'), role: 'button', tabindex: '0', title: 'Открыть реджект', onclick: e => { if (!e.target.closest('button, a')) openCard(); }, onkeydown: e => { if (e.key === 'Enter' && e.target === e.currentTarget) openCard(); } },
      x.app ? appIcon(x.app, 'md') : h('span'),
      h('div', { class: 'rj-main' },
        h('div', { class: 'rj-title' },
          x.app ? h('button', { class: 'link-btn rj-app', onclick: () => openAppById(x.app.id, load) }, x.app.name) : h('b', null, x.key || ''),
          h('span', { class: 'rj-no' }, `Реджект №${x.rejectNo || ''}`),
          u && h('span', { class: 'rj-unit', style: { '--c': u.color } }, u.name),
          x.app && x.app.isTest && h('span', { class: 'test-tag' }, 'тест')),
        h('div', { class: 'rj-reason' }, x.reason || 'Причина не указана'),
        h('div', { class: 'rj-meta' },
          h('span', { class: late ? 'danger-text' : '' }, `Apple вернул ${fmtDate((x.at || '').slice(0, 10))} · ${agoText(x.at)}`),
          pm && h('span', null, 'PM: ' + pm.name),
          x.version && h('span', null, x.version),
          x.shots > 0 && h('button', { class: 'link-btn rj-shot', onclick: () => call('getTaskFiles', { taskId: x.taskId, tag: 'reject:' + x.rejectNo }).then(f => openShots(f)).catch(showErr) },
            icon('eye', 13), `${x.shots} ${plural(x.shots, ['скриншот', 'скриншота', 'скриншотов'])}`),
          x.shot && h('a', { class: 'rj-shot', href: safeUrl(x.shot), target: '_blank', rel: 'noopener', title: x.shot }, icon('link', 13), 'ссылка на скрин'))),
      h('div', { class: 'rj-side' },
        h('span', { class: 'rj-state ' + (x.state === 'resent' || x.fixed ? 'ok' : x.open ? 'wait' : 'done') },
          x.state === 'resent' ? `Отправлено повторно · ждёт ${daysAgo(x.resentAt) ? daysAgo(x.resentAt) + ' дн.' : 'с сегодня'}`
            : x.fixed ? (x.selfClosed ? 'Исправляет RM — ждёт отправки' : 'Исправлен — отправьте снова')
              : x.open ? 'У PM на исправлении' : x.selfClosed ? 'Закрыл RM сам' : 'Закрыт'),
        h('div', { class: 'rj-actions' },
          h('button', { class: 'btn sm', onclick: openCard }, isSuper() && x.requestId ? 'Открыть' : 'Релиз'),
          isSuper() && x.requestId && h('button', { class: 'btn sm', title: 'Карточка релиза', onclick: () => peekTask(x.unitId, x.taskId) }, 'Релиз'),
          x.open && (x.fixed
            ? h('button', { class: 'btn primary sm', onclick: () => step(x, 'resubmit') }, 'Отправил снова')
            : h('button', { class: 'btn sm', title: 'Задача по реджекту закроется, релиз вернётся в очередь', onclick: () => closeReject(x) }, 'Закрыть реджект')))));
  };

  const done = (msg, fn) => fn.then(r => { if (r !== false) { if (msg) toast(msg); load(); } }).catch(showErr);

  /** Приложение со статусом «Реджект» без реджекта релиза: релиза в трекере нет — только статус приложения. */
  const appRow = x => {
    const u = unitById(x.unitId);
    const late = daysAgo(x.at) >= LATE_DAYS;
    return h('div', { class: 'rj-row' + (late ? ' late' : ''), role: 'button', tabindex: '0', title: 'Открыть приложение', onclick: e => { if (!e.target.closest('button, a')) openAppById(x.app.id, load); }, onkeydown: e => { if (e.key === 'Enter' && e.target === e.currentTarget) openAppById(x.app.id, load); } },
      appIcon(x.app, 'md'),
      h('div', { class: 'rj-main' },
        h('div', { class: 'rj-title' }, h('button', { class: 'link-btn rj-app', onclick: () => openAppById(x.app.id, load) }, x.app.name),
          u && h('span', { class: 'rj-unit', style: { '--c': u.color } }, u.name), x.app.isTest && h('span', { class: 'test-tag' }, 'тест')),
        h('div', { class: 'rj-reason muted' }, x.afterReject ? 'Снова в «Ревью Apple» после реджекта — релиза в трекере нет' : 'Статус приложения «Реджект» — релиза в трекере нет'),
        x.at && h('div', { class: 'rj-meta' }, h('span', { class: late && !x.afterReject ? 'danger-text' : '' }, `с ${fmtDate(x.at.slice(0, 10))} · ${agoText(x.at)}`))),
      h('div', { class: 'rj-side' },
        h('span', { class: 'rj-state ' + (x.afterReject ? 'ok' : 'wait') }, x.afterReject ? 'Отправлено повторно' : 'Реджект'),
        isSuper() && h('div', { class: 'rj-actions' },
          h('button', { class: 'btn sm', 'aria-haspopup': 'menu', onclick: e => { e.stopPropagation(); menu(e.currentTarget, ['spam', 'sale', 'deleted'].map(id => ({
            label: SHELF_ACTION[id], action: () => done('', shelveAppDlg({ id: x.app.id, name: x.app.name }, id)) }))); } }, 'Убрать', icon('chevron', 13)))));
  };

  /** Убранное приложение (Design Spam [4.3] / удалённые): когда убрали; CEO — вернуть или удалить навсегда. */
  const shelfRow = a => {
    const u = unitById(a.unitId);
    return h('div', { class: 'rj-row closed' },
      appIcon(a, 'md'),
      h('div', { class: 'rj-main' },
        h('div', { class: 'rj-title' }, h('b', { class: 'rj-app' }, a.name), u && h('span', { class: 'rj-unit', style: { '--c': u.color } }, u.name), a.isTest && h('span', { class: 'test-tag' }, 'тест')),
        a.storeName && a.storeName !== a.name && h('div', { class: 'rj-reason muted' }, a.storeName),
        h('div', { class: 'rj-meta' }, h('span', null, a.shelvedAt ? `Перенесено ${fmtDate(a.shelvedAt.slice(0, 10))} · ${agoText(a.shelvedAt)}` : 'Убрано из работы'))),
      isSuper() && h('div', { class: 'rj-side' },
        h('div', { class: 'rj-actions' },
          h('button', { class: 'btn sm', 'aria-haspopup': 'menu', onclick: e => {
            e.stopPropagation();
            // вернуть = снова в работе с задачами; со статусом «Реджект» приложение встаёт в «Открытые»
            const isReject = (appStatusById(a.status) || {}).kind === 'reject';
            menu(e.currentTarget, [
              { label: isReject ? 'В открытые реджекты' : 'Вернуть в работу', icon: 'back',
                action: () => done(isReject ? `«${a.name}» — в открытых реджектах` : `«${a.name}» снова в работе`, send('restoreApp', { id: a.id })) },
              { sep: true },
              ...['spam', 'sale', 'deleted'].filter(id => id !== a.shelf).map(id => ({
                label: SHELF_ACTION[id], action: () => done(`«${a.name}» — ${shelfDone(id)}`, send('shelveApp', { id: a.id, shelf: id })) })),
            ]);
          } }, 'Перенести', icon('chevron', 13)),
          h('button', { class: 'btn sm danger', onclick: () => done('', deleteAppsDlg([a])) }, 'Удалить навсегда'))));
  };

  function draw() {
    const open = rows.filter(r => r.open).sort((a, b) => (b.fixed - a.fixed) || String(a.at).localeCompare(String(b.at)));
    const closed = rows.filter(r => r.state === 'closed').sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const resent = rows.filter(r => r.state === 'resent').sort((a, b) => String(a.resentAt).localeCompare(String(b.resentAt)));
    const apps = [...appRejects].sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const resentList = [...resent.map(row), ...appResent.map(appRow)];
    const shelf = id => shelved.filter(a => a.shelf === id).sort((a, b) => String(b.shelvedAt).localeCompare(String(a.shelvedAt)));
    const tabs = [['open', 'Открытые', open.length + apps.length], ['resent', 'Отправлено повторно', resentList.length],
      ...['spam', 'sale', 'deleted'].map(id => [id, SHELVES[id], shelf(id).length]),
      ['closed', 'Закрытые', closed.length], ['all', 'Все', rows.length + apps.length + appResent.length]];
    const waiting = open.filter(r => r.fixed).length;
    const shelfTab = tab in SHELVES;
    const list = shelfTab ? shelf(tab).map(shelfRow)
      : tab === 'open' ? [...open.map(row), ...apps.map(appRow)] : tab === 'resent' ? resentList : tab === 'closed' ? closed.map(row)
        : [...open.map(row), ...apps.map(appRow), ...resentList, ...closed.map(row)];
    const empty = {
      open: ['Открытых реджектов нет', 'Когда Apple вернёт релиз, он появится здесь, а PM получит задачу на исправление'],
      spam: ['В Design Spam пусто', 'CEO переносит сюда приложения с реджектом 4.3: меню «⋯» в карточке приложения'],
      sale: ['Снятых с продажи нет', 'Приложение снято с продажи, но не удалено: CEO переносит сюда из меню «⋯» в карточке приложения'],
      deleted: ['Удалённых приложений нет', 'CEO переносит сюда приложения из меню «⋯» в карточке; восстановить можно в любой момент'],
      resent: ['Повторно отправленных нет', 'После исправления реджекта приложение снова уходит в Apple — здесь видно, что ждёт ответа'],
      closed: ['Закрытых реджектов пока нет', ''], all: ['Реджектов пока нет', ''],
    }[tab];
    fill(body,
      h('div', { class: 'rj-tabs', role: 'tablist' }, tabs.map(([id, label, n]) => h('button', { class: 'fchip' + (tab === id ? ' on' : ''), role: 'tab', 'aria-selected': String(tab === id), onclick: () => { tab = id; draw(); } }, `${label}: ${n}`))),
      waiting > 0 && (tab === 'open' || tab === 'all') && h('div', { class: 'rj-note' }, icon('check', 14), `${waiting} ${plural(waiting, ['реджект исправлен', 'реджекта исправлено', 'реджектов исправлено'])} — осталось отправить в Apple снова`),
      list.length
        ? h('div', { class: 'card-box rj-list' }, list)
        : emptyBlock(empty[0], { ok: !shelfTab, sub: empty[1] }));
  }
  load();
  onRemote(() => load(), () => currentView() === 'rejects'); // живые обновления
}
