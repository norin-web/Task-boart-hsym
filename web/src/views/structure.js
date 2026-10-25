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
  // все юниты, которые можно взять в структуру (кроме App, Managers и юнитов-команд); отмечены — те, что уже в ней
  const candidates = live.filter(u => !u.teamId && u !== app && u !== mod && !(u.settings && u.settings.handoff && u.settings.handoff.unitId));
  const inside = u => (mod ? u.parentId === mod.id : !u.parentId); // структуры ещё нет — верхние юниты отмечены сразу
  return {
    app: { id: app ? app.id : '', name: app ? app.name : 'App' },
    managers: { id: mod ? mod.id : '', name: mod ? mod.name : 'Managers' },
    units: candidates.sort(byOrder).map(u => ({
      id: u.id, name: u.name, on: inside(u),
      teams: live.filter(c => c.parentId === u.id && c.teamId).map(c => c.teamId),
    })),
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
    // 2. рабочие юниты: все юниты списком (галочка — входит в структуру) + новый
    () => {
      const addNew = () => { plan.units.push({ id: '', name: '', on: true, teams: [], focus: true }); draw(); };
      return [
        h('p', { class: 'hint' }, `Рабочие юниты внутри «${plan.managers.name || 'Managers'}» — сюда Managers раскладывают задачи приложений. Отметьте нужные или создайте новый; снятая галочка — юнит просто выходит из структуры, ничего не удаляется.`),
        h('div', { class: 'sw-list' }, plan.units.length ? plan.units.map((u, i) => {
          const name = h('input', { class: 'inp', value: u.name, maxlength: 80, placeholder: 'Название юнита', oninput: e => { u.name = e.target.value; },
            onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); addNew(); } } });
          if (u.focus) { delete u.focus; setTimeout(() => name.focus(), 0); }
          return h('div', { class: 'sw-row' + (u.on ? '' : ' off') },
            h('input', { type: 'checkbox', checked: u.on, title: u.on ? 'Входит в структуру' : 'Не входит', onchange: e => { u.on = e.target.checked; draw(); } }),
            h('span', { class: 'unit-dot', style: { background: u.id && unitById(u.id) ? unitById(u.id).color : 'var(--accent)', margin: 0 } }),
            name,
            !u.id ? h('span', { class: 'badge' }, 'новый') : u.teams.length > 0 && h('span', { class: 'muted sw-sub' }, u.teams.length + ' ' + (u.teams.length === 1 ? 'команда' : 'команды')),
            !u.id && h('button', { class: 'icon-btn sm', title: 'Убрать', onclick: () => { plan.units.splice(i, 1); draw(); } }, icon('x', 14)));
        }) : h('p', { class: 'muted', style: { margin: 0 } }, 'Юнитов пока нет — создайте первый')),
        h('button', { class: 'btn sm sw-add', onclick: addNew }, icon('plus', 14), 'Новый юнит'),
      ];
    },
    // 3. команды внутри юнитов
    () => [
      h('p', { class: 'hint' }, 'Какие команды работают внутри каждого юнита. Для каждой появится юнит-команда; задачи из наборов сами раскладываются по ним.'),
      plan.units.some(u => u.on) ? plan.units.filter(u => u.on).map(u => h('div', { class: 'sw-block' },
        h('b', null, u.name || 'Без названия'),
        h('div', { class: 'quick-chips' }, activeTeams().map(t => chip(u.teams.includes(t.id), t.name, t.color, () => { u.teams = toggle(u.teams, t.id); draw(); })))))
        : h('p', { class: 'muted' }, 'Сначала добавьте юниты на шаге 2'),
    ],
    // 4. люди в командах
    () => {
      const used = activeTeams().filter(t => plan.units.some(u => u.on && u.teams.includes(t.id)));
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
        h('p', { class: 'hint' }, isNew ? 'Так будет выглядеть структура. Нажмите «Создать структуру».' : 'Так будет после изменений. Снятые команды уйдут в корзину со своими задачами.'),
        h('div', { class: 'sw-tree' },
          node(0, 'app', plan.app.name || 'App', h('span', { class: 'muted' }, 'приложения')),
          node(1, 'layers', plan.managers.name || 'Managers', h('span', { class: 'muted' }, 'жизненный цикл')),
          plan.units.filter(u => u.on).map(u => [
            node(2, 'board', u.name || 'Без названия', !u.id && h('span', { class: 'badge' }, 'новый')),
            u.teams.map(tid => { const t = teamById(tid); const ppl = peopleOf(tid); return t && node(3, 'users', t.name,
              ppl.length ? h('span', { class: 'avatars-stack', title: ppl.map(p => p.name).join(', ') }, ppl.slice(0, 5).map(p => avatar(p, 'sm'))) : h('span', { class: 'warn-text' }, 'никого')); }),
          ])),
        plan.units.some(u => u.id && !u.on && unitById(u.id) && unitById(u.id).parentId === plan.managers.id) &&
          h('p', { class: 'muted' }, 'Выйдут из структуры (останутся юнитами): ' + plan.units.filter(u => u.id && !u.on && unitById(u.id).parentId === plan.managers.id).map(u => u.name).join(', ')),
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
        units: plan.units.filter(u => u.on && u.name.trim()),
        detachUnits: plan.units.filter(u => u.id && !u.on).map(u => u.id), people: plan.people,
      });
      close();
      toast(isNew ? 'Структура создана' : 'Структура обновлена');
      if (onDone) onDone();
    } catch (e) { btn.disabled = false; showErr(e); }
  };
  draw();
  close = modal({ title: isNew ? 'Собрать структуру' : 'Структура', wide: true, body: [body], actions: [] });
}
