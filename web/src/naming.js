/**
 * Названия задач приложений — одним форматом: «Приложение - [Тип: тема] - Отдел».
 *   запрос: «Video Player v1 - [Update #1: Фикс анимации]», «… - [New App]», «… - [Reject #2: Guideline 3.1.2]», «… - [Task: …]»
 *   этап:   «Video Player v1 - [Update #1: Фикс анимации] - Design»
 * Тема запроса хранится и целиком в поле topic; в название — до 80 знаков.
 * Тот же формат собирает и база (schema.sql: naming_dept, разовое переименование once_naming_en) — правьте вместе.
 */

/** Отдел этапа по ключу флоу. */
export const DEPT_EN = {
  design: 'Design', art: 'Onboarding & ASO', retext: 'Design Texts', ios: 'iOS', qa: 'QA', integr: 'Integration',
  meta: 'Texts OB/PW/ASO', store: 'Metadata', l10n: 'Localization', release: 'Release', account: 'Account', backend: 'Backend',
};
/** Свои этапы студии (ключ свой) — по русскому названию; нет в словаре — как назвали. */
const RU_EN = {
  'дизайн': 'Design', 'моушн дизайн': 'Motion Design', 'моушн-дизайн': 'Motion Design', 'анимация': 'Animation', 'анимации': 'Animation',
  'онбординг и aso-графика': 'Onboarding & ASO', 'тексты в дизайне': 'Design Texts', 'разработка ios': 'iOS', 'разработка': 'Development',
  'тестирование': 'QA', 'интеграция': 'Integration', 'тексты ob / pw / aso': 'Texts OB/PW/ASO', 'тексты': 'Texts', 'метаданные': 'Metadata',
  'локализации': 'Localization', 'локализация': 'Localization', 'релиз': 'Release', 'аккаунт': 'Account', 'бэкенд': 'Backend', 'бекенд': 'Backend',
  'иконка': 'Icon', 'aso': 'ASO', 'aso-графика': 'ASO', 'скриншоты': 'Screenshots', 'пейволл': 'Paywall', 'онбординг': 'Onboarding',
};
export const deptName = (step, title) => DEPT_EN[step] || RU_EN[String(title || '').trim().toLowerCase()] || String(title || '').trim();

/** Метка типа: New App · Update #N · Reject #N · Task. */
export const typeLabel = (requestType, n) => (requestType === 'new_app' ? 'New App' : requestType === 'update' ? `Update #${n || 1}`
  : requestType === 'reject' ? `Reject #${n || 1}` : 'Task');

/** Тема для названия: без квадратных скобок, до 80 знаков. */
export const clipTopic = topic => {
  const v = String(topic || '').replace(/\[/g, '(').replace(/\]/g, ')').replace(/\s+/g, ' ').trim();
  return v.length > 80 ? v.slice(0, 79).trimEnd() + '…' : v;
};
export const requestTitle = (appName, label, topic = '') => `${appName} - [${label}${clipTopic(topic) ? ': ' + clipTopic(topic) : ''}]`;
export const stageTitle = (reqTitle, dept) => `${reqTitle} - ${dept}`;

const RX = /^(.*?) - \[([^\]]+)\](?: - (.+))?$/;
/** Разбор названия: { app, type, dept } или null, если название не в формате. */
export function parseTitle(title) {
  const m = RX.exec(String(title || ''));
  // type — всё в скобках («Update #1: Prod UPD»), kind — только тип («Update #1»)
  return m ? { app: m[1], type: m[2], kind: m[2].split(':')[0].trim(), dept: m[3] || '' } : null;
}

/**
 * Короткое имя этапа для списков («Design»): отдел из названия; старый формат «Дизайн · App» — часть до « · »;
 * обычная задача — название целиком.
 */
export function stageName(title) {
  const p = parseTitle(title);
  if (p) return p.dept || `[${p.type}]`;
  return String(title || '').split(' · ')[0];
}

/** Задача PM по реджекту Apple: «App - [Reject #2]» (и старое «Реджект №2: …»). */
export const isRejectTitle = title => /\[Reject #\d+[\]:]/.test(String(title || '')) || /^Реджект №/.test(String(title || ''));
/** Номер реджекта из названия. */
export const rejectNo = title => Number((/\[Reject #(\d+)/.exec(title || '') || /^Реджект №(\d+)/.exec(title || '') || [])[1]) || 0;

/**
 * Название для списков вне контекста приложения (главная сотрудника, таймлайн, «Отправлено на ревью»): всегда с приложением.
 * В формате — как есть («App - [Update #1] - Metadata»); старое — имя этапа и приложение.
 */
export const taskLine = (title, appName) => (parseTitle(title) ? String(title) : stageName(title) + (appName ? ' · ' + appName : ''));
