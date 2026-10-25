/** Панель админа (#/admin): обзор, люди и доступы, юниты, позиции, журнал. Для модераторов и супер-админов. */
import { S, me, byOrder, emptyCounts, personById, todayStr, isSuper, ACCESS_LABELS, plural, LINK_KINDS, activeDepts } from '../state.js';
import { $, h, icon, avatar, topbar, showErr, fill, toast, confirmDlg } from '../ui.js';
import { call, send } from '../api.js';
import { currentView, link, navigate } from '../router.js';
import { renderSidebar } from './sidebar.js';
import { attentionBlock, workloadBlock, roleBadge } from './home.js';
import { peopleManager, positionsManager } from './people.js';
import { activityFeed } from './feed.js';
import { openCreateUnit, unitMenu, archiveUnit, deleteUnit } from './units.js';

const TABS = [
  ['overview', 'Обзор', 'home'],
  ['people', 'Люди и доступы', 'users'],
  ['units', 'Юниты', 'board'],
  ['positions', 'Позиции', 'layers'],
  ['card', 'Карточка', 'link', 'super'],
  ['journal', 'Журнал', 'clock'],
];
const tabs = () => TABS.filter(t => t[3] !== 'super' || isSuper());

export async function renderAdmin(tab) {
  if (tab !== 'trash' && !tabs().some(t => t[0] === tab)) tab = 'overview';
  const navTab = tab === 'trash' ? 'units' : tab; // корзина — часть вкладки «Юниты»
  const page = h('div', { class: 'page' }, h('div', { class: 'boot' }, h('span', { class: 'spinner' }), 'Загрузка…'));
  const key = 'admin:' + tab;
  fill($('#main'),
    topbar([h('h1', null, 'Панель админа'), roleBadge(me())], []),
    h('nav', { class: 'admin-tabs' }, tabs().map(([id, label, ic]) =>
      link({ view: 'admin', tab: id }, { class: 'admin-tab' + (id === navTab ? ' on' : '') }, icon(ic, 15), label))),
    h('div', { class: 'view-body' }, page));

  // Свежие люди, юниты и позиции — общая основа всех вкладок
  let d, ov;
  try {
    [d, ov] = await Promise.all([
      call('getHome', { today: todayStr() }),
      tab === 'overview' || tab === 'units' ? call('getOverview', { today: todayStr() }) : tab === 'trash' ? call('getAppSettings', {}) : null,
    ]);
  } catch (e) {
    showErr(e);
    return;
  }
  if (currentView() !== key) return;
  S.units = d.units;
  S.people = d.people;
  S.departments = d.departments;
  renderSidebar();

  switch (tab) {
    case 'people': fill(page, h('div', { class: 'card-box' }, peopleManager({ search: true }))); break;
    case 'positions': fill(page, h('div', { class: 'card-box', style: { maxWidth: '720px' } }, positionsManager())); break;
    case 'card': fill(page, h('div', { class: 'card-box', style: { maxWidth: '860px' } }, linkFieldsManager())); break;
    case 'units': fill(page, unitsTable(ov)); break;
    case 'trash': fill(page, trashTable(ov)); break;
    case 'journal': fill(page, h('div', { style: { maxWidth: '760px' } }, activityFeed({ limit: 40, title: 'Журнал событий' }))); break;
    default: fill(page, overview(d, ov));
  }
}

function overview(d, ov) {
  const active = d.people.filter(p => p.active);
  const count = access => active.filter(p => p.access === access).length;
  const units = d.units.filter(u => !u.archived);
  const kpi = (label, value, to) => link(to, { class: 'kpi' }, h('div', { class: 'kpi-val' }, value), h('div', { class: 'kpi-label' }, label));
  return h('div', { class: 'admin-overview' },
    h('div', { class: 'kpis' },
      kpi('Людей в команде', active.length, { view: 'admin', tab: 'people' }),
      kpi(ACCESS_LABELS.superadmin + 'ы', count('superadmin'), { view: 'admin', tab: 'people' }),
      kpi(ACCESS_LABELS.moderator + 'ы', count('moderator'), { view: 'admin', tab: 'people' }),
      kpi('Участники', count('member'), { view: 'admin', tab: 'people' }),
      kpi('Юниты', units.length, { view: 'admin', tab: 'units' }),
      kpi('Открытых задач', d.stats.todo + d.stats.in_progress, { view: 'home' }),
      kpi('Просрочено', d.stats.overdue, { view: 'home' })),
    h('div', { class: 'home-grid' },
      h('div', { class: 'home-col' }, attentionBlock(ov), workloadBlock(ov, { all: true })),
      h('div', { class: 'home-col' },
        h('section', null,
          h('div', { class: 'section-head' }, h('h2', null, 'Быстрые действия')),
          h('div', { class: 'quick-actions-grid' },
            link({ view: 'admin', tab: 'people' }, { class: 'qa' }, icon('user', 16), 'Добавить человека'),
            h('button', { class: 'qa', onclick: openCreateUnit }, icon('plus', 16), 'Новый юнит'),
            link({ view: 'admin', tab: 'positions' }, { class: 'qa' }, icon('layers', 16), 'Позиции'),
            link({ view: 'admin', tab: 'journal' }, { class: 'qa' }, icon('clock', 16), 'Журнал событий'))),
        h('section', null,
          h('div', { class: 'section-head' }, h('h2', null, 'Ваши права')),
          h('div', { class: 'card-box rights' },
            right(true, 'Юниты, команды, задачи, поля и колонки'),
            right(true, 'Люди: добавление, позиции, вход и отключение'),
            right(isSuper(), 'Роли: назначение модераторов и супер-админов'),
            right(isSuper(), 'Профили супер-админов'))))));
}

const right = (ok, text) => h('div', { class: 'right-row' + (ok ? '' : ' no') }, icon(ok ? 'check' : 'x', 14), text);

/** Переключатель «Активные / Корзина» над таблицами юнитов. */
function unitsSwitch(trash) {
  const n = S.units.filter(u => u.archived).length;
  return h('div', { class: 'seg' },
    link({ view: 'admin', tab: 'units' }, { class: trash ? '' : 'on' }, 'Активные'),
    link({ view: 'admin', tab: 'trash' }, { class: trash ? 'on' : '' }, icon('trash', 13), 'Корзина' + (n ? ' · ' + n : '')));
}

const RETENTION = [[7, '7 дней'], [15, '15 дней'], [30, '30 дней'], [60, '2 месяца'], [90, '3 месяца'], [0, 'Никогда']];

/** Корзина: удалённые юниты со всеми данными; восстановить или удалить навсегда. Автоудаление по сроку. */
function trashTable(settings) {
  const days = settings ? settings.unitRetentionDays : 30;
  const units = S.units.filter(u => u.archived).sort((a, b) => (b.archivedAt || '').localeCompare(a.archivedAt || ''));
  const until = u => {
    if (!days || !u.archivedAt) return h('span', { class: 'muted' }, '—');
    const at = new Date(new Date(u.archivedAt).getTime() + days * 864e5);
    const left = Math.max(0, Math.ceil((at - Date.now()) / 864e5));
    return h('span', { class: left <= 3 ? 'warn-text' : '' }, at.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }), h('span', { class: 'muted' }, ' · через ' + left + ' ' + plural(left, ['день', 'дня', 'дней'])));
  };
  const retention = isSuper()
    ? h('select', {
      class: 'inp sm', value: String(days),
      onchange: e => call('updateAppSettings', { unitRetentionDays: Number(e.target.value) })
        .then(() => { toast('Срок хранения сохранён'); renderAdmin('trash'); }).catch(showErr),
    }, RETENTION.map(([v, t]) => h('option', { value: String(v) }, t)))
    : h('b', null, (RETENTION.find(r => r[0] === days) || [0, days + ' дн.'])[1]);
  return h('div', null,
    h('div', { class: 'section-head' }, unitsSwitch(true),
      h('label', { class: 'row muted', style: { gap: '8px', fontSize: '13px' } }, 'Удалять навсегда через', retention)),
    units.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'tasks admin-units' },
        h('thead', null, h('tr', null, ['Юнит', 'Задач', 'Удалён', 'Удалится навсегда', ''].map(t => h('th', null, t)))),
        h('tbody', null, units.map(u => {
          const c = u.counts || emptyCounts();
          return h('tr', null,
            h('td', null, h('span', { class: 'row', style: { gap: '8px', flexWrap: 'nowrap' } },
              h('span', { class: 'uc-icon sm', style: { background: u.color } }, u.key.slice(0, 2)),
              h('span', null, h('b', null, u.name), ' ', h('span', { class: 'muted' }, u.key)))),
            h('td', null, c.todo + c.in_progress + c.done),
            h('td', null, u.archivedAt ? new Date(u.archivedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : h('span', { class: 'muted' }, '—')),
            h('td', null, until(u)),
            h('td', { style: { width: '240px', textAlign: 'right' } },
              h('button', { class: 'btn sm', onclick: () => archiveUnit(u, false) }, 'Восстановить'), ' ',
              h('button', { class: 'btn ghost sm danger-text', onclick: () => deleteUnit(u) }, 'Удалить навсегда')));
        }))))
      : h('div', { class: 'card-box empty-state' }, h('p', { style: { margin: 0 } }, 'Корзина пуста. Удалённые юниты хранятся здесь со всеми задачами и историей.')));
}

function unitsTable(ov) {
  const units = S.units.filter(u => !u.archived).sort(byOrder);
  const noTeam = new Set(ov ? ov.unitsNoTeam : []);
  return h('div', null,
    h('div', { class: 'section-head' }, unitsSwitch(false), h('button', { class: 'btn primary sm', onclick: openCreateUnit }, icon('plus', 14), 'Юнит')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'tasks admin-units' },
      h('thead', null, h('tr', null, ['Юнит', 'Команда', 'Открыто', 'Просрочено', 'Готово', ''].map(t => h('th', null, t)))),
      h('tbody', null, units.map(u => {
        const c = u.counts || emptyCounts();
        const total = c.todo + c.in_progress + c.done;
        const team = (u.members || []).map(personById).filter(Boolean);
        return h('tr', { class: u.archived ? 'archived' : '', onclick: e => { if (!e.target.closest('button')) navigate({ unit: u.id, mode: 'board' }); } },
          h('td', null, h('span', { class: 'row', style: { gap: '8px', flexWrap: 'nowrap' } },
            h('span', { class: 'uc-icon sm', style: { background: u.color } }, u.key.slice(0, 2)),
            h('span', null, h('b', null, u.name), ' ', h('span', { class: 'muted' }, u.key)),
            u.archived && h('span', { class: 'badge' }, 'архив'))),
          h('td', null, team.length
            ? h('span', { class: 'avatars-stack', title: team.map(p => p.name).join(', ') }, team.slice(0, 6).map(p => avatar(p, 'sm')))
            : h('span', { class: noTeam.has(u.id) ? 'warn-text' : 'muted' }, 'нет команды')),
          h('td', null, c.todo + c.in_progress),
          h('td', null, c.overdue ? h('span', { class: 'warn-text' }, c.overdue) : h('span', { class: 'muted' }, '0')),
          h('td', null, total ? Math.round((c.done / total) * 100) + '%' : '—'),
          h('td', { style: { width: '120px', textAlign: 'right' } },
            link({ unit: u.id, mode: 'settings' }, { class: 'btn ghost sm' }, 'Настройки'),
            h('button', { class: 'icon-btn sm', title: 'Действия', onclick: e => { e.stopPropagation(); unitMenu(e.currentTarget, u); } }, icon('more'))));
      })))));
}

/* ---------- карточка: поля-ссылки ---------- */

/** Ссылки в карточке задачи (Figma, GitHub…): общий набор для всех юнитов и кому из позиций их видно. Только супер-админ. */
function linkFieldsManager() {
  const box = h('div', { class: 'rows people-list' });
  const sorted = () => [...S.linkFields].sort(byOrder);
  const draw = () => fill(box, S.linkFields.length ? sorted().map(row) : h('p', { class: 'muted', style: { padding: '12px 14px', margin: 0 } }, 'Полей нет'));
  const save = (f, patch) => send('updateLinkField', { id: f.id, ...patch }).then(saved => { Object.assign(f, saved); draw(); }).catch(showErr);
  const move = (f, dir) => {
    const list = sorted();
    const i = list.indexOf(f);
    list.splice(i + dir, 0, list.splice(i, 1)[0]);
    list.forEach((x, k) => { x.order = k + 1; });
    draw();
    send('reorderLinkFields', { ids: list.map(x => x.id) }).catch(showErr);
  };
  const remove = async f => {
    if (!(await confirmDlg(`Удалить поле «${f.name}» навсегда? Ссылки этого поля пропадут из всех задач. Если поле может понадобиться — лучше скрыть.`, { ok: 'Удалить', danger: true }))) return;
    await send('deleteLinkField', { id: f.id });
    S.linkFields = S.linkFields.filter(x => x !== f);
    draw();
  };
  // Кому видно: «Всем» или выбранные позиции; клик по позиции включает/выключает её
  const audience = f => {
    const all = !f.positions.length;
    const toggle = id => save(f, { positions: f.positions.includes(id) ? f.positions.filter(x => x !== id) : [...f.positions, id] });
    return h('div', { class: 'aud' },
      h('button', { class: 'aud-chip' + (all ? ' on' : ''), title: 'Видно всем позициям', onclick: () => { if (!all) save(f, { positions: [] }); } }, 'Всем'),
      activeDepts().map(d => {
        const on = f.positions.includes(d.id);
        return h('button', {
          class: 'aud-chip' + (on ? ' on' : ''), title: on ? 'Скрыть от позиции' : 'Показать позиции',
          style: on ? { background: `color-mix(in srgb, ${d.color} 16%, transparent)`, color: d.color, borderColor: 'transparent' } : null,
          onclick: () => toggle(d.id),
        }, h('span', { class: 'dot', style: { background: d.color } }), d.name);
      }));
  };
  const kindSelect = f => h('select', { class: 'inp sm', value: f.kind, title: 'Иконка', style: { width: 'auto' }, onchange: e => save(f, { kind: e.target.value }) },
    Object.entries(LINK_KINDS).map(([k, v]) => h('option', { value: k }, v)));
  const row = (f, i, arr) => h('div', { class: 'lf-row' + (f.archived ? ' inactive' : '') },
    h('div', { class: 'lf-top' },
      h('span', { class: 'lf-ic' }, icon(f.kind === 'link' ? 'link' : f.kind, 16)),
      h('input', { class: 'inp', value: f.name, maxlength: 40, style: { flex: 1 }, onchange: e => { if (e.target.value.trim()) save(f, { name: e.target.value }); } }),
      kindSelect(f),
      h('button', { class: 'icon-btn sm', title: 'Выше', disabled: i === 0, onclick: () => move(f, -1) }, '↑'),
      h('button', { class: 'icon-btn sm', title: 'Ниже', disabled: i === arr.length - 1, onclick: () => move(f, 1) }, '↓'),
      h('button', { class: 'btn ghost sm', onclick: () => save(f, { archived: !f.archived }) }, f.archived ? 'Показать' : 'Скрыть'),
      h('button', { class: 'icon-btn sm', title: 'Удалить', onclick: () => remove(f).catch(showErr) }, icon('trash', 14))),
    h('div', { class: 'lf-aud' }, h('span', { class: 'hint' }, 'Кому видно:'), audience(f)));
  const name = h('input', { class: 'inp', placeholder: 'Например, Jira или Notion', maxlength: 40 });
  const add = async () => {
    if (!name.value.trim()) return name.focus();
    S.linkFields.push(await send('createLinkField', { name: name.value, kind: 'link' }));
    name.value = '';
    draw();
    name.focus();
  };
  name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); add().catch(showErr); } });
  draw();
  return h('div', null,
    h('h2', { style: { marginTop: 0, fontSize: '16px' } }, 'Ссылки в карточке задачи'),
    h('p', { class: 'hint', style: { marginTop: 0 } }, 'Общие для всех юнитов. Участник видит поле, только если оно открыто его позиции; администраторы видят всё. Скрытые от позиции ссылки не уходят ей даже в браузер.'),
    box,
    h('div', { class: 'sub-title' }, 'Добавить поле'),
    h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, name, h('button', { class: 'btn primary', onclick: () => add().catch(showErr) }, icon('plus', 14), 'Добавить')));
}
