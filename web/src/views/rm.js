/**
 * Дашборд RM (главная RM): очередь на релиз (переданные PM — чего не хватает до отправки), на ревью Apple (сколько ждут;
 * «Вышло в стор» / «Реджект» прямо здесь), реджекты (причина, кто исправляет; «Отправить снова»). Клик — карточка релиза.
 */
import { me, personById, greeting, plural, relTime } from '../state.js';
import { $, h, icon, avatar, topbar, showErr, fill, toast, promptDlg } from '../ui.js';
import { call, send } from '../api.js';
import { currentView } from '../router.js';
import { peekTask } from './task.js';
import { appIcon, prioTag } from './apps.js';
import { newsBlock, loadNotes } from './home.js';
import { openReleaseSettings } from './release.js';

const days = iso => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 864e5));

export async function renderRmHome() {
  const page = h('div', { class: 'page ceo-page' }, h('div', { class: 'boot' }, h('span', { class: 'spinner' }), 'Загрузка…'));
  fill($('#main'),
    topbar([h('h1', null, 'Релизы')], [h('button', { class: 'btn sm', onclick: openReleaseSettings }, icon('settings', 14), h('span', { class: 'btn-label' }, 'Настроить релиз'))]),
    h('div', { class: 'view-body' }, page));
  async function load() {
    let d;
    try { [d] = await Promise.all([call('getRmDashboard', {}), loadNotes()]); } catch (e) { return showErr(e); }
    if (currentView() !== 'home') return;
    const person = me();
    const total = d.queue.length + d.review.length + d.rejected.length;
    fill(page,
      h('div', { class: 'ceo-hello' },
        h('h2', null, greeting() + (person ? ', ' + person.name.split(' ')[0] : '')),
        h('p', { class: 'muted' }, total ? `${d.queue.length} к отправке · ${d.review.length} на ревью Apple · ${d.rejected.length} ${plural(d.rejected.length, ['реджект', 'реджекта', 'реджектов'])}` : 'Релизов в работе нет')),
      newsBlock(),
      section('Очередь на релиз', 'Передано PM — заполните релизные поля, закройте чеклист и отправьте в Apple.', d.queue, x => [
        x.missing.length || x.checklist.done < x.checklist.total
          ? h('span', { class: 'warn-text rq-line' }, [x.missing.length && 'не заполнено: ' + x.missing.join(', '), x.checklist.total && `чеклист ${x.checklist.done}/${x.checklist.total}`].filter(Boolean).join(' · '))
          : h('span', { class: 'ok-text rq-line' }, icon('check', 13), 'готово к отправке'),
      ], x => h('button', { class: 'btn primary sm', onclick: () => peekTask(x.unitId, x.id) }, 'Открыть релиз')),
      section('На ревью Apple', 'Отправлено — ждём ответа Apple.', d.review, x => [
        h('span', { class: 'muted rq-line' }, days(x.submittedAt)
          ? 'ждёт ' + days(x.submittedAt) + ' ' + plural(days(x.submittedAt), ['день', 'дня', 'дней']) + ' · отправлено ' + relTime(x.submittedAt)
          : 'отправлено ' + relTime(x.submittedAt)),
      ], x => [
        h('button', { class: 'btn primary sm', onclick: () => step(x, 'live') }, icon('rocket', 13), 'Вышло в стор'),
        h('button', { class: 'btn sm danger', onclick: () => reject(x) }, 'Реджект')]),
      section('Реджекты', 'Apple отклонил — PM юнита исправляет; когда готово, отправьте снова.', d.rejected, x => {
        const pm = personById(x.pmId);
        return [h('span', { class: 'rq-line' }, h('span', { class: 'att-what danger' }, x.reason),
          h('span', { class: 'muted' }, ' · исправляет ' + (pm ? pm.name : 'PM') + ' · ' + relTime(x.rejectedAt)))];
      }, x => h('button', { class: 'btn primary sm', onclick: () => step(x, 'resubmit') }, icon('send', 13), 'Отправить снова')));
  }
  async function step(x, action, reason) {
    try {
      await send('releaseStep', { taskId: x.id, action, reason });
      toast({ live: `«${x.app ? x.app.name : x.title}» в сторе`, resubmit: 'Отправлено снова', reject: 'Реджект: задача ушла PM' }[action]);
      load();
    } catch (e) { showErr(e); }
  }
  async function reject(x) {
    const reason = await promptDlg('Реджект Apple · ' + (x.app ? x.app.name : x.title), 'Причина (из письма Apple)', '');
    if (reason && reason.trim()) step(x, 'reject', reason.trim());
  }
  load();
}

/** Секция релизов: строки — приложение, релиз, состояние, исполнитель и действия. */
function section(title, hint, rows, line, actions) {
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, title, rows.length > 0 && h('span', { class: 'news-count' }, rows.length))),
    rows.length
      ? h('div', { class: 'card-box att-list' }, rows.map(x => h('div', { class: 'rm-row' },
        x.app ? appIcon(x.app, 'sm') : h('span'),
        h('button', { class: 'link-btn rm-main', onclick: () => peekTask(x.unitId, x.id) },
          h('span', { class: 'rm-title' }, h('b', null, x.app ? x.app.name : x.title), x.app && prioTag(x.app.priority), x.app && x.app.isTest && h('span', { class: 'test-tag' }, 'тест')),
          line(x)),
        h('div', { class: 'rm-actions' }, actions(x), avatar(personById(x.assigneeId), 'sm')))))
      : h('div', { class: 'card-box empty-state sm' }, h('p', null, hint)));
}

