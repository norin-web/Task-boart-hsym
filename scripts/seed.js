// Демо-данные: npm run seed (только в пустую базу) или npm run seed -- --reset (стирает базу).
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';

const dir = path.resolve(process.env.DATA_DIR || 'data');
const file = path.join(dir, 'tasks.db');
fs.mkdirSync(dir, { recursive: true });
if (process.argv.includes('--reset')) for (const f of [file, file + '-wal', file + '-shm']) fs.rmSync(f, { force: true });

const { call } = createApi(openDb(file));
const api = (m, p, ctx) => {
  const r = call(m, p, ctx);
  if (!r.ok) throw new Error(`${m}: ${r.error}`);
  return r.data;
};

if (api('bootstrap', {}).units.length) {
  console.log('В базе уже есть данные. Чтобы пересоздать: npm run seed -- --reset');
  process.exit(0);
}

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const as = p => ({ actorId: p.id });
const cl = (...items) => items.map(([text, done]) => ({ text, done: !!done }));
const D = { aso: 'd_aso', design: 'd_design', ios: 'd_ios', other: 'd_other' };

const P = {};
for (const [key, name, role, email] of [
  ['anna', 'Анна Смирнова', 'Head of Product', 'anna'],
  ['dima', 'Дмитрий Козлов', 'iOS-разработчик', 'dima'],
  ['masha', 'Мария Иванова', 'Дизайнер', 'maria'],
  ['pavel', 'Павел Орлов', 'ASO-специалист', 'pavel'],
  ['ira', 'Ирина Белова', 'iOS-разработчик', 'irina'],
  ['oleg', 'Олег Никитин', 'Аналитик', 'oleg'],
]) P[key] = api('createPerson', { name, role, email: email + '@example.com' });

function unit(def, team, tasks) {
  const u = api('createUnit', def.unit);
  if (def.columns) {
    const st = api('getBoard', { unitId: u.id }).unit.settings;
    api('updateUnit', { id: u.id, settings: { ...st, columns: def.columns } });
  }
  for (const [who, dept] of team) api('setMember', { unitId: u.id, personId: P[who].id, departmentId: D[dept] });
  const prio = api('getBoard', { unitId: u.id }).fields.find(f => f.name === 'Приоритет');
  const opt = name => prio.options.find(o => o.name === name).id;
  for (const t of tasks) {
    const task = api('createTask', {
      unitId: u.id, title: t.title, description: t.desc || '', status: t.status || 'todo',
      assigneeId: t.who ? P[t.who].id : '', departmentId: t.dept ? D[t.dept] : '',
      dueDate: t.due === undefined ? '' : day(t.due), fields: t.prio ? { [prio.id]: opt(t.prio) } : {}, checklist: t.cl || [],
    }, as(P.anna));
    for (const [who, text] of t.comments || []) api('addComment', { taskId: task.id, text }, as(P[who]));
  }
  return u;
}

unit({
  unit: { name: 'Alpha', key: 'ALP', color: '#6366f1', description: 'Команда фитнес-приложения: рост и удержание' },
  columns: [
    { id: 'todo', name: 'To Do', kind: 'todo' },
    { id: 'in_progress', name: 'In Progress', kind: 'progress' },
    { id: 'review', name: 'Review', kind: 'progress', color: '#8b5cf6' },
    { id: 'done', name: 'Done', kind: 'done' },
  ],
}, [['anna', 'other'], ['dima', 'ios'], ['masha', 'design'], ['pavel', 'aso']], [
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
  { title: 'Релиз 3.4 в App Store', status: 'done', who: 'dima', prio: 'High' },
]);

unit({
  unit: { name: 'Bravo', key: 'BRV', color: '#ec4899', description: 'Команда медитаций: новый продукт с нуля' },
}, [['oleg', 'other'], ['ira', 'ios'], ['masha', 'design'], ['pavel', 'aso']], [
  { title: 'MVP: плеер медитаций', status: 'in_progress', who: 'ira', due: 9, prio: 'High', cl: cl(['Фоновое воспроизведение', 1], ['Таймер сна'], ['Виджет на экран блокировки']) },
  { title: 'Дизайн-система: цвета и типографика', status: 'in_progress', who: 'masha', due: 4, prio: 'Medium' },
  { title: 'Название и ключевые слова для стора', status: 'todo', who: 'pavel', due: 12, prio: 'Medium' },
  { title: 'Метрики удержания D1/D7 в дашборде', status: 'todo', who: 'oleg', due: 7, prio: 'Low' },
  { title: 'Подписки: StoreKit 2', status: 'todo', who: 'ira', prio: 'High' },
  { title: 'Исследование конкурентов', status: 'done', who: 'oleg', prio: 'Medium' },
]);

unit({
  unit: { name: 'Charlie', key: 'CHR', color: '#10b981', description: 'Команда поддержки и развития старых приложений' },
}, [['dima', 'ios'], ['oleg', 'other']], [
  { title: 'Обновить SDK аналитики во всех приложениях', status: 'in_progress', who: 'dima', due: 2, prio: 'Medium' },
  { title: 'Квартальный отчёт по выручке', status: 'todo', who: 'oleg', due: 10, prio: 'Low' },
  { title: 'Миграция на Swift 6', status: 'todo', prio: 'Medium', dept: 'ios' },
]);

console.log('Готово: 6 человек, 3 команды, 17 задач. База:', file);
