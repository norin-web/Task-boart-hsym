/**
 * Режим разработчика (people.is_dev): обратная связь от людей, ошибки у пользователей
 * и «смотреть как» — интерфейс любого человека без перелогина.
 */
import { S, LS, ACCESS_LABELS, ACCESS_HINTS, personById, isDev, deptById, relTime } from '../state.js';
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

/** Люди по ролям: клик — интерфейс этого человека. */
function viewAsList() {
  const people = S.people.filter(p => p.active).sort((a, b) => ROLE_ORDER.indexOf(a.access) - ROLE_ORDER.indexOf(b.access) || a.name.localeCompare(b.name, 'ru'));
  return h('div', { class: 'dev-roles' }, ROLE_ORDER.map(role => {
    const list = people.filter(p => p.access === role);
    return list.length > 0 && h('div', { class: 'dev-role' },
      h('div', { class: 'dev-role-name', title: ACCESS_HINTS[role] }, ACCESS_LABELS[role], h('span', { class: 'muted' }, list.length)),
      h('div', { class: 'dev-people' }, list.map(p => h('button', {
        class: 'dev-person' + (p.id === S.meId ? ' on' : ''), 'aria-pressed': String(p.id === S.meId), onclick: () => viewAs(p.id),
      }, avatar(p, 'sm'), h('span', { class: 'dev-pname' }, p.name),
      h('span', { class: 'muted dev-ppos' }, (deptById(p.positionId) || {}).name || '')))));
  }));
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
