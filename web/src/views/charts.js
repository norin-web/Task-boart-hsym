/**
 * Графики аналитики (SVG без библиотек): «По статусам» — приложения по дням, «Юниты × статусы» — сколько приложений юнита на каждом статусе.
 * Цвета и шрифты — токены; подпись есть у каждой линии (цвет только помогает).
 */
import { h } from '../ui.js';

const NS = 'http://www.w3.org/2000/svg';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';

/** «Красивый» верх оси: 3, 6, 9, 12 … */
function niceMax(v) {
  const step = v <= 6 ? 1 : v <= 12 ? 3 : v <= 30 ? 5 : 10;
  return Math.max(step * 2, Math.ceil(v / step) * step);
}
const ticksFor = max => { const step = max <= 6 ? 1 : max <= 12 ? 3 : max <= 30 ? 5 : 10; return Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step); };
const fmtDay = iso => new Date(iso + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
const fmtTick = iso => new Date(iso + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');

/** Контейнер, который перерисовывается по ширине. */
function responsive(height, draw) {
  const box = h('div', { class: 'chart', style: { height: height + 'px' } });
  const tip = h('div', { class: 'chart-tip', hidden: true });
  box.append(tip);
  let w = 0;
  const render = () => {
    const nw = Math.floor(box.clientWidth);
    if (!nw || nw === w) return;
    w = nw;
    box.querySelector('svg')?.remove();
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', w); svg.setAttribute('height', height); svg.setAttribute('viewBox', `0 0 ${w} ${height}`);
    svg.setAttribute('role', 'img');
    box.prepend(svg);
    draw(svg, w, height, tip, box);
  };
  new ResizeObserver(render).observe(box);
  queueMicrotask(render);
  return box;
}

/** series: [{ id, label, values[], color, strong }]; days — подписи по оси X (YYYY-MM-DD). */
export function statusLines({ days, series, height = 240, aria = '' }) {
  const live = series.filter(s => s.values.some(Boolean));
  const maxV = niceMax(Math.max(1, ...live.flatMap(s => s.values)));
  const box = responsive(height, (svg, w, H, tip, host) => {
    const L = 34, R = 130, T = 14, B = 28;
    const iw = w - L - R, ih = H - T - B;
    const x = i => L + (days.length === 1 ? iw / 2 : (i / (days.length - 1)) * iw);
    const y = v => T + ih - (v / maxV) * ih;
    const grid = css('--border'), muted = css('--muted');
    let g = '';
    for (const t of ticksFor(maxV)) g += `<line x1="${L}" x2="${L + iw}" y1="${y(t)}" y2="${y(t)}" stroke="${grid}" stroke-dasharray="3 4"/><text x="${L - 10}" y="${y(t) + 4}" text-anchor="end" font-size="12" fill="${muted}">${t}</text>`;
    const step = Math.max(1, Math.round(days.length / 5));
    days.forEach((d, i) => { if (i % step === 0 || i === days.length - 1) g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="12" fill="${muted}">${esc(fmtTick(d))}</text>`; });
    // ступенчатые линии: число приложений меняется скачком в день события
    const path = s => s.values.map((v, i) => (i ? `H${x(i)}V${y(v)}` : `M${x(i)} ${y(v)}`)).join('');
    for (const s of [...live].sort((a, b) => !!a.strong - !!b.strong)) {
      g += `<path d="${path(s)}" fill="none" stroke="${s.color}" stroke-width="${s.strong ? 2.5 : 2}" stroke-linejoin="round" opacity="${s.strong ? 1 : .85}"/>`;
    }
    // подписи справа от последней точки; близкие разводим
    const ends = live.map(s => ({ s, y: y(s.values[s.values.length - 1]) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 22) ends[i].y = ends[i - 1].y + 22;
    for (const e of ends) {
      const txt = `${e.s.label} · ${e.s.values[e.s.values.length - 1]}`;
      const wd = Math.min(R - 12, txt.length * 6.6 + 18);
      g += `<g><rect x="${L + iw + 10}" y="${e.y - 11}" width="${wd}" height="22" rx="11" fill="${e.s.strong ? e.s.color : css('--surface-3')}"/><text x="${L + iw + 10 + wd / 2}" y="${e.y + 4}" text-anchor="middle" font-size="12" font-weight="600" fill="${e.s.strong ? css('--on-accent') : css('--text-2')}">${esc(txt)}</text></g>`;
    }
    g += '<g class="hv"></g>';
    svg.innerHTML = g;
    svg.setAttribute('aria-label', aria);
    const hv = svg.querySelector('.hv');
    const move = ev => {
      const r = svg.getBoundingClientRect();
      const px = ev.clientX - r.left;
      const i = Math.max(0, Math.min(days.length - 1, Math.round(((px - L) / iw) * (days.length - 1))));
      hv.innerHTML = `<line x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${T + ih}" stroke="${css('--text')}" stroke-dasharray="3 3"/>` +
        live.map(s => `<circle cx="${x(i)}" cy="${y(s.values[i])}" r="4" fill="${css('--surface')}" stroke="${s.color}" stroke-width="2"/>`).join('');
      tip.hidden = false;
      tip.replaceChildren(h('b', null, fmtDay(days[i])), ...live.map(s => h('span', { class: 'chart-row' }, h('i', { style: { background: s.color } }), h('em', null, s.values[i]), s.label)));
      const tw = tip.offsetWidth;
      tip.style.left = Math.max(4, Math.min(w - tw - 4, x(i) + 12)) + 'px';
      tip.style.top = '8px';
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerleave', () => { hv.innerHTML = ''; tip.hidden = true; });
  });
  return box;
}

/** Кривые юнитов по статусам: categories — названия статусов (ось X), units: [{ name, color, values[] }]. */
export function unitCurves({ categories, units, height = 240, aria = '' }) {
  const maxV = niceMax(Math.max(1, ...units.flatMap(u => u.values)));
  return responsive(height, (svg, w, H, tip) => {
    const L = 30, R = 12, T = 14, B = 30;
    const iw = w - L - R, ih = H - T - B;
    const n = categories.length;
    const x = i => L + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = v => T + ih - (v / maxV) * ih;
    const grid = css('--border'), muted = css('--muted');
    let g = '';
    for (const t of ticksFor(maxV)) g += `<line x1="${L}" x2="${L + iw}" y1="${y(t)}" y2="${y(t)}" stroke="${grid}" stroke-dasharray="3 4"/><text x="${L - 10}" y="${y(t) + 4}" text-anchor="end" font-size="12" fill="${muted}">${t}</text>`;
    categories.forEach((c, i) => { g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="12" fill="${muted}">${esc(c)}</text>`; });
    // плавная кривая через точки (Catmull-Rom → Безье)
    const curve = vals => {
      const pts = vals.map((v, i) => [x(i), y(v)]);
      let d = `M${pts[0][0]} ${pts[0][1]}`;
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
        d += `C${p1[0] + (p2[0] - p0[0]) / 6} ${Math.min(y(0), Math.max(T, p1[1] + (p2[1] - p0[1]) / 6))} ${p2[0] - (p3[0] - p1[0]) / 6} ${Math.min(y(0), Math.max(T, p2[1] - (p3[1] - p1[1]) / 6))} ${p2[0]} ${p2[1]}`;
      }
      return d;
    };
    for (const u of units) g += `<path d="${curve(u.values)}" fill="none" stroke="${u.color}" stroke-width="2.5" stroke-linecap="round"/>`;
    g += '<g class="hv"></g>';
    svg.innerHTML = g;
    svg.setAttribute('aria-label', aria);
    const hv = svg.querySelector('.hv');
    const move = ev => {
      const r = svg.getBoundingClientRect();
      const i = Math.max(0, Math.min(n - 1, Math.round(((ev.clientX - r.left - L) / iw) * (n - 1))));
      hv.innerHTML = `<rect x="${x(i) - 18}" y="${T}" width="36" height="${ih}" rx="8" fill="${css('--surface-3')}" opacity=".6"/>` +
        units.map(u => `<circle cx="${x(i)}" cy="${y(u.values[i])}" r="4" fill="${css('--surface')}" stroke="${u.color}" stroke-width="2"/>`).join('');
      tip.hidden = false;
      tip.replaceChildren(h('b', null, categories[i]), ...units.map(u => h('span', { class: 'chart-row' }, h('i', { style: { background: u.color } }), h('em', null, u.values[i]), u.name)));
      const tw = tip.offsetWidth;
      tip.style.left = Math.max(4, Math.min(w - tw - 4, x(i) + 22)) + 'px';
      tip.style.top = '8px';
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerleave', () => { hv.innerHTML = ''; tip.hidden = true; });
  });
}

/** Сколько записей было открыто в каждый из последних days дней: создана раньше, закрыта позже. */
export function openSeries(items, days = 14) {
  const end = Date.now();
  return Array.from({ length: days }, (_, i) => {
    const at = end - (days - 1 - i) * 864e5;
    return items.filter(x => Date.parse(x.createdAt) <= at && !(x.doneAt && Date.parse(x.doneAt) <= at)).length;
  });
}

/** Мини-график на плитке (A09, C01): только линия, без осей. */
export function sparkline(values, { width = 96, height = 28 } = {}) {
  const max = Math.max(...values), min = Math.min(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1) * width).toFixed(1)},${(height - 3 - (max === min ? 0.5 : (v - min) / (max - min)) * (height - 6)).toFixed(1)}`).join(' ');
  const box = document.createElement('div');
  box.className = 'cs-spark';
  box.setAttribute('aria-hidden', 'true');
  box.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return box;
}
