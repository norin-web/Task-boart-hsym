/**
 * Опросник разработчика: окно с вопросами (web/src/devform.js) и блок в карточке этапа iOS.
 * База не пускает этап на ревью без ответов (DEV_FORM:<id>) — showErr присылает tasks:devform, и окно открывается само.
 */
import { S, taskById, fmtDate } from '../state.js';
import { h, icon, modal, toast, showErr, fill } from '../ui.js';
import { call, send } from '../api.js';
import { DEV_QUESTIONS } from '../devform.js';

export function initDevForm() {
  document.addEventListener('tasks:devform', async e => {
    const id = e.detail;
    let t = S.board && taskById(id);
    if (!t) { try { t = (await call('queryTasks', { ids: [id] }))[0]; } catch (err) { return showErr(err); } }
    if (t) openDevForm(t);
  });
}

/** Окно опросника; onSaved(task) — после сохранения. */
export function openDevForm(t, onSaved) {
  const old = (t.devForm && t.devForm.answers) || {};
  const get = [];
  const rows = DEV_QUESTIONS.map((q, i) => {
    const a = old[q.id] || {};
    const label = h('div', { class: 'dq-q' }, h('span', { class: 'dq-n' }, i + 1 + '.'), h('span', null, q.q, q.hint && h('small', { class: 'muted' }, q.hint)));
    if (q.kind === 'text') {
      const inp = h('textarea', { class: 'inp', rows: 2, value: a.v || '', maxlength: 1000 });
      get.push(() => [q.id, { v: inp.value.trim() }]);
      return h('div', { class: 'dq-row' }, label, inp);
    }
    let v = a.v || '';
    const note = h('input', { class: 'inp sm dq-note', value: a.note || '', placeholder: q.note || 'Уточнение', maxlength: 500 });
    const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': q.q });
    const draw = () => {
      fill(seg, ['Да', 'Нет'].map(x => h('button', { type: 'button', class: v === x ? 'on' : '', role: 'radio', 'aria-checked': String(v === x), onclick: () => { v = x; draw(); } }, x)));
      note.hidden = v !== 'Да';
    };
    draw();
    get.push(() => [q.id, { v, note: note.value.trim() }]);
    return h('div', { class: 'dq-row yn' }, label, seg, note);
  });
  modal({
    title: 'Опросник перед релизом',
    wide: true,
    body: [h('p', { class: 'hint', style: { marginTop: 0 } }, 'Ответы попадут в карточку релиза — по ним RM заполняет App Privacy и отвечает Apple.'), h('div', { class: 'dq-list' }, rows)],
    actions: [
      { label: 'Отмена' },
      {
        label: 'Сохранить', primary: true, action: async close => {
          const saved = await send('saveDevForm', { taskId: t.id, answers: Object.fromEntries(get.map(f => f())) });
          t.devForm = saved.devForm;
          close();
          toast('Опросник сохранён — можно закрывать задачу');
          if (onSaved) onSaved(saved);
        },
      },
    ],
  });
}

/** Блок в карточке этапа iOS: заполнен или нет, кнопка открыть. */
export function devFormBlock(t, canEdit) {
  const box = h('div', { class: 'dq-bar' });
  const draw = () => {
    const at = t.devForm && t.devForm.at;
    fill(box, icon(at ? 'check' : 'checklist', 15),
      h('span', { class: 'dq-bar-text' }, h('b', null, 'Опросник перед релизом'), h('small', { class: 'muted' }, at ? 'заполнен ' + fmtDate(at.slice(0, 10)) : 'заполните перед ревью')),
      canEdit && h('button', { class: 'btn sm' + (at ? ' ghost' : ' primary'), onclick: () => openDevForm(t, draw) }, at ? 'Изменить' : 'Заполнить'));
  };
  draw();
  return box;
}
