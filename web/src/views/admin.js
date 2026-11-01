/** Студия в «Настройках»: люди и доступы, юниты, автоматизации, журнал. Для CEO и PM. */
import Sortable from 'sortablejs';
import { AUTO_ARCHIVE, HIDE_DONE } from '../state.js';
import { reviewSection, openFieldEditor, requiredLabel } from './settings.js';
import { TYPE_LABELS } from '../state.js';
import { S, LS, me, ceoDefault, byOrder, unitById, emptyCounts, personById, todayStr, isSuper, plural, LINK_KINDS, activeDepts, deptById, activeTeams } from '../state.js';
import { $, h, icon, avatar, topbar, showErr, fill, toast, confirmDlg, menu, modal, field, skeleton } from '../ui.js';
import { call, send } from '../api.js';
import { currentView, link, rerender } from '../router.js';
import { renderSidebar } from './sidebar.js';
import { peopleManager, positionsManager, teamsManager, addPersonDialog, teamChips, positionChips, addMemberDialog } from './people.js';
import { openCreateTask } from './task.js';
import { activityFeed } from './feed.js';
import { openCreateUnit, archiveUnit, deleteUnit } from './units.js';

/** Разделы студии: [id, подпись, иконка]. */
export const STUDIO_TABS = [
  ['people', 'Люди и доступы', 'users'],
  ['units', 'Юниты', 'tree'],
  ['automations', 'Автоматизации', 'progress'],
  ['journal', 'Журнал', 'clock'],
];

// Старые вкладки: позиции — внутри «Люди и доступы», шаблоны — в «Автоматизациях»
const MOVED = { positions: ['people', 'positions'], teams: ['people', 'teams'], templates: ['automations'], card: ['automations'] };

/**
 * Раздел студии в «Настройках» (#/settings?tab=…): люди и доступы, структура (юниты и корзина), автоматизации, журнал.
 * page — куда рисовать, key — currentView(), при котором рисуем (ушли со страницы — не рисуем).
 */
export async function renderStudio(page, tab, key) {
  if (MOVED[tab]) {
    if (MOVED[tab][1]) LS.set('peopleSub', MOVED[tab][1]);
    tab = MOVED[tab][0];
  }
  fill(page, skeleton());
  // Свежие люди, юниты и позиции — общая основа всех вкладок
  let d, ov;
  try {
    [d, ov] = await Promise.all([
      call('getHome', { today: todayStr() }),
      tab === 'units' ? call('getOverview', { today: todayStr() }) : tab === 'trash' ? call('getAppSettings', {}) : null,
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
    case 'automations': fill(page, automationsTab()); break;
    case 'units': fill(page, unitsTable(ov)); break;
    case 'trash': fill(page, trashTable(ov)); break;
    case 'journal': fill(page, activityFeed({ limit: 40, title: 'Журнал событий', journal: true })); break;
    default: fill(page, peopleTab());
  }
}

/** Переключатель «Активные / Корзина» над таблицами юнитов. */
function unitsSwitch(trash) {
  const n = S.units.filter(u => u.archived).length;
  return h('div', { class: 'seg' },
    link({ view: 'settings', tab: 'units' }, { class: trash ? '' : 'on' }, 'Активные · ' + S.units.filter(u => !u.archived).length),
    link({ view: 'settings', tab: 'trash' }, { class: trash ? 'on' : '' }, icon('trash', 14), 'Корзина · ' + n));
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
        .then(() => { toast('Срок хранения сохранён'); rerender(); }).catch(showErr),
    }, RETENTION.map(([v, t]) => h('option', { value: String(v) }, t)))
    : h('b', null, (RETENTION.find(r => r[0] === days) || [0, days + ' дн.'])[1]);
  return h('div', null,
    h('div', { class: 'sub-tabs' }, unitsSwitch(true),
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

/** Юниты: простые строки с подписями; клик — карточка юнита справа, поверх страницы (никуда не уводит). */
function unitsTable(ov) {
  const units = S.units.filter(u => !u.archived).sort(byOrder);
  const noTeam = new Set(ov ? ov.unitsNoTeam : []);
  const list = h('div', { class: 'un-list' });
  const draw = () => fill(list, units.length ? [
    h('div', { class: 'un-th' }, ['Юнит', 'Люди', 'Задачи', 'Ревьюер', ''].map(t => h('span', null, t))),
    ...units.map(u => {
      const c = u.counts || emptyCounts();
      const people = (u.members || []).map(personById).filter(p => p && p.active);
      const rv = unitReviewers(u);
      return h('div', { class: 'un-row', role: 'row' },
        h('span', { class: 'un-name' }, h('span', { class: 'uc-icon', style: { background: u.color } }, u.key.slice(0, 2)),
          h('span', { class: 'un-title' }, h('b', null, u.name), h('small', { class: 'muted' }, u.description || u.key))),
        h('span', { class: 'un-num', title: noTeam.has(u.id) ? 'В юните никого нет' : '' }, people.length || h('span', { class: 'warn-text' }, '0')),
        h('span', { class: 'un-num' }, (c.todo + c.in_progress) + ' открыто', c.overdue > 0 && h('small', { class: 'warn-text' }, ' · ' + c.overdue + ' просроч.')),
        rv.length ? h('span', { class: 'un-rv' }, rv.map(p => p.name.split(' ').slice(0, 2).join(' ')).slice(0, 2).join(', '))
          : h('span', { class: 'un-rv warn-text' }, icon('alert', 14), 'Нет ревьюеров'),
        h('span', { class: 'un-actions' },
          link({ unit: u.id, mode: 'settings' }, { class: 'un-set' }, 'Настройки'),
          h('button', { class: 'btn soft', onclick: () => openUnitPanel(u, draw) }, 'Открыть')));
    })] : h('div', { class: 'card-box empty-state' },
    h('h2', null, 'Юнитов пока нет'),
    h('p', { style: { margin: 0 } }, 'Юниты — направления студии (Gold, RF, MVP…): в них приложения, PM, RM, лиды и сотрудники.'),
    isSuper() && h('button', { class: 'btn primary', onclick: openCreateUnit }, icon('plus', 15), 'Создать юнит')));
  draw();
  return h('div', null,
    h('div', { class: 'sub-tabs' }, unitsSwitch(false)),
    list);
}

const unitReviewers = u => {
  const r = u.settings.review || {};
  if (!r.column) return [];
  return [...new Set([...Object.values(r.byPosition || {}), r.default].filter(Boolean))].map(personById).filter(Boolean);
};

/** Карточка юнита окном по центру: команды и люди (добавить/убрать), задачи, ревью; отсюда — в сам юнит, на доску, в настройки. */
function openUnitPanel(u, onChange) {
  const root = $('#panel-root');
  const close = () => { document.removeEventListener('keydown', onKey, true); fill(root); onChange(); };
  const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.modal') && !document.querySelector('.menu')) { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  const body = h('div', { class: 'up-body' });
  const remove = async p => {
    if (!(await confirmDlg(`Убрать ${p.name} из «${u.name}»? Его задачи в юните останутся за ним.`, { ok: 'Убрать', danger: true }))) return;
    const list = await send('removeMember', { unitId: u.id, personId: p.id });
    u.members = list.map(m => m.personId);
    draw();
  };
  const draw = () => {
    const c = u.counts || emptyCounts();
    const people = (u.members || []).map(personById).filter(p => p && p.active);
    const groups = activeTeams().map(t => ({ t, people: people.filter(p => (p.teamIds || []).includes(t.id)) })).filter(g => g.people.length);
    const loose = people.filter(p => !(p.teamIds || []).some(id => activeTeams().some(t => t.id === id)));
    if (loose.length) groups.push({ t: { name: 'Без команды', color: 'var(--muted)' }, people: loose });
    const rv = unitReviewers(u);
    const r = u.settings.review || {};
    const col = r.column && u.settings.columns.find(x => x.id === r.column);
    const stat = (label, n, cls) => h('div', { class: 'up-stat' + (cls ? ' ' + cls : '') }, h('b', null, n), h('span', null, label));
    fill(body,
      h('section', null,
        h('div', { class: 'up-head' }, h('h3', null, 'Задачи')),
        h('div', { class: 'up-stats' }, stat('не начато', c.todo), stat('в работе', c.in_progress), stat('готово', c.done), stat('просрочено', c.overdue, c.overdue ? 'warn' : ''))),
      h('section', null,
        h('div', { class: 'up-head' }, h('h3', null, 'Команды и люди'),
          h('button', { class: 'btn ghost sm', onclick: async () => { if (await addMemberDialog(u.id)) { u.members = unitById(u.id).members || u.members; draw(); } } }, icon('plus', 14), 'Добавить')),
        groups.length ? groups.map(g => h('div', { class: 'up-team' },
          h('div', { class: 'up-team-name' }, h('span', { class: 'dot', style: { background: g.t.color } }), g.t.name, h('span', { class: 'muted' }, g.people.length)),
          g.people.map(p => h('div', { class: 'up-person' }, avatar(p, 'sm'), h('span', { class: 'up-pname', 'data-pcard': p.id }, p.name),
            h('span', { class: 'muted up-pos' }, (p.positionIds || []).map(id => (deptById(id) || {}).name).filter(Boolean).join(', ')),
            h('button', { class: 'icon-btn sm', title: 'Убрать из юнита', onclick: () => remove(p).catch(showErr) }, icon('x', 14))))))
          : h('p', { class: 'muted' }, 'В юните пока никого — добавьте участников.')),
      h('section', null,
        h('div', { class: 'up-head' }, h('h3', null, 'Ревью'),
          h('button', { class: 'btn ghost sm', onclick: () => openReviewEditor(u, draw) }, icon('edit', 13), 'Настроить')),
        col ? h('p', { class: 'up-line' }, 'Колонка «' + col.name + '» · ', rv.length ? rv.map(p => p.name).join(', ') : h('span', { class: 'warn-text' }, 'ревьюеры не выбраны'))
          : h('p', { class: 'muted up-line' }, 'Выключено')));
  };
  draw();
  fill(root,
    h('div', { class: 'panel-backdrop center', onclick: close }),
    h('aside', { class: 'panel center unit-panel', role: 'dialog', 'aria-label': u.name },
      h('div', { class: 'panel-head' },
        h('span', { class: 'uc-icon sm', style: { background: u.color } }, u.key.slice(0, 2)),
        h('b', null, u.name), h('span', { class: 'muted' }, u.key), h('span', { class: 'spacer' }),
        !ceoDefault() && link({ unit: u.id, mode: 'settings' }, { class: 'btn ghost sm', onclick: () => fill(root) }, icon('settings', 14), 'Настройки'),
        link({ unit: u.id, mode: 'board' }, { class: 'btn sm', onclick: () => fill(root) }, icon('board', 14), 'Доска'),
        link({ unit: u.id, mode: 'overview' }, { class: 'btn primary sm', onclick: () => fill(root) }, 'Открыть юнит', icon('arrowUpRight', 14)),
        h('button', { class: 'icon-btn', title: 'Закрыть', onclick: close }, icon('x', 18))),
      body));
}

/* ---------- карточка: поля-ссылки ---------- */

const kindIcon = k => icon(k === 'link' || !k ? 'link' : k, 16);
/** Иконка по названию нового поля: «Figma» → figma, «GitHub» → github… */
const guessKind = name => {
  const n = name.toLowerCase();
  return /figma/.test(n) ? 'figma' : /git/.test(n) ? 'github' : /drive|диск/.test(n) ? 'drive' : /meta|мета/.test(n) ? 'meta' : 'link';
};

/**
 * Общие поля карточки — одни на все юниты (приоритет и любые свои). У юнита ещё могут быть свои поля — в его настройках.
 * Порядок — перетаскиванием, правка — в окне; «Убрать» скрывает с карточек, значения сохраняются.
 */
function globalFieldsManager() {
  let fields = null;
  const list = h('div', { class: 'field-list' }, h('div', { class: 'boot' }, h('span', { class: 'spinner' })));
  const removedBox = h('div');
  const edit = f => openFieldEditor(f, {
    global: true,
    onSaved: (saved, isNew) => { if (isNew) fields.push(saved); else Object.assign(f, saved); draw(); toast(isNew ? `Поле «${saved.name}» добавлено во все юниты` : 'Сохранено'); },
  });
  const setArchived = (f, archived) => send('updateField', { id: f.id, archived })
    .then(saved => { Object.assign(f, saved); draw(); }).catch(showErr);
  const remove = async f => {
    if (!(await confirmDlg(`Удалить общее поле «${f.name}» навсегда? Его значения сотрутся во всех задачах всех юнитов.`, { ok: 'Удалить', danger: true }))) return;
    await send('deleteField', { id: f.id });
    fields = fields.filter(x => x !== f);
    draw();
  };
  const row = f => h('div', { class: 'field-row', dataset: { id: f.id } },
    h('span', { class: 'drag', title: 'Перетащите, чтобы изменить порядок' }, icon('grip', 16)),
    h('span', { class: 'name' }, f.name),
    h('span', { class: 'badge' }, f.role === 'priority' ? 'приоритет' : TYPE_LABELS[f.type] || f.type),
    f.showOnCard && h('span', { class: 'badge' }, 'на карточке'),
    f.required && h('span', { class: 'badge' }, requiredLabel(f)),
    f.staffOnly && h('span', { class: 'badge' }, 'меняют CEO и PM'),
    f.requiredOnCreate && h('span', { class: 'badge' }, 'при создании'),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn sm', onclick: () => edit(f) }, icon('edit', 13), 'Изменить'),
    f.role !== 'priority' && h('button', { class: 'btn ghost sm', title: 'Убрать с карточек всех юнитов (значения сохранятся)', onclick: () => setArchived(f, true) }, 'Убрать'));
  const draw = () => {
    const active = fields.filter(f => !f.archived).sort(byOrder);
    const removed = fields.filter(f => f.archived);
    fill(list, active.map(row));
    fill(removedBox, removed.length > 0 && [
      h('div', { class: 'sub-title' }, 'Убранные'),
      h('div', { class: 'field-list' }, removed.map(f => h('div', { class: 'field-row' },
        h('span', { class: 'name muted' }, f.name),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn sm', onclick: () => setArchived(f, false) }, 'Вернуть'),
        h('button', { class: 'btn ghost sm danger', onclick: () => remove(f).catch(showErr) }, 'Удалить навсегда'))))]);
  };
  Sortable.create(list, {
    handle: '.drag', animation: 150, forceFallback: true, fallbackTolerance: 4,
    onEnd: () => {
      const ids = [...list.children].map(el => el.dataset.id).filter(Boolean);
      ids.forEach((id, i) => { fields.find(f => f.id === id).order = i + 1; });
      send('reorderFields', { ids }).catch(showErr);
    },
  });
  call('getGlobalFields', {}).then(r => { fields = r; draw(); }).catch(showErr);
  return h('div', null,
    h('div', { class: 'section-head', style: { marginBottom: '4px' } },
      h('h2', { style: { margin: 0, fontSize: '16px' } }, 'Общие поля карточки'),
      h('button', { class: 'btn primary sm', onclick: () => edit(null) }, icon('plus', 14), 'Поле')),
    h('p', { class: 'hint', style: { marginTop: 0 } }, 'Общие для всех юнитов — идут на карточке первыми. Обязательность — по типу колонки.'),
    list, removedBox);
}

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
      h('div', { class: 'hint aud-note' }, 'CEO и PM видят все поля'));
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
    h('p', { class: 'hint', style: { marginTop: 0 } }, 'Общие для всех юнитов. Сотрудник видит поле, только если оно открыто его позиции. Скрытые ссылки не уходят ему даже в браузер.'),
    list,
    h('div', { class: 'sub-title' }, 'Добавить поле'),
    h('div', { class: 'lf-add' }, kindBtn, name, h('button', { class: 'btn primary', onclick: () => add().catch(showErr) }, icon('plus', 14), 'Добавить')));
}

/* ---------- шаблоны задач ---------- */

const DUE_DAYS = [[-1, 'Без срока'], [0, 'Сегодня'], [1, 'Завтра'], [2, 'Через 2 дня'], [3, 'Через 3 дня'], [5, 'Через 5 дней'], [7, 'Через неделю'], [14, 'Через 2 недели'], [30, 'Через месяц']];

/** Шаблоны задач: общие для всех юнитов. Порядок — перетаскиванием, правка — в окне. */
function templatesManager() {
  const list = h('div', { class: 'lf-list' });
  const sorted = () => S.templates.filter(x => x.kind !== 'update').sort(byOrder); // шаблоны апдейтов — отдельно, в «Приложениях»
  const remove = async t => {
    if (!(await confirmDlg(`Удалить шаблон «${t.name}»? Задачи, созданные по нему, останутся.`, { ok: 'Удалить', danger: true }))) return;
    await send('deleteTemplate', { id: t.id });
    S.templates = S.templates.filter(x => x !== t);
    draw();
  };
  const row = t => {
    const d = deptById(t.departmentId);
    const tm = S.teams.find(x => x.id === t.teamId);
    // как в макете: название, ниже тихо «команда · срок · чеклист»; справа позиция
    const meta = [tm && tm.name, t.dueDays >= 0 && 'срок ' + String((DUE_DAYS.find(x => x[0] === t.dueDays) || [0, ''])[1]).toLowerCase(),
      t.assigneeId && personById(t.assigneeId) && personById(t.assigneeId).name, t.checklist.length > 0 && 'чеклист ' + t.checklist.length].filter(Boolean).join(' · ');
    return h('div', { class: 'lf-row tpl-row', dataset: { id: t.id } },
      h('span', { class: 'drag', title: 'Перетащите, чтобы изменить порядок' }, icon('grip', 14)),
      h('button', { class: 'tpl-open', onclick: () => editTemplate(t, draw) },
        h('span', { class: 'tpl-name' }, t.name), meta && h('span', { class: 'tpl-sub' }, meta)),
      d && h('span', { class: 'pick-chip', title: 'Позиция' }, d.name),
      h('button', { class: 'icon-btn sm tpl-del', title: 'Удалить', onclick: () => remove(t).catch(showErr) }, icon('trash', 15)));
  };
  let sortable = null;
  const draw = () => {
    fill(list, sorted().length ? sorted().map(row) : h('p', { class: 'muted', style: { padding: '12px 14px', margin: 0 } }, 'Шаблонов пока нет'));
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
  // «+ Шаблон» — в шапке настроек (макет 22)
  setTimeout(() => { const b = document.querySelector('.tpl-add'); if (b) b.onclick = () => editTemplate(null, draw); });
  return h('div', null,
    h('div', { class: 'section-head' }, h('h2', { style: { margin: 0, fontSize: '16px' }, title: 'Заготовки для повторяющихся задач: при создании задачи выберите шаблон — подставятся название, описание, позиция, срок и чеклист' }, 'Шаблоны задач')),
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
  const tools = h('div', { class: 'sub-tools' });
  const count = { people: () => S.people.length, teams: () => activeTeams().length, positions: () => activeDepts().length };
  const draw = () => {
    fill(seg, PEOPLE_SUB.map(([id, label, ic]) => h('button', {
      class: 'seg-btn' + (id === sub ? ' on' : ''), onclick: () => { sub = id; LS.set('peopleSub', id); draw(); },
    }, icon(ic, 14), label + ' · ' + count[id]())));
    const view = sub === 'teams' ? teamsManager({ bare: true }) : sub === 'positions' ? positionsManager({ bare: true }) : peopleManager({ search: true, bare: true });
    fill(tools, view.toolbar);
    fill(body, view);
    // кнопка в шапке — по вкладке: «Человек», «Команда», «Позиция»
    const btn = document.querySelector('.people-add');
    if (btn) {
      fill(btn.querySelector('.btn-label'), { people: 'Человек', teams: 'Команда', positions: 'Позиция' }[sub]);
      btn.onclick = sub === 'people' ? () => addPersonDialog(() => draw()) : () => view.focusAdd();
    }
  };
  draw();
  return h('div', null, h('div', { class: 'sub-tabs' }, seg, tools), body);
}

/* ---------- автоматизации ---------- */

/** Карточка и автоматика: ссылки в карточке (супер-админ), шаблоны, правила юнитов, уведомления. */
function automationsTab() {
  // как в макете: правила юнитов, ниже шаблоны и «Уведомления работают сами»; поля и ссылки карточки — после них
  return h('div', { class: 'auto-page' },
    h('div', { class: 'card-box' }, unitRules()),
    h('div', { class: 'an-grid an-grid-32' }, h('div', { class: 'card-box' }, templatesManager()), h('div', { class: 'card-box' }, autoNotes())),
    h('div', { class: 'an-grid auto-fields' + (isSuper() ? '' : ' one') }, h('div', { class: 'card-box' }, globalFieldsManager()),
      isSuper() && h('div', { class: 'card-box' }, linkFieldsManager())));
}

/** Настройка ревью юнита окном (колонка, ревьюеры по позиции, по умолчанию). */
function openReviewEditor(u, onDone) {
  modal({
    title: `Ревью · ${u.name}`, wide: true,
    body: [reviewSection(u, { bare: true })],
    actions: [{ label: 'Готово', primary: true, action: c => c() }],
    onClose: onDone,
  });
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
    // как в макете: «В ревью» · Олег Кузнецов; без ревьюеров — жёлтым
    return who.length
      ? h('span', { class: 'rv-sum', title: who.map(p => p.name).join(', ') }, `«${col.name}» · ` + (who.length === 1 ? who[0].name : who.map(p => p.name.split(' ')[0]).join(', ')))
      : h('span', { class: 'rv-sum warn-text', title: 'Выберите ревьюеров' }, icon('alert', 13), `«${col.name}» · нет ревьюеров`);
  };
  const editReview = u => openReviewEditor(u, draw);
  const row = u => h('div', { class: 'ur-row' },
    h('div', { class: 'ur-unit' }, h('span', { class: 'dot', style: { background: u.color } }), h('b', null, u.name)),
    h('button', { class: 'ur-cell ur-review', title: 'Настроить ревью', onclick: () => editReview(u) }, reviewText(u), icon('edit', 13)),
    h('label', { class: 'ur-cell ur-check', title: 'Сотрудник не перенесёт в «готово», пока в чеклисте есть открытые пункты' },
      h('input', { type: 'checkbox', class: 'switch', checked: !!u.settings.checklistBeforeDone, onchange: e => save(u, { checklistBeforeDone: e.target.checked }).catch(showErr) }),
      h('span', { class: 'ur-mobile' }, 'Чеклист перед «готово»')),
    h('div', { class: 'ur-cell' }, h('span', { class: 'ur-mobile ur-label' }, 'Готовые на доске'),
      h('select', { class: 'quiet-select', value: String(u.settings.hideDoneDays || 0), onchange: e => save(u, { hideDoneDays: Number(e.target.value) }).catch(showErr) },
        HIDE_DONE.map(([d, l]) => h('option', { value: String(d) }, l)))),
    h('div', { class: 'ur-cell' }, h('span', { class: 'ur-mobile ur-label' }, 'Автоархив'),
      h('select', { class: 'quiet-select', value: String(u.settings.autoArchiveDays || 0), onchange: e => save(u, { autoArchiveDays: Number(e.target.value) }).catch(showErr) },
        AUTO_ARCHIVE.map(d => h('option', { value: String(d) }, d ? `через ${d} дн.` : 'выключен')))));
  const draw = () => fill(box,
    h('div', { class: 'section-head' }, h('h2', { style: { margin: 0, fontSize: '16px' } }, 'Правила юнитов')),
    units().length ? h('div', { class: 'ur-list' },
      h('div', { class: 'ur-row ur-head' }, h('span', null, 'Юнит'), h('span', null, 'Ревью'), h('span', { title: 'Сотрудник не перенесёт в «Готово», пока в чеклисте есть открытые пункты' }, 'Чеклист перед «Готово»'),
        h('span', null, 'Готовые на доске'), h('span', null, 'Автоархив')),
      units().map(row)) : h('p', { class: 'muted' }, 'Юнитов пока нет'));
  draw();
  return box;
}

/** Что приложение делает само — для понимания, без настроек. */
function autoNotes() {
  return h('div', { class: 'auto-notes' },
    h('h2', { style: { margin: '0 0 12px', fontSize: '16px' } }, 'Уведомления работают сами'),
    h('p', null, 'Задачу назначили, отдали на ревью или вернули, упомянули в комментарии, срок завтра, реджект от Apple.'),
    h('p', { class: 'muted' }, 'Настраивать нечего: каждый видит только своё.'));
}
