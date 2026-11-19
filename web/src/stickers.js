/* Стикеры в комментариях. Комментарий-стикер — это текст-метка вида «[sticker:zlata]».
 * Кому можно отправлять — выбирает CEO (app_settings.stickers = { ключ: [id людей] }); видят все.
 * Пока список не задан — у людей, чьё имя подходит под owner. */
export const STICKERS = {
  zlata: { src: '/stickers/zlata.webp', name: 'Обезьянка', owner: /^(злата|zlata)(\s|$)/i },
};

/** Ключ стикера, если весь комментарий — стикер; иначе null. */
export const stickerOf = text => {
  const m = /^\[sticker:([a-z0-9_-]+)\]$/.exec(String(text || '').trim());
  return m && STICKERS[m[1]] ? m[1] : null;
};

export const stickerText = key => `[sticker:${key}]`;

/** Может ли человек отправлять стикер. allowed — значение настройки stickers (или null). */
export const canSendSticker = (key, person, allowed) => {
  if (!person || !STICKERS[key]) return false;
  const ids = allowed && Array.isArray(allowed[key]) ? allowed[key] : null;
  return ids ? ids.includes(person.id) : STICKERS[key].owner.test(String(person.name || '').trim());
};

/** Стикеры, которые может отправлять этот человек. */
export const stickersFor = (person, allowed) => Object.keys(STICKERS).filter(k => canSendSticker(k, person, allowed));
