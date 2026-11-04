/**
 * Тестовый процесс: ветки по ролям, у каждой — задачи на трёх стадиях (бэклог / в работе / на выходе).
 *   A  CEO ставит и сам раскладывает         (3 приложения: запрос → разработка → очередь релиза)
 *   B  CEO ставит на PM, PM раскладывает     (3 приложения: входящее → разработка → отправлено в Apple)
 *   Q  очередь на разработку                  (4 приложения: дизайн закрыт, iOS не начат — дашборд «Готовы к разработке»)
 *   C  PM получил устно, ставит на команду   (3 задачи на доске: к выполнению / в работе / в ревью)
 *   D  задача у лида                          (3 задачи: у лида; одна раздана сотрудникам)
 *   E  задачи сотрудников                     (3 задачи на доске)
 *   R  релиз-менеджер                         (очередь, заполняет, на ревью Apple, реджект, 3 в сторе)
 *   флоу реджекта (реджект → правка → отправили снова) и флоу апдейта (запрос «Апдейт» у вышедшего приложения)
 *   seedDemo()    — пустая локальная база: юниты Gold / RF / MVP, люди и процесс (обычные данные).
 *   seedProcess() — режим разработчика: тот же процесс поверх текущей базы, всё с пометкой «тест»
 *                   (недостающих людей и юниты добавляет). Только локальный режим.
 */
import { getBackend, asSystem } from './data.js';
import { LS } from './state.js';

/** Демо-приложения из App Store: название → ссылка на стор и иконка (iTunes Search). */
const STORE = {
  'Sleep Cycle - Tracker & Sounds': { storeUrl: 'https://apps.apple.com/us/app/sleep-cycle-tracker-sounds/id320606217', iconUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/e4/f5/03/e4f503c8-58f2-2d9a-a15b-05f6d70a9198/AppIconSleepCycle-0-0-1x_U007epad-0-1-0-0-85-220.png/512x512bb.jpg' },
  'Calm': { storeUrl: 'https://apps.apple.com/us/app/calm/id571800810', iconUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/95/3e/7b/953e7b88-6a4a-c88d-fb68-7d4ee4083ec8/AppIcon-0-0-1x_U007emarketing-0-11-0-85-220.png/512x512bb.jpg' },
  'Headspace: Sleep & Meditation': { storeUrl: 'https://apps.apple.com/us/app/headspace-sleep-meditation/id493145008', iconUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/ec/20/88/ec208862-22e5-ef28-fd52-eff6151054fe/AppIcon-0-0-1x_U007epad-0-1-85-220.png/512x512bb.jpg' },
  'Forest: Focus for Productivity': { storeUrl: 'https://apps.apple.com/us/app/forest-focus-for-productivity/id866450515', iconUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/de/50/39/de5039f7-6b36-a851-b254-539e9b968109/AppIcon-0-0-1x_U007epad-0-1-0-0-sRGB-85-220.png/512x512bb.jpg' },
  'Day One: Daily Journal & Diary': { storeUrl: 'https://apps.apple.com/us/app/day-one-daily-journal-diary/id1044867788', iconUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/de/28/99/de28999a-d405-a70a-293e-306d566c81f6/AppIcon-0-0-1x_U007epad-0-1-0-sRGB-85-220.png/512x512bb.jpg' },
  'Things 3': { storeUrl: 'https://apps.apple.com/us/app/things-3/id904237743', iconUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/91/24/46/91244651-a9f2-8417-51d4-8e9c5de63f77/AppIcon-0-0-1x_U007ephone-0-0-0-1-0-0-85-220.png/512x512bb.jpg' },
  'Fantastical Calendar': { storeUrl: 'https://apps.apple.com/us/app/fantastical-calendar/id718043190', iconUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/25/48/9d/25489d17-651c-298b-bc6e-891084b59f6d/AppIcon-0-0-1x_U007epad-0-1-0-sRGB-85-220.png/512x512bb.jpg' },
  'Overcast Podcast App': { storeUrl: 'https://apps.apple.com/us/app/overcast-podcast-app/id888422857', iconUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/2e/d4/4a/2ed44a6e-ba84-ded6-5f77-9215863b8f3c/AppIcon-0-0-1x_U007epad-0-1-sRGB-85-220.png/512x512bb.jpg' },
  'Bear Markdown Notes & Journal': { storeUrl: 'https://apps.apple.com/us/app/bear-markdown-notes-journal/id1016366447', iconUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/58/b1/2d/58b12d9a-9b95-f2b4-0c78-c7be215e5b66/AppIcon-26-0-0-1x_U007epad-0-0-0-1-0-0-85-220.png/512x512bb.jpg' },
  'Flo Cycle & Period Tracker': { storeUrl: 'https://apps.apple.com/us/app/flo-cycle-period-tracker/id1038369065', iconUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/6a/de/7b/6ade7b4c-5971-411c-edf3-dfdbcdd646ab/AppIcon-0-0-1x_U007ephone-0-1-0-sRGB-85-220.png/512x512bb.jpg' },
  'CARROT Weather: Alerts & Radar': { storeUrl: 'https://apps.apple.com/us/app/carrot-weather-alerts-radar/id961390574', iconUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/0c/6e/8c/0c6e8c1d-b032-899e-4093-9a46af46d645/AppIcon-0-0-1x_U007epad-0-0-0-1-0-0-sRGB-0-85-220.png/512x512bb.jpg' },
  'Streaks': { storeUrl: 'https://apps.apple.com/us/app/streaks/id963034692', iconUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/80/c5/78/80c57847-4c05-f8b4-1a8b-3e42423e4392/orange_normal-0-0-1x_U007epad-0-1-0-85-220.png/512x512bb.jpg' },
};

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

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
  { name: 'Gold', key: 'GLD', color: '#EC9900', description: 'Флагманские приложения: рост и удержание' },
  { name: 'RF', key: 'RF', color: '#0087EA', description: 'Приложения для рынка RF' },
  { name: 'MVP', key: 'MVP', color: '#5FCD74', description: 'Новые продукты: быстрые запуски' },
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
/** Ответы демо-разработчика на опросник перед релизом. */
const DEV_ANSWERS = {
  backend: { v: 'Да' }, firebase: { v: 'Да' }, analytics: { v: 'Да', note: 'Amplitude' }, permissions: { v: 'Photos, Camera' },
  ai_providers: { v: 'OpenAI, gpt-image-2' }, ai_data: { v: 'Текстовые prompts и изображения' }, ai_storage: { v: 'Только локально' },
  ugc: { v: 'Нет' }, identifiers: { v: 'Да', note: 'device ID, IP' }, push: { v: 'Да' }, sharing: { v: 'Да' }, diagnostics: { v: 'Да', note: 'Crashlytics' },
};

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
  // аватар-маскот по роли или позиции: ceo-1, pm-1, pm-2, ios-1…
  const n = {};
  const GROUP = { superadmin: 'ceo', moderator: 'pm', rm: 'release', d_design: 'design', d_ios: 'ios', d_qa: 'qa', d_release: 'release', d_aso: 'aso' };
  for (const [key, name, role, email, access, positionId, team] of PEOPLE) {
    const mail = email + '@example.com';
    const g = GROUP[access] || GROUP[positionId];
    const avatar = g ? `preset:${g}-${((n[g] = (n[g] || 0) + 1) - 1) % ({ release: 3, aso: 2 }[g] || 5) + 1}` : '';
    P[key] = byEmail[mail] || await api('createPerson', { name, role, email: mail, access, positionId, avatar, teamIds: teams.has(team) ? [team] : [] });
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
export async function runProcess(api, P, U, test) {
  const act = (who, method, payload) => api(method, payload, P[who].id);
  const set = (id, patch, who) => act(who, 'updateTask', { id, patch });
  const move = (id, status, who) => set(id, { status }, who);
  const PM = { GLD: 'oleg', RF: 'kate', MVP: 'kate' };
  /** Закрыть этап как положено: чеклист закрыт, исполнитель — на ревью, PM юнита — «Аппрув». */
  const close = async (stage, who, pm) => {
    if ((stage.checklist || []).length) await set(stage.id, { checklist: stage.checklist.map(i => ({ ...i, done: true })) }, who);
    await act(who, 'saveDevForm', { taskId: stage.id, answers: DEV_ANSWERS }).catch(() => null); // только у этапа iOS
    await move(stage.id, 'review', who).catch(() => null);
    await act(pm, 'reviewDecision', { taskId: stage.id, approve: true });
  };
  const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const linksOf = name => ({ design: ['lf_figma', `https://figma.com/design/${slug(name)}`], ios: ['lf_github', `https://github.com/studio/${slug(name)}`],
    meta: ['lf_meta', `https://docs.google.com/document/d/${slug(name)}-texts`], retext: ['lf_drive', `https://drive.google.com/drive/folders/${slug(name)}-sources`],
    l10n: ['lf_l10n', `https://docs.google.com/spreadsheets/d/${slug(name)}-l10n`] });
  const worker = (P, id) => Object.keys(P).find(k => P[k].id === id) || 'anna';
  let apps = 0;

  /**
   * Приложение по ветке: until — докуда довести.
   *   inbox  — запрос поставлен, не разложен        dev    — дизайн готов, iOS в работе
   *   queue  — все этапы закрыты, релиз передан RM  fill   — RM заполняет релиз (поля, чеклист)
   *   apple  — отправлено в Apple                   reject — Apple отклонил (задача PM «Реджект №1»)
   *   fixed  — реджект исправлен, отправили снова   live   — вышло в App Store
   * by — кто раскладывает запрос (anna — CEO сам, иначе PM юнита).
   */
  const ship = async (name, unit, color, until, { by, priority, due, description, requestTitle } = {}) => {
    const pm = PM[unit];
    const a = await act('anna', 'createApp', { name, unitId: U[unit].id, color, test, ...STORE[name], priority, dueDate: due, description, requestTitle });
    apps++;
    if (until === 'inbox') return { app: a.app, request: a.request };
    const who = by || pm;
    const s = Object.fromEntries((await act(who, 'decomposeRequest', { taskId: a.request.id })).map(t => [t.step, t]));
    for (const [k, [fieldId, url]] of Object.entries(linksOf(name))) await act('anna', 'setTaskLink', { taskId: s[k].id, fieldId, url });
    // дизайнер: у части приложений — Юлия, у остальных — Мария (для живой таблицы «Сводка»)
    if (apps % 2 === 0 && P.julia) { await set(s.design.id, { assigneeId: P.julia.id }, who).catch(() => null); s.design.assigneeId = P.julia.id; }
    const dev = s.design;
    await set(dev.id, { checklist: dev.checklist.map((i, n) => ({ ...i, done: until !== 'design' ? true : n === 0 })) }, who).catch(() => null);
    if (until === 'design') { await move(dev.id, 'in_progress', worker(P, dev.assigneeId || P[pm].id)); return { app: a.app, request: a.request, s }; }
    // промежуточные стадии: iOS на ревью / тесты в работе / тексты в работе
    const STOP = { review: ['design'], qa: ['design', 'ios'], texts: ['design', 'ios', 'qa'] };
    if (STOP[until]) {
      for (const k of STOP[until]) await close(s[k], s[k].assigneeId ? worker(P, s[k].assigneeId) : pm, pm);
      const cur = { review: 'ios', qa: 'qa', texts: 'meta' }[until];
      const who2 = s[cur].assigneeId ? worker(P, s[cur].assigneeId) : pm;
      await move(s[cur].id, until === 'review' ? 'review' : 'in_progress', who2).catch(() => null);
      return { app: a.app, request: a.request, s };
    }
    const keys = until === 'dev' || until === 'ready' ? ['design'] : ['design', 'ios', 'qa', 'integr', 'meta', 'retext', 'l10n'];
    for (const k of keys.filter(x => s[x])) await close(s[k], s[k].assigneeId ? worker(P, s[k].assigneeId) : pm, pm);
    if (until === 'ready') return { app: a.app, request: a.request, s };  // дизайн закрыт, iOS ждёт разработчика
    if (until === 'dev') { await move(s.ios.id, 'in_progress', worker(P, s.ios.assigneeId || P[pm].id)); return { app: a.app, request: a.request, s }; }
    await act(who, 'sendToRelease', { taskId: s.release.id });
    if (until === 'queue') return { app: a.app, request: a.request, s };
    await act('sergey', 'saveReleaseValues', { taskId: s.release.id, values: { version: '1.0', build: String(100 + apps), whatsnew: 'Первый выпуск' } });
    if (until === 'fill') { await set(s.release.id, { checklist: ['Скриншоты и метаданные', 'Покупки в песочнице', 'Политика и условия'].map((text, n) => ({ text, done: n === 0 })) }, 'sergey'); return { app: a.app, request: a.request, s }; }
    await set(s.release.id, { checklist: ['Скриншоты и метаданные', 'Покупки в песочнице', 'Политика и условия'].map(text => ({ text, done: true })) }, 'sergey');
    await act('sergey', 'releaseStep', { taskId: s.release.id, action: 'submit' });
    if (until === 'apple') return { app: a.app, request: a.request, s };
    if (until === 'live') { await act('sergey', 'releaseStep', { taskId: s.release.id, action: 'live' }); return { app: a.app, request: a.request, s }; }
    const rej = await act('sergey', 'releaseStep', { taskId: s.release.id, action: 'reject', reason: '2.1 Performance: приложение падает при открытии пейволла на iPhone 15' });
    if (until === 'reject') return { app: a.app, request: a.request, s, rej };
    // fixed: PM закрывает задачу «Реджект №1», RM отправляет снова
    await move(rej.rejectRequestId, 'done', pm);
    await act('sergey', 'releaseStep', { taskId: s.release.id, action: 'resubmit' });
    return { app: a.app, request: a.request, s, rej };
  };

  // ── A. CEO ставит и сам раскладывает: GLD (PM юнита — Олег, но запрос ведёт CEO)
  await ship('Calm', 'GLD', '#14b8a6', 'inbox', { requestTitle: 'New App: Calm — запрос CEO', description: 'Ветка A: CEO поставил запрос, пока не разложен.' });
  await ship('Headspace: Sleep & Meditation', 'GLD', '#f59e0b', 'dev', { by: 'anna', priority: 'o_high', due: day(30), description: 'Ветка A: CEO сам разложил запрос; дизайн готов, iOS в работе.' });
  await ship('Sleep Cycle - Tracker & Sounds', 'GLD', '#6366f1', 'queue', { by: 'anna', description: 'Ветка A: все этапы закрыты, релиз ждёт RM.' });

  // ── B. CEO ставит на PM, PM раскладывает: RF (Екатерина)
  await ship('Forest: Focus for Productivity', 'RF', '#10b981', 'inbox', { description: 'Ветка B: запрос во входящих PM, не разложен.' });
  await ship('Overcast Podcast App', 'RF', '#ef4444', 'dev', { priority: 'o_high', due: day(21), description: 'Ветка B: PM разложил по этапам; дизайн готов, iOS в работе.' });
  await ship('Fantastical Calendar', 'RF', '#0ea5e9', 'apple', { description: 'Ветка B: PM передал в релиз, сборка в ревью Apple.' });

  // ── Очередь на разработку: дизайн закрыт, iOS ещё не начат (дашборд «Готовы к разработке»)
  await ship('Halide Mark II', 'GLD', '#f97316', 'ready', { due: day(35), description: 'Очередь: дизайн готов, ждёт разработчика.' });
  await ship('Ulysses Writing App', 'RF', '#06b6d4', 'ready', { priority: 'o_high', due: day(28), description: 'Очередь: дизайн готов, ждёт разработчика.' });
  await ship('Pixelmator Photo', 'RF', '#a855f7', 'ready', { description: 'Очередь: дизайн готов, ждёт разработчика.' });
  await ship('Carbon Notes', 'MVP', '#22c55e', 'ready', { due: day(40), description: 'Очередь: дизайн готов, ждёт разработчика.' });

  await ship('Timery Time Tracker', 'GLD', '#ef4444', 'review', { description: 'Сводка: iOS на ревью у лида.' });
  await ship('Fitbod Workouts', 'RF', '#14b8a6', 'qa', { description: 'Сводка: разработка закрыта, тесты в работе.' });
  await ship('Reeder Feed Reader', 'MVP', '#3b82f6', 'texts', { description: 'Сводка: тексты в работе.' });

  // ── R. Релиз-менеджер: очередь / заполняет / Apple / реджект / в сторе ×3
  await ship('Things 3', 'MVP', '#3b82f6', 'queue', { description: 'Ветка RM: релиз передан, RM ещё не начал.' });
  await ship('Day One: Daily Journal & Diary', 'MVP', '#8b5cf6', 'fill', { description: 'Ветка RM: поля заполнены, чеклист в процессе.' });
  await ship('Bear Markdown Notes & Journal', 'MVP', '#64748b', 'apple', { description: 'Ветка RM: отправлено в Apple, ждём ответ.' });
  await ship('Flo Cycle & Period Tracker', 'GLD', '#ec4899', 'reject', { description: 'Ветка RM / флоу реджекта: Apple отклонил, у PM задача «Реджект №1».' });
  // флоу реджекта до конца: отклонили → исправили → отправили снова
  await ship('Todoist', 'RF', '#ef4444', 'fixed', { description: 'Флоу реджекта: реджект №1 исправлен, RM отправил сборку снова.' });
  const live1 = await ship('CARROT Weather: Alerts & Radar', 'RF', '#0ea5e9', 'live', { description: 'Ветка RM: вышло в App Store.' });
  const live2 = await ship('Streaks', 'MVP', '#f59e0b', 'live', { description: 'Ветка RM: вышло в App Store.' });
  await ship('Notability', 'GLD', '#6366f1', 'live', { description: 'Ветка RM: вышло в App Store.' });

  // ── Флоу апдейта: у вышедшего приложения запрос «Апдейт» (дизайн → iOS → тесты → релиз)
  const update = async (a, unit, until) => {
    const pm = PM[unit];
    const r = await act('anna', 'createRequest', { appId: a.id, type: 'update', title: `Новые виджеты: ${a.name}`, description: 'Новые виджеты и правки пейволла.', dueDate: day(14), pmId: P[pm].id });
    const s = Object.fromEntries((await act(pm, 'decomposeRequest', { taskId: r.id })).map(t => [t.step, t]));
    await close(s.design, s.design.assigneeId ? worker(P, s.design.assigneeId) : pm, pm);
    if (until === 'dev') { await move(s.ios.id, 'in_progress', worker(P, s.ios.assigneeId || P[pm].id)); return; }
    for (const k of ['ios', 'qa', 'integr'].filter(x => s[x])) await close(s[k], s[k].assigneeId ? worker(P, s[k].assigneeId) : pm, pm);
    await act(pm, 'sendToRelease', { taskId: s.release.id });
    await act('sergey', 'saveReleaseValues', { taskId: s.release.id, values: { version: '1.1', build: '210', whatsnew: 'Виджеты и исправления' } });
    await set(s.release.id, { checklist: ['Скриншоты и метаданные', 'Покупки в песочнице', 'Политика и условия'].map(text => ({ text, done: true })) }, 'sergey');
    await act('sergey', 'releaseStep', { taskId: s.release.id, action: 'submit' });
    if (until === 'live') await act('sergey', 'releaseStep', { taskId: s.release.id, action: 'live' });
  };
  await update(live1.app, 'RF', 'dev');   // апдейт в работе
  await update(live2.app, 'MVP', 'live'); // апдейт прошёл весь путь и вышел

  // ── Обычные задачи на доске юнита: к выполнению / в работе / в ревью
  const task = (unit, who, title, assignee, extra = {}) => act(who, 'createTask', { unitId: U[unit].id, title, assigneeId: P[assignee].id, test, ...extra });
  const trio = async (unit, who, rows) => {
    const made = [];
    for (const [title, assignee, state, extra] of rows) {
      const t = await task(unit, who, title, assignee, extra);
      if (state !== 'todo') await move(t.id, 'in_progress', assignee);
      if (state === 'review') await move(t.id, 'review', assignee);
      made.push(t);
    }
    return made;
  };
  // C. PM получил устно и ставит на команду (MVP, Екатерина)
  await trio('MVP', 'kate', [
    ['Поправить копирайт на экране оплаты', 'julia', 'todo', { dueDate: day(5), description: 'Ветка C: PM получил задачу устно.' }],
    ['Обновить иконки таб-бара', 'julia', 'progress', { dueDate: day(3), description: 'Ветка C: PM получил задачу устно.' }],
    ['Исправить переход с онбординга на пейволл', 'alex', 'review', { dueDate: day(2), description: 'Ветка C: PM получил задачу устно.' }],
  ]);
  // D. Задача у лида iOS (GLD): одну из них лид раздаёт сотрудникам
  await trio('GLD', 'oleg', [
    ['Оценить миграцию на SwiftData', 'dima', 'todo', { dueDate: day(10), description: 'Ветка D: задача у лида.' }],
    ['Подготовить релизную ветку 2.4', 'dima', 'progress', { dueDate: day(6), description: 'Ветка D: лид раздаёт сотрудникам.' }],
    ['Ревью архитектуры нового модуля', 'dima', 'review', { dueDate: day(4), description: 'Ветка D: задача у лида.' }],
  ]);
  // лид сам ставит подзадачи сотруднику (раздача через splitTask требует настоящего входа, в демо — обычные задачи)
  for (const [title, due] of [['Собрать changelog релиза 2.4', 4], ['Прогнать smoke-тесты на сборке', 5]]) await task('GLD', 'dima', title, 'alex', { dueDate: day(due), description: 'Ветка D: лид раздал сотруднику.' });
  // E. Задачи сотрудников (GLD)
  await trio('GLD', 'oleg', [
    ['Нарисовать пустое состояние списка', 'julia', 'todo', { dueDate: day(7), description: 'Ветка E: задача сотрудника.' }],
    ['Реализовать виджет «Сегодня»', 'alex', 'progress', { dueDate: day(8), description: 'Ветка E: задача сотрудника.' }],
    ['Написать тест-кейсы на покупки', 'ira', 'review', { dueDate: day(3), description: 'Ветка E: задача сотрудника.' }],
  ]);
  // чтобы у лидов дизайна, QA и ASO тоже была очередь ревью и загрузка людей
  await trio('GLD', 'oleg', [
    ['Нарисовать иконки для виджетов', 'julia', 'review', { dueDate: day(1), description: 'Ревью у лида дизайна.' }],
    ['Макет экрана подписки', 'julia', 'progress', { dueDate: day(6), description: 'Задача дизайнера в работе.' }],
    ['Подготовить скриншоты для App Store', 'pavel', 'review', { dueDate: day(2), description: 'Ревью у лида ASO.' }],
    ['Описание и ключевые слова для ASO', 'pavel', 'progress', { dueDate: day(4), description: 'Задача ASO в работе.' }],
    ['Регресс-тест перед релизом', 'ira', 'progress', { dueDate: day(1), description: 'Задача тестировщика в работе.' }],
  ]);
  // F. Для дашбордов: просрочка и решения ревью (принято / вернули) — у сотрудников видно, куда кликать
  await task('GLD', 'oleg', 'Согласовать тексты пейволла', 'julia', { dueDate: day(-3), description: 'Просрочено: у сотрудника и в «Требует внимания».' });
  const late = await task('GLD', 'oleg', 'Собрать сборку для тестировщиков', 'alex', { dueDate: day(-1), description: 'Просрочено: в работе.' });
  await move(late.id, 'in_progress', 'alex');
  for (const [title, approve, comment] of [['Починить анимацию перехода на пейволл', true, 'Всё хорошо, принято'], ['Поправить отступы на экране настроек', false, 'Поправьте отступы по макету']]) {
    const t = await task('GLD', 'oleg', title, 'alex', { dueDate: day(2), description: 'Решение ревью: сотрудник видит результат в «Отправлено на ревью».' });
    await move(t.id, 'in_progress', 'alex');
    await move(t.id, 'review', 'alex');
    await act('dima', 'reviewDecision', { taskId: t.id, approve, comment });
  }
  return apps;
}
