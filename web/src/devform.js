/**
 * Опросник разработчика перед релизом: вопросы одни на студию. Заполняет разработчик в этапе «Разработка iOS»
 * перед ревью или закрытием; ответы видит RM в «Релизных полях» карточки релиза.
 * yn — «Да / Нет», note — что уточнить при «Да»; text — свободный ответ; optional — можно пропустить.
 */
export const DEV_QUESTIONS = [
  { id: 'backend', kind: 'yn', q: 'Есть ли backend?' },
  { id: 'firebase', kind: 'yn', q: 'Есть ли Firebase?' },
  { id: 'analytics', kind: 'yn', q: 'Есть ли аналитика?', note: 'Какая?' },
  { id: 'permissions', kind: 'text', q: 'Какие permissions запрашивает приложение?', hint: 'Photos, Camera, Microphone и т. д.' },
  { id: 'ai_providers', kind: 'text', q: 'Какие AI-провайдеры / модели используются?' },
  { id: 'ai_data', kind: 'text', q: 'Что отправляется AI-провайдерам?', hint: 'Текстовые prompts, изображения, видео, chat context и т. д.' },
  { id: 'ai_storage', kind: 'text', q: 'Хранятся ли prompts, загруженные изображения/видео и результаты генерации на сервере или только локально?' },
  { id: 'ugc', kind: 'yn', q: 'Есть ли User Generated Content / AI chat, кроме обычных prompts для генерации?', note: 'Что именно?' },
  { id: 'identifiers', kind: 'yn', q: 'Собираются ли device ID, IP, advertising ID, email или другие identifiers?', note: 'Какие?' },
  { id: 'push', kind: 'yn', q: 'Есть ли push notifications?' },
  { id: 'sharing', kind: 'yn', q: 'Есть ли sharing/export созданного контента в другие приложения?' },
  { id: 'diagnostics', kind: 'yn', q: 'Используются ли сторонние сервисы для crash reporting / diagnostics?', note: 'Какие?' },
  { id: 'extra', kind: 'text', q: 'Дополнительно', hint: 'Особенности приложения, важные для ревью Apple', optional: true },
];

/** Ответ строкой для чтения: «Да — Amplitude», «Нет», текст. */
export const answerText = a => (a ? [a.v, a.note].filter(Boolean).join(' — ') : '');
