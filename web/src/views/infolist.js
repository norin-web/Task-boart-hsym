/**
 * Инфо-лист: быстрые ссылки по приложениям своих юнитов (Figma, GitHub…) — дублирует «Быстрый доступ» карточки.
 * Нужен не всем: CEO включает его выбранным людям и каждому отмечает поля (Настройки → Приложения → Инфо-лист).
 * Человек видит его в «Настройках» отдельным разделом.
 */
import { S, me, unitById, deptById, plural, safeUrl, isSuper } from '../state.js';
import { $, h, icon, avatar, fill, modal, toast, showErr, skeleton, topbar } from '../ui.js';
import { navigate } from '../router.js';
import { call, send } from '../api.js';
import { appIcon } from './apps.js';
import { brandIcon, brandOf } from './brand.js';
import { renderSidebar } from './sidebar.js';

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

  // «+ Поле»: новое поле-ссылка для всех приложений (как в «Поля приложения») — и сразу в инфо-лист этому человеку
  const addField = async (p, name) => {
    name = String(name || '').trim().slice(0, 40);
    if (!name) { draw(); return; }
    const same = S.appFields.find(f => f.name.toLowerCase() === name.toLowerCase());
    try {
      let id = same && same.id;
      if (!same) {
        const before = new Set(S.appFields.map(f => f.id));
        S.appFields = await send('saveAppFields', { fields: [...S.appFields, { name, kind: 'link' }] });
        id = (S.appFields.find(f => !before.has(f.id)) || {}).id;
        toast(`Поле «${name}» добавлено всем приложениям — ссылки заполняются в карточке, в «Быстром доступе»`);
      }
      const ids = lists.get(p.id) || [];
      if (id && !ids.includes(id)) await save(p, true, [...ids, id]); else draw();
    } catch (e) { showErr(e); }
  };

  /** «+ Поле» — по клику превращается в поле ввода прямо в строке: Enter — добавить, Esc или пусто — отмена. */
  const addChip = p => {
    const btn = h('button', { type: 'button', class: 'fchip il-add', title: 'Новое поле для всех приложений' }, icon('plus', 13), 'Поле');
    btn.onclick = () => {
      const inp = h('input', { class: 'inp il-add-inp', maxlength: 40, placeholder: 'Например, GitHub', 'aria-label': 'Название нового поля', 'data-esc-local': '' });
      let done = false;
      const finish = ok => { if (done) return; done = true; if (ok) addField(p, inp.value); else draw(); };
      inp.onkeydown = e => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      };
      inp.onblur = () => finish(!!inp.value.trim());
      btn.replaceWith(inp);
      inp.focus();
    };
    return btn;
  };

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
        S.appFields.map(f => {
          const has = ids.includes(f.id);
          return h('button', { type: 'button', class: 'fchip' + (has ? ' on' : ''), 'aria-pressed': String(has),
            onclick: () => save(p, true, has ? ids.filter(x => x !== f.id) : [...ids, f.id]) }, f.name);
        }),
        addChip(p)));
  };
  const draw = () => fill(box, people.map(personRow));
  draw();
  modal({
    title: 'Инфо-лист',
    cls: 'dlg il-dlg',
    body: [h('p', { class: 'hint', style: { marginTop: 0 } }, 'Ссылки по приложениям своих юнитов — то же, что «Быстрый доступ» в карточке приложения. Включите тем, кому нужно, и отметьте поля; нет нужного — «+ Поле». Человек увидит «Инфо-лист» у себя в настройках.'), box],
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
  // ссылка — чипом, как в «Сводке»: значок сервиса и название поля; полный адрес — в подсказке
  return h('span', { class: 'il-link' },
    url ? h('a', { class: 'rd-link rd-link-chip', href: url, target: '_blank', rel: 'noopener noreferrer', title: v },
      brandIcon(brandOf(v) || brandOf(f.name), 14, 'link'), h('span', null, String(f.name || shortUrl(v)).replace(/^Google\s+/i, '')))
      : h('span', { title: v }, v), copy);
}

/** Таблица, поиск и переключатель «В меню слева» — общие для раздела настроек и отдельной страницы. */
function infoListParts() {
  const body = h('div', { class: 'il-body' }, skeleton());
  const q = h('input', { class: 'inp il-q', type: 'search', placeholder: 'Найти приложение', 'aria-label': 'Найти приложение' });
  let data = null;
  const draw = () => {
    if (!data) return;
    if (!data.on) { fill(body, h('p', { class: 'muted' }, isSuper() ? 'Отметьте колонки выше — появится таблица.' : 'Инфо-лист вам выключен.')); return; }
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
  const load = () => call('getMyInfoList', { personId: S.meId }).then(d => { data = d; draw(); drawOwn(); }).catch(e => { fill(body); showErr(e); });
  // CEO настраивает свой инфо-лист сам: какие поля-колонки показывать; «Кому включён» — остальным
  const own = h('div', { class: 'il-own' });
  const drawOwn = () => {
    if (!isSuper()) return;
    const ids = data && data.on ? data.fields.map(f => f.id) : [];
    const set = next => send('setInfoList', { personId: S.meId, on: true, fieldIds: next })
      .then(r => { S.infoListIds = [...new Set([...(S.infoListIds || []), S.meId])]; return r; }).then(load).catch(showErr);
    fill(own,
      h('div', { class: 'il-fields', role: 'group', 'aria-label': 'Мои колонки' },
        h('span', { class: 'muted il-own-label' }, 'Колонки:'),
        S.appFields.map(f => {
          const has = ids.includes(f.id);
          return h('button', { type: 'button', class: 'fchip' + (has ? ' on' : ''), 'aria-pressed': String(has),
            onclick: () => set(has ? ids.filter(x => x !== f.id) : [...ids, f.id]) }, f.name);
        })),
      h('button', { type: 'button', class: 'btn ghost sm', onclick: () => openInfoListsEditor(load) }, icon('users', 14), 'Кому включён'));
  };
  load();
  // пункт «Инфо-лист» в меню слева — личная настройка человека
  const p = me();
  const nav = h('input', { type: 'checkbox', class: 'switch', checked: !!(p && (p.prefs || {}).infoListNav), 'aria-label': 'Показывать «Инфо-лист» в меню слева' });
  nav.onchange = () => {
    if (!p) return;
    const on = nav.checked;
    p.prefs = { ...(p.prefs || {}), infoListNav: on };
    renderSidebar();
    send('setMyPrefs', { personId: p.id, prefs: { infoListNav: on } })
      .then(() => toast(on ? '«Инфо-лист» добавлен в меню слева' : '«Инфо-лист» убран из меню слева'))
      .catch(e => { nav.checked = !on; p.prefs = { ...(p.prefs || {}), infoListNav: !on }; renderSidebar(); showErr(e); });
  };
  return { q, body, own, navSwitch: h('label', { class: 'il-nav' }, h('span', null, 'В меню слева'), nav) };
}
const IL_SUB = 'Ссылки по приложениям ваших юнитов. Какие поля здесь — решает CEO';
const IL_SUB_CEO = 'Ссылки по приложениям всех юнитов. Какие колонки показывать — отметьте ниже';
const ilSub = () => (isSuper() ? IL_SUB_CEO : IL_SUB);

/** Раздел «Инфо-лист» в настройках человека. */
export function infoListSection() {
  const { q, body, own, navSwitch } = infoListParts();
  return [
    h('div', { class: 'prefs-head il-headrow' }, h('div', null, h('h2', null, 'Инфо-лист'), h('p', { class: 'muted' }, ilSub())), navSwitch),
    own, q, body,
  ];
}

/** Отдельная страница #/info — сюда ведёт пункт «Инфо-лист» в меню слева. */
export function renderInfoList() {
  if (!hasInfoList()) { navigate({ view: 'home' }, { replace: true }); return; }
  const { q, body, own, navSwitch } = infoListParts();
  fill($('#main'), topbar([h('h1', null, 'Инфо-лист')], [navSwitch]),
    h('div', { class: 'view-body' }, h('div', { class: 'page il-page' }, h('p', { class: 'muted il-sub' }, ilSub()), own, q, body)));
}

export const infoListCount = () => { const n = (S.infoListIds || []).length; return n ? `включён у ${n} ${plural(n, ['человека', 'человек', 'человек'])}` : 'пока ни у кого'; };
