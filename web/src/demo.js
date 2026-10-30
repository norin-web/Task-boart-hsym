/**
 * Демо-процесс: 10 приложений уже в App Store, одно в разработке (разложено по этапам, идёт дизайн) и одно на ревью Apple.
 * Всё остальное — без шума: ни лишних задач, ни реджектов.
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

/** Уже в App Store: название → юнит и цвет. */
const LIVE = [
  ['Sleep Cycle - Tracker & Sounds', 'GLD', '#6366f1'], ['Calm', 'GLD', '#14b8a6'], ['Headspace: Sleep & Meditation', 'GLD', '#f59e0b'], ['Flo Cycle & Period Tracker', 'GLD', '#ec4899'],
  ['Forest: Focus for Productivity', 'RF', '#10b981'], ['Overcast Podcast App', 'RF', '#ef4444'], ['Fantastical Calendar', 'RF', '#0ea5e9'],
  ['Things 3', 'MVP', '#3b82f6'], ['Day One: Daily Journal & Diary', 'MVP', '#8b5cf6'], ['Bear Markdown Notes & Journal', 'MVP', '#64748b'],
];

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
async function runProcess(api, P, U, test) {
  const act = (who, method, payload) => api(method, payload, P[who].id);
  const set = (id, patch, who) => act(who, 'updateTask', { id, patch });
  const move = (id, status, who) => set(id, { status }, who);
  /** Закрыть этап как положено: чеклист закрыт, исполнитель — на ревью, PM юнита — «Аппрув». */
  const close = async (stage, who, pm) => {
    if ((stage.checklist || []).length) await set(stage.id, { checklist: stage.checklist.map(i => ({ ...i, done: true })) }, who);
    await act(who, 'saveDevForm', { taskId: stage.id, answers: DEV_ANSWERS }).catch(() => null); // только у этапа iOS
    await move(stage.id, 'review', who).catch(() => null);
    await act(pm, 'reviewDecision', { taskId: stage.id, approve: true });
  };
  const app = (name, unit, color, extra = {}) => act('anna', 'createApp', { name, unitId: U[unit].id, color, test, ...STORE[name], ...extra });
  const steps = async (requestId, pm) => Object.fromEntries((await act(pm, 'decomposeRequest', { taskId: requestId })).map(t => [t.step, t]));
  let apps = 0;

  // 10 приложений уже в App Store: без запросов и задач
  for (const [name, unit, color] of LIVE) {
    await app(name, unit, color, { status: 'live', noRequest: true });
    apps++;
  }

  // Ревью Apple: вся разработка позади, RM отправил сборку и ждёт ответа
  const wx = await app('CARROT Weather: Alerts & Radar', 'RF', '#0ea5e9', { requestTitle: 'Старт приложения', priority: 'o_high' });
  apps++;
  const s = await steps(wx.request.id, 'kate');
  const links = { design: ['lf_figma', 'https://figma.com/design/carrot-weather'], ios: ['lf_github', 'https://github.com/studio/carrot-weather'],
    meta: ['lf_meta', 'https://docs.google.com/document/d/carrot-weather-texts'], retext: ['lf_drive', 'https://drive.google.com/drive/folders/carrot-weather-sources'], l10n: ['lf_l10n', 'https://docs.google.com/spreadsheets/d/carrot-weather-l10n'] };
  for (const [k, [fieldId, url]] of Object.entries(links)) await act('anna', 'setTaskLink', { taskId: s[k].id, fieldId, url });
  for (const k of ['design', 'ios', 'qa', 'meta', 'retext', 'l10n']) await close(s[k], s[k].assigneeId ? keyOf(P, s[k].assigneeId) : 'kate', 'kate');
  await act('kate', 'sendToRelease', { taskId: s.release.id });
  await act('sergey', 'saveReleaseValues', { taskId: s.release.id, values: { version: '1.0', build: '101', whatsnew: 'Первый выпуск' } });
  await set(s.release.id, { checklist: ['Скриншоты и метаданные', 'Покупки в песочнице', 'Политика и условия'].map(text => ({ text, done: true })) }, 'sergey');
  await act('sergey', 'releaseStep', { taskId: s.release.id, action: 'submit' });

  // В разработке: запрос разложен по всем этапам, идёт первый — дизайн (онбординг готов), остальные ждут
  const streaks = await app('Streaks', 'MVP', '#f59e0b', { dueDate: day(45), description: 'Трекер привычек: стрики, напоминания, виджеты.' });
  apps++;
  const d = await steps(streaks.request.id, 'kate');
  await set(d.design.id, { assigneeId: P.julia.id, checklist: d.design.checklist.map((i, n) => ({ ...i, done: n === 0 })) }, 'kate');
  await move(d.design.id, 'in_progress', 'julia');
  return apps;
}

const keyOf = (P, id) => Object.keys(P).find(k => P[k].id === id) || 'anna';
