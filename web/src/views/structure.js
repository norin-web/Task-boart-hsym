/**
 * Мастер структуры (Панель админа → Юниты): по шагам — уровни (App, Managers) → рабочие юниты → команды внутри →
 * люди в командах → проверка дерева. Открывается с текущей структурой; «Применить» создаёт недостающее и меняет
 * существующее одним вызовом (applyStructure), ничего не дублируя. Убранное уходит в корзину со всеми задачами.
 */
import { S, unitById, activeTeams, teamById, byOrder } from '../state.js';
import { h, icon, avatar, fill, modal, toast, showErr } from '../ui.js';
import { send } from '../api.js';

const STEPS = ['Уровни', 'Юниты', 'Команды', 'Люди', 'Проверка'];

/** Текущая структура: App — юнит с передачей вниз, Managers — куда он передаёт, рабочие — внутри Managers. */
function currentPlan() {
  const live = S.units.filter(u => !u.archived);
  const app = live.find(u => u.settings && u.settings.handoff && u.settings.handoff.unitId);
  const mod = app && unitById(app.settings.handoff.unitId);
  const working = mod ? live.filter(u => u.parentId === mod.id && !u.teamId)
    : live.filter(u => !u.parentId && !u.teamId); // структуры ещё нет — текущие верхние юниты встанут под Managers
  return {
    app: { id: app ? app.id : '', name: app ? app.name : 'App' },
    managers: { id: mod ? mod.id : '', name: mod ? mod.name : 'Managers' },
    units: working.sort(byOrder).map(u => ({
      id: u.id, name: u.name,
      teams: live.filter(c => c.parentId === u.id && c.teamId).map(c => c.teamId),
    })),
    removeUnits: [],
    people: Object.fromEntries(S.people.filter(p => p.active).map(p => [p.id, [...(p.teamIds || [])]])),
  };
}

export function openStructureWizard(onDone) {
  const plan = currentPlan();
  const isNew = !plan.app.id;
  let step = 0;
  const body = h('div', { class: 'sw' });
  const toggle = (list, id) => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  const chip = (on, label, color, onclick) => h('button', { class: 'quick-chip sw-chip' + (on ? ' on' : ''), onclick },
    h('span', { class: 'dot', style: { background: color } }), label);

  const steps = [
    // 1. уровни
    () => [
      h('p', { class: 'hint' }, 'Верхние уровни. App — приложения (To Do → In Progress → In Store), Managers — их жизненный цикл: апдейты, реджекты, разбивка на задачи в юниты ниже. Из App в Managers приложение уходит копией как есть.'),
      h('div', { class: 'sw-level' }, icon('app', 16), h('span', { class: 'sw-k' }, 'Приложения'),
        h('input', { class: 'inp', value: plan.app.name, maxlength: 80, oninput: e => { plan.app.name = e.target.value; } })),
      h('div', { class: 'sw-level sub' }, icon('layers', 16), h('span', { class: 'sw-k' }, 'Менеджмент'),
        h('input', { class: 'inp', value: plan.managers.name, maxlength: 80, oninput: e => { plan.managers.name = e.target.value; } })),
    ],
    // 2. рабочие юниты
    () => {
      const add = h('input', { class: 'inp', placeholder: 'Новый юнит, например MVP — Enter', maxlength: 80,
        onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); const v = e.target.value.trim(); if (v) { plan.units.push({ id: '', name: v, teams: [] }); draw(); } } } });
      setTimeout(() => add.focus(), 0);
      return [
        h('p', { class: 'hint' }, `Рабочие юниты внутри «${plan.managers.name || 'Managers'}» — сюда Managers раскладывают задачи приложений.`),
        h('div', { class: 'sw-list' }, plan.units.length ? plan.units.map((u, i) => h('div', { class: 'sw-row' },
          h('span', { class: 'unit-dot', style: { background: u.id && unitById(u.id) ? unitById(u.id).color : 'var(--accent)', margin: 0 } }),
          h('input', { class: 'inp', value: u.name, maxlength: 80, oninput: e => { u.name = e.target.value; } }),
          !u.id && h('span', { class: 'badge' }, 'новый'),
          h('button', { class: 'icon-btn sm', title: u.id ? 'Убрать (в корзину, задачи сохранятся)' : 'Убрать', onclick: () => {
            if (u.id) plan.removeUnits.push(u.id);
            plan.units.splice(i, 1);
            draw();
          } }, icon('x', 14))))
          : h('p', { class: 'muted', style: { margin: 0 } }, 'Пока ни одного — добавьте ниже')),
        add,
      ];
    },
    // 3. команды внутри юнитов
    () => [
      h('p', { class: 'hint' }, 'Какие команды работают внутри каждого юнита. Для каждой появится юнит-команда; задачи из наборов сами раскладываются по ним.'),
      plan.units.length ? plan.units.map(u => h('div', { class: 'sw-block' },
        h('b', null, u.name || 'Без названия'),
        h('div', { class: 'quick-chips' }, activeTeams().map(t => chip(u.teams.includes(t.id), t.name, t.color, () => { u.teams = toggle(u.teams, t.id); draw(); })))))
        : h('p', { class: 'muted' }, 'Сначала добавьте юниты на шаге 2'),
    ],
    // 4. люди в командах
    () => {
      const used = activeTeams().filter(t => plan.units.some(u => u.teams.includes(t.id)));
      const teams = used.length ? used : activeTeams();
      const people = S.people.filter(p => p.active && p.access === 'member').sort((a, b) => a.name.localeCompare(b.name, 'ru'));
      return [
        h('p', { class: 'hint' }, 'Кто в какой команде. Человек может быть в нескольких; в юнитах-командах он появится сам. Администраторов добавлять не нужно — они видят всё.'),
        teams.map(t => h('div', { class: 'sw-block' },
          h('b', { class: 'sw-team' }, h('span', { class: 'dot', style: { background: t.color } }), t.name),
          people.length ? h('div', { class: 'quick-chips' }, people.map(p => {
            const on = (plan.people[p.id] || []).includes(t.id);
            return h('button', { class: 'quick-chip sw-chip' + (on ? ' on' : ''), onclick: () => { plan.people[p.id] = toggle(plan.people[p.id] || [], t.id); draw(); } }, avatar(p, 'sm'), p.name);
          })) : h('p', { class: 'muted', style: { margin: 0 } }, 'Участников пока нет — их добавляют в «Люди и доступы»'))),
      ];
    },
    // 5. проверка
    () => {
      const node = (depth, ic, label, extra) => h('div', { class: 'sw-node', style: { '--d': depth } }, icon(ic, 14), h('b', null, label), extra);
      const peopleOf = tid => S.people.filter(p => p.active && (plan.people[p.id] || []).includes(tid));
      return [
        h('p', { class: 'hint' }, isNew ? 'Так будет выглядеть структура. Нажмите «Создать структуру».' : 'Так будет после изменений. Убранное уйдёт в корзину со всеми задачами.'),
        h('div', { class: 'sw-tree' },
          node(0, 'app', plan.app.name || 'App', h('span', { class: 'muted' }, 'приложения')),
          node(1, 'layers', plan.managers.name || 'Managers', h('span', { class: 'muted' }, 'жизненный цикл')),
          plan.units.map(u => [
            node(2, 'board', u.name || 'Без названия', !u.id && h('span', { class: 'badge' }, 'новый')),
            u.teams.map(tid => { const t = teamById(tid); const ppl = peopleOf(tid); return t && node(3, 'users', t.name,
              ppl.length ? h('span', { class: 'avatars-stack', title: ppl.map(p => p.name).join(', ') }, ppl.slice(0, 5).map(p => avatar(p, 'sm'))) : h('span', { class: 'warn-text' }, 'никого')); }),
          ])),
        plan.removeUnits.length > 0 && h('p', { class: 'warn-text' }, 'В корзину: ' + plan.removeUnits.map(id => (unitById(id) || {}).name).filter(Boolean).join(', ')),
      ];
    },
  ];

  const draw = () => fill(body,
    h('div', { class: 'sw-steps' }, STEPS.map((s, i) => h('button', {
      class: 'sw-step' + (i === step ? ' on' : i < step ? ' done' : ''), onclick: () => { step = i; draw(); },
    }, h('span', { class: 'sw-num' }, i < step ? icon('check', 12) : i + 1), s))),
    h('div', { class: 'sw-page' }, steps[step]()),
    h('div', { class: 'sw-nav' },
      step > 0 ? h('button', { class: 'btn', onclick: () => { step--; draw(); } }, 'Назад') : h('span'),
      step < STEPS.length - 1
        ? h('button', { class: 'btn primary', onclick: () => { step++; draw(); } }, 'Далее')
        : h('button', { class: 'btn primary', onclick: e => apply(e.currentTarget) }, icon('check', 14), isNew ? 'Создать структуру' : 'Применить')));

  let close;
  const apply = async btn => {
    btn.disabled = true;
    try {
      await send('applyStructure', {
        app: plan.app, managers: plan.managers,
        units: plan.units.filter(u => u.name.trim()), removeUnits: plan.removeUnits, people: plan.people,
      });
      close();
      toast(isNew ? 'Структура создана' : 'Структура обновлена');
      if (onDone) onDone();
    } catch (e) { btn.disabled = false; showErr(e); }
  };
  draw();
  close = modal({ title: isNew ? 'Собрать структуру' : 'Структура', wide: true, body: [body], actions: [] });
}
