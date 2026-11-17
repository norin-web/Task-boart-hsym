/**
 * Аккаунты (RM и CEO): этапы «Аккаунт» запросов New App. После готового дизайна RM заводит аккаунт в сторе
 * (почта, Terms / Privacy, Bundle ID, App ID, API-ключ) и прикрепляет Google Doc с данными — ссылку «Аккаунт».
 * Ссылка общая на запрос: её видят все этапы (iOS берёт бандл и ключи оттуда). Закрыть этап — только со ссылкой.
 */
import { S, unitById, personById, isStaff, fmtDate, safeUrl } from '../state.js';
import { $, h, icon, fill, topbar, toast, showErr, emptyBlock, skeleton } from '../ui.js';
import { call, send, swr } from '../api.js';
import { currentView } from '../router.js';
import { peekTask } from './task.js';
import { appIcon, openAppById } from './apps.js';
import { onRemote } from '../live.js';

const LINK = 'lf_account';
let tab = 'open';

export async function renderAccounts() {
  const body = h('div', { class: 'page ceo-page rj-page' }, skeleton());
  fill($('#main'), topbar([h('h1', null, 'Аккаунты')], []), h('div', { class: 'view-body' }, body));
  let rows = [];
  const load = () => swr('accounts', () => call('getAccounts', {}), r => { rows = r; draw(); }, { still: () => currentView() === 'accounts' }).catch(showErr);

  async function saveLink(x, url) {
    try {
      x.url = await send('setTaskLink', { taskId: x.id, fieldId: LINK, url });
      toast(x.url ? 'Ссылка прикреплена — её видят все этапы запроса' : 'Ссылка убрана');
      draw();
    } catch (e) { showErr(e); }
  }
  async function finish(x) {
    const u = unitById(x.unitId);
    const done = u && (u.settings.columns.find(c => c.kind === 'done') || {}).id;
    if (!done) return showErr(new Error('В юните нет колонки «Готово»'));
    try {
      await send('updateTask', { id: x.id, patch: { status: done } });
      toast(`Аккаунт «${x.app ? x.app.name : x.title}» готов`);
      load();
    } catch (e) { showErr(e); }
  }

  const row = x => {
    const u = unitById(x.unitId);
    const mine = x.assigneeId === S.meId;
    const side = h('div', { class: 'rj-actions' });
    // ссылка на месте: «Прикрепить Google Doc» → поле → Enter
    const editLink = () => {
      const inp = h('input', { class: 'inp sm', value: x.url, placeholder: 'https://docs.google.com/…', maxlength: 2000, style: { width: '260px' },
        onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); go(); } if (e.key === 'Escape') draw(); } });
      const go = () => { const v = inp.value.trim(); if (v === x.url) return draw(); inp.disabled = true; saveLink(x, v); };
      fill(side, inp, h('button', { class: 'btn sm primary', onclick: go }, 'Сохранить'), h('button', { class: 'btn sm', onclick: draw }, 'Отмена'));
      inp.focus();
    };
    const canEdit = !x.done && (mine || isStaff());
    fill(side,
      x.url && h('a', { class: 'btn sm', href: safeUrl(x.url), target: '_blank', rel: 'noopener noreferrer', title: x.url }, icon('link', 13), 'Google Doc'),
      canEdit && !x.blocked && (x.url
        ? h('button', { class: 'icon-btn sm', title: 'Изменить ссылку', onclick: editLink }, icon('edit', 13))
        : h('button', { class: 'btn sm', onclick: editLink }, icon('plus', 13), 'Прикрепить Google Doc')),
      canEdit && !x.blocked && x.url && h('button', { class: 'btn sm primary', onclick: () => finish(x) }, 'Готово'));
    const state = x.done ? ['ok', 'Готово' + (x.doneAt ? ' · ' + fmtDate(x.doneAt.slice(0, 10)) : '')]
      : x.blocked ? ['', 'Ждёт дизайн'] : x.url ? ['ok', 'Док прикреплён'] : ['wait', 'Можно делать'];
    const open = () => peekTask(x.unitId, x.id);
    return h('div', { class: 'rj-row' + (x.done ? ' closed' : ''), role: 'button', tabindex: '0', title: 'Открыть этап',
      onclick: e => { if (!e.target.closest('button, a, input')) open(); }, onkeydown: e => { if (e.key === 'Enter' && e.target === e.currentTarget) open(); } },
      x.app ? appIcon(x.app, 'md') : h('span'),
      h('div', { class: 'rj-main' },
        h('div', { class: 'rj-title' },
          x.app ? h('button', { class: 'link-btn rj-app', onclick: () => openAppById(x.app.id, load) }, x.app.name) : h('b', null, x.title),
          u && h('span', { class: 'rj-unit', style: { '--c': u.color } }, u.name)),
        h('div', { class: 'rj-meta' },
          h('span', null, x.key),
          x.dueDate && !x.done && h('span', null, 'срок ' + fmtDate(x.dueDate)),
          !mine && x.assigneeId && h('span', null, (personById(x.assigneeId) || {}).name || ''))),
      h('div', { class: 'rj-side' }, h('span', { class: 'rj-state ' + state[0] }, state[1]), side));
  };

  function draw() {
    const open = rows.filter(x => !x.done).sort((a, b) => (a.blocked - b.blocked) || String(a.dueDate || '9').localeCompare(String(b.dueDate || '9')) || a.createdAt.localeCompare(b.createdAt));
    const done = rows.filter(x => x.done).sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));
    const list = tab === 'open' ? open : done;
    fill(body,
      h('div', { class: 'rj-tabs', role: 'tablist' }, [['open', 'В работе', open.length], ['done', 'Готовые', done.length]].map(([id, label, n]) =>
        h('button', { class: 'fchip' + (tab === id ? ' on' : ''), role: 'tab', 'aria-selected': String(tab === id), onclick: () => { tab = id; draw(); } }, `${label}: ${n}`))),
      list.length
        ? h('div', { class: 'card-box rj-list' }, list.map(row))
        : tab === 'open'
          ? emptyBlock('Аккаунтов в работе нет', { ok: true, sub: 'Когда дизайн нового приложения будет готов, здесь появится задача завести аккаунт' })
          : emptyBlock('Готовых аккаунтов пока нет', { sub: 'Закрытые этапы «Аккаунт» со ссылкой на Google Doc' }));
  }
  load();
  onRemote(() => load(), () => currentView() === 'accounts');
}
