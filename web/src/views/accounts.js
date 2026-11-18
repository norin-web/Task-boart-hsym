/**
 * Аккаунты (RM и CEO): этапы «Аккаунт» запросов New App — три области на всю ширину:
 * «Заявки» (разработчик оставил заявку кнопкой в своём этапе; ждущие предыдущий этап — внизу) → «В работе» → «Готово».
 * RM прикрепляет Google Doc с данными (почта, Terms / Privacy, Bundle ID, App ID, API-ключ) — ссылку «Аккаунт»;
 * она общая на запрос: её видят все этапы. Закрыть — только со ссылкой.
 */
import { S, unitById, personById, isStaff, fmtDate, safeUrl, todayStr, plural } from '../state.js';
import { $, h, icon, fill, topbar, toast, showErr, skeleton } from '../ui.js';
import { call, send, swr } from '../api.js';
import { currentView } from '../router.js';
import { peekTask } from './task.js';
import { appIcon, openAppById } from './apps.js';
import { onRemote } from '../live.js';

const LINK = 'lf_account';
const COLS = [
  { id: 'todo', name: 'Заявки', hint: 'Разработчик оставил заявку — нужно завести аккаунт', empty: 'Новых заявок нет', color: 'var(--st-todo)', ic: 'todo' },
  { id: 'progress', name: 'В работе', hint: 'Заводится, данные — в Google Doc', empty: 'Сейчас ничего не заводится', color: 'var(--st-progress)', ic: 'progress' },
  { id: 'done', name: 'Готово', hint: 'Аккаунт заведён, док у разработки', empty: 'Готовых пока нет', color: 'var(--st-done)', ic: 'done' },
];

export async function renderAccounts() {
  const body = h('div', { class: 'acc-board' }, skeleton());
  fill($('#main'), topbar([h('h1', null, 'Аккаунты')], []), h('div', { class: 'view-body' }, h('div', { class: 'page acc-page' }, body)));
  let rows = [];
  const load = () => swr('accounts', () => call('getAccounts', {}), r => { rows = r; draw(); }, { still: () => currentView() === 'accounts' }).catch(showErr);

  const column = (u, kind) => u && (u.settings.columns.find(c => c.kind === kind) || {}).id;
  async function setStatus(x, kind, msg) {
    const st = column(unitById(x.unitId), kind);
    if (!st) return showErr(new Error('В юните нет нужной колонки'));
    try {
      await send('updateTask', { id: x.id, patch: { status: st } });
      toast(msg);
      load();
    } catch (e) { showErr(e); }
  }
  async function saveLink(x, url) {
    try {
      x.url = await send('setTaskLink', { taskId: x.id, fieldId: LINK, url });
      // заявку с доком считаем взятой в работу
      if (x.url && x.state === 'todo') { await setStatus(x, 'progress', 'Ссылка прикреплена — заявка в работе'); return; }
      toast(x.url ? 'Ссылка прикреплена — её видят все этапы запроса' : 'Ссылка убрана');
      draw();
    } catch (e) { showErr(e); }
  }

  const card = x => {
    const u = unitById(x.unitId);
    const mine = x.assigneeId === S.meId;
    const canEdit = !x.done && !x.blocked && (mine || isStaff());
    const actions = h('div', { class: 'acc-actions' });
    // ссылка на месте: «Прикрепить Google Doc» → поле → Enter
    const editLink = () => {
      const inp = h('input', { class: 'inp sm', value: x.url, placeholder: 'https://docs.google.com/…', maxlength: 2000,
        onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); go(); } if (e.key === 'Escape') paint(); } });
      const go = () => { const v = inp.value.trim(); if (v === x.url) return paint(); inp.disabled = true; saveLink(x, v); };
      fill(actions, inp, h('div', { class: 'acc-btns' }, h('button', { class: 'btn sm', onclick: paint }, 'Отмена'), h('button', { class: 'btn sm primary', onclick: go }, 'Сохранить')));
      inp.focus();
    };
    // слева — док (открыть / изменить / прикрепить), справа — следующий шаг
    const paint = () => fill(actions,
      (x.url || (canEdit && x.state !== 'todo')) && h('div', { class: 'acc-docs' },
        x.url && h('a', { class: 'btn sm acc-doc', href: safeUrl(x.url), target: '_blank', rel: 'noopener noreferrer', title: x.url }, icon('link', 13), 'Google Doc'),
        canEdit && x.state !== 'todo' && (x.url
          ? h('button', { class: 'icon-btn sm', title: 'Изменить ссылку', onclick: editLink }, icon('edit', 13))
          : h('button', { class: 'btn sm', onclick: editLink }, icon('plus', 13), 'Google Doc'))),
      canEdit && (x.state === 'todo' || x.url) && h('div', { class: 'acc-btns' },
        x.state === 'todo' && h('button', { class: 'btn sm primary', onclick: () => setStatus(x, 'progress', 'Заявка в работе') }, 'Взять в работу'),
        x.state === 'progress' && x.url && h('button', { class: 'btn sm primary', onclick: () => setStatus(x, 'done', `Аккаунт «${x.app ? x.app.name : x.title}» готов — разработке ушло уведомление`) }, 'Готово')));
    paint();
    const overdue = !x.done && x.dueDate && x.dueDate < todayStr();
    const who = personById(x.assigneeId);
    const open = () => peekTask(x.unitId, x.id);
    return h('article', { class: 'acc-card' + (x.blocked ? ' waiting' : '') + (x.done ? ' done' : ''), tabindex: '0', title: 'Открыть этап',
      onclick: e => { if (!e.target.closest('button, a, input')) open(); }, onkeydown: e => { if (e.key === 'Enter' && e.target === e.currentTarget) open(); } },
      h('div', { class: 'acc-top' },
        x.app ? appIcon(x.app, 'md') : h('span'),
        h('div', { class: 'acc-main' },
          x.app ? h('button', { class: 'link-btn acc-app', onclick: () => openAppById(x.app.id, load) }, x.app.name) : h('b', null, x.title),
          h('div', { class: 'acc-meta' },
            u && h('span', { class: 'rj-unit', style: { '--c': u.color } }, u.name),
            h('span', null, x.key)))),
      x.comment && h('div', { class: 'acc-comment', title: x.comment }, x.comment),
      h('div', { class: 'acc-sub' },
        x.blocked ? h('span', { class: 'acc-wait' }, icon('lock', 12), 'Ждёт предыдущий этап')
          : x.done ? h('span', null, 'Готово' + (x.doneAt ? ' · ' + fmtDate(x.doneAt.slice(0, 10)) : ''))
            : x.dueDate ? h('span', { class: overdue ? 'danger-text' : '' }, (overdue ? 'Просрочено · ' : 'Срок ') + fmtDate(x.dueDate)) : h('span', null, 'Без срока'),
        who && !mine && h('span', null, who.name.split(' ')[0])),
      actions);
  };

  function draw() {
    const by = { todo: [], progress: [], done: [] };
    for (const x of rows) by[x.state].push(x);
    // заявки: сначала те, что можно делать (по сроку), ждущие дизайн — ниже; готовые — свежие сверху
    by.todo.sort((a, b) => (a.blocked - b.blocked) || String(a.dueDate || '9').localeCompare(String(b.dueDate || '9')) || a.createdAt.localeCompare(b.createdAt));
    by.progress.sort((a, b) => String(a.dueDate || '9').localeCompare(String(b.dueDate || '9')));
    by.done.sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));
    fill(body, COLS.map(c => {
      const list = by[c.id];
      const waiting = c.id === 'todo' ? list.filter(x => x.blocked).length : 0;
      return h('section', { class: 'acc-col', dataset: { col: c.id }, style: { '--cc': c.color } },
        h('div', { class: 'acc-head' },
          h('span', { class: 'acc-dot' }),
          h('h2', null, c.name),
          h('span', { class: 'acc-n' }, list.length - waiting)),
        h('div', { class: 'muted acc-hint' }, c.hint, waiting > 0 && ` · ещё ${waiting} ${plural(waiting, ['ждёт', 'ждут', 'ждут'])} предыдущий этап`),
        h('div', { class: 'acc-list' }, list.length ? list.map(card) : h('div', { class: 'acc-empty' }, c.empty)));
    }));
  }
  load();
  onRemote(() => load(), () => currentView() === 'accounts');
}
