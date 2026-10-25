/** Панель админа (#/admin): обзор, люди и доступы, юниты, позиции, карточка, журнал. Для модераторов и супер-админов. */
import Sortable from 'sortablejs';
import { AUTO_ARCHIVE, HIDE_DONE } from '../state.js';
import { reviewSection } from './settings.js';
import { S, LS, me, byOrder, emptyCounts, personById, todayStr, isSuper, ACCESS_LABELS, plural, LINK_KINDS, activeDepts, deptById, activeTeams } from '../state.js';
import { $, h, icon, avatar, topbar, showErr, fill, toast, confirmDlg, menu, modal, field } from '../ui.js';
import { call, send } from '../api.js';
import { currentView, link, navigate, rerender } from '../router.js';
import { renderSidebar } from './sidebar.js';
import { attentionBlock, workloadBlock, roleBadge } from './home.js';
import { peopleManager, positionsManager, teamsManager, addPersonDialog, teamChips, positionChips } from './people.js';
import { openCreateTask } from './task.js';
import { activityFeed } from './feed.js';
import { openCreateUnit, unitMenu, archiveUnit, deleteUnit } from './units.js';

const TABS = [
  ['overview', 'Обзор', 'home'],
  ['people', 'Люди и доступы', 'users'],
  ['units', 'Юниты', 'board'],
  ['card', 'Карточка', 'link', 'super'],
  ['automations', 'Автоматизации', 'progress'],
  ['journal', 'Журнал', 'clock'],
];
const tabs = () => TABS.filter(t => t[3] !== 'super' || isSuper());

// Старые вкладки: позиции — внутри «Люди и доступы», шаблоны — в «Автоматизациях»
const MOVED = { positions: ['people', 'positions'], teams: ['people', 'teams'], templates: ['automations'] };

export async function renderAdmin(tab) {
  if (MOVED[tab]) {
    if (MOVED[tab][1]) LS.set('peopleSub', MOVED[tab][1]);
    tab = MOVED[tab][0];
  }
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
  if (d.teams) S.teams = d.teams;
  renderSidebar();

  switch (tab) {
    case 'people': fill(page, peopleTab()); break;
    case 'automations': fill(page, automationsTab()); break;
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
  // Плитка: клик показывает список прямо здесь (без перехода на другую вкладку)
  const kpi = (label, value, list) => h('button', {
    class: 'kpi', title: 'Показать', onclick: e => { e.stopPropagation(); kpiPopover(e.currentTarget, label, list()); },
  }, h('div', { class: 'kpi-val' }, value), h('div', { class: 'kpi-label' }, label));
  const peopleList = arr => () => arr.length ? arr.map(p => h('div', { class: 'kp-row' }, avatar(p, 'sm'),
    h('span', { class: 'kp-name' }, p.name), h('span', { class: 'kp-sub' }, teamChips(p.teamIds || []), positionChips(p.positionIds || [])))) : [h('p', { class: 'muted kp-empty' }, 'Никого')];
  const unitList = () => units.length ? units.map(u => {
    const c = u.counts || emptyCounts();
    return link({ unit: u.id, mode: 'board' }, { class: 'kp-row kp-link' },
      h('span', { class: 'uc-icon sm', style: { background: u.color } }, u.key.slice(0, 2)), h('span', { class: 'kp-name' }, u.name),
      h('span', { class: 'kp-sub muted' }, (c.todo + c.in_progress) + ' откр.' + (c.overdue ? ' · ' + c.overdue + ' просроч.' : '')));
  }) : [h('p', { class: 'muted kp-empty' }, 'Юнитов нет')];
  return h('div', { class: 'admin-overview' },
    h('div', { class: 'kpis' },
      kpi('Людей в команде', active.length, peopleList(active)),
      kpi(ACCESS_LABELS.superadmin + 'ы', count('superadmin'), peopleList(active.filter(p => p.access === 'superadmin'))),
      kpi(ACCESS_LABELS.moderator + 'ы', count('moderator'), peopleList(active.filter(p => p.access === 'moderator'))),
      kpi('Участники', count('member'), peopleList(active.filter(p => p.access === 'member'))),
      kpi('Юниты', units.length, unitList)),
    h('div', { class: 'home-grid' },
      h('div', { class: 'home-col' }, attentionBlock(ov), workloadBlock(ov, { all: true })),
      h('div', { class: 'home-col' },
        h('section', null,
          h('div', { class: 'section-head' }, h('h2', null, 'Быстрые действия')),
          // всё открывается окном здесь же
          h('div', { class: 'quick-actions-grid' },
            h('button', { class: 'qa', onclick: () => openCreateTask() }, icon('checklist', 16), 'Новая задача'),
            h('button', { class: 'qa', onclick: () => addPersonDialog(() => rerender()) }, icon('user', 16), 'Добавить человека'),
            h('button', { class: 'qa', onclick: openCreateUnit }, icon('board', 16), 'Новый юнит'),
            h('button', { class: 'qa', onclick: () => editTemplate(null, () => toast('Шаблон создан')) }, icon('copy', 16), 'Новый шаблон'))),
        h('section', null,
          h('div', { class: 'section-head' }, h('h2', null, 'Ваши права')),
          h('div', { class: 'card-box rights' },
            right(true, 'Юниты, команды, задачи, поля и колонки'),
            right(true, 'Люди: добавление, позиции, вход и отключение'),
            right(isSuper(), 'Роли: назначение модераторов и супер-админов'),
            right(isSuper(), 'Профили супер-админов'))))));
}

/** Список у плитки обзора: открывается рядом, закрывается кликом мимо. */
function kpiPopover(anchor, title, rows) {
  menu(anchor, [{ title }, h('div', { class: 'kp-list' }, rows)]);
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

/**
 * Юниты: строка юнита (задачи, ревьюер, действия) и под ней — команды чипами «UX/UI Designers · 2» с аватарами.
 * Клик по чипу показывает людей этой команды прямо под строкой; клик по названию — доска юнита.
 */
function unitsTable(ov) {
  const units = S.units.filter(u => !u.archived).sort(byOrder);
  const noTeam = new Set(ov ? ov.unitsNoTeam : []);
  const open = {}; // юнит → раскрытая команда
  const list = h('div', { class: 'un-list' });

  const teamsOf = u => {
    const ppl = (u.members || []).map(personById).filter(p => p && p.active);
    const groups = activeTeams().map(t => ({ t, people: ppl.filter(p => (p.teamIds || []).includes(t.id)) })).filter(g => g.people.length);
    const loose = ppl.filter(p => !(p.teamIds || []).some(id => activeTeams().some(t => t.id === id)));
    if (loose.length) groups.push({ t: { id: '', name: 'Без команды', color: 'var(--muted)' }, people: loose });
    return groups;
  };
  const reviewers = u => {
    const r = u.settings.review || {};
    if (!r.column) return [];
    return [...new Set([...Object.values(r.byPosition || {}), r.default].filter(Boolean))].map(personById).filter(Boolean);
  };

  const row = u => {
    const c = u.counts || emptyCounts();
    const openTasks = c.todo + c.in_progress, total = c.todo + c.in_progress + c.done;
    const groups = teamsOf(u);
    const shown = groups.find(g => g.t.id === open[u.id]);
    const rv = reviewers(u);
    return h('div', { class: 'un-row' },
      h('div', { class: 'un-main' },
        link({ unit: u.id, mode: 'board' }, { class: 'un-name', title: 'Открыть доску' },
          h('span', { class: 'uc-icon sm', style: { background: u.color } }, u.key.slice(0, 2)),
          h('b', null, u.name), h('span', { class: 'muted' }, u.key)),
        h('span', { class: 'un-stat', title: 'Открытые / всего' }, icon('checklist', 13), h('b', null, openTasks), h('span', { class: 'muted' }, ' / ' + total),
          c.overdue > 0 && h('span', { class: 'warn-text', title: 'Просрочено' }, ' · ' + c.overdue + ' просроч.')),
        h('span', { class: 'un-review', title: rv.length ? 'Ревьюеры: ' + rv.map(p => p.name).join(', ') : 'Ревью не настроено' },
          icon('eye', 13), rv.length ? h('span', { class: 'avatars-stack' }, rv.slice(0, 3).map(p => avatar(p, 'sm'))) : h('span', { class: 'muted' }, 'нет')),
        h('span', { class: 'un-actions' },
          link({ unit: u.id, mode: 'settings' }, { class: 'icon-btn sm', title: 'Настройки юнита' }, icon('settings', 15)),
          h('button', { class: 'icon-btn sm', title: 'Действия', onclick: e => { e.stopPropagation(); unitMenu(e.currentTarget, u); } }, icon('more')))),
      h('div', { class: 'un-teams' },
        groups.length ? groups.map(g => h('button', {
          class: 'un-team' + (open[u.id] === g.t.id ? ' on' : ''), title: g.people.map(p => p.name).join(', '),
          onclick: () => { open[u.id] = open[u.id] === g.t.id ? undefined : g.t.id; draw(); },
        }, h('span', { class: 'dot', style: { background: g.t.color } }), g.t.name, h('span', { class: 'muted' }, '· ' + g.people.length),
        h('span', { class: 'avatars-stack' }, g.people.slice(0, 4).map(p => avatar(p, 'sm')))))
          : h('span', { class: noTeam.has(u.id) ? 'warn-text' : 'muted' }, 'В юните пока никого')),
      shown && h('div', { class: 'un-people' }, shown.people.map(p => h('span', { class: 'un-person' }, avatar(p, 'sm'), p.name,
        h('span', { class: 'muted' }, (p.positionIds || []).map(id => (deptById(id) || {}).name).filter(Boolean).join(', '))))));
  };
  const draw = () => fill(list, units.length ? units.map(row) : h('p', { class: 'muted', style: { padding: '12px 14px', margin: 0 } }, 'Юнитов пока нет'));
  draw();
  return h('div', null,
    h('div', { class: 'section-head' }, unitsSwitch(false), h('button', { class: 'btn primary sm', onclick: openCreateUnit }, icon('plus', 14), 'Юнит')),
    list);
}

/* ---------- карточка: поля-ссылки ---------- */

const kindIcon = k => icon(k === 'link' || !k ? 'link' : k, 16);
/** Иконка по названию нового поля: «Figma» → figma, «GitHub» → github… */
const guessKind = name => {
  const n = name.toLowerCase();
  return /figma/.test(n) ? 'figma' : /git/.test(n) ? 'github' : /drive|диск/.test(n) ? 'drive' : /meta|мета/.test(n) ? 'meta' : 'link';
};

/** Ссылки в карточке задачи (Figma, GitHub…): общий набор для всех юнитов и кому из позиций их видно. Только супер-админ. */
function linkFieldsManager() {
  const list = h('div', { class: 'lf-list' });
  const sorted = () => [...S.linkFields].sort(byOrder);
  const save = (f, patch) => send('updateLinkField', { id: f.id, ...patch }).then(saved => { Object.assign(f, saved); return f; });
  const remove = async f => {
    if (!(await confirmDlg(`Удалить поле «${f.name}» навсегда? Ссылки этого поля пропадут из всех задач. Если поле может понадобиться — лучше скрыть.`, { ok: 'Удалить', danger: true }))) return;
    await send('deleteLinkField', { id: f.id });
    S.linkFields = S.linkFields.filter(x => x !== f);
    draw();
  };

  // «Кому видно»: кнопка с текущим выбором → меню с галочками; меню не закрывается, пока отмечаешь
  const audienceLabel = f => {
    const ds = activeDepts().filter(d => f.positions.includes(d.id));
    if (!ds.length) return [icon('users', 14), h('span', null, 'Всем')];
    return [h('span', { class: 'aud-dots' }, ds.slice(0, 4).map(d => h('span', { class: 'dot', style: { background: d.color } }))),
      h('span', { class: 'aud-text' }, ds.length <= 2 ? ds.map(d => d.name).join(', ') : `${ds.length} ${plural(ds.length, ['позиция', 'позиции', 'позиций'])}`)];
  };
  const audienceMenu = (btn, f) => {
    const box = h('div');
    const set = positions => save(f, { positions }).then(() => { fill(btn, ...audienceLabel(f), icon('chevron', 14)); paint(); }).catch(showErr);
    const item = (on, label, dot, onclick) => h('button', { class: 'menu-item aud-item' + (on ? ' on' : ''), role: 'menuitemcheckbox', 'aria-checked': String(on), onclick },
      h('span', { class: 'aud-check' }, on && icon('check', 13)), dot, label);
    const paint = () => fill(box,
      item(!f.positions.length, 'Всем позициям', h('span', { class: 'dot', style: { background: 'var(--muted)' } }), () => { if (f.positions.length) set([]); }),
      h('div', { class: 'menu-sep' }),
      activeDepts().map(d => {
        const on = f.positions.includes(d.id);
        return item(on, d.name, h('span', { class: 'dot', style: { background: d.color } }),
          () => set(on ? f.positions.filter(x => x !== d.id) : [...f.positions, d.id]));
      }),
      h('div', { class: 'menu-sep' }),
      h('div', { class: 'hint aud-note' }, 'Администраторы видят все поля'));
    paint();
    menu(btn, [{ title: 'Кому видно' }, box]);
  };

  const row = f => {
    const name = h('input', {
      class: 'lf-name', value: f.name, maxlength: 40, 'aria-label': 'Название',
      onchange: e => { const v = e.target.value.trim(); if (!v) { e.target.value = f.name; return; } save(f, { name: v }).catch(showErr); },
      onkeydown: e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { e.target.value = f.name; e.target.blur(); } },
    });
    const aud = h('button', { class: 'aud-btn', title: 'Кому видно', onclick: e => { e.stopPropagation(); audienceMenu(aud, f); } }, ...audienceLabel(f), icon('chevron', 14));
    return h('div', { class: 'lf-row' + (f.archived ? ' off' : ''), dataset: { id: f.id } },
      h('span', { class: 'drag', title: 'Перетащите, чтобы изменить порядок' }, icon('grip', 16)),
      h('span', { class: 'lf-ic' }, kindIcon(f.kind)),
      name,
      f.archived && h('span', { class: 'badge' }, 'скрыто'),
      aud,
      h('button', {
        class: 'icon-btn sm', title: f.archived ? 'Показать в карточках' : 'Скрыть из карточек (ссылки сохранятся)',
        onclick: () => save(f, { archived: !f.archived }).then(draw).catch(showErr),
      }, icon(f.archived ? 'eyeOff' : 'eye', 15)),
      h('button', { class: 'icon-btn sm', title: 'Удалить навсегда', onclick: () => remove(f).catch(showErr) }, icon('trash', 15)));
  };

  let sortable = null;
  const draw = () => {
    fill(list, S.linkFields.length ? sorted().map(row) : h('p', { class: 'muted', style: { padding: '12px 14px', margin: 0 } }, 'Полей нет'));
    if (sortable) sortable.destroy();
    sortable = Sortable.create(list, {
      handle: '.drag', animation: 150, ghostClass: 'sortable-ghost', forceFallback: true, fallbackTolerance: 4,
      onEnd: () => {
        const ids = [...list.children].map(el => el.dataset.id).filter(Boolean);
        ids.forEach((id, i) => { const f = S.linkFields.find(x => x.id === id); if (f) f.order = i + 1; });
        send('reorderLinkFields', { ids }).catch(showErr);
      },
    });
  };

  // Новое поле: иконку угадываем по названию, пока её не выбрали вручную
  let kind = 'link', picked = false;
  const kindBtn = h('button', { class: 'kind-btn', title: 'Иконка поля', onclick: e => {
    e.stopPropagation();
    menu(kindBtn, [{ title: 'Иконка' }, ...Object.entries(LINK_KINDS).map(([k, v]) => ({
      label: v, icon: k === 'link' ? 'link' : k, action: () => { kind = k; picked = true; fill(kindBtn, kindIcon(kind), icon('chevron', 12)); },
    }))]);
  } }, kindIcon(kind), icon('chevron', 12));
  const name = h('input', { class: 'inp', placeholder: 'Например, Jira или Notion', maxlength: 40, oninput: () => {
    if (picked) return;
    kind = guessKind(name.value);
    fill(kindBtn, kindIcon(kind), icon('chevron', 12));
  } });
  const add = async () => {
    if (!name.value.trim()) return name.focus();
    S.linkFields.push(await send('createLinkField', { name: name.value, kind }));
    name.value = '';
    kind = 'link'; picked = false;
    fill(kindBtn, kindIcon(kind), icon('chevron', 12));
    draw();
    name.focus();
  };
  name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); add().catch(showErr); } });
  draw();
  return h('div', null,
    h('h2', { style: { marginTop: 0, fontSize: '16px' } }, 'Ссылки в карточке задачи'),
    h('p', { class: 'hint', style: { marginTop: 0 } }, 'Общие для всех юнитов. Участник видит поле, только если оно открыто его позиции. Скрытые ссылки не уходят ему даже в браузер.'),
    list,
    h('div', { class: 'sub-title' }, 'Добавить поле'),
    h('div', { class: 'lf-add' }, kindBtn, name, h('button', { class: 'btn primary', onclick: () => add().catch(showErr) }, icon('plus', 14), 'Добавить')));
}

/* ---------- шаблоны задач ---------- */

const DUE_DAYS = [[-1, 'Без срока'], [0, 'Сегодня'], [1, 'Завтра'], [2, 'Через 2 дня'], [3, 'Через 3 дня'], [5, 'Через 5 дней'], [7, 'Через неделю'], [14, 'Через 2 недели'], [30, 'Через месяц']];

/** Шаблоны задач: общие для всех юнитов. Порядок — перетаскиванием, правка — в окне. */
function templatesManager() {
  const list = h('div', { class: 'lf-list' });
  const sorted = () => [...S.templates].sort(byOrder);
  const remove = async t => {
    if (!(await confirmDlg(`Удалить шаблон «${t.name}»? Задачи, созданные по нему, останутся.`, { ok: 'Удалить', danger: true }))) return;
    await send('deleteTemplate', { id: t.id });
    S.templates = S.templates.filter(x => x !== t);
    draw();
  };
  const row = t => {
    const d = deptById(t.departmentId);
    const tm = S.teams.find(x => x.id === t.teamId);
    return h('div', { class: 'lf-row', dataset: { id: t.id } },
      h('span', { class: 'drag', title: 'Перетащите, чтобы изменить порядок' }, icon('grip', 16)),
      h('button', { class: 'tpl-open', onclick: () => editTemplate(t, draw) },
        h('span', { class: 'tpl-name' }, t.name),
        h('span', { class: 'tpl-meta' },
          tm && h('span', { class: 'chip', style: { background: `color-mix(in srgb, ${tm.color} 16%, transparent)`, color: tm.color } }, tm.name),
          d && h('span', { class: 'chip', title: 'Позиция', style: { background: `color-mix(in srgb, ${d.color} 16%, transparent)`, color: d.color } }, d.name),
          t.dueDays >= 0 && h('span', { class: 'chip' }, icon('calendar', 11), (DUE_DAYS.find(x => x[0] === t.dueDays) || [0, ''])[1]),
          t.assigneeId && personById(t.assigneeId) && h('span', { class: 'chip' }, icon('user', 11), personById(t.assigneeId).name),
          t.checklist.length > 0 && h('span', { class: 'chip' }, icon('checklist', 11), t.checklist.length + ' п.'),
          Object.keys(t.links || {}).length > 0 && h('span', { class: 'chip' }, icon('link', 11), Object.keys(t.links).length))),
      h('button', { class: 'icon-btn sm', title: 'Изменить', onclick: () => editTemplate(t, draw) }, icon('edit', 14)),
      h('button', { class: 'icon-btn sm', title: 'Удалить', onclick: () => remove(t).catch(showErr) }, icon('trash', 15)));
  };
  let sortable = null;
  const draw = () => {
    fill(list, S.templates.length ? sorted().map(row) : h('p', { class: 'muted', style: { padding: '12px 14px', margin: 0 } }, 'Шаблонов пока нет'));
    if (sortable) sortable.destroy();
    sortable = Sortable.create(list, {
      handle: '.drag', animation: 150, ghostClass: 'sortable-ghost', forceFallback: true, fallbackTolerance: 4,
      onEnd: () => {
        const ids = [...list.children].map(el => el.dataset.id).filter(Boolean);
        ids.forEach((id, i) => { const t = S.templates.find(x => x.id === id); if (t) t.order = i + 1; });
        send('reorderTemplates', { ids }).catch(showErr);
      },
    });
  };
  draw();
  return h('div', null,
    h('div', { class: 'section-head' }, h('h2', { style: { margin: 0, fontSize: '16px' } }, 'Шаблоны задач'),
      h('button', { class: 'btn primary sm', onclick: () => editTemplate(null, draw) }, icon('plus', 14), 'Шаблон')),
    h('p', { class: 'hint', style: { marginTop: 0 } }, 'Заготовки для повторяющихся задач: при создании задачи выберите шаблон — подставятся название, описание, позиция, срок и чеклист.'),
    list);
}

function editTemplate(t, onSaved) {
  const name = h('input', { class: 'inp', value: t ? t.name : '', maxlength: 60, placeholder: 'Например, Релиз или Баг' });
  const title = h('input', { class: 'inp', value: t ? t.title : '', maxlength: 500, placeholder: 'Название задачи (по умолчанию — как у шаблона)' });
  const desc = h('textarea', { class: 'inp', rows: 4, value: t ? t.description : '', maxlength: 20000, placeholder: 'Описание: контекст, критерии готовности…' });
  // Команда (дизайнеры, девы…): в «Исполнителе» остаются только её люди; позиция — отдельно (кто видит задачу)
  let assignee = t ? t.assigneeId : '';
  const inTeam = (p, team) => !team || (p.teamIds || []).includes(team);
  const assigneeBox = h('div');
  const drawAssignee = () => fill(assigneeBox, h('select', { class: 'inp', value: assignee, onchange: e => { assignee = e.target.value; } },
    h('option', { value: '' }, '— не назначать —'),
    S.people.filter(p => p.active && (inTeam(p, team.value) || p.id === assignee)).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      .map(p => h('option', { value: p.id }, p.name))));
  const team = h('select', {
    class: 'inp', value: t ? t.teamId : '',
    onchange: () => {
      const p = personById(assignee);
      if (p && !inTeam(p, team.value)) assignee = ''; // исполнитель не из этой команды — сбрасываем
      drawAssignee();
    },
  }, h('option', { value: '' }, '— любая —'), activeTeams().map(d => h('option', { value: d.id }, d.name)));
  const dept = h('select', { class: 'inp', value: t ? t.departmentId : '' },
    h('option', { value: '' }, '— по исполнителю —'), activeDepts().map(d => h('option', { value: d.id }, d.name)));
  drawAssignee();
  const linkInputs = S.linkFields.filter(f => !f.archived).sort(byOrder).map(f => ({
    f, el: h('input', { class: 'inp', value: (t && t.links[f.id]) || '', placeholder: 'https://…', maxlength: 2000 }),
  }));
  const due = h('select', { class: 'inp', value: String(t ? t.dueDays : -1) }, DUE_DAYS.map(([v, l]) => h('option', { value: String(v) }, l)));
  const checklist = h('textarea', { class: 'inp', rows: 5, value: t ? t.checklist.map(i => i.text).join('\n') : '', placeholder: 'Пункты чеклиста — по одному на строку' });
  modal({
    title: t ? `Шаблон «${t.name}»` : 'Новый шаблон',
    wide: true,
    body: [
      h('div', { class: 'grid2' }, field('Название шаблона', name), field('Название задачи', title)),
      field('Описание', desc),
      h('div', { class: 'grid2' }, field('Команда', team), field('Исполнитель', assigneeBox, 'Только люди выбранной команды')),
      h('div', { class: 'grid2' }, field('Позиция', dept, 'Кто видит задачу'), field('Срок', due, 'Считается от дня создания задачи')),
      field('Чеклист', checklist),
      linkInputs.length > 0 && h('div', { class: 'field' }, h('label', null, 'Ссылки'),
        h('div', { class: 'links tpl-links' }, linkInputs.map(({ f, el }) => h('div', { class: 'link-row' },
          h('span', { class: 'lf-ic' }, icon(f.kind === 'link' ? 'link' : f.kind, 15)), h('span', { class: 'link-name' }, f.name), el)))),
    ],
    actions: [
      { label: 'Отмена' },
      {
        label: t ? 'Сохранить' : 'Создать шаблон', primary: true, action: async close => {
          if (!name.value.trim()) return name.focus();
          const saved = await send('saveTemplate', {
            id: t ? t.id : undefined, name: name.value, title: title.value, description: desc.value, departmentId: dept.value,
            dueDays: Number(due.value), assigneeId: assignee, teamId: team.value,
            links: Object.fromEntries(linkInputs.map(({ f, el }) => [f.id, el.value.trim()]).filter(([, v]) => v)),
            checklist: checklist.value.split('\n').map(x => x.trim()).filter(Boolean).map(text => ({ text })),
          });
          if (t) Object.assign(t, saved); else S.templates.push(saved);
          close();
          onSaved();
        },
      },
    ],
  });
}

/* ---------- люди и доступы: люди / команды / позиции ---------- */

const PEOPLE_SUB = [['people', 'Люди', 'users'], ['teams', 'Команды', 'layers'], ['positions', 'Позиции', 'user']];

function peopleTab() {
  let sub = LS.get('peopleSub', 'people');
  if (!PEOPLE_SUB.some(x => x[0] === sub)) sub = 'people';
  const body = h('div');
  const seg = h('div', { class: 'seg' });
  const draw = () => {
    fill(seg, PEOPLE_SUB.map(([id, label, ic]) => h('button', {
      class: 'seg-btn' + (id === sub ? ' on' : ''), onclick: () => { sub = id; LS.set('peopleSub', id); draw(); },
    }, icon(ic, 14), label)));
    fill(body, sub === 'teams' ? h('div', { class: 'card-box', style: { maxWidth: '760px' } }, teamsManager())
      : sub === 'positions' ? h('div', { class: 'card-box', style: { maxWidth: '760px' } }, positionsManager())
        : h('div', { class: 'card-box' }, peopleManager({ search: true })));
  };
  draw();
  return h('div', null, h('div', { class: 'sub-tabs' }, seg), body);
}

/* ---------- автоматизации ---------- */

/** Всё, что происходит само: шаблоны, правила юнитов (ревью, чеклист, выполненные), уведомления. */
function automationsTab() {
  return h('div', { class: 'auto-page' },
    h('div', { class: 'card-box' }, templatesManager()),
    h('div', { class: 'card-box' }, unitRules()),
    h('div', { class: 'card-box' }, autoNotes()));
}

/** Правила по юнитам: одна строка на юнит, всё меняется на месте и сохраняется сразу. */
function unitRules() {
  const box = h('div');
  const units = () => S.units.filter(u => !u.archived).sort(byOrder);
  const save = async (u, patch) => {
    const saved = await send('updateUnit', { id: u.id, settings: { ...u.settings, ...patch } });
    u.settings = saved.settings;
    draw();
  };
  const reviewText = u => {
    const r = u.settings.review || {};
    const col = r.column && u.settings.columns.find(c => c.id === r.column);
    if (!col) return h('span', { class: 'muted' }, 'выключено');
    const who = [...new Set([...Object.values(r.byPosition || {}), r.default].filter(Boolean))].map(personById).filter(Boolean);
    return h('span', { class: 'rv-sum' }, h('b', null, col.name),
      who.length ? h('span', { class: 'avatars-stack', title: who.map(p => p.name).join(', ') }, who.slice(0, 4).map(p => avatar(p, 'sm')))
        : h('span', { class: 'warn-text', title: 'Выберите ревьюеров' }, icon('alert', 13), 'нет ревьюеров'));
  };
  const editReview = u => modal({
    title: `Ревью · ${u.name}`, wide: true,
    body: [reviewSection(u, { bare: true })],
    actions: [{ label: 'Готово', primary: true, action: c => { c(); draw(); } }],
    onClose: draw,
  });
  const row = u => h('div', { class: 'ur-row' },
    h('div', { class: 'ur-unit' }, h('span', { class: 'uc-icon sm', style: { background: u.color } }, u.key.slice(0, 2)), h('b', null, u.name)),
    h('button', { class: 'ur-cell ur-review', title: 'Настроить ревью', onclick: () => editReview(u) }, reviewText(u), icon('edit', 13)),
    h('label', { class: 'ur-cell ur-check', title: 'Участник не перенесёт в «готово», пока в чеклисте есть открытые пункты' },
      h('input', { type: 'checkbox', checked: !!u.settings.checklistBeforeDone, onchange: e => save(u, { checklistBeforeDone: e.target.checked }).catch(showErr) }),
      h('span', { class: 'ur-mobile' }, 'Чеклист перед «готово»')),
    h('div', { class: 'ur-cell' }, h('span', { class: 'ur-mobile ur-label' }, 'Готовые на доске'),
      h('select', { class: 'inp sm', value: String(u.settings.hideDoneDays || 0), onchange: e => save(u, { hideDoneDays: Number(e.target.value) }).catch(showErr) },
        HIDE_DONE.map(([d, l]) => h('option', { value: String(d) }, l)))),
    h('div', { class: 'ur-cell' }, h('span', { class: 'ur-mobile ur-label' }, 'Автоархив'),
      h('select', { class: 'inp sm', value: String(u.settings.autoArchiveDays || 0), onchange: e => save(u, { autoArchiveDays: Number(e.target.value) }).catch(showErr) },
        AUTO_ARCHIVE.map(d => h('option', { value: String(d) }, d ? `через ${d} дн.` : 'выключен')))));
  const draw = () => fill(box,
    h('div', { class: 'section-head' }, h('h2', { style: { margin: 0, fontSize: '16px' } }, 'Правила юнитов')),
    h('p', { class: 'hint', style: { marginTop: 0 } }, 'Ревью — задача в колонке ревью уходит ревьюеру своей позиции и возвращается исполнителю. Чеклист — в «готово» только с закрытым чеклистом. Готовые на доске — сколько дней держать выполненные. Меняется сразу.'),
    units().length ? h('div', { class: 'ur-list' },
      h('div', { class: 'ur-row ur-head' }, h('span', null, 'Юнит'), h('span', null, 'Ревью'), h('span', null, 'Чеклист перед «готово»'),
        h('span', null, 'Готовые на доске'), h('span', null, 'Автоархив')),
      units().map(row)) : h('p', { class: 'muted' }, 'Юнитов пока нет'));
  draw();
  return box;
}

/** Что приложение делает само — для понимания, без настроек. */
function autoNotes() {
  const item = (ic, title, text) => h('div', { class: 'an-item' }, h('span', { class: 'an-ic' }, icon(ic, 15)), h('div', null, h('b', null, title), h('div', { class: 'hint' }, text)));
  return h('div', null,
    h('h2', { style: { margin: '0 0 10px', fontSize: '16px' } }, 'Уведомления — работают сами'),
    h('div', { class: 'an-list' },
      item('user', 'Назначили задачу', 'Исполнителю — «Новое для вас» на главной и счётчик в меню (кроме назначения на себя).'),
      item('eye', 'Ревью', 'Ревьюеру — «Ревью»; исполнителю — «Вернули» или «Закрыта по ревью».'),
      item('alert', 'Сроки', 'Исполнителю — «Срок сегодня / завтра» и «Просрочено», по одному разу на срок.')));
}
