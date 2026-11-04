/**
 * Блоки «Моего дашборда» сотрудника и лида: фокус (что делать сейчас), очередь ревью лида («Принять» / «Вернуть»)
 * и загрузка людей позиции лида. Данные — getMyDashboard.
 */
import { S, personById, deptById, fmtDate, plural, dueInfo } from '../state.js';
import { h, icon, avatar, statusIcon, toast, showErr, emptyBlock } from '../ui.js';
import { send } from '../api.js';
import { peekTask } from './task.js';
import { appIcon } from './apps.js';
import { reviewButtons } from './review.js';
import { readNote } from './home.js';

// Красным — только просрочка; остальное — серым
const REASON = {
  overdue: { label: 'просрочено', cls: 'danger' },
  today: { label: 'сегодня', cls: 'muted' },
  tomorrow: { label: 'завтра', cls: 'muted' },
  progress: { label: 'в работе', cls: 'muted' },
};

/** Фокус: просроченное, сроки сегодня и завтра, начатое — по важности; заблокированные этапы сюда не попадают.
 *  Первая задача — крупной карточкой с действиями, остальные — строками. */
export function focusBlock(d, reload) {
  const rows = d.focus;
  const [first, ...rest] = rows;
  const toReview = async t => {
    const u = S.units.find(x => x.id === t.unitId) || {};
    const col = ((u.settings || {}).review || {}).column || 'review';
    try { await send('updateTask', { id: t.id, patch: { status: col } }); toast('Отдано на ревью'); if (reload) reload(); } catch (e) { showErr(e); }
  };
  // разработка без код-ревью — сразу на тестирование (этап «готово»; без опросника база откроет его сама)
  const toTesting = async t => {
    const u = S.units.find(x => x.id === t.unitId) || {};
    const col = (((u.settings || {}).columns || []).find(c => c.kind === 'done') || {}).id;
    try { await send('updateTask', { id: t.id, patch: { status: col } }); toast('Отдано на тестирование'); if (reload) reload(); } catch (e) { showErr(e); }
  };
  // карточка: статус, ход чеклиста и срок с календарём; строка: только срок (E8B)
  const heroMeta = t => {
    const di = dueInfo(t.dueDate, false), cl = t.checklist || [];
    return [statusIcon(t.kind || 'progress', 14), [t.statusName, cl.length && `чеклист ${cl.filter(Boolean).length} из ${cl.length}`].filter(Boolean).join(' · '),
      di && h('span', { class: 'fc-due' + (di.cls === 'overdue' ? ' danger-text' : '') }, icon('calendar', 14), di.text)];
  };
  const when = t => { const di = dueInfo(t.dueDate, false); return di ? di.text : t.statusName; };
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Фокус'), h('span', { class: 'muted fc-hint' }, 'Что делать сейчас')),
    rows.length ? h('div', { class: 'card-box fc-list' },
      h('div', { class: 'fc-hero' },
        first.app ? appIcon(first.app, 'lg') : statusIcon(first.kind || 'progress', 24),
        h('div', { class: 'fc-hero-main' },
          h('div', { class: 'fc-hero-key' }, h('span', { class: 'dot', style: { background: (first.unit || {}).color || 'var(--info-fill)' } }), first.key, first.app ? ' · ' + first.title.split(' · ').slice(-1)[0] : ''),
          h('div', { class: 'fc-hero-title' }, first.title),
          h('div', { class: 'fc-hero-meta' }, heroMeta(first))),
        h('div', { class: 'fc-hero-actions' },
          h('button', { class: 'btn xl', onclick: () => peekTask(first.unitId, first.id) }, 'Открыть'),
          first.step === 'ios'
            ? h('button', { class: 'btn primary xl', onclick: () => toTesting(first) }, 'Отдать на тестирование')
            : h('button', { class: 'btn primary xl', onclick: () => toReview(first) }, 'Отдать на ревью'))),
      rest.map(t => h('button', { class: 'fc-row', onclick: () => peekTask(t.unitId, t.id) },
        statusIcon(t.kind || 'todo', 16),
        h('span', { class: 'fc-key' }, t.key),
        h('span', { class: 'fc-title' }, t.title),
        h('span', { class: 'fc-when ' + (REASON[t.reason] || REASON.progress).cls }, when(t)))))
      : emptyBlock('Срочного нет', { ok: true }));
}

const waited = iso => {
  const n = iso ? Math.floor((Date.now() - Date.parse(iso)) / 864e5) : -1;
  return n < 0 ? '' : n < 1 ? 'отдано сегодня' : `ждёт ${n} ${plural(n, ['день', 'дня', 'дней'])}`;
};

/** Очередь ревью лида: чья задача и решение — «Аппрув» (в готово) или «Правки» (автору, с комментарием). */
export function reviewsBlock(d, reload) {
  const rows = d.lead.reviews;
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Ждут вашего ревью'), rows.length > 0 && h('span', { class: 'muted fc-hint' }, rows.length)),
    rows.length ? h('div', { class: 'card-box att-list' }, rows.map(t => {
      const author = personById(t.authorId);
      return h('div', { class: 'rv-row' },
        author ? avatar(author, 'md') : h('span'),
        h('button', { class: 'link-btn fc-main', onclick: () => peekTask(t.unitId, t.id) },
          h('span', { class: 'fc-title' }, t.title.split(' · ')[0] + (t.app ? ' · ' + t.app.name : '')),
          h('span', { class: 'muted fc-sub' }, [author && author.name, waited(t.updatedAt)].filter(Boolean).join(' · '))),
        h('div', { class: 'rv-actions' }, reviewButtons({ ...t, reviewFrom: t.authorId }, () => reload())));
    })) : emptyBlock('Ревью никто не ждёт', { ic: 'eye' }));
}

/** Отправлено мной на ревью: что и у кого сейчас; «Открыть» и «Забрать из ревью» (если ревьюер ещё не решил). */
export function sentBlock(d, reload) {
  const wait = d.sent || [];
  // решённые ревьюером: остаются здесь с отметкой, пока автор не открыл задачу или не нажал «Ок» (читается уведомление)
  const decided = (S.notes || []).filter(n => (n.kinds || [n.kind]).some(k => k === 'approved' || k === 'returned'))
    .filter(n => !wait.some(t => t.id === n.taskId));
  const recall = async t => {
    try { await send('recallReview', { id: t.id }); toast('Задача снова у вас'); if (reload) reload(); } catch (e) { showErr(e); }
  };
  const total = wait.length + decided.length;
  const decidedRow = n => {
    const rv = personById(n.actorId);
    const back = (n.kinds || [n.kind]).includes('returned');
    return h('div', { class: 'sent-row decided ' + (back ? 'back' : 'ok'), dataset: { noteTask: n.taskId }, role: 'button', tabindex: 0, onclick: () => peekTask(n.unit.id, n.taskId) },
      rv ? avatar(rv, 'md') : h('span'),
      h('div', { class: 'sent-main' },
        h('div', { class: 'sent-title' }, n.title.split(' · ')[0] + (n.app ? ' · ' + n.app.name : '')),
        h('div', { class: 'sent-sub' }, (back ? 'Вернули на доработку' : 'Принято') + (rv ? ' · ' + rv.name : ''))),
      h('div', { class: 'sent-actions' },
        h('button', { class: 'btn sm', title: 'Убрать из списка', onclick: e => { e.stopPropagation(); readNote(n.taskId); } }, 'Ок')));
  };
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Отправлено на ревью'), total > 0 && h('span', { class: 'muted fc-hint' }, total)),
    total ? h('div', { class: 'card-box sent-list' }, decided.map(decidedRow), wait.map(t => {
      const rv = personById(t.reviewerId);
      return h('div', { class: 'sent-row', role: 'button', tabindex: 0, onclick: () => peekTask(t.unitId, t.id) },
        rv ? avatar(rv, 'md') : h('span'),
        h('div', { class: 'sent-main' },
          h('div', { class: 'sent-title' }, t.title.split(' · ')[0] + (t.app ? ' · ' + t.app.name : '')),
          h('div', { class: 'muted sent-sub' }, [rv ? 'у ' + rv.name : 'ревьюер не назначен', waited(t.updatedAt)].filter(Boolean).join(' · '))),
        h('div', { class: 'sent-actions' },
          h('button', { class: 'btn sm', title: 'Вернуть задачу себе, если что-то забыли', onclick: e => { e.stopPropagation(); recall(t); } }, icon('back', 13), 'Забрать')));
    })) : emptyBlock('Ничего не ждёт ревью', { ic: 'eye' }));
}

/** Загрузка людей позиции лида в его юнитах: задач на человеке и полоса; перегруз (много открытых или есть просрочка) — оранжевым и красным числом. */
export function teamLoadBlock(d) {
  const rows = d.lead.team.map(x => ({ ...x, p: personById(x.personId) })).filter(x => x.p);
  const cap = Math.max(6, ...rows.map(x => x.open));
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Загрузка позиции'),
      h('span', { class: 'muted fc-hint' }, [...new Set(rows.flatMap(x => (x.p.positionIds || []).map(id => (deptById(id) || {}).name)).filter(Boolean))].slice(0, 1).join(''))),
    rows.length ? h('div', { class: 'card-box tl-list' }, rows.map(x => {
      const heavy = x.overdue > 0 || x.open >= 5;
      return h('div', { class: 'tl-row' },
        h('div', { class: 'tl-line' }, h('span', { class: 'tl-name' }, x.p.name),
          h('span', { class: 'tl-n' + (heavy ? ' heavy' : ''), title: [x.inProgress && x.inProgress + ' в работе', x.waiting && x.waiting + ' ждут', x.overdue && x.overdue + ' просрочено'].filter(Boolean).join(' · ') },
            x.open + ' ' + plural(x.open, ['задача', 'задачи', 'задач']))),
        h('div', { class: 'tl-bar' }, h('div', { class: heavy ? 'heavy' : '', style: { width: Math.min(100, Math.round(x.open / cap * 100)) + '%' } })));
    }))
      : emptyBlock('Никого нет', { ic: 'users' }));
}

export function splitBlock(d) {
  const rows = (d.lead && d.lead.split) || [];
  return h('section', null,
    h('div', { class: 'section-head' }, h('h2', null, 'Раздано'), rows.length > 0 && h('span', { class: 'muted fc-hint' }, rows.length)),
    rows.length ? h('div', { class: 'card-box split-list' }, rows.map(s => h('div', { class: 'split-item' },
      h('button', { class: 'link-btn split-parent', onclick: () => peekTask(s.unitId, s.id) },
        s.app ? appIcon(s.app, 'xs') : null, h('b', null, s.title), h('span', { class: 'muted' }, ` · ${s.done} из ${s.parts.length}`)),
      h('div', { class: 'progress' }, h('div', { style: { width: Math.round(s.done / Math.max(1, s.parts.length) * 100) + '%' } })),
      s.parts.map(c => {
        const p = personById(c.workerId);
        return h('button', { class: 'split-part', onclick: () => peekTask(c.unitId, c.id) },
          p ? avatar(p, 'sm') : h('span'),
          h('span', { class: 'fc-title' + (c.kind === 'done' ? ' done' : '') }, c.title),
          h('span', { class: 'muted split-st' + (c.inReview ? ' accent' : '') }, c.inReview ? 'на ревью у вас' : c.statusName),
          h('span', { class: c.late ? 'danger-text split-due' : 'muted split-due' }, c.dueDate ? fmtDate(c.dueDate) : ''));
      }))))
      : emptyBlock('Пока ничего не роздано', { ic: 'users', sub: 'Откройте свой этап и нажмите «Раздать»' }));
}
