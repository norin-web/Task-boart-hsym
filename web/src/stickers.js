/* Личные стикеры в комментариях. Комментарий-стикер — это текст-метка вида «[sticker:zlata]»:
 * отправить может только владелец (по имени), видят все. */
export const STICKERS = {
  zlata: { src: '/stickers/zlata.webp', owner: /^(злата|zlata)(\s|$)/i },
};

/** Ключ стикера, если весь комментарий — стикер; иначе null. */
export const stickerOf = text => {
  const m = /^\[sticker:([a-z0-9_-]+)\]$/.exec(String(text || '').trim());
  return m && STICKERS[m[1]] ? m[1] : null;
};

export const stickerText = key => `[sticker:${key}]`;

/** Стикеры, которые может отправлять этот человек. */
export const stickersFor = person => Object.keys(STICKERS).filter(k => person && STICKERS[k].owner.test(String(person.name || '').trim()));
