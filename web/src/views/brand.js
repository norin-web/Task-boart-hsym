/**
 * Иконки брендов для полей и ссылок (Быстрый доступ, ссылки задачи, релиз): SVG с thesvg.org лежат в assets/brand-*.svg.
 * Бренд узнаём по названию / id поля. Однотонные логотипы (GitHub, Notion, Apple…) рисуются маской цветом текста —
 * видны и в светлой, и в тёмной теме. Нет бренда — обычная иконка.
 */
import { h, icon } from '../ui.js';
import appStore from '../assets/app-store.svg';

const files = import.meta.glob('../assets/brand-*.svg', { eager: true, query: '?url', import: 'default' });
const url = name => files[`../assets/brand-${name}.svg`] || '';

// порядок важен: «App Store Connect» раньше «App Store»
const RULES = [
  [/app ?store ?connect|\basc\b|appstoreconnect/, 'apple'],
  [/app ?store|apps\.apple|\bstore\b/, 'app-store'],
  [/figma/, 'figma'],
  [/drive|диск/, 'google-drive'],
  [/sheets|таблиц/, 'google-sheets'],
  [/docs\.google|google ?docs/, 'google-docs'],
  [/github|\bgit\b/, 'github'],
  [/notion/, 'notion'],
  [/revenue ?cat/, 'revenuecat'],
  [/amplitude/, 'amplitude'],
  [/firebase/, 'firebase'],
  [/slack/, 'slack'],
  [/jira/, 'jira'],
  [/linear/, 'linear'],
  [/miro/, 'miro'],
  [/dropbox/, 'dropbox'],
];
const MONO = new Set(['apple', 'github', 'notion', 'amplitude', 'miro']);

/** Бренд по тексту (название, id поля, ссылка) или ''. */
export function brandOf(...texts) {
  const s = texts.filter(Boolean).join(' ').toLowerCase();
  const hit = RULES.find(([re]) => re.test(s));
  return hit ? hit[1] : '';
}

/** Иконка бренда (img или маска) или запасная иконка fallback. */
export function brandIcon(brand, size = 15, fallback = 'link') {
  const src = brand === 'app-store' ? appStore : url(brand);
  if (!src) return icon(fallback, size);
  if (MONO.has(brand)) return h('span', { class: 'brand-ic mono', 'aria-hidden': 'true', style: { width: size + 'px', height: size + 'px', '--brand': `url("${src}")` } });
  return h('img', { class: 'brand-ic', src, alt: '', width: size, height: size });
}
