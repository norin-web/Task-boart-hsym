/**
 * Вкладки юнита «Обзор» (#/u/:id/overview) и «Команда» (#/u/:id/team). Шапка с крошками и вкладками — unitnav.js.
 * Обзор: описание, цифры, что в работе и что требует внимания, ответственный и команда коротко.
 * Команда: люди юнита — роль, позиция, открытые задачи в юните; добавить участника — руководителям.
 */
import { S, me, isSuper, isStaff, todayStr, ACCESS_LABELS, personById, deptById, taskDone, plural, columns, colColor, appStatusById } from '../state.js';
import { $, h, icon, avatar, showErr, fill, menu, toast, emptyBlock, skeleton, modal, confirmDlg } from '../ui.js';
import { call, send } from '../api.js';
import { currentView, link } from '../router.js';
import { openCreateApp, openNewAppTask, pmsOf, openAppCard, appStatusCell } from './apps.js';
import { attention, inProgress, recent } from './ceo.js';
import { unitHeader } from './unitnav.js';
import { addMemberDialog, applyMembers } from './people.js';
import { sparkline, openSeries } from './charts.js';

export async function renderUnitPage() {
  const u = S.board.unit;
  const key = 'overview:' + u.id;
  const page = h('div', { class: 'page unit-page' }, skeleton());
  const actions = h('div', { class: 'row', style: { gap: '8px' } });
  const draw = () => fill($('#main'), ...unitHeader('overview', [actions]), h('div', { class: 'view-body' }, page));
  draw();

  async function load() {
    const rm = ((me() || {}).access) === 'rm';
    let apps, d, rd, lv;
    try {
      [apps, d, rd, lv] = await Promise.all([call('listApps', { unitId: u.id }), rm ? null : call('getCeoDashboard', { today: todayStr() }),
        rm ? call('getRmDashboard', {}) : null, rm ? call('getReleaseHistory', { result: 'live' }) : null]);
    } catch (e) { return showErr(e); }
    if (currentView() !== key) return;
    // приложения юнита — в общий список (их ищут формы «Новая задача» и счётчик вкладки)
    S.apps = [...S.apps.filter(a => a.unitId !== u.id), ...apps.map(({ requests, active, ...a }) => a)];
    draw();
    if (rm) {
      // релиз-менеджеру в юните нужно только своё: сколько в очереди, на ревью, в реджекте и в сторе; приложения и команда
      const n = list => (list || []).filter(x => x.unitId === u.id).length;
      const rel = (label, count, tone) => h('div', { class: 'cs' + (tone && count ? ' ' + tone : '') }, h('div', { class: 'cs-n' }, count), h('div', { class: 'cs-label' }, label));
      fill(page,
        h('div', { class: 'cs-row unit-stats' },
          rel('В очереди на релиз', n(rd.queue)), rel('На ревью Apple', n(rd.review)), rel('Реджекты', n(rd.rejected), 'danger'), rel('В App Store', n(lv.rows))),
        h('div', { class: 'home-grid' },
          h('div', { class: 'home-col' }, appsBrief(u, apps, load)),
          h('div', { class: 'home-col' }, teamBrief(u))));
      return;
    }
    const mine = x => x.app && x.app.unitId === u.id;
    const ud = { ...d, attention: d.attention.filter(mine), inProgress: d.inProgress.filter(mine), recent: d.recent.filter(mine) };
    const open = S.board.tasks.filter(t => !t.archived && !taskDone(t));
    const today = todayStr();
    const late = open.filter(t => t.dueDate && t.dueDate < today).length;
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
        stat(open.length, 'Открытых задач', 'list', '', sparkline(openSeries(S.board.tasks.filter(t => !t.archived).map(t => ({ createdAt: t.createdAt, doneAt: t.doneAt })))), 'open'),
        stat(late, 'Просрочено', 'list', late ? 'danger' : '', sparkline(Array(14).fill(late)), 'late')),
      h('div', { class: 'home-grid' },
        h('div', { class: 'home-col' }, inProgress(ud, load, { brief: true }), appsBrief(u, apps, load), attention(ud, load, { two: true })),
        h('div', { class: 'home-col' }, tasksByColumn(u, open), teamBrief(u), owner(u, load), recent(ud, load, { empty: 'За 30 дней статусы приложений юнита не менялись' }))));
  }

  load();
}

/** Команда на обзоре: кто, позиция и сколько задач в работе; самые загруженные сверху. */
function teamBrief(u) {
  const today = todayStr();
  const rows = S.board.members.map(m => {
    const p = personById(m.personId);
    const t = p ? S.board.tasks.filter(x => !x.archived && !taskDone(x) && x.assigneeId === p.id) : [];
    return p && { p, pos: (deptById(m.departmentId) || deptById(p.positionId) || {}).name || '', n: t.length, late: t.filter(x => x.dueDate && x.dueDate < today).length };
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
  const all = S.board.tasks.filter(t => !t.archived);
  const cols = columns().map(c => ({ c, n: all.filter(t => t.status === c.id).length }));
  const total = all.length;
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, `Задачи · ${open.length} открыто`)),
    total
      ? h('div', { class: 'card-box col-sum' },
        h('div', { class: 'col-sum-bar', 'aria-hidden': 'true' }, cols.filter(x => x.n).map(x => h('span', { style: { flex: x.n, background: colColor(x.c) } }))),
        h('div', { class: 'col-sum-list' }, cols.filter(x => x.c.kind !== 'done').map(x => h('span', { class: 'col-sum-item' }, `${x.c.name} ${x.n}`))))
      : emptyBlock('Задач пока нет', { ic: 'list' }));
}

/** Приложения юнита коротко: иконка, название, статус; клик — карточка. Все — на вкладке «Приложения». */
function appsBrief(u, apps, reload) {
  const LIMIT = 3;
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Приложения'),
      link({ unit: u.id, mode: 'apps' }, { class: 'btn ghost sm' }, 'Все')),
    apps.length
      ? h('div', { class: 'card-box app-brief' }, apps.slice(0, LIMIT).map(a => h('button', { class: 'app-brief-row', onclick: () => openAppCard(a, reload) },
        h('span', { class: 'app-brief-name' }, a.name),
        h('span', { class: 'app-brief-st' }, appStatusCell(appStatusById(a.status), a)))))
      : emptyBlock('Приложений пока нет', { ic: 'app' }));
}

/** Вкладка «Команда»: участники юнита — роль, позиция в юните, открытые и просроченные задачи здесь. */
export function renderUnitTeam() {
  const u = S.board.unit;
  const today = todayStr();
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
    const mine = id => S.board.tasks.filter(t => !t.archived && !taskDone(t) && t.assigneeId === id);
    fill($('#main'), ...unitHeader('team', [
      canEdit && h('button', { class: 'btn primary', onclick: async () => { if (await addMemberDialog(u.id)) draw(); } }, icon('plus', 15), h('span', { class: 'btn-label' }, 'Участник')),
    ]), h('div', { class: 'view-body' }, body));
    const row = ({ m, p }) => {
      const t = mine(p.id), late = t.filter(x => x.dueDate && x.dueDate < today).length;
      return h('div', { class: 'team-row' },
        avatar(p, 'sm'),
        h('b', { class: 'team-who', 'data-pcard': p.id }, p.name),
        h('span', { class: 'muted team-pos' }, (deptById(m.departmentId) || deptById(p.positionId) || {}).name || '—'),
        h('span', { class: 'muted team-role' }, ACCESS_LABELS[p.access] || '',
          p.access === 'lead' && isStaff() && h('button', { class: 'link-btn', style: { marginLeft: '8px' }, title: 'Позиции лида и выданные ему люди', onclick: () => zoneDialog(p) },
            'зона' + ((zones[p.id] || []).length ? ' · +' + zones[p.id].length : ''))),
        h('span', { class: 'team-load' }, t.length ? `${t.length} ${plural(t.length, ['задача', 'задачи', 'задач'])}` : null,
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
        canEdit && h('button', { class: 'btn primary', onclick: async () => { if (await addMemberDialog(u.id)) draw(); } }, icon('plus', 15), 'Добавить участника')));
  };
  draw();
  if (isStaff()) call('getLeadPeople', {}).then(z => { zones = z; if (currentView() === 'team:' + u.id) draw(); }).catch(() => {});
}

/** Ответственный за юнит (PM) и «Сменить» — только CEO. */
function owner(u, reload) {
  const pms = pmsOf(u.id);
  const pick = anchor => {
    const all = S.people.filter(p => p.active && p.access === 'moderator');
    menu(anchor, [
      { title: 'Ответственный за юнит' },
      ...all.map(p => ({
        label: p.name, icon: pms.some(x => x.id === p.id) ? 'check' : null,
        action: () => send('setUnitPm', { unitId: u.id, personId: p.id }).then(members => {
          u.members = members.map(m => m.personId);
          const lu = S.units.find(x => x.id === u.id);
          if (lu) lu.members = u.members;
          toast(`Ответственный — ${p.name}`);
          reload();
        }).catch(showErr),
      })),
      !all.length && h('p', { class: 'muted', style: { padding: '4px 10px', margin: 0 } }, 'Нет людей с ролью ' + ACCESS_LABELS.moderator),
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
