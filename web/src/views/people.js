import Sortable from 'sortablejs';
import { S, colorFor, unitById, activeDepts, deptById, activeTeams, teamById, PALETTE, ACCESS_LABELS, isStaff, isSuper, byOrder } from '../state.js';
import { h, icon, avatar, field, modal, confirmDlg, showErr, toast, fill, colorPicker, menu } from '../ui.js';
import { send, call } from '../api.js';
import { rerender } from '../router.js';
import { mode, supabase, localPeople, localLogin } from '../data.js';
import { LS } from '../state.js';
import { columnsEditor } from './settings.js';
import { PRESETS, PRESET_GROUPS, groupsFor, photoToAvatar } from '../avatars.js';
import { renderSidebar } from './sidebar.js';

const sortPeople = () => S.people.sort((a, b) => a.name.localeCompare(b.name));

/** Временный пароль: 10 символов без похожих букв (l/1, O/0). */
function tempPassword() {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = crypto.getRandomValues(new Uint32Array(10));
  return [...buf].map(n => abc[n % abc.length]).join('');
}

/** Чипы справочника (позиции, команды): первый — жирнее, если main. */
function dictChips(ids, byId, { main = false, empty = '' } = {}) {
  const list = ids.map(byId).filter(Boolean);
  if (!list.length) return h('span', { class: 'muted pos-empty' }, empty);
  return h('span', { class: 'pos-chips' }, list.map((d, i) => h('span', {
    class: 'chip tag dept-chip' + (main && i === 0 ? ' main' : ''), title: main ? (i === 0 ? 'Основная' : 'Дополнительная') : d.name,
    style: { '--dc': d.color },
  }, d.name)));
}

/** Позиции человека чипами: основная первой (жирнее), затем дополнительные. */
export const positionChips = ids => dictChips(ids, deptById, { main: true });
/** Команды человека чипами. */
export const teamChips = ids => dictChips(ids, teamById, { empty: 'без команды' });

/**
 * Выбор из справочника: кнопка с чипами → меню с галочками (меню не закрывается, пока отмечаешь).
 * main — первая выбранная «основная» (★), последнюю не снять; иначе можно снять все.
 */
function dictPicker({ title, items, byId, get, set, main = false, note = '', empty = '', disabled = false }) {
  const btn = h('button', { class: 'pos-btn', type: 'button', disabled, title: disabled ? '' : title, onclick: e => { e.stopPropagation(); open(); } });
  // Внутри поля — как в обычном списке: точки цветов и названия через запятую (без чипов)
  const paint = () => {
    const list = get().map(byId).filter(Boolean);
    fill(btn,
      list.length
        ? h('span', { class: 'pick-val', title: list.map(d => d.name).join(', ') },
          h('span', { class: 'aud-dots' }, list.slice(0, 3).map(d => h('span', { class: 'dot', style: { background: d.color } }))),
          h('span', { class: 'pick-text' }, list.map(d => d.name).join(', ')))
        : h('span', { class: 'muted pick-val' }, empty || '—'),
      !disabled && icon('chevron', 14));
  };
  const open = () => {
    const box = h('div');
    const apply = ids => { set(ids); paint(); draw(); };
    const draw = () => {
      const ids = get();
      fill(box, items().concat(ids.map(byId).filter(d => d && d.archived)).map(d => {
        const on = ids.includes(d.id), isMain = main && ids[0] === d.id;
        return h('div', { class: 'menu-item aud-item pos-item' + (on ? ' on' : '') },
          h('button', {
            class: 'pos-toggle', role: 'menuitemcheckbox', 'aria-checked': String(on),
            onclick: () => { if (on && main && ids.length === 1) return; apply(on ? ids.filter(x => x !== d.id) : [...ids, d.id]); },
          }, h('span', { class: 'aud-check' }, on && icon('check', 13)), h('span', { class: 'dot', style: { background: d.color } }), d.name),
          main && on && h('button', {
            class: 'pos-star' + (isMain ? ' on' : ''), title: isMain ? 'Основная' : 'Сделать основной',
            onclick: () => { if (!isMain) apply([d.id, ...ids.filter(x => x !== d.id)]); },
          }, isMain ? '★' : '☆'));
      }), note && h('div', { class: 'menu-sep' }), note && h('div', { class: 'hint aud-note' }, note));
    };
    draw();
    menu(btn, [{ title }, box]);
  };
  paint();
  btn.repaint = paint;
  return btn;
}

/** Позиции: несколько, ★ основная — её получают задачи, назначенные на человека. Без позиции не бывает. */
export const positionsPicker = (get, set, opts = {}) => dictPicker({
  title: 'Позиции', items: activeDepts, byId: deptById, get, set, main: true, ...opts,
  note: '★ основная — её получают задачи, назначенные на человека',
});
/** Команды: можно несколько; участник видит задачи своих команд. */
export const teamsPicker = (get, set, opts = {}) => dictPicker({
  title: 'Команды', items: activeTeams, byId: teamById, get, set, empty: 'без команды', ...opts,
  note: 'Сотрудник видит в своих юнитах задачи своих команд',
});

const accessSelect = (value, onChange) => h('select', { class: 'inp', value, onchange: e => onChange(e.target.value) },
  Object.entries(ACCESS_LABELS).map(([k, v]) => h('option', { value: k }, v)));

/** Окно «Отправьте коллеге»: ссылка, email и временный пароль. */
function showCredentials(person, password) {
  const site = location.origin + location.pathname;
  const text = `Вход в Tasks: ${site}\nEmail: ${person.email}\nВременный пароль: ${password}\nПосле входа смените пароль: аккаунт внизу слева → «Настройки» → «Профиль».`;
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

/** Создать человека: с email в Supabase — сразу вход и временный пароль, иначе — только профиль. */
async function createPersonWith({ name, email, posIds, teamIds, access }) {
  const payload = { name, positionId: posIds[0], extraPositionIds: posIds.slice(1), teamIds, access };
  let p;
  if (mode === 'supabase' && email.trim()) {
    const password = tempPassword();
    p = await send('createAccount', { ...payload, email, password });
    showCredentials(p, password);
  } else {
    p = await send('createPerson', { ...payload, email });
  }
  const i = S.people.findIndex(x => x.id === p.id);
  if (i >= 0) S.people[i] = p; else S.people.push(p);
  sortPeople();
  return p;
}

/** «Добавить человека» окном — с обзора и откуда угодно, не уходя со страницы. */
export function addPersonDialog(onDone) {
  const name = h('input', { class: 'inp', placeholder: 'Имя и фамилия', maxlength: 80 });
  const email = h('input', { class: 'inp', type: 'email', placeholder: 'name@company.com' });
  let posIds = ['d_other'];
  let teamIds = ['t_other'].filter(teamById);
  let access = 'member';
  modal({
    title: 'Добавить человека',
    body: [
      h('div', { class: 'grid2' }, field('Имя', name), field('Email', email, mode === 'supabase' ? 'С email сразу создастся вход с временным паролем' : 'Локальный режим: входа нет')),
      h('div', { class: 'grid2' },
        field('Команды', teamsPicker(() => teamIds, ids => { teamIds = ids; })),
        field('Позиции', positionsPicker(() => posIds, ids => { posIds = ids; }))),
      isSuper() && field('Роль', accessSelect('member', v => { access = v; })),
    ],
    actions: [
      { label: 'Отмена' },
      {
        label: 'Добавить', primary: true, action: async close => {
          if (!name.value.trim()) return name.focus();
          const p = await createPersonWith({ name: name.value, email: email.value, posIds, teamIds, access });
          close();
          toast(p.name + ' — добавлен(а)');
          if (onDone) onDone(p);
        },
      },
    ],
  });
  setTimeout(() => name.focus(), 50);
}

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
    .then(saved => { Object.assign(p, saved); draw(); if (p.id === S.meId) renderSidebar(); })
    .catch(e => { showErr(e); draw(); });

  const accountMenu = (anchor, p) => menu(anchor, [
    mode === 'supabase' && !p.linked && { label: 'Создать вход (email + пароль)', icon: 'user', action: () => accountDialog(p) },
    mode === 'supabase' && p.linked && { label: 'Новый временный пароль', icon: 'edit', action: () => resetDialog(p) },
    { label: p.active ? 'Отключить доступ' : 'Вернуть доступ', icon: 'archive', danger: p.active, action: () => toggleActive(p) },
    isSuper() && { sep: true },
    isSuper() && { label: 'Удалить из системы', icon: 'trash', danger: true, action: () => removePerson(p).catch(showErr) },
  ]);

  const removePerson = async p => {
    const n = (await call('queryTasks', { assigneeId: p.id }).catch(() => [])).length;
    const tasksNote = n ? ` Его задачи (${n}) останутся без исполнителя.` : '';
    if (!(await confirmDlg(`Удалить ${p.name} из системы навсегда? Вход и профиль удалятся, человек пропадёт из команд.${tasksNote} История и комментарии сохранятся.`, { ok: 'Удалить', danger: true }))) return;
    await send('deletePerson', { id: p.id });
    S.people = S.people.filter(x => x !== p);
    toast(p.name + ' удалён(а) из системы');
    draw();
  };

  const toggleActive = async p => {
    if (p.active && !(await confirmDlg(`Отключить ${p.name}? Человек не сможет войти; его задачи останутся.`, { ok: 'Отключить', danger: true }))) return;
    save(p, { active: !p.active });
  };

  const row = p => {
    const editableTarget = isSuper() || p.access !== 'superadmin';
    return h('div', { class: 'access-row' + (p.active ? '' : ' inactive') },
      avatar(p),
      h('span', { class: 'person-text', 'data-pcard': p.id },
        h('span', { class: 'person-name' }, p.name, S.meId === p.id && h('span', { class: 'badge' }, 'вы')),
        h('span', { class: 'person-sub' }, [p.email || 'без email', p.linked ? 'вход есть' : mode === 'supabase' ? 'нет входа' : ''].filter(Boolean).join(' · '))),
      teamsPicker(() => p.teamIds || [], ids => { p.teamIds = ids; save(p, { teamIds: ids }); }, { disabled: !editableTarget }),
      positionsPicker(() => p.positionIds, ids => { p.positionIds = ids; save(p, { positionId: ids[0], extraPositionIds: ids.slice(1) }); }, { disabled: !editableTarget }),
      isSuper() && p.id !== S.meId ? accessSelect(p.access, v => save(p, { access: v })) : h('span', { class: 'badge access-badge' }, ACCESS_LABELS[p.access]),
      editableTarget && p.id !== S.meId
        ? h('button', { class: 'icon-btn sm', title: 'Доступ', onclick: e => { e.stopPropagation(); accountMenu(e.currentTarget, p); } }, icon('more'))
        : h('span', { style: { width: '24px' } }));
  };

  const head = h('div', { class: 'access-row access-head' }, h('span'), h('span', null, 'Человек'), h('span', null, 'Команды'), h('span', null, 'Позиции'), h('span', null, 'Роль'), h('span'));
  const visible = () => S.people.filter(p => (!q || (p.name + ' ' + p.email).toLowerCase().includes(q)) && (!accessFilter || (accessFilter === 'nologin' ? !p.linked : accessFilter === 'off' ? !p.active : p.access === accessFilter)));
  const draw = () => {
    const list = visible();
    fill(box, list.length ? [head, ...list.map(row)] : h('p', { class: 'muted', style: { padding: '12px 14px', margin: 0 } }, S.people.length ? 'Никого не найдено' : 'Пока никого нет'));
  };

  // Добавить человека
  const name = h('input', { class: 'inp', placeholder: 'Имя и фамилия' });
  const email = h('input', { class: 'inp', type: 'email', placeholder: 'email' });
  let posIds = ['d_other'];
  let teamIds = ['t_other'].filter(teamById);
  let accValue = 'member';
  const pos = positionsPicker(() => posIds, ids => { posIds = ids; });
  const teamsBtn = teamsPicker(() => teamIds, ids => { teamIds = ids; });
  const acc = isSuper() ? accessSelect('member', v => { accValue = v; }) : null;
  const add = async () => {
    if (!name.value.trim()) return name.focus();
    await createPersonWith({ name: name.value, email: email.value, posIds, teamIds, access: accValue });
    name.value = '';
    email.value = '';
    posIds = ['d_other'];
    teamIds = ['t_other'].filter(teamById);
    pos.repaint();
    teamsBtn.repaint();
    draw();
  };
  draw();
  const toolbar = search && h('div', { class: 'row', style: { marginBottom: '10px' } },
    h('input', { class: 'inp', type: 'search', placeholder: 'Поиск по имени или email', style: { maxWidth: '280px' }, oninput: ev => { q = ev.target.value.trim().toLowerCase(); draw(); } }),
    h('select', { class: 'inp', style: { width: 'auto' }, onchange: ev => { accessFilter = ev.target.value; draw(); } },
      h('option', { value: '' }, 'Все'),
      Object.entries(ACCESS_LABELS).map(([k, v]) => h('option', { value: k }, v)),
      mode === 'supabase' && h('option', { value: 'nologin' }, 'Без входа'),
      h('option', { value: 'off' }, 'Отключённые')));
  const el = h('div', null,
    h('p', { class: 'hint', style: { marginTop: 0 } },
      'Сотрудник видит в своих юнитах задачи своих команд и позиций. ' + (isSuper() ? 'Роли меняете только вы (CEO).' : 'Роли назначает CEO.')),
    toolbar,
    box,
    h('div', { class: 'sub-title' }, 'Добавить человека'),
    h('div', { class: 'add-person' }, name, email, teamsBtn, pos, acc,
      h('button', { class: 'btn primary', onclick: () => add().catch(showErr) }, icon('plus', 14), 'Добавить')),
    h('p', { class: 'hint' }, mode === 'supabase'
      ? 'С email — сразу создастся вход с временным паролем. Без email — только профиль (вход можно создать позже в меню ⋯).'
      : 'Локальный режим: входа нет, проверяйте роли через «Настройки» → «Профиль» → «Войти как…».'));
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
  const tg = h('input', { class: 'inp', value: p.telegram ? '@' + p.telegram : '', maxlength: 60, placeholder: '@username', autocomplete: 'off' });
  const tz = timezoneSelect(p.timezone);
  const preview = h('span');
  let pic = p.avatar || '';
  const drawPreview = () => fill(preview, avatar({ ...p, color: color.value(), avatar: pic }, 'xl'));
  const color = colorPicker(p.color, { auto: true, autoColor: colorFor(p.id), onChange: drawPreview });
  // цвет нужен только инициалам: есть картинка — поле прячем
  const colorField = field('Цвет аватара', color.el);
  const syncColor = () => { colorField.hidden = !!pic; };
  const picker = avatarPicker(p, () => pic, v => { pic = v; drawPreview(); syncColor(); });
  drawPreview();
  syncColor();
  const posNames = (p.positionIds || []).map(id => (deptById(id) || {}).name).filter(Boolean).join(', ');
  modal({
    title: 'Мой профиль',
    body: [
      h('div', { class: 'row', style: { gap: '14px', marginBottom: '14px', flexWrap: 'nowrap' } }, preview,
        h('div', null, h('div', { style: { fontWeight: 600 } }, p.name), h('div', { class: 'hint' }, [ACCESS_LABELS[p.access], posNames, p.email].filter(Boolean).join(' · ')))),
      field('Аватар', picker),
      h('div', { class: 'grid2' }, field('Имя', name), field('Должность', role, 'Свободный текст; позицию назначает администратор')),
      h('div', { class: 'grid2' }, field('Telegram', tg, 'Видно в карточке сотрудника'), field('Часовой пояс', tz, 'Коллеги видят ваше местное время')),
      colorField,
      mode === 'supabase' && passwordBlock(),
    ],
    actions: [
      { label: 'Отмена' },
      {
        label: 'Сохранить', primary: true, action: async close => {
          if (!name.value.trim()) return name.focus();
          Object.assign(p, await send('updatePerson', { id: p.id, name: name.value, role: role.value, color: color.value(), avatar: pic, telegram: tg.value, timezone: tz.value }));
          close();
          renderSidebar();
          rerender();
        },
      },
    ],
  });
}

/** Часовой пояс: популярные сверху, дальше все из браузера; подпись — город и смещение от UTC. */
function timezoneSelect(value) {
  const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const TOP = ['Europe/Moscow', 'Europe/Kaliningrad', 'Europe/Samara', 'Asia/Yekaterinburg', 'Asia/Novosibirsk', 'Asia/Almaty', 'Asia/Tbilisi', 'Asia/Yerevan', 'Europe/Minsk', 'Europe/Kyiv', 'Europe/Istanbul', 'Europe/Berlin', 'Europe/London', 'Asia/Dubai', 'Asia/Bangkok', 'America/New_York'];
  const all = (Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : TOP);
  const label = z => {
    let off = '';
    try { off = new Intl.DateTimeFormat('en-US', { timeZone: z, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find(x => x.type === 'timeZoneName').value.replace('GMT', 'UTC'); } catch { /* старый браузер */ }
    return z.split('/').pop().replace(/_/g, ' ') + (off ? ' · ' + (off === 'UTC' ? 'UTC+0' : off) : '');
  };
  const cur = value || own;
  const top = [...new Set([cur, own, ...TOP])].filter(z => all.includes(z) || z === cur);
  return h('select', { class: 'inp' },
    h('optgroup', { label: 'Часто' }, top.map(z => h('option', { value: z, selected: z === cur }, label(z)))),
    h('optgroup', { label: 'Все' }, all.filter(z => !top.includes(z)).map(z => h('option', { value: z }, label(z)))));
}

/**
 * Выбор аватара: «Загрузить фото» (квадрат 160 px), готовые маскоты — сначала подходящие по роли и позиции,
 * остальные по «Все аватарки»; «Без аватара» — инициалы.
 */
function avatarPicker(p, get, set) {
  const box = h('div', { class: 'av-pick' });
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true,
    onchange: async () => { try { set(await photoToAvatar(file.files[0])); mark(); } catch (e) { showErr(e); } file.value = ''; } });
  const mine = groupsFor(p);
  let all = !mine.length;
  const grid = keys => h('div', { class: 'av-grid' }, keys.flatMap(g => Object.keys(PRESETS).filter(id => id.startsWith(g + '-'))).map(id => {
    const on = get() === 'preset:' + id;
    return h('button', { class: 'av-opt' + (on ? ' on' : ''), type: 'button', 'aria-pressed': String(on), title: (PRESET_GROUPS.find(([k]) => id.startsWith(k + '-')) || [])[1],
      dataset: { id }, onclick: () => { set('preset:' + id); mark(); } }, h('img', { src: PRESETS[id], alt: '' }));
  }));
  // выбор — только подсветка, без перерисовки картинок
  const mark = () => {
    box.querySelectorAll('.av-opt').forEach(b => { const on = get() === 'preset:' + b.dataset.id; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    const off = box.querySelector('.av-clear');
    if (off) off.disabled = !get();
  };
  function draw() {
    const v = get();
    const others = PRESET_GROUPS.map(([k]) => k).filter(k => !mine.includes(k));
    fill(box,
      h('div', { class: 'row', style: { gap: '8px' } },
        // кнопки стоят всегда — ряд не прыгает при выборе
        h('button', { class: 'btn sm', type: 'button', onclick: () => file.click() }, icon('plus', 14), 'Загрузить фото'),
        h('button', { class: 'btn ghost sm av-clear', type: 'button', disabled: !v, onclick: () => { set(''); mark(); } }, 'Без аватара'), file),
      mine.length > 0 && grid(mine),
      mine.length > 0 && h('button', { class: 'link-btn av-more', type: 'button', 'aria-expanded': String(all), onclick: () => { all = !all; draw(); } }, all ? 'Скрыть остальные' : 'Все аватарки'),
      all && grid(others));
  }
  draw();
  return box;
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
  const rank = { superadmin: 0, moderator: 1, rm: 2, lead: 3, member: 4 };
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
      avatar({ id: p.id, name: p.name, color: p.color, avatar: p.avatar }),
      h('span', { class: 'person-text' },
        h('span', { class: 'person-name' }, p.name, S.meId === p.id && h('span', { class: 'badge' }, 'сейчас')),
        h('span', { class: 'person-sub' }, (deptById(p.position_id) || deptById('d_other') || {}).name || '')),
      !p.active && h('span', { class: 'badge' }, 'отключён'),
      p.is_dev ? h('span', { class: 'role-badge dev-badge' }, 'Режим разработчика') : h('span', { class: 'role-badge role-' + p.access }, ACCESS_LABELS[p.access])))),
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
    const person = h('select', { class: 'inp' }, candidates.map(p => h('option', { value: p.id },
      p.name + ' · ' + p.positionIds.map(id => (deptById(id) || {}).name).filter(Boolean).join(', '))));
    let result = null;
    modal({
      title: 'Добавить в команду' + (unit ? ' «' + unit.name + '»' : ''),
      body: [field('Участник', person, 'Позиции — из профиля человека («Люди и доступы»).')],
      onClose: () => resolve(result),
      actions: [
        { label: 'Отмена' },
        {
          label: 'Добавить', primary: true, action: async close => {
            const p = S.people.find(x => x.id === person.value);
            const members = await send('setMember', { unitId, personId: p.id, departmentId: p.positionId });
            applyMembers(unitId, members);
            result = p.id;
            close();
          },
        },
      ],
    });
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

/**
 * Справочник (позиции или команды): перетаскивание за ручку, цвет, название на месте, сколько людей, скрыть/удалить.
 * Возвращает элемент.
 */
function dictionaryManager(cfg) {
  const list = h('div', { class: 'lf-list' });
  const sorted = () => [...cfg.items()].sort(byOrder);
  const save = (d, patch) => send(cfg.api.update, { id: d.id, ...patch }).then(saved => { Object.assign(d, saved); return d; });
  const remove = async d => {
    const n = cfg.count(d);
    if (!(await confirmDlg(cfg.removeText(d, n), { ok: 'Удалить', danger: true }))) return;
    await send(cfg.api.remove, { id: d.id });
    cfg.setItems(cfg.items().filter(x => x !== d));
    cfg.afterRemove(d);
    draw();
  };
  const row = d => {
    const color = h('input', { type: 'color', value: d.color, title: 'Цвет', onchange: e => save(d, { color: e.target.value }).then(draw).catch(showErr) });
    return h('div', { class: 'lf-row' + (d.archived ? ' off' : ''), dataset: { id: d.id } },
      h('span', { class: 'drag', title: 'Перетащите, чтобы изменить порядок' }, icon('grip', 16)),
      h('label', { class: 'pos-swatch', style: { background: d.color }, title: 'Цвет' }, color),
      h('input', {
        class: 'lf-name', value: d.name, maxlength: 40, 'aria-label': 'Название',
        onchange: e => { const v = e.target.value.trim(); if (!v) { e.target.value = d.name; return; } save(d, { name: v }).catch(showErr); },
        onkeydown: e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { e.target.value = d.name; e.target.blur(); } },
      }),
      d.archived && h('span', { class: 'badge' }, 'скрыта'),
      h('span', { class: 'pos-count', title: 'Людей' }, icon('users', 13), cfg.count(d)),
      cfg.extra && cfg.extra(d, draw),
      h('button', {
        class: 'icon-btn sm', title: d.archived ? 'Показать в списках' : 'Скрыть из списков (у людей и задач останется)',
        onclick: () => save(d, { archived: !d.archived }).then(draw).catch(showErr),
      }, icon(d.archived ? 'eyeOff' : 'eye', 15)),
      cfg.locked === d.id
        ? h('span', { class: 'icon-btn sm', title: cfg.lockedTitle, style: { opacity: 0.3 } }, icon('trash', 15))
        : h('button', { class: 'icon-btn sm', title: 'Удалить', onclick: () => remove(d).catch(showErr) }, icon('trash', 15)));
  };
  let sortable = null;
  const draw = () => {
    fill(list, cfg.items().length ? sorted().map(row) : h('p', { class: 'muted', style: { padding: '12px 14px', margin: 0 } }, cfg.emptyText));
    if (sortable) sortable.destroy();
    sortable = Sortable.create(list, {
      handle: '.drag', animation: 150, ghostClass: 'sortable-ghost', forceFallback: true, fallbackTolerance: 4,
      onEnd: () => {
        const ids = [...list.children].map(el => el.dataset.id).filter(Boolean);
        ids.forEach((id, i) => { const d = cfg.items().find(x => x.id === id); if (d) d.order = i + 1; });
        send(cfg.api.reorder, { ids }).catch(showErr);
      },
    });
  };
  const name = h('input', { class: 'inp', placeholder: cfg.placeholder, maxlength: 40 });
  const add = async () => {
    if (!name.value.trim()) return name.focus();
    const d = await send(cfg.api.create, { name: name.value, color: PALETTE[cfg.items().length % PALETTE.length] });
    cfg.setItems([...cfg.items(), d]);
    name.value = '';
    draw();
    name.focus();
  };
  name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); add().catch(showErr); } });
  draw();
  return h('div', null,
    h('p', { class: 'hint', style: { marginTop: 0 } }, cfg.hint),
    list,
    h('div', { class: 'sub-title' }, cfg.addTitle),
    h('div', { class: 'lf-add' }, name, h('button', { class: 'btn primary', onclick: () => add().catch(showErr) }, icon('plus', 14), 'Добавить')));
}

/** Позиции: есть у каждого человека (можно несколько) и у каждой задачи. Other не удалить. */
export const positionsManager = () => dictionaryManager({
  items: () => S.departments, setItems: v => { S.departments = v; },
  api: { create: 'createDepartment', update: 'updateDepartment', reorder: 'reorderDepartments', remove: 'deleteDepartment' },
  count: d => S.people.filter(p => (p.positionIds || [p.positionId]).includes(d.id)).length,
  locked: 'd_other', lockedTitle: 'Other нужна людям без другой позиции — её не удалить',
  removeText: (d, n) => `Удалить позицию «${d.name}»?${n ? ` У ${n} чел. она сменится на Other.` : ''} Задачи с этой позицией останутся без неё — участники перестанут их видеть. Если позиция может понадобиться — лучше скрыть.`,
  afterRemove: d => S.people.forEach(p => {
    if (!p.positionIds) return;
    p.positionIds = p.positionIds.filter(x => x !== d.id);
    if (p.positionId === d.id || !p.positionIds.length) { p.positionId = 'd_other'; p.positionIds = ['d_other', ...p.positionIds.filter(x => x !== 'd_other')]; }
  }),
  hint: 'Позиции есть у каждого человека (можно несколько) и у каждой задачи. Сотрудник видит в своих юнитах задачи своих позиций.',
  placeholder: 'Например, Backend Dev', addTitle: 'Добавить позицию', emptyText: 'Позиций нет',
});

/** Команды людей: у человека несколько, у задачи одна; участник видит задачи своих команд. */
export const teamsManager = () => dictionaryManager({
  items: () => S.teams, setItems: v => { S.teams = v; },
  api: { create: 'createTeam', update: 'updateTeam', reorder: 'reorderTeams', remove: 'deleteTeam' },
  count: d => S.people.filter(p => (p.teamIds || []).includes(d.id)).length,
  removeText: (d, n) => `Удалить команду «${d.name}»?${n ? ` Она пропадёт у ${n} чел.` : ''} Задачи этой команды останутся без неё. Если команда может понадобиться — лучше скрыть.`,
  afterRemove: d => S.people.forEach(p => { if (p.teamIds) p.teamIds = p.teamIds.filter(x => x !== d.id); }),
  extra: (d, redraw) => h('button', { class: 'btn ghost sm', title: 'Стартовые этапы личной доски для людей этой команды', onclick: () => editTeamStages(d, redraw) },
    icon('board', 13), (d.boardTemplate || []).length + ' этап.'),
  hint: 'Команды людей: Product Team, UX/UI Designers… У человека может быть несколько. Сотрудник видит в своих юнитах задачи своих команд. «Этапы» — стартовая личная доска для людей команды.',
  placeholder: 'Например, Growth Team', addTitle: 'Добавить команду', emptyText: 'Команд нет',
});

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

/** Шаблон этапов личной доски команды: его получает человек команды, пока не настроит свою. */
function editTeamStages(team, onDone) {
  const ed = columnsEditor((team.boardTemplate || []).map(c => ({ ...c })));
  modal({
    title: `Этапы доски · ${team.name}`, wide: true,
    body: [h('p', { class: 'hint', style: { marginTop: 0 } }, 'Стартовые этапы личной доски для людей этой команды. Кто уже настроил свою доску — у того она не изменится.'), ed.el],
    actions: [
      { label: 'Отмена' },
      { label: 'Сохранить', primary: true, action: async close => {
        Object.assign(team, await send('updateTeam', { id: team.id, boardTemplate: ed.value() }));
        close();
        onDone();
      } },
    ],
  });
}
