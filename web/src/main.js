import './styles.css';
import { S, me, setMe } from './state.js';
import { $, h, icon, fill, closeMenu, closeNav, isMenuOpen, isModalOpen } from './ui.js';
import { call } from './api.js';
import { initBackend, mode, supabase } from './data.js';
import { parseLocation, render } from './router.js';
import { openPalette, isPaletteOpen } from './views/palette.js';
import { openCreateTask, closeTask } from './views/task.js';
import { openWhoAmI, openShortcuts } from './views/people.js';

const fatal = text => fill($('#shell'), h('div', { class: 'boot error', style: { gridColumn: '1 / -1' } }, text));

async function start() {
  try {
    await initBackend();
  } catch (e) {
    return fatal('Не удалось подключить хранилище: ' + e.message);
  }
  if (mode === 'supabase') {
    const { data } = await supabase.auth.getSession();
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') location.reload();
      else if (session && !S.session) { S.session = session; boot(); }
    });
    if (!data.session) return renderLogin();
    S.session = data.session;
  }
  boot();
}

let booted = false;
async function boot() {
  if (booted) return;
  booted = true;
  document.body.classList.remove('login-page');
  // После входа по ссылке в адресе остаётся ?code=… — убираем
  if (location.search) history.replaceState(null, '', location.pathname + location.hash);
  try {
    const d = await call('bootstrap', { today: new Date().toISOString().slice(0, 10) });
    S.units = d.units;
    S.people = d.people;
    S.departments = d.departments;
  } catch (e) {
    return fatal('Не удалось загрузить данные: ' + e.message);
  }
  // Кто я: при входе через Supabase — профиль с тем же email; в локальном режиме — выбор в браузере
  const email = S.session && S.session.user.email ? S.session.user.email.toLowerCase() : '';
  if (email) setMe((S.people.find(p => p.email === email) || {}).id || '');
  S.route = parseLocation();
  render();
  if (!me()) openWhoAmI({ welcome: true, email });
}

/** Понятный текст для ошибок Supabase Auth. */
export function authError(error) {
  const m = String(error && error.message || error);
  if (/invalid login credentials/i.test(m)) return 'Неверный email или пароль.';
  if (/email not confirmed/i.test(m)) return 'Email не подтверждён. Попросите администратора включить Auto Confirm для вашего аккаунта.';
  if (/rate limit/i.test(m)) return 'Слишком много писем за час — это лимит Supabase. Войдите по паролю или попробуйте позже.';
  if (/not allowed|signups|not found/i.test(m)) return 'Этого email нет в команде. Попросите администратора добавить вас.';
  if (/password.*(at least|characters)/i.test(m)) return 'Пароль должен быть не короче 6 символов.';
  if (/fetch|network/i.test(m)) return 'Нет связи с сервером входа. Проверьте интернет.';
  return 'Не получилось: ' + m;
}

/** Экран входа: email + пароль (основной способ) или ссылка на почту. */
function renderLogin(tab = 'password', prefill = '') {
  document.body.classList.add('login-page');
  const email = h('input', { class: 'inp', type: 'email', placeholder: 'you@company.com', autocomplete: 'email', required: true, value: prefill });
  const password = h('input', { class: 'inp', type: 'password', placeholder: 'Пароль', autocomplete: 'current-password' });
  const msg = h('p', { class: 'hint', style: { minHeight: '20px', margin: '10px 0 0' } });
  const byPassword = tab === 'password';
  const btn = h('button', { class: 'btn primary', type: 'submit', style: { width: '100%', justifyContent: 'center' } },
    byPassword ? 'Войти' : 'Получить ссылку для входа');
  const showError = error => { msg.className = 'hint login-error'; msg.textContent = authError(error); };

  const form = h('form', {
    onsubmit: async e => {
      e.preventDefault();
      if (!email.value.trim()) return email.focus();
      if (byPassword && !password.value) return password.focus();
      btn.disabled = true;
      msg.className = 'hint';
      msg.textContent = byPassword ? 'Входим…' : 'Отправляем…';
      if (byPassword) {
        const { error } = await supabase.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
        btn.disabled = false;
        if (error) return showError(error);
        msg.textContent = '';
        return; // дальше сработает onAuthStateChange → boot()
      }
      const { error } = await supabase.auth.signInWithOtp({
        email: email.value.trim(),
        options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: false },
      });
      btn.disabled = false;
      if (error) return showError(error);
      fill(form, h('div', { class: 'login-sent' }, icon('send', 22),
        h('h2', null, 'Проверьте почту'),
        h('p', null, 'Мы отправили ссылку для входа на ', h('b', null, email.value.trim()), '. Откройте её в этом браузере.'),
        h('button', { class: 'link-btn', type: 'button', onclick: () => renderLogin('link') }, 'Другой email')));
    },
  },
  field('Email', email),
  byPassword && field('Пароль', password),
  btn, msg);

  const tabBtn = (id, label) => h('button', {
    type: 'button', class: 'tab' + (tab === id ? ' on' : ''),
    onclick: () => { if (tab !== id) renderLogin(id, email.value); },
  }, label);

  fill($('#shell'), h('div', { class: 'login' },
    h('div', { class: 'login-card' },
      h('div', { class: 'brand', style: { justifyContent: 'center', padding: '0 0 18px' } }, h('div', { class: 'brand-logo' }, icon('check', 16)), h('span', null, 'Tasks')),
      h('h1', null, 'Вход'),
      h('div', { class: 'tabs login-tabs' }, tabBtn('password', 'По паролю'), tabBtn('link', 'Ссылка на почту')),
      h('p', { class: 'hint', style: { margin: '0 0 16px' } }, byPassword
        ? 'Пароль выдаёт администратор. После входа его можно сменить в «Моём профиле».'
        : 'Пришлём на почту ссылку для входа без пароля.'),
      form)));
  (email.value ? (byPassword ? password : email) : email).focus();
}

function field(label, control) {
  return h('div', { class: 'field' }, h('label', null, label), control);
}

document.addEventListener('keydown', e => {
  const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable]');
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openPalette();
    return;
  }
  if (e.key === 'Escape') {
    if (isModalOpen() || isPaletteOpen()) return; // у них свои обработчики
    if (isMenuOpen()) return closeMenu();
    if (document.body.classList.contains('nav-open')) return closeNav();
    if (S.panelTaskId && !typing) return closeTask();
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey || isModalOpen() || isPaletteOpen()) return;
  const k = e.key.toLowerCase();
  if ((k === 'c' || k === 'с') && !S.panelTaskId) { e.preventDefault(); openCreateTask(); }
  else if (k === '/') { const s = $('#board-search'); if (s) { e.preventDefault(); s.focus(); } else { e.preventDefault(); openPalette(); } }
  else if (k === '?') { e.preventDefault(); openShortcuts(); }
});

document.querySelector('.nav-scrim').addEventListener('click', closeNav);

start();
