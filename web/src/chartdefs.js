/**
 * Свои графики аналитики (Настройки → Графики): что считать, как разбить, шаг, период, вид.
 * Общее для интерфейса и backend.js: список вариантов, какие сочетания имеют смысл и графики по умолчанию.
 * Хранятся у человека в prefs.charts — порядок как на аналитике; off — скрыт, hide — выключенные ряды.
 */

export const METRICS = [
  ['apps', 'Приложения'],
  ['tasks', 'Задачи'],
  ['releases', 'Релизы'],
  ['rejects', 'Реджекты'],
  ['overdue', 'Просрочки'],
  ['cycle', 'Время в работе'],
];
export const SPLITS = [
  ['unit', 'Юнитам'],
  ['status', 'Статусам'],
  ['pm', 'PM'],
  ['position', 'Позициям'],
  ['person', 'Людям'],
  ['none', 'Без разбивки'],
];
export const VIEWS = [
  ['lines', 'Линии'],
  ['curves', 'Кривые'],
  ['bars', 'Столбцы'],
  ['number', 'Число'],
];
export const STEPS = [
  ['day', 'По дням'],
  ['week', 'По неделям'],
  ['month', 'По месяцам'],
  ['total', 'Итогом'],
];
export const PERIODS = [[7, '7 дней'], [30, '30 дней'], [90, '90 дней'], [365, 'Год']];

/** Что это за число по метрике: событие за шаг, состояние на конец шага или среднее. */
export const METRIC_KIND = { apps: 'state', overdue: 'state', tasks: 'event', releases: 'event', rejects: 'event', cycle: 'avg' };

/** Разбивки, которые есть у метрики (у задач нет PM, у релизов — позиций и людей). */
export const SPLITS_OF = {
  apps: ['unit', 'status', 'pm', 'none'],
  tasks: ['unit', 'position', 'person', 'none'],
  releases: ['unit', 'pm', 'none'],
  rejects: ['unit', 'pm', 'none'],
  overdue: ['unit', 'position', 'person', 'none'],
  cycle: ['unit', 'position', 'person', 'none'],
};

/** Линии — только по времени: «Итогом» по оси категории, а не дни. */
export const viewAllowed = (view, step) => !(view === 'lines' && step === 'total');

/** Короткая строка для списка: «Реджекты · юниты · столбцы». */
export function chartMeta(c) {
  const m = (METRICS.find(x => x[0] === c.metric) || [])[1] || '';
  const s = { unit: 'юниты', status: 'статусы', pm: 'PM', position: 'позиции', person: 'люди', none: 'всего' }[c.split] || '';
  const v = ((VIEWS.find(x => x[0] === c.view) || [])[1] || '').toLowerCase();
  return [c.off ? 'Скрыт' : m, s, v].filter(Boolean).join(' · ');
}

/** Графики, которые были на аналитике всегда: теперь обычные, их можно менять, скрывать и двигать. */
export const DEFAULT_CHARTS = [
  { id: 'statuses', title: 'По статусам', metric: 'apps', split: 'status', view: 'lines', step: 'day', days: 30 },
  { id: 'units', title: 'Юниты × статусы', metric: 'apps', split: 'unit', view: 'curves', step: 'total', days: 30 },
];

/** Готовые заготовки для нового графика (F16). */
export const PRESETS = [
  { title: 'Релизы по месяцам', metric: 'releases', split: 'unit', view: 'bars', step: 'month', days: 365, hint: 'по юнитам · год', icon: 'bars' },
  { title: 'Просрочки по людям', metric: 'overdue', split: 'person', view: 'bars', step: 'total', days: 30, hint: 'сейчас', icon: 'bars' },
  { title: 'Время в работе по позициям', metric: 'cycle', split: 'position', view: 'lines', step: 'week', days: 90, hint: '90 дней', icon: 'lines' },
  { title: 'Реджекты за месяц', metric: 'rejects', split: 'none', view: 'number', step: 'total', days: 30, hint: 'одним числом', icon: 'number' },
];

const pick = (v, list, def) => (list.some(x => x[0] === v) ? v : def);

/** Привести настройку к допустимой: неизвестное — по умолчанию, разбивка и вид — из разрешённых. */
export function cleanChart(c = {}) {
  const metric = pick(c.metric, METRICS, 'apps');
  const splits = SPLITS_OF[metric];
  const step = pick(c.step, STEPS, 'day');
  let view = pick(c.view, VIEWS, 'bars');
  if (!viewAllowed(view, step)) view = 'bars';
  const days = PERIODS.some(x => x[0] === Number(c.days)) ? Number(c.days) : 30;
  return {
    id: String(c.id || '').slice(0, 40) || 'c' + Math.random().toString(36).slice(2, 10),
    title: String(c.title || '').trim().slice(0, 80) || 'График',
    metric, split: splits.includes(c.split) ? c.split : splits[0], view, step, days,
    off: !!c.off, hide: Array.isArray(c.hide) ? c.hide.map(String).slice(0, 50) : [],
  };
}

/** Графики человека: свои из prefs или по умолчанию. */
export const chartsOf = prefs => (Array.isArray(prefs && prefs.charts) ? prefs.charts : DEFAULT_CHARTS).map(cleanChart);
