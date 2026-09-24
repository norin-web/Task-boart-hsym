/** UI-примитивы: DOM-хелпер, иконки, модалки, меню, тосты. */
import { PALETTE, colorFor, initials, safeUrl } from './state.js';

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
  layers: 'M12 2 2 7l10 5 10-5z M2 17l10 5 10-5 M2 12l10 5 10-5',
};
const DOTS = new Set(['more', 'grip', 'list']);

export function icon(name, size = 16) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', DOTS.has(name) ? '2.6' : '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', 'i');
  svg.setAttribute('aria-hidden', 'true');
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
  return h('span', { class: 'avatar' + (size ? ' ' + size : ''), title: p.name, style: { background: p.color || colorFor(p.id) } }, initials(p.name));
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

export function statusDot(color, size = 8) {
  return h('span', { class: 'dot', style: { background: color, width: size + 'px', height: size + 'px' } });
}

/* ---------- мобильная навигация ---------- */

export const toggleNav = () => document.body.classList.toggle('nav-open');
export const closeNav = () => document.body.classList.remove('nav-open');

export function topbar(left, right) {
  return h('header', { class: 'topbar' },
    h('button', { class: 'icon-btn hamburger', title: 'Меню', onclick: toggleNav }, icon('menu', 18)),
    h('div', { class: 'tb-left' }, left),
    h('div', { class: 'tb-right' }, right));
}

/* ---------- тосты ---------- */

export function toast(msg, opts = {}) {
  const el = h('div', { class: 'toast' + (opts.type ? ' ' + opts.type : ''), role: 'status' },
    h('span', null, msg),
    opts.action && h('button', { class: 'toast-action', onclick: () => { el.remove(); opts.action.run(); } }, opts.action.label));
  $('#toast-root').append(el);
  setTimeout(() => el.remove(), opts.duration || (opts.type === 'error' ? 6000 : 3000));
}

export function showErr(e) {
  console.error(e);
  toast((e && e.message) || String(e), { type: 'error' });
}

/* ---------- контекстное меню ---------- */

let openMenuEl = null;

export function closeMenu() {
  if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; }
}
export const isMenuOpen = () => !!openMenuEl;

/**
 * menu(anchorEl | {x, y}, items)
 * item: { label, icon, action, danger } | { sep: true } | { title } | Node
 */
export function menu(anchor, items) {
  closeMenu();
  const m = h('div', { class: 'menu', role: 'menu' }, items.filter(Boolean).map(it => {
    if (it instanceof Node) return it;
    if (it.sep) return h('div', { class: 'menu-sep' });
    if (it.title) return h('div', { class: 'menu-label' }, it.title);
    return h('button', {
      class: 'menu-item' + (it.danger ? ' danger' : ''), role: 'menuitem',
      onclick: e => { e.stopPropagation(); closeMenu(); it.action(); },
    }, it.icon && icon(it.icon, 15), it.label);
  }));
  m.addEventListener('click', e => e.stopPropagation());
  document.body.append(m);
  const r = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  const w = m.offsetWidth, hgt = m.offsetHeight;
  const left = anchor instanceof Element ? r.right - w : r.left;
  const top = r.bottom + 4 + hgt > window.innerHeight ? Math.max(8, r.top - hgt - 4) : r.bottom + 4;
  m.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, left)) + 'px';
  m.style.top = top + 'px';
  openMenuEl = m;
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
  const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' });
  const wrap = h('div', { class: 'modal-wrap', onmousedown: e => { if (e.target === wrap) close(); } }, box);
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    wrap.remove();
    document.removeEventListener('keydown', onKey, true);
    if (onClose) onClose();
  }
  function onKey(e) {
    if (e.key === 'Escape' && $('#modal-root').lastElementChild === wrap) { e.stopPropagation(); close(); }
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
    h('div', { class: 'modal-head' }, h('h2', null, title), h('button', { class: 'icon-btn', onclick: close, title: 'Закрыть' }, icon('x'))),
    h('div', { class: 'modal-body' }, body),
    h('div', { class: 'modal-foot' }, footLeft && h('div', { class: 'left' }, footLeft), btns));
  $('#modal-root').append(wrap);
  document.addEventListener('keydown', onKey, true);
  const first = box.querySelector('.modal-body input:not([type=checkbox]):not([type=color]), .modal-body textarea');
  if (first) first.focus();
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
