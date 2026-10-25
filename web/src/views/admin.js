/** Панель админа (#/admin): обзор, люди и доступы, юниты, позиции, карточка, журнал. Для модераторов и супер-админов. */
import Sortable from 'sortablejs';
import { S, me, byOrder, emptyCounts, personById, todayStr, isSuper, ACCESS_LABELS, plural, LINK_KINDS, activeDepts } from '../state.js';
import { $, h, icon, avatar, topbar, showErr, fill, toast, confirmDlg, menu } from '../ui.js';
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
