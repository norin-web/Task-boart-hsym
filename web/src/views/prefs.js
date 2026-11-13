/**
 * Настройки (#/settings?tab=…) — всё в одном месте. Слева разделы:
 *   Личное (у всех): профиль, внешний вид, уведомления, доски; CEO и PM — свои графики аналитики;
 *   Студия: CEO и PM — люди и доступы, юниты, автоматизации, журнал; CEO — приложения; CEO и RM — релизы.
 * Раздел студии рисует admin.js (renderStudio), редакторы приложений и релизов открываются своими окнами.
 */
import { S, LS, me, isStaff, isSuper, isDev, myAccess, ACCESS_LABELS, deptById, plural } from '../state.js';
import { $, h, icon, avatar, topbar, fill, showErr, toast } from '../ui.js';
import { send, call } from '../api.js';
import { link, currentView, rerender, navigate } from '../router.js';
import { mode, supabase } from '../data.js';
import { THEME_LIST, setTheme, resetLocal } from './sidebar.js';
import { openMyProfile, openActAs, addPersonDialog } from './people.js';
import { renderStudio, STUDIO_TABS } from './admin.js';
import { openCreateUnit } from './units.js';
import { chartsSection, editChart } from './chartsettings.js';
import { hasInfoList, infoListSection, openInfoListsEditor, infoListCount } from './infolist.js';
import { feedbackSection } from './feedback.js';

const PERSONAL_ALL = [
  ['profile', 'Профиль', 'user'],
  ['notify', 'Уведомления', 'bell'],
  ['boards', 'Доски', 'board'],
  ['charts', 'Графики', 'chart'],
  ['infolist', 'Инфо-лист', 'link'],
  ['feedback', 'Обратная связь', 'message'],
];
/** Разработчик (из своего аккаунта) предложения не шлёт — входящие у него на странице режима разработчика. */
const devInbox = () => isDev() && S.meId === S.realMeId;
/** Личные разделы: «Графики» — у тех, у кого есть аналитика (CEO и PM); «Инфо-лист» — кому его включил CEO. */
const personal = () => PERSONAL_ALL.filter(t => (t[0] !== 'charts' || isSuper()) && (t[0] !== 'infolist' || hasInfoList() || isSuper()) && (t[0] !== 'feedback' || !devInbox()));

/** Разделы студии, доступные вошедшему. */
const studio = () => [
  // люди, юниты и журнал — только CEO; PM остаются автоматизации (его флоу и шаблоны)
  ...(isSuper() ? STUDIO_TABS : isStaff() ? STUDIO_TABS.filter(t => t[0] === 'automations') : []),
  isSuper() && ['apps', 'Приложения', 'app'],
  (isSuper() || myAccess() === 'rm') && ['releases', 'Релизы', 'rocket'],
].filter(Boolean);

/** События уведомлений: группа → виды (prefs.notifyOff — выключенные виды). */
const NOTIFY = [
  ['Назначили на меня', 'Новая задача или этап на вас', ['assigned', 'handoff']],
  ['Ревью', 'Прислали на ревью, вернули, приняли', ['review', 'returned', 'approved']],
  ['Выполнено', 'Закрыли задачу, которую вы поставили', ['task_done']],
  ['Упоминания', 'Отметили через @ в комментарии или описании', ['mention']],
  ['Можно начинать', 'Предыдущие этапы закрыты', ['unblocked']],
  ['Сроки', 'Срок сегодня или завтра, просрочено', ['due_soon', 'overdue']],
  ['Релизы', 'Вышло в App Store, реджект Apple', ['store_live', 'store_reject']],
  ['Обратная связь', 'Новые предложения людей по улучшению (режим разработчика)', ['feedback'], 'dev'],
];

export function renderPrefs(tab) {
  const PERSONAL = personal();
  const all = [...PERSONAL, ...studio()];
  if (!all.some(t => t[0] === tab) && tab !== 'trash') {
    if (tab) return navigate({ view: 'settings' }, { replace: true });  // закрытый раздел (например, «Люди» у PM) — не оставляем его адрес
    tab = 'profile';
  }
  const navTab = tab === 'trash' ? 'units' : tab;
  const key = currentView();
  const body = h('div', { class: 'prefs-body' + (PERSONAL.some(t => t[0] === tab) && !['look', 'notify', 'boards', 'charts', 'infolist'].includes(tab) ? ' narrow' : '') });
  const item = ([id, label, ic]) => link({ view: 'settings', tab: id }, { class: 'prefs-tab' + (id === navTab ? ' on' : '') }, icon(ic, 15), label);
  fill($('#main'),
    topbar([h('h1', { class: 'screen-title' }, 'Настройки')],
      [isSuper() && (tab === 'units' || tab === 'trash') && h('button', { class: 'btn primary', onclick: openCreateUnit }, icon('plus', 15), h('span', { class: 'btn-label' }, 'Юнит')),
        tab === 'automations' && h('button', { class: 'btn primary tpl-add' }, icon('plus', 15), h('span', { class: 'btn-label' }, 'Шаблон')),
        tab === 'charts' && h('button', { class: 'btn primary', onclick: () => { editChart('new'); rerender(); } }, icon('plus', 15), h('span', { class: 'btn-label' }, 'График')),
        tab === 'people' && h('button', { class: 'btn primary people-add', onclick: () => addPersonDialog(() => rerender()) }, icon('plus', 15), h('span', { class: 'btn-label' }, 'Человек'))]),
    h('div', { class: 'view-body prefs-page' },
      h('nav', { class: 'prefs-nav', 'aria-label': 'Разделы настроек' },
        h('div', { class: 'prefs-sec' }, 'Личное'), PERSONAL.map(item),
        studio().length > 0 && [h('div', { class: 'prefs-sec' }, 'Студия'), studio().map(item)]),
      body));

  const SECTIONS = { profile, look, notify, boards, charts: chartsSection, infolist: infoListSection, feedback: feedbackSection, apps: appsSection, releases: releasesSection };
  if (SECTIONS[tab]) fill(body, SECTIONS[tab]());
  else renderStudio(body, tab, key);
}

/* ---------- общее ---------- */

const head = (title, sub) => h('div', { class: 'prefs-head' }, h('h2', null, title), sub && h('p', { class: 'muted' }, sub));
/** Действие строки (act): вся строка — кнопка, при наведении подсветка и стрелка; без кнопок у правого края. */
const act = (label, onclick, { danger = false } = {}) => ({ label, onclick, danger });
/** Строка настройки: название, пояснение; action — act(…) или свой элемент справа (переключатель). */
const row = (title, sub, action, ic, below) => {
  const text = h('span', { class: 'prefs-row-text' }, h('b', null, title), sub && h('small', { class: 'muted' }, sub), below);
  // как в макете 49: иконка в плашке слева
  const lead = ic && h('span', { class: 'prefs-ic' }, icon(ic, 16));
  return action && action.onclick
    ? h('button', { class: 'prefs-row click' + (action.danger ? ' danger' : ''), type: 'button', 'aria-label': `${title}: ${action.label}`, onclick: action.onclick }, lead, text, h('span', { class: 'prefs-go' }, icon('chevron', 15)))
    : h('div', { class: 'prefs-row' }, lead, text, action);
};
const card = (...rows) => h('div', { class: 'card-box prefs-card' }, rows);

/* ---------- личное ---------- */

function profile() {
  const p = me();
  if (!p) return null;
  const pos = (p.positionIds || []).map(id => (deptById(id) || {}).name).filter(Boolean).join(', ');
  const email = (S.session && S.session.user.email) || p.email;
  const city = p.timezone ? p.timezone.split('/').pop().replace(/_/g, ' ') : '';
  const time = p.timezone ? (() => { try { return new Intl.DateTimeFormat('ru-RU', { timeZone: p.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date()); } catch { return ''; } })() : '';
  const val = (label, v) => h('div', { class: 'pf-val' }, h('small', null, label), h('b', null, v || '—'));
  return [
    h('div', { class: 'prefs-head' }, h('h2', null, 'Профиль'), h('p', { class: 'muted' }, 'Видят все в студии: в карточке человека и в упоминаниях')),
    h('div', { class: 'card-box pf-card' },
      h('div', { class: 'pf-head', 'data-no-card': '' }, h('button', { class: 'pf-av', type: 'button', 'aria-label': 'Изменить фото', onclick: openMyProfile }, avatar(p, 'xl'), h('span', { class: 'pf-edit' }, icon('edit', 12))),
        h('div', { class: 'pf-who' }, h('b', null, p.name), h('span', { class: 'muted' }, [ACCESS_LABELS[p.access], pos].filter(Boolean).join(' · '))),
        h('button', { class: 'btn lg', onclick: openMyProfile }, 'Изменить профиль')),
      h('div', { class: 'pf-grid' },
        val('Почта', email), val('Telegram', p.telegram ? '@' + p.telegram : ''),
        val('Город и время', [city, time].filter(Boolean).join(' · ')), val('Должность', p.role))),
    h('div', { class: 'prefs-head' }, h('h2', null, 'Аккаунт')),
    card(
      mode === 'local' && row('Локальный режим', 'Данные хранятся только в этом браузере', null, 'monitor'),
      mode === 'local' && row('Войти как…', 'Посмотреть Tasks глазами другого человека', act('Выбрать', openActAs), 'user'),
      mode === 'local' && row('Очистить локальную базу', 'Стереть всё и начать с чистой базы', act('Стереть', resetLocal, { danger: true }), 'trash'),
      mode === 'supabase' && row('Выйти', email, act('Выйти', () => supabase.auth.signOut(), { danger: true }), 'back')),
  ];
}

/** Мини-экран для карточки темы: сайдбар и панель с двумя строками. */
const themeShot = dark => h('span', { class: 'th-shot' + (dark ? ' dark' : '') },
  h('span', { class: 'th-side' }), h('span', { class: 'th-main' }, h('i'), h('span', { class: 'th-panel' }, h('i'), h('i'))));

function look() {
  const box = h('div', { class: 'theme-pick', role: 'radiogroup', 'aria-label': 'Тема' });
  const draw = () => fill(box, Object.entries(THEME_LIST).map(([id, [label, ic]]) => {
    const on = LS.get('theme', 'auto') === id;
    const name = label.replace('Тема: ', '');
    return h('button', { class: 'theme-card' + (on ? ' on' : ''), role: 'radio', 'aria-checked': String(on), onclick: () => { setTheme(id); draw(); } },
      h('span', { class: 'th-prev' + (id === 'auto' ? ' split' : '') }, id === 'auto' ? [themeShot(false), themeShot(true)] : themeShot(id === 'dark')),
      h('span', { class: 'th-foot' }, icon(ic, 15), h('b', null, name.charAt(0).toUpperCase() + name.slice(1)),
        h('span', { class: 'th-radio' }, on && icon('check', 12))));
  }));
  draw();
  return [head('Тема', 'Сохраняется в этом браузере. «Как в системе» переключается вместе с macOS или iOS'), box];
}

function notify() {
  const p = me();
  let off = [...(((p && p.prefs) || {}).notifyOff || [])];
  const save = () => {
    if (p) p.prefs = { ...(p.prefs || {}), notifyOff: off };
    send('setMyPrefs', { personId: S.meId, prefs: { notifyOff: off } }).then(() => toast('Сохранено')).catch(showErr);
  };
  const table = h('div', { class: 'card-box nt-table', role: 'table', 'aria-label': 'Уведомления' });
  const draw = () => fill(table,
    h('div', { class: 'nt-row nt-head', role: 'row' }, h('span', { role: 'columnheader' }, 'Событие'),
      h('span', { role: 'columnheader' }, 'В Tasks'), h('span', { role: 'columnheader' }, 'Почта', h('span', { class: 'soon-tag' }, 'скоро')),
      h('span', { role: 'columnheader' }, 'Telegram', h('span', { class: 'soon-tag' }, 'скоро'))),
    NOTIFY.filter(([, , , only]) => only !== 'dev' || isDev()).map(([title, sub, kinds]) => {
      const on = !kinds.every(k => off.includes(k));
      return h('div', { class: 'nt-row', role: 'row' },
        h('span', { class: 'prefs-row-text', role: 'cell' }, h('b', null, title), h('small', { class: 'muted' }, sub)),
        h('span', { role: 'cell' }, h('input', { type: 'checkbox', class: 'switch', checked: on, 'aria-label': title + ' — в Tasks',
          onchange: e => { off = e.target.checked ? off.filter(k => !kinds.includes(k)) : [...new Set([...off, ...kinds])]; save(); draw(); } })),
        h('span', { role: 'cell' }, h('input', { type: 'checkbox', class: 'switch', disabled: true, title: 'Скоро', 'aria-label': title + ' — почта' })),
        h('span', { role: 'cell' }, h('input', { type: 'checkbox', class: 'switch', disabled: true, title: 'Скоро', 'aria-label': title + ' — Telegram' })));
    }));
  draw();
  // история в колокольчике: прочитанные не пропадают, а хранятся N дней
  const days = Number((((p && p.prefs) || {}).notifyDays)) || 7;
  const hist = h('div', { class: 'card-box nt-hist' },
    h('span', { class: 'prefs-row-text' }, h('b', null, 'История уведомлений'), h('small', { class: 'muted' }, 'Прочитанные остаются в колокольчике приглушёнными, чтобы ничего не потерять')),
    h('select', { class: 'inp sm', 'aria-label': 'Сколько дней хранить историю', onchange: e => {
      const v = Number(e.target.value);
      if (p) p.prefs = { ...(p.prefs || {}), notifyDays: v };
      send('setMyPrefs', { personId: S.meId, prefs: { notifyDays: v } }).then(() => toast('Сохранено')).catch(showErr);
    } }, [3, 7, 14, 30].map(d => h('option', { value: d, selected: d === days }, `${d} ${plural(d, ['день', 'дня', 'дней'])}`))));
  return [head('Уведомления', 'Что приходит в «Новое для вас» и на колокольчик. Сохраняется сразу'), table, hist];
}

function boards() {
  const lead = ['lead', 'moderator', 'superadmin'].includes(myAccess());
  return [
    head('Доски', 'Личные: меняются только у вас'),
    card(
      row('Колонки доски в «Моих задачах»', 'Свои колонки между обязательными «К выполнению», «В работе», «В ревью» и «Готово»',
        act('Настроить', () => import('./myboard.js').then(m => m.editColumns(() => toast('Сохранено')))), 'board'),
      lead && row('Шаблоны чеклистов', 'Готовые пункты для подзадач и этапов — «Из шаблона» в чеклисте · у лидов, PM и CEO',
        act('Настроить', () => import('./cltemplates.js').then(m => m.openTemplatesEditor())), 'checklist'),
      ['rm', 'superadmin'].includes(myAccess()) && row('Карточка релиза', 'Какие блоки показывать в карточке релиза · у RM',
        act('Настроить', () => import('./release.js').then(m => m.openReleaseCardSettings())), 'rocket')),
  ];
}

/* ---------- студия: приложения и релизы (редакторы — окнами) ---------- */

/** Превью набора под строкой настройки (53, 54): чипы с точкой цвета, серой — если цвета нет. */
const dotChips = items => items.length > 0 && h('span', { class: 'dot-chips' },
  items.map(([name, color]) => h('span', { class: 'dot-chip' }, h('i', { style: { background: color || 'var(--neutral-fill, #787C87)' } }), name)));

function appsSection() {
  const open = fn => () => import('./apps.js').then(m => m[fn]());
  const updTpl = (S.templates || []).filter(t => t.kind === 'update').length;
  return [
    head('Приложения', 'Общие для всей студии · настраивает CEO'),
    card(
      row('Статусы приложения', `${S.appStatuses.length} ${plural(S.appStatuses.length, ['статус', 'статуса', 'статусов'])} · порядок, цвет и смысл для автоматики`,
        act('Настроить', open('openStatusesEditor')), 'layers', dotChips(S.appStatuses.map(x => [x.name, x.color]))),
      row('Поля приложения', 'Ссылки и тексты на карточке приложения', act('Настроить', open('openFieldsEditor')), 'link',
        dotChips(S.appFields.map(x => [x.name]))),
      row('Шаблоны апдейтов', 'Название, описание, пункты и нужные этапы' + (updTpl ? ` · ${updTpl} ${plural(updTpl, ['шаблон', 'шаблона', 'шаблонов'])}` : ''),
        act('Настроить', open('openUpdateTemplates')), 'copy'),
      row('Инфо-лист', 'Ссылки по приложениям для выбранных людей, у каждого свои поля · ' + infoListCount(),
        act('Настроить', () => openInfoListsEditor(rerender)), 'link'),
      storeAutoRow(),
      storeManualRow()),
  ];
}

/**
 * Кнопка «Обновить» в блоке «Проверка App Store»: проверяет все ссылки сразу из браузера — с адреса человека,
 * с которого он же заходит в App Store Connect. По умолчанию скрыта; показ включает CEO, с предупреждением о риске.
 */
function storeManualRow() {
  const sw = h('input', { type: 'checkbox', class: 'switch', checked: !!S.storeManualCheck, 'aria-label': 'Кнопка «Обновить» в проверке App Store' });
  sw.onchange = () => {
    sw.disabled = true;
    send('setStoreManualCheck', { show: sw.checked })
      .then(r => { S.storeManualCheck = r.show; sw.disabled = false; toast(r.show ? 'Кнопка «Обновить» показана' : 'Кнопка «Обновить» скрыта'); })
      .catch(e => { sw.checked = !sw.checked; sw.disabled = false; showErr(e); });
  };
  return h('label', { class: 'prefs-row' }, h('span', { class: 'prefs-ic' }, icon('eye', 16)),
    h('span', { class: 'prefs-row-text' }, h('b', null, 'Кнопка «Обновить» в проверке App Store'),
      h('small', { class: 'muted' }, 'Проверяет все ссылки сразу, из браузера того, кто нажал. По умолчанию скрыта'),
      h('small', { class: 'prefs-risk' }, icon('alert', 13),
        'Риск: запросы идут с вашего IP — того же, с которого вы заходите в App Store Connect. Apple может связать этот адрес со списком ваших приложений. Безопаснее автопроверка: она идёт с сервера.')),
    sw);
}

/** Автопроверка ссылок App Store: работает в базе круглосуточно — 1 ссылка раз в 2 минуты, в случайном порядке. */
function storeAutoRow() {
  const sub = h('small', { class: 'muted' }, 'Загрузка…');
  const sw = h('input', { type: 'checkbox', class: 'switch', disabled: true, 'aria-label': 'Автопроверка App Store' });
  const ago = iso => { const m = Math.round((Date.now() - Date.parse(iso)) / 6e4); return m < 1 ? 'только что' : m < 60 ? `${m} мин назад` : m < 1440 ? `${Math.round(m / 60)} ч назад` : `${Math.round(m / 1440)} дн. назад`; };
  const draw = st => {
    sw.checked = st.on;
    sw.disabled = false;
    sub.textContent = !st.total ? 'Нет приложений со ссылкой на App Store'
      : st.on ? [`1 ссылка раз в ${st.everyMin} минуты, в случайном порядке, круглосуточно, с сервера (не с вашего адреса)`, `в этом круге ${st.checked} из ${st.total}`,
        st.lastAt && `последняя: ${st.lastApp}, ${ago(st.lastAt)}`].filter(Boolean).join(' · ')
        : `Выключена · ${st.total} ${plural(st.total, ['ссылка', 'ссылки', 'ссылок'])} на App Store. Включите — база будет проверять по 1 ссылке раз в 2 минуты, с сервера`;
  };
  sw.onchange = () => {
    sw.disabled = true;
    send('setStoreAutoCheck', { on: sw.checked }).then(st => { draw(st); toast(st.on ? 'Автопроверка App Store включена' : 'Автопроверка App Store выключена'); })
      .catch(e => { sw.checked = !sw.checked; sw.disabled = false; showErr(e); });
  };
  call('getStoreAutoCheck', {}).then(draw).catch(() => { sub.textContent = 'Не удалось загрузить'; });
  return h('label', { class: 'prefs-row' }, h('span', { class: 'prefs-ic' }, icon('refresh', 16)),
    h('span', { class: 'prefs-row-text' }, h('b', null, 'Автопроверка App Store'), sub), sw);
}

function releasesSection() {
  // поля релиза — с сервера; строка рисуется сразу, чипы — когда придут
  const fieldsN = h('span'), fieldsBox = h('span');
  call('getReleaseSettings', {}).then(cfg => {
    const f = cfg.fields || [];
    fieldsN.textContent = f.length ? ` · ${f.length} ${plural(f.length, ['поле', 'поля', 'полей'])}` : '';
    fill(fieldsBox, dotChips(f.map(x => [x.name, x.required ? 'var(--accent)' : ''])));
  }).catch(() => {});
  return [
    head('Релизы', 'Один набор на студию · настраивают CEO и RM'),
    card(
      row('Релизные поля и чеклист', h('span', null, 'Что заполнить перед «Отправить в Apple»', fieldsN), act('Настроить', () => import('./release.js').then(m => m.openReleaseSettings())), 'checklist', fieldsBox),
      ['rm', 'superadmin'].includes(myAccess()) && row('Карточка релиза', 'Какие блоки показывать · у RM', act('Настроить', () => import('./release.js').then(m => m.openReleaseCardSettings())), 'board')),
  ];
}
