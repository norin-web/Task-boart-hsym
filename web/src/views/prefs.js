/**
 * Настройки (#/settings?tab=…) — всё в одном месте. Слева разделы:
 *   Личное (у всех): профиль, внешний вид, уведомления, доски;
 *   Студия: CEO и PM — люди и доступы, юниты, автоматизации, журнал; CEO — приложения; CEO и RM — релизы.
 * Раздел студии рисует admin.js (renderStudio), редакторы приложений и релизов открываются своими окнами.
 */
import { S, LS, me, isStaff, isSuper, myAccess, ACCESS_LABELS, deptById } from '../state.js';
import { $, h, icon, avatar, topbar, fill, showErr, toast } from '../ui.js';
import { send } from '../api.js';
import { link, currentView, rerender } from '../router.js';
import { mode, supabase } from '../data.js';
import { THEME_LIST, setTheme, resetLocal } from './sidebar.js';
import { openMyProfile, openActAs, addPersonDialog } from './people.js';
import { renderStudio, STUDIO_TABS } from './admin.js';
import { openCreateUnit } from './units.js';

const PERSONAL = [
  ['profile', 'Профиль', 'user'],
  ['look', 'Внешний вид', 'sun'],
  ['notify', 'Уведомления', 'bell'],
  ['boards', 'Доски', 'board'],
];

/** Разделы студии, доступные вошедшему. */
const studio = () => [
  ...(isStaff() ? STUDIO_TABS : []),
  isSuper() && ['apps', 'Приложения', 'app'],
  (isSuper() || myAccess() === 'rm') && ['releases', 'Релизы', 'rocket'],
].filter(Boolean);

/** События уведомлений: группа → виды (prefs.notifyOff — выключенные виды). */
const NOTIFY = [
  ['Назначили на меня', 'Новая задача или этап на вас', ['assigned', 'handoff']],
  ['Ревью', 'Прислали на ревью, вернули, приняли', ['review', 'returned', 'approved']],
  ['Упоминания', 'Отметили через @ в комментарии или описании', ['mention']],
  ['Можно начинать', 'Предыдущие этапы закрыты', ['unblocked']],
  ['Сроки', 'Срок сегодня или завтра, просрочено', ['due_soon', 'overdue']],
  ['Релизы', 'Вышло в App Store, реджект Apple', ['store_live', 'store_reject']],
];

export function renderPrefs(tab) {
  const all = [...PERSONAL, ...studio()];
  if (!all.some(t => t[0] === tab) && tab !== 'trash') tab = 'profile';
  const navTab = tab === 'trash' ? 'units' : tab;
  const key = currentView();
  const body = h('div', { class: 'prefs-body' + (PERSONAL.some(t => t[0] === tab) ? ' narrow' : '') });
  const item = ([id, label, ic]) => link({ view: 'settings', tab: id }, { class: 'prefs-tab' + (id === navTab ? ' on' : '') }, icon(ic, 15), label);
  fill($('#main'),
    topbar([h('h1', { class: 'screen-title' }, 'Настройки')],
      [isSuper() && (tab === 'units' || tab === 'trash') && h('button', { class: 'btn primary', onclick: openCreateUnit }, icon('plus', 15), h('span', { class: 'btn-label' }, 'Юнит')),
        tab === 'automations' && h('button', { class: 'btn primary tpl-add' }, icon('plus', 15), h('span', { class: 'btn-label' }, 'Шаблон')),
        tab === 'people' && h('button', { class: 'btn primary people-add', onclick: () => addPersonDialog(() => rerender()) }, icon('plus', 15), h('span', { class: 'btn-label' }, 'Человек'))]),
    h('div', { class: 'view-body prefs-page' },
      h('nav', { class: 'prefs-nav', 'aria-label': 'Разделы настроек' },
        h('div', { class: 'prefs-sec' }, 'Личное'), PERSONAL.map(item),
        studio().length > 0 && [h('div', { class: 'prefs-sec' }, 'Студия'), studio().map(item)]),
      body));

  const SECTIONS = { profile, look, notify, boards, apps: appsSection, releases: releasesSection };
  if (SECTIONS[tab]) fill(body, SECTIONS[tab]());
  else renderStudio(body, tab, key);
}

/* ---------- общее ---------- */

const head = (title, sub) => h('div', { class: 'prefs-head' }, h('h2', null, title), sub && h('p', { class: 'muted' }, sub));
/** Действие строки (act): вся строка — кнопка, при наведении подсветка и стрелка; без кнопок у правого края. */
const act = (label, onclick, { danger = false } = {}) => ({ label, onclick, danger });
/** Строка настройки: название, пояснение; action — act(…) или свой элемент справа (переключатель). */
const row = (title, sub, action) => {
  const text = h('span', { class: 'prefs-row-text' }, h('b', null, title), sub && h('small', { class: 'muted' }, sub));
  return action && action.onclick
    ? h('button', { class: 'prefs-row click' + (action.danger ? ' danger' : ''), type: 'button', 'aria-label': `${title}: ${action.label}`, onclick: action.onclick }, text, h('span', { class: 'prefs-go' }, icon('chevron', 15)))
    : h('div', { class: 'prefs-row' }, text, action);
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
      mode === 'local' && row('Локальный режим', 'Данные хранятся только в этом браузере', null),
      mode === 'local' && row('Войти как…', 'Посмотреть Tasks глазами другого человека', act('Выбрать', openActAs)),
      mode === 'local' && row('Очистить локальную базу', 'Стереть всё и начать с чистой базы', act('Стереть', resetLocal, { danger: true })),
      mode === 'supabase' && row('Выйти', email, act('Выйти', () => supabase.auth.signOut(), { danger: true }))),
  ];
}

function look() {
  const box = h('div', { class: 'theme-pick', role: 'radiogroup', 'aria-label': 'Тема' });
  const draw = () => fill(box, Object.entries(THEME_LIST).map(([id, [label, ic]]) => {
    const on = LS.get('theme', 'auto') === id;
    return h('button', { class: 'theme-opt' + (on ? ' on' : ''), role: 'radio', 'aria-checked': String(on), onclick: () => { setTheme(id); draw(); } },
      h('span', { class: 'theme-swatch t-' + id }), icon(ic, 15), label.replace('Тема: ', ''));
  }));
  draw();
  return [head('Внешний вид', 'Тема хранится в этом браузере'), card(box)];
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
      h('span', { role: 'columnheader' }, 'В Tasks'), h('span', { role: 'columnheader', class: 'muted', title: 'Скоро' }, 'Почта'), h('span', { role: 'columnheader', class: 'muted', title: 'Скоро' }, 'Telegram')),
    NOTIFY.map(([title, sub, kinds]) => {
      const on = !kinds.every(k => off.includes(k));
      return h('div', { class: 'nt-row', role: 'row' },
        h('span', { class: 'prefs-row-text', role: 'cell' }, h('b', null, title), h('small', { class: 'muted' }, sub)),
        h('span', { role: 'cell' }, h('input', { type: 'checkbox', checked: on, 'aria-label': title + ' — в Tasks',
          onchange: e => { off = e.target.checked ? off.filter(k => !kinds.includes(k)) : [...new Set([...off, ...kinds])]; save(); draw(); } })),
        h('span', { role: 'cell' }, h('input', { type: 'checkbox', disabled: true, title: 'Скоро', 'aria-label': title + ' — почта' })),
        h('span', { role: 'cell' }, h('input', { type: 'checkbox', disabled: true, title: 'Скоро', 'aria-label': title + ' — Telegram' })));
    }));
  draw();
  return [head('Уведомления', 'Что приходит в «Новое для вас» и на колокольчик. Почта и Telegram — скоро.'), table];
}

function boards() {
  const lead = ['lead', 'moderator', 'superadmin'].includes(myAccess());
  return [
    head('Доски'),
    card(
      row('Колонки «Моей доски»', 'Свои колонки между обязательными «К выполнению», «В работе», «В ревью» и «Готово»',
        act('Настроить', () => import('./myboard.js').then(m => m.editColumns(() => toast('Сохранено'))))),
      lead && row('Шаблоны чеклистов', 'Готовые пункты для подзадач и этапов — «Из шаблона» в чеклисте',
        act('Настроить', () => import('./cltemplates.js').then(m => m.openTemplatesEditor()))),
      myAccess() === 'rm' && row('Карточка релиза', 'Какие блоки показывать в карточке релиза',
        act('Настроить', () => import('./release.js').then(m => m.openReleaseCardSettings())))),
  ];
}

/* ---------- студия: приложения и релизы (редакторы — окнами) ---------- */

function appsSection() {
  const open = fn => () => import('./apps.js').then(m => m[fn]());
  return [
    head('Приложения', 'Общие для всей студии'),
    card(
      row('Статусы приложения', 'В разработке, Релиз, Ревью Apple, В сторе, Реджект…', act('Настроить', open('openStatusesEditor'))),
      row('Поля приложения', 'Ссылки и тексты: App Store, App Store Connect, Figma…', act('Настроить', open('openFieldsEditor'))),
      row('Шаблоны апдейтов', 'Название, описание, пункты и нужные этапы', act('Настроить', open('openUpdateTemplates')))),
  ];
}

function releasesSection() {
  return [
    head('Релизы', 'Один набор на студию — настраивают CEO и RM'),
    card(
      row('Релизные поля и чеклист', 'Что заполнить перед «Отправить в Apple»', act('Настроить', () => import('./release.js').then(m => m.openReleaseSettings()))),
      myAccess() === 'rm' && row('Карточка релиза', 'Какие блоки показывать', act('Настроить', () => import('./release.js').then(m => m.openReleaseCardSettings())))),
  ];
}
