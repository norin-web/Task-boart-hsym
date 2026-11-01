/**
 * Решение по ревью — две явные кнопки: «Аппрув» (в «готово») и «Правки» (обратно автору; можно оставить комментарий —
 * по правкам или общую информацию, он уйдёт в обсуждение задачи). Используют очередь ревью лида, карточка задачи и «Моя доска».
 */
import { personById } from '../state.js';
import { h, icon, modal, toast, showErr } from '../ui.js';
import { send } from '../api.js';

/** Отправить решение; onDone(task) — после успеха. */
export async function decide(t, approve, comment, onDone) {
  try {
    const res = await send('reviewDecision', { taskId: t.id, approve, comment: comment || '' });
    const who = personById(t.reviewFrom || t.authorId);
    toast(approve ? 'Принято — задача закрыта' : 'Правки отправлены' + (who ? ' — ' + who.name : ''));
    if (onDone) onDone(res);
  } catch (e) { showErr(e); }
}

/** Окно «Правки»: комментарий необязателен. Возвращает промис закрытия. */
export function changesDialog(t, onDone) {
  const ta = h('textarea', { class: 'inp', rows: 4, maxlength: 5000, placeholder: 'Что поправить — или общая информация (необязательно)' });
  modal({
    title: 'Вернуть на правки · ' + t.title,
    cls: 'dlg',
    body: [h('p', { class: 'hint' }, 'Задача вернётся автору в работу. Комментарий появится в обсуждении задачи.'), ta],
    actions: [{ label: 'Отмена' }, { label: 'Отправить на правки', primary: true, action: async close => { await decide(t, false, ta.value.trim(), onDone); close(); } }],
  });
  setTimeout(() => ta.focus(), 0);
}

/** Две кнопки решения. size — 'sm' для строк списков. */
export function reviewButtons(t, onDone, { sm = true } = {}) {
  const cls = sm ? ' sm' : '';
  return [
    h('button', { class: 'btn' + cls, onclick: e => { e.stopPropagation(); changesDialog(t, onDone); } }, icon('back', 13), 'Правки'),
    h('button', { class: 'btn primary rv-ok' + cls, onclick: e => { e.stopPropagation(); decide(t, true, '', onDone); } }, icon('check', 13), 'Аппрув'),
  ];
}
