/**
 * Готовые аватары-маскоты по позициям (assets/avatars/<группа>-<n>.webp) и фото профиля.
 * В базе (people.avatar): 'preset:ios-3' или data:image/webp;base64,… — фото сжимаем здесь до 160 px.
 */
const files = import.meta.glob('./assets/avatars/*.webp', { eager: true, query: '?url', import: 'default' });

/** id → url: { 'ios-3': '/src/assets/avatars/ios-3.webp', … } */
export const PRESETS = Object.fromEntries(Object.entries(files)
  .map(([path, url]) => [path.split('/').pop().replace('.webp', ''), url])
  .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })));

/** Группы маскотов: [ключ, подпись]. */
export const PRESET_GROUPS = [['ceo', 'CEO'], ['pm', 'PM'], ['design', 'UX/UI Designer'], ['ios', 'iOS Dev'], ['qa', 'QA'], ['release', 'Release Manager'], ['aso', 'ASO Specialist']];
const BY_POSITION = { d_design: 'design', d_ios: 'ios', d_qa: 'qa', d_release: 'release', d_aso: 'aso' };

/** Группы, подходящие человеку: по роли (CEO, PM, RM) и позициям — их показываем первыми. */
export function groupsFor(p) {
  const out = [];
  if (p.access === 'superadmin') out.push('ceo');
  if (p.access === 'moderator') out.push('pm');
  if (p.access === 'rm') out.push('release');
  for (const id of p.positionIds || [p.positionId]) if (BY_POSITION[id]) out.push(BY_POSITION[id]);
  return [...new Set(out)];
}

/** Картинка аватара человека или '' (тогда — инициалы). */
export function avatarSrc(p) {
  const v = (p && p.avatar) || '';
  if (v.startsWith('preset:')) return PRESETS[v.slice(7)] || '';
  return v.startsWith('data:image/') ? v : '';
}

/** Фото с диска → квадрат 160 px по центру, webp (jpeg, если браузер не умеет webp). */
export function photoToAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('Нужна картинка: JPG, PNG или WebP'));
    if (file.size > 15e6) return reject(new Error('Файл больше 15 МБ'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const S = 160, side = Math.min(img.naturalWidth, img.naturalHeight);
      const c = document.createElement('canvas');
      c.width = c.height = S;
      c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, S, S);
      URL.revokeObjectURL(url);
      let data = c.toDataURL('image/webp', 0.82);
      if (!data.startsWith('data:image/webp')) data = c.toDataURL('image/jpeg', 0.85);
      resolve(data);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не получилось открыть картинку')); };
    img.src = url;
  });
}
