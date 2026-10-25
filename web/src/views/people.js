import { S, colorFor, unitById, activeDepts, deptById, PALETTE, ACCESS_LABELS, isStaff, isSuper } from '../state.js';
import { h, icon, avatar, field, modal, confirmDlg, showErr, toast, fill, colorPicker, menu } from '../ui.js';
import { send } from '../api.js';
import { rerender } from '../router.js';
import { mode, supabase, localPeople, localLogin } from '../data.js';
import { LS } from '../state.js';
import { personCaption } from './my.js';

const sortPeople = () => S.people.sort((a, b) => a.name.localeCompare(b.name));

/** Временный пароль: 10 символов без похожих букв (l/1, O/0). */
function tempPassword() {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = crypto.getRandomValues(new Uint32Array(10));
  return [...buf].map(n => abc[n % abc.length]).join('');
}

const positionSelect = (value, onChange, { disabled = false } = {}) => h('select', {
  class: 'inp', value: value || '', disabled, onchange: e => onChange(e.target.value),
}, h('option', { value: '' }, '— без позиции —'),
activeDepts().concat(value && deptById(value) && deptById(value).archived ? [deptById(value)] : []).map(d => h('option', { value: d.id }, d.name)));

const accessSelect = (value, onChange) => h('select', { class: 'inp', value, onchange: e => onChange(e.target.value) },
  Object.entries(ACCESS_LABELS).map(([k, v]) => h('option', { value: k }, v)));

/** Окно «Отправьте коллеге»: ссылка, email и временный пароль. */
function showCredentials(person, password) {
  const site = location.origin + location.pathname;
  const text = `Вход в Tasks: ${site}\nEmail: ${person.email}\nВременный пароль: ${password}\nПосле входа смените пароль: аватар внизу слева → «Мой профиль».`;
  modal({
    title: 'Доступ создан',
    body: [
      h('p', { style: { marginTop: 0 } }, 'Отправьте это ', h('b', null, person.name), ' — пароль больше нигде не показывается:'),
      h('pre', { class: 'creds' }, text),
    ],
    actions: [
      { label: 'Скопировать', primary: true, action: async () => { await navigator.clipboard.writeText(text).catch(() => {}); toast('Скопировано'); } },
      { label: 'Готово' },
    ],
  });
}

/* ================= Люди и доступы (модераторы и супер-админы) ================= */

export function openPeople() {
  modal({ title: 'Люди и доступы', wide: true, body: peopleManager(), actions: [{ label: 'Готово', primary: true, action: c => c() }], onClose: rerender });
}

/**
 * Управление людьми: позиции, роли (только супер-админ), вход и доступ. filter — функция-фильтр списка.
 * Возвращает элемент (используется в окне и в панели админа).
 */
export function peopleManager({ search = false } = {}) {
  const box = h('div', { class: 'rows people-list' });
  let q = '';
  let accessFilter = '';
  const save = (p, patch) => send('updatePerson', { id: p.id, ...patch })
    .then(saved => { Object.assign(p, saved); draw(); })
    .catch(e => { showErr(e); draw(); });

  const accountMenu = (anchor, p) => menu(anchor, [
    mode === 'supabase' && !p.linked && { label: 'Создать вход (email + пароль)', icon: 'user', action: () => accountDialog(p) },
    mode === 'supabase' && p.linked && { label: 'Новый временный пароль', icon: 'edit', action: () => resetDialog(p) },
    { label: p.active ? 'Отключить доступ' : 'Вернуть доступ', icon: 'archive', danger: p.active, action: () => toggleActive(p) },
  ]);

  const toggleActive = async p => {
    if (p.active && !(await confirmDlg(`Отключить ${p.name}? Человек не сможет войти; его задачи останутся.`, { ok: 'Отключить', danger: true }))) return;
    save(p, { active: !p.active });
  };

  const row = p => {
    const editableTarget = isSuper() || p.access !== 'superadmin';
    return h('div', { class: 'access-row' + (p.active ? '' : ' inactive') },
      avatar(p),
      h('span', { class: 'person-text' },
        h('span', { class: 'person-name' }, p.name, S.meId === p.id && h('span', { class: 'badge' }, 'вы')),
        h('span', { class: 'person-sub' }, [p.email || 'без email', p.linked ? 'вход есть' : mode === 'supabase' ? 'нет входа' : ''].filter(Boolean).join(' · '))),
      positionSelect(p.positionId, v => save(p, { positionId: v }), { disabled: !editableTarget }),
      isSuper() && p.id !== S.meId ? accessSelect(p.access, v => save(p, { access: v })) : h('span', { class: 'badge access-badge' }, ACCESS_LABELS[p.access]),
      editableTarget && p.id !== S.meId
        ? h('button', { class: 'icon-btn sm', title: 'Доступ', onclick: e => { e.stopPropagation(); accountMenu(e.currentTarget, p); } }, icon('more'))
        : h('span', { style: { width: '24px' } }));
  };

  const head = h('div', { class: 'access-row access-head' }, h('span'), h('span', null, 'Человек'), h('span', null, 'Позиция'), h('span', null, 'Роль'), h('span'));
  const visible = () => S.people.filter(p => (!q || (p.name + ' ' + p.email).toLowerCase().includes(q)) && (!accessFilter || (accessFilter === 'nopos' ? p.access === 'member' && !p.positionId : accessFilter === 'nologin' ? !p.linked : accessFilter === 'off' ? !p.active : p.access === accessFilter)));
  const draw = () => {
    const list = visible();
    fill(box, list.length ? [head, ...list.map(row)] : h('p', { class: 'muted', style: { padding: '12px 14px', margin: 0 } }, S.people.length ? 'Никого не найдено' : 'Пока никого нет'));
  };

  // Добавить человека
  const name = h('input', { class: 'inp', placeholder: 'Имя и фамилия' });
  const email = h('input', { class: 'inp', type: 'email', placeholder: 'email' });
  let posValue = '';
  let accValue = 'member';
  const pos = positionSelect('', v => { posValue = v; });
  const acc = isSuper() ? accessSelect('member', v => { accValue = v; }) : null;
  const add = async () => {
    if (!name.value.trim()) return name.focus();
    const payload = { name: name.value, positionId: posValue, access: accValue };
    let p;
    if (mode === 'supabase' && email.value.trim()) {
      const password = tempPassword();
      p = await send('createAccount', { ...payload, email: email.value, password });
      showCredentials(p, password);
    } else {
      p = await send('createPerson', { ...payload, email: email.value });
    }
    const i = S.people.findIndex(x => x.id === p.id);
    if (i >= 0) S.people[i] = p; else S.people.push(p);
    sortPeople();
    name.value = '';
    email.value = '';
    draw();
  };
  draw();
  const toolbar = search && h('div', { class: 'row', style: { marginBottom: '10px' } },
    h('input', { class: 'inp', type: 'search', placeholder: 'Поиск по имени или email', style: { maxWidth: '280px' }, oninput: ev => { q = ev.target.value.trim().toLowerCase(); draw(); } }),
    h('select', { class: 'inp', style: { width: 'auto' }, onchange: ev => { accessFilter = ev.target.value; draw(); } },
      h('option', { value: '' }, 'Все'),
      Object.entries(ACCESS_LABELS).map(([k, v]) => h('option', { value: k }, v)),
      h('option', { value: 'nopos' }, 'Участники без позиции'),
      mode === 'supabase' && h('option', { value: 'nologin' }, 'Без входа'),
      h('option', { value: 'off' }, 'Отключённые')));
  const el = h('div', null,
    h('p', { class: 'hint', style: { marginTop: 0 } },
      isSuper() ? 'Позиция определяет, какие задачи участник видит в своих юнитах. Роли меняет только супер-админ.'
        : 'Позиция определяет, какие задачи участник видит в своих юнитах. Роли назначает супер-админ.'),
    toolbar,
    box,
    h('div', { class: 'sub-title' }, 'Добавить человека'),
    h('div', { class: 'add-person' }, name, email, pos, acc,
      h('button', { class: 'btn primary', onclick: () => add().catch(showErr) }, icon('plus', 14), 'Добавить')),
    h('p', { class: 'hint' }, mode === 'supabase'
      ? 'С email — сразу создастся вход с временным паролем. Без email — только профиль (вход можно создать позже в меню ⋯).'
      : 'Локальный режим: входа нет, проверяйте роли через «Войти как…» в меню профиля.'));
  el.refresh = draw;
  return el;

  function accountDialog(p) {
    const em = h('input', { class: 'inp', type: 'email', value: p.email, placeholder: 'email' });
    modal({
      title: 'Вход для ' + p.name,
      body: [field('Email', em, 'Создадим аккаунт с временным паролем и покажем его вам.')],
      actions: [
        { label: 'Отмена' },
        {
          label: 'Создать вход', primary: true, action: async close => {
            const password = tempPassword();
            const saved = await send('createAccount', { personId: p.id, email: em.value, password });
            Object.assign(p, saved);
            close();
            draw();
            showCredentials(p, password);
          },
        },
      ],
    });
  }

  async function resetDialog(p) {
    if (!(await confirmDlg(`Выдать ${p.name} новый временный пароль? Старый перестанет работать.`, { ok: 'Выдать' }))) return;
    const password = tempPassword();
    await send('resetPassword', { personId: p.id, password }).then(() => showCredentials(p, password)).catch(showErr);
  }
}

/* ================= Мой профиль ================= */

export function openMyProfile() {
  const p = S.people.find(x => x.id === S.meId);
  if (!p) return;
  const name = h('input', { class: 'inp', value: p.name, maxlength: 80 });
  const role = h('input', { class: 'inp', value: p.role, maxlength: 80, placeholder: 'Например, Senior iOS' });
  const preview = h('span');
  const color = colorPicker(p.color, { auto: true, autoColor: colorFor(p.id), onChange: () => fill(preview, avatar({ ...p, color: color.value() }, 'lg')) });
  fill(preview, avatar(p, 'lg'));
  const pos = deptById(p.positionId);
  modal({
    title: 'Мой профиль',
    body: [
      h('div', { class: 'row', style: { gap: '14px', marginBottom: '14px', flexWrap: 'nowrap' } }, preview,
        h('div', null, h('div', { style: { fontWeight: 600 } }, p.name), h('div', { class: 'hint' }, [ACCESS_LABELS[p.access], pos && pos.name, p.email].filter(Boolean).join(' · ')))),
      h('div', { class: 'grid2' }, field('Имя', name), field('Должность', role, 'Свободный текст; позицию назначает администратор')),
      field('Цвет аватара', color.el),
      mode === 'supabase' && passwordBlock(),
    ],
    actions: [
      { label: 'Отмена' },
      {
        label: 'Сохранить', primary: true, action: async close => {
          if (!name.value.trim()) return name.focus();
          Object.assign(p, await send('updatePerson', { id: p.id, name: name.value, role: role.value, color: color.value() }));
          close();
          rerender();
        },
      },
    ],
  });
}

/** Смена пароля для входа (Supabase Auth). */
function passwordBlock() {
  const pass = h('input', { class: 'inp', type: 'password', placeholder: 'Новый пароль (от 8 символов)', autocomplete: 'new-password' });
  const again = h('input', { class: 'inp', type: 'password', placeholder: 'Ещё раз', autocomplete: 'new-password' });
  const save = async () => {
    if (pass.value.length < 8) { toast('Пароль должен быть не короче 8 символов', { type: 'error' }); return pass.focus(); }
    if (pass.value !== again.value) { toast('Пароли не совпадают', { type: 'error' }); return again.focus(); }
    const { error } = await supabase.auth.updateUser({ password: pass.value });
    if (error) return showErr(new Error(/different from the old/i.test(error.message) ? 'Новый пароль совпадает со старым' : error.message));
    pass.value = '';
    again.value = '';
    toast('Пароль изменён');
  };
  return h('div', null,
    h('div', { class: 'sub-title' }, 'Пароль для входа'),
    h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, pass, again, h('button', { class: 'btn', onclick: () => save().catch(showErr) }, 'Сменить')));
}

/* ================= Локальный режим: «Войти как» ================= */

export async function openActAs() {
  const rank = { superadmin: 0, moderator: 1, member: 2 };
  const people = (await localPeople()).sort((a, b) => rank[a.access] - rank[b.access] || a.name.localeCompare(b.name));
  modal({
    title: 'Войти как…',
    body: [
      h('p', { class: 'hint', style: { marginTop: 0 } }, 'Локальный режим: правила доступа применяются как к выбранному человеку. Так можно проверить, что видит участник или модератор.'),
      h('div', { class: 'rows people-list' }, people.map(p => h('button', {
        class: 'person-item pickable person-main', style: { width: '100%' },
        onclick: async () => {
          try {
            await localLogin(p.id);
            LS.set('localActor', p.id);
            location.hash = '#/';
            location.reload();
          } catch (e) { showErr(e); }
        },
      },
      avatar({ id: p.id, name: p.name }),
      h('span', { class: 'person-text' },
        h('span', { class: 'person-name' }, p.name, S.meId === p.id && h('span', { class: 'badge' }, 'сейчас')),
        h('span', { class: 'person-sub' }, (deptById(p.position_id) || {}).name || 'без позиции')),
      !p.active && h('span', { class: 'badge' }, 'отключён'),
      h('span', { class: 'role-badge role-' + p.access }, ACCESS_LABELS[p.access])))),
    ],
  });
}

/* ================= Команда юнита ================= */

/**
 * Добавить человека в команду юнита. Позиция берётся из профиля; если её нет — выбирается здесь.
 * Возвращает id добавленного человека или null.
 */
export function addMemberDialog(unitId) {
  return new Promise(resolve => {
    const unit = unitById(unitId) || (S.board && S.board.unit);
    const inTeam = new Set(S.board && S.board.unit.id === unitId ? S.board.members.map(m => m.personId) : (unit && unit.members) || []);
    const candidates = S.people.filter(p => p.active && !inTeam.has(p.id) && p.access === 'member');
    if (!candidates.length) {
      toast(isStaff() ? 'Все участники уже в команде. Новых людей добавляют в «Люди и доступы».' : 'Нет доступных людей');
      return resolve(null);
    }
    const person = h('select', { class: 'inp' }, candidates.map(p => h('option', { value: p.id }, p.name + (deptById(p.positionId) ? ' · ' + deptById(p.positionId).name : ''))));
    let posValue = '';
    const posWrap = field('Позиция', positionSelect('', v => { posValue = v; }), 'У человека нет позиции — без неё он не увидит задачи юнита.');
    const sync = () => { posWrap.hidden = !!(S.people.find(p => p.id === person.value) || {}).positionId; };
    person.addEventListener('change', sync);
    let result = null;
    modal({
      title: 'Добавить в команду' + (unit ? ' «' + unit.name + '»' : ''),
      body: [field('Участник', person), posWrap],
      onClose: () => resolve(result),
      actions: [
        { label: 'Отмена' },
        {
          label: 'Добавить', primary: true, action: async close => {
            const p = S.people.find(x => x.id === person.value);
            if (!p.positionId && posValue) Object.assign(p, await send('updatePerson', { id: p.id, positionId: posValue }));
            const members = await send('setMember', { unitId, personId: p.id, departmentId: p.positionId });
            applyMembers(unitId, members);
            result = p.id;
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

/* ================= Позиции (общий справочник) ================= */

export function openDepartments() {
  modal({ title: 'Позиции', body: positionsManager(), actions: [{ label: 'Готово', primary: true, action: c => c() }], onClose: rerender });
}

/** Справочник позиций: название, цвет, порядок, скрыть/удалить. Возвращает элемент. */
export function positionsManager() {
  const box = h('div', { class: 'rows people-list' });
  const draw = () => fill(box, S.departments.length ? [...S.departments].sort((a, b) => a.order - b.order).map(row) : h('p', { class: 'muted', style: { padding: '12px 14px', margin: 0 } }, 'Позиций нет'));
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
    if (!(await confirmDlg(`Удалить позицию «${d.name}»? Люди и задачи с этой позицией останутся без неё — участники перестанут видеть такие задачи. Если позиция может понадобиться — лучше скрыть.`, { ok: 'Удалить', danger: true }))) return;
    await send('deleteDepartment', { id: d.id });
    S.departments = S.departments.filter(x => x !== d);
    S.people.forEach(p => { if (p.positionId === d.id) p.positionId = ''; });
    draw();
  };
  const row = (d, i, arr) => h('div', { class: 'person-item' + (d.archived ? ' inactive' : '') },
    h('input', { type: 'color', class: 'dept-color', value: d.color, title: 'Цвет', onchange: e => save(d, { color: e.target.value }) }),
    h('input', { class: 'inp', value: d.name, maxlength: 40, style: { flex: 1 }, onchange: e => { if (e.target.value.trim()) save(d, { name: e.target.value }); } }),
    h('span', { class: 'hint', style: { whiteSpace: 'nowrap' } }, S.people.filter(p => p.positionId === d.id).length + ' чел.'),
    h('button', { class: 'icon-btn sm', title: 'Выше', disabled: i === 0, onclick: () => move(d, -1) }, '↑'),
    h('button', { class: 'icon-btn sm', title: 'Ниже', disabled: i === arr.length - 1, onclick: () => move(d, 1) }, '↓'),
    h('button', { class: 'btn ghost sm', onclick: () => save(d, { archived: !d.archived }) }, d.archived ? 'Показать' : 'Скрыть'),
    h('button', { class: 'icon-btn sm', title: 'Удалить', onclick: () => remove(d).catch(showErr) }, icon('trash', 14)));
  const name = h('input', { class: 'inp', placeholder: 'Например, Продуктовый дизайнер', maxlength: 40 });
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
  return h('div', null,
    h('p', { class: 'hint', style: { marginTop: 0 } }, 'Позиция есть у каждого участника и у каждой задачи. Участник видит в своих юнитах только задачи своей позиции.'),
    box,
    h('div', { class: 'sub-title' }, 'Добавить позицию'),
    h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, name, h('button', { class: 'btn primary', onclick: () => add().catch(showErr) }, icon('plus', 14), 'Добавить')));
}

export function openShortcuts() {
  const row = (keys, text) => h('div', { class: 'row', style: { justifyContent: 'space-between', padding: '6px 0' } },
    h('span', null, text), h('span', { class: 'row', style: { gap: '4px' } }, keys.map(k => h('kbd', null, k))));
  modal({
    title: 'Горячие клавиши',
    body: [
      row(['⌘/Ctrl', 'K'], 'Поиск и команды'),
      isStaff() && row(['C'], 'Новая задача'),
      row(['/'], 'Поиск на доске'),
      row(['Esc'], 'Закрыть карточку или окно'),
      row(['⌘/Ctrl', 'Enter'], 'Сохранить описание, отправить комментарий'),
      row(['?'], 'Эта подсказка'),
    ],
  });
}
