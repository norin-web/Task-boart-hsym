/**
 * Бэклог (CEO): идеи и ТЗ до старта работ — новое приложение или апдейт существующего.
 * «Запустить» — новое приложение в юните (запрос New App ответственному) или запрос «Апдейт»; идея уходит в «Запущенные».
 */
import { S, isSuper, fmtDate, safeUrl, appById } from '../state.js';
import { $, h, icon, fill, topbar, toast, showErr, confirmDlg, emptyBlock, skeleton, modal, field } from '../ui.js';
import { call, send } from '../api.js';
import { peekTask } from './task.js';

let tab = 'new';

export async function renderBacklog() {
  const main = $('#main');
  const body = h('div', { class: 'page ceo-page bl-page' }, skeleton());
  const addBtn = h('button', { class: 'btn primary', onclick: () => edit() }, icon('plus', 15), 'Идея');
  fill(main, topbar([h('h1', null, 'Бэклог')], [isSuper() && addBtn]), h('div', { class: 'view-body' }, body));
  let ideas = [];

  const load = async () => {
    try { ideas = await call('listIdeas', {}); draw(); } catch (e) { showErr(e); }
  };

  const appName = id => (appById(id) || {}).name || 'приложение';

  function edit(x = {}) {
    const title = h('input', { class: 'inp', value: x.title || '', maxlength: 200, placeholder: 'Например: AI-фоторедактор или «Виджеты» для пульта' });
    const desc = h('textarea', { class: 'inp', rows: 6, maxlength: 20000, placeholder: 'Идея и ТЗ: что делаем и зачем' });
    desc.value = x.description || '';
    const spec = h('input', { class: 'inp', type: 'url', value: x.specUrl || '', maxlength: 2000, placeholder: 'https://docs.google.com/… — ссылка на ТЗ' });
    let kind = x.kind || 'new_app';
    const apps = (S.apps || []).filter(a => !a.archived).sort((a, b) => a.name.localeCompare(b.name));
    const appSel = h('select', { class: 'inp', 'aria-label': 'Приложение' }, h('option', { value: '' }, '— приложение —'),
      apps.map(a => h('option', { value: a.id, selected: a.id === x.appId }, a.name)));
    const appField = field('Приложение', appSel);
    const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Что это' });
    const paint = () => {
      fill(seg, [['new_app', 'Новое приложение'], ['update', 'Апдейт']].map(([v, label]) =>
        h('button', { type: 'button', class: kind === v ? 'on' : '', role: 'radio', 'aria-checked': String(kind === v), onclick: () => { kind = v; paint(); } }, label)));
      appField.hidden = kind !== 'update';
    };
    paint();
    modal({
      title: x.id ? 'Идея' : 'Новая идея',
      cls: 'dlg',
      body: [field('Что это', seg), appField, field('Название', title), field('Описание и ТЗ', desc), field('Ссылка на ТЗ', spec, 'Необязательно')],
      actions: [{ label: 'Отмена' }, { label: 'Сохранить', primary: true, action: async close => {
        if (!title.value.trim()) { title.focus(); return; }
        await send('saveIdea', { id: x.id, kind, appId: appSel.value, title: title.value, description: desc.value, specUrl: spec.value });
        close();
        toast(x.id ? 'Идея сохранена' : 'Идея в бэклоге');
        load();
      } }],
    });
  }

  function start(x) {
    if (x.kind === 'update') {
      return confirmDlg(`Запрос «Апдейт» по «${appName(x.appId)}» уйдёт ответственному за юнит — он разложит его по этапам.`, { title: 'Запустить апдейт?', ok: 'Запустить' })
        .then(ok => ok && send('startIdea', { id: x.id }).then(res => { toast('Апдейт запущен: ' + res.request.title); load(); }).catch(showErr));
    }
    const units = (S.units || []).filter(u => !u.archived);
    const unit = h('select', { class: 'inp', 'aria-label': 'Юнит' }, units.map(u => h('option', { value: u.id }, u.name)));
    const name = h('input', { class: 'inp', value: x.title, maxlength: 120 });
    modal({
      title: 'Запустить новое приложение',
      cls: 'dlg',
      body: [h('p', { class: 'hint' }, 'Появится приложение и запрос New App ответственному за юнит — он разложит его по этапам.'),
        field('Юнит', unit), field('Название приложения', name)],
      actions: [{ label: 'Отмена' }, { label: 'Запустить', primary: true, action: async close => {
        if (!unit.value) return toast('Сначала создайте юнит', { type: 'error' });
        const res = await send('startIdea', { id: x.id, unitId: unit.value, name: name.value });
        close();
        toast('Запущено: ' + (res.request ? res.request.title : name.value));
        load();
      } }],
    });
  }

  const row = x => {
    const req = x.requestId;
    return h('div', { class: 'bl-row' + (x.status === 'started' ? ' started' : '') },
      h('span', { class: 'bl-kind ' + x.kind }, x.kind === 'update' ? 'Апдейт' : 'Новое'),
      h('div', { class: 'bl-main' },
        h('div', { class: 'bl-title' }, h('b', null, x.title), x.kind === 'update' && h('span', { class: 'muted' }, ' · ' + appName(x.appId))),
        x.description && h('div', { class: 'bl-desc' }, x.description),
        h('div', { class: 'bl-meta' },
          h('span', null, fmtDate(String(x.createdAt).slice(0, 10))),
          x.specUrl && h('a', { href: safeUrl(x.specUrl), target: '_blank', rel: 'noopener noreferrer' }, icon('link', 13), 'ТЗ'))),
      h('div', { class: 'bl-act' },
        x.status === 'started'
          ? req && h('button', { class: 'btn sm', onclick: () => openRequest(req) }, 'Открыть запрос')
          : [h('button', { class: 'btn primary sm', onclick: () => start(x) }, icon('rocket', 13), 'Запустить'),
            h('button', { class: 'icon-btn sm', title: 'Изменить', onclick: () => edit(x) }, icon('edit', 14)),
            h('button', { class: 'icon-btn sm', title: 'Удалить', onclick: async () => {
              if (!(await confirmDlg('Идея удалится из бэклога.', { title: 'Удалить идею?', ok: 'Удалить', danger: true }))) return;
              try { await send('deleteIdea', { id: x.id }); load(); } catch (e) { showErr(e); }
            } }, icon('trash', 14))]));
  };

  async function openRequest(id) {
    try {
      const [t] = await call('queryTasks', { ids: [id] });
      if (t) peekTask(t.unitId, t.id); else toast('Запрос не найден — возможно, его удалили');
    } catch (e) { showErr(e); }
  }

  function draw() {
    const fresh = ideas.filter(x => x.status !== 'started');
    const started = ideas.filter(x => x.status === 'started');
    const shown = tab === 'new' ? fresh : started;
    fill(body,
      h('div', { class: 'rj-tabs', role: 'tablist' }, [['new', 'Идеи', fresh.length], ['started', 'Запущенные', started.length]].map(([id, label, n]) =>
        h('button', { class: 'fchip' + (tab === id ? ' on' : ''), role: 'tab', 'aria-selected': String(tab === id), onclick: () => { tab = id; draw(); } }, `${label}: ${n}`))),
      shown.length
        ? h('div', { class: 'card-box bl-list' }, shown.map(row))
        : emptyBlock(tab === 'new' ? 'Идей пока нет' : 'Запущенных пока нет', { sub: tab === 'new' ? 'Запишите идею или ТЗ — запустите, когда придёт время.' : '' }));
  }
  load();
}
