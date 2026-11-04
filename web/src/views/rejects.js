/**
 * Реджекты (CEO и релиз-менеджер): всё, что Apple вернул, в одном месте, чтобы ничего не терялось.
 * Открытые — у PM на исправлении или уже исправлены и ждут повторной отправки; закрытые — история.
 * Данные: getRmDashboard (что открыто сейчас) + getReleaseHistory (все реджекты).
 */
import { S, isSuper, personById, unitById, fmtDate, relTime, nameFrom, plural } from '../state.js';
import { $, h, icon, fill, topbar, toast, showErr, confirmDlg, emptyBlock, skeleton } from '../ui.js';
import { call, send } from '../api.js';
import { peekTask } from './task.js';
import { appIcon, openAppById } from './apps.js';
import { openShots } from './shots.js';

const DAY = 864e5;
const daysAgo = iso => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / DAY)) : 0);
const agoText = iso => { const n = daysAgo(iso); return n === 0 ? 'сегодня' : `${n} ${plural(n, ['день', 'дня', 'дней'])} назад`; };
const LATE_DAYS = 3; // столько дней реджект без движения — подсвечиваем красным

let tab = 'open';

/** Сколько реджектов открыто сейчас — число у пункта меню. */
export async function openRejectCount() {
  try { return ((await call('getRmDashboard', {})).rejected || []).length; } catch { return 0; }
}

export async function renderRejects() {
  const main = $('#main');
  const body = h('div', { class: 'page ceo-page rj-page' }, skeleton());
  fill(main, topbar([h('h1', null, 'Реджекты')], []), h('div', { class: 'view-body' }, body));
  let rows = [];

  const load = async () => {
    try {
      const [dash, hist] = await Promise.all([call('getRmDashboard', {}), call('getReleaseHistory', { result: 'reject' })]);
      const active = new Map((dash.rejected || []).map(x => [x.id, x]));
      rows = (hist.rows || []).map(x => {
        const a = active.get(x.taskId);
        const open = !!a && (a.rejectNo || 0) === (x.rejectNo || 0);
        return { ...x, open, fixed: open && !!a.fixedAt, pmId: open ? a.pmId : '', shot: x.shot || (open ? a.shot : ''), requestId: x.requestId || (open ? a.rejectRequestId : '') };
      });
      // открытый реджект, которого нет в истории (старые данные), всё равно показываем
      for (const a of dash.rejected || []) {
        if (!rows.some(r => r.taskId === a.id && r.open)) rows.push({ taskId: a.id, requestId: a.rejectRequestId || '', unitId: a.unitId, app: a.app, rejectNo: a.rejectNo, reason: a.reason, at: a.rejectedAt, shot: a.shot, open: true, fixed: !!a.fixedAt, pmId: a.pmId });
      }
      draw();
    } catch (e) { showErr(e); }
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
          pm && h('span', null, 'PM: ' + nameFrom(pm.name)),
          x.version && h('span', null, x.version),
          x.shots > 0 && h('button', { class: 'link-btn rj-shot', onclick: () => call('getTaskFiles', { taskId: x.taskId, tag: 'reject:' + x.rejectNo }).then(f => openShots(f)).catch(showErr) },
            icon('eye', 13), `${x.shots} ${plural(x.shots, ['скриншот', 'скриншота', 'скриншотов'])}`),
          x.shot && h('a', { class: 'rj-shot', href: x.shot, target: '_blank', rel: 'noopener', title: x.shot }, icon('link', 13), 'ссылка на скрин'))),
      h('div', { class: 'rj-side' },
        h('span', { class: 'rj-state ' + (x.fixed ? 'ok' : x.open ? 'wait' : 'done') }, x.fixed ? 'Исправлен — отправьте снова' : x.open ? 'У PM на исправлении' : x.selfClosed ? 'Закрыл RM сам' : 'Закрыт'),
        h('div', { class: 'rj-actions' },
          h('button', { class: 'btn sm', onclick: openCard }, isSuper() && x.requestId ? 'Открыть' : 'Релиз'),
          isSuper() && x.requestId && h('button', { class: 'btn sm', title: 'Карточка релиза', onclick: () => peekTask(x.unitId, x.taskId) }, 'Релиз'),
          x.open && (x.fixed
            ? h('button', { class: 'btn primary sm', onclick: () => step(x, 'resubmit') }, 'Отправил снова')
            : h('button', { class: 'btn sm', title: 'Задача по реджекту закроется, релиз вернётся в очередь', onclick: () => closeReject(x) }, 'Закрыть реджект')))));
  };

  function draw() {
    const open = rows.filter(r => r.open).sort((a, b) => (b.fixed - a.fixed) || String(a.at).localeCompare(String(b.at)));
    const closed = rows.filter(r => !r.open).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const tabs = [['open', 'Открытые', open.length], ['closed', 'Закрытые', closed.length], ['all', 'Все', rows.length]];
    const shown = tab === 'open' ? open : tab === 'closed' ? closed : [...open, ...closed];
    const waiting = open.filter(r => r.fixed).length;
    fill(body,
      h('div', { class: 'rj-tabs', role: 'tablist' }, tabs.map(([id, label, n]) => h('button', { class: 'fchip' + (tab === id ? ' on' : ''), role: 'tab', 'aria-selected': String(tab === id), onclick: () => { tab = id; draw(); } }, `${label}: ${n}`))),
      waiting > 0 && tab !== 'closed' && h('div', { class: 'rj-note' }, icon('check', 14), `${waiting} ${plural(waiting, ['реджект исправлен', 'реджекта исправлено', 'реджектов исправлено'])} — осталось отправить в Apple снова`),
      shown.length
        ? h('div', { class: 'card-box rj-list' }, shown.map(row))
        : emptyBlock(tab === 'closed' ? 'Закрытых реджектов пока нет' : 'Открытых реджектов нет', { ok: true, sub: tab === 'closed' ? '' : 'Когда Apple вернёт релиз, он появится здесь, а PM получит задачу на исправление' }));
  }
  load();
}
