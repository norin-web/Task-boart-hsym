/**
 * «@» в комментарии и описании: после «@» — список людей юнита задачи, CEO и RM (фильтр по набранному);
 * ↑/↓ — выбор, Enter или Tab — вставить «@Имя Фамилия», Esc — закрыть. Отмеченным база шлёт уведомление (notify_mention).
 */
import { S, unitById } from '../state.js';
import { h, avatar, fill } from '../ui.js';

/** Кого можно отметить в задаче юнита unitId. */
export function mentionPeople(unitId) {
  const members = new Set(S.board && S.board.unit.id === unitId ? S.board.members.map(m => m.personId) : ((unitById(unitId) || {}).members || []));
  return S.people.filter(p => p.active && p.id !== S.meId && (members.has(p.id) || ['superadmin', 'rm'].includes(p.access)))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

/** Подключить подсказку к textarea / input. */
export function attachMentions(field, unitId) {
  const pop = h('div', { class: 'mention-pop', role: 'listbox', hidden: true });
  let items = [], idx = 0, start = -1;
  const close = () => { pop.hidden = true; start = -1; };
  const query = () => {
    const before = field.value.slice(0, field.selectionStart);
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(before);
    return m ? { q: m[2].toLowerCase(), at: before.length - m[2].length - 1 } : null;
  };
  const insert = p => {
    const end = field.selectionStart;
    field.value = field.value.slice(0, start) + '@' + p.name + ' ' + field.value.slice(end);
    const pos = start + p.name.length + 2;
    field.setSelectionRange(pos, pos);
    close();
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.focus();
  };
  const paint = () => fill(pop, items.map((p, i) => h('button', {
    type: 'button', class: 'mention-item' + (i === idx ? ' on' : ''), role: 'option', 'aria-selected': String(i === idx),
    onmousedown: e => { e.preventDefault(); insert(p); },
  }, avatar(p, 'sm'), h('span', null, p.name))));
  field.addEventListener('input', () => {
    const r = query();
    if (!r) return close();
    items = mentionPeople(unitId).filter(p => !r.q || p.name.toLowerCase().split(/\s+/).some(w => w.startsWith(r.q))).slice(0, 8);
    if (!items.length) return close();
    start = r.at;
    idx = 0;
    paint();
    pop.hidden = false;
  });
  field.addEventListener('keydown', e => {
    if (pop.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; paint(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); insert(items[idx]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  }, true);
  field.addEventListener('blur', () => setTimeout(close, 120));
  // попап — сразу под полем
  const wrap = h('div', { class: 'mention-wrap' });
  queueMicrotask(() => {
    if (!field.parentNode || field.closest('.mention-wrap')) return;
    const had = document.activeElement === field;
    field.parentNode.insertBefore(wrap, field);
    wrap.append(field, pop);
    if (had) field.focus();
  });
  return field;
}
