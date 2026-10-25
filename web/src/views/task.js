import {
  S, LS, taskById, personById, activeFields, missingNext, taskKey, isEmpty, optById, dueInfo, fmtDateTime, relTime, addDays,
  unitById, safeUrl, colById, colColor, taskDone, activeDepts, deptById, isStaff, canEditTask, fmtValue,
} from '../state.js';
import { $, h, append, icon, avatar, autosize, field, linkify, menu, modal, confirmDlg, toast, showErr, statusDot, fill } from '../ui.js';
import { call, send } from '../api.js';
import { navigate, rerender } from '../router.js';
import { renderTasks, patchTask, reloadBoard, loadBoard } from './board.js';
import { addMemberDialog } from './people.js';
import { openCreateUnit } from './units.js';
import { activityText } from './feed.js';

/* ================= Панель задачи ================= */

export function closePanel() {
  S.panelTaskId = null;
  S.peek = false;
  fill($('#panel-root'));
}

export function closeTask() {
  if (S.peek) {
    // Карточка была открыта поверх страницы: закрываем; страницу под ней обновляем, только если задачу меняли
    const t = taskById(S.panelTaskId);
    const changed = !t || t.updatedAt !== S.peekStamp;
    closePanel();
    if (changed) rerender();
    return;
  }
  if (S.board) navigate({ unit: S.board.unit.id, mode: S.route.mode === 'settings' ? 'board' : S.route.mode });
}

/** Открыть задачу поверх текущей страницы (главная, панель админа, мои задачи). На доске этого юнита — как обычно. */
export async function peekTask(unitId, taskId) {
  if (S.route.unit === unitId) return navigate({ unit: unitId, mode: S.route.mode === 'settings' ? 'board' : S.route.mode, task: taskId });
  try {
    if (!S.board || S.board.unit.id !== unitId) await loadBoard(unitId);
  } catch (e) {
    return showErr(e);
  }
  S.peek = true;
  S.peekStamp = (taskById(taskId) || {}).updatedAt;
  openTask(taskId);
}

/** Где открывается карточка задачи: справа (по умолчанию) или по центру. Запоминается в браузере. */
const cardCenter = () => LS.get('cardMode', 'side') === 'center';

export function openTask(id) {
  const t = taskById(id);
  if (!t) {
    toast('Задача не найдена — возможно, её удалили или перенесли', { type: 'error' });
    return closeTask();
  }
  S.panelTaskId = id;
  fill($('#panel-root'),
    h('div', { class: 'panel-backdrop' + (cardCenter() ? ' center' : ''), onclick: closeTask }),
    buildPanel(t));
}

/** soft — обновить только служебную информацию, не трогая поля ввода (чтобы не сбить фокус). */
export function refreshPanel(t, { soft = false } = {}) {
  if (S.panelTaskId !== t.id) return;
  if (soft) {
    const meta = $('#task-meta');
    if (meta) fill(meta, ...metaLines(t));
    return;
  }
  openTask(t.id);
}

function buildPanel(t) {
  const u = S.board.unit;
  const B = u.settings.builtins;

  const staff = isStaff();
  const editable = canEditTask(t);
  const title = autosize(h('textarea', {
    class: 'title-inp', rows: 1, value: t.title, maxlength: 500, 'aria-label': B.title.label, readonly: !staff,
    onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } },
    onchange: e => {
      const v = e.target.value.trim();
      if (!v) { e.target.value = t.title; return; }
      patchTask(t, { title: v });
    },
  }));

  const main = h('div', { class: 'panel-main' },
    title,
    !editable && h('div', { class: 'readonly-note' }, icon('alert', 14), 'Только просмотр: менять можно свои задачи'),
    !B.description.hidden && descriptionBlock(t, B.description.label, editable),
    checklistBlock(t, editable),
    discussionBlock(t, editable));

  const head = h('div', { class: 'panel-head' },
    h('div', { class: 'crumbs' },
      h('button', { class: 'unit-link', title: 'Открыть доску юнита', onclick: openUnitBoard }, h('span', { class: 'unit-dot', style: { background: u.color, margin: 0 } }), u.name),
      h('span', null, '/'),
      h('span', { class: 'key-badge' }, taskKey(t)),
      t.archived && h('span', { class: 'badge' }, 'в архиве')),
    h('span', { class: 'spacer' }),
    S.peek && h('button', { class: 'btn ghost sm', title: 'Перейти на доску юнита с этой задачей', onclick: () => openUnitBoard(t) }, icon('board', 14), 'Открыть доску'),
    h('button', {
      class: 'icon-btn', title: cardCenter() ? 'Открывать карточки справа' : 'Открывать карточки по центру',
      onclick: () => { LS.set('cardMode', cardCenter() ? 'side' : 'center'); openTask(t.id); },
    }, icon(cardCenter() ? 'panelSide' : 'panelCenter', 16)),
    h('button', { class: 'icon-btn', title: 'Скопировать ссылку', onclick: () => copyLink(t) }, icon('copy', 16)),
    staff && h('button', { class: 'icon-btn', title: 'Действия', onclick: e => panelMenu(e.currentTarget, t) }, icon('more', 18)),
    h('button', { class: 'icon-btn', title: 'Закрыть (Esc)', onclick: closeTask }, icon('x', 18)));

  return h('aside', { class: 'panel' + (cardCenter() ? ' center' : ''), role: 'dialog', 'aria-label': taskKey(t) },
    head,
    h('div', { class: 'panel-body' }, main, sideBlock(t, { staff, editable })));
}

/** Перейти на доску юнита (из карточки, открытой поверх дашборда — с этой же задачей). */
function openUnitBoard(t) {
  const unitId = S.board.unit.id;
  const taskId = t && t.id ? t.id : null;
  S.peek = false;
  closePanel();
  navigate({ unit: unitId, mode: 'board', task: taskId });
}

function panelMenu(anchor, t) {
  const others = S.board.units.filter(x => x.id !== S.board.unit.id && !x.archived);
  menu(anchor, [
    { label: 'Дублировать', icon: 'copy', action: () => duplicateTask(t) },
    others.length > 0 && { label: 'Перенести в другой юнит…', icon: 'arrow', action: () => moveTaskDialog(t) },
    { label: t.archived ? 'Вернуть из архива' : 'В архив', icon: 'archive', action: () => { patchTask(t, { archived: !t.archived }); refreshPanel(t); } },
    { sep: true },
    { label: 'Удалить', icon: 'trash', danger: true, action: () => deleteTaskUndoable(t) },
  ]);
}

function copyLink(t) {
  const url = location.origin + location.pathname + '#/u/' + t.unitId + '?task=' + t.id;
  (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
    .then(() => toast('Ссылка на ' + taskKey(t) + ' скопирована'), () => toast(url));
}

/* ---------- описание ---------- */

function descriptionBlock(t, label, editable) {
  const box = h('div', { class: 'block' });
  const view = () => fill(box,
    h('div', { class: 'block-title' }, label, h('span', { class: 'spacer' }),
      editable && t.description && h('button', { class: 'link-btn', onclick: edit }, 'Изменить')),
    t.description
      ? h('div', { class: 'desc-view' + (editable ? '' : ' readonly'), title: editable ? 'Нажмите, чтобы изменить' : '', onclick: e => { if (editable && !e.target.closest('a') && !getSelection().toString()) edit(); } }, linkify(t.description))
      : editable ? h('button', { class: 'desc-empty', onclick: edit }, 'Добавьте описание: контекст, ссылки, критерии готовности…') : h('p', { class: 'muted' }, 'Описания нет'));
  const edit = () => {
    const ta = autosize(h('textarea', { class: 'inp desc-edit', value: t.description, maxlength: 20000 }));
    const save = () => { if (ta.value.trim() !== t.description) patchTask(t, { description: ta.value.trim() }); view(); };
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
      if (e.key === 'Escape') { e.stopPropagation(); view(); }
    });
    fill(box, 
      h('div', { class: 'block-title' }, label),
      ta,
      h('div', { class: 'edit-actions' },
        h('button', { class: 'btn primary sm', onclick: save }, 'Сохранить'),
        h('button', { class: 'btn ghost sm', onclick: view }, 'Отмена'),
        h('span', { class: 'hint' }, '⌘/Ctrl + Enter — сохранить')));
    ta.focus();
  };
  view();
  return box;
}

/* ---------- чеклист ---------- */

function checklistBlock(t, editable) {
  const box = h('div', { class: 'block' });
  if (!editable) {
    const items = t.checklist || [];
    if (!items.length) return null;
    return append(box, h('div', { class: 'block-title' }, 'Чеклист', h('span', { class: 'muted', style: { fontWeight: 400 } }, items.filter(i => i.done).length + ' из ' + items.length)),
      h('div', { class: 'cl-list' }, items.map(it => h('div', { class: 'cl-item' + (it.done ? ' done' : '') },
        h('input', { type: 'checkbox', checked: it.done, disabled: true }), h('span', { class: 'cl-text' }, it.text)))));
  }
  const update = (next, focusAdd) => { patchTask(t, { checklist: next }); draw(focusAdd); };
  const draw = focusAdd => {
    const items = t.checklist || [];
    const done = items.filter(i => i.done).length;
    const pct = items.length ? Math.round((done / items.length) * 100) : 0;
    const add = h('input', {
      class: 'inp cl-add', placeholder: 'Добавить пункт и нажать Enter', maxlength: 300,
      onkeydown: e => {
        if (e.key !== 'Enter' || !e.target.value.trim()) return;
        e.preventDefault();
        update(items.concat({ id: 'k_' + Math.random().toString(36).slice(2, 12), text: e.target.value.trim(), done: false }), true);
      },
    });
    fill(box, 
      h('div', { class: 'block-title' }, 'Чеклист',
        items.length > 0 && h('span', { class: 'muted', style: { fontWeight: 400 } }, done + ' из ' + items.length),
        h('span', { class: 'spacer' }),
        done > 0 && h('button', { class: 'link-btn', onclick: () => update(items.filter(i => !i.done)) }, 'Убрать выполненные')),
      items.length > 0 && h('div', { class: 'progress' }, h('div', { style: { width: pct + '%' } })),
      h('div', { class: 'cl-list' }, items.map(it => h('div', { class: 'cl-item' + (it.done ? ' done' : '') },
        h('input', { type: 'checkbox', checked: it.done, onchange: e => update(items.map(x => (x === it ? { ...x, done: e.target.checked } : x))) }),
        h('input', {
          class: 'cl-text', value: it.text, maxlength: 300,
          onkeydown: e => { if (e.key === 'Enter') e.target.blur(); },
          onchange: e => {
            const v = e.target.value.trim();
            update(v ? items.map(x => (x === it ? { ...x, text: v } : x)) : items.filter(x => x !== it));
          },
        }),
        h('button', { class: 'icon-btn sm cl-del', title: 'Удалить пункт', onclick: () => update(items.filter(x => x !== it)) }, icon('x', 14))))),
      add);
    if (focusAdd) add.focus();
  };
  draw();
  return box;
}

/* ---------- комментарии и история ---------- */

function discussionBlock(t, editable) {
  let tab = 'comments';
  let data = null;
  let editing = null;
  const box = h('div', { class: 'block' });

  const load = async () => {
    try {
      data = await call('getTaskExtras', { taskId: t.id });
      t.commentCount = data.comments.length;
      if (S.panelTaskId === t.id) draw();
    } catch (e) { showErr(e); }
  };

  const tabBtn = (id, label, n) => h('button', { class: 'tab' + (tab === id ? ' on' : ''), onclick: () => { tab = id; draw(); } },
    label, n ? h('span', { class: 'muted' }, ' ' + n) : null);

  const comment = c => {
    const p = personById(c.authorId);
    const isEditing = editing === c.id;
    let ta;
    return h('div', { class: 'comment' },
      avatar(p),
      h('div', { class: 'comment-main' },
        h('div', { class: 'comment-head' },
          h('b', null, p ? p.name : 'Аноним'),
          h('span', { class: 'when', title: fmtDateTime(c.at) }, relTime(c.at) + (c.editedAt ? ' · изменено' : '')),
          !isEditing && (isStaff() || c.authorId === S.meId) && h('span', { class: 'actions' },
            h('button', { class: 'link-btn', onclick: () => { editing = c.id; draw(); } }, 'Изменить'),
            h('button', { class: 'link-btn danger', onclick: () => removeComment(c) }, 'Удалить'))),
        isEditing
          ? [
            ta = autosize(h('textarea', { class: 'inp', value: c.text, style: { marginTop: '6px' } })),
            h('div', { class: 'edit-actions' },
              h('button', {
                class: 'btn primary sm', onclick: () => {
                  const text = ta.value.trim();
                  if (!text) return;
                  send('updateComment', { id: c.id, text }).then(saved => { Object.assign(c, saved); editing = null; draw(); }).catch(showErr);
                },
              }, 'Сохранить'),
              h('button', { class: 'btn ghost sm', onclick: () => { editing = null; draw(); } }, 'Отмена')),
          ]
          : h('div', { class: 'comment-text' }, linkify(c.text))));
  };

  const removeComment = async c => {
    if (!(await confirmDlg('Удалить комментарий?', { ok: 'Удалить', danger: true }))) return;
    data.comments = data.comments.filter(x => x !== c);
    t.commentCount = data.comments.length;
    draw();
    renderTasks();
    send('deleteComment', { id: c.id }).catch(e => { showErr(e); load(); });
  };

  const composer = () => {
    const ta = autosize(h('textarea', { class: 'inp', rows: 2, placeholder: 'Написать комментарий…', maxlength: 5000 }));
    const submit = () => {
      const text = ta.value.trim();
      if (!text) return;
      ta.value = '';
      send('addComment', () => ({ taskId: t.id, text })).then(c => {
        data.comments.push(c);
        t.commentCount = data.comments.length;
        renderTasks();
        load(); // подтянуть запись в историю
      }).catch(e => { ta.value = text; showErr(e); });
    };
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } });
    return h('div', { class: 'composer' },
      avatar(personById(S.meId)),
      h('div', { class: 'grow' }, ta,
        h('div', { class: 'row' },
          h('button', { class: 'btn primary sm', onclick: submit }, icon('send', 13), 'Отправить'),
          h('span', { class: 'hint' }, '⌘/Ctrl + Enter'))));
  };

  const history = () => (data.activity.length
    ? h('div', { class: 'timeline' }, data.activity.map(a => {
      const p = personById(a.actorId);
      return h('div', { class: 'tl-item' },
        h('span', { class: 'tl-dot' }),
        h('div', null,
          h('div', null, h('b', null, p ? p.name : 'Кто-то'), ' · ', activityText(a)),
          h('div', { class: 'tl-when', title: fmtDateTime(a.at) }, relTime(a.at))));
    }))
    : h('p', { class: 'muted' }, 'Пока пусто'));

  const draw = () => {
    fill(box, 
      h('div', { class: 'tabs' }, tabBtn('comments', 'Комментарии', data ? data.comments.length : t.commentCount), tabBtn('history', 'История')),
      !data
        ? h('div', { class: 'muted' }, 'Загрузка…')
        : tab === 'comments'
          ? [data.comments.map(comment), editable ? composer() : !data.comments.length && h('p', { class: 'muted' }, 'Комментариев нет')]
          : history());
  };
  draw();
  load();
  return box;
}

/* ---------- свойства (правая колонка) ---------- */

/** Значение только для чтения в правой колонке. */
const ro = node => h('div', { class: 'ro-value' }, node || h('span', { class: 'muted' }, '—'));

function sideBlock(t, { staff, editable }) {
  const u = S.board.unit;
  const B = u.settings.builtins;
  const props = h('div', { class: 'props' });
  const prop = (label, control, opts = {}) => {
    if (opts.empty) (control.querySelector('.inp') || control).classList.add('empty-req');
    props.append(h('div', { class: 'prop' }, h('label', { class: opts.required ? 'req' : '' }, label), control, opts.after));
  };

  const dot = statusDot(colColor(colById(t.status)), 9);
  prop(B.status.label, h('div', { class: 'status-wrap' }, dot,
    h('select', {
      class: 'inp', value: colById(t.status).id, disabled: !editable,
      onchange: e => { dot.style.background = colColor(colById(e.target.value)); patchTask(t, { status: e.target.value }); },
    }, u.settings.columns.map(c => h('option', { value: c.id }, c.name)))));

  if (!B.assignee.hidden && !staff) {
    const p = personById(t.assigneeId);
    prop(B.assignee.label, ro(p && h('span', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } }, avatar(p, 'sm'), p.name)));
  } else if (!B.assignee.hidden) {
    prop(B.assignee.label, assigneeSelect(t.assigneeId, v => {
      const before = t.departmentId;
      patchTask(t, { assigneeId: v }).then(() => { if (t.departmentId !== before) refreshPanel(t); });
    }), {
      after: S.meId && t.assigneeId !== S.meId && h('button', {
        class: 'link-btn prop-hint', onclick: () => { patchTask(t, { assigneeId: S.meId }); refreshPanel(t); },
      }, 'Назначить на меня'),
    });
  }

  if (!B.department.hidden) {
    const d = deptById(t.departmentId);
    prop(B.department.label, staff ? deptSelect(t.departmentId, v => patchTask(t, { departmentId: v }))
      : ro(d && h('span', { class: 'chip dept-chip', style: { background: `color-mix(in srgb, ${d.color} 16%, transparent)`, color: d.color } }, d.name)));
  }

  if (!B.dueDate.hidden && !staff) {
    const info = dueInfo(t.dueDate, taskDone(t));
    prop(B.dueDate.label, ro(info && h('span', { class: 'due ' + info.cls, title: info.hint }, icon('calendar', 12), info.text)));
  } else if (!B.dueDate.hidden) {
    const info = dueInfo(t.dueDate, taskDone(t));
    const setDue = v => { patchTask(t, { dueDate: v }); refreshPanel(t); };
    prop(B.dueDate.label, h('input', { class: 'inp', type: 'date', value: t.dueDate, onchange: e => setDue(e.target.value) }), {
      after: h('div', { class: 'prop-hint row', style: { gap: '10px' } },
        info && info.hint && h('span', { class: info.cls === 'overdue' ? 'prop-hint overdue' : 'muted', style: { margin: 0 } }, info.hint),
        !t.dueDate && [
          h('button', { class: 'link-btn', onclick: () => setDue(addDays(0)) }, 'Сегодня'),
          h('button', { class: 'link-btn', onclick: () => setDue(addDays(1)) }, 'Завтра'),
          h('button', { class: 'link-btn', onclick: () => setDue(addDays(7)) }, 'Через неделю'),
        ],
        t.dueDate && h('button', { class: 'link-btn', onclick: () => setDue('') }, 'Убрать')),
    });
  }

  const blocking = missingNext(t);
  activeFields().forEach(f => {
    const v = t.fields[f.id];
    prop(f.name, editable
      ? fieldInput(f, v, val => patchTask(t, { fields: { [f.id]: isEmpty(val) ? null : val } }))
      : ro(isEmpty(v) ? null : f.type === 'url' && safeUrl(v) ? h('a', { href: safeUrl(v), target: '_blank', rel: 'noopener noreferrer' }, v) : fmtValue(f, v)),
    { required: f.required, empty: editable && blocking.includes(f) });
  });

  return h('div', { class: 'panel-side' }, props, h('div', { class: 'side-meta', id: 'task-meta' }, metaLines(t)));
}

function metaLines(t) {
  const author = personById(t.createdBy);
  return [
    h('div', null, 'Создана ' + fmtDateTime(t.createdAt) + (author ? ' · ' + author.name : '')),
    h('div', null, 'Обновлена ' + relTime(t.updatedAt)),
  ];
}

/* ---------- контролы полей ---------- */

/** Отдел: select с цветной точкой. */
export function deptSelect(value, onChange) {
  const d = deptById(value);
  const dot = h('span', { class: 'dot', style: { background: d ? d.color : 'var(--border-strong)' } });
  const list = activeDepts();
  if (d && d.archived) list.push(d);
  return h('div', { class: 'status-wrap' }, dot, h('select', {
    class: 'inp', value: value || '',
    onchange: e => { const nd = deptById(e.target.value); dot.style.background = nd ? nd.color : 'var(--border-strong)'; onChange(e.target.value); },
  }, h('option', { value: '' }, '— без отдела —'), list.map(x => h('option', { value: x.id }, x.name))));
}

/**
 * Исполнитель: только участники команды (юнита). Текущий исполнитель вне команды тоже показывается.
 * ids — состав, если не текущая доска (например, форма создания с главной).
 */
export function assigneeSelect(value, onChange, { ids, unitId } = {}) {
  const team = ids || S.board.members.map(m => m.personId);
  const deptOf = id => { const p = personById(id); const d = p && deptById(p.positionId); return d ? ' · ' + d.name : ''; };
  const people = team.map(personById).filter(p => p && (p.active || p.id === value));
  const outsider = value && !team.includes(value) && personById(value);
  const sel = h('select', {
    class: 'inp', value: value || '',
    onchange: async e => {
      if (e.target.value === '__add') {
        e.target.value = value || '';
        const added = await addMemberDialog(unitId || S.board.unit.id);
        if (added) {
          value = added;
          e.target.insertBefore(h('option', { value: added }, personById(added).name + deptOf(added)), e.target.querySelector('option[value="__add"]'));
          e.target.value = added;
          onChange(added);
        }
        return;
      }
      value = e.target.value;
      onChange(value);
    },
  },
  h('option', { value: '' }, '— не назначен —'),
  people.map(p => h('option', { value: p.id }, p.name + deptOf(p.id))),
  outsider && h('option', { value: outsider.id }, outsider.name + ' (не в команде)'),
  h('option', { value: '__add' }, '＋ Добавить в команду…'));
  return sel;
}

/** Человек для поля типа «Человек»: активные люди (и текущее значение, даже если отключён). */
export function personSelect(value, onChange) {
  const people = S.people.filter(p => p.active || p.id === value);
  return h('select', { class: 'inp', value: value || '', onchange: e => onChange(e.target.value) },
    h('option', { value: '' }, '— не выбран —'),
    people.map(p => h('option', { value: p.id }, p.name + (p.active ? '' : ' (неактивен)'))));
}

/** Контрол для кастомного поля. onChange(value) — пустое значение означает «очистить». */
export function fieldInput(f, v, onChange) {
  switch (f.type) {
    case 'longtext':
      return autosize(h('textarea', { class: 'inp', rows: 2, value: v == null ? '' : String(v), onchange: e => onChange(e.target.value.trim()) }));
    case 'number':
      return h('input', {
        class: 'inp', type: 'number', step: 'any', value: v === '' || v == null || !isFinite(Number(v)) ? '' : Number(v),
        onchange: e => onChange(e.target.value === '' ? null : Number(e.target.value)),
      });
    case 'date':
      return h('input', { class: 'inp', type: 'date', value: /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '', onchange: e => onChange(e.target.value) });
    case 'checkbox':
      return h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!v, onchange: e => onChange(e.target.checked || null) }), 'Да');
    case 'url': {
      const a = h('a', { class: 'icon-btn', target: '_blank', rel: 'noopener noreferrer', title: 'Открыть', href: safeUrl(v) || '#', hidden: !safeUrl(v) }, icon('arrow', 15));
      return h('div', { class: 'row', style: { flexWrap: 'nowrap', gap: '4px' } },
        h('input', {
          class: 'inp', type: 'url', placeholder: 'https://…', value: v == null ? '' : String(v),
          onchange: e => {
            const val = e.target.value.trim();
            onChange(val);
            a.hidden = !safeUrl(val);
            a.href = safeUrl(val) || '#';
          },
        }), a);
    }
    case 'select':
      return h('select', { class: 'inp', value: optById(f, v) ? v : '', onchange: e => onChange(e.target.value) },
        h('option', { value: '' }, '—'),
        f.options.map(o => h('option', { value: o.id }, o.name)));
    case 'multiselect': {
      let cur = (Array.isArray(v) ? v : []).filter(id => optById(f, id));
      const box = h('div', { class: 'row', style: { gap: '6px' } });
      const draw = () => fill(box, ...(f.options.length ? f.options.map(o => {
        const on = cur.includes(o.id);
        return h('button', {
          type: 'button', class: 'opt-toggle' + (on ? ' on' : ''), style: on ? { background: o.color } : null,
          onclick: () => { cur = on ? cur.filter(x => x !== o.id) : cur.concat(o.id); draw(); onChange(cur.slice()); },
        }, o.name);
      }) : [h('span', { class: 'hint' }, 'Нет вариантов — добавьте их в настройках поля')]));
      draw();
      return box;
    }
    case 'person':
      return personSelect(v, onChange);
    default:
      return h('input', { class: 'inp', value: v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v), onchange: e => onChange(e.target.value.trim()) });
  }
}

/* ================= Создание задачи ================= */

export function openCreateTask(opts = {}) {
  if (!isStaff()) return toast('Создавать задачи могут модераторы и администраторы');
  const units = S.units.filter(u => !u.archived);
  if (!units.length) {
    toast('Сначала создайте юнит');
    return openCreateUnit();
  }
  const inBoard = !!S.board && (!opts.unitId || opts.unitId === S.board.unit.id);
  // С дашборда для конкретного человека — его первый юнит, исполнитель и позиция подставлены
  const ownUnit = opts.assigneeId && units.find(u => (u.members || []).includes(opts.assigneeId));
  let unit = inBoard ? S.board.unit : unitById(opts.unitId) || ownUnit || units[0];
  const draft = {
    status: opts.status || '', assigneeId: opts.assigneeId || '', dueDate: '', fields: {},
    departmentId: opts.departmentId || (S.filters.depts.length === 1 && inBoard ? S.filters.depts[0] : ''),
  };

  const title = autosize(h('textarea', { class: 'inp title-field', rows: 1, placeholder: 'Что нужно сделать?', maxlength: 500 }));
  title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submitBtn().click(); } });
  const desc = autosize(h('textarea', { class: 'inp', rows: 3, placeholder: 'Описание (необязательно)', maxlength: 20000 }));
  const more = h('label', { class: 'chk hint' }, h('input', { type: 'checkbox' }), 'Создать ещё одну');
  const props = h('div', { class: 'grid2' });

  const drawProps = () => {
    const B = unit.settings.builtins;
    fill(props, 
      !inBoard && field('Юнит', h('select', {
        class: 'inp', value: unit.id,
        onchange: e => { unit = unitById(e.target.value); drawProps(); },
      }, units.map(u => h('option', { value: u.id }, u.name + ' · ' + u.key)))),
      field(B.status.label, h('select', { class: 'inp', value: draft.status || unit.settings.columns[0].id, onchange: e => { draft.status = e.target.value; } },
        unit.settings.columns.map(c => h('option', { value: c.id }, c.name)))),
      !B.assignee.hidden && field(B.assignee.label, assigneeSelect(draft.assigneeId, v => {
        draft.assigneeId = v;
        // Позиция следует за исполнителем
        const p = personById(v);
        if (p && p.positionId) { draft.departmentId = p.positionId; drawProps(); }
      }, inBoard ? {} : { ids: unit.members || [], unitId: unit.id })),
      !B.department.hidden && field(B.department.label, deptSelect(draft.departmentId, v => { draft.departmentId = v; })),
      !B.dueDate.hidden && field(B.dueDate.label, h('input', { class: 'inp', type: 'date', value: draft.dueDate, onchange: e => { draft.dueDate = e.target.value; } })),
      inBoard && activeFields().map(f => field(f.name + (f.required ? ' *' : ''),
        fieldInput(f, draft.fields[f.id], v => { if (isEmpty(v)) delete draft.fields[f.id]; else draft.fields[f.id] = v; }))),
      !inBoard && h('div', { class: 'hint', style: { gridColumn: '1 / -1' } }, 'Дополнительные поля юнита можно заполнить в карточке после создания.'));
  };
  drawProps();

  const close = modal({
    title: 'Новая задача',
    wide: true,
    body: [title, h('div', { style: { height: '10px' } }), desc, h('div', { style: { height: '14px' } }), props],
    footLeft: more,
    actions: [
      { label: 'Отмена' },
      {
        label: 'Создать', primary: true, action: async () => {
          const text = title.value.trim();
          if (!text) { title.focus(); return; }
          const task = await send('createTask', { unitId: unit.id, title: text, description: desc.value, ...draft });
          const key = unit.key + '-' + task.num;
          if (S.board && S.board.unit.id === unit.id) {
            S.board.tasks.push(task);
            renderTasks();
          }
          if (more.querySelector('input').checked) {
            title.value = ''; desc.value = '';
            title.focus();
            toast('Создана ' + key);
            return;
          }
          close();
          if (S.board && S.board.unit.id === unit.id) {
            toast('Создана ' + key, { action: { label: 'Открыть', run: () => navigate({ unit: unit.id, mode: S.route.mode, task: task.id }) } });
          } else {
            // Не уводим со страницы: задачу можно открыть поверх
            toast('Создана ' + key, { action: { label: 'Открыть', run: () => peekTask(unit.id, task.id) } });
            if (opts.onCreated) opts.onCreated(task);
          }
        },
      },
    ],
  });
  const submitBtn = () => $('#modal-root .modal-foot .btn.primary');
  title.focus();
  return close;
}

/* ================= Действия ================= */

export function duplicateTask(t) {
  const unitId = t.unitId;
  send('duplicateTask', { id: t.id }).then(copy => {
    if (!S.board || S.board.unit.id !== unitId) return;
    S.board.tasks.push(copy);
    renderTasks();
    navigate({ unit: unitId, mode: S.route.mode, task: copy.id });
    toast('Создана копия ' + taskKey(copy));
  }).catch(showErr);
}

/** Удаление с возможностью отмены: на сервер уходит через 5 секунд. */
export function deleteTaskUndoable(t) {
  const key = taskKey(t);
  S.board.tasks = S.board.tasks.filter(x => x !== t);
  if (S.panelTaskId === t.id) closeTask();
  renderTasks();
  let undone = false;
  const timer = setTimeout(() => {
    if (!undone) send('deleteTask', () => ({ id: t.id })).catch(e => { showErr(e); reloadBoard(); });
  }, 5000);
  toast('Задача ' + key + ' удалена', {
    duration: 5000,
    action: {
      label: 'Отменить', run: () => {
        undone = true;
        clearTimeout(timer);
        if (S.board && S.board.unit.id === t.unitId) { S.board.tasks.push(t); renderTasks(); }
      },
    },
  });
}

function moveTaskDialog(t) {
  const others = S.board.units.filter(x => x.id !== S.board.unit.id && !x.archived);
  const sel = h('select', { class: 'inp' }, others.map(u => h('option', { value: u.id }, u.name + ' · ' + u.key)));
  modal({
    title: 'Перенести ' + taskKey(t),
    body: [
      field('В юнит', sel),
      h('p', { class: 'hint', style: { margin: 0 } }, 'Задача получит новый номер. Значения полей, которых нет в том юните, скроются, но не удалятся — при переносе обратно они вернутся.'),
    ],
    actions: [
      { label: 'Отмена' },
      {
        label: 'Перенести', primary: true, action: async close => {
          const target = others.find(u => u.id === sel.value);
          const moved = await send('moveTask', { id: t.id, unitId: target.id });
          close();
          S.board.tasks = S.board.tasks.filter(x => x.id !== t.id);
          closeTask();
          renderTasks();
          toast('Перенесено в «' + target.name + '» как ' + target.key + '-' + moved.num, {
            action: { label: 'Открыть', run: () => navigate({ unit: target.id, mode: 'board', task: moved.id }) },
          });
        },
      },
    ],
  });
}
