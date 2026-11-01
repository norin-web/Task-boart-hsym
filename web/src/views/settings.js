import Sortable from 'sortablejs';
import { S, TYPE_LABELS, PALETTE, unitById, byOrder, KINDS, KIND_LABELS, KIND_COLORS, colColor, personById, activeDepts, plural } from '../state.js';
import { $, h, icon, avatar, field, topbar, menu, closeMenu, modal, confirmDlg, toast, showErr, colorPicker, fill } from '../ui.js';
import { send } from '../api.js';
import { link } from '../router.js';
import { renderSidebar } from './sidebar.js';
import { archiveUnit, deleteUnit } from './units.js';
import { flowSection } from './flows.js';
import { addMemberDialog, applyMembers, openDepartments, positionChips } from './people.js';
import { unitHeader } from './unitnav.js';

export function renderSettings() {
  const b = S.board;
  const u = b.unit;
  const st = structuredClone(u.settings);

  const name = h('input', { class: 'inp', value: u.name, maxlength: 80 });
  const key = h('input', { class: 'inp us-key', value: u.key, maxlength: 10, oninput: e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); } });
  const color = colorPicker(u.color);
  const desc = h('textarea', { class: 'inp', rows: 2, value: u.description, maxlength: 1000 });
  const colEditor = columnsEditor(st.columns);
  const builtinRows = Object.entries(st.builtins).map(([k, bi]) => {
    const label = h('input', { class: 'inp', value: bi.label, maxlength: 40, 'aria-label': 'Название поля' });
    // переключатель включён — поле показывается
    const shown = bi.hideable ? h('input', { class: 'switch', type: 'checkbox', checked: !bi.hidden, 'aria-label': 'Показывать поле' }) : null;
    return { k, label, shown, el: h('div', { class: 'us-std-row' }, label, shown || h('span', { class: 'muted' }, 'всегда видно')) };
  });

  const save = async btn => {
    btn.disabled = true;
    try {
      // правила юнита (ревью, чеклист, выполненные) живут в «Автоматизациях» — берём сохранённые
      Object.assign(st, { review: u.settings.review, hideDoneDays: u.settings.hideDoneDays, autoArchiveDays: u.settings.autoArchiveDays, checklistBeforeDone: u.settings.checklistBeforeDone });
      st.columns = colEditor.value();
      // Задачи из удалённых колонок — в первую оставшуюся (с подтверждением)
      const ids = new Set(st.columns.map(c => c.id));
      const orphans = b.tasks.filter(t => !ids.has(t.status));
      let remap = {};
      if (orphans.length) {
        const ok = await confirmDlg(`${orphans.length} ${plural(orphans.length, ['задача', 'задачи', 'задач'])} из удалённых колонок переедут в «${st.columns[0].name}». Продолжить?`, { ok: 'Сохранить' });
        if (!ok) { btn.disabled = false; return; }
        orphans.forEach(t => { remap[t.status] = st.columns[0].id; });
      }
      builtinRows.forEach(r => {
        st.builtins[r.k].label = r.label.value.trim() || st.builtins[r.k].label;
        if (r.shown) st.builtins[r.k].hidden = !r.shown.checked;
      });
      st.flows = u.settings.flows; // флоу сохраняется отдельно (своя кнопка) — берём свежий
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

  const own = b.fields.filter(f => !f.global);
  const globals = b.fields.filter(f => f.global && !f.archived).sort(byOrder);
  const active = own.filter(f => !f.archived).sort(byOrder);
  const archived = own.filter(f => f.archived);
  const editField = f => openFieldEditor(f, {
    columns: u.settings.columns,
    onSaved: (saved, isNew) => { if (isNew) b.fields.push(saved); else Object.assign(f, saved); renderSettings(); },
  });
  const fieldList = h('div', { class: 'field-list' }, active.map(f => h('div', { class: 'field-row', dataset: { id: f.id } },
    h('span', { class: 'drag', title: 'Перетащите, чтобы изменить порядок' }, icon('grip', 16)),
    h('span', { class: 'name' }, f.name),
    h('span', { class: 'spacer' }),
    h('span', { class: 'fr-acts' },
      h('button', { class: 'btn sm', onclick: () => editField(f) }, icon('edit', 13), 'Изменить'),
      h('button', { class: 'btn ghost sm', title: 'Убрать с карточек (значения сохранятся)', onclick: () => setFieldArchived(f, true) }, 'Убрать')),
    h('span', { class: 'muted fr-type' }, [TYPE_LABELS[f.type] || f.type, (f.options || []).length > 0 && `${f.options.length} ${plural(f.options.length, ['вариант', 'варианта', 'вариантов'])}`].filter(Boolean).join(' · ')))));

  fill($('#main'),
    ...unitHeader('settings', [h('button', { class: 'btn primary', onclick: e => save(e.currentTarget) }, 'Сохранить изменения')]),
    h('div', { class: 'view-body' }, h('div', { class: 'page settings-page unit-set' },
      h('div', { class: 'us-col' },
      h('section', { class: 'card-box' },
        h('h2', null, 'Основное'),
        h('div', { class: 'grid2' }, field('Название', name), field('Ключ задач', key, 'Номера задач: ' + u.key + '-1, ' + u.key + '-2…')),
        field('Цвет', color.el),
        field('Описание', desc)),

      h('section', { class: 'card-box' },
        h('h2', null, 'Колонки доски'),
        h('p', { class: 'hint' }, 'Тип колонки влияет на статистику: «Готово» — задача выполнена.'),
        colEditor.el),

      h('section', { class: 'card-box' },
        h('h2', null, 'Стандартные поля'),
        h('p', { class: 'hint' }, 'Названия и показ полей карточки задачи этого юнита.'),
        builtinRows.map(r => r.el)),

      h('p', { class: 'rules-pill' }, 'Ревью, чеклист перед «Готово», скрытие и автоархив — в ',
        link({ view: 'settings', tab: 'automations' }, null, 'Настройки → Автоматизации'))),

      h('div', { class: 'us-col' },
      h('section', { class: 'card-box' },
        h('div', { class: 'section-head', style: { marginBottom: '4px' } },
          h('h2', null, 'Поля карточки'),
          h('button', { class: 'btn sm', onclick: () => editField(null) }, icon('plus', 14), 'Поле')),
        h('p', { class: 'hint' }, 'Свои поля юнита идут на карточке после общих.'),
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
        h('p', { class: 'hint' }, 'Архивный юнит скрывается из меню, задачи сохраняются. Удаление необратимо.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => { archiveUnit(unitById(u.id) || u, !u.archived); renderSettings(); } }, u.archived ? 'Вернуть из архива' : 'В архив'),
          h('button', { class: 'btn danger solid', onclick: () => deleteUnit(unitById(u.id) || u) }, 'Удалить юнит')))),

      h('div', { class: 'us-wide' }, teamSection(), flowSection(u)))));

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

/** Подпись обязательности: у поля юнита — колонка, у общего — тип колонки. */
export function requiredLabel(f, columns) {
  if (f.global) return f.requiredFrom ? `обязательное с «${KIND_LABELS[f.requiredFrom] || f.requiredFrom}»` : 'обязательное';
  const c = f.requiredFrom && (columns || S.board.unit.settings.columns).find(x => x.id === f.requiredFrom);
  return c ? `обязательное с «${c.name}»` : 'обязательное';
}

/**
 * Окно поля карточки. opts: { global — общее на все юниты, columns — колонки юнита (для своего поля), onSaved(saved, isNew) }.
 * Обязательность у своего поля — «с колонки X», у общего — «с типа колонки» (в работе / готово): колонки у юнитов разные.
 */
export function openFieldEditor(f, { global = !!(f && f.global), columns = [], onSaved } = {}) {
  const isNew = !f;
  const name = h('input', { class: 'inp', value: f ? f.name : '', maxlength: 60, placeholder: 'Например, Оценка или Канал' });
  const type = h('select', { class: 'inp', value: f ? f.type : 'select' },
    Object.entries(TYPE_LABELS).map(([k, v]) => h('option', { value: k }, v)));
  const showOnCard = h('input', { type: 'checkbox', checked: f ? f.showOnCard : true });
  const staffOnly = h('input', { type: 'checkbox', checked: f ? f.staffOnly : false });
  const onCreate = h('input', { type: 'checkbox', checked: f ? f.requiredOnCreate : false });
  const isPriority = !!f && f.role === 'priority';
  // '' — не обязательное, '*' — для любого переноса, id колонки — с неё и правее
  const required = h('select', { class: 'inp', value: !f || !f.required ? '' : f.requiredFrom || '*' },
    h('option', { value: '' }, 'Не обязательное'),
    h('option', { value: '*' }, 'Для любого переноса'),
    global
      ? ['progress', 'done'].map(k => h('option', { value: k }, `Для переноса в «${KIND_LABELS[k]}» и дальше`))
      : columns.slice(1).map(c => h('option', { value: c.id }, `Для переноса в «${c.name}» и дальше`)));
  const options = f ? structuredClone(f.options) : [];

  const optBox = h('div');
  const optSection = h('div', { class: 'field' }, h('label', null, 'Варианты'), optBox);
  const drawOptions = focusLast => {
    fill(optBox, 
      ...options.map((o, i) => h('div', { class: 'opt-row' },
        h('input', { type: 'color', value: o.color, title: 'Цвет', oninput: e => { o.color = e.target.value; } }),
        h('input', { class: 'inp', value: o.name, maxlength: 60, placeholder: 'Вариант ' + (i + 1), oninput: e => { o.name = e.target.value; } }),
        h('button', { class: 'icon-btn sm', title: 'Выше', disabled: i === 0, onclick: () => { options.splice(i - 1, 0, options.splice(i, 1)[0]); drawOptions(); } }, icon('arrowUp', 14)),
        h('button', { class: 'icon-btn sm', title: 'Ниже', disabled: i === options.length - 1, onclick: () => { options.splice(i + 1, 0, options.splice(i, 1)[0]); drawOptions(); } }, icon('arrowDown', 14)),
        h('button', { class: 'icon-btn sm', title: 'Удалить вариант', onclick: () => { options.splice(i, 1); drawOptions(); } }, icon('x', 14)))),
      h('button', {
        class: 'btn sm', onclick: () => {
          options.push({ id: 'o_' + Math.random().toString(36).slice(2, 10), name: '', color: PALETTE[options.length % PALETTE.length] });
          drawOptions(true);
        },
      }, icon('plus', 13), 'Вариант'));
    if (focusLast) { const ins = optBox.querySelectorAll('.inp'); ins[ins.length - 1].focus(); }
  };
  const typeNote = h('div', { class: 'hint warn-note' });
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
    title: (isNew ? 'Новое поле' : `Поле «${f.name}»`) + (global ? ' · для всех юнитов' : ''),
    cls: 'dlg dlg-w',
    body: [
      isPriority && h('p', { class: 'hint' }, 'Приоритет — общий для всех юнитов: полоса на карточке и сортировка в колонке. Варианты сверху вниз — от низкого к высокому.'),
      h('div', { class: 'grid2' }, field('Название', name), isPriority ? h('div') : field('Тип', type, typeNote)),
      optSection,
      h('div', { class: 'grid2', style: { alignItems: 'end' } },
        field('Обязательное для участников', required),
        h('label', { class: 'chk' }, showOnCard, 'Показывать на карточке')),
      h('label', { class: 'chk' }, onCreate, 'Нужно уже при создании задачи (без него задачу не создать)'),
      h('label', { class: 'chk' }, staffOnly, 'Меняют только CEO и PM (сотрудник видит, но не правит)'),
    ],
    wide: true,
    actions: [
      { label: 'Отмена' },
      {
        label: isNew ? 'Создать поле' : 'Сохранить', primary: true, action: async close => {
          if (!name.value.trim()) { name.focus(); return; }
          const payload = {
            name: name.value, type: type.value, showOnCard: showOnCard.checked, required: !!required.value, requiredFrom: required.value === '*' ? '' : required.value,
            staffOnly: staffOnly.checked, requiredOnCreate: onCreate.checked,
            options: ['select', 'multiselect'].includes(type.value) ? options.filter(o => o.name.trim()) : [],
          };
          const saved = isNew
            ? await send('createField', global ? { global: true, ...payload } : { unitId: S.board.unit.id, ...payload })
            : await send('updateField', { id: f.id, ...payload });
          close();
          if (onSaved) onSaved(saved, isNew);
        },
      },
    ],
  });
}

/* ---------- колонки ---------- */

/** Редактор набора колонок: название, тип, цвет, порядок, удаление. Возвращает { el, value() }. */
export function columnsEditor(initial) {
  let cols = initial.map(c => ({ ...c }));
  const el = h('div');
  const list = h('div', { class: 'col-edit-list' });
  let sortable = null;
  const draw = () => {
    fill(list, cols.map((c, i) => h('div', { class: 'col-edit-row', dataset: { i } },
      h('span', { class: 'drag', title: 'Перетащите, чтобы изменить порядок' }, icon('grip', 16)),
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
      h('select', { class: 'inp', value: c.kind, onchange: e => { c.kind = e.target.value; draw(); } }, KINDS.map(k => h('option', { value: k }, c.id === 'review' && k === 'progress' ? 'Ревью' : KIND_LABELS[k]))),
      h('button', { class: 'icon-btn sm', title: 'Удалить колонку', disabled: cols.length === 1, onclick: () => { cols.splice(i, 1); draw(); } }, icon('x', 14)))));
    if (sortable) sortable.destroy();
    // порядок — перетаскиванием за ручку
    sortable = Sortable.create(list, {
      handle: '.drag', animation: 150, ghostClass: 'sortable-ghost', forceFallback: true, fallbackTolerance: 4,
      onEnd: () => { cols = [...list.children].map(r => cols[Number(r.dataset.i)]); draw(); },
    });
  };
  fill(el, list, h('button', {
    class: 'btn sm', onclick: () => {
      const at = cols.findIndex(c => c.kind === 'done');
      cols.splice(at < 0 ? cols.length : at, 0, { id: 'c_' + Math.random().toString(36).slice(2, 10), name: '', kind: 'progress', color: '' });
      draw();
      list.querySelectorAll('.col-edit-row .inp')[(at < 0 ? cols.length - 1 : at) * 2].focus();
    },
  }, icon('plus', 13), 'Колонка'));
  draw();
  return { el, value: () => cols.map(c => ({ ...c, name: c.name.trim() || 'Колонка' })) };
}

/* ---------- команда ---------- */

/* ---------- ревью: автоназначение ---------- */

/**
 * Колонка ревью и ревьюеры: задача пришла в колонку — назначается ревьюер её позиции (или по умолчанию);
 * ушла дальше или назад — возвращается тому, кто делал её до ревью. Сохраняется сразу.
 */
export function reviewSection(u = S.board.unit, { bare = false } = {}) {
  const box = h(bare ? 'div' : 'section', { class: bare ? '' : 'card-box' });
  const save = async review => {
    const saved = await send('updateUnit', { id: u.id, settings: { ...u.settings, review } });
    u.settings = saved.settings;
    draw();
    toast('Ревью: сохранено');
  };
  const people = () => S.people.filter(p => p.active).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const personSelect = (value, onChange, empty) => h('select', { class: 'inp', value: value || '', onchange: e => onChange(e.target.value) },
    h('option', { value: '' }, empty),
    people().map(p => h('option', { value: p.id }, p.name)));
  const draw = () => {
    const r = u.settings.review || { column: '', byPosition: {}, default: '' };
    const on = !!r.column;
    const set = patch => save({ ...r, ...patch }).catch(showErr);
    fill(box,
      !bare && h('div', { class: 'section-head', style: { marginBottom: '4px' } }, h('h2', null, 'Ревью')),
      h('p', { class: 'hint' }, 'Задача пришла в колонку ревью — исполнителем становится ревьюер её позиции. Ревьюер перенёс её дальше или вернул — задача снова на том, кто её делал. Ревьюером может быть любой человек.'),
      h('div', { class: 'rv-row' },
        h('span', { class: 'rv-label' }, 'Колонка ревью'),
        h('select', { class: 'inp', value: r.column, onchange: e => set({ column: e.target.value }) },
          h('option', { value: '' }, 'Выключено'),
          u.settings.columns.map(c => h('option', { value: c.id }, c.name)))),
      on && [
        h('div', { class: 'sub-title' }, 'Ревьюеры по позиции задачи'),
        h('div', { class: 'rv-list' },
          activeDepts().map(d => h('div', { class: 'rv-row' },
            h('span', { class: 'rv-label' }, h('span', { class: 'dot', style: { background: d.color } }), d.name),
            personSelect(r.byPosition[d.id], v => {
              const byPosition = { ...r.byPosition };
              if (v) byPosition[d.id] = v; else delete byPosition[d.id];
              set({ byPosition });
            }, '— по умолчанию —'))),
          h('div', { class: 'rv-row rv-default' },
            h('span', { class: 'rv-label' }, 'По умолчанию'),
            personSelect(r.default, v => set({ default: v }), '— без ревьюера —'))),
      ]);
  };
  draw();
  return box;
}

function teamSection() {
  const b = S.board;
  const box = h('section', { class: 'card-box' });
  const remove = async m => {
    const p = personById(m.personId);
    if (!(await confirmDlg(`Убрать ${p ? p.name : 'участника'} из команды? Задачи, где он исполнитель, останутся за ним.`, { ok: 'Убрать', danger: true }))) return;
    const list = await send('removeMember', { unitId: b.unit.id, personId: m.personId });
    applyMembers(b.unit.id, list);
    draw();
  };
  const draw = () => {
    fill(box,
      h('div', { class: 'section-head', style: { marginBottom: '4px' } },
        h('h2', null, 'Команда'),
        h('div', { class: 'row' },
          h('button', { class: 'btn ghost sm', onclick: openDepartments }, icon('layers', 14), 'Позиции'),
          h('button', { class: 'btn primary sm', onclick: async () => { if (await addMemberDialog(b.unit.id)) draw(); } }, icon('plus', 14), 'Участник'))),
      h('p', { class: 'hint' }, 'Участники юнита. Каждый видит здесь только задачи своей позиции и работает только в своих задачах. CEO и PM видят все юниты без добавления в состав.'),
      b.members.length
        ? b.members.map(m => {
          const p = personById(m.personId);
          if (!p) return null;
          // Позиции — из профиля человека (меняются в «Люди и доступы»)
          return h('div', { class: 'member-row' },
            avatar(p),
            h('span', { class: 'person-text', 'data-pcard': p.id }, h('span', { class: 'person-name' }, p.name), p.role && h('span', { class: 'person-sub' }, p.role)),
            positionChips(p.positionIds || [p.positionId]),
            h('button', { class: 'icon-btn sm', title: 'Убрать из команды', onclick: () => remove(m).catch(showErr) }, icon('x', 15)));
        })
        : h('p', { class: 'muted' }, 'В команде пока никого. Добавьте участников, чтобы назначать их на задачи.'));
  };
  draw();
  return box;
}
