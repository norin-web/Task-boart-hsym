/**
 * Режим разработчика (people.is_dev): обратная связь от людей, ошибки у пользователей
 * и «смотреть как» — интерфейс любого человека без перелогина.
 */
import { S, LS, ACCESS_LABELS, personById, isDev, deptById, relTime } from '../state.js';
import { $, h, icon, avatar, showErr, confirmDlg, fill, topbar } from '../ui.js';
import { feedbackInboxCard } from './feedback.js';
import { call } from '../api.js';
import { mode, localLogin } from '../data.js';
import { navigate } from '../router.js';

const ROLE_ORDER = ['superadmin', 'moderator', 'rm', 'lead', 'member'];

/** ⌥D и пункт меню: перейти в режим разработчика — в свой аккаунт разработчика (если смотрите за другого) и на его страницу. */
export function openDevPanel() {
  if (!isDev()) return;
  if (S.meId !== S.realMeId) return viewAs('');
  navigate({ view: 'dev' });
}

/** Страница режима разработчика: обратная связь и ошибки слева, «смотреть как» справа. */
export function renderDev() {
  if (!isDev()) return navigate({ view: 'home' }, { replace: true });
  if (S.meId !== S.realMeId) return viewAs(''); // режим разработчика — только из своего аккаунта
  fill($('#main'),
    topbar([h('h1', null, 'Режим разработчика')], [h('span', { class: 'muted dev-sub' }, 'Виден только вам')]),
    h('div', { class: 'view-body' }, h('div', { class: 'page dev-page' },
      h('div', { class: 'dev-col' },
        feedbackInboxCard(),
        mode === 'supabase' && errorsCard()),
      h('section', { class: 'card-box dev-card' },
        h('div', { class: 'dev-head' }, h('h3', null, 'Смотреть как'),
          S.meId !== S.realMeId && h('button', { class: 'btn ghost sm', onclick: () => viewAs('') }, icon('back', 13), 'Вернуться к себе')),
        h('p', { class: 'muted dev-note' }, mode === 'local'
          ? 'Локально — по-настоящему: права базы как у выбранного человека.'
          : 'По-настоящему: права базы как у выбранного человека. Только просмотр — изменения не сохраняются.'),
        viewAsList()))));
}

/**
 * «Смотреть как» — список: поиск и фильтр по роли сверху; группы по основной позиции (CEO — отдельно первой),
 * внутри — лиды, потом остальные. В строке: имя, роль, все позиции, у CEO — направление. Клик — интерфейс человека.
 */
function viewAsList() {
  const box = h('div', { class: 'va-list' });
  let q = '', role = '';
  const ROLE_RANK = { superadmin: 0, moderator: 1, rm: 2, lead: 3, member: 4 };
  const DIR = { design: 'Дизайн', meta: 'Меты', release: 'Релизы' };
  const people = () => S.people.filter(p => p.active);
  const posName = id => (deptById(id) || {}).name || '';
  const row = p => h('button', { class: 'va-row' + (p.id === S.meId ? ' on' : ''), 'aria-pressed': String(p.id === S.meId), onclick: () => viewAs(p.id) },
    avatar(p, 'sm'),
    h('span', { class: 'va-name' }, p.name, p.id === S.realMeId && h('span', { class: 'badge' }, 'вы')),
    h('span', { class: 'va-role r-' + p.access }, ACCESS_LABELS[p.access]),
    h('span', { class: 'muted va-pos' }, (p.positionIds || [p.positionId]).map(posName).filter(Boolean).join(', ')),
    h('span', { class: 'muted va-dir' }, p.access === 'superadmin' && p.direction ? 'направление: ' + DIR[p.direction] : ''),
    p.id === S.meId ? h('span', { class: 'va-cur' }, 'сейчас') : icon('chevron', 14));
  // поиск строится один раз (фокус не теряется), роли и список — перерисовываются
  const roles = h('div', { class: 'va-roles' });
  const listBox = h('div', { class: 'va-groups' });
  const drawRoles = () => fill(roles, [['', 'Все'], ...ROLE_ORDER.map(r => [r, ACCESS_LABELS[r]])].map(([r, label]) =>
    h('button', { class: 'fchip' + (role === r ? ' on' : ''), onclick: () => { role = r; drawRoles(); drawList(); } },
      label, h('span', { class: 'my-type-n' }, r ? people().filter(p => p.access === r).length : people().length))));
  const sorted = g => [...g].sort((a, b) => ROLE_RANK[a.access] - ROLE_RANK[b.access] || a.name.localeCompare(b.name, 'ru'));
  const drawList = () => {
    const list = people().filter(p => (!role || p.access === role) && (!q || (p.name + ' ' + (p.positionIds || []).map(posName).join(' ')).toLowerCase().includes(q)));
    // группы: CEO; дальше — по основной позиции в порядке справочника
    const groups = [];
    const ceo = list.filter(p => p.access === 'superadmin');
    if (ceo.length) groups.push(['CEO', ceo]);
    const order = [...new Set([...(S.departments || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map(d => d.id), ...list.map(p => p.positionId || '')])];
    for (const id of order) {
      const g = list.filter(p => p.access !== 'superadmin' && (p.positionId || '') === id);
      if (g.length) groups.push([posName(id) || 'Без позиции', g]);
    }
    fill(listBox, groups.length
      ? groups.map(([title, g]) => h('section', { class: 'va-group' },
        h('div', { class: 'va-gtitle' }, title, h('span', { class: 'muted' }, g.length)),
        h('div', { class: 'va-rows' }, sorted(g).map(row))))
      : h('p', { class: 'muted' }, 'Никого не нашлось'));
  };
  fill(box,
    h('div', { class: 'va-tools' },
      h('label', { class: 'my-search va-search' }, icon('search', 15),
        h('input', { type: 'search', placeholder: 'Имя или позиция', oninput: e => { q = e.target.value.trim().toLowerCase(); drawList(); } })),
      roles),
    listBox);
  drawRoles();
  drawList();
  return box;
}

/**
 * Смотреть как человек (personId '' — вернуться к себе). Локально — по-настоящему (права базы как у него),
 * в Supabase — интерфейс как у него, права остаются ваши.
 */
export async function viewAs(personId) {
  try {
    if (mode === 'local') {
      const id = personId || S.realMeId;
      await localLogin(id);
      LS.set('localActor', id);
    } else {
      await call('setViewAs', { personId: personId && personId !== S.realMeId ? personId : '' });
    }
    location.hash = personId ? '#/' : '#/dev';
    location.reload();
  } catch (e) { showErr(e); }
}

/**
 * Мониторинг: необработанные ошибки в браузерах пользователей за 7 дней (monitor.js → client_errors).
 * Одинаковые — одной строкой со счётчиком и людьми; клик — подробности (стек, адрес, версия, браузер).
 */
function errorsCard() {
  const box = h('section', { class: 'card-box dev-card' });
  const draw = list => {
    const groups = new Map();
    for (const e of list) {
      const g = groups.get(e.message) || { message: e.message, items: [], people: new Set() };
      g.items.push(e);
      if (e.personId) g.people.add(e.personId);
      groups.set(e.message, g);
    }
    const rows = [...groups.values()];
    fill(box,
      h('div', { class: 'dev-head' }, h('h3', null, 'Ошибки у пользователей'), h('span', { class: 'muted' }, 'за 7 дней'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn ghost sm', onclick: load }, icon('refresh', 13), 'Обновить'),
        list.length > 0 && h('button', { class: 'btn ghost sm', onclick: async () => {
          if (!(await confirmDlg('Список ошибок очистится у всех разработчиков.', { title: 'Очистить ошибки?', ok: 'Очистить', danger: true }))) return;
          try { await call('clearClientErrors', {}); load(); } catch (e) { showErr(e); }
        } }, icon('trash', 13), 'Очистить')),
      rows.length
        ? h('div', { class: 'err-list' }, rows.map(g => {
          const last = g.items[0];
          const det = h('pre', { class: 'err-stack', hidden: true },
            [`Адрес: ${last.url || '—'}`, `Версия: ${last.version || '—'}`, `Браузер: ${last.agent || '—'}`, '', last.stack || 'Стека нет'].join('\n'));
          return h('div', { class: 'err-row' },
            h('button', { class: 'err-main', onclick: () => { det.hidden = !det.hidden; } },
              h('span', { class: 'err-n' }, '×' + g.items.length),
              h('span', { class: 'err-msg' }, g.message),
              h('span', { class: 'muted err-meta' }, [relTime(last.at), [...g.people].map(id => (personById(id) || {}).name || 'кто-то').join(', ')].filter(Boolean).join(' · '))),
            det);
        }))
        : h('p', { class: 'muted dev-note' }, 'Ошибок нет — у всех всё работает.'));
  };
  async function load() {
    try { draw(await call('getClientErrors', { days: 7 })); } catch (e) { fill(box, h('p', { class: 'muted dev-note' }, 'Не удалось загрузить: ' + e.message)); }
  }
  fill(box, h('div', { class: 'dev-head' }, h('h3', null, 'Ошибки у пользователей')), h('p', { class: 'muted dev-note' }, 'Загружаем…'));
  load();
  return box;
}
