/**
 * Обратная связь: у каждого в «Настройках» — форма «предложение по улучшению» и свои отправленные;
 * у разработчика (Студия → «Обратная связь») — все предложения людей: новые сверху, «учтено», удалить.
 */
import { personById, deptById, relTime } from '../state.js';
import { h, icon, avatar, fill, toast, showErr, skeleton, confirmDlg } from '../ui.js';
import { call, send } from '../api.js';

const KINDS = [['idea', 'Идея', 'Что добавить или сделать иначе'], ['inconvenient', 'Неудобно', 'Что мешает в работе'], ['bug', 'Ошибка', 'Что-то сломалось']];
const kindName = k => (KINDS.find(x => x[0] === k) || KINDS[0])[1];
const head = (title, sub) => h('div', { class: 'prefs-head' }, h('h2', null, title), sub && h('p', { class: 'muted' }, sub));

/** Форма: тип чипами, текст, «Отправить». onSent — после отправки. */
function feedbackForm(onSent) {
  let kind = 'idea';
  const chips = h('div', { class: 'ap-pick-units fb-kinds', role: 'radiogroup', 'aria-label': 'Тип предложения' });
  const text = h('textarea', { class: 'inp fb-text', rows: 5, maxlength: 4000, placeholder: 'Что улучшить и зачем. Можно коротко — главное, чтобы было понятно, где и что' });
  const hint = h('small', { class: 'muted' });
  const drawChips = () => {
    fill(chips, KINDS.map(([id, name]) => h('button', { type: 'button', class: 'fchip' + (kind === id ? ' on' : ''), role: 'radio', 'aria-checked': String(kind === id), onclick: () => { kind = id; drawChips(); } }, name)));
    hint.textContent = KINDS.find(x => x[0] === kind)[2];
  };
  drawChips();
  const btn = h('button', { class: 'btn primary', type: 'button' }, icon('send', 14), 'Отправить');
  btn.onclick = async () => {
    if (!text.value.trim()) { text.focus(); return; }
    btn.disabled = true;
    try {
      await send('sendFeedback', { kind, text: text.value });
      text.value = '';
      toast('Спасибо! Предложение отправлено');
      if (onSent) onSent();
    } catch (e) { showErr(e); } finally { btn.disabled = false; }
  };
  return h('div', { class: 'card-box fb-form' }, chips, hint, text, h('div', { class: 'fb-actions' }, btn));
}

const statusPill = f => h('span', { class: 'fb-status' + (f.status === 'done' ? ' done' : '') }, f.status === 'done' ? 'Учтено' : 'Новое');

/** Раздел для всех: написать предложение + мои отправленные. */
export function feedbackSection() {
  const mine = h('div', { class: 'fb-list' }, skeleton());
  const load = () => call('getMyFeedback', {}).then(list => fill(mine, list.length
    ? list.map(f => h('div', { class: 'fb-row' },
      h('div', { class: 'fb-row-top' }, h('b', null, kindName(f.kind)), h('span', { class: 'muted' }, relTime(f.createdAt)), statusPill(f)),
      h('p', { class: 'fb-row-text' }, f.text)))
    : h('p', { class: 'muted' }, 'Вы ещё ничего не отправляли.'))).catch(e => { fill(mine); showErr(e); });
  load();
  return [
    head('Обратная связь', 'Предложения по улучшению Tasks: что неудобно, чего не хватает, что сломалось. Читает разработчик'),
    feedbackForm(load),
    h('div', { class: 'prefs-head' }, h('h2', null, 'Мои предложения')),
    mine,
  ];
}

/** Карточка на странице режима разработчика: все предложения людей. */
export function feedbackInboxCard() {
  const box = h('div', { class: 'fb-list' }, skeleton());
  let list = [];
  let show = 'new';
  const seg = h('div', { class: 'seg fb-seg' });
  const draw = () => {
    const nNew = list.filter(f => f.status !== 'done').length;
    fill(seg, [['new', `Новые · ${nNew}`], ['done', `Учтено · ${list.length - nNew}`], ['all', `Все · ${list.length}`]].map(([id, label]) =>
      h('button', { type: 'button', class: show === id ? 'on' : '', onclick: () => { show = id; draw(); } }, label)));
    const rows = list.filter(f => show === 'all' || (show === 'done' ? f.status === 'done' : f.status !== 'done'));
    fill(box, rows.length ? rows.map(f => {
      const p = personById(f.personId);
      const pos = p ? (deptById(p.positionId) || {}).name || '' : '';
      return h('div', { class: 'fb-row fb-in' },
        p ? avatar(p, 'sm') : h('span', { class: 'avatar sm' }, '?'),
        h('div', { class: 'fb-in-body' },
          h('div', { class: 'fb-row-top' }, h('b', null, p ? p.name : 'Удалённый человек'), pos && h('span', { class: 'muted' }, pos),
            h('span', { class: 'fb-kind' }, kindName(f.kind)), h('span', { class: 'muted' }, relTime(f.createdAt))),
          h('p', { class: 'fb-row-text' }, f.text)),
        h('div', { class: 'fb-in-acts' },
          h('button', { class: 'btn sm' + (f.status === 'done' ? '' : ' success'), type: 'button', onclick: () => setStatus(f, f.status === 'done' ? 'new' : 'done') },
            f.status === 'done' ? 'Вернуть в новые' : 'Учтено'),
          h('button', { class: 'icon-btn sm', type: 'button', title: 'Удалить', 'aria-label': 'Удалить предложение', onclick: () => remove(f) }, icon('trash', 14))));
    }) : h('p', { class: 'muted' }, show === 'new' ? 'Новых предложений нет.' : 'Пусто.'));
  };
  const setStatus = (f, status) => send('setFeedbackStatus', { id: f.id, status }).then(() => { f.status = status; draw(); }).catch(showErr);
  const remove = async f => {
    if (!(await confirmDlg('Удалить предложение? Вернуть не получится.', { ok: 'Удалить', danger: true }))) return;
    send('deleteFeedback', { id: f.id }).then(() => { list = list.filter(x => x.id !== f.id); draw(); }).catch(showErr);
  };
  call('getFeedback', {}).then(l => { list = l; draw(); }).catch(e => { fill(box); showErr(e); });
  // открыли входящие — уведомления о предложениях прочитаны
  import('./home.js').then(m => m.readFeedbackNotes()).catch(() => {});
  return h('section', { class: 'card-box dev-card' },
    h('div', { class: 'dev-head fb-dev-head' }, h('h3', null, 'Обратная связь'), h('span', { class: 'muted' }, 'предложения людей по улучшению'), seg),
    box);
}
