/**
 * Вкладки юнита «Обзор» (#/u/:id/overview) и «Команда» (#/u/:id/team). Шапка с крошками и вкладками — unitnav.js.
 * Обзор: описание, цифры, что в работе и что требует внимания, ответственный и команда коротко.
 * Команда: люди юнита — роль, позиция, открытые задачи в юните; добавить участника — руководителям.
 */
import { S, me, isSuper, isStaff, todayStr, ACCESS_LABELS, personById, deptById, taskDone, plural, columns, colColor, appStatusById } from '../state.js';
import { $, h, icon, avatar, showErr, fill, menu, toast, emptyBlock, skeleton, modal, confirmDlg } from '../ui.js';
import { call, send, swr } from '../api.js';
import { currentView, link } from '../router.js';
import { openCreateApp, openNewAppTask, pmsOf, openAppCard, appStatusCell, appIcon, idleApps, openStartWork } from './apps.js';
import { peekTask } from './task.js';
import { attention, inProgress, recent } from './ceo.js';

import { addMemberDialog, applyMembers } from './people.js';
import { guestSection } from './settings.js';
import { sparkline, openSeries } from './charts.js';
import { unitHeader } from './unitnav.js';
import { onRemote } from '../live.js';

/**
 * Цифры по задачам юнита: из лёгкой загрузки (summary с сервера) или, если доска уже загружена целиком, — по ней.
 * byStatus — сколько в каждой колонке, byAssignee — у кого сколько открытых и просроченных, open / late — всего.
 */
function unitStats() {
  if (S.board.summary) return S.board.summary;
  const today = todayStr();
  const byStatus = {}, byAssignee = {};
  let open = 0, late = 0;
  for (const t of S.board.tasks) {
    if (t.archived) continue;
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    if (taskDone(t)) continue;
    open++;
    const isLate = !!t.dueDate && t.dueDate < today;
    if (isLate) late++;
    if (t.assigneeId) {
      const a = byAssignee[t.assigneeId] || (byAssignee[t.assigneeId] = { open: 0, late: 0 });
      a.open++;
      if (isLate) a.late++;
    }
  }
  return { byStatus, byAssignee, open, late };
}

export async function renderUnitPage() {
  const u = S.board.unit;
  const key = 'overview:' + u.id;
  const page = h('div', { class: 'page unit-page' }, skeleton());
  const actions = h('div', { class: 'row', style: { gap: '8px' } });
  const draw = () => fill($('#main'), ...unitHeader('overview', [actions]), h('div', { class: 'view-body' }, page));
  draw();

  async function load() {
    const rm = ((me() || {}).access) === 'rm';
    // повторный заход — сразу из памяти, свежее — в фоне
    try {
      // не RM: приложения юнита берём из дашборда CEO (он и так загружает все приложения) — без второго listApps
      await swr('unit:' + u.id + (rm ? ':rm' : ''), () => (rm
        ? Promise.all([call('listApps', { unitId: u.id }), null, call('getRmDashboard', {})])
        : call('getCeoDashboard', { today: todayStr() }).then(d => [(d.apps || []).filter(a => a.unitId === u.id), d, null])),
      show, { still: () => currentView() === key });
    } catch (e) { showErr(e); }
  }
  function show([apps, d, rd]) {
    const rm = ((me() || {}).access) === 'rm';
    if (currentView() !== key) return;
    // приложения юнита — в общий список (их ищут формы «Новая задача» и счётчик вкладки)
    S.apps = [...S.apps.filter(a => a.unitId !== u.id), ...apps.map(({ requests, active, ...a }) => a)];
    draw();
    if (rm) {
      // релиз-менеджеру в юните нужно только своё: сколько в очереди, на ревью, в реджекте и в сторе; приложения и команда
      // реджекты и «В App Store» — и по статусу приложений, добавленных сразу с ним (релиза в трекере нет)
      // клик по цифре — список: что именно и где висит (релиз открывается карточкой, приложение без релиза — карточкой приложения)
      const mine = list => (list || []).filter(x => x.unitId === u.id);
      const appRow = a => ({ app: a, appOnly: true, unitId: a.unitId, at: a.statusAt });
      const lists = {
        queue: mine(rd.queue),
        review: mine(rd.review),
        rejected: [...mine(rd.rejected), ...mine(rd.rejectedApps)],
        store: apps.filter(a => (appStatusById(a.status) || {}).kind === 'live').map(appRow),
      };
      const rel = (id, label, tone) => {
        const count = lists[id].length;
        return h('button', { class: 'cs' + (tone && count ? ' ' + tone : ''), disabled: !count, title: count ? 'Показать список' : '',
          onclick: () => openRmList(label, id, lists[id], load) }, h('div', { class: 'cs-n' }, count), h('div', { class: 'cs-label' }, label));
      };
      fill(page,
        h('div', { class: 'cs-row unit-stats' },
          rel('queue', 'В очереди на релиз'), rel('review', 'На ревью Apple'), rel('rejected', 'Реджекты', 'danger'), rel('store', 'В App Store')),
        h('div', { class: 'home-grid' },
          h('div', { class: 'home-col' }, appsBrief(u, [...apps].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))), load, 6)),
          h('div', { class: 'home-col' }, teamBrief(u))));
      return;
    }
    const mine = x => x.app && x.app.unitId === u.id;
    const ud = { ...d, attention: d.attention.filter(mine), inProgress: d.inProgress.filter(mine), recent: d.recent.filter(mine) };
    const { open, late } = unitStats();
    const stat = (n, label, mode, tone, spark, f) => link({ unit: u.id, mode, f }, { class: 'cs' + (tone ? ' ' + tone : '') }, h('div', { class: 'cs-n' }, n), h('div', { class: 'cs-label' }, label), spark);

    fill(actions,
      isSuper() && h('button', {
        class: 'btn', disabled: !apps.length, title: apps.length ? '' : 'Сначала приложение — задача ставится по нему',
        onclick: () => openNewAppTask(load, u.id),
      }, icon('plus', 15), h('span', { class: 'btn-label' }, 'Новая задача')),
      isSuper() && h('button', { class: 'btn primary', onclick: () => openCreateApp(load, u.id) }, icon('plus', 15), h('span', { class: 'btn-label' }, 'Новое приложение')));

    fill(page,
      h('div', { class: 'cs-row unit-stats' },
        stat(apps.length, 'Приложения', 'apps', '', sparkline(openSeries(apps.map(a => ({ createdAt: a.createdAt }))))),
        stat(apps.filter(a => a.active > 0).length, 'В работе', 'apps', '', sparkline(openSeries(apps.flatMap(a => a.requests))), 'working'),
        // «Открытых задач» убрали: считала каждый этап, а список сворачивает этапы в запрос — цифры не сходились
        stat(late, 'Просрочено', 'list', late ? 'danger' : '', sparkline(Array(14).fill(late)), 'late')),
      h('div', { class: 'home-grid' },
        h('div', { class: 'home-col' }, inProgress(ud, load, { brief: true }), appsBrief(u, apps, load), attention(ud, load, { two: true })),
        h('div', { class: 'home-col' }, tasksByColumn(u, open), teamBrief(u), owner(u, load), recent(ud, load, { empty: 'За 30 дней статусы приложений юнита не менялись' }))));
  }

  load();
  onRemote(d => { if (!d.units.length || d.units.includes(u.id)) load(); }, () => currentView() === key); // живые обновления юнита
}

/**
 * Список за цифрой обзора юнита у RM: приложение, что с ним и сколько ждёт. Клик — карточка релиза (поверх)
 * или карточка приложения, если релиза в трекере нет (добавлено сразу со статусом).
 */
function openRmList(title, kind, rows, reload) {
  const days = iso => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 864e5)) : null);
  const ago = iso => { const d = days(iso); return d == null ? '' : d === 0 ? 'с сегодня' : `${d} ${plural(d, ['день', 'дня', 'дней'])}`; };
  const line = x => {
    if (x.appOnly) return kind === 'store' ? 'в App Store' + (x.at ? ' · ' + ago(x.at) : '') : 'статус приложения, релиза в трекере нет' + (x.at ? ' · ' + ago(x.at) : '');
    if (kind === 'queue') return x.missing.length ? 'Не заполнено: ' + x.missing.join(', ') : x.checklist.total && x.checklist.done < x.checklist.total ? `чеклист ${x.checklist.done}/${x.checklist.total}` : x.fixedAt ? `Реджект №${x.rejectNo || ''} исправлен — отправить снова` : 'Готово к отправке';
    if (kind === 'review') return 'отправлено в Apple · ждёт ' + ago(x.submittedAt);
    if (kind === 'rejected') return `№${x.rejectNo || ''} · ${x.reason || 'причина не указана'} · ${ago(x.rejectedAt)}`;
    return '';
  };
  const warn = x => kind === 'queue' && !x.appOnly && (x.missing.length || (x.checklist.total && x.checklist.done < x.checklist.total));
  const close = modal({
    title: `${title} · ${rows.length}`,
    cls: 'dlg rm-list-dlg',
    body: h('div', { class: 'rm-list' }, rows.map(x => {
      const who = !x.appOnly && personById(x.assigneeId);
      return h('button', {
        class: 'rm-list-row',
        onclick: () => { close(); if (x.appOnly) openAppCard(x.app, reload); else peekTask(x.unitId, x.id); },
      },
      x.app ? appIcon(x.app, 'sm') : h('span'),
      h('span', { class: 'rm-list-main' },
        h('b', null, x.app ? x.app.name : x.title, x.version ? ' · ' + x.version : ''),
        h('small', { class: kind === 'rejected' ? 'danger-text' : warn(x) ? 'warn-text' : 'muted' }, line(x))),
      who ? avatar(who, 'sm') : h('span'));
    })),
    actions: [{ label: 'Закрыть' }],
  });
}

/** Команда на обзоре: кто, позиция и сколько задач в работе; самые загруженные сверху. */
function teamBrief(u) {
  const { byAssignee } = unitStats();
  const rows = S.board.members.map(m => {
    const p = personById(m.personId);
    const c = (p && byAssignee[p.id]) || { open: 0, late: 0 };
    return p && { p, pos: (deptById(m.departmentId) || deptById(p.positionId) || {}).name || '', n: c.open, late: c.late };
  }).filter(Boolean).sort((a, b) => b.n - a.n || a.p.name.localeCompare(b.p.name, 'ru'));
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Команда' + (rows.length ? ' · ' + rows.length : ''))),
    rows.length
      ? h('div', { class: 'card-box team-list' }, rows.slice(0, 3).map(x => h('div', { class: 'team-row compact' },
        avatar(x.p, 'sm'),
        h('b', { class: 'team-who' }, x.p.name),
        h('span', { class: 'team-load' + (x.late ? ' warn-text' : x.n ? '' : ' muted') }, x.n || '—'))))
      : emptyBlock('Команда не собрана', { ic: 'users' }));
}

/** Задачи юнита по колонкам доски: полоса и цифры; клик — на вкладку «Задачи». */
function tasksByColumn(u, open) {
  const { byStatus } = unitStats();
  const cols = columns().map(c => ({ c, n: byStatus[c.id] || 0 }));
  const total = cols.reduce((n, x) => n + x.n, 0);
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, `Задачи · ${open} открыто`)),
    total
      ? h('div', { class: 'card-box col-sum' },
        h('div', { class: 'col-sum-bar', 'aria-hidden': 'true' }, cols.filter(x => x.n).map(x => h('span', { style: { flex: x.n, background: colColor(x.c) } }))),
        h('div', { class: 'col-sum-list' }, cols.filter(x => x.c.kind !== 'done').map(x => h('span', { class: 'col-sum-item' }, `${x.c.name} ${x.n}`))))
      : emptyBlock('Задач пока нет', { ic: 'list' }));
}

/** Приложения юнита коротко: иконка, название, статус; клик — карточка. Все — на вкладке «Приложения». */
function appsBrief(u, apps, reload, LIMIT = 3) {
  const idle = isSuper() ? idleApps(apps) : [];
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Приложения', apps.length > LIMIT && h('span', { class: 'muted sec-n' }, apps.length)),
      idle.length > 0 && h('button', { class: 'btn ghost sm idle-link', title: 'Нет задач — на досках, в Сводке и у людей их не видно', onclick: () => openStartWork(idle, reload) },
        icon('alert', 13), `Без задач: ${idle.length} · Разнести по этапам`),
      link({ unit: u.id, mode: 'apps' }, { class: 'btn ghost sm' }, 'Все')),
    apps.length
      ? h('div', { class: 'card-box app-brief' }, apps.slice(0, LIMIT).map(a => h('button', { class: 'app-brief-row', onclick: () => openAppCard(a, reload) },
        appIcon(a, 'sm'),
        h('span', { class: 'app-brief-name' }, h('b', null, a.name), a.storeName && a.storeName !== a.name && h('small', { class: 'muted' }, a.storeName)),
        h('span', { class: 'app-brief-st' }, appStatusCell(appStatusById(a.status), a)))))
      : emptyBlock('Приложений пока нет', { ic: 'app' }));
}

/** Вкладка «Команда»: участники юнита — роль, позиция в юните, открытые и просроченные задачи здесь. */
export function renderUnitTeam() {
  const u = S.board.unit;
  const body = h('div', { class: 'page unit-page' });
  let zones = {};  // зоны лидов: { leadId: [personId…] } — видят и меняют CEO и PM юнита
  /** Зона лида = его позиции + люди, которых выдали отдельно. */
  const zoneDialog = lead => {
    const picked = new Set(zones[lead.id] || []);
    const others = S.board.members.map(m => personById(m.personId)).filter(p => p && p.active && p.id !== lead.id)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    modal({
      title: 'Зона лида · ' + lead.name,
      cls: 'dlg',
      body: [
        h('p', { class: 'hint', style: { marginTop: 0 } }, 'Лид видит и ведёт задачи своей позиции, плюс задачи отмеченных здесь людей. Остальное в юните для него скрыто.'),
        ...others.map(p => {
          const cb = h('input', { type: 'checkbox', checked: picked.has(p.id), onchange: () => (cb.checked ? picked.add(p.id) : picked.delete(p.id)) });
          return h('label', { class: 'row', style: { gap: '8px', padding: '4px 0' } }, cb, avatar(p, 'sm'), h('span', null, p.name), h('span', { class: 'muted' }, (deptById(p.positionId) || {}).name || ''));
        }),
      ],
      actions: [{ label: 'Отмена' }, { label: 'Сохранить', primary: true, action: async close => {
        zones[lead.id] = await send('setLeadPeople', { leadId: lead.id, personIds: [...picked] });
        close();
        toast('Зона лида сохранена');
        draw();
      } }],
    });
  };
  // состав собирает CEO или PM этого юнита (PM и CEO из состава не убираем)
  const canEdit = isSuper() || (isStaff() && (u.members || []).includes(S.meId));
  const removeMember = async p => {
    if (!(await confirmDlg(`Убрать ${p.name} из команды? Задачи, где он исполнитель, останутся за ним.`, { ok: 'Убрать', danger: true }))) return;
    try { applyMembers(u.id, await send('removeMember', { unitId: u.id, personId: p.id })); } catch (e) { showErr(e); }
    draw();
  };
  const draw = () => {
    const rows = S.board.members.map(m => ({ m, p: personById(m.personId) })).filter(x => x.p)
      .sort((a, b) => a.p.name.localeCompare(b.p.name, 'ru'));
    const { byAssignee } = unitStats();
    fill($('#main'), ...unitHeader('team', [
      canEdit && h('button', { class: 'btn primary', onclick: async () => { if (await addMemberDialog(u.id)) draw(); } }, icon('plus', 15), h('span', { class: 'btn-label' }, 'Участник')),
    ]), h('div', { class: 'view-body' }, body));
    const row = ({ m, p }) => {
      const c = byAssignee[p.id] || { open: 0, late: 0 };
      const n = c.open, late = c.late;
      return h('div', { class: 'team-row' },
        avatar(p, 'sm'),
        h('b', { class: 'team-who', 'data-pcard': p.id }, p.name),
        h('span', { class: 'muted team-pos' }, (deptById(m.departmentId) || deptById(p.positionId) || {}).name || '—'),
        h('span', { class: 'muted team-role' }, ACCESS_LABELS[p.access] || '',
          p.access === 'lead' && isStaff() && h('button', { class: 'link-btn', style: { marginLeft: '8px' }, title: 'Позиции лида и выданные ему люди', onclick: () => zoneDialog(p) },
            'зона' + ((zones[p.id] || []).length ? ' · +' + zones[p.id].length : ''))),
        h('span', { class: 'team-load' }, n ? `${n} ${plural(n, ['задача', 'задачи', 'задач'])}` : null,
          late > 0 && h('span', { class: 'warn-text' }, ` · просрочено ${late}`),
          canEdit && (p.access === 'moderator' ? isSuper() : p.access !== 'superadmin') && h('button', { class: 'icon-btn sm', type: 'button', title: p.access === 'moderator' ? 'Убрать PM из юнита' : 'Убрать из команды', 'aria-label': 'Убрать ' + p.name + ' из команды', onclick: () => removeMember(p) }, icon('x', 14))));
    };
    const head = () => h('div', { class: 'team-head' }, h('span', null, 'Человек'), h('span', null, 'Позиция'), h('span', null, 'Роль'), h('span', null, 'Задачи в юните'));
    const isPm = x => ['moderator', 'superadmin'].includes(x.p.access);
    const pms = rows.filter(isPm), crew = rows.filter(x => !isPm(x));
    const block = (title, list) => list.length > 0 && h('section', null,
      h('div', { class: 'section-head' }, h('h2', null, title, h('span', { class: 'muted sec-n' }, list.length))),
      h('div', { class: 'card-box team-list team-table' }, head(), list.map(row)));
    fill(body, rows.length
      ? [pms.length ? block('PM', pms) : h('section', null, h('div', { class: 'section-head' }, h('h2', null, 'PM')), emptyBlock('PM не назначен', { ic: 'users', sub: canEdit ? 'Добавьте через «Участник»' : '' })), block('Команда', crew)]
      : h('div', { class: 'card-box empty-state' }, h('h2', null, 'Команда не собрана'),
        canEdit && h('button', { class: 'btn primary', onclick: async () => { if (await addMemberDialog(u.id)) draw(); } }, icon('plus', 15), 'Добавить участника')),
    // участники без входа (только CEO): добавить, имя, позиция, кто ведёт, вкл/выкл
    isSuper() && guestSection({ onChange: draw }));
  };
  draw();
  if (isStaff()) call('getLeadPeople', {}).then(z => { zones = z; if (currentView() === 'team:' + u.id) draw(); }).catch(() => {});
}

/** Ответственный за юнит (PM) и «Сменить» — только CEO. */
function owner(u, reload) {
  const pms = pmsOf(u.id);
  const pick = anchor => {
    const all = S.people.filter(p => p.active && (p.access === 'moderator' || p.access === 'superadmin'));
    menu(anchor, [
      { title: 'Ответственный за юнит' },
      ...all.map(p => ({
        label: `${p.name} · ${ACCESS_LABELS[p.access]}`, icon: pms[0] && pms[0].id === p.id ? 'check' : null,
        action: () => send('setUnitPm', { unitId: u.id, personId: p.id }).then(members => {
          u.members = members.map(m => m.personId);
          u.pmId = p.id;
          const lu = S.units.find(x => x.id === u.id);
          if (lu) { lu.members = u.members; lu.pmId = p.id; }
          toast(`Ответственный — ${p.name}`);
          reload();
        }).catch(showErr),
      })),
      !all.length && h('p', { class: 'muted', style: { padding: '4px 10px', margin: 0 } }, 'Нет PM или CEO'),
    ]);
  };
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Ответственный'),
      isSuper() && h('button', { class: 'btn ghost sm', onclick: e => { e.stopPropagation(); pick(e.currentTarget); } }, 'Сменить')),
    h('div', { class: 'card-box owner-box' },
      pms.length
        ? pms.map(p => h('div', { class: 'owner-row' }, avatar(p, 'sm'), h('b', { 'data-pcard': p.id }, p.name), h('span', { class: 'muted' }, ACCESS_LABELS[p.access])))
        : h('p', { class: 'muted', style: { margin: 0 } }, 'Не назначен')));
}
