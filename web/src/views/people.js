import { S, setMe, colorFor, unitById, activeDepts, PALETTE } from '../state.js';
import { h, icon, avatar, field, modal, promptDlg, confirmDlg, showErr, toast, fill, colorPicker } from '../ui.js';
import { send } from '../api.js';
import { rerender } from '../router.js';

const sortPeople = () => S.people.sort((a, b) => a.name.localeCompare(b.name));

export async function quickCreatePerson() {
  const name = await promptDlg('Новый человек', 'Имя');
  if (!name) return null;
  const p = await send('createPerson', { name });
  S.people.push(p);
  sortPeople();
  return p;
}

/**
 * Список людей с редактированием профиля (имя, должность, email, цвет аватара).
 * onPick(p) — клик по строке (выбор «это я»); без него строки не кликаются.
 */
function peopleList({ people, onPick, showActive = false }) {
  const box = h('div', { class: 'rows people-list' });
  let editing = null;

  const save = (p, patch) => send('updatePerson', { id: p.id, ...patch }).then(saved => { Object.assign(p, saved); sortPeople(); });

  const editor = p => {
    const name = h('input', { class: 'inp', value: p.name, maxlength: 80, placeholder: 'Имя' });
    const role = h('input', { class: 'inp', value: p.role, maxlength: 80, placeholder: 'Например, iOS-разработчик' });
    const email = h('input', { class: 'inp', value: p.email, maxlength: 120, placeholder: 'name@company.com' });
    const preview = h('span');
    const colorNow = () => ({ ...p, name: name.value || p.name, color: color.value() });
    const color = colorPicker(p.color, { auto: true, autoColor: colorFor(p.id), onChange: () => fill(preview, avatar(colorNow(), 'lg')) });
    name.addEventListener('input', () => fill(preview, avatar(colorNow(), 'lg')));
    fill(preview, avatar(p, 'lg'));
    const submit = async () => {
      if (!name.value.trim()) return name.focus();
      try {
        await save(p, { name: name.value, role: role.value, email: email.value, color: color.value() });
        editing = null;
        draw();
      } catch (e) { showErr(e); }
    };
    const el = h('div', { class: 'person-edit' },
      h('div', { class: 'row', style: { gap: '12px', marginBottom: '12px', flexWrap: 'nowrap' } }, preview,
        h('div', { style: { flex: 1 } }, field('Имя', name))),
      h('div', { class: 'grid2' }, field('Должность', role), field('Email', email)),
      field('Цвет аватара', color.el),
      showActive && h('label', { class: 'chk', style: { marginBottom: '12px' } },
        h('input', { type: 'checkbox', checked: p.active, onchange: e => save(p, { active: e.target.checked }).catch(showErr) }),
        'Активен — можно назначать на задачи'),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary sm', onclick: submit }, 'Сохранить'),
        h('button', { class: 'btn ghost sm', onclick: () => { editing = null; draw(); } }, 'Отмена')));
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.matches('input.inp')) { e.preventDefault(); e.stopPropagation(); submit(); }
      if (e.key === 'Escape') { e.stopPropagation(); editing = null; draw(); }
    });
    setTimeout(() => name.focus(), 0);
    return el;
  };

  const row = p => {
    if (editing === p.id) return editor(p);
    return h('div', { class: 'person-item' + (onPick ? ' pickable' : '') + (p.active ? '' : ' inactive') },
      h('button', { class: 'person-main', disabled: !onPick, onclick: () => onPick && onPick(p) },
        avatar(p),
        h('span', { class: 'person-text' },
          h('span', { class: 'person-name' }, p.name, S.meId === p.id && h('span', { class: 'badge' }, 'вы')),
          (p.role || p.email) && h('span', { class: 'person-sub' }, [p.role, p.email].filter(Boolean).join(' · '))),
        !p.active && h('span', { class: 'badge' }, 'неактивен')),
      !onPick && S.meId !== p.id && h('button', { class: 'link-btn', onclick: () => { setMe(p.id); draw(); } }, 'Это я'),
      h('button', { class: 'icon-btn sm', title: 'Редактировать профиль', onclick: () => { editing = p.id; draw(); } }, icon('edit', 14)));
  };

  const draw = () => {
    const list = people();
    fill(box, list.length ? list.map(row) : h('p', { class: 'muted', style: { padding: '12px 14px', margin: 0 } }, 'Пока никого нет'));
  };
  draw();
  return { el: box, draw, edit: id => { editing = id; draw(); } };
}

/** Справочник людей: общий для всех юнитов. */
export function openPeople() {
  const list = peopleList({ people: () => S.people, showActive: true });
  const name = h('input', { class: 'inp', placeholder: 'Имя' });
  const role = h('input', { class: 'inp', placeholder: 'Должность (необязательно)' });
  const add = async () => {
    if (!name.value.trim()) return name.focus();
    const p = await send('createPerson', { name: name.value, role: role.value });
    S.people.push(p);
    sortPeople();
    name.value = '';
    role.value = '';
    list.draw();
    name.focus();
  };
  const onEnter = e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); add().catch(showErr); } };
  name.addEventListener('keydown', onEnter);
  role.addEventListener('keydown', onEnter);
  modal({
    title: 'Люди',
    wide: true,
    body: [
      h('p', { class: 'hint', style: { marginTop: 0 } }, 'Исполнители для всех юнитов. Нажмите ✎, чтобы изменить имя, должность, email или цвет.'),
      list.el,
      h('div', { class: 'sub-title' }, 'Добавить человека'),
      h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, name, role, h('button', { class: 'btn primary', onclick: () => add().catch(showErr) }, icon('plus', 14), 'Добавить')),
    ],
    actions: [{ label: 'Готово', primary: true, action: c => c() }],
    onClose: rerender,
  });
}

/**
 * «Кто я».
 * С входом через Supabase (email задан): занять свободный профиль (без email) или создать свой.
 * В локальном режиме: выбрать себя из списка — выбор хранится в браузере.
 */
export function openWhoAmI({ welcome = false, email = '' } = {}) {
  const name = h('input', { class: 'inp', placeholder: 'Ваше имя' });
  const choose = async p => {
    try {
      if (email) Object.assign(p, await send('updatePerson', { id: p.id, email }));
      setMe(p.id);
      close();
    } catch (e) { showErr(e); }
  };
  const available = () => S.people.filter(p => p.active && (!email || !p.email));
  const list = peopleList({ people: available, onPick: choose });
  const create = async () => {
    if (!name.value.trim()) return name.focus();
    const p = await send('createPerson', { name: name.value, email });
    S.people.push(p);
    sortPeople();
    setMe(p.id);
    name.value = '';
    list.draw();
    list.edit(p.id); // сразу предложим заполнить профиль
    toast('Приятно познакомиться, ' + p.name + '! Заполните профиль или просто закройте окно.');
  };
  const has = available().length > 0;
  const close = modal({
    title: welcome ? 'Добро пожаловать в Tasks' : 'Кто вы?',
    body: [
      h('p', { class: 'hint', style: { marginTop: 0 } }, email
        ? ['Вы вошли как ', h('b', null, email), '. ', has ? 'Если вас уже добавили в команду — выберите себя, иначе создайте профиль.' : 'Создайте свой профиль.']
        : welcome ? 'Представьтесь — так будет видно, кто создал задачу или оставил комментарий, и заработают «Мои задачи».'
          : 'Выберите себя. Нажмите ✎, чтобы изменить имя, должность, email или цвет аватара.'),
      has && list.el,
      field(has ? 'Или создайте профиль' : 'Как вас зовут?', h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, name,
        h('button', { class: 'btn primary', onclick: () => create().catch(showErr) }, 'Продолжить'))),
    ],
    actions: [{ label: welcome ? 'Позже' : 'Готово' }],
    onClose: () => rerender(),
  });
  name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); create().catch(showErr); } });
  return close;
}

/** Мой профиль: только своя карточка с редактором. */
export function openMyProfile() {
  const p = S.people.find(x => x.id === S.meId);
  if (!p) return openWhoAmI({ email: S.session && S.session.user.email });
  const list = peopleList({ people: () => S.people.filter(x => x.id === S.meId) });
  modal({ title: 'Мой профиль', body: list.el, actions: [{ label: 'Готово', primary: true, action: c => c() }], onClose: rerender });
  list.edit(p.id);
}

/**
 * Добавить человека в команду юнита (существующего или нового) и выбрать его отдел.
 * Возвращает id добавленного человека или null.
 */
export function addMemberDialog(unitId) {
  return new Promise(resolve => {
    const unit = unitById(unitId) || (S.board && S.board.unit);
    const inTeam = new Set(S.board && S.board.unit.id === unitId ? S.board.members.map(m => m.personId) : (unit && unit.members) || []);
    const candidates = S.people.filter(p => p.active && !inTeam.has(p.id));
    const person = h('select', { class: 'inp' },
      candidates.map(p => h('option', { value: p.id }, p.name + (p.role ? ' · ' + p.role : ''))),
      h('option', { value: '__new' }, '＋ Новый человек…'));
    const newName = h('input', { class: 'inp', placeholder: 'Имя нового человека' });
    const newWrap = field('Имя', newName);
    const dept = h('select', { class: 'inp' }, h('option', { value: '' }, '— без отдела —'), activeDepts().map(d => h('option', { value: d.id }, d.name)));
    const sync = () => { newWrap.hidden = person.value !== '__new'; if (!newWrap.hidden) newName.focus(); };
    person.addEventListener('change', sync);
    let result = null;
    modal({
      title: 'Добавить в команду' + (unit ? ' «' + unit.name + '»' : ''),
      body: [field('Человек', person), newWrap, field('Отдел в этой команде', dept, 'Отдел подставится в задачи, когда человека назначат исполнителем.')],
      onClose: () => resolve(result),
      actions: [
        { label: 'Отмена' },
        {
          label: 'Добавить', primary: true, action: async close => {
            let id = person.value;
            if (id === '__new') {
              if (!newName.value.trim()) return newName.focus();
              const p = await send('createPerson', { name: newName.value });
              S.people.push(p);
              sortPeople();
              id = p.id;
            }
            const members = await send('setMember', { unitId, personId: id, departmentId: dept.value });
            applyMembers(unitId, members);
            result = id;
            close();
          },
        },
      ],
    });
    sync();
  });
}

/** Обновить состав юнита в памяти (доска + список юнитов). */
export function applyMembers(unitId, list) {
  if (S.board && S.board.unit.id === unitId) S.board.members = list;
  const u = unitById(unitId);
  if (u) u.members = list.map(m => m.personId);
}

/** Общий справочник отделов. */
export function openDepartments() {
  const box = h('div', { class: 'rows people-list' });
  const draw = () => fill(box, S.departments.length ? [...S.departments].sort((a, b) => a.order - b.order).map(row) : h('p', { class: 'muted', style: { padding: '12px 14px', margin: 0 } }, 'Отделов нет'));
  const save = (d, patch) => send('updateDepartment', { id: d.id, ...patch }).then(saved => { Object.assign(d, saved); draw(); }).catch(showErr);
  const move = (d, dir) => {
    const list = [...S.departments].sort((a, b) => a.order - b.order);
    const i = list.indexOf(d);
    list.splice(i + dir, 0, list.splice(i, 1)[0]);
    list.forEach((x, k) => { x.order = k + 1; });
    draw();
    send('reorderDepartments', { ids: list.map(x => x.id) }).catch(showErr);
  };
  const remove = async d => {
    if (!(await confirmDlg(`Удалить отдел «${d.name}»? Задачи и участники этого отдела останутся, но без отдела. Если отдел может ещё понадобиться — лучше скрыть его.`, { ok: 'Удалить', danger: true }))) return;
    await send('deleteDepartment', { id: d.id });
    S.departments = S.departments.filter(x => x !== d);
    draw();
  };
  const row = (d, i, arr) => h('div', { class: 'person-item' + (d.archived ? ' inactive' : '') },
    h('input', { type: 'color', class: 'dept-color', value: d.color, title: 'Цвет', onchange: e => save(d, { color: e.target.value }) }),
    h('input', { class: 'inp', value: d.name, maxlength: 40, style: { flex: 1 }, onchange: e => { if (e.target.value.trim()) save(d, { name: e.target.value }); } }),
    h('button', { class: 'icon-btn sm', title: 'Выше', disabled: i === 0, onclick: () => move(d, -1) }, '↑'),
    h('button', { class: 'icon-btn sm', title: 'Ниже', disabled: i === arr.length - 1, onclick: () => move(d, 1) }, '↓'),
    h('button', { class: 'btn ghost sm', onclick: () => save(d, { archived: !d.archived }) }, d.archived ? 'Показать' : 'Скрыть'),
    h('button', { class: 'icon-btn sm', title: 'Удалить', onclick: () => remove(d).catch(showErr) }, icon('trash', 14)));
  const name = h('input', { class: 'inp', placeholder: 'Например, Marketing', maxlength: 40 });
  const add = async () => {
    if (!name.value.trim()) return name.focus();
    const d = await send('createDepartment', { name: name.value, color: PALETTE[S.departments.length % PALETTE.length] });
    S.departments.push(d);
    name.value = '';
    draw();
    name.focus();
  };
  name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); add().catch(showErr); } });
  draw();
  modal({
    title: 'Отделы',
    body: [
      h('p', { class: 'hint', style: { marginTop: 0 } }, 'Общий список для всех юнитов: у задачи и у участника команды указывается отдел. Скрытые отделы не предлагаются в новых задачах.'),
      box,
      h('div', { class: 'sub-title' }, 'Добавить отдел'),
      h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, name, h('button', { class: 'btn primary', onclick: () => add().catch(showErr) }, icon('plus', 14), 'Добавить')),
    ],
    actions: [{ label: 'Готово', primary: true, action: c => c() }],
    onClose: rerender,
  });
}

export function openShortcuts() {
  const row = (keys, text) => h('div', { class: 'row', style: { justifyContent: 'space-between', padding: '6px 0' } },
    h('span', null, text), h('span', { class: 'row', style: { gap: '4px' } }, keys.map(k => h('kbd', null, k))));
  modal({
    title: 'Горячие клавиши',
    body: [
      row(['⌘/Ctrl', 'K'], 'Поиск и команды'),
      row(['C'], 'Новая задача'),
      row(['/'], 'Поиск на доске'),
      row(['Esc'], 'Закрыть карточку или окно'),
      row(['⌘/Ctrl', 'Enter'], 'Сохранить описание, отправить комментарий'),
      row(['?'], 'Эта подсказка'),
    ],
  });
}
