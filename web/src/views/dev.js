/**
 * Режим разработчика (people.is_dev): «смотреть как» — интерфейс любого человека без перелогина,
 * быстрые сценарии, которые прогоняют флоу целиком, и удаление тестовых данных.
 * Всё, что создают шорткаты, помечено «тест»: реальные люди этого не видят и уведомлений не получают.
 * Шорткаты добавляются в SHORTCUTS.
 */
import { S, LS, ACCESS_LABELS, ACCESS_HINTS, personById, unitById, isDev, deptById } from '../state.js';
import { $, h, icon, avatar, modal, field, toast, showErr, confirmDlg, fill, topbar } from '../ui.js';
import { call } from '../api.js';
import { mode, localLogin, asSystem } from '../data.js';
import { navigate, rerender } from '../router.js';

const ROLE_ORDER = ['superadmin', 'moderator', 'rm', 'lead', 'member'];
const units = () => S.units.filter(u => !u.archived).sort((a, b) => (a.order || 0) - (b.order || 0));

/**
 * Шорткаты-сценарии: { id, title, hint, icon, run(close) }. Локально выполняются без ограничений прав
 * (за кого бы вы ни смотрели), в Supabase — с правами вашего аккаунта (CEO + режим разработчика).
 */
const SHORTCUTS = [
  {
    id: 'new_app', title: 'New App', icon: 'rocket',
    hint: 'CEO создаёт приложение → запрос PM юнита → PM раскладывает по флоу → этапы назначены исполнителям',
    run: newAppScenario,
  },
  {
    id: 'process', title: 'Демо-процесс', icon: 'layers', localOnly: true,
    hint: 'Тестовые ветки: CEO → PM → лид → сотрудники, релиз-менеджер, реджект и апдейт (по 3 задачи на стадию)',
    run: processScenario,
  },
];

/** Выполнить вызовы шортката: локально — как система (иначе права того, за кого смотрите). */
const asDev = fn => (mode === 'local' ? asSystem(fn) : fn());

/** ⌥D и пункт меню: перейти в режим разработчика — в свой аккаунт разработчика (если смотрите за другого) и на его страницу. */
export function openDevPanel() {
  if (!isDev()) return;
  if (S.meId !== S.realMeId) return viewAs('');
  navigate({ view: 'dev' });
}

/** Страница режима разработчика: шорткаты и тестовые данные слева, «смотреть как» справа. */
export function renderDev() {
  if (!isDev()) return navigate({ view: 'home' }, { replace: true });
  if (S.meId !== S.realMeId) return viewAs(''); // режим разработчика — только из своего аккаунта
  const tests = S.apps.filter(a => a.isTest).length;
  fill($('#main'),
    topbar([h('h1', null, 'Режим разработчика')], [h('span', { class: 'muted dev-sub' }, 'Виден только вам')]),
    h('div', { class: 'view-body' }, h('div', { class: 'page dev-page' },
      h('div', { class: 'dev-col' },
        h('section', { class: 'card-box dev-card' },
          h('div', { class: 'dev-head' }, h('h3', null, 'Быстрые сценарии'), h('span', { class: 'muted' }, 'всё созданное — с пометкой «тест»')),
          h('div', { class: 'dev-shortcuts' }, SHORTCUTS.filter(sc => !sc.localOnly || mode === 'local').map(sc => h('button', { class: 'dev-sc', onclick: () => sc.run() },
            h('span', { class: 'dev-sc-ic' }, icon(sc.icon, 16)),
            h('span', { class: 'dev-sc-text' }, h('b', null, sc.title), h('span', { class: 'muted' }, sc.hint)))))),
        h('section', { class: 'card-box dev-card' },
          h('div', { class: 'dev-head' }, h('h3', null, 'Тестовые данные')),
          h('div', { class: 'dev-row' },
            h('span', { class: 'muted' }, tests ? `Тестовых приложений: ${tests} — и их задачи.` : 'Тестовых данных нет.'),
            h('button', { class: 'btn danger sm', disabled: !tests, onclick: () => clearTestData() }, icon('trash', 13), 'Удалить тестовые данные')))),
      h('section', { class: 'card-box dev-card' },
        h('div', { class: 'dev-head' }, h('h3', null, 'Смотреть как'),
          S.meId !== S.realMeId && h('button', { class: 'btn ghost sm', onclick: () => viewAs('') }, icon('back', 13), 'Вернуться к себе')),
        h('p', { class: 'muted dev-note' }, mode === 'local'
          ? 'Локально — по-настоящему: права базы как у выбранного человека.'
          : 'Интерфейс как у выбранного человека; права остаются ваши.'),
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
      LS.set('viewAs', personId && personId !== S.realMeId ? personId : '');
    }
    location.hash = personId ? '#/' : '#/dev';
    location.reload();
  } catch (e) { showErr(e); }
}

async function clearTestData() {
  if (!(await confirmDlg('Удалить все тестовые приложения и задачи (созданные быстрыми сценариями)? Настоящие данные не тронутся.', { ok: 'Удалить', danger: true }))) return;
  try {
    const r = await asDev(() => call('deleteTestData', {}));
    toast(`Удалено тестовых задач: ${r.tasks}`);
    setTimeout(() => location.reload(), 700);
  } catch (e) { showErr(e); }
}

/* ---------- сценарии ---------- */

/** Демо-процесс: тестовые приложения и задачи по всей иерархии поверх текущей базы (недостающих людей и юниты добавит). */
async function processScenario(closePanel) {
  if (!(await confirmDlg('Добавить демо-процесс: 14 тестовых приложений на разных стадиях (запрос, разработка, релиз, ревью Apple, реджект, в сторе, апдейты) и задачи на досках юнитов. Недостающих людей и юниты Gold / RF / MVP добавим. Удаляется кнопкой «Удалить тестовые данные» (люди и юниты останутся).', { ok: 'Добавить', title: 'Демо-процесс' }))) return;
  if (closePanel) closePanel();
  toast('Собираем демо-процесс…');
  try {
    const { seedProcess } = await import('../demo.js');
    const n = await seedProcess();
    toast(`Демо-процесс готов: ${n} приложений`);
    setTimeout(() => { location.hash = '#/apps'; location.reload(); }, 700);
  } catch (e) { showErr(e); }
}

/** New App: приложение (тест) → запрос PM → разбивка по флоу с исполнителями. */
function newAppScenario(closePanel) {
  const list = units();
  if (!list.length) return toast('Сначала нужен юнит (Gold, RF, MVP…)', { type: 'error' });
  const n = S.apps.filter(a => a.isTest).length + 1;
  const name = h('input', { class: 'inp', value: `Test App ${n}`, maxlength: 120 });
  const unit = h('select', { class: 'inp' }, list.map(u => h('option', { value: u.id }, u.name)));
  const decompose = h('input', { type: 'checkbox', checked: true });
  modal({
    title: 'Быстрый сценарий: New App',
    body: [
      h('p', { class: 'hint', style: { marginTop: 0 } }, 'CEO создаёт приложение, запрос падает PM юнита, PM раскладывает его по флоу — этапы назначаются исполнителям.'),
      h('div', { class: 'grid2' }, field('Название', name), field('Юнит', unit)),
      h('label', { class: 'chk' }, decompose, 'Сразу разложить по флоу (шаг PM)'),
    ],
    actions: [{ label: 'Отмена' }, {
      label: 'Запустить', primary: true,
      action: async close => {
        const r = await asDev(async () => {
          const made = await call('createApp', { name: name.value, unitId: unit.value, test: true, description: 'Создано быстрым сценарием New App (режим разработчика).' });
          const stages = decompose.checked ? await call('decomposeRequest', { taskId: made.request.id }) : [];
          return { ...made, stages };
        });
        close();
        if (closePanel) closePanel();
        const u = unitById(unit.value);
        const pm = personById(r.request.assigneeId);
        const who = r.stages.filter(t => t.assigneeId).map(t => (personById(t.assigneeId) || {}).name).filter(Boolean);
        toast(`New App «${r.app.name}» в ${u ? u.name : 'юните'}: PM — ${pm ? pm.name : 'нет PM'}` + (r.stages.length ? `, ${r.stages.length} этапов${who.length ? ' (' + [...new Set(who)].join(', ') + ')' : ''}` : ''),
          { action: { label: 'Открыть', run: () => navigate({ view: 'apps' }) } });
        if (S.route.view === 'apps' || !S.route.view) rerender();
      },
    }],
  });
}
