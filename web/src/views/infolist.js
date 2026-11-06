/**
 * Инфо-лист: быстрые ссылки по приложениям своих юнитов (Figma, GitHub…) — дублирует «Быстрый доступ» карточки.
 * Нужен не всем: CEO включает его выбранным людям и каждому отмечает поля (Настройки → Приложения → Инфо-лист).
 * Человек видит его в «Настройках» отдельным разделом.
 */
import { S, unitById, deptById, plural, safeUrl } from '../state.js';
import { h, icon, avatar, fill, modal, toast, showErr, skeleton } from '../ui.js';
import { call, send } from '../api.js';
import { appIcon } from './apps.js';

/** Включён ли инфо-лист вошедшему. */
export const hasInfoList = () => (S.infoListIds || []).includes(S.meId);

/** Окно CEO: люди — переключатель; у включённых — чипы полей. Всё сохраняется сразу. */
export async function openInfoListsEditor(onDone) {
  let rows;
  try { rows = await call('getInfoLists', {}); } catch (e) { showErr(e); return; }
  const lists = new Map(rows.map(r => [r.personId, r.fieldIds]));
  const people = S.people.filter(p => p.active).sort((a, b) => Number(lists.has(b.id)) - Number(lists.has(a.id)) || a.name.localeCompare(b.name, 'ru'));
  const box = h('div', { class: 'il-people' });
  const save = (p, on, fieldIds) => send('setInfoList', { personId: p.id, on, fieldIds })
    .then(r => {
      if (r.on) lists.set(p.id, r.fieldIds); else lists.delete(p.id);
      S.infoListIds = [...lists.keys()];
      draw();
    })
    .catch(e => { showErr(e); draw(); });

  const personRow = p => {
    const on = lists.has(p.id);
    const ids = lists.get(p.id) || [];
    const sw = h('input', { type: 'checkbox', class: 'switch', checked: on, 'aria-label': 'Инфо-лист: ' + p.name });
    // по умолчанию — все поля приложения, лишние CEO снимет
    sw.onchange = () => save(p, sw.checked, sw.checked ? S.appFields.map(f => f.id) : []);
    const pos = (deptById(p.positionId) || {}).name || '';
    return h('div', { class: 'il-person' + (on ? ' on' : '') },
      h('label', { class: 'il-person-head' }, avatar(p, 'sm'),
        h('span', { class: 'il-person-name' }, h('b', null, p.name), pos && h('small', { class: 'muted' }, pos)), sw),
      on && h('div', { class: 'il-fields', role: 'group', 'aria-label': 'Поля инфо-листа: ' + p.name },
        S.appFields.length ? S.appFields.map(f => {
          const has = ids.includes(f.id);
          return h('button', { type: 'button', class: 'fchip' + (has ? ' on' : ''), 'aria-pressed': String(has),
            onclick: () => save(p, true, has ? ids.filter(x => x !== f.id) : [...ids, f.id]) }, f.name);
        }) : h('span', { class: 'muted' }, 'Полей приложения нет — добавьте их в «Поля приложения»')));
  };
  const draw = () => fill(box, people.map(personRow));
  draw();
  modal({
    title: 'Инфо-лист',
    cls: 'dlg il-dlg',
    body: [h('p', { class: 'hint', style: { marginTop: 0 } }, 'Ссылки по приложениям своих юнитов — то же, что «Быстрый доступ» в карточке приложения. Включите тем, кому нужно, и отметьте поля. Человек увидит «Инфо-лист» у себя в настройках.'), box],
    actions: [{ label: 'Готово', primary: true }],
    onClose: () => { if (onDone) onDone(); },
  });
}

/** Ссылка коротко: домен и начало пути. */
const shortUrl = v => { try { const u = new URL(v); return (u.host.replace(/^www\./, '') + u.pathname).replace(/\/$/, ''); } catch { return v; } };

/** Ячейка поля: ссылка (открыть + скопировать) или текст. */
function cell(f, v) {
  if (!v) return h('span', { class: 'il-empty' }, '—');
  if (f.kind !== 'link') return h('span', { class: 'il-text', title: v }, v);
  const url = safeUrl(v);
  const copy = h('button', { type: 'button', class: 'icon-btn sm il-copy', title: 'Скопировать ссылку', 'aria-label': 'Скопировать ссылку ' + f.name,
    onclick: () => (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(() => toast('Ссылка скопирована')).catch(() => toast('Не удалось скопировать', { type: 'error' })) }, icon('copy', 13));
  return h('span', { class: 'il-link' },
    url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', title: v }, shortUrl(v)) : h('span', { title: v }, v), copy);
}

/** Раздел «Инфо-лист» в настройках человека. */
export function infoListSection() {
  const body = h('div', { class: 'il-body' }, skeleton());
  const q = h('input', { class: 'inp il-q', type: 'search', placeholder: 'Найти приложение', 'aria-label': 'Найти приложение' });
  let data = null;
  const draw = () => {
    if (!data) return;
    if (!data.on) { fill(body, h('p', { class: 'muted' }, 'Инфо-лист вам выключен.')); return; }
    const s = q.value.trim().toLowerCase();
    const apps = data.apps.filter(a => !s || a.name.toLowerCase().includes(s));
    const cols = `minmax(200px, 1.4fr) repeat(${data.fields.length}, minmax(180px, 1fr))`;
    fill(body,
      !data.apps.length ? h('p', { class: 'muted' }, 'В ваших юнитах пока нет приложений.')
        : h('div', { class: 'card-box il-table', role: 'table', 'aria-label': 'Инфо-лист' },
          h('div', { class: 'il-row il-head', role: 'row', style: { gridTemplateColumns: cols } },
            h('span', { role: 'columnheader' }, 'Приложение'), data.fields.map(f => h('span', { role: 'columnheader' }, f.name))),
          apps.length ? apps.map(a => h('div', { class: 'il-row', role: 'row', style: { gridTemplateColumns: cols } },
            h('span', { class: 'il-app', role: 'cell' }, appIcon(a, 'sm'),
              h('span', { class: 'il-app-name' }, h('b', null, a.name), h('small', { class: 'muted' }, (unitById(a.unitId) || {}).name || ''))),
            data.fields.map(f => h('span', { role: 'cell', class: 'il-cell' }, cell(f, a.values[f.id])))))
            : h('p', { class: 'muted il-none' }, 'Ничего не нашлось')));
  };
  q.addEventListener('input', draw);
  call('getMyInfoList', { personId: S.meId }).then(d => { data = d; draw(); }).catch(e => { fill(body); showErr(e); });
  return [
    h('div', { class: 'prefs-head' }, h('h2', null, 'Инфо-лист'),
      h('p', { class: 'muted' }, 'Ссылки по приложениям ваших юнитов. Какие поля здесь — решает CEO')),
    q, body,
  ];
}

export const infoListCount = () => { const n = (S.infoListIds || []).length; return n ? `включён у ${n} ${plural(n, ['человека', 'человек', 'человек'])}` : 'пока ни у кого'; };
