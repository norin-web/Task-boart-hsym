/**
 * Демо-данные для локального режима: 6 человек, 3 команды, 17 задач.
 * В режиме Supabase не используется — там данные команды настоящие.
 */
import { getBackend, asSystem } from './data.js';
import { LS } from './state.js';

const D = { aso: 'd_aso', design: 'd_design', ios: 'd_ios', qa: 'd_qa', other: 'd_other' };
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const cl = (...items) => items.map(([text, done]) => ({ text, done: !!done }));

// ключ, имя, должность, email, роль, позиция
const PEOPLE = [
  ['anna', 'Анна Смирнова', 'Head of Product', 'anna', 'superadmin', ''],
  ['oleg', 'Олег Никитин', 'Руководитель направления', 'oleg', 'moderator', ''],
  ['dima', 'Дмитрий Козлов', 'iOS-разработчик', 'dima', 'member', 'd_ios'],
  ['masha', 'Мария Иванова', 'Дизайнер', 'maria', 'member', 'd_design'],
  ['pavel', 'Павел Орлов', 'ASO-специалист', 'pavel', 'member', 'd_aso'],
  ['ira', 'Ирина Белова', 'Тестировщик', 'irina', 'member', 'd_qa'],
];

const UNITS = [
  {
    unit: { name: 'Alpha', key: 'ALP', color: '#6366f1', description: 'Команда фитнес-приложения: рост и удержание' },
    columns: [
      { id: 'todo', name: 'To Do', kind: 'todo' },
      { id: 'in_progress', name: 'In Progress', kind: 'progress' },
      { id: 'review', name: 'Review', kind: 'progress', color: '#8b5cf6' },
      { id: 'done', name: 'Done', kind: 'done' },
    ],
    team: [['dima', 'ios'], ['masha', 'design'], ['pavel', 'aso'], ['ira', 'qa']],
    tasks: [
      { title: 'Обновить скриншоты в App Store под iOS 26', status: 'in_progress', who: 'masha', due: 3, prio: 'High',
        desc: 'Новый стиль Liquid Glass. Нужны 6.9" и 6.5" размеры, RU и EN.\nРеференсы: https://example.com/refs',
        cl: cl(['Концепт первого экрана', 1], ['Отрисовать 5 экранов', 1], ['Локализация EN'], ['Экспорт во всех размерах']),
        comments: [['pavel', 'Первый экран — оффер со скидкой, по тестам он лучше конвертит'], ['masha', 'Ок, пересоберу к среде']] },
      { title: 'Семантика: новые ключи для US', who: 'pavel', status: 'todo', due: -2, prio: 'High', dept: 'aso' },
      { title: 'A/B-тест иконки', status: 'review', who: 'pavel', due: 5, prio: 'Medium',
        cl: cl(['Три варианта иконки', 1], ['Запустить Product Page Optimization', 1], ['Собрать результаты']) },
      { title: 'Экран онбординга: персональный план', status: 'in_progress', who: 'dima', due: 6, prio: 'High',
        cl: cl(['Вёрстка SwiftUI', 1], ['Анимации'], ['Аналитика событий']), comments: [['anna', 'Не забудь событие onboarding_completed']] },
      { title: 'Макеты paywall v2', status: 'review', who: 'masha', due: 1, prio: 'Medium' },
      { title: 'Падение при открытии истории тренировок', status: 'todo', who: 'dima', due: -1, prio: 'High',
        desc: 'Crashlytics: EXC_BAD_ACCESS в HistoryViewModel, 2.3% сессий на iOS 26.0.' },
      { title: 'Ответы на отзывы за сентябрь', status: 'done', who: 'pavel', prio: 'Low' },
      { title: 'Проверить онбординг на iPhone SE', status: 'todo', who: 'ira', due: 4, prio: 'Medium', comments: [['ira', 'Нужна тестовая сборка']] },
      { title: 'Релиз 3.4 в App Store', status: 'done', who: 'dima', prio: 'High' },
    ],
  },
  {
    unit: { name: 'Bravo', key: 'BRV', color: '#ec4899', description: 'Команда медитаций: новый продукт с нуля' },
    team: [['dima', 'ios'], ['masha', 'design'], ['pavel', 'aso']],
    tasks: [
      { title: 'MVP: плеер медитаций', status: 'in_progress', who: 'dima', due: 9, prio: 'High',
        cl: cl(['Фоновое воспроизведение', 1], ['Таймер сна'], ['Виджет на экран блокировки']) },
      { title: 'Дизайн-система: цвета и типографика', status: 'in_progress', who: 'masha', due: 4, prio: 'Medium' },
      { title: 'Название и ключевые слова для стора', status: 'todo', who: 'pavel', due: 12, prio: 'Medium' },
      { title: 'Тест-план для MVP', status: 'todo', dept: 'qa', due: 7, prio: 'Low' },
      { title: 'Подписки: StoreKit 2', status: 'todo', who: 'dima', prio: 'High' },
      { title: 'Исследование конкурентов', status: 'done', who: 'pavel', prio: 'Medium' },
    ],
  },
  {
    unit: { name: 'Charlie', key: 'CHR', color: '#10b981', description: 'Команда поддержки и развития старых приложений' },
    team: [['dima', 'ios'], ['ira', 'qa']],
    tasks: [
      { title: 'Обновить SDK аналитики во всех приложениях', status: 'in_progress', who: 'dima', due: 2, prio: 'Medium' },
      { title: 'Регресс перед релизом 2.8', status: 'todo', who: 'ira', due: 10, prio: 'Medium' },
      { title: 'Миграция на Swift 6', status: 'todo', prio: 'Medium', dept: 'ios' },
    ],
  },
];

/** Заполняет пустую локальную базу и делает текущим пользователем Анну (супер-админ). */
export async function seedDemo() {
  const annaId = await asSystem(seed);
  LS.set('localActor', annaId);
}

async function seed() {
  const backend = getBackend();
  const api = async (method, payload, actorId = '') => {
    const r = await backend.call(method, payload, { actorId });
    if (!r.ok) throw new Error(`${method}: ${r.error}`);
    return r.data;
  };

  const P = {};
  for (const [key, name, role, email, access, positionId] of PEOPLE) {
    P[key] = await api('createPerson', { name, role, email: email + '@example.com', access, positionId });
  }

  for (const def of UNITS) {
    const u = await api('createUnit', def.unit);
    if (def.columns) await api('updateUnit', { id: u.id, settings: { ...u.settings, columns: def.columns } });
    for (const [who, dept] of def.team) await api('setMember', { unitId: u.id, personId: P[who].id, departmentId: D[dept] });
    const prio = (await api('getBoard', { unitId: u.id })).fields.find(f => f.name === 'Приоритет');
    const opt = name => prio.options.find(o => o.name === name).id;
    for (const t of def.tasks) {
      const task = await api('createTask', {
        unitId: u.id, title: t.title, description: t.desc || '', status: t.status || 'todo',
        assigneeId: t.who ? P[t.who].id : '', departmentId: t.dept ? D[t.dept] : '',
        dueDate: t.due === undefined ? '' : day(t.due), fields: t.prio ? { [prio.id]: opt(t.prio) } : {}, checklist: t.cl || [],
      }, P.anna.id);
      for (const [who, text] of t.comments || []) await api('addComment', { taskId: task.id, text }, P[who].id);
    }
  }
  return P.anna.id;
}
