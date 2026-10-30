/**
 * Релиз (RM): карточка релиза в панели этапа «Релиз» — ход релиза кнопками (отправил в Apple → в сторе / реджект →
 * отправить снова; статус приложения меняется сам), поля приложения, ссылки из этапов команды, релизные поля.
 * Чеклист релиза — обычный чеклист этапа ниже. Настройка релизных полей и чеклиста студии — openReleaseSettings (CEO, RM).
 */
import Sortable from 'sortablejs';
import { S, me, canEditTask, fmtDateTime, relTime, personById, plural } from '../state.js';
import { h, icon, fill, modal, toast, showErr, field, confirmDlg } from '../ui.js';
import { DEV_QUESTIONS, answerText } from '../devform.js';
import { brandIcon, brandOf } from './brand.js';
import { call, send } from '../api.js';

const linkIcon = kind => (['figma', 'github', 'drive', 'meta'].includes(kind) ? kind : 'link');

/* ---------- настройка карточки релиза (у каждого своя: prefs.releaseCard.hidden) ---------- */

export const RELEASE_BLOCKS = [['fields', 'Релизные поля'], ['links', 'Ссылки приложения и команды'], ['attempts', 'Попытки'],
  ['description', 'Описание'], ['spec', 'ТЗ'], ['tasklinks', 'Ссылки этапа'], ['checklist', 'Чеклист']];
// по умолчанию в релизе скрыты блоки обычной задачи, которые RM не нужны (дублируют «Ссылки» релиза)
const RELEASE_HIDDEN_DEFAULT = ['tasklinks', 'description', 'spec'];
export const releaseHidden = () => { const c = ((me() || {}).prefs || {}).releaseCard; return c && Array.isArray(c.hidden) ? c.hidden : RELEASE_HIDDEN_DEFAULT; };
/** «Настроить карточку релиза»: какие блоки показывать (только у вас) и релизные поля студии (CEO, RM). */
export function openReleaseCardSettings(onDone) {
  let hidden = [...releaseHidden()];
  const list = h('div', { class: 'cl-tpl-list', style: { gap: '2px' } });
  const draw = () => fill(list, RELEASE_BLOCKS.map(([id, label]) => {
    const on = !hidden.includes(id);
    return h('button', { class: 'menu-item aud-item' + (on ? ' on' : ''), role: 'checkbox', 'aria-checked': String(on), onclick: () => {
      hidden = on ? [...hidden, id] : hidden.filter(x => x !== id);
      const p = me();
      if (p) p.prefs = { ...(p.prefs || {}), releaseCard: { hidden } };
      send('setMyPrefs', { personId: S.meId, prefs: { releaseCard: { hidden } } }).catch(showErr);
      draw();
      if (onDone) onDone();
    } }, h('span', { class: 'aud-check' }, on && icon('check', 13)), label);
  }));
  draw();
  const canFields = ['superadmin', 'rm'].includes((me() || {}).access);
  const close = modal({
    title: 'Настроить карточку релиза',
    body: [h('p', { class: 'hint', style: { margin: '0 0 8px' } }, 'Какие блоки показывать — только у вас, во всех релизах.'), list,
      canFields && h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn sm', onclick: () => { close(); openReleaseSettings(onDone); } }, icon('settings', 14), 'Релизные поля…'),
        h('p', { class: 'hint', style: { margin: '6px 0 0' } }, 'Какие поля заполнять перед отправкой в Apple и какие обязательны — для всей студии.'))],
    actions: [{ label: 'Готово' }],
  });
}
const fmtD = iso => (iso ? new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '');
const daysSince = iso => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 864e5));

/**
 * Форма реджекта: № (присваивается сам, по приложению), описание из письма Apple, ссылка на скрин.
 * onDone() — после успешного шага.
 */
export function openRejectForm(t, appName, no, onDone) {
  const desc = h('textarea', { class: 'inp', rows: 5, maxlength: 2000, placeholder: 'Guideline 3.1.2 — нет условий подписки на пейволле…' });
  const shot = h('input', { class: 'inp', type: 'url', maxlength: 2000, placeholder: 'https://… (Google Drive, Telegram, CleanShot)' });
  modal({
    title: `Реджект №${no || '…'} · ${appName || t.title}`,
    body: [
      h('p', { class: 'hint', style: { margin: '0 0 10px' } }, 'PM юнита получит задачу «Реджект №' + (no || '…') + '» на исправление. Когда её закроют, релиз вернётся к вам в очередь.'),
      field('Описание', desc, 'Из письма Apple: guideline и что не так'),
      field('Скрин реджекта', shot, 'Ссылка на скриншот'),
    ],
    actions: [{ label: 'Отмена' }, { label: 'Записать реджект', danger: true, action: async close => {
      if (!desc.value.trim()) { desc.focus(); return; }
      await send('releaseStep', { taskId: t.id, action: 'reject', reason: desc.value.trim(), shot: shot.value.trim() });
      close();
      toast(`Реджект №${no || ''}: задача на исправление ушла PM`);
      if (onDone) onDone();
    } }],
  });
  setTimeout(() => desc.focus(), 0);
}

/** Блок релиза в карточке этапа; onChange — перерисовать карточку/доску после шага. */
export function releaseBlock(t, onChange) {
  const box = h('div', { class: 'tree-block rl-block' }, h('div', { class: 'boot' }, h('span', { class: 'spinner' })));
  const editable = canEditTask(t);
  let data = null;

  const step = async action => {
    try {
      const r = await send('releaseStep', { taskId: t.id, action });
      toast({ close_reject: 'Реджект закрыт — релиз в очереди', submit: 'Отправлено в Apple — приложение на ревью', resubmit: 'Отправлено снова', live: 'В сторе! Релиз и задача CEO закрыты' }[action]);
      Object.assign(t, r.task);
      if (onChange) onChange();
      load();
    } catch (e) { showErr(e); }
  };
  const closeReject = async rel => {
    if (await confirmDlg(`Закрыть реджект №${rel.rejectNo || ''}? Задача по нему закроется, релиз вернётся в очередь на отправку.`, { ok: 'Закрыть реджект', title: 'Реджект' })) step('close_reject');
  };
  const saveValue = async (f, v) => {
    try {
      const saved = await send('saveReleaseValues', { taskId: t.id, values: { [f.id]: v } });
      t.release = saved.release;
      data.task = saved;
      draw();
    } catch (e) { showErr(e); draw(); }
  };

  // раскрыт ли список релизных полей (по умолчанию — пока есть незаполненные обязательные или релиз в очереди)
  let fieldsOpen = null;
  const draw = () => {
    const rel = data.task.release || {};
    const phase = rel.phase || '';
    const values = rel.values || {};
    const hist = rel.history || [];
    const missing = data.fields.filter(f => f.required && !values[f.id]);
    const filled = data.fields.filter(f => values[f.id]).length;
    const cl = data.task.checklist || [];
    const clOpen = cl.filter(i => !i.done).length;
    const ready = !missing.length && !clOpen;
    const pm = personById(rel.pmId);
    if (fieldsOpen === null) fieldsOpen = !phase || missing.length > 0;
    const hide = releaseHidden();
    // ход релиза — одной тонкой линией: точка на шаг, дата под пройденным
    const steps = [
      { label: 'К отправке', state: 'done' },
      { label: 'В Apple', state: phase ? 'done' : 'next', at: phase ? rel.submittedAt : '' },
      phase === 'rejected'
        ? { label: 'Реджект №' + (rel.rejectNo || ''), state: 'bad', at: rel.rejectedAt }
        : { label: 'Решение Apple', state: phase === 'live' ? 'done' : phase === 'submitted' ? 'now' : 'next', at: phase === 'live' ? rel.liveAt : '' },
      { label: 'В сторе', state: phase === 'live' ? 'done' : 'next', at: phase === 'live' ? rel.liveAt : '' },
    ];
    // ссылки приложения и этапов команды — без повторов: одинаковый адрес — один раз; одинаковое название — с этапом
    const raw = [
      ...(data.app ? S.appFields.filter(f => f.kind === 'link' && data.app.info[f.id]).map(f => ({ name: f.name, url: data.app.info[f.id], icon: brandIcon(brandOf(f.name, data.app.info[f.id]), 13, 'link') })) : []),
      ...data.links.map(l => ({ name: l.name, url: l.url, sub: l.stage, icon: brandIcon(brandOf(l.name, l.kind, l.url), 13, linkIcon(l.kind)) })),
    ];
    const norm = u => String(u || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '').toLowerCase();
    const links = raw.filter((l, i) => raw.findIndex(x => norm(x.url) === norm(l.url)) === i)
      .map((l, i, arr) => (l.sub && arr.some((x, j) => j !== i && x.name === l.name) ? { ...l, name: `${l.name} · ${l.sub}` } : l));
    fill(box,
      h('div', { class: 'rl-head' },
        h('span', { class: 'sub-title', style: { margin: 0 } }, 'Релиз'),
        values.version && h('span', { class: 'rl-ver' }, 'v' + values.version + (values.build ? ' (' + values.build + ')' : '')),
        hist.length > 1 && h('span', { class: 'muted rl-try' }, `попытка ${hist.length}`),
        h('span', { class: 'spacer' }),
        h('button', { class: 'icon-btn sm', title: 'Настроить карточку релиза', onclick: () => openReleaseCardSettings(() => { load(); if (onChange) onChange(); }) }, icon('settings', 15))),
      h('ol', { class: 'rl-track' }, steps.map(x => h('li', { class: 'rl-pt ' + x.state },
        h('span', { class: 'rl-dot' }, x.state === 'done' ? icon('check', 10) : x.state === 'bad' ? icon('x', 10) : null),
        h('span', { class: 'rl-pt-label' }, x.label),
        x.at && h('span', { class: 'rl-pt-at', title: fmtDateTime(x.at) }, fmtD(x.at))))),
      // сейчас: одна строка состояния и одно главное действие
      !phase && h('div', { class: 'rl-now' },
        rel.fixedAt && h('p', { class: 'rl-line ok-text' }, icon('check', 14), `Реджект №${rel.rejectNo || ''} исправили — можно отправлять`),
        !ready && h('p', { class: 'rl-line muted' }, icon('circle', 14),
          [missing.length && 'заполните ' + missing.map(f => f.name.toLowerCase()).join(', '), clOpen && `закройте чеклист (${clOpen})`].filter(Boolean).join(' · ')),
        editable && h('button', { class: 'btn primary', disabled: !ready, onclick: async () => { await load(); step(hist.length ? 'resubmit' : 'submit'); } },
          icon('send', 14), hist.length ? 'Отправить в Apple снова' : 'Отправить в Apple')),
      phase === 'submitted' && h('div', { class: 'rl-now' },
        h('p', { class: 'rl-line' }, icon('eye', 14), h('b', null, 'На ревью Apple'),
          h('span', { class: 'muted' }, daysSince(rel.submittedAt) ? `· ${daysSince(rel.submittedAt)} ${plural(daysSince(rel.submittedAt), ['день', 'дня', 'дней'])}` : '· с сегодня')),
        editable && h('div', { class: 'rl-btns' },
          h('button', { class: 'btn primary', onclick: () => step('live') }, icon('rocket', 14), 'Вышло в стор'),
          h('button', { class: 'btn ghost danger', onclick: () => openRejectForm(t, data.app && data.app.name, data.nextRejectNo, () => { load(); if (onChange) onChange(); }) }, 'Реджект'))),
      phase === 'rejected' && h('div', { class: 'rl-now bad' },
        h('p', { class: 'rl-line danger-text' }, icon('alert', 14), h('b', null, `Реджект №${rel.rejectNo || ''}`),
          h('span', { class: 'muted' }, '· ' + relTime(rel.rejectedAt)),
          rel.shot && h('a', { class: 'rl-shot', href: rel.shot, target: '_blank', rel: 'noopener' }, 'скрин', icon('arrowUpRight', 12))),
        h('p', { class: 'rl-reason' }, rel.reason),
        h('p', { class: 'rl-line muted rl-small' }, `Исправляет ${pm ? pm.name : 'PM юнита'}; закроет задачу — релиз вернётся в очередь.`),
        editable && h('div', { class: 'rl-btns' },
          h('button', { class: 'btn sm', onclick: () => closeReject(rel) }, icon('check', 14), 'Закрыть реджект'),
          h('button', { class: 'btn ghost sm', onclick: () => step('resubmit') }, 'Отправить сейчас'))),
      phase === 'live' && h('div', { class: 'rl-now' }, h('p', { class: 'rl-line ok-text' }, icon('check', 14), h('b', null, 'В App Store'),
        h('span', { class: 'muted' }, '· ' + fmtD(rel.liveAt) + (hist.length > 1 ? ` · с ${hist.length}-й попытки` : ' · с первой попытки')))),
      // релизные поля — раскрываются по клику (заполненные — коротко)
      !hide.includes('fields') && data.fields.length > 0 && h('div', { class: 'rl-sec' },
        h('button', { class: 'rl-toggle', 'aria-expanded': String(fieldsOpen), onclick: () => { fieldsOpen = !fieldsOpen; draw(); } },
          h('span', { class: 'ap-chev' + (fieldsOpen ? ' open' : '') }, icon('chevron', 13)), 'Релизные поля',
          h('span', { class: missing.length ? 'danger-text' : 'muted' }, `${filled} из ${data.fields.length}`)),
        fieldsOpen && h('div', { class: 'af-list rl-fields' }, data.fields.map(f => valueRow(f, values[f.id] || '', editable && phase !== 'live', v => saveValue(f, v)))),
        fieldsOpen && devAnswers(data.devForm)),
      // ссылки приложения и команды — списком
      !hide.includes('links') && links.length > 0 && h('div', { class: 'rl-sec' }, h('div', { class: 'rl-sec-title' }, 'Ссылки'),
        h('div', { class: 'rl-links' }, links.map(l => h('a', { class: 'rl-link', href: l.url, target: '_blank', rel: 'noopener', title: l.url }, l.icon,
          h('span', { class: 'rl-link-name' }, l.name), h('span', { class: 'muted rl-link-url' }, l.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '')))))),
      // попытки — только если их несколько
      !hide.includes('attempts') && hist.length > 1 && h('details', { class: 'rl-sec rl-hist-d' }, h('summary', null, `Попытки · ${hist.length}`),
        h('div', { class: 'rl-hist' }, hist.map(x => h('div', { class: 'rl-hist-row' },
          h('span', null, '№' + x.n), h('span', { class: 'muted' }, fmtD(x.submittedAt)),
          h('span', { class: x.result === 'reject' ? 'danger-text' : x.result === 'live' ? 'ok-text' : 'muted' }, x.result === 'reject' ? `реджект №${x.rejectNo || ''}` : x.result === 'live' ? 'в сторе' : 'ждёт'),
          h('span', { class: 'muted rl-hist-why', title: x.reason || '' }, x.reason || ''))))));
  };
  const load = async () => {
    try { data = await call('getRelease', { taskId: t.id }); } catch { fill(box); return; }
    if (S.panelTaskId !== t.id) return;
    draw();
  };
  load();
  return box;
}

/** Ответы разработчика на опросник — в релизных полях, только чтение. */
function devAnswers(form) {
  const a = (form && form.answers) || {};
  const who = form && personById(form.by);
  return h('div', { class: 'rl-dev' },
    h('div', { class: 'rl-sec-title' }, 'Опросник разработчика',
      form && form.at && h('span', { class: 'muted rl-dev-by' }, [who && who.name, fmtD(form.at)].filter(Boolean).join(' · '))),
    form && form.at
      ? h('div', { class: 'af-list rl-fields' }, DEV_QUESTIONS.filter(q => a[q.id]).map(q => h('div', { class: 'af-row rl-row long' },
        h('span', { class: 'af-name' }, q.q), h('span', { class: 'af-val pre' }, answerText(a[q.id])))))
      : h('p', { class: 'muted rl-small', style: { margin: 0 } }, 'Разработчик ещё не заполнил'));
}

/** Релизное поле: значение и правка на месте (длинный текст — многострочное поле). */
function valueRow(f, v, editable, onSave) {
  const row = h('div', { class: 'af-row rl-row' + (f.kind === 'longtext' ? ' long' : '') + (editable ? ' can-edit' : ''),
    // правка кликом по строке; ссылку открываем, поле ввода не трогаем
    onclick: e => { if (editable && !e.target.closest('a, button, input, textarea')) edit(); } });
  const show = () => fill(row,
    h('span', { class: 'af-name' }, f.name, f.required && h('span', { class: 'req', title: 'Обязательно для отправки' }, ' *')),
    v ? (f.kind === 'link' ? h('a', { class: 'af-val', href: v, target: '_blank', rel: 'noopener' }, v.replace(/^https?:\/\//, '')) : h('span', { class: 'af-val' + (f.kind === 'longtext' ? ' pre' : '') }, v))
      : h('span', { class: 'af-val muted' }, editable ? 'не заполнено' : '—'),
    editable && h('button', { class: 'icon-btn sm', title: 'Изменить', 'aria-label': 'Изменить ' + f.name, onclick: edit }, icon('edit', 13)));
  const edit = () => {
    const inp = h(f.kind === 'longtext' ? 'textarea' : 'input', {
      class: 'inp sm', value: v, rows: f.kind === 'longtext' ? 4 : undefined, placeholder: f.kind === 'link' ? 'https://…' : f.kind === 'longtext' ? 'Enter — сохранить, Shift+Enter — новая строка' : '',
      onkeydown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.blur(); } if (e.key === 'Escape') { e.stopPropagation(); show(); } },
      onblur: e => { if (e.target.value.trim() !== v) onSave(e.target.value.trim()); else show(); },
    });
    fill(row, h('span', { class: 'af-name' }, f.name), inp);
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);
  };
  show();
  return row;
}

/** Настройка релиза студии (CEO, RM): релизные поля (название, тип, обязательное). Чеклисты — шаблоны RM. */
export async function openReleaseSettings(onDone) {
  let cfg;
  try { cfg = await call('getReleaseSettings', {}); } catch (e) { return showErr(e); }
  const fields = cfg.fields.map(x => ({ ...x }));
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
  modal({
    title: 'Настройка релиза',
    wide: true,
    body: [
      h('div', { class: 'sub-title', style: { marginTop: 0 } }, 'Релизные поля'),
      h('p', { class: 'hint', style: { marginTop: '-4px' } }, 'Что RM заполняет в карточке релиза перед отправкой в Apple.'),
      sortableList(fields, fieldRow, () => fields.push({ id: '', name: '', kind: 'text', required: false }), 'Поле'),
      h('p', { class: 'hint' }, icon('checklist', 12), ' Чеклисты релиза — ваши шаблоны: в карточке релиза «Из шаблона» → «Шаблоны чеклистов…».'),
    ],
    actions: [{ label: 'Отмена' }, {
      label: 'Сохранить', primary: true,
      action: async close => {
        await send('saveReleaseSettings', { fields: fields.filter(x => x.name.trim()) });
        close();
        toast('Настройки релиза сохранены');
        if (typeof onDone === 'function') onDone();
      },
    }],
  });
}


/**
 * История релизов (RM, CEO, PM): сводка за период (вышло в стор, с 1-го раза, реджекты, отправки, ср. ревью Apple)
 * и список попыток с фильтрами — юнит, приложение, итог. Период: неделя / месяц / квартал / свои даты.
 */
export function openReleaseHistory(preset = {}) {
  const day = d => d.toISOString().slice(0, 10);
  const ago = n => day(new Date(Date.now() - n * 864e5));
  const PERIODS = [['week', 'Неделя', 7], ['month', 'Месяц', 30], ['quarter', 'Квартал', 91], ['custom', 'Свои даты', 0]];
  const f = { period: 'month', from: ago(30), to: day(new Date()), unitId: '', appId: '', result: '', ...(preset && typeof preset === 'object' && !(preset instanceof Event) ? preset : {}) };
  const seg = h('div', { class: 'seg' });
  const from = h('input', { class: 'inp', type: 'date', value: f.from, onchange: e => { f.from = e.target.value; load(); } });
  const to = h('input', { class: 'inp', type: 'date', value: f.to, onchange: e => { f.to = e.target.value; load(); } });
  const dates = h('div', { class: 'rh-dates' }, from, h('span', { class: 'muted' }, '—'), to);
  const unitSel = h('select', { class: 'inp', onchange: e => { f.unitId = e.target.value; f.appId = ''; paintApps(); load(); } },
    h('option', { value: '' }, 'Все юниты'), S.units.filter(u => !u.archived).map(u => h('option', { value: u.id }, u.name)));
  const appSel = h('select', { class: 'inp', onchange: e => { f.appId = e.target.value; load(); } });
  const paintApps = () => fill(appSel, h('option', { value: '' }, 'Все приложения'),
    (S.apps || []).filter(a => !f.unitId || a.unitId === f.unitId).sort((x, y) => x.name.localeCompare(y.name)).map(a => h('option', { value: a.id }, a.name)));
  const resSel = h('select', { class: 'inp', onchange: e => { f.result = e.target.value; load(); } },
    [['', 'Любой итог'], ['live', 'В сторе'], ['reject', 'Реджект'], ['pending', 'Ждёт Apple']].map(([v, l]) => h('option', { value: v, selected: v === f.result }, l)));
  const stats = h('div', { class: 'cs-row rh-stats' });
  const list = h('div', { class: 'card-box rh-list' });
  const paintSeg = () => {
    fill(seg, PERIODS.map(([id, label, n]) => h('button', { class: f.period === id ? 'on' : '', onclick: () => {
      f.period = id;
      if (n) { f.from = ago(n); f.to = day(new Date()); from.value = f.from; to.value = f.to; }
      paintSeg();
      load();
    } }, label)));
    dates.hidden = f.period !== 'custom';
  };
  const stat = (n, label, sub, tone) => h('div', { class: 'cs' + (tone ? ' ' + tone : '') }, h('div', { class: 'cs-n' }, n), h('div', { class: 'cs-label' }, label), sub && h('div', { class: 'cs-sub muted' }, sub));
  let seq = 0;
  async function load() {
    const my = ++seq;
    let d;
    try { d = await call('getReleaseHistory', { from: f.from, to: f.to, unitId: f.unitId, appId: f.appId, result: f.result }); } catch (e) { return showErr(e); }
    if (my !== seq) return;
    const s = d.stats;
    fill(stats,
      stat(s.live, 'вышло в стор'),
      stat(s.firstTryPct == null ? '—' : s.firstTryPct + '%', 'с первого раза', s.live ? `${s.firstTry} из ${s.live}` : ''),
      stat(s.rejects, plural(s.rejects, ['реджект', 'реджекта', 'реджектов']), null, s.rejects ? 'danger' : ''),
      stat(s.submitted, 'отправок в Apple', s.pending ? `ждут: ${s.pending}` : ''),
      stat(s.avgReviewDays == null ? '—' : s.avgReviewDays < 1 ? '< 1 дн.' : s.avgReviewDays + ' дн.', 'среднее ревью Apple'));
    fill(list, d.rows.length
      ? [h('div', { class: 'rh-row rh-head muted' }, h('span', null, 'Приложение'), h('span', null, 'Версия'), h('span', null, 'Отправлено'), h('span', null, 'Итог'), h('span', null, 'Ревью')),
        // карточка релиза открывается поверх всего — окно истории закрываем (не прятать карточку под ним)
        d.rows.map(x => h('button', { class: 'rh-row', onclick: () => { closeHistory(); import('./task.js').then(m => m.peekTask(x.unitId, x.taskId)); } },
          h('span', { class: 'rh-app' }, x.app ? h('b', null, x.app.name) : x.key, x.n > 1 && h('span', { class: 'muted' }, ` · попытка ${x.n}`)),
          h('span', { class: 'muted' }, x.version || '—'),
          h('span', null, fmtD(x.submittedAt)),
          h('span', { class: x.result === 'reject' ? 'danger-text' : x.result === 'live' ? 'ok-text' : 'muted', title: x.reason || '' },
            x.result === 'reject' ? `реджект №${x.rejectNo || ''}` : x.result === 'live' ? 'в сторе' : 'ждёт', x.at ? ' · ' + fmtD(x.at) : ''),
          h('span', { class: 'muted' }, x.reviewDays == null ? '—' : x.reviewDays < 1 ? '< 1 дн.' : Math.round(x.reviewDays * 10) / 10 + ' дн.')))]
      : h('p', { class: 'muted', style: { margin: 0, padding: '14px' } }, 'За период релизов нет'));
  }
  paintSeg();
  paintApps();
  const closeHistory = modal({
    title: 'История релизов',
    wide: true,
    body: [h('div', { class: 'rh-bar' }, seg, dates), h('div', { class: 'rh-filters' }, unitSel, appSel, resSel), stats, list],
    actions: [{ label: 'Закрыть' }],
  });
  load();
}
