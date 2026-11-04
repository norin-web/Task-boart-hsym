/**
 * Карточка сотрудника: клик по любому аватару (кроме аватаров-кнопок — фильтры, выбор исполнителя, меню).
 * Крупный аватар, имя, роль и позиции, должность, почта, местное время (часовой пояс из профиля), Telegram.
 */
import { S, personById, deptById, ACCESS_LABELS, presenceText } from '../state.js';
import { h, icon, avatar, menu, toast } from '../ui.js';

/** Где аватар сам — элемент управления: там клик работает как раньше. */
const SKIP = '.av-btn, .who-card, .nav-item.me, .menu, .modal, .av-opt, .dev-person, [data-no-card]';

export function initPersonCard() {
  document.addEventListener('click', e => {
    // аватар или имя с подписью рядом с ним (data-pcard)
    const el = e.target.closest && e.target.closest('.avatar[data-pid], [data-pcard]');
    if (!el || el.closest(SKIP)) return;
    const p = personById(el.dataset.pid || el.dataset.pcard);
    if (!p) return;
    // не открываем задачу или строку, внутри которой аватар
    e.preventDefault();
    e.stopPropagation();
    openPersonCard(el, p);
  }, true);
}

/** Местное время человека: «14:32», «−2 ч от вас»; null — пояс неизвестен. */
function localTime(tz) {
  if (!tz) return null;
  try {
    const now = new Date();
    const time = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(now);
    const off = zone => { const d = new Date(now.toLocaleString('en-US', { timeZone: zone })); return Math.round((d - new Date(now.toLocaleString('en-US'))) / 36e5); };
    const diff = off(tz) - off(Intl.DateTimeFormat().resolvedOptions().timeZone);
    const city = tz.split('/').pop().replace(/_/g, ' ');
    return { time, sub: [city, diff ? `${diff > 0 ? '+' : '−'}${Math.abs(diff)} ч от вас` : 'как у вас'].join(' · ') };
  } catch { return null; }
}

export function openPersonCard(anchor, p) {
  const pos = (p.positionIds || [p.positionId]).map(id => (deptById(id) || {}).name).filter(Boolean);
  const t = localTime(p.timezone);
  // copyText — строка копируется в буфер по клику (почта, Telegram); меню остаётся открытым
  const line = (ic, main, sub, copyText) => {
    const body = [icon(ic, 15), h('span', { class: 'pc-line-text' }, h('span', null, main), sub && h('small', { class: 'muted' }, sub)), copyText && icon('copy', 14)];
    if (!copyText) return h('div', { class: 'pc-line' }, body);
    const done = () => toast('Скопировано: ' + copyText);
    return h('button', { class: 'pc-line copy', type: 'button', title: 'Скопировать',
      onclick: () => (navigator.clipboard ? navigator.clipboard.writeText(copyText) : Promise.reject()).then(done, () => toast(copyText)) }, body);
  };
  const box = h('div', { class: 'pc' },
    h('div', { class: 'pc-head' }, avatar(p, 'xxl'),
      h('div', { class: 'pc-who' }, h('b', null, p.name),
        h('span', { class: 'muted' }, [ACCESS_LABELS[p.access], p.id === S.meId && 'это вы'].filter(Boolean).join(' · ')),
        h('small', { class: 'muted' }, presenceText(p)))),
    h('div', { class: 'pc-lines' },
      (pos.length || p.role) && line('user', pos.join(', ') || p.role, pos.length && p.role ? p.role : ''),
      p.email && line('send', p.email, '', p.email),
      t && line('clock', t.time, t.sub),
      p.telegram && line('message', '@' + p.telegram, 'Telegram', '@' + p.telegram),
      !p.email && !t && !p.telegram && h('p', { class: 'muted pc-empty' }, 'Контакты ещё не заполнены')));
  menu(anchor, [box], { cls: 'pc-menu', align: 'left' });
}
