/**
 * Опросник разработчика: окно с вопросами (web/src/devform.js) и блок в карточке этапа iOS.
 * База не пускает этап на ревью без ответов (DEV_FORM:<id>) — showErr присылает tasks:devform, и окно открывается само.
 */
import { S, taskById, fmtDate, isSuper, isStaff, myAccess } from '../state.js';
import { h, icon, modal, toast, showErr, fill } from '../ui.js';
import { call, send } from '../api.js';
import { DEV_QUESTIONS } from '../devform.js';

/** Кто настраивает вопросы: CEO, PM, RM. */
export const canEditQuestions = () => isSuper() || isStaff() || myAccess() === 'rm';
let cached = null;
export async function loadQuestions() {
  try { cached = await call('getDevQuestions', {}); } catch { cached = cached || DEV_QUESTIONS; }
  return cached;
}

export function initDevForm() {
  document.addEventListener('tasks:devform', async e => {
    const id = e.detail;
    let t = S.board && taskById(id);
    if (!t) { try { t = (await call('queryTasks', { ids: [id] }))[0]; } catch (err) { return showErr(err); } }
    if (t) openDevForm(t);
  });
}

/** Окно опросника; onSaved(task) — после сохранения. */
export async function openDevForm(t, onSaved) {
  const questions = await loadQuestions();
  const old = (t.devForm && t.devForm.answers) || {};
  const get = [];
  const rows = questions.map((q, i) => {
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
    cls: 'dlg dq-dlg',
    body: [h('p', { class: 'hint' }, 'Ответы попадут в карточку релиза: по ним RM заполняет App Privacy и отвечает Apple.'), h('div', { class: 'dq-list' }, rows)],
    footLeft: canEditQuestions() && h('button', { class: 'btn soft', onclick: e => { e.currentTarget.closest('.modal')?.querySelector('.modal-head .icon-btn')?.click(); openQuestionsEditor(() => openDevForm(t, onSaved)); } }, icon('settings', 14), 'Настроить вопросы'),
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

/** Редактор вопросов опросника (CEO, PM, RM): текст, вид ответа, что уточнить при «Да», необязательный. */
export async function openQuestionsEditor(onDone) {
  const list = (await loadQuestions()).map(q => ({ ...q }));
  const box = h('div', { class: 'dqe-list' });
  const draw = () => fill(box, list.map((q, i) => h('div', { class: 'dqe-row' },
    h('span', { class: 'dq-n' }, i + 1 + '.'),
    h('div', { class: 'dqe-main' },
      h('input', { class: 'inp', value: q.q, maxlength: 300, placeholder: 'Вопрос', oninput: e => { q.q = e.target.value; } }),
      h('div', { class: 'dqe-opts' },
        h('select', { class: 'inp sm', 'aria-label': 'Вид ответа', onchange: e => { q.kind = e.target.value; draw(); } },
          h('option', { value: 'yn', selected: q.kind !== 'text' }, 'Да / Нет'), h('option', { value: 'text', selected: q.kind === 'text' }, 'Текст')),
        q.kind !== 'text' && h('input', { class: 'inp sm', value: q.note || '', maxlength: 100, placeholder: 'Что уточнить при «Да»', oninput: e => { q.note = e.target.value; } }),
        h('label', { class: 'dqe-opt' }, h('input', { type: 'checkbox', checked: !!q.optional, onchange: e => { q.optional = e.target.checked; } }), 'необязательный'))),
    h('div', { class: 'dqe-act' },
      h('button', { type: 'button', class: 'icon-btn sm', title: 'Выше', disabled: i === 0, onclick: () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; draw(); } }, icon('chevron', 13)),
      h('button', { type: 'button', class: 'icon-btn sm', title: 'Удалить', onclick: () => { list.splice(i, 1); draw(); } }, icon('trash', 13))))));
  draw();
  modal({
    title: 'Вопросы опросника',
    wide: true,
    cls: 'dlg dq-dlg',
    body: [h('p', { class: 'hint' }, 'Одни на студию. Уже заполненные опросники не меняются — в них сохранён текст вопросов.'), box],
    footLeft: h('button', { class: 'btn soft', onclick: () => { list.push({ id: '', kind: 'yn', q: '' }); draw(); box.querySelector('.dqe-row:last-child input')?.focus(); } }, icon('plus', 14), 'Вопрос'),
    actions: [{ label: 'Отмена' }, { label: 'Сохранить', primary: true, action: async close => {
      cached = await send('saveDevQuestions', { questions: list.filter(q => q.q.trim()) });
      close();
      toast('Вопросы сохранены');
      if (onDone) onDone();
    } }],
  });
}
