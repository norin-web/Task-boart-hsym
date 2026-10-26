/**
 * Релиз (RM): карточка релиза в панели этапа «Релиз» — ход релиза кнопками (отправил в Apple → в сторе / реджект →
 * отправить снова; статус приложения меняется сам), поля приложения, ссылки из этапов команды, релизные поля.
 * Чеклист релиза — обычный чеклист этапа ниже. Настройка релизных полей и чеклиста студии — openReleaseSettings (CEO, RM).
 */
import Sortable from 'sortablejs';
import { S, canEditTask, fmtDateTime, relTime, personById } from '../state.js';
import { h, icon, fill, modal, toast, showErr, promptDlg } from '../ui.js';
import { call, send } from '../api.js';

const PHASES = [
  { id: '', label: 'К отправке', icon: 'checklist' },
  { id: 'submitted', label: 'Ревью Apple', icon: 'eye' },
  { id: 'live', label: 'В сторе', icon: 'rocket' },
];
const linkIcon = kind => (['figma', 'github', 'drive', 'meta'].includes(kind) ? kind : 'link');

/** Блок релиза в карточке этапа; onChange — перерисовать карточку/доску после шага. */
export function releaseBlock(t, onChange) {
  const box = h('div', { class: 'tree-block rl-block' }, h('div', { class: 'boot' }, h('span', { class: 'spinner' })));
  const editable = canEditTask(t);
  let data = null;

  const step = async (action, reason) => {
    try {
      const r = await send('releaseStep', { taskId: t.id, action, reason });
      toast({ submit: 'Отправлено в Apple — приложение на ревью', resubmit: 'Отправлено снова', live: 'В сторе! Релиз и задача CEO закрыты', reject: 'Реджект: задача на исправление ушла PM' }[action]);
      Object.assign(t, r.task);
      if (onChange) onChange();
      load();
    } catch (e) { showErr(e); }
  };
  const reject = async () => {
    const reason = await promptDlg('Реджект Apple', 'Причина (из письма Apple)', '');
    if (reason && reason.trim()) step('reject', reason.trim());
  };
  const saveValue = async (f, v) => {
    try {
      const saved = await send('saveReleaseValues', { taskId: t.id, values: { [f.id]: v } });
      t.release = saved.release;
      data.task = saved;
      draw();
    } catch (e) { showErr(e); draw(); }
  };

  const draw = () => {
    const rel = data.task.release || {};
    const phase = rel.phase || '';
    const values = rel.values || {};
    const missing = data.fields.filter(f => f.required && !values[f.id]);
    const cl = data.task.checklist || [];
    const clOpen = cl.filter(i => !i.done).length;
    const ready = !missing.length && !clOpen;
    const at = phase === 'submitted' ? rel.submittedAt : phase === 'rejected' ? rel.rejectedAt : phase === 'live' ? rel.liveAt : '';
    const pm = personById(rel.pmId);
    const idx = phase === 'rejected' ? 1 : PHASES.findIndex(p => p.id === phase);
    fill(box,
      h('div', { class: 'tree-head' }, h('span', { class: 'sub-title', style: { margin: 0 } }, 'Релиз'),
        data.app && h('span', { class: 'flow-app' }, h('span', { class: 'uc-icon xs', style: { background: data.app.color } }, data.app.name.slice(0, 2).toUpperCase()), data.app.name),
        at && h('span', { class: 'muted', title: fmtDateTime(at) }, relTime(at))),
      // ход релиза
      h('div', { class: 'rl-steps', role: 'list' }, PHASES.map((p, i) => h('span', {
        role: 'listitem', class: 'rl-step' + (i < idx || phase === 'live' ? ' past' : i === idx ? ' now' : '') + (phase === 'rejected' && i === 1 ? ' rejected' : ''),
      }, icon(phase === 'rejected' && i === 1 ? 'alert' : p.icon, 13), phase === 'rejected' && i === 1 ? 'Реджект' : p.label))),
      phase === 'rejected' && h('div', { class: 'readonly-note rl-reject' }, icon('alert', 14),
        h('span', null, 'Apple: ', h('b', null, rel.reason), '. Исправляет ', h('b', null, pm ? pm.name : 'PM юнита'), ' — задача «Реджект» у него. Когда исправят — «Отправить снова».')),
      editable && h('div', { class: 'rl-actions' },
        // чеклист отмечают ниже, в этой же карточке — перед отправкой перечитываем, проверяет и база
        !phase && [h('button', { class: 'btn primary', onclick: async () => { await load(); step('submit'); } }, icon('send', 14), 'Отправил в Apple'),
          !ready && h('span', { class: 'muted rl-why' }, [missing.length && 'заполните: ' + missing.map(f => f.name).join(', '), clOpen && `закройте чеклист (${clOpen})`].filter(Boolean).join(' · '))],
        phase === 'submitted' && [h('button', { class: 'btn primary', onclick: () => step('live') }, icon('rocket', 14), 'Вышло в стор'),
          h('button', { class: 'btn danger', onclick: reject }, icon('alert', 14), 'Реджект')],
        phase === 'rejected' && h('button', { class: 'btn primary', onclick: () => step('resubmit') }, icon('send', 14), 'Отправить снова'),
        phase === 'live' && h('span', { class: 'ok-text rl-done' }, icon('check', 14), 'Приложение в сторе')),
      // релизные поля
      data.fields.length > 0 && h('div', { class: 'rl-sec' }, h('div', { class: 'rl-sec-title' }, 'Релизные поля'),
        h('div', { class: 'af-list' }, data.fields.map(f => valueRow(f, values[f.id] || '', editable && phase !== 'live', v => saveValue(f, v))))),
      // поля приложения и ссылки этапов
      data.app && S.appFields.some(f => data.app.info[f.id]) && h('div', { class: 'rl-sec' }, h('div', { class: 'rl-sec-title' }, 'Приложение'),
        h('div', { class: 'rl-links' }, S.appFields.filter(f => data.app.info[f.id]).map(f => f.kind === 'link'
          ? h('a', { class: 'rl-link', href: data.app.info[f.id], target: '_blank', rel: 'noopener' }, icon('link', 13), f.name)
          : h('span', { class: 'rl-link', title: f.name }, h('span', { class: 'muted' }, f.name + ':'), data.app.info[f.id])))),
      h('div', { class: 'rl-sec' }, h('div', { class: 'rl-sec-title' }, 'От команды'),
        data.links.length ? h('div', { class: 'rl-links' }, data.links.map(l => h('a', { class: 'rl-link', href: l.url, target: '_blank', rel: 'noopener', title: l.url },
          icon(linkIcon(l.kind), 13), h('span', null, l.name), h('span', { class: 'muted' }, '· ' + l.stage))))
          : h('p', { class: 'muted', style: { margin: 0, fontSize: '12.5px' } }, 'Ссылок в этапах пока нет — дизайн, сборку, метаданные команда прикрепляет к своим этапам.')),
      h('p', { class: 'hint', style: { margin: 0 } }, icon('checklist', 12), ' Чеклист релиза — ниже; без закрытого чеклиста и обязательных полей отправить нельзя.'));
  };
  const load = async () => {
    try { data = await call('getRelease', { taskId: t.id }); } catch { fill(box); return; }
    if (S.panelTaskId !== t.id) return;
    draw();
  };
  load();
  return box;
}

/** Релизное поле: значение и правка на месте (длинный текст — многострочное поле). */
function valueRow(f, v, editable, onSave) {
  const row = h('div', { class: 'af-row rl-row' + (f.kind === 'longtext' ? ' long' : '') });
  const show = () => fill(row,
    h('span', { class: 'af-name' }, f.name, f.required && h('span', { class: 'req', title: 'Обязательно для отправки' }, ' *')),
    v ? (f.kind === 'link' ? h('a', { class: 'af-val', href: v, target: '_blank', rel: 'noopener' }, v.replace(/^https?:\/\//, '')) : h('span', { class: 'af-val' + (f.kind === 'longtext' ? ' pre' : '') }, v))
      : h('span', { class: 'af-val muted' }, editable ? 'не заполнено' : '—'),
    editable && h('button', { class: 'icon-btn sm', title: 'Изменить', 'aria-label': 'Изменить ' + f.name, onclick: edit }, icon('edit', 13)));
  const edit = () => {
    const inp = h(f.kind === 'longtext' ? 'textarea' : 'input', {
      class: 'inp sm', value: v, rows: f.kind === 'longtext' ? 4 : undefined, placeholder: f.kind === 'link' ? 'https://…' : '',
      onkeydown: e => { if (e.key === 'Enter' && (f.kind !== 'longtext' || e.metaKey || e.ctrlKey)) { e.preventDefault(); e.target.blur(); } if (e.key === 'Escape') { e.stopPropagation(); show(); } },
      onblur: e => { if (e.target.value.trim() !== v) onSave(e.target.value.trim()); else show(); },
    });
    fill(row, h('span', { class: 'af-name' }, f.name), inp);
    inp.focus();
  };
  show();
  return row;
}

/** Настройка релиза студии (CEO, RM): релизные поля (название, тип, обязательное) и пункты чеклиста. */
export async function openReleaseSettings() {
  let cfg;
  try { cfg = await call('getReleaseSettings', {}); } catch (e) { return showErr(e); }
  const fields = cfg.fields.map(x => ({ ...x }));
  const items = cfg.checklist.map(text => ({ text }));
  const sortableList = (arr, row, onAdd, addLabel) => {
    const list = h('div', { class: 'col-edit-list' });
    let s = null;
    const draw = () => {
      fill(list, arr.map((x, i) => h('div', { class: 'col-edit-row rs-row', dataset: { i } }, h('span', { class: 'drag', title: 'Перетащите, чтобы изменить порядок' }, icon('grip', 16)), row(x, i, draw))));
      if (s) s.destroy();
      s = Sortable.create(list, { handle: '.drag', animation: 150, forceFallback: true, fallbackTolerance: 4, onEnd: () => { const next = [...list.children].map(r => arr[Number(r.dataset.i)]); arr.splice(0, arr.length, ...next); draw(); } });
    };
    draw();
    return h('div', null, list, h('button', { class: 'btn sm', onclick: () => { onAdd(); draw(); const ins = list.querySelectorAll('input.inp'); if (ins.length) ins[ins.length - 1].focus(); } }, icon('plus', 13), addLabel));
  };
  const fieldRow = (x, i, redraw) => [
    h('input', { class: 'inp', value: x.name, maxlength: 60, placeholder: 'Например, Промокод для ревью', 'aria-label': 'Название поля', oninput: e => { x.name = e.target.value; } }),
    h('select', { class: 'inp', 'aria-label': 'Тип', onchange: e => { x.kind = e.target.value; } },
      [['text', 'Строка'], ['longtext', 'Текст'], ['link', 'Ссылка']].map(([k, l]) => h('option', { value: k, selected: k === x.kind }, l))),
    h('label', { class: 'chk', title: 'Без него «Отправил в Apple» недоступна' }, h('input', { type: 'checkbox', checked: !!x.required, onchange: e => { x.required = e.target.checked; } }), 'обязательно'),
    h('button', { class: 'icon-btn sm', title: 'Удалить', onclick: () => { fields.splice(i, 1); redraw(); } }, icon('x', 14)),
  ];
  const itemRow = (x, i, redraw) => [
    h('input', { class: 'inp', value: x.text, maxlength: 300, placeholder: 'Пункт чеклиста', 'aria-label': 'Пункт чеклиста', oninput: e => { x.text = e.target.value; } }),
    h('button', { class: 'icon-btn sm', title: 'Удалить', onclick: () => { items.splice(i, 1); redraw(); } }, icon('x', 14)),
  ];
  modal({
    title: 'Настройка релиза',
    wide: true,
    body: [
      h('div', { class: 'sub-title', style: { marginTop: 0 } }, 'Релизные поля'),
      h('p', { class: 'hint', style: { marginTop: '-4px' } }, 'Что RM заполняет в карточке релиза перед отправкой в Apple.'),
      sortableList(fields, fieldRow, () => fields.push({ id: '', name: '', kind: 'text', required: false }), 'Поле'),
      h('div', { class: 'sub-title' }, 'Чеклист релиза'),
      h('p', { class: 'hint', style: { marginTop: '-4px' } }, 'Подставляется в этап «Релиз», когда PM передаёт его RM. Уже переданным релизам не меняется.'),
      sortableList(items, itemRow, () => items.push({ text: '' }), 'Пункт'),
    ],
    actions: [{ label: 'Отмена' }, {
      label: 'Сохранить', primary: true,
      action: async close => {
        await send('saveReleaseSettings', { fields: fields.filter(x => x.name.trim()), checklist: items.map(x => x.text.trim()).filter(Boolean) });
        close();
        toast('Настройки релиза сохранены');
      },
    }],
  });
}

