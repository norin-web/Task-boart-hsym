import '@fontsource-variable/montserrat/wght.css';
import './styles.css';
import './ds.css';
import './motion.css';
import { S, setMe, todayStr, setPeople } from './state.js';
import { $, h, icon, fill, closeMenu, closeNav, isMenuOpen, isModalOpen, refreshPresence } from './ui.js';
import { call } from './api.js';
import { initBackend, mode, supabase, localLogin } from './data.js';
import { LS, isStaff } from './state.js';
import { parseLocation, render } from './router.js';
import { openPalette, isPaletteOpen } from './views/palette.js';
import { renderUnread, renderSidebar } from './views/sidebar.js';
import { refreshNews } from './views/home.js';
import { openCreateTask, closeTask } from './views/task.js';
import { openShortcuts } from './views/people.js';
import { initPersonCard } from './views/personcard.js';
import { initDevForm } from './views/devquiz.js';
import { initMonitor } from './monitor.js';

// После выкатки старые файлы сборки удаляются: вкладка, открытая до обновления, не найдёт отдельный экран
// (настройки, аналитика…) — перезагружаем её на новую версию. Не чаще раза в минуту, чтобы не зациклиться.
window.addEventListener('vite:preloadError', e => {
  try {
    if (Date.now() - Number(sessionStorage.getItem('tm.reloadedAt') || 0) < 60000) return;
    sessionStorage.setItem('tm.reloadedAt', String(Date.now()));
  } catch { return; }
  e.preventDefault();
  location.reload();
});

// «Работать здесь» на экране блокировки — забрать базу у другой вкладки
let takeOver = false;

/** Локальный режим: приложение уже открыто в другой вкладке этого браузера. */
function lockedScreen() {
  fill($('#shell'), h('div', { class: 'boot error', style: { gridColumn: '1 / -1', flexDirection: 'column', gap: '8px', textAlign: 'center' } },
    h('b', null, 'Tasks уже открыт в другой вкладке'),
    h('div', { class: 'muted', style: { maxWidth: '420px' } }, 'Локальные данные хранятся в браузере, и две вкладки затирают изменения друг друга. Работайте в одной.'),
    h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '8px' } },
      h('button', { class: 'btn primary', onclick: () => { takeOver = true; start(); } }, 'Работать здесь'),
      h('button', { class: 'btn', onclick: () => location.reload() }, 'Проверить снова'))));
}

const fatal = (title, text) => fill($('#shell'), h('div', { class: 'boot error fatal-card', style: { gridColumn: '1 / -1', flexDirection: 'column' } },
  h('span', { class: 'eb-ic' }, '!'), h('b', null, title), h('span', { class: 'eb-sub' }, text),
  h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '12px' } },
    h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Обновить'),
    supabase && h('button', { class: 'btn', onclick: () => supabase.auth.signOut() }, 'Выйти'))));

async function start() {
  try {
    await initBackend({ takeOver: takeOver });
  } catch (e) {
    if (e.code === 'LOCKED') return lockedScreen();
    return fatal('Не удалось подключить хранилище', e.message);
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

/**
 * Форма входа заменяет каркас страницы — после входа возвращаем его (сайдбар, подложка меню, основная область)
 * с серыми блоками загрузки, как в index.html. Без каркаса дашборду некуда нарисоваться: висела загрузка до обновления.
 */
export function restoreShell() {
  fill($('#shell'),
    h('aside', { id: 'sidebar' }),
    h('div', { class: 'nav-scrim', onclick: closeNav }),
    h('div', { id: 'main' }, h('div', { class: 'first-load' }, h('div', { class: 'skel', role: 'status', 'aria-label': 'Загрузка' },
      h('i', { class: 'skel-t' }), h('i'), h('i'), h('i', { class: 'skel-s' })))));
}

let booted = false;
async function boot() {
  if (booted) return;
  booted = true;
  if (document.body.classList.contains('login-page')) restoreShell();
  document.body.classList.remove('login-page');
  // После входа по ссылке в адресе остаётся ?code=… — убираем
  if (location.search) history.replaceState(null, '', location.pathname + location.hash);
  try {
    // Кто я: в Supabase — профиль вошедшего (привязка по email); локально — выбранный в «Войти как»
    if (mode === 'supabase') {
      const person = await call('whoami', {});
      if (!person || !person.active) return renderNoAccess();
      S.realMeId = person.id;
      // режим разработчика: «смотреть как» — интерфейс и права другого человека (выбор хранится в базе, people.view_as)
      LS.set('viewAs', '');
      setMe(person.isDev && person.viewAs || person.id);
    } else {
      setMe(await localLogin(LS.get('localActor', '')).catch(() => localLogin('')));
      LS.set('localActor', S.meId);
    }
    // мгновенный старт (Supabase): сначала данные прошлого входа из браузера, свежие догружаются следом и тихо заменяют их
    const bootKey = mode === 'supabase' ? 'boot:' + S.realMeId + ':' + S.meId : '';
    const cached = bootKey ? LS.get(bootKey, null) : null;
    const fresh = call('bootstrap', { today: new Date().toISOString().slice(0, 10) });
    if (cached) {
      await applyBootstrap(cached, false);
      // экраны свои данные грузят сами — после свежего bootstrap обновляем меню (юниты, цифры), экран не перерисовываем
      fresh.then(async d => {
        await applyBootstrap(d, true);
        LS.set(bootKey, d);
        if (S.started) renderSidebar();
      }).catch(() => {});
    } else {
      const d = await fresh;
      await applyBootstrap(d, true);
      if (bootKey) LS.set(bootKey, d);
    }
  } catch (e) {
    return fatal('Не удалось загрузить данные', e.message);
  }
  S.route = parseLocation();
  S.started = true;
  render();
  startPulse();
  initPersonCard();
  initDevForm();
  initMonitor();
}

/** Разложить ответ bootstrap по S (юниты, люди, приложения, настройки). live — свежие данные с сервера (можно сохранять часовой пояс). */
async function applyBootstrap(d, live) {
  S.units = d.units;
  setPeople(d.people);
  S.departments = d.departments;
  S.leadPeople = (S.people.find(p => p.id === S.meId) || {}).access === 'lead' ? (await call('getLeadPeople', {}).catch(() => ({})))[S.meId] || [] : [];
  if (d.teams) S.teams = d.teams;
  S.linkFields = d.linkFields || [];
  S.templates = d.templates || [];
  S.apps = d.apps || [];
  S.appStatuses = (d.appStatuses || []).map(s => (s.kind === 'live' ? { ...s, name: 'App Store' } : s)); // статус «в продаже» всегда называется App Store
  S.appFields = d.appFields || [];
  S.appInfoItems = d.appInfoItems || [];
  S.priorityOptions = d.priorityOptions || [];
  S.storeManualCheck = !!d.storeManualCheck;
  S.infoListIds = d.infoListIds || [];
  // часовой пояс для карточки сотрудника — из браузера, пока человек не указал свой
  const self = S.people.find(p => p.id === S.meId);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (live && self && !self.timezone && tz && S.meId === (S.realMeId || S.meId)) {
    self.timezone = tz;
    call('updatePerson', { id: self.id, timezone: tz }).catch(() => {});
  }
  if (mode === 'local') {
    // локально «Войти как» меняет и права; режим разработчика остаётся за тем, у кого он включён
    const dev = S.people.find(p => p.isDev);
    S.realMeId = dev ? dev.id : S.meId;
  } else if (S.meId !== S.realMeId) {
    const lens = S.people.find(p => p.id === S.meId && p.active);
    if (!lens) { call('setViewAs', { personId: '' }).catch(() => {}); setMe(S.realMeId); }
    // интерфейс — как у него: только его юниты (CEO видит все)
    else if (lens.access !== 'superadmin') S.units = S.units.filter(u => (u.members || []).includes(lens.id));
  }
}

/** Пульс раз в минуту (пока вкладка открыта): «я в сети», кто ещё в сети, сколько новых уведомлений. */
function startPulse() {
  const pulse = async () => {
    if (document.hidden) return;
    try {
      const r = await call('heartbeat', { today: todayStr(), personId: S.meId });
      S.people.forEach(p => { if (p.id in r.seen) p.lastSeenAt = r.seen[p.id]; });
      refreshPresence();
      if (r.unread !== S.unread) {
        const more = r.unread > S.unread;
        S.unread = r.unread;
        renderUnread();
        if (more) refreshNews().catch(() => {});
      }
    } catch { /* сеть моргнула — следующий пульс через минуту */ }
  };
  pulse();
  setInterval(pulse, 60e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pulse(); });
}

/** Вошёл, но в команде его нет (или отключён администратором). */
function renderNoAccess() {
  const email = S.session && S.session.user.email;
  document.body.classList.add('login-page');
  fill($('#shell'), h('div', { class: 'login' },
    h('div', { class: 'login-card', style: { textAlign: 'center' } },
      h('div', { class: 'brand', style: { justifyContent: 'center', padding: '0 0 18px' } }, h('div', { class: 'brand-logo' }, icon('check', 16)), h('span', null, 'Tasks')),
      h('h1', null, 'Нет доступа'),
      h('p', { class: 'hint', style: { margin: '10px 0 20px' } }, 'Аккаунт ', h('b', null, email || ''), ' не добавлен в команду или отключён. Попросите администратора выдать доступ.'),
      h('button', { class: 'btn', onclick: () => supabase.auth.signOut() }, 'Выйти'))));
}

/** Понятный текст для ошибок Supabase Auth. */
export function authError(error) {
  const m = String(error && error.message || error);
  if (/invalid login credentials/i.test(m)) return 'Неверный email или пароль.';
  if (/email not confirmed/i.test(m)) return 'Email не подтверждён. Попросите администратора подтвердить ваш аккаунт.';
  if (/rate limit/i.test(m)) return 'Слишком много писем за час. Войдите по паролю или попробуйте позже.';
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
  // режим разработчика: ⌥D / Alt+D — панель (смотреть как, шорткаты, тестовые данные)
  if (e.altKey && e.code === 'KeyD' && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    import('./views/dev.js').then(m => m.openDevPanel());
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
  if ((k === 'c' || k === 'с') && !S.panelTaskId && isStaff()) { e.preventDefault(); openCreateTask(); }
  else if (k === '/') { const s = $('#board-search'); if (s) { e.preventDefault(); s.focus(); } else { e.preventDefault(); openPalette(); } }
  else if (k === '?') { e.preventDefault(); openShortcuts(); }
});

document.querySelector('.nav-scrim').addEventListener('click', closeNav);

start();
