/**
 * Релиз (RM): карточка релиза в панели этапа «Релиз» — ход релиза кнопками (отправил в Apple → в сторе / реджект →
 * отправить снова; статус приложения меняется сам), поля приложения, ссылки из этапов команды, релизные поля.
 * Чеклист релиза — обычный чеклист этапа ниже. Настройка релизных полей и чеклиста студии — openReleaseSettings (CEO, RM).
 */
import Sortable from 'sortablejs';
import { S, canEditTask, fmtDateTime, relTime, personById, plural } from '../state.js';
import { h, icon, fill, modal, toast, showErr, field } from '../ui.js';
import { brandIcon, brandOf } from './brand.js';
import { call, send } from '../api.js';

const linkIcon = kind => (['figma', 'github', 'drive', 'meta'].includes(kind) ? kind : 'link');
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
      toast({ submit: 'Отправлено в Apple — приложение на ревью', resubmit: 'Отправлено снова', live: 'В сторе! Релиз и задача CEO закрыты' }[action]);
      Object.assign(t, r.task);
      if (onChange) onChange();
      load();
    } catch (e) { showErr(e); }
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
    const hist = rel.history || [];
    const missing = data.fields.filter(f => f.required && !values[f.id]);
    const cl = data.task.checklist || [];
    const clOpen = cl.filter(i => !i.done).length;
    const ready = !missing.length && !clOpen;
    const pm = personById(rel.pmId);
    // ход релиза: передано → в Apple → решение → в сторе (с датами)
    const steps = [
      { label: 'К отправке', done: true, at: '' },
      { label: 'В Apple', done: !!rel.submittedAt && phase !== '', at: phase !== '' ? rel.submittedAt : '' },
      { label: phase === 'rejected' ? 'Реджект №' + (rel.rejectNo || '') : 'Решение Apple', done: phase === 'rejected' || phase === 'live', bad: phase === 'rejected', at: phase === 'rejected' ? rel.rejectedAt : phase === 'live' ? rel.liveAt : '' },
      { label: 'В сторе', done: phase === 'live', at: phase === 'live' ? rel.liveAt : '' },
    ];
    const pct = { '': 8, submitted: 55, rejected: 66, live: 100 }[phase] ?? 8;
    const checkRow = (ok, label, hint) => h('div', { class: 'rl-check' + (ok ? ' ok' : '') }, icon(ok ? 'check' : 'circle', 14), h('span', null, label), hint && h('span', { class: 'muted' }, hint));
    fill(box,
      h('div', { class: 'tree-head' }, h('span', { class: 'sub-title', style: { margin: 0 } }, 'Релиз'),
        values.version && h('span', { class: 'rl-ver' }, 'v' + values.version + (values.build ? ' (' + values.build + ')' : '')),
        hist.length > 1 && h('span', { class: 'muted' }, `попытка ${hist.length}`)),
      // прогресс
      h('div', { class: 'rl-progress' + (phase === 'rejected' ? ' bad' : phase === 'live' ? ' ok' : '') }, h('div', { style: { width: pct + '%' } })),
      h('div', { class: 'rl-stepper' }, steps.map(x => h('div', { class: 'rl-st' + (x.done ? ' done' : '') + (x.bad ? ' bad' : '') },
        h('span', { class: 'rl-st-label' }, x.label), h('span', { class: 'muted rl-st-at', title: x.at ? fmtDateTime(x.at) : '' }, x.at ? fmtD(x.at) : '')))),
      // что делать сейчас
      !phase && h('div', { class: 'rl-panel' },
        rel.fixedAt && h('div', { class: 'rl-note ok' }, icon('check', 14), `Реджект №${rel.rejectNo || ''} исправили ${relTime(rel.fixedAt)} — можно отправлять снова`),
        h('div', { class: 'rl-checks' },
          checkRow(!missing.length, 'Релизные поля', missing.length ? 'не заполнено: ' + missing.map(f => f.name).join(', ') : ''),
          checkRow(!clOpen, 'Чеклист', cl.length ? `${cl.length - clOpen} из ${cl.length}` : 'пусто — можно добавить «Из шаблона» ниже')),
        editable && h('button', { class: 'btn primary rl-go', disabled: !ready, title: ready ? '' : 'Сначала поля и чеклист', onclick: async () => { await load(); step(hist.length ? 'resubmit' : 'submit'); } },
          icon('send', 15), hist.length ? 'Отправить в Apple снова' : 'Отправить в Apple')),
      phase === 'submitted' && h('div', { class: 'rl-panel' },
        h('div', { class: 'rl-wait' }, icon('eye', 16), h('b', null, 'На ревью Apple'),
          h('span', { class: 'muted' }, daysSince(rel.submittedAt) ? ` · ждёт ${daysSince(rel.submittedAt)} ${plural(daysSince(rel.submittedAt), ['день', 'дня', 'дней'])}` : ' · отправлено сегодня')),
        editable && h('div', { class: 'rl-decide' },
          h('button', { class: 'btn primary', onclick: () => step('live') }, icon('rocket', 14), 'Вышло в стор'),
          h('button', { class: 'btn danger', onclick: () => openRejectForm(t, data.app && data.app.name, data.nextRejectNo, () => { load(); if (onChange) onChange(); }) }, icon('alert', 14), 'Реджект'))),
      phase === 'rejected' && h('div', { class: 'rl-panel bad' },
        h('div', { class: 'rl-wait' }, icon('alert', 16), h('b', null, `Реджект №${rel.rejectNo || ''}`), h('span', { class: 'muted' }, ' · ' + relTime(rel.rejectedAt))),
        h('p', { class: 'rl-reason' }, rel.reason),
        rel.shot && h('a', { class: 'rl-link', href: rel.shot, target: '_blank', rel: 'noopener' }, icon('link', 13), 'Скрин реджекта'),
        h('p', { class: 'muted', style: { margin: 0, fontSize: '12.5px' } }, 'Исправляет ', h('b', null, pm ? pm.name : 'PM юнита'), ' — когда закроет задачу «Реджект №' + (rel.rejectNo || '') + '», релиз вернётся в очередь.'),
        editable && h('button', { class: 'btn', onclick: () => step('resubmit') }, icon('send', 14), 'Уже исправили — отправить снова')),
      phase === 'live' && h('div', { class: 'rl-panel ok' }, h('div', { class: 'rl-wait' }, icon('check', 16), h('b', null, 'В App Store'), h('span', { class: 'muted' }, ' · ' + fmtD(rel.liveAt) + (hist.length > 1 ? ` · с ${hist.length}-й попытки` : ' · с первой попытки')))),
      // попытки
      hist.length > 1 && h('div', { class: 'rl-sec' }, h('div', { class: 'rl-sec-title' }, 'Попытки'),
        h('div', { class: 'rl-hist' }, hist.map(x => h('div', { class: 'rl-hist-row' },
          h('span', null, '№' + x.n), h('span', { class: 'muted' }, fmtD(x.submittedAt)),
          h('span', { class: x.result === 'reject' ? 'danger-text' : x.result === 'live' ? 'ok-text' : 'muted' }, x.result === 'reject' ? `реджект №${x.rejectNo || ''}` : x.result === 'live' ? 'в сторе' : 'ждёт'),
          h('span', { class: 'muted rl-hist-why', title: x.reason || '' }, x.reason || ''))))),
      // релизные поля
      data.fields.length > 0 && h('div', { class: 'rl-sec' }, h('div', { class: 'rl-sec-title' }, 'Релизные поля'),
        h('div', { class: 'af-list' }, data.fields.map(f => valueRow(f, values[f.id] || '', editable && phase !== 'live', v => saveValue(f, v))))),
      // поля приложения и ссылки этапов
      data.app && S.appFields.some(f => data.app.info[f.id]) && h('div', { class: 'rl-sec' }, h('div', { class: 'rl-sec-title' }, 'Приложение'),
        h('div', { class: 'rl-links' }, S.appFields.filter(f => data.app.info[f.id]).map(f => f.kind === 'link'
          ? h('a', { class: 'rl-link', href: data.app.info[f.id], target: '_blank', rel: 'noopener' }, brandIcon(brandOf(f.name, data.app.info[f.id]), 13, 'link'), f.name)
          : h('span', { class: 'rl-link', title: f.name }, h('span', { class: 'muted' }, f.name + ':'), data.app.info[f.id])))),
      h('div', { class: 'rl-sec' }, h('div', { class: 'rl-sec-title' }, 'От команды'),
        data.links.length ? h('div', { class: 'rl-links' }, data.links.map(l => h('a', { class: 'rl-link', href: l.url, target: '_blank', rel: 'noopener', title: l.url },
          brandIcon(brandOf(l.name, l.kind, l.url), 13, linkIcon(l.kind)), h('span', null, l.name), h('span', { class: 'muted' }, '· ' + l.stage))))
          : h('p', { class: 'muted', style: { margin: 0, fontSize: '12.5px' } }, 'Ссылок в этапах пока нет — дизайн, сборку, метаданные команда прикрепляет к своим этапам.')),
      h('p', { class: 'hint', style: { margin: 0 } }, icon('checklist', 12), ' Чеклист релиза — ниже: «Из шаблона» подставит ваш шаблон.'));
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

/** Настройка релиза студии (CEO, RM): релизные поля (название, тип, обязательное). Чеклисты — шаблоны RM. */
export async function openReleaseSettings() {
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
      },
    }],
  });
}


/**
 * История релизов (RM, CEO, PM): сводка за период (вышло в стор, с 1-го раза, реджекты, отправки, ср. ревью Apple)
 * и список попыток с фильтрами — юнит, приложение, итог. Период: неделя / месяц / квартал / свои даты.
 */
export function openReleaseHistory() {
  const day = d => d.toISOString().slice(0, 10);
  const ago = n => day(new Date(Date.now() - n * 864e5));
  const PERIODS = [['week', 'Неделя', 7], ['month', 'Месяц', 30], ['quarter', 'Квартал', 91], ['custom', 'Свои даты', 0]];
  const f = { period: 'month', from: ago(30), to: day(new Date()), unitId: '', appId: '', result: '' };
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
    [['', 'Любой итог'], ['live', 'В сторе'], ['reject', 'Реджект'], ['pending', 'Ждёт Apple']].map(([v, l]) => h('option', { value: v }, l)));
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
