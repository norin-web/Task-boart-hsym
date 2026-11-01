/** UI-примитивы: DOM-хелпер, иконки, модалки, меню, тосты. */
import { avatarSrc } from './avatars.js';
import { PACK } from './icons.js';
import { PALETTE, colorFor, initials, safeUrl, isOnline, presenceText, personById } from './state.js';

export const $ = (sel, root) => (root || document).querySelector(sel);

/**
 * h('div', { class, style, dataset, onclick, ... }, ...children)
 * value/checked ставятся после детей (чтобы select успел получить option'ы).
 */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  const later = {};
  for (const k in attrs || {}) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') for (const p in v) p.startsWith('--') ? el.style.setProperty(p, v[p]) : (el.style[p] = v[p]);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value' || k === 'checked') later[k] = v;
    else if (k === 'disabled' || k === 'hidden' || k === 'selected' || k === 'autofocus') el[k] = true;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  for (const k in later) el[k] = later[k];
  return el;
}

/** Заменить содержимое элемента; false/null/undefined пропускаются (в отличие от replaceChildren). */
export function fill(el, ...kids) {
  el.replaceChildren();
  return append(el, kids);
}

export function append(el, kids) {
  kids.flat(Infinity).forEach(c => {
    if (c == null || c === false || c === true) return;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  });
  return el;
}

/* ---------- иконки (контурные, 24×24) ---------- */

const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3',
  plus: 'M12 5v14 M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  settings: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M12 1v2 M12 21v2 M4.22 4.22l1.42 1.42 M18.36 18.36l1.42 1.42 M1 12h2 M21 12h2 M4.22 19.78l1.42-1.42 M18.36 5.64l1.42-1.42',
  moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
  monitor: 'M3 4h18v12H3z M8 20h8 M12 16v4',
  board: 'M4 4h4v16H4z M10 4h4v10h-4z M16 4h4v13h-4z',
  list: 'M8 6h13 M8 12h13 M8 18h13 M3.5 6h.01 M3.5 12h.01 M3.5 18h.01',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  x: 'M18 6 6 18 M6 6l12 12',
  calendar: 'M4 5h16v16H4z M16 3v4 M8 3v4 M4 10h16',
  message: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  checklist: 'M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  archive: 'M21 8v13H3V8 M1 3h22v5H1z M10 12h4',
  trash: 'M3 6h18 M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6 M10 11v6 M14 11v6 M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
  eye: 'M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  eyeOff: 'M9.9 4.24A9 9 0 0 1 12 4c7 0 11 8 11 8a18 18 0 0 1-2.16 3.19 M6.6 6.6A18 18 0 0 0 1 12s4 8 11 8a9 9 0 0 0 5.4-1.6 M14.1 14.1a3 3 0 1 1-4.2-4.2 M1 1l22 22',
  panelSide: 'M3 4h18v16H3z M14 4v16',
  panelCenter: 'M3 4h18v16H3z M7 8h10v8H7z',
  copy: 'M9 9h12v12H9z M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  arrow: 'M5 12h14 M12 5l7 7-7 7',
  back: 'M19 12H5 M12 19l-7-7 7-7',
  menu: 'M3 6h18 M3 12h18 M3 18h18',
  filter: 'M22 3H2l8 9.46V19l4 2v-8.54z',
  alert: 'M12 8v4 M12 16h.01 M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2',
  edit: 'M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z',
  grip: 'M9 5h.01 M9 12h.01 M9 19h.01 M15 5h.01 M15 12h.01 M15 19h.01',
  send: 'M22 2 11 13 M22 2l-7 20-4-9-9-4z',
  circle: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
  progress: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 2a10 10 0 0 1 0 20z',
  done: 'M22 11.08V12a10 10 0 1 1-5.93-9.14 M22 4 12 14.01l-3-3',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  keyboard: 'M3 6h18v12H3z M7 10h.01 M11 10h.01 M15 10h.01 M7 14h10',
  rows: 'M3 4h18v6H3z M3 14h18v6H3z',
  chevron: 'M6 9l6 6 6-6',
  prio: 'M7 11l5-5 5 5 M7 17l5-5 5 5',
  arrowUpRight: 'M7 17 17 7 M8 7h9v9',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  figma: 'M5 5.5A3.5 3.5 0 0 1 8.5 2H12v7H8.5A3.5 3.5 0 0 1 5 5.5z M12 2h3.5a3.5 3.5 0 1 1 0 7H12z M12 12.5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 1 1-7 0z M5 19.5A3.5 3.5 0 0 1 8.5 16H12v3.5a3.5 3.5 0 1 1-7 0z M5 12.5A3.5 3.5 0 0 1 8.5 9H12v7H8.5A3.5 3.5 0 0 1 5 12.5z',
  github: 'M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4 M9 18c-4.51 2-5-2-7-2',
  drive: 'M8 3h8l6 11-4 7H6l-4-7z M2 14h20 M8 3l7 11 M16 3 9 14 M6 21l3-7',
  meta: 'M12 2H2v10l9.3 9.3a1 1 0 0 0 1.4 0l8.6-8.6a1 1 0 0 0 0-1.4z M7 7h.01',
  layers: 'M12 2 2 7l10 5 10-5z M2 17l10 5 10-5 M2 12l10 5 10-5',
  app: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M8 12h8 M12 8v8',
  refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8 M21 3v5h-5',
  tree: 'M6 3v18 M6 8h8 M6 16h8 M14 5h6v6h-6z M14 13h6v6h-6z',
  lock: 'M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z M8 11V7a4 4 0 0 1 8 0v4',
  rocket: 'M5 15c-1.5 1.3-2 5-2 5s3.7-.5 5-2 M9 15l-3-3c1-4 5-9 13-9 0 8-5 12-9 13z M14.5 9.5h.01',
  code: 'M16 18l6-6-6-6 M8 6l-6 6 6 6',
  zap: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.94 1.94 0 0 0 3.4 0',
  chart: 'M3 3v18h18 M7 16v-4 M12 16V8 M17 16v-7',
};
const DOTS = new Set(['more', 'grip', 'list']);

export function icon(name, size = 16) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('class', 'i');
  svg.setAttribute('aria-hidden', 'true');
  const drawn = PACK[name];
  if (drawn) {
    // пак Unicons: заливка currentColor
    svg.setAttribute('fill', 'currentColor');
    for (const d of drawn) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.append(p); }
    return svg;
  }
  // знаки без пары в паке (логотипы сервисов и т. п.) — прежние линии
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', DOTS.has(name) ? '2.6' : '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', ICONS[name] || ICONS.circle);
  svg.append(path);
  return svg;
}

/* ---------- мелочи ---------- */

export function autosize(el) {
  const fit = () => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px'; };
  el.addEventListener('input', fit);
  requestAnimationFrame(fit);
  return el;
}

export function field(label, control, hint) {
  return h('div', { class: 'field' }, h('label', null, label), control, hint && h('div', { class: 'hint' }, hint));
}

export function avatar(p, size) {
  if (!p) return h('span', { class: 'avatar empty' + (size ? ' ' + size : ''), title: 'Не назначено' }, icon('user', size === 'sm' ? 11 : 13));
  const src = avatarSrc(p);
  return h('span', {
    class: 'avatar' + (size ? ' ' + size : '') + (isOnline(p) ? ' online' : '') + (src ? ' pic' : ''), title: p.name + ' · ' + presenceText(p),
    dataset: { pid: p.id }, style: { '--av': p.color || colorFor(p.id) },
  }, src ? h('img', { src, alt: '', loading: 'lazy', decoding: 'async' }) : initials(p.name));
}

/** Обновить онлайн-точки на уже нарисованных аватарах (без перерисовки страницы). */
export function refreshPresence() {
  document.querySelectorAll('.avatar[data-pid]').forEach(el => {
    const p = personById(el.dataset.pid);
    if (!p) return;
    el.classList.toggle('online', isOnline(p));
    el.title = p.name + ' · ' + presenceText(p);
  });
}

/** Текст с кликабельными http(s)-ссылками. */
export function linkify(text) {
  const out = [];
  let last = 0;
  String(text).replace(/https?:\/\/[^\s<>"']+/g, (m, i) => {
    out.push(text.slice(last, i));
    const url = m.replace(/[),.;:!?]+$/, '');
    out.push(h('a', { href: safeUrl(url), target: '_blank', rel: 'noopener noreferrer', onclick: e => e.stopPropagation() }, url));
    last = i + url.length;
    return m;
  });
  out.push(text.slice(last));
  return out;
}

/** Значок статуса: форма + цвет, подпись рядом всегда словом (цвет только помогает). */
const ST_ICON = { todo: ['circle', 'var(--text-2)'], progress: ['progress', 'var(--info-fill)'], review: ['eye', 'var(--review)'], done: ['done', 'var(--accent-text)'] };
export function statusIcon(kind, size = 16) {
  const [name, color] = ST_ICON[kind] || ST_ICON.todo;
  return h('span', { class: 'st-ic', style: { color } }, icon(name, size));
}
export function statusDot(color, size = 8) {
  return h('span', { class: 'dot', style: { background: color, width: size + 'px', height: size + 'px' } });
}

/* ---------- мобильная навигация ---------- */

export const toggleNav = () => document.body.classList.toggle('nav-open');
export const closeNav = () => document.body.classList.remove('nav-open');

/** Колокольчик уведомлений в шапке каждого экрана — ставит sidebar.js (без обратного импорта во views). */
let bellFactory = null;
export const setBell = fn => { bellFactory = fn; };

/** Кнопка «Назад» (на уровень выше по иерархии экранов) — ставит router.js. */
let backFactory = null;
export const setBack = fn => { backFactory = fn; };

export function topbar(left, right) {
  return h('header', { class: 'topbar' },
    h('button', { class: 'icon-btn hamburger', title: 'Меню', onclick: toggleNav }, icon('menu', 18)),
    backFactory && backFactory(),
    h('div', { class: 'tb-left' }, left),
    h('div', { class: 'tb-right' }, bellFactory && bellFactory(), right));
}

/* ---------- тосты ---------- */

export function toast(msg, opts = {}) {
  const el = h('div', { class: 'toast' + (opts.type ? ' ' + opts.type : ''), role: opts.type === 'error' ? 'alert' : 'status' },
    h('span', null, msg),
    opts.action && h('button', { class: 'toast-action', onclick: () => { el.remove(); opts.action.run(); } }, opts.action.label));
  $('#toast-root').append(el);
  setTimeout(() => el.remove(), opts.duration || (opts.type === 'error' ? 6000 : 3000));
}

export function showErr(e) {
  const form = /^DEV_FORM:(.+)$/.exec((e && e.message) || '');
  // без опросника этап iOS не закрыть — вместо ошибки открываем его (views/devquiz.js)
  if (form) return document.dispatchEvent(new CustomEvent('tasks:devform', { detail: form[1] }));
  console.error(e);
  toast((e && e.message) || String(e), { type: 'error' });
}

/* ---------- контекстное меню ---------- */

let openMenuEl = null;
let menuAnchor = null;

/** Меню стоит на экране (position: fixed) — прокрутили страницу под ним, закрываем, чтобы не «отрывалось» от кнопки. */
function onPageScroll(e) {
  if (!openMenuEl || (e.target instanceof Node && openMenuEl.contains(e.target))) return;
  // печатают в поле меню (поиск в фильтре) — клавиатура телефона двигает страницу, меню не закрываем
  if (openMenuEl.contains(document.activeElement) && document.activeElement.matches('input, textarea')) return;
  closeMenu();
}
document.addEventListener('scroll', onPageScroll, true);

export function closeMenu() {
  document.removeEventListener('click', closeMenu); // иначе следующий клик закроет только что открытое меню
  if (!openMenuEl) return;
  const hadFocus = openMenuEl.contains(document.activeElement);
  openMenuEl.remove(); openMenuEl = null;
  if (hadFocus && menuAnchor && menuAnchor.isConnected) menuAnchor.focus();  // фокус возвращается на кнопку меню
  menuAnchor = null;
}
export const isMenuOpen = () => !!openMenuEl;

/**
 * menu(anchorEl | {x, y}, items)
 * item: { label, icon, action, danger } | { sep: true } | { title } | Node
 */
export function menu(anchor, items, { cls = '', align = 'right' } = {}) {
  closeMenu();
  const m = h('div', { class: 'menu' + (cls ? ' ' + cls : ''), role: 'menu' }, items.filter(Boolean).map(it => {
    if (it instanceof Node) return it;
    if (it.sep) return h('div', { class: 'menu-sep' });
    if (it.title) return h('div', { class: 'menu-label' }, it.title);
    return h('button', {
      class: 'menu-item' + (it.danger ? ' danger' : ''), role: 'menuitem',
      onclick: e => { e.stopPropagation(); closeMenu(); it.action(); },
    }, it.icon && icon(it.icon, 15), it.label);
  }));
  m.addEventListener('click', e => e.stopPropagation());
  // клавиатура: стрелки ходят по пунктам, Home/End — к крайним
  m.addEventListener('keydown', e => {
    const items = [...m.querySelectorAll('button:not(:disabled)')];
    const i = items.indexOf(document.activeElement);
    const go = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key];
    if (go === undefined || !items.length) return;
    e.preventDefault();
    items[(go + items.length) % items.length].focus();
  });
  document.body.append(m);
  const r = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  const w = m.offsetWidth, hgt = m.offsetHeight;
  const left = anchor instanceof Element && align === 'right' ? r.right - w : r.left;
  const top = r.bottom + 4 + hgt > window.innerHeight ? Math.max(8, r.top - hgt - 4) : r.bottom + 4;
  m.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, left)) + 'px';
  m.style.top = top + 'px';
  openMenuEl = m;
  menuAnchor = anchor instanceof Element ? anchor : null;
  // открыто с клавиатуры — фокус на первый пункт
  if (menuAnchor && menuAnchor.matches(':focus-visible')) { const first = m.querySelector('button:not(:disabled)'); if (first) first.focus(); }
  setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 0);
  return m;
}

/* ---------- модалки ---------- */

export const isModalOpen = () => $('#modal-root').children.length > 0;

/**
 * modal({ title, body, actions, wide, footLeft, onClose })
 * action: { label, primary, danger, action(close) } — без action кнопка просто закрывает.
 */
export function modal({ title, body, actions, wide, footLeft, onClose }) {
  const titleId = 'dlg-' + Math.random().toString(36).slice(2, 8);
  const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId });
  const opener = document.activeElement;
  const wrap = h('div', { class: 'modal-wrap', onmousedown: e => { if (e.target === wrap) close(); } }, box);
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    wrap.remove();
    document.removeEventListener('keydown', onKey, true);
    if (opener && opener.isConnected && !isModalOpen()) opener.focus();
    if (onClose) onClose();
  }
  function onKey(e) {
    if ($('#modal-root').lastElementChild !== wrap) return;
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    // Tab не уходит из диалога на страницу под ним
    if (e.key === 'Tab') {
      const f = [...box.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.offsetParent);
      if (!f.length) return;
      const [a, z] = [f[0], f[f.length - 1]];
      if (!box.contains(document.activeElement)) { e.preventDefault(); a.focus(); }
      else if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    }
  }
  const btns = (actions || [{ label: 'Закрыть' }]).map(a => h('button', {
    class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger solid' : ''),
    onclick: async () => {
      if (!a.action) return close();
      btns.forEach(b => { b.disabled = true; });
      try { await a.action(close); } catch (e) { showErr(e); }
      btns.forEach(b => { b.disabled = false; });
    },
  }, a.label));
  box.append(
    h('div', { class: 'modal-head' }, h('h2', { id: titleId }, title), h('button', { class: 'icon-btn', onclick: close, title: 'Закрыть' }, icon('x'))),
    h('div', { class: 'modal-body' }, body),
    h('div', { class: 'modal-foot' }, footLeft && h('div', { class: 'left' }, footLeft), btns));
  $('#modal-root').append(wrap);
  document.addEventListener('keydown', onKey, true);
  const first = box.querySelector('.modal-body input:not([type=checkbox]):not([type=color]), .modal-body textarea');
  // фокус в диалог: первое поле, иначе основная кнопка; у опасного действия — «Отмена», чтобы Enter не удалил случайно
  const target = first || box.querySelector('.modal-foot .btn.primary') || box.querySelector('.modal-foot .btn');
  if (target) target.focus();
  // Enter в однострочном поле = основная кнопка
  box.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && e.target.matches('input:not([type=checkbox])')) {
      const primary = box.querySelector('.modal-foot .btn.primary, .modal-foot .btn.danger');
      if (primary) { e.preventDefault(); primary.click(); }
    }
  });
  return close;
}

export function confirmDlg(text, { ok = 'OK', cancel = 'Отмена', danger = false, title = 'Подтвердите' } = {}) {
  return new Promise(resolve => {
    let result = false;
    modal({
      title,
      body: h('p', { style: { margin: 0, lineHeight: 1.55 } }, text),
      onClose: () => resolve(result),
      actions: [
        { label: cancel },
        { label: ok, primary: !danger, danger, action: close => { result = true; close(); } },
      ],
    });
  });
}

export function promptDlg(title, label, value = '') {
  return new Promise(resolve => {
    const inp = h('input', { class: 'inp', value });
    let result = null;
    modal({
      title,
      body: field(label, inp),
      onClose: () => resolve(result),
      actions: [
        { label: 'Отмена' },
        { label: 'Сохранить', primary: true, action: close => { result = inp.value.trim() || null; close(); } },
      ],
    });
    inp.select();
  });
}

/** Выбор цвета из палитры. auto — добавить вариант «Авто» (значение ''), autoColor — как он выглядит. */
export function colorPicker(initial, { auto = false, autoColor = '', onChange } = {}) {
  let value = initial;
  const el = h('div', { class: 'colors' });
  const pick = c => { value = c; draw(); if (onChange) onChange(c); };
  const draw = () => fill(el,
    auto && h('button', {
      type: 'button', class: 'swatch auto' + (!value ? ' on' : ''), title: 'Автоматически', style: { background: autoColor || 'var(--surface-3)' },
      onclick: () => pick(''),
    }, 'A'),
    PALETTE.map(c => h('button', {
      type: 'button', class: 'swatch' + (c === value ? ' on' : ''), style: { background: c }, title: c,
      onclick: () => pick(c),
    })));
  draw();
  return { el, value: () => value };
}

/* ---------- приоритет: шевроны как в Jira ---------- */

const PRIO_SHAPES = {
  up2: 'M6 12.5l6-5.5 6 5.5 M6 18l6-5.5 6 5.5',
  up: 'M6 15l6-6 6 6',
  equal: 'M6 9.5h12 M6 14.5h12',
  down: 'M6 9l6 6 6-6',
  down2: 'M6 6l6 5.5 6-5.5 M6 11.5l6 5.5 6-5.5',
};
/** Форма по названию варианта (Low / Medium / High / Critical, по-русски тоже), иначе — по месту в списке. */
function prioShape(name, i, n) {
  const s = String(name || '').toLowerCase();
  if (/lowest|минимал|очень низ/.test(s)) return 'down2';
  if (/critical|highest|urgent|blocker|крит|срочн|блок/.test(s)) return 'up2';
  if (/low|низ/.test(s)) return 'down';
  if (/medium|normal|сред|обыч/.test(s)) return 'equal';
  if (/high|выс/.test(s)) return 'up';
  const k = n > 1 ? i / (n - 1) : 1;
  return k >= .99 ? 'up2' : k > .5 ? 'up' : k >= .34 ? 'equal' : 'down';
}
/** Значок приоритета: шеврон(ы) цветом варианта; opt — { name, color }, i / n — место в списке вариантов. */
export function prioMark(opt, i, n, size = 16) {
  if (!opt) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', PRIO_SHAPES[prioShape(opt.name, i, n)]);
  svg.append(path);
  return h('span', { class: 'prio-mark', style: { color: opt.color }, title: 'Приоритет: ' + opt.name, role: 'img', 'aria-label': 'Приоритет: ' + opt.name }, svg);
}

/**
 * Выбор приоритета (вместо нативного select): кнопка «шеврон + название», по клику — список вариантов с шевронами,
 * сверху самый высокий. options — варианты по порядку от низкого к высокому ({ id, name, color }).
 * У элемента есть .value — как у select, чтобы формы читали значение одинаково.
 */
export function prioSelect(options, value, onChange, { disabled = false, empty = 'Без приоритета' } = {}) {
  let cur = value || '';
  const btn = h('button', { type: 'button', class: 'inp prio-select', disabled, 'aria-haspopup': 'menu', 'aria-label': 'Приоритет' });
  const paint = () => {
    const i = options.findIndex(o => o.id === cur);
    fill(btn, i >= 0 ? [prioMark(options[i], i, options.length, 15), h('span', null, options[i].name)] : h('span', { class: 'muted' }, empty),
      h('span', { class: 'prio-select-chev' }, icon('chevron', 14)));
  };
  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (disabled) return;
    const pick = id => { cur = id; paint(); if (onChange) onChange(id); };
    menu(btn, [
      ...options.map((o, i) => ({ o, i })).reverse().map(({ o, i }) => h('button', {
        class: 'menu-item' + (o.id === cur ? ' on' : ''), role: 'menuitemradio', 'aria-checked': String(o.id === cur),
        onclick: () => { closeMenu(); pick(o.id); },
      }, prioMark(o, i, options.length, 15), o.name, o.id === cur && h('span', { class: 'spacer' }), o.id === cur && icon('check', 14))),
      { sep: true },
      h('button', { class: 'menu-item' + (!cur ? ' on' : ''), role: 'menuitemradio', 'aria-checked': String(!cur), onclick: () => { closeMenu(); pick(''); } },
        h('span', { class: 'prio-mark muted' }, icon('x', 14)), empty),
    ]);
  });
  Object.defineProperty(btn, 'value', { get: () => cur, set: v => { cur = v || ''; paint(); } });
  paint();
  return btn;
}

/** Загрузка страницы: серые блоки вместо спиннера, страница появляется целиком (G02, баг #25). */
export const skeleton = () => h('div', { class: 'skel', role: 'status', 'aria-label': 'Загрузка' }, h('i', { class: 'skel-t' }), h('i'), h('i'), h('i', { class: 'skel-s' }));

/** Пустой блок дашборда (макет 61): иконка в круге и одна строка. ok — хороший итог: зелёная галочка. */
export function emptyBlock(text, { ok = false, ic = 'circle', sub = '' } = {}) {
  return h('div', { class: 'card-box empty-block' + (ok ? ' ok' : '') },
    h('span', { class: 'eb-ic' }, icon(ok ? 'check' : ic, 18)), h('b', null, text), sub && h('span', { class: 'eb-sub' }, sub));
}
