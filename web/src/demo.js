/**
 * Демо-процесс (Tasks 2.0): рабочий процесс по иерархии — CEO ставит приложения, PM раскладывают их по этапам,
 * лиды и сотрудники делают и ревьюят, RM выпускает. Задействованы все роли и позиции, все состояния задач:
 * не начато, в работе, на ревью, готово, заблокировано, релиз у RM; статусы приложений — от разработки до реджекта.
 *   seedDemo()    — пустая локальная база: юниты Gold / RF / MVP, люди и процесс (обычные данные).
 *   seedProcess() — режим разработчика: тот же процесс поверх текущей базы, всё с пометкой «тест»
 *                   (недостающих людей и юниты добавляет). Только локальный режим.
 */
import { getBackend, asSystem } from './data.js';
import { LS } from './state.js';

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const cl = (...items) => items.map(([text, done]) => ({ text, done: !!done }));

// ключ, имя, должность, email, роль, позиция, команда, юниты
const PEOPLE = [
  ['anna', 'Анна Смирнова', 'CEO', 'anna', 'superadmin', 'd_po', 't_product', []],
  ['oleg', 'Олег Никитин', 'PM', 'oleg', 'moderator', 'd_po', 't_product', ['GLD']],
  ['kate', 'Екатерина Соколова', 'PM', 'kate', 'moderator', 'd_po', 't_product', ['RF', 'MVP']],
  ['sergey', 'Сергей Волков', 'Release Manager', 'sergey', 'rm', 'd_release', 't_release', ['GLD', 'RF', 'MVP']],
  ['masha', 'Мария Иванова', 'Lead Design', 'maria', 'lead', 'd_design', 't_design', ['GLD', 'RF', 'MVP']],
  ['dima', 'Дмитрий Козлов', 'Lead iOS', 'dima', 'lead', 'd_ios', 't_ios', ['GLD', 'RF', 'MVP']],
  ['alex', 'Алексей Морозов', 'iOS-разработчик', 'alex', 'member', 'd_ios', 't_ios', ['GLD', 'RF', 'MVP']],
  ['julia', 'Юлия Павлова', 'Дизайнер', 'julia', 'member', 'd_design', 't_design', ['GLD', 'RF', 'MVP']],
  ['ira', 'Ирина Белова', 'Тестировщик', 'irina', 'member', 'd_qa', 't_qa', ['GLD', 'RF', 'MVP']],
  ['pavel', 'Павел Орлов', 'ASO-специалист', 'pavel', 'member', 'd_aso', 't_aso', ['GLD', 'RF', 'MVP']],
];

const UNITS = [
  { name: 'Gold', key: 'GLD', color: '#d97706', description: 'Флагманские приложения: рост и удержание' },
  { name: 'RF', key: 'RF', color: '#0ea5e9', description: 'Приложения для рынка RF' },
  { name: 'MVP', key: 'MVP', color: '#10b981', description: 'Новые продукты: быстрые запуски' },
];

const makeApi = () => {
  const backend = getBackend();
  return async (method, payload, actorId = '') => {
    const r = await backend.call(method, payload, { actorId });
    if (!r.ok) throw new Error(`${method}: ${r.error}`);
    return r.data;
  };
};

/** Пустая локальная база: всё с нуля; после заполнения вы входите как Анна (CEO), режим разработчика — аккаунт «Разработчик». */
export async function seedDemo() {
  const annaId = await asSystem(async () => {
    const api = makeApi();
    const P = await addPeople(api);
    const U = {};
    for (const def of UNITS) U[def.key] = await api('createUnit', def);
    await setupUnits(api, P, U);
    await runProcess(api, P, U, false);
    return P.anna.id;
  });
  LS.set('localActor', annaId);
}

/**
 * Режим разработчика: демо-процесс поверх текущей базы — тестовые приложения и задачи (удаляются кнопкой
 * «Удалить тестовые данные»). Недостающих людей и юниты Gold / RF / MVP добавляет. Возвращает число приложений.
 */
export async function seedProcess() {
  return asSystem(async () => {
    const api = makeApi();
    const P = await addPeople(api);
    const have = Object.fromEntries((await api('bootstrap', {})).units.filter(u => !u.archived).map(u => [u.key, u]));
    const U = {};
    for (const def of UNITS) U[def.key] = have[def.key] || await api('createUnit', def);
    await setupUnits(api, P, U);
    return runProcess(api, P, U, true);
  });
}

/** Люди процесса: существующие (по email) берутся как есть, недостающие создаются. { ключ → человек } */
async function addPeople(api) {
  const boot = await api('bootstrap', {});
  const teams = new Set((boot.teams || []).map(t => t.id));
  const byEmail = Object.fromEntries(boot.people.map(p => [(p.email || '').toLowerCase(), p]));
  const P = {};
  for (const [key, name, role, email, access, positionId, team] of PEOPLE) {
    const mail = email + '@example.com';
    P[key] = byEmail[mail] || await api('createPerson', { name, role, email: mail, access, positionId, teamIds: teams.has(team) ? [team] : [] });
  }
  return P;
}

/** Состав юнитов и ревью: дизайн проверяет лид дизайна, iOS — лид iOS, остальное — PM юнита. */
async function setupUnits(api, P, U) {
  for (const [key, , , , , positionId, , units] of PEOPLE) {
    for (const k of units) await api('setMember', { unitId: U[k].id, personId: P[key].id, departmentId: positionId });
  }
  const pm = { GLD: P.oleg.id, RF: P.kate.id, MVP: P.kate.id };
  for (const [k, u] of Object.entries(U)) {
    const st = (await api('getBoard', { unitId: u.id })).unit.settings;
    if (!st.columns.some(c => c.id === 'review')) continue; // свои колонки юнита не трогаем
    await api('updateUnit', { id: u.id, settings: { ...st, review: { column: 'review', byPosition: { d_design: P.masha.id, d_ios: P.dima.id }, default: pm[k] } } });
  }
}

/**
 * Сам процесс. test — всё с пометкой «тест» (режим разработчика). Возвращает число созданных приложений.
 * Кто что делает — от имени этого человека (actorId), права обходит системный режим.
 */
async function runProcess(api, P, U, test) {
  const prio = (await api('getGlobalFields', {})).find(f => f.role === 'priority');
  const opt = name => (prio ? { [prio.id]: prio.options.find(o => o.name === name).id } : {});
  const act = (who, method, payload) => api(method, payload, P[who].id);
  const move = (id, status, who) => act(who, 'updateTask', { id, patch: { status } });
  const set = (id, patch, who) => act(who, 'updateTask', { id, patch });
  const app = (name, unit, color, extra = {}) => act('anna', 'createApp', { name, unitId: U[unit].id, color, test, ...extra });
  const steps = async (requestId, pm) => Object.fromEntries((await act(pm, 'decomposeRequest', { taskId: requestId })).map(t => [t.step, t]));
  /** Всё до релиза закрыто, PM передал релиз RM; done — RM уже выпустил. */
  const ship = async (s, pm, done) => {
    for (const k of ['design', 'ios', 'qa', 'meta']) if (s[k]) await set(s[k].id, { status: 'done' }, s[k].assigneeId ? keyOf(P, s[k].assigneeId) : pm);
    await act(pm, 'sendToRelease', { taskId: s.release.id });
    await move(s.release.id, done ? 'done' : 'in_progress', 'sergey');
  };
  let apps = 0;

  // ВЕРХ — CEO: Sleep Sounds (Gold), New App в самом разгаре.
  // СЕРЕДИНА — PM Олег раскладывает по флоу. НИЗ — дизайнер сдаёт на ревью лиду, ASO параллельно, iOS/QA/релиз ждут.
  const sleep = await app('Sleep Sounds', 'GLD', '#6366f1', { dueDate: day(40), description: 'Звуки для сна: подписка, 30 звуков на старте, виджет. Рынки — US, UK.' });
  apps++;
  const s1 = await steps(sleep.request.id, 'oleg');
  await set(s1.design.id, { assigneeId: P.julia.id, checklist: cl(['Онбординг', 1], ['Пейволл', 1], ['Плеер', 1], ['Виджет']) }, 'oleg');
  await move(s1.design.id, 'in_progress', 'julia');
  await move(s1.design.id, 'review', 'julia'); // → ревью у лида дизайна (Мария)
  await act('julia', 'addComment', { taskId: s1.design.id, text: 'Виджет догоню к четвергу, остальное можно смотреть' });
  await set(s1.meta.id, { checklist: cl(['Семантика US', 1], ['Название и подзаголовок'], ['Описание']), fields: opt('Medium') }, 'oleg');
  await move(s1.meta.id, 'in_progress', 'pavel');

  // Fitness Coach (Gold): в сторе, идёт апдейт — дизайн у лида готов, iOS в работе, QA и релиз ждут
  const fit = await app('Fitness Coach', 'GLD', '#ef4444', { requestTitle: 'Старт приложения' });
  apps++;
  const s0 = await steps(fit.request.id, 'oleg');
  await ship(s0, 'oleg', true);
  await move(fit.request.id, 'done', 'oleg');
  await act('anna', 'updateApp', { id: fit.app.id, status: 'live' });
  const upd = await act('anna', 'createRequest', { appId: fit.app.id, type: 'update', title: 'Апдейт 3.5: персональный план', dueDate: day(14),
    description: 'Персональный план тренировок на онбординге, новые достижения.' });
  const s2 = await steps(upd.id, 'oleg');
  await move(s2.design.id, 'in_progress', 'masha');
  await move(s2.design.id, 'done', 'masha');
  await set(s2.ios.id, { assigneeId: P.alex.id, fields: opt('High'), checklist: cl(['Экран плана', 1], ['Достижения'], ['Аналитика']) }, 'oleg');
  await move(s2.ios.id, 'in_progress', 'alex');

  // Calm Rain (MVP): всё сделано — PM Катя передала релиз, RM Сергей выпускает
  const calm = await app('Calm Rain', 'MVP', '#14b8a6', { dueDate: day(3), description: 'Звуки дождя: один экран, подписка.' });
  apps++;
  const s3 = await steps(calm.request.id, 'kate');
  await ship(s3, 'kate', false);
  await set(s3.release.id, { checklist: cl(['Сборка в TestFlight', 1], ['Скриншоты и мета в ASC', 1], ['Отправить на ревью']) }, 'sergey');

  // Meditation Kids (RF): выпущено, на ревью Apple
  const med = await app('Meditation Kids', 'RF', '#8b5cf6', { requestTitle: 'Старт приложения' });
  apps++;
  await ship(await steps(med.request.id, 'kate'), 'kate', true);
  await move(med.request.id, 'done', 'kate');
  await act('anna', 'updateApp', { id: med.app.id, status: 'review' });

  // Weather Pro (RF): реджект Apple — CEO ставит задачу, PM отдаёт её лиду iOS (просрочено, не начато)
  const wx = await app('Weather Pro', 'RF', '#0ea5e9', { requestTitle: 'Старт приложения' });
  apps++;
  await ship(await steps(wx.request.id, 'kate'), 'kate', true);
  await move(wx.request.id, 'done', 'kate');
  await act('anna', 'updateApp', { id: wx.app.id, status: 'reject' });
  const rej = await act('anna', 'createRequest', { appId: wx.app.id, type: 'other', title: 'Реджект: Guideline 3.1.2 — условия подписки', dueDate: day(-1),
    description: 'Apple: нет ссылок на условия подписки на пейволле. Исправить и отправить заново.' });
  await move(rej.id, 'in_progress', 'kate');
  await act('kate', 'createTask', { unitId: U.RF.id, title: 'Пейволл: ссылки на условия подписки', parentId: rej.id, appId: wx.app.id,
    assigneeId: P.dima.id, departmentId: 'd_ios', dueDate: day(-1), fields: opt('Critical'), test });

  // Habit Tracker (MVP): запрос только что пришёл — у PM во входящих, ещё не разложен
  await app('Habit Tracker', 'MVP', '#10b981', { dueDate: day(60), description: 'Трекер привычек: стрики, напоминания, виджеты.' });
  apps++;

  // НИЗ — обычные задачи сотрудников во всех состояниях
  const plain = [
    ['GLD', 'Регресс перед релизом 3.5', 'ira', 'd_qa', 'todo', 6, 'Medium'],
    ['GLD', 'Падение при открытии истории тренировок', 'alex', 'd_ios', 'review', 1, 'High'], // → ревью у лида iOS
    ['GLD', 'Ответы на отзывы за октябрь', 'pavel', 'd_aso', 'done', null, 'Low'],
    ['RF', 'Локализация скриншотов на RU', 'julia', 'd_design', 'in_progress', 4, 'Medium'],
    ['RF', 'Тест-план для Meditation Kids 1.1', 'ira', 'd_qa', 'done', null, 'Medium'],
    ['MVP', 'Исследование конкурентов: трекеры привычек', 'pavel', 'd_aso', 'in_progress', 5, 'Medium'],
    ['MVP', 'Дизайн-система для новых продуктов', 'masha', 'd_design', 'todo', 12, 'Low'],
  ];
  for (const [u, title, who, dept, status, due, p] of plain) {
    const t = await act('kate', 'createTask', { unitId: U[u].id, title, assigneeId: P[who].id, departmentId: dept, dueDate: due === null ? '' : day(due), fields: opt(p), test });
    if (status !== 'todo') {
      if (status !== 'in_progress') await move(t.id, 'in_progress', who);
      await move(t.id, status, who);
    }
  }
  return apps;
}

const keyOf = (P, id) => Object.keys(P).find(k => P[k].id === id) || 'anna';
