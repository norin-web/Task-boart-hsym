import Sortable from 'sortablejs';
import { S, colorFor, unitById, activeDepts, deptById, activeTeams, teamById, PALETTE, ACCESS_LABELS, isStaff, isSuper, byOrder } from '../state.js';
import { h, icon, avatar, field, modal, confirmDlg, showErr, toast, fill, colorPicker, menu } from '../ui.js';
import { send, call } from '../api.js';
import { rerender, navigate } from '../router.js';
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
function dictPicker({ title, items, byId, get, set, main = false, note = '', empty = '', disabled = false, chips = false }) {
  const btn = h('button', { class: 'pos-btn' + (chips ? ' as-chips' : ''), type: 'button', disabled, title: disabled ? '' : title, onclick: e => { e.stopPropagation(); open(); } });
  // Внутри поля — как в обычном списке: точки цветов и названия через запятую (без чипов)
  const paint = () => {
    const list = get().map(byId).filter(Boolean);
    fill(btn,
      chips && list.length ? h('span', { class: 'pick-chips', title: list.map(d => d.name).join(', ') }, list.map(d => h('span', { class: 'pick-chip' }, d.name)))
      : list.length
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
export function showCredentials(person, password) {
  const site = location.origin + location.pathname;
  const text = `Вход в Tasks: ${site}\nEmail: ${person.email}\nВременный пароль: ${password}\nПосле входа смените пароль: аккаунт внизу слева → «Настройки» → «Профиль».`;
  modal({
    title: 'Доступ создан',
    cls: 'dlg',
    body: [
      h('p', { class: 'hint' }, 'Отправьте это ', h('b', null, person.name), ' — пароль больше нигде не показывается:'),
      h('pre', { class: 'creds' }, text),
    ],
    actions: [
      { label: 'Готово' },
      { label: 'Скопировать', primary: true, action: async () => { await navigator.clipboard.writeText(text).catch(() => {}); toast('Скопировано'); } },
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
    cls: 'dlg',
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
export function peopleManager({ search = false, bare = false } = {}) {
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
    isSuper() && p.access === 'moderator' && { label: 'Приложения PM…', icon: 'layers', action: () => pmAppsDialog(p).catch(showErr) },
    isSuper() && { sep: true },
    isSuper() && { label: 'Удалить из системы', icon: 'trash', danger: true, action: () => removePerson(p).catch(showErr) },
  ]);

  /** CEO выбирает, какие приложения видит PM (внутри его юнитов). Остальные для PM не существуют — проверка в базе. */
  async function pmAppsDialog(p) {
    const [apps, lists] = await Promise.all([call('listApps', {}), call('getPmApps', {})]);
    const mine = new Set(lists[p.id] || []);
    const units = S.units.filter(u => !u.archived && (u.members || []).includes(p.id));
    const boxes = new Map();
    const body = units.length ? units.map(u => {
      const list = apps.filter(a => a.unitId === u.id);
      const checks = list.map(a => {
        const cb = h('input', { type: 'checkbox', checked: mine.has(a.id), onchange: () => (cb.checked ? mine.add(a.id) : mine.delete(a.id)) });
        boxes.set(a.id, cb);
        return h('label', { class: 'row', style: { gap: '8px', padding: '4px 0' } }, cb, h('span', null, a.name));
      });
      const all = h('button', { class: 'link-btn', type: 'button', onclick: () => {
        const on = list.some(a => !mine.has(a.id));
        list.forEach(a => { boxes.get(a.id).checked = on; on ? mine.add(a.id) : mine.delete(a.id); });
      } }, 'Все / никакие');
      return h('div', { style: { marginBottom: '12px' } },
        h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('b', null, u.name), list.length > 1 && all),
        list.length ? checks : h('p', { class: 'hint', style: { margin: 0 } }, 'В юните пока нет приложений'));
    }) : [h('p', { class: 'hint' }, 'PM не состоит ни в одном юните — сначала добавьте его в юнит.')];
    modal({
      title: 'Приложения PM · ' + p.name,
      cls: 'dlg',
      body: [h('p', { class: 'hint', style: { marginTop: 0 } }, 'PM видит только отмеченные приложения и задачи по ним. Остальные скрыты от него полностью.'), ...body],
      actions: [{ label: 'Отмена' }, { label: 'Сохранить', primary: true, action: async close => {
        await send('setPmApps', { personId: p.id, appIds: [...mine] });
        close();
        toast('Список приложений PM сохранён');
      } }],
    });
  }

  const removePerson = async p => {
    const n = Number(await call('queryTasks', { assigneeId: p.id, count: true }).catch(() => 0)) || 0;
    const tasksNote = n ? ` Его задачи (${n}) останутся без исполнителя.` : '';
    if (!(await confirmDlg(`Удалить ${p.name} из системы навсегда? Вход и профиль удалятся, человек пропадёт из команд.${tasksNote} История и комментарии сохранятся.`, { ok: 'Удалить', danger: true }))) return;
    await send('deletePerson', { id: p.id });
    S.people = S.people.filter(x => x !== p);
    toast(p.name + ' удалён(а) из системы');
    draw();
  };

  const toggleActive = async p => {
    if (p.active && !(await confirmDlg('Человек не сможет войти; его задачи останутся.', { title: `Отключить ${p.name}?`, ok: 'Отключить', danger: true }))) return;
    save(p, { active: !p.active });
  };

  const row = p => {
    const editableTarget = isSuper() || p.access !== 'superadmin';
    return h('div', { class: 'access-row' + (p.active ? '' : ' inactive') },
      avatar(p),
      h('span', { class: 'person-text', 'data-pcard': p.id },
        h('span', { class: 'person-name' }, p.name, S.meId === p.id && h('span', { class: 'badge' }, 'вы')),
        h('span', { class: 'person-sub' + (p.active && !p.linked && mode === 'supabase' ? ' warn-text' : '') },
          [p.email || 'без email', !p.active ? 'доступ отключён' : p.linked ? 'вход есть' : mode === 'supabase' ? 'нет входа' : ''].filter(Boolean).join(' · '))),
      teamsPicker(() => p.teamIds || [], ids => { p.teamIds = ids; save(p, { teamIds: ids }); }, { disabled: !editableTarget, chips: bare }),
      positionsPicker(() => p.positionIds, ids => { p.positionIds = ids; save(p, { positionId: ids[0], extraPositionIds: ids.slice(1) }); }, { disabled: !editableTarget, chips: bare }),
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
  const filterSel = () => h('select', { class: 'inp' + (bare ? ' pill-select' : ''), style: bare ? null : { width: 'auto' }, 'aria-label': 'Роль', onchange: ev => { accessFilter = ev.target.value; draw(); } },
      h('option', { value: '' }, bare ? 'Все роли' : 'Все'),
      Object.entries(ACCESS_LABELS).map(([k, v]) => h('option', { value: k }, v)),
      mode === 'supabase' && h('option', { value: 'nologin' }, 'Без входа'),
      h('option', { value: 'off' }, 'Отключённые'));
  const onSearch = ev => { q = ev.target.value.trim().toLowerCase(); draw(); };
  if (bare) {
    // настройки (макет 18): поиск и роль — справа от вкладок, «+ Человек» — в шапке, подсказки и форма — не здесь
    const el = h('div', { class: 'card-box people-card' }, box);
    el.toolbar = h('div', { class: 'people-tools' },
      h('label', { class: 'apps-search' }, icon('search', 16), h('input', { class: 'apps-search-inp', type: 'search', placeholder: 'Имя или email', oninput: onSearch })),
      filterSel());
    el.refresh = draw;
    return el;
  }
  const toolbar = search && h('div', { class: 'row', style: { marginBottom: '10px' } },
    h('input', { class: 'inp', type: 'search', placeholder: 'Поиск по имени или email', style: { maxWidth: '280px' }, oninput: onSearch }),
    filterSel());
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
      cls: 'dlg',
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
    if (!(await confirmDlg(`Выдать ${p.name} новый временный пароль? Старый перестанет работать.`, { title: 'Новый временный пароль', ok: 'Выдать' }))) return;
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
    cls: 'dlg dlg-p',
    body: [
      h('div', { class: 'pf-top' }, preview,
        h('div', null, h('div', { class: 'pf-name' }, p.name), h('div', { class: 'hint' }, [ACCESS_LABELS[p.access], posNames, p.email].filter(Boolean).join(' · ')))),
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
    const candidates = S.people.filter(p => p.active && !inTeam.has(p.id) && (isSuper() ? ['member', 'lead', 'rm', 'moderator'] : ['member', 'lead', 'rm']).includes(p.access));
    if (!candidates.length) {
      toast(isStaff() ? 'Все участники уже в команде. Новых людей добавляют в «Люди и доступы».' : 'Нет доступных людей');
      return resolve(null);
    }
    // группой: люди по позициям с галочками, «все» — по позиции целиком
    const picked = new Set();
    const list = h('div', { class: 'am-list' });
    const count = h('span', { class: 'muted' });
    const posOf = p => ((p.positionIds && p.positionIds[0]) || p.positionId || '');
    const groups = [...new Set(candidates.map(posOf))].map(id => ({ name: (deptById(id) || {}).name || 'Без позиции', ps: candidates.filter(p => posOf(p) === id) }));
    const draw = () => {
      count.textContent = picked.size ? `Выбрано: ${picked.size}` : 'Отметьте людей';
      fill(list, groups.map(g => h('div', { class: 'am-group' },
        h('div', { class: 'am-head' }, h('span', null, g.name),
          h('button', { class: 'link-btn', type: 'button', onclick: () => { const all = g.ps.every(p => picked.has(p.id)); g.ps.forEach(p => (all ? picked.delete(p.id) : picked.add(p.id))); draw(); } }, g.ps.every(p => picked.has(p.id)) ? 'снять' : 'все')),
        g.ps.map(p => h('label', { class: 'am-row' },
          h('input', { type: 'checkbox', checked: picked.has(p.id), onchange: e => { if (e.target.checked) picked.add(p.id); else picked.delete(p.id); draw(); } }),
          avatar(p, 'sm'), h('span', { class: 'am-name' }, p.name), p.access !== 'member' && h('span', { class: 'muted' }, ACCESS_LABELS[p.access] || ''))))));
    };
    draw();
    let result = null;
    modal({
      title: 'Добавить в команду' + (unit ? ' «' + unit.name + '»' : ''),
      cls: 'dlg',
      body: [list, h('p', { class: 'hint', style: { margin: '8px 0 0' } }, count, ' · позиции берутся из профиля человека («Люди и доступы»).')],
      onClose: () => resolve(result),
      actions: [
        { label: 'Отмена' },
        {
          label: 'Добавить', primary: true, action: async close => {
            if (!picked.size) { toast('Отметьте хотя бы одного человека'); return; }
            for (const id of picked) {
              const p = S.people.find(x => x.id === id);
              applyMembers(unitId, await send('setMember', { unitId, personId: id, departmentId: p.positionId }));
              result = result || id;
            }
            toast(`Добавлено: ${picked.size}`);
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
  modal({ title: 'Позиции', cls: 'dlg dlg-w', body: positionsManager({ bare: true }), actions: [{ label: 'Готово', primary: true, action: c => c() }], onClose: rerender });
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
  if (cfg.bare) return dictTable(cfg, { save, remove });
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

/**
 * Справочник таблицей (настройки, макеты 37/38): ручка, цвет, название и люди, число людей, третья колонка, меню «⋯».
 * Добавление — строкой внизу, поиск — el.toolbar (рисуется справа от вкладок), el.focusAdd — для кнопки в шапке.
 */
function dictTable(cfg, { save, remove }) {
  let q = '';
  const name = h('input', { class: 'inp dt-add-inp', placeholder: cfg.placeholder, maxlength: 40 });
  const add = async () => {
    if (!name.value.trim()) return name.focus();
    const d = await send(cfg.api.create, { name: name.value, color: PALETTE[cfg.items().length % PALETTE.length] });
    cfg.setItems([...cfg.items(), d]);
    if (cfg.expand) opened.add(d.id); // сразу видно, кого добавить
    name.value = '';
    name.focus();
  };
  const list = h('div', { class: 'dt-list' });
  const opened = new Set(); // раскрытые строки: состав команды
  const members = d => {
    const ps = cfg.people(d);
    return !ps.length ? 'Пока никого' : ps.length === 1 ? ps[0].name : ps.map(p => p.name.split(' ')[0]).join(', ');
  };
  const rowMenu = (anchor, d) => menu(anchor, [
    cfg.third.edit && { label: cfg.third.editLabel, icon: 'board', action: () => cfg.third.edit(d, draw) },
    { label: d.archived ? 'Показать в списках' : 'Скрыть из списков', icon: 'eye', action: () => save(d, { archived: !d.archived }).then(draw).catch(showErr) },
    cfg.locked !== d.id && { sep: true },
    cfg.locked !== d.id && { label: 'Удалить', icon: 'trash', danger: true, action: () => remove(d).then(draw).catch(showErr) },
  ]);
  const row = d => {
    const color = h('input', { type: 'color', value: d.color, title: 'Цвет', onchange: e => save(d, { color: e.target.value }).then(draw).catch(showErr) });
    return h('div', { class: 'dt-row' + (d.archived ? ' off' : ''), dataset: { id: d.id } },
      h('span', { class: 'drag', title: 'Перетащите, чтобы изменить порядок' }, icon('grip', 14)),
      h('label', { class: 'dt-dot', style: { background: d.color }, title: 'Цвет' }, color),
      h('span', { class: 'dt-main' },
        h('input', {
          class: 'dt-name', value: d.name, maxlength: 40, 'aria-label': 'Название',
          onchange: e => { const v = e.target.value.trim(); if (!v) { e.target.value = d.name; return; } save(d, { name: v }).catch(showErr); },
          onkeydown: e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { e.target.value = d.name; e.target.blur(); } },
        }),
        h('span', { class: 'dt-sub' }, members(d))),
      cfg.expand
        ? h('button', { class: 'dt-n dt-open' + (opened.has(d.id) ? ' on' : ''), title: 'Кто в команде', 'aria-expanded': String(opened.has(d.id)), onclick: () => { if (opened.has(d.id)) opened.delete(d.id); else opened.add(d.id); draw(); } }, cfg.count(d), icon('chevron', 14))
        : h('b', { class: 'dt-n' }, cfg.count(d)),
      cfg.third.edit
        ? h('button', { class: 'dt-third link-btn', title: cfg.third.editLabel, onclick: () => cfg.third.edit(d, draw) }, cfg.third.text(d))
        : h('span', { class: 'dt-third' }, cfg.third.text(d)),
      h('button', { class: 'icon-btn sm', title: 'Действия', onclick: e => { e.stopPropagation(); rowMenu(e.currentTarget, d); } }, icon('more')));
  };
  let sortable = null;
  const draw = () => {
    const items = [...cfg.items()].sort(byOrder).filter(d => !q || d.name.toLowerCase().includes(q));
    fill(list, items.length ? items.flatMap(d => [row(d), cfg.expand && opened.has(d.id) && cfg.expand(d, draw)]).filter(Boolean) : h('p', { class: 'muted dt-empty' }, q ? 'Ничего не найдено' : cfg.emptyText));
    if (sortable) sortable.destroy();
    sortable = Sortable.create(list, {
      handle: '.drag', draggable: '.dt-row', animation: 150, ghostClass: 'sortable-ghost', forceFallback: true, fallbackTolerance: 4, disabled: !!q,
      onEnd: () => {
        const ids = [...list.children].map(el => el.dataset.id).filter(Boolean);
        if (opened.size) setTimeout(draw);
        ids.forEach((id, i) => { const d = cfg.items().find(x => x.id === id); if (d) d.order = i + 1; });
        send(cfg.api.reorder, { ids }).catch(showErr);
      },
    });
  };
  const addAndDraw = () => add().then(draw).catch(showErr);
  name.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addAndDraw(); } };
  draw();
  const el = h('div', { class: 'card-box dt-card' },
    h('div', { class: 'dt-row dt-head' }, h('span'), h('span'), h('span', null, cfg.colTitle), h('span', null, 'Людей'), h('span', null, cfg.third.title), h('span')),
    list,
    h('div', { class: 'dt-add' }, name, h('button', { class: 'btn soft', onclick: addAndDraw }, icon('plus', 14), cfg.addTitle)));
  el.toolbar = h('label', { class: 'apps-search' }, icon('search', 16),
    h('input', { class: 'apps-search-inp', type: 'search', placeholder: cfg.searchText, oninput: e => { q = e.target.value.trim().toLowerCase(); draw(); } }));
  el.focusAdd = () => name.focus();
  return el;
}

/** Позиции: есть у каждого человека (можно несколько) и у каждой задачи. Other не удалить. */
export const positionsManager = ({ bare = false } = {}) => dictionaryManager({
  bare, colTitle: 'Позиция', searchText: 'Название позиции',
  people: d => S.people.filter(p => p.active && (p.positionIds || [p.positionId]).includes(d.id)),
  third: { title: 'Видимость', text: d => (d.id === 'd_other' ? 'Нельзя удалить · для людей без позиции' : d.archived ? 'Скрыта' : 'В списках') },
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

const setTeam = async (p, teamId, on) => {
  const teamIds = on ? [...new Set([...(p.teamIds || []), teamId])] : (p.teamIds || []).filter(x => x !== teamId);
  await send('updatePerson', { id: p.id, teamIds });
  p.teamIds = teamIds;
};

/** Позиции команды чипами: какие задачи попадают на доску команды. onChange(ids) — после каждого клика. */
function teamDeptChips(ids, onChange) {
  const picked = new Set(ids || []);
  const box = h('div', { class: 'ap-pick-units team-depts', role: 'group', 'aria-label': 'Позиции команды' });
  const draw = () => fill(box, activeDepts().map(d => {
    const on = picked.has(d.id);
    return h('button', { type: 'button', class: 'fchip' + (on ? ' on' : ''), 'aria-pressed': String(on),
      onclick: () => { if (on) picked.delete(d.id); else picked.add(d.id); draw(); onChange([...picked]); } }, d.name);
  }));
  draw();
  return box;
}
const TEAM_DEPTS_HINT = 'На доске команды — задачи этих позиций у людей команды. Ничего не выбрано — все задачи людей команды.';

/** Состав команды под строкой: позиции на доске, кто в ней, убрать, добавить. */
function teamPanel(d, redraw) {
  const inTeam = S.people.filter(p => p.active && (p.teamIds || []).includes(d.id));
  const rest = S.people.filter(p => p.active && !(p.teamIds || []).includes(d.id));
  const change = (p, on) => setTeam(p, d.id, on).then(() => { renderSidebar(); redraw(); }).catch(showErr);
  const saveDepts = ids => send('updateTeam', { id: d.id, departmentIds: ids }).then(t => { d.departmentIds = t.departmentIds; }).catch(showErr);
  return h('div', { class: 'dt-team' },
    h('div', { class: 'dt-depts' }, h('span', { class: 'muted' }, 'Позиции на доске команды'), teamDeptChips(d.departmentIds, saveDepts), h('span', { class: 'hint' }, TEAM_DEPTS_HINT)),
    inTeam.map(p => h('div', { class: 'dt-person' }, avatar(p, 'sm'), h('span', { class: 'dt-person-name' }, p.name),
      h('button', { class: 'icon-btn sm', title: 'Убрать из команды', 'aria-label': 'Убрать ' + p.name, onclick: () => change(p, false) }, icon('x', 14)))),
    rest.length > 0 && h('select', { class: 'inp dt-person-add', 'aria-label': 'Добавить в команду', onchange: e => { const p = S.people.find(x => x.id === e.target.value); if (p) change(p, true); } },
      h('option', { value: '' }, 'Добавить человека…'), rest.map(p => h('option', { value: p.id }, p.name))));
}

/** Новая команда из юнита: название и участники; без участников в сайдбаре юнита её не будет. */
export function openTeamDialog(unit) {
  const name = h('input', { class: 'inp', maxlength: 40, placeholder: 'Например, Growth Team' });
  const picked = new Set();
  let depts = [];
  const people = S.people.filter(p => p.active).sort((a, b) => Number((unit.members || []).includes(b.id)) - Number((unit.members || []).includes(a.id)) || a.name.localeCompare(b.name));
  const list = h('div', { class: 'td-list' });
  const draw = () => fill(list, people.map(p => {
    const on = picked.has(p.id);
    return h('button', { class: 'menu-item aud-item td-row' + (on ? ' on' : ''), role: 'checkbox', 'aria-checked': String(on), onclick: () => { if (on) picked.delete(p.id); else picked.add(p.id); draw(); } },
      h('span', { class: 'aud-check' }, on && icon('check', 13)), avatar(p, 'sm'), p.name, !(unit.members || []).includes(p.id) && h('span', { class: 'muted td-out' }, 'добавится в юнит'));
  }));
  draw();
  modal({
    title: 'Новая команда · ' + unit.name,
    cls: 'dlg td-dlg',
    body: [field('Название', name), field('Позиции на доске', teamDeptChips([], ids => { depts = ids; }), TEAM_DEPTS_HINT), field('Участники', list)],
    actions: [{ label: 'Отмена' }, { label: 'Создать', primary: true, action: async close => {
      if (!name.value.trim()) { name.focus(); return; }
      if (!picked.size) { toast('Выберите хотя бы одного участника', { type: 'error' }); return; }
      const team = await send('createTeam', { name: name.value, color: PALETTE[S.teams.length % PALETTE.length], departmentIds: depts });
      S.teams = [...S.teams, team];
      for (const id of picked) {
        const p = S.people.find(x => x.id === id);
        await setTeam(p, team.id, true);
        if (!(unit.members || []).includes(id)) {
          await send('setMember', { unitId: unit.id, personId: id, departmentId: p.positionId });
          unit.members = [...(unit.members || []), id];
        }
      }
      close();
      renderSidebar();
      navigate({ unit: unit.id, mode: 'board', team: team.id });
      toast(`Команда «${team.name}» создана`);
    } }],
  });
  setTimeout(() => name.focus(), 0);
}

/** Команды людей: у человека несколько, у задачи одна; участник видит задачи своих команд. */
export const teamsManager = ({ bare = false } = {}) => dictionaryManager({
  bare, colTitle: 'Команда', searchText: 'Название команды',
  people: d => S.people.filter(p => p.active && (p.teamIds || []).includes(d.id)),
  third: {
    title: 'Этапы личной доски', editLabel: 'Этапы доски', edit: (d, redraw) => editTeamStages(d, redraw),
    text: d => ((d.boardTemplate || []).length ? d.boardTemplate.map(c => c.name).join(' · ') : 'Стандартная доска'),
  },
  items: () => S.teams, setItems: v => { S.teams = v; },
  api: { create: 'createTeam', update: 'updateTeam', reorder: 'reorderTeams', remove: 'deleteTeam' },
  count: d => S.people.filter(p => (p.teamIds || []).includes(d.id)).length,
  removeText: (d, n) => `Удалить команду «${d.name}»?${n ? ` Она пропадёт у ${n} чел.` : ''} Задачи этой команды останутся без неё. Если команда может понадобиться — лучше скрыть.`,
  afterRemove: d => S.people.forEach(p => { if (p.teamIds) p.teamIds = p.teamIds.filter(x => x !== d.id); }),
  expand: (d, redraw) => teamPanel(d, redraw),
  extra: (d, redraw) => h('button', { class: 'btn ghost sm', title: 'Стартовые этапы личной доски для людей этой команды', onclick: () => editTeamStages(d, redraw) },
    icon('board', 13), (d.boardTemplate || []).length + ' этап.'),
  hint: 'Команды людей: Product Team, UX/UI Designers… У человека может быть несколько. Сотрудник видит в своих юнитах задачи своих команд. «Этапы» — стартовая личная доска для людей команды.',
  placeholder: 'Например, Growth Team', addTitle: 'Добавить команду', emptyText: 'Команд нет',
});

export function openShortcuts() {
  const row = (keys, text) => h('div', { class: 'sk-row' },
    h('span', null, text), h('span', { class: 'sk-keys' }, keys.map(k => h('kbd', null, k))));
  modal({
    title: 'Горячие клавиши',
    cls: 'dlg',
    actions: [{ label: 'Закрыть', primary: true, action: c => c() }],
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
export function editTeamStages(team, onDone) {
  const ed = columnsEditor((team.boardTemplate || []).map(c => ({ ...c })));
  modal({
    title: `Этапы доски · ${team.name}`, wide: true,
    cls: 'dlg dlg-w',
    body: [h('p', { class: 'hint' }, 'Стартовые этапы личной доски для людей этой команды. Кто уже настроил свою доску — у того она не изменится.'), ed.el],
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
