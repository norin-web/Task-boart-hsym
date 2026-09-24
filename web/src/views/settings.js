import Sortable from 'sortablejs';
import { S, TYPE_LABELS, AUTO_ARCHIVE, PALETTE, unitById, byOrder, KINDS, KIND_LABELS, KIND_COLORS, colColor, personById, activeDepts, deptById } from '../state.js';
import { $, h, icon, avatar, field, topbar, menu, closeMenu, modal, confirmDlg, toast, showErr, colorPicker, statusDot, fill } from '../ui.js';
import { send } from '../api.js';
import { link } from '../router.js';
import { renderSidebar } from './sidebar.js';
import { archiveUnit, deleteUnit } from './units.js';
import { addMemberDialog, applyMembers, openDepartments } from './people.js';

export function renderSettings() {
  const b = S.board;
  const u = b.unit;
  const st = structuredClone(u.settings);

  const name = h('input', { class: 'inp', value: u.name, maxlength: 80 });
  const key = h('input', { class: 'inp mono', value: u.key, maxlength: 10, oninput: e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); } });
  const color = colorPicker(u.color);
  const desc = h('textarea', { class: 'inp', rows: 2, value: u.description, maxlength: 1000 });
  const autoArchive = h('select', { class: 'inp', value: String(st.autoArchiveDays) },
    AUTO_ARCHIVE.map(d => h('option', { value: String(d) }, d ? `Через ${d} дн. после выполнения` : 'Выключен')));
  const colEditor = columnsEditor(st.columns);
  const builtinRows = Object.entries(st.builtins).map(([k, bi]) => {
    const label = h('input', { class: 'inp', value: bi.label, maxlength: 40 });
    const hidden = bi.hideable ? h('input', { type: 'checkbox', checked: bi.hidden }) : null;
    return {
      k, label, hidden,
      el: h('div', { class: 'row', style: { marginBottom: '8px', flexWrap: 'nowrap' } }, label,
        hidden ? h('label', { class: 'chk', style: { minWidth: '92px' } }, hidden, 'Скрыть') : h('span', { class: 'hint', style: { minWidth: '92px' } }, 'всегда видно')),
    };
  });

  const save = async btn => {
    btn.disabled = true;
    try {
      st.autoArchiveDays = Number(autoArchive.value);
      st.columns = colEditor.value();
      // Задачи из удалённых колонок — в первую оставшуюся (с подтверждением)
      const ids = new Set(st.columns.map(c => c.id));
      const orphans = b.tasks.filter(t => !ids.has(t.status));
      let remap = {};
      if (orphans.length) {
        const ok = await confirmDlg(`${orphans.length} задач(и) из удалённых колонок переедут в «${st.columns[0].name}». Продолжить?`, { ok: 'Сохранить' });
        if (!ok) { btn.disabled = false; return; }
        orphans.forEach(t => { remap[t.status] = st.columns[0].id; });
      }
      builtinRows.forEach(r => {
        st.builtins[r.k].label = r.label.value.trim() || st.builtins[r.k].label;
        if (r.hidden) st.builtins[r.k].hidden = r.hidden.checked;
      });
      const saved = await send('updateUnit', { id: u.id, name: name.value, key: key.value, color: color.value(), description: desc.value, settings: st, statusRemap: remap });
      if (orphans.length) orphans.forEach(t => { t.status = remap[t.status]; });
      Object.assign(u, saved);
      const lu = unitById(u.id);
      if (lu) Object.assign(lu, saved);
      const bu = b.units.find(x => x.id === u.id);
      if (bu) Object.assign(bu, { name: saved.name, key: saved.key, color: saved.color });
      toast('Настройки сохранены');
      renderSidebar();
      renderSettings();
    } catch (e) {
      showErr(e);
      btn.disabled = false;
    }
  };

  const active = b.fields.filter(f => !f.archived).sort(byOrder);
  const archived = b.fields.filter(f => f.archived);
  const fieldList = h('div', { class: 'field-list' }, active.map(f => h('div', { class: 'field-row', dataset: { id: f.id } },
    h('span', { class: 'drag', title: 'Перетащите, чтобы изменить порядок' }, icon('grip', 16)),
    h('span', { class: 'name' }, f.name),
    h('span', { class: 'badge' }, TYPE_LABELS[f.type] || f.type),
    f.showOnCard && h('span', { class: 'badge' }, 'на карточке'),
    f.required && h('span', { class: 'badge' }, 'обязательное'),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn sm', onclick: () => openFieldEditor(f) }, icon('edit', 13), 'Изменить'),
    h('button', { class: 'btn ghost sm', title: 'Убрать с карточек (значения сохранятся)', onclick: () => setFieldArchived(f, true) }, 'Убрать'))));

  fill($('#main'),
    topbar([
      link({ unit: u.id, mode: 'board' }, { class: 'btn ghost' }, icon('back', 15), 'Доска'),
      h('h1', null, 'Настройки'),
      h('span', { class: 'muted' }, u.name),
    ], []),
    h('div', { class: 'view-body' }, h('div', { class: 'page settings-page' },
      h('section', { class: 'card-box' },
        h('h2', null, 'Основное'),
        h('p', { class: 'hint' }, 'Название, ключ и внешний вид юнита.'),
        h('div', { class: 'grid2' }, field('Название', name), field('Ключ задач', key, 'Номера задач: ' + u.key + '-1, ' + u.key + '-2… При смене ключа номера обновятся.')),
        field('Цвет', color.el),
        field('Описание', desc),
        field('Автоархив выполненных', autoArchive, 'Задачи из последней колонки уходят в архив. Архив можно показать фильтром на доске.'),

        h('div', { class: 'sub-title' }, 'Колонки доски'),
        h('p', { class: 'hint', style: { marginTop: '-4px' } }, 'Тип колонки влияет на статистику: «Готово» — задача выполнена (не просрочена, считается в прогрессе).'),
        colEditor.el,

        h('div', { class: 'sub-title' }, 'Стандартные поля'),
        builtinRows.map(r => r.el),

        h('div', { class: 'row', style: { marginTop: '16px' } }, h('button', { class: 'btn primary', onclick: e => save(e.currentTarget) }, 'Сохранить изменения'))),

      teamSection(),

      h('section', { class: 'card-box' },
        h('div', { class: 'section-head', style: { marginBottom: '4px' } },
          h('h2', null, 'Поля карточки'),
          h('button', { class: 'btn primary sm', onclick: () => openFieldEditor(null) }, icon('plus', 14), 'Поле')),
        h('p', { class: 'hint' }, 'Свои поля для задач этого юнита: списки, даты, числа, ссылки. Порядок меняется перетаскиванием.'),
        active.length ? fieldList : h('p', { class: 'muted' }, 'Своих полей пока нет.'),
        archived.length > 0 && [
          h('div', { class: 'sub-title' }, 'Убранные поля'),
          h('p', { class: 'hint', style: { marginTop: 0 } }, 'Значения в задачах сохранены — поле можно вернуть.'),
          h('div', { class: 'field-list' }, archived.map(f => h('div', { class: 'field-row' },
            h('span', { class: 'name muted' }, f.name),
            h('span', { class: 'badge' }, TYPE_LABELS[f.type] || f.type),
            h('span', { class: 'spacer' }),
            h('button', { class: 'btn sm', onclick: () => setFieldArchived(f, false) }, 'Вернуть'),
            h('button', { class: 'btn ghost sm danger', onclick: () => deleteFieldForever(f) }, 'Удалить навсегда')))),
        ]),

      h('section', { class: 'card-box danger-zone' },
        h('h2', null, 'Опасная зона'),
        h('p', { class: 'hint' }, 'Архивный юнит скрывается из меню, но все задачи сохраняются. Удаление необратимо.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => { archiveUnit(unitById(u.id) || u, !u.archived); renderSettings(); } }, icon('archive', 15), u.archived ? 'Вернуть из архива' : 'В архив'),
          h('button', { class: 'btn danger', onclick: () => deleteUnit(unitById(u.id) || u) }, icon('trash', 15), 'Удалить юнит'))))));

  if (active.length > 1) {
    Sortable.create(fieldList, {
      handle: '.drag', animation: 150,
      onEnd: () => {
        const ids = [...fieldList.children].map(el => el.dataset.id);
        ids.forEach((id, i) => { b.fields.find(f => f.id === id).order = i + 1; });
        send('reorderFields', { unitId: u.id, ids }).catch(showErr);
      },
    });
  }
}

function setFieldArchived(f, archived) {
  send('updateField', { id: f.id, archived }).then(saved => {
    Object.assign(f, saved);
    renderSettings();
    toast(archived ? `Поле «${f.name}» убрано` : `Поле «${f.name}» возвращено`);
  }).catch(showErr);
}

async function deleteFieldForever(f) {
  if (!(await confirmDlg(`Удалить поле «${f.name}» навсегда? Его значения будут стёрты во всех задачах юнита.`, { ok: 'Удалить', danger: true }))) return;
  send('deleteField', { id: f.id }).then(() => {
    S.board.fields = S.board.fields.filter(x => x.id !== f.id);
    S.board.tasks.forEach(t => { delete t.fields[f.id]; });
    renderSettings();
    toast('Поле удалено');
  }).catch(showErr);
}

function openFieldEditor(f) {
  const isNew = !f;
  const name = h('input', { class: 'inp', value: f ? f.name : '', maxlength: 60, placeholder: 'Например, Оценка или Канал' });
  const type = h('select', { class: 'inp', value: f ? f.type : 'select' },
    Object.entries(TYPE_LABELS).map(([k, v]) => h('option', { value: k }, v)));
  const showOnCard = h('input', { type: 'checkbox', checked: f ? f.showOnCard : true });
  const required = h('input', { type: 'checkbox', checked: f ? f.required : false });
  const options = f ? structuredClone(f.options) : [];

  const optBox = h('div');
  const optSection = h('div', { class: 'field' }, h('label', null, 'Варианты'), optBox);
  const drawOptions = focusLast => {
    fill(optBox, 
      ...options.map((o, i) => h('div', { class: 'opt-row' },
        h('input', { type: 'color', value: o.color, title: 'Цвет', oninput: e => { o.color = e.target.value; } }),
        h('input', { class: 'inp', value: o.name, maxlength: 60, placeholder: 'Вариант ' + (i + 1), oninput: e => { o.name = e.target.value; } }),
        h('button', { class: 'icon-btn sm', title: 'Выше', disabled: i === 0, onclick: () => { options.splice(i - 1, 0, options.splice(i, 1)[0]); drawOptions(); } }, '↑'),
        h('button', { class: 'icon-btn sm', title: 'Ниже', disabled: i === options.length - 1, onclick: () => { options.splice(i + 1, 0, options.splice(i, 1)[0]); drawOptions(); } }, '↓'),
        h('button', { class: 'icon-btn sm', title: 'Удалить вариант', onclick: () => { options.splice(i, 1); drawOptions(); } }, icon('x', 14)))),
      h('button', {
        class: 'btn sm', onclick: () => {
          options.push({ id: 'o_' + Math.random().toString(36).slice(2, 10), name: '', color: PALETTE[options.length % PALETTE.length] });
          drawOptions(true);
        },
      }, icon('plus', 13), 'Вариант'));
    if (focusLast) { const ins = optBox.querySelectorAll('.inp'); ins[ins.length - 1].focus(); }
  };
  const typeNote = h('div', { class: 'hint' });
  const syncType = () => {
    optSection.hidden = !['select', 'multiselect'].includes(type.value);
    typeNote.textContent = !isNew && type.value !== f.type ? 'Тип меняется: уже заполненные значения могут отображаться некорректно.' : '';
    if (!optSection.hidden && !options.length) {
      ['Вариант 1', 'Вариант 2'].forEach((n, i) => options.push({ id: 'o_' + Math.random().toString(36).slice(2, 10), name: n, color: PALETTE[i] }));
      drawOptions();
    }
  };
  type.addEventListener('change', syncType);
  drawOptions();
  syncType();

  modal({
    title: isNew ? 'Новое поле' : `Поле «${f.name}»`,
    body: [
      h('div', { class: 'grid2' }, field('Название', name), field('Тип', type, typeNote)),
      optSection,
      h('div', { class: 'row', style: { gap: '18px' } },
        h('label', { class: 'chk' }, showOnCard, 'Показывать на карточке'),
        h('label', { class: 'chk' }, required, 'Обязательное')),
    ],
    wide: true,
    actions: [
      { label: 'Отмена' },
      {
        label: isNew ? 'Создать поле' : 'Сохранить', primary: true, action: async close => {
          if (!name.value.trim()) { name.focus(); return; }
          const payload = {
            name: name.value, type: type.value, showOnCard: showOnCard.checked, required: required.checked,
            options: ['select', 'multiselect'].includes(type.value) ? options.filter(o => o.name.trim()) : [],
          };
          if (isNew) S.board.fields.push(await send('createField', { unitId: S.board.unit.id, ...payload }));
          else Object.assign(f, await send('updateField', { id: f.id, ...payload }));
          close();
          renderSettings();
        },
      },
    ],
  });
}

/* ---------- колонки ---------- */

/** Редактор набора колонок: название, тип, цвет, порядок, удаление. Возвращает { el, value() }. */
function columnsEditor(initial) {
  let cols = initial.map(c => ({ ...c }));
  const el = h('div');
  const draw = () => fill(el,
    cols.map((c, i) => h('div', { class: 'col-edit-row' },
      h('button', {
        class: 'swatch', title: 'Цвет', style: { background: colColor(c) },
        onclick: e => {
          e.stopPropagation();
          menu(e.currentTarget, [h('div', { class: 'colors menu-colors' },
            h('button', { class: 'swatch auto' + (!c.color ? ' on' : ''), title: 'По типу', style: { background: KIND_COLORS[c.kind] }, onclick: () => { c.color = ''; closeMenu(); draw(); } }, 'A'),
            PALETTE.map(p => h('button', { class: 'swatch' + (c.color === p ? ' on' : ''), style: { background: p }, onclick: () => { c.color = p; closeMenu(); draw(); } })))]);
        },
      }),
      h('input', { class: 'inp', value: c.name, maxlength: 40, placeholder: 'Название', oninput: e => { c.name = e.target.value; } }),
      h('select', { class: 'inp', value: c.kind, onchange: e => { c.kind = e.target.value; draw(); } }, KINDS.map(k => h('option', { value: k }, KIND_LABELS[k]))),
      h('button', { class: 'icon-btn sm', title: 'Выше', disabled: i === 0, onclick: () => { cols.splice(i - 1, 0, cols.splice(i, 1)[0]); draw(); } }, '↑'),
      h('button', { class: 'icon-btn sm', title: 'Ниже', disabled: i === cols.length - 1, onclick: () => { cols.splice(i + 1, 0, cols.splice(i, 1)[0]); draw(); } }, '↓'),
      h('button', { class: 'icon-btn sm', title: 'Удалить колонку', disabled: cols.length === 1, onclick: () => { cols.splice(i, 1); draw(); } }, icon('x', 14)))),
    h('button', {
      class: 'btn sm', onclick: () => {
        const at = cols.findIndex(c => c.kind === 'done');
        cols.splice(at < 0 ? cols.length : at, 0, { id: 'c_' + Math.random().toString(36).slice(2, 10), name: '', kind: 'progress', color: '' });
        draw();
        el.querySelectorAll('.col-edit-row .inp')[(at < 0 ? cols.length - 1 : at) * 2].focus();
      },
    }, icon('plus', 13), 'Колонка'));
  draw();
  return { el, value: () => cols.map(c => ({ ...c, name: c.name.trim() || 'Колонка' })) };
}

/* ---------- команда ---------- */

function teamSection() {
  const b = S.board;
  const box = h('section', { class: 'card-box' });
  const setDept = (m, departmentId) => send('setMember', { unitId: b.unit.id, personId: m.personId, departmentId })
    .then(list => { applyMembers(b.unit.id, list); toast('Отдел обновлён'); }).catch(showErr);
  const remove = async m => {
    const p = personById(m.personId);
    if (!(await confirmDlg(`Убрать ${p ? p.name : 'участника'} из команды? Задачи, где он исполнитель, останутся за ним.`, { ok: 'Убрать', danger: true }))) return;
    const list = await send('removeMember', { unitId: b.unit.id, personId: m.personId });
    applyMembers(b.unit.id, list);
    draw();
  };
  const draw = () => {
    const depts = activeDepts();
    fill(box,
      h('div', { class: 'section-head', style: { marginBottom: '4px' } },
        h('h2', null, 'Команда'),
        h('div', { class: 'row' },
          h('button', { class: 'btn ghost sm', onclick: openDepartments }, icon('layers', 14), 'Отделы'),
          h('button', { class: 'btn primary sm', onclick: async () => { if (await addMemberDialog(b.unit.id)) draw(); } }, icon('plus', 14), 'Участник'))),
      h('p', { class: 'hint' }, 'Кто работает в этом юните и в каком отделе. Исполнителя задачи выбирают из команды; отдел участника подставляется в задачу автоматически.'),
      b.members.length
        ? b.members.map(m => {
          const p = personById(m.personId);
          if (!p) return null;
          const d = deptById(m.departmentId);
          return h('div', { class: 'member-row' },
            avatar(p),
            h('span', { class: 'person-text' }, h('span', { class: 'person-name' }, p.name), p.role && h('span', { class: 'person-sub' }, p.role)),
            h('select', { class: 'inp', value: m.departmentId, onchange: e => setDept(m, e.target.value) },
              h('option', { value: '' }, '— без отдела —'),
              depts.concat(d && d.archived ? [d] : []).map(x => h('option', { value: x.id }, x.name))),
            h('button', { class: 'icon-btn sm', title: 'Убрать из команды', onclick: () => remove(m).catch(showErr) }, icon('x', 15)));
        })
        : h('p', { class: 'muted' }, 'В команде пока никого. Добавьте участников, чтобы назначать их на задачи.'));
  };
  draw();
  return box;
}
