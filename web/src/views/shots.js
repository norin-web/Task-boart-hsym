/**
 * Скриншоты (реджекта): выбор и сжатие картинок в браузере, полоска превью и просмотр.
 * Картинки хранятся в базе (task_files) — сжимаем до 1600 px по длинной стороне, JPEG.
 */
import { h, icon, modal, fill, toast, showErr } from '../ui.js';
import { call } from '../api.js';

const MAX_SIDE = 1600;
const MAX_FILES = 6;

/** Файл-картинка → { name, data: 'data:image/jpeg;base64,…' } не больше MAX_SIDE по длинной стороне. */
export async function compressImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Не удалось прочитать картинку'));
      el.src = url;
    });
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return { name: file.name || 'screenshot.jpg', data: c.toDataURL('image/jpeg', 0.82) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Поле выбора скриншотов: кнопка, вставка из буфера (⌘V), превью с удалением. value() — готовые к отправке. */
export function shotsInput() {
  const list = [];
  const thumbs = h('div', { class: 'shot-thumbs' });
  const file = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: () => { add([...file.files]); file.value = ''; } });
  const draw = () => fill(thumbs, list.map((x, i) => h('div', { class: 'shot-thumb' },
    h('img', { src: x.data, alt: x.name }),
    h('button', { type: 'button', class: 'shot-del', title: 'Убрать', onclick: () => { list.splice(i, 1); draw(); } }, icon('x', 12)))),
  list.length < MAX_FILES && h('button', { type: 'button', class: 'shot-add', onclick: () => file.click() }, icon('plus', 16), h('span', null, 'Скриншот')));
  async function add(files) {
    const imgs = files.filter(f => f && /^image\//.test(f.type)).slice(0, MAX_FILES - list.length);
    for (const f of imgs) {
      try { list.push(await compressImage(f)); } catch (e) { showErr(e); }
    }
    draw();
  }
  const el = h('div', { class: 'shots-input' }, thumbs, file, h('p', { class: 'hint shot-hint' }, 'Можно вставить из буфера: ⌘V / Ctrl+V'));
  // вставка из буфера, пока окно открыто
  const onPaste = e => {
    if (!el.isConnected) return document.removeEventListener('paste', onPaste);
    const files = [...(e.clipboardData ? e.clipboardData.files : [])].filter(f => /^image\//.test(f.type));
    if (files.length) { e.preventDefault(); add(files); }
  };
  document.addEventListener('paste', onPaste);
  draw();
  return { el, value: () => list.slice() };
}

/** Просмотр: большая картинка, стрелки между скриншотами. */
export function openShots(files, start = 0) {
  if (!files.length) return toast('Скриншотов нет');
  let i = start;
  const img = h('img', { class: 'shot-big', alt: '' });
  const count = h('span', { class: 'muted' });
  const paint = () => { img.src = files[i].data; img.alt = files[i].name || ''; count.textContent = files.length > 1 ? `${i + 1} из ${files.length}` : ''; };
  const go = d => { i = (i + d + files.length) % files.length; paint(); };
  paint();
  modal({
    title: 'Скриншоты',
    wide: true,
    body: [h('div', { class: 'shot-view' }, img),
      files.length > 1 && h('div', { class: 'shot-nav' },
        h('button', { type: 'button', class: 'btn sm', onclick: () => go(-1) }, icon('back', 13), 'Назад'), count,
        h('button', { type: 'button', class: 'btn sm', onclick: () => go(1) }, 'Дальше', icon('arrow', 13)))],
    actions: [{ label: 'Закрыть' }],
  });
}

/** Полоска превью скриншотов задачи (по метке); если их нет — скрыта. title — подпись блока над превью. */
export function shotsStrip(taskId, tag, title) {
  const strip = h('div', { class: 'shot-strip' });
  const box = title ? h('div', { class: 'block', hidden: true }, h('div', { class: 'block-title' }, title), strip) : strip;
  box.hidden = true;
  call('getTaskFiles', { taskId, tag }).then(files => {
    if (!files.length) return;
    box.hidden = false;
    fill(strip, files.map((f, n) => h('button', { type: 'button', class: 'shot-mini', title: f.name || 'Скриншот', onclick: e => { e.stopPropagation(); openShots(files, n); } },
      h('img', { src: f.data, alt: f.name || '', loading: 'lazy' }))));
  }).catch(() => {});
  return box;
}
