-- Tasks — схема базы для Supabase.
-- Выполнить целиком: Supabase → SQL Editor → New query → вставить → Run.
-- Скрипт можно запускать повторно: он ничего не удаляет.

-- ---------- таблицы ----------

create table if not exists units (
  id          text primary key,
  name        text not null,
  key         text not null unique,
  color       text not null,
  description text not null default '',
  settings    jsonb not null default '{}',
  next_num    integer not null default 1,
  ord         double precision not null default 0,
  archived    boolean not null default false,
  created_at  text not null,
  updated_at  text not null
);

-- Картинка юнита (вместо квадратика с буквами): data:image/webp;base64,… 160×160, пусто — буквы ключа
alter table units add column if not exists icon text not null default '';

-- Обязательная колонка «Доработка» (сюда QA возвращает задачи с баг-репортом, qa_return): у юнитов без неё —
-- встаёт перед первой колонкой «готово» (после ревью). Повторный запуск ничего не меняет.
update units u
   set settings = jsonb_set(u.settings, '{columns}', (
         select jsonb_agg(x.c order by x.o) from (
           select t.c, t.o::numeric as o from jsonb_array_elements(u.settings -> 'columns') with ordinality t(c, o)
           union all
           select jsonb_build_object('id', 'rework', 'name', 'Доработка', 'kind', 'progress', 'color', ''),
                  coalesce((select min(t.o) from jsonb_array_elements(u.settings -> 'columns') with ordinality t(c, o) where t.c ->> 'kind' = 'done') - 0.5,
                           jsonb_array_length(u.settings -> 'columns') + 1)
         ) x))
 where jsonb_typeof(u.settings -> 'columns') = 'array'
   and jsonb_array_length(u.settings -> 'columns') > 0
   and not exists (select 1 from jsonb_array_elements(u.settings -> 'columns') c
                    where c ->> 'id' = 'rework' or lower(btrim(c ->> 'name')) like 'доработ%');

-- Корзина юнитов: когда юнит отправили в архив (для автоудаления)
alter table units add column if not exists archived_at text not null default '';

-- Общие настройки приложения (ключ → значение)
create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at text not null default ''
);

-- Уборка прежней иерархии юнитов (App → Managers → MVP → юниты-команды; 2026-10): юниты теперь плоские
-- (Gold / RF / MVP), приложения — отдельная сущность (таблица apps). Однократно и безопасно повторять.
alter table units drop column if exists parent_id;
alter table units drop column if exists team_id;
update units set settings = settings - 'handoff' where settings ? 'handoff';
-- колонки «в сторе» (live) были только у юнита приложений — теперь «В сторе» это статус приложения
update units set settings = jsonb_set(settings, '{columns}', (
  select jsonb_agg(case when c ->> 'kind' = 'live' then jsonb_set(c, '{kind}', '"done"') else c end order by i)
    from jsonb_array_elements(settings -> 'columns') with ordinality x(c, i)))
 where jsonb_typeof(settings -> 'columns') = 'array'
   and exists (select 1 from jsonb_array_elements(settings -> 'columns') c where c ->> 'kind' = 'live');
drop table if exists task_sets;
delete from app_settings where key in ('taskSetsSeeded', 'appsLiveKind');

create table if not exists fields (
  id           text primary key,
  unit_id      text not null references units(id) on delete cascade,
  name         text not null,
  type         text not null,
  options      jsonb not null default '[]',
  show_on_card boolean not null default false,
  required     boolean not null default false,
  ord          double precision not null default 0,
  archived     boolean not null default false
);
create index if not exists fields_unit on fields(unit_id);
-- Поле меняют только администраторы (участник видит, но не правит) и роль поля ('priority' — приоритет:
-- метка и сортировка на доске; варианты по порядку — от низкого к высокому). Однократно: «Приоритет» → оба флага.
do $$ begin
  if not exists (select 1 from information_schema.columns where table_name = 'fields' and column_name = 'role') then
    alter table fields add column staff_only boolean not null default false;
    alter table fields add column role text not null default '';
    update fields set staff_only = true, role = 'priority' where name = 'Приоритет' and type = 'select';
  end if;
end $$;
alter table fields add column if not exists staff_only boolean not null default false;
alter table fields add column if not exists role text not null default '';

-- Обязательное поле: с какой колонки оно нужно ('' — для любого переноса)
alter table fields add column if not exists required_from text not null default '';
-- Поле нужно уже при создании задачи (для всех, включая администраторов)
alter table fields add column if not exists required_on_create boolean not null default false;
-- Общие поля — на все юниты (unit_id пустой); у юнита ещё могут быть свои. Приоритет — одно общее поле.
alter table fields alter column unit_id drop not null;

create table if not exists people (
  id               text primary key,
  name             text not null,
  email            text not null default '',
  role             text not null default '',
  color            text not null default '',
  telegram_chat_id text not null default '',
  active           boolean not null default true,
  created_at       text not null
);

create table if not exists departments (
  id       text primary key,
  name     text not null,
  color    text not null,
  ord      double precision not null default 0,
  archived boolean not null default false
);
insert into departments (id, name, color, ord) values
  ('d_aso', 'ASO', '#f59e0b', 1), ('d_design', 'Design', '#ec4899', 2),
  ('d_ios', 'iOS', '#6366f1', 3), ('d_other', 'Other', '#64748b', 4)
on conflict (id) do nothing;

create table if not exists unit_members (
  unit_id       text not null references units(id) on delete cascade,
  person_id     text not null references people(id) on delete cascade,
  department_id text not null default '',
  created_at    text not null default '',
  primary key (unit_id, person_id)
);
create index if not exists unit_members_person on unit_members(person_id);

create table if not exists tasks (
  id            text primary key,
  unit_id       text not null references units(id) on delete cascade,
  num           integer not null,
  title         text not null,
  description   text not null default '',
  status        text not null,
  assignee_id   text not null default '',
  department_id text not null default '',
  due_date      text not null default '',
  ord           double precision not null default 0,
  fields        jsonb not null default '{}',
  checklist     jsonb not null default '[]',
  archived      boolean not null default false,
  done_at       text not null default '',
  created_by    text not null default '',
  created_at    text not null,
  updated_at    text not null
);
create index if not exists tasks_unit on tasks(unit_id);
-- Ревью: кто был исполнителем до колонки ревью (ему задача вернётся) и кто ревьюер
alter table tasks add column if not exists review_from text not null default '';
alter table tasks add column if not exists reviewer_id text not null default '';
create index if not exists tasks_assignee on tasks(assignee_id);

create table if not exists comments (
  id        text primary key,
  task_id   text not null references tasks(id) on delete cascade,
  text      text not null,
  author_id text not null default '',
  at        text not null,
  edited_at text not null default ''
);
create index if not exists comments_task on comments(task_id);

-- Журнал не ссылается на задачи внешним ключом: запись об удалении должна пережить задачу.
create table if not exists activity (
  id       text primary key,
  unit_id  text not null default '',
  task_id  text not null default '',
  action   text not null,
  field    text not null default '',
  from_val text not null default '',
  to_val   text not null default '',
  actor_id text not null default '',
  at       text not null
);
create index if not exists activity_task on activity(task_id);
create index if not exists activity_at on activity(at);

-- Ссылки в карточке задачи (Figma, GitHub, Google Drive…): общий набор для всех юнитов, настраивает супер-админ.
-- positions — каким позициям участников видно поле ('[]' — всем); администраторы видят всё.
create table if not exists link_fields (
  id        text primary key,
  name      text not null,
  kind      text not null default 'link',
  positions jsonb not null default '[]',
  ord       double precision not null default 0,
  archived  boolean not null default false
);
insert into link_fields (id, name, kind, ord) values
  ('lf_figma', 'Figma', 'figma', 1), ('lf_github', 'GitHub', 'github', 2),
  ('lf_drive', 'Google Drive', 'drive', 3), ('lf_texts', 'Тексты', 'meta', 3.5), ('lf_meta', 'Мета', 'meta', 4), ('lf_l10n', 'Локализации', 'drive', 5)
on conflict (id) do nothing;
update link_fields set name = 'Мета' where id = 'lf_meta' and name in ('Metadata', 'Тексты и метаданные', 'Метаданные');

-- Значения ссылок — отдельной таблицей, чтобы скрытое поле не уходило в браузер вместе с задачей.
create table if not exists task_links (
  task_id    text not null references tasks(id) on delete cascade,
  field_id   text not null references link_fields(id) on delete cascade,
  unit_id    text not null default '',
  url        text not null,
  updated_at text not null default '',
  primary key (task_id, field_id)
);
create index if not exists task_links_unit on task_links(unit_id);

-- Задача → дочерние задачи (запрос CEO → этапы); kind: '' — задача, request — запрос CEO, stage — этап.
alter table tasks add column if not exists parent_id text not null default '';
alter table tasks add column if not exists kind text not null default '';
create index if not exists tasks_parent on tasks(parent_id);
update tasks set kind = '' where kind in ('app', 'update', 'reject'); -- прежняя иерархия

-- Уведомления человеку (назначение, ревью, сроки). Пишет только триггер; читает и отмечает — сам человек.

create table if not exists notifications (
  id        text primary key,
  person_id text not null references people(id) on delete cascade,
  task_id   text not null references tasks(id) on delete cascade,
  kind      text not null default 'assigned',
  actor_id  text not null default '',
  at        text not null,
  read_at   text not null default ''
);
create index if not exists notifications_person on notifications(person_id, read_at);
-- К чему относится уведомление о сроке: дата срока (новый срок — новое уведомление)
alter table notifications add column if not exists ref text not null default '';

-- Шаблоны задач: общие для всех юнитов, ведут администраторы и модераторы; при создании задачи
-- подставляют название, описание, позицию, срок (через due_days дней, -1 — без срока) и чеклист.
create table if not exists task_templates (
  id            text primary key,
  name          text not null,
  title         text not null default '',
  description   text not null default '',
  department_id text not null default '',
  due_days      integer not null default -1,
  checklist     jsonb not null default '[]',
  ord           double precision not null default 0
);
-- Исполнитель по умолчанию (из выбранной команды-позиции) и ссылки { поле-ссылка → url }
alter table task_templates add column if not exists assignee_id text not null default '';
alter table task_templates add column if not exists links jsonb not null default '{}';
alter table task_templates add column if not exists team_id text not null default '';
-- Шаблон апдейта (kind = 'update'): пункты (checklist) и нужные этапы флоу (steps: ключи этапов, пусто — все)
alter table task_templates add column if not exists kind text not null default '';
alter table task_templates add column if not exists steps jsonb not null default '[]';

-- ---------- атомарные операции ----------

-- Следующий номер задачи в юните (DEV-1, DEV-2…) без гонок.
create or replace function next_task_num(p_unit text) returns integer
language sql as $$
  update units set next_num = next_num + 1 where id = p_unit returning next_num - 1;
$$;

-- Количество комментариев по задачам юнита.
create or replace function comment_counts(p_unit text) returns table (task_id text, n bigint)
language sql stable as $$
  select c.task_id, count(*) from comments c join tasks t on t.id = c.task_id
  where t.unit_id = p_unit group by c.task_id;
$$;

-- ---------- роли и доступ ----------
-- Роль (access): superadmin — всё, включая выдачу прав; moderator — всё, кроме прав;
-- member — видит свои юниты и задачи своей позиции, работает только в своих задачах.
-- Профиль (people) привязан к аккаунту входа через user_id.

alter table people add column if not exists user_id uuid;
alter table people add column if not exists access text not null default 'member';
alter table people add column if not exists position_id text not null default '';
-- Личные настройки интерфейса (раскладка главной и т.п.); человек меняет только свои
alter table people add column if not exists prefs jsonb not null default '{}';
-- аватар: 'preset:<позиция>-<n>' (готовые маскоты) или фото data:image/…;base64 (сжатое в браузере до 160 px)
alter table people add column if not exists avatar text not null default '';
-- карточка сотрудника: Telegram (@username без @) и часовой пояс (IANA, «Europe/Moscow») — для местного времени
alter table people add column if not exists telegram text not null default '';
alter table people add column if not exists timezone text not null default '';
-- Когда человек последний раз был в приложении (онлайн-метка)
alter table people add column if not exists last_seen_at text not null default '';
do $$ begin
  alter table people add constraint people_access_check check (access in ('superadmin', 'moderator', 'member'));
exception when duplicate_object then null; end $$;
create unique index if not exists people_user_id on people(user_id) where user_id is not null;

-- Позиции = справочник departments (ASO, Design, iOS…) + недостающие
insert into departments (id, name, color, ord) values
  ('d_qa', 'Тестировщик', '#14b8a6', 5), ('d_release', 'Релиз-менеджер', '#8b5cf6', 6)
on conflict (id) do nothing;

-- Позиции команды (2026-10): Product owner, iOS Dev, UX/UI Designer, ASO Specialist, Release Manager, QA, Other.
-- Переименовываем только те, что ещё со старым названием по умолчанию — свои названия не трогаем.
insert into departments (id, name, color, ord) values ('d_po', 'Product owner', '#0ea5e9', 0) on conflict (id) do nothing;
update departments set name = 'iOS Dev', ord = 1 where id = 'd_ios' and name = 'iOS';
update departments set name = 'UX/UI Designer', ord = 2 where id = 'd_design' and name = 'Design';
update departments set name = 'ASO Specialist', ord = 3 where id = 'd_aso' and name = 'ASO';
update departments set name = 'Release Manager', ord = 4 where id = 'd_release' and name = 'Релиз-менеджер';
update departments set name = 'QA', ord = 5 where id = 'd_qa' and name = 'Тестировщик';
update departments set ord = 9 where id = 'd_other' and ord = 4;

-- Дополнительные позиции человека (основная — position_id; например, Product owner + UX/UI Designer)
alter table people add column if not exists extra_positions jsonb not null default '[]';

-- Команды людей (Product Team, UX/UI Designers…): у человека может быть несколько; у задачи — одна (необязательно).
-- Участник видит в своих юнитах задачи своих позиций И своих команд.
create table if not exists teams (
  id       text primary key,
  name     text not null,
  color    text not null,
  ord      double precision not null default 0,
  archived boolean not null default false
);
insert into teams (id, name, color, ord) values
  ('t_product', 'Product Team', '#0ea5e9', 1), ('t_design', 'UX/UI Designers', '#ec4899', 2),
  ('t_ios', 'iOS Development', '#6366f1', 3), ('t_qa', 'QA Team', '#14b8a6', 4),
  ('t_release', 'Release Managers', '#8b5cf6', 5), ('t_other', 'Other', '#64748b', 9)
on conflict (id) do nothing;
-- Однократно: команды по позициям (Product owner → Product Team, …; остальные — Other)
do $$ begin
  if not exists (select 1 from information_schema.columns where table_name = 'people' and column_name = 'team_ids') then
    alter table people add column team_ids jsonb not null default '[]';
    update people set team_ids = jsonb_build_array(case position_id
      when 'd_po' then 't_product' when 'd_design' then 't_design' when 'd_ios' then 't_ios'
      when 'd_qa' then 't_qa' when 'd_release' then 't_release' else 't_other' end)
     where true; -- Supabase (safeupdate) не даёт UPDATE без WHERE
  end if;
end $$;
alter table tasks add column if not exists team_id text not null default '';

-- Позиция по умолчанию — первый «отдел в команде» человека (однократно, если позиции ещё нет)
update people p set position_id = m.department_id
  from (select distinct on (person_id) person_id, department_id from unit_members
        where department_id <> '' order by person_id, created_at) m
 where p.id = m.person_id and p.position_id = '';
-- Без позиции человек не бывает: остальным — Other
update people set position_id = 'd_other' where position_id = '';
alter table people alter column position_id set default 'd_other';

-- Служебный режим: системные операции (whoami, серверные функции) обходят проверки триггеров.
create or replace function app_system() returns boolean language sql stable as $$
  select auth.uid() is null or coalesce(current_setting('app.system', true), '') = 'on';
$$;

create or replace function my_person_id() returns text
language sql stable security definer set search_path = public as $$
  select id from people where user_id = auth.uid() and active limit 1;
$$;
create or replace function my_access() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select access from people where user_id = auth.uid() and active limit 1), '');
$$;
create or replace function my_position() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select position_id from people where user_id = auth.uid() and active limit 1), '');
$$;
-- Команды вошедшего
create or replace function my_teams() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce((select array(select jsonb_array_elements_text(team_ids)) from people where user_id = auth.uid() and active limit 1), '{}');
$$;
-- Все позиции вошедшего: основная + дополнительные
create or replace function my_positions() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce((select array_remove(array[position_id] || array(select jsonb_array_elements_text(extra_positions)), '')
                     from people where user_id = auth.uid() and active limit 1), '{}');
$$;
create or replace function is_staff() returns boolean language sql stable set search_path = public as $$
  select my_access() in ('superadmin', 'moderator');
$$;
create or replace function is_superadmin() returns boolean language sql stable set search_path = public as $$
  select my_access() = 'superadmin';
$$;
create or replace function is_unit_member(p_unit text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from unit_members where unit_id = p_unit and person_id = my_person_id());
$$;

-- Видно ли вошедшему поле-ссылку: администраторам — все, участнику — поля для всех и для его позиции.
create or replace function can_see_link(p_field text) returns boolean
language sql stable security definer set search_path = public as $$
  select is_staff() or exists (select 1 from link_fields f where f.id = p_field and not f.archived
    and (f.positions = '[]'::jsonb or f.positions ?| my_positions()));
$$;

-- Кто я: профиль вошедшего. Первый вход по email привязывает существующий профиль с тем же email.
-- Если в сервисе ещё нет ни одного супер-админа, вошедший становится супер-админом.
create or replace function whoami() returns setof people
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_id text;
begin
  if v_uid is null then return; end if;
  perform set_config('app.system', 'on', true);
  select id into v_id from people where user_id = v_uid;
  if v_id is null and v_email <> '' then
    select id into v_id from people where user_id is null and lower(email) = v_email order by created_at limit 1;
    if v_id is not null then update people set user_id = v_uid where id = v_id; end if;
  end if;
  if not exists (select 1 from people where access = 'superadmin' and active) then
    if v_id is null then
      v_id := 'p_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
      insert into people (id, name, email, user_id, access, created_at)
      values (v_id, split_part(v_email, '@', 1), v_email, v_uid, 'superadmin',
              to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    else
      update people set access = 'superadmin', active = true where id = v_id;
    end if;
  end if;
  perform set_config('app.system', 'off', true);
  return query select * from people where id = v_id;
end $$;

-- Команда ASO (2026-10-26)
do $$ begin
  if not exists (select 1 from app_settings where key = 'teamAsoSeeded') then
    insert into teams (id, name, color, ord) values ('t_aso', 'ASO', '#f59e0b', 6) on conflict (id) do nothing;
    insert into app_settings (key, value, updated_at) values ('teamAsoSeeded', 'true'::jsonb, '') on conflict (key) do nothing;
  end if;
end $$;
-- Однократно: общий «Приоритет» на все юниты; старые приоритеты юнитов сливаются в него.
do $$
declare
  g text := 'f_priority';
  opts jsonb := '[{"id":"o_low","name":"Низкий","color":"#64748b"},{"id":"o_medium","name":"Средний","color":"#f59e0b"},{"id":"o_high","name":"Высокий","color":"#ef4444"},{"id":"o_critical","name":"Критический","color":"#b91c1c"}]';
begin
  if not exists (select 1 from fields where unit_id is null and role = 'priority') then
    perform set_config('app.system', 'on', true);
    insert into fields (id, unit_id, name, type, options, show_on_card, required, ord, archived, staff_only, role)
    values (g, null, 'Приоритет', 'select', opts, true, false, 0, false, true, 'priority')
    on conflict (id) do nothing;
    -- значения старых приоритетов юнитов → общий: по названию варианта, иначе по тому же id
    update tasks t set fields = (t.fields - f.id) || jsonb_strip_nulls(jsonb_build_object(g, coalesce(
        (select n ->> 'id' from jsonb_array_elements(opts) n
          where lower(n ->> 'name') = (select case lower(o ->> 'name') when 'low' then 'низкий' when 'medium' then 'средний' when 'high' then 'высокий' when 'critical' then 'критический' else lower(o ->> 'name') end from jsonb_array_elements(f.options) o where o ->> 'id' = t.fields ->> f.id)),
        (select n ->> 'id' from jsonb_array_elements(opts) n where n ->> 'id' = t.fields ->> f.id))))
      from fields f
     where f.unit_id = t.unit_id and f.role = 'priority' and t.fields ? f.id;
    delete from fields where unit_id is not null and role = 'priority';
    perform set_config('app.system', 'off', true);
  end if;
end $$;
-- Названия приоритета — по-русски (по макету); у уже созданного поля — однократно
do $$
begin
  perform set_config('app.system', 'on', true);
  update fields set options = (select jsonb_agg(case o ->> 'id'
      when 'o_low' then jsonb_set(o, '{name}', '"Низкий"') when 'o_medium' then jsonb_set(o, '{name}', '"Средний"')
      when 'o_high' then jsonb_set(o, '{name}', '"Высокий"') when 'o_critical' then jsonb_set(o, '{name}', '"Критический"') else o end order by n)
    from jsonb_array_elements(options) with ordinality t(o, n))
   where id = 'f_priority' and options::text like '%"name": "Low"%' or id = 'f_priority' and options::text like '%"name":"Low"%';
  perform set_config('app.system', 'off', true);
end $$;

-- ---------- Tasks 2.0: роли, приложения, этапы ----------
-- Роли (people.access) в интерфейсе: superadmin — CEO (всё), moderator — PM (свои юниты), rm — релиз-менеджер,
-- lead — лид (ревью своей позиции), member — сотрудник. Внутренние значения прежние — права в базе на них опираются.
alter table people drop constraint if exists people_access_check;
alter table people add constraint people_access_check check (access in ('superadmin', 'moderator', 'rm', 'lead', 'member'));

-- Режим разработчика: переключение «смотреть как», шорткаты-сценарии и тестовые данные. Флаг ставит только система (SQL).
alter table people add column if not exists is_dev boolean not null default false;
create or replace function is_dev() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_dev from people where user_id = auth.uid() and active limit 1), false);
$$;

-- Управляет юнитом: CEO — любым, PM — теми, где он в составе.
create or replace function can_manage(p_unit text) returns boolean language sql stable set search_path = public as $$
  select is_superadmin() or (my_access() = 'moderator' and is_unit_member(p_unit));
$$;

-- Приложение — постоянная сущность: юнит (Gold / RF / MVP), статус из настраиваемого списка (app_settings.appStatuses),
-- инфо-поля. Задачи по приложению (запросы CEO и этапы) ссылаются на него через tasks.app_id.
create table if not exists apps (
  id         text primary key,
  unit_id    text not null references units(id) on delete cascade,
  name       text not null,
  color      text not null default '',
  status     text not null default '',
  info       jsonb not null default '{}',
  ord        double precision not null default 0,
  archived   boolean not null default false,
  is_test    boolean not null default false,
  created_by text not null default '',
  created_at text not null,
  updated_at text not null
);
create index if not exists apps_unit on apps(unit_id);
-- Какие приложения видит каждый PM: список настраивает CEO. Пустой список — PM не видит ни одного приложения.
-- При первом создании таблицы PM получают все приложения своих юнитов (чтобы ничего не пропало), дальше список ведёт CEO.
do $$ begin
  if to_regclass('public.pm_apps') is null then
    create table pm_apps (
      person_id text not null references people(id) on delete cascade,
      app_id    text not null references apps(id) on delete cascade,
      primary key (person_id, app_id)
    );
    insert into pm_apps (person_id, app_id)
      select p.id, a.id from people p
        join unit_members m on m.person_id = p.id
        join apps a on a.unit_id = m.unit_id
       where p.access = 'moderator'
      on conflict do nothing;
  end if;
end $$;
create index if not exists pm_apps_app on pm_apps(app_id);
alter table pm_apps enable row level security;
drop policy if exists pm_apps_read on pm_apps;
create policy pm_apps_read on pm_apps for select to authenticated using (is_superadmin() or person_id = my_person_id());
drop policy if exists pm_apps_write on pm_apps;
create policy pm_apps_write on pm_apps for all to authenticated using (is_superadmin()) with check (is_superadmin());
create or replace function pm_sees_app(p_app text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from pm_apps where person_id = my_person_id() and app_id = p_app);
$$;
-- новое приложение сразу попадает в список PM своего юнита; CEO может убрать
create or replace function grant_app_to_pms() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into pm_apps (person_id, app_id)
    select p.id, new.id from unit_members m join people p on p.id = m.person_id
     where m.unit_id = new.unit_id and p.access = 'moderator' and p.active
    on conflict do nothing;
  return new;
end $$;
drop trigger if exists grant_app_to_pms on apps;
create trigger grant_app_to_pms after insert on apps for each row execute function grant_app_to_pms();
-- приложение переехало в другой юнит: список сбрасывается, доступ получают PM нового юнита
create or replace function regrant_app_pms() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from pm_apps where app_id = new.id;
  insert into pm_apps (person_id, app_id)
    select p.id, new.id from unit_members m join people p on p.id = m.person_id
     where m.unit_id = new.unit_id and p.access = 'moderator' and p.active
    on conflict do nothing;
  return new;
end $$;
drop trigger if exists regrant_app_pms on apps;
create trigger regrant_app_pms after update of unit_id on apps for each row when (new.unit_id is distinct from old.unit_id) execute function regrant_app_pms();

-- Зона лида = его позиции + конкретные люди, которых ему выдали CEO или PM юнита.
-- Лид видит и ведёт задачи своей зоны (и свои), остальное в юните для него закрыто.
create table if not exists lead_people (
  lead_id   text not null references people(id) on delete cascade,
  person_id text not null references people(id) on delete cascade,
  primary key (lead_id, person_id)
);
create index if not exists lead_people_person on lead_people(person_id);
alter table lead_people enable row level security;
drop policy if exists lead_people_read on lead_people;
create policy lead_people_read on lead_people for select to authenticated
  using (is_superadmin() or lead_id = my_person_id()
         or (my_access() = 'moderator' and exists (select 1 from unit_members a join unit_members b on b.unit_id = a.unit_id
                                                    where a.person_id = my_person_id() and b.person_id = lead_people.lead_id)));
-- записывает только функция set_lead_people (проверяет, что PM трогает лидов своих юнитов)
drop policy if exists lead_people_write on lead_people;
create policy lead_people_write on lead_people for all to authenticated using (is_superadmin()) with check (is_superadmin());
create or replace function in_lead_zone(p_unit text, p_dept text, p_assignee text) returns boolean
language sql stable security definer set search_path = public as $$
  select my_access() = 'lead' and is_unit_member(p_unit)
     and ((p_dept <> '' and p_dept = any(my_positions()))
          or (p_assignee <> '' and exists (select 1 from lead_people where lead_id = my_person_id() and person_id = p_assignee)));
$$;
-- Выдать лиду людей (замена списка): CEO — любому лиду, PM — лиду своего юнита и людям из этого юнита
create or replace function set_lead_people(p_lead text, p_people jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  if not app_system() and not is_superadmin() then
    if my_access() <> 'moderator' then raise exception 'Недостаточно прав' using errcode = '42501'; end if;
    if not exists (select 1 from unit_members a join unit_members b on b.unit_id = a.unit_id
                    where a.person_id = my_person_id() and b.person_id = p_lead) then
      raise exception 'Недостаточно прав: лид не из вашего юнита' using errcode = '42501';
    end if;
  end if;
  if not exists (select 1 from people where id = p_lead and access = 'lead') then
    raise exception 'Зона настраивается только для лида' using errcode = 'P0001';
  end if;
  delete from lead_people where lead_id = p_lead;
  for v_id in select distinct x from jsonb_array_elements_text(coalesce(p_people, '[]'::jsonb)) x loop
    if v_id = p_lead or not exists (select 1 from unit_members a join unit_members b on b.unit_id = a.unit_id
                                     where a.person_id = p_lead and b.person_id = v_id) then continue; end if;
    insert into lead_people (lead_id, person_id) values (p_lead, v_id) on conflict do nothing;
  end loop;
end $$;

-- Заметки к приложению (идеи на будущее, договорённости): видит тот, кто видит приложение; удаляет автор или CEO
create table if not exists app_notes (
  id        text primary key,
  app_id    text not null references apps(id) on delete cascade,
  author_id text not null default '',
  text      text not null,
  at        text not null
);
create index if not exists app_notes_app on app_notes(app_id);
-- автор заметки — всегда тот, кто пишет
create or replace function guard_note_author() returns trigger language plpgsql set search_path = public as $$
begin
  if not app_system() then new.author_id := coalesce(my_person_id(), ''); end if;
  return new;
end $$;
drop trigger if exists guard_note_author on app_notes;
create trigger guard_note_author before insert on app_notes for each row execute function guard_note_author();
-- Приоритет приложения (вариант общего поля «Приоритет»: o_low / o_medium / o_high / o_critical) и когда сменился статус
alter table apps add column if not exists priority text not null default '';
-- Иконка из App Store (artwork по ссылке на стор)
alter table apps add column if not exists icon_url text not null default '';
-- Название в App Store (как приложение называется в сторе; своё название — name)
alter table apps add column if not exists store_name text not null default '';
-- Проверка App Store: открывается ли страница в сторе (null — не проверяли) и когда проверяли
alter table apps add column if not exists store_ok boolean;
alter table apps add column if not exists store_checked_at text not null default '';
-- Info приложения: отметки общих пунктов (app_settings.appInfoItems) и свои пункты — { done: [id], own: [{ id, name, done }] }
alter table apps add column if not exists checks jsonb not null default '{}';
-- Свои поля «Быстрого доступа» у приложения (общие — app_settings.appFields): [{ id, name, kind: link | text, value }]
alter table apps add column if not exists own_fields jsonb not null default '[]';
-- ТЗ задачи — ссылка (наследуется этапами и подзадачами от родителя)
alter table tasks add column if not exists spec_url text not null default '';
-- Этапы флоу, которые нужны запросу (из шаблона апдейта); пусто — все этапы флоу
alter table tasks add column if not exists flow_steps jsonb not null default '[]';
alter table apps add column if not exists status_at text not null default '';
-- Полка приложения (переносит CEO): spam — Design Spam [4.3], sale — снято с продажи, deleted — удалённые; приложение при этом archived.
-- shelf_tasks — открытые задачи, которые ушли в архив вместе с ним (вернутся при восстановлении).
alter table apps add column if not exists shelf text not null default '';
alter table apps add column if not exists shelved_at text not null default '';
alter table apps add column if not exists shelf_tasks jsonb not null default '[]';

-- Задачи 2.0: приложение; запрос CEO (kind request, request_type new_app / update / other);
-- этап декомпозиции (kind stage, step — ключ этапа флоу: design / ios / qa / meta / release…);
-- depends_on — этапы, которые нужно закрыть раньше; is_test — создано шорткатом разработчика.
alter table tasks add column if not exists app_id text not null default '';
alter table tasks add column if not exists request_type text not null default '';
alter table tasks add column if not exists step text not null default '';
alter table tasks add column if not exists depends_on jsonb not null default '[]';
alter table tasks add column if not exists is_test boolean not null default false;
-- Когда задачу впервые взяли в работу (для KPI: среднее время задачи — от «в работе» до «готово»)
alter table tasks add column if not exists started_at text not null default '';
-- Релиз (этап step = release): phase '' (к отправке) / submitted (ревью Apple) / rejected / live, values — релизные поля,
-- submittedAt, rejectedAt, reason, liveAt, rejectRequestId, pmId. Меняет функция release_step (кнопки RM).
alter table tasks add column if not exists release jsonb not null default '{}';
-- опросник разработчика перед релизом (этап step = 'ios'): { answers: { <вопрос>: { v, note } }, by, at }
alter table tasks add column if not exists dev_form jsonb not null default '{}';
create index if not exists tasks_app on tasks(app_id);

-- Статусы приложения по умолчанию; kind связывает статус с ходом работ (dev / release / review / live / reject, '' — свой).
insert into app_settings (key, value, updated_at) values ('appStatuses', '[
  {"id": "dev", "name": "В разработке", "color": "#6366f1", "kind": "dev"},
  {"id": "release", "name": "Релиз", "color": "#8b5cf6", "kind": "release"},
  {"id": "review", "name": "Ревью Apple", "color": "#f59e0b", "kind": "review"},
  {"id": "live", "name": "App Store", "color": "#0d9488", "kind": "live"},
  {"id": "button", "name": "На кнопке", "color": "#0ea5e9", "kind": ""},
  {"id": "reject", "name": "Реджект", "color": "#ef4444", "kind": "reject"}
]'::jsonb, '') on conflict (key) do nothing;
-- Статус «На кнопке» в уже настроенный список — один раз (метка в app_settings), после «В сторе»; удалённый CEO не возвращается
do $$ begin
  if not exists (select 1 from app_settings where key = 'migr_status_button') then
    update app_settings set value = (
      select jsonb_agg(x order by i) from (
        select x, i::numeric as i from jsonb_array_elements(value) with ordinality t(x, i)
        union all
        select '{"id": "button", "name": "На кнопке", "color": "#0ea5e9", "kind": ""}'::jsonb,
          coalesce((select i from jsonb_array_elements(value) with ordinality t(x, i) where x ->> 'kind' = 'live' limit 1), 999) + 0.5
      ) z)
    where key = 'appStatuses' and not exists (select 1 from jsonb_array_elements(value) x where x ->> 'id' = 'button');
    insert into app_settings (key, value, updated_at) values ('migr_status_button', 'true'::jsonb, '') on conflict (key) do nothing;
  end if;
end $$;

-- Поля приложения (быстрый доступ на карточке): ссылки и тексты; значения — в apps.info { id поля → значение }.
insert into app_settings (key, value, updated_at) values ('appFields', '[
  {"id": "appstore", "name": "App Store", "kind": "link"},
  {"id": "asc", "name": "App Store Connect", "kind": "link"},
  {"id": "figma", "name": "Figma", "kind": "link"},
  {"id": "drive", "name": "Google Drive", "kind": "link"}
]'::jsonb, '') on conflict (key) do nothing;
-- Релизные поля (заполняют RM или команда до отправки в Apple; required — без них «Отправил в Apple» недоступна)
insert into app_settings (key, value, updated_at) values ('releaseFields', '[
  {"id": "version", "name": "Версия", "kind": "text", "required": true},
  {"id": "build", "name": "Номер сборки", "kind": "text", "required": true},
  {"id": "whatsnew", "name": "Что нового", "kind": "longtext", "required": true},
  {"id": "testflight", "name": "TestFlight / сборка", "kind": "link", "required": false},
  {"id": "comment", "name": "Комментарий", "kind": "longtext", "required": false}
]'::jsonb, '') on conflict (key) do nothing;
-- База полей релиза (2026-10-31): TestFlight и комментарий — в уже настроенный список, один раз (метка); удалённые RM не возвращаются
do $$ begin
  if not exists (select 1 from app_settings where key = 'migr_release_fields_v2') then
    update app_settings set value = value || coalesce((
      select jsonb_agg(f) from jsonb_array_elements('[
        {"id": "testflight", "name": "TestFlight / сборка", "kind": "link", "required": false},
        {"id": "comment", "name": "Комментарий", "kind": "longtext", "required": false}]'::jsonb) f
       where not exists (select 1 from jsonb_array_elements(app_settings.value) x where x ->> 'id' = f ->> 'id')), '[]'::jsonb)
     where key = 'releaseFields';
    insert into app_settings (key, value, updated_at) values ('migr_release_fields_v2', 'true'::jsonb, '') on conflict (key) do nothing;
  end if;
end $$;
-- Чеклист релиза студии — больше не подставляется сам (решение заказчика): у RM свои шаблоны чеклистов («Из шаблона»)
insert into app_settings (key, value, updated_at) values ('releaseChecklist', '[
  "Сборка загружена в TestFlight и проверена",
  "Скриншоты и метаданные в App Store Connect",
  "Политика конфиденциальности и условия подписки",
  "Покупки и подписки проверены в песочнице"
]'::jsonb, '') on conflict (key) do nothing;

-- «Требует внимания» у CEO: работа без изменений столько дней
insert into app_settings (key, value, updated_at) values ('staleDays', '7'::jsonb, '') on conflict (key) do nothing;

-- Задача закрыта: её колонка — «готово».
create or replace function task_done(p_task text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from tasks t join units u on u.id = t.unit_id, jsonb_array_elements(u.settings -> 'columns') c
                  where t.id = p_task and c ->> 'id' = t.status and c ->> 'kind' = 'done');
$$;

-- Незакрытые этапы, от которых зависит задача (названия через запятую; null — всё закрыто).
create or replace function open_deps(p_deps jsonb) returns text
language sql stable security definer set search_path = public as $$
  select string_agg(t.title, ', ' order by t.title) from tasks t
   where t.id in (select jsonb_array_elements_text(coalesce(p_deps, '[]'::jsonb))) and not task_done(t.id);
$$;

-- ---------- проверки на уровне строк ----------

create or replace function guard_tasks() returns trigger language plpgsql set search_path = public as $$
declare missing text;
begin
  if app_system() then return new; end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(my_person_id(), '');
    if new.is_test and not is_dev() then
      raise exception 'Тестовые данные создаёт только режим разработчика' using errcode = '42501';
    end if;
    -- «нужно при создании» — для обычных задач, которые заводят вручную; запросы CEO и их этапы создаёт флоу
    select string_agg(f.name, ', ' order by f.ord) into missing from fields f
     where new.parent_id = '' and new.kind = '' and (f.unit_id = new.unit_id or f.unit_id is null) and f.required_on_create and not f.archived
       and coalesce(new.fields -> f.id, 'null'::jsonb) in ('null'::jsonb, '""'::jsonb, '[]'::jsonb, 'false'::jsonb);
    if missing is not null then
      raise exception 'Заполните при создании: %', missing using errcode = 'P0001';
    end if;
    return new;
  end if;
  if new.is_test is distinct from old.is_test and not is_dev() then
    raise exception 'Тестовые данные меняет только режим разработчика' using errcode = '42501';
  end if;
  -- Этап заблокирован, пока не закрыты этапы, от которых он зависит: из «не начато» его не сдвинуть (никому)
  if new.status is distinct from old.status and new.depends_on <> '[]'::jsonb
     and coalesce((select c ->> 'kind' from units u, jsonb_array_elements(u.settings -> 'columns') c
                    where u.id = new.unit_id and c ->> 'id' = new.status), 'todo') <> 'todo' then
    missing := open_deps(new.depends_on);
    if missing is not null then
      raise exception 'Этап заблокирован: сначала закройте «%»', missing using errcode = 'P0001';
    end if;
  end if;
  -- лид ведёт задачи своей зоны: срок и исполнитель (из своей же зоны); название и остальное — как у сотрудника
  if not can_manage(new.unit_id) and my_access() = 'lead' and in_lead_zone(old.unit_id, old.department_id, old.assignee_id) then
    if new.assignee_id is distinct from old.assignee_id and new.assignee_id <> ''
       and not exists (select 1 from people p where p.id = new.assignee_id and p.active and exists (select 1 from unit_members um where um.unit_id = new.unit_id and um.person_id = p.id)
                         and (new.department_id = '' or new.department_id = p.position_id or p.extra_positions ? new.department_id
                              or exists (select 1 from lead_people lp where lp.lead_id = my_person_id() and lp.person_id = p.id))) then
      raise exception 'Недостаточно прав: передать можно только человеку из вашей зоны' using errcode = '42501';
    end if;
  end if;
  if not can_manage(new.unit_id) then
    if new.title is distinct from old.title
       or (new.assignee_id is distinct from old.assignee_id and not (my_access() = 'lead' and in_lead_zone(old.unit_id, old.department_id, old.assignee_id)))
       or (new.due_date is distinct from old.due_date and not (my_access() = 'lead' and in_lead_zone(old.unit_id, old.department_id, old.assignee_id)))
       or new.unit_id is distinct from old.unit_id
       or new.department_id is distinct from old.department_id or new.archived is distinct from old.archived
       or new.num is distinct from old.num or new.created_by is distinct from old.created_by
       or new.team_id is distinct from old.team_id
       or new.parent_id is distinct from old.parent_id or new.kind is distinct from old.kind
       or new.app_id is distinct from old.app_id or new.step is distinct from old.step
       or new.depends_on is distinct from old.depends_on or new.request_type is distinct from old.request_type
       or (new.release - 'values') is distinct from (old.release - 'values') then
      raise exception 'Недостаточно прав: сотрудник меняет только статус, описание, поля и чеклист своей задачи' using errcode = '42501';
    end if;
    select string_agg(f.name, ', ') into missing from fields f
     where (f.unit_id = new.unit_id or f.unit_id is null) and f.staff_only and (new.fields -> f.id) is distinct from (old.fields -> f.id);
    if missing is not null then
      raise exception 'Недостаточно прав: «%» меняют только CEO и PM', missing using errcode = '42501';
    end if;
    if new.status is distinct from old.status then
      -- поле юнита с колонкой required_from нужно при переносе в неё и правее;
      -- у общего поля required_from — тип колонки (progress / done): с этого типа и дальше
      with cols as (
        select c.v ->> 'id' as id, c.v ->> 'kind' as kind, c.i from units u, jsonb_array_elements(u.settings -> 'columns') with ordinality c(v, i)
         where u.id = new.unit_id)
      select string_agg(f.name, ', ' order by f.ord) into missing from fields f
       where (f.unit_id = new.unit_id or f.unit_id is null) and f.required and not f.archived
         and (f.required_from = ''
              or (f.unit_id is not null
                  and coalesce((select i from cols where id = new.status), 0) >= coalesce((select i from cols where id = f.required_from), 0))
              or (f.unit_id is null
                  and array_position(array['todo', 'progress', 'done'],
                                     (select kind from cols where id = new.status))
                      >= coalesce(array_position(array['todo', 'progress', 'done'], f.required_from), 1)))
         and coalesce(new.fields -> f.id, 'null'::jsonb) in ('null'::jsonb, '""'::jsonb, '[]'::jsonb, 'false'::jsonb);
      if missing is not null then
        raise exception 'Сначала заполните обязательные поля: %', missing using errcode = 'P0001';
      end if;
      -- юнит может требовать закрытый чеклист перед «готово»
      if exists (select 1 from units u, jsonb_array_elements(u.settings -> 'columns') c
                  where u.id = new.unit_id and coalesce((u.settings ->> 'checklistBeforeDone')::boolean, false)
                    and c ->> 'id' = new.status and c ->> 'kind' = 'done')
         and exists (select 1 from jsonb_array_elements(new.checklist) i where not coalesce((i ->> 'done')::boolean, false)) then
        raise exception 'Сначала закройте чеклист: в «готово» нельзя с невыполненными пунктами' using errcode = 'P0001';
      end if;
      -- этапы дизайна, текстов и локализаций уходят на ревью и в «готово» только с закрытым чеклистом
      if new.kind = 'stage' and new.step in ('design', 'art', 'meta', 'store', 'retext', 'l10n')
         and (new.status = coalesce((select u.settings -> 'review' ->> 'column' from units u where u.id = new.unit_id), '')
              or coalesce((select c ->> 'kind' from units u, jsonb_array_elements(u.settings -> 'columns') c
                            where u.id = new.unit_id and c ->> 'id' = new.status), '') = 'done')
         and not exists (select 1 from tasks p where p.parent_id = new.id and p.step = 'part' and not p.archived)
         and exists (select 1 from jsonb_array_elements(new.checklist) i where not coalesce((i ->> 'done')::boolean, false)) then
        raise exception 'Сначала закройте чеклист этапа: на ревью и в «готово» только с выполненными пунктами' using errcode = 'P0001';
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_tasks on tasks;
create trigger guard_tasks before insert or update on tasks for each row execute function guard_tasks();

-- Задачу перенесли в другой юнит — её ссылки переезжают вместе с ней.
create or replace function sync_link_unit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update task_links set unit_id = new.unit_id where task_id = new.id;
  return new;
end $$;
drop trigger if exists sync_link_unit on tasks;
create trigger sync_link_unit after update of unit_id on tasks for each row
  when (new.unit_id is distinct from old.unit_id) execute function sync_link_unit();

-- Автоназначение на ревью (настройка юнита settings.review: column, byPosition {позиция → человек}, default):
-- задача пришла в колонку ревью — исполнителем становится ревьюер её позиции (или ревьюер по умолчанию),
-- прежний исполнитель запоминается; ушла из ревью — возвращается ему (если исполнителя не сменили вручную).
-- Срабатывает после guard_tasks (по алфавиту), поэтому участнику не нужно право менять исполнителя.
create or replace function review_assign() returns trigger language plpgsql security definer set search_path = public as $$
declare
  rv jsonb;
  col text;
  who text;
  at_ text := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if new.status is not distinct from old.status then return new; end if;
  -- этап «Релиз» ведёт RM, его статус следует за фазой релиза; разработка проверяется тестированием, не ревью лида
  if new.step in ('release', 'ios') then return new; end if;
  select settings -> 'review' into rv from units where id = new.unit_id;
  col := coalesce(rv ->> 'column', '');
  if col = '' then return new; end if;
  if new.status = col then
    -- ревьюер задаётся только в настройках юнита: по позиции задачи, иначе по умолчанию
    who := coalesce(nullif(rv -> 'byPosition' ->> new.department_id, ''), nullif(rv ->> 'default', ''), '');
    if who <> '' then who := deputy_for(who); end if; -- ревьюер в отпуске — ревью у заместителя
    if who <> '' and who <> new.assignee_id and new.assignee_id = old.assignee_id
       and exists (select 1 from people where id = who and active) then
      new.review_from := old.assignee_id;
      new.reviewer_id := who;
      new.assignee_id := who;
      insert into activity (id, unit_id, task_id, action, field, from_val, to_val, at)
      values ('a_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12), new.unit_id, new.id, 'update', 'assigneeId',
              to_jsonb(old.assignee_id)::text, to_jsonb(who)::text, at_);
    end if;
  elsif old.status = col and new.review_from <> '' then
    if new.assignee_id = old.assignee_id and exists (select 1 from people where id = new.review_from and active) then
      new.assignee_id := new.review_from;
      insert into activity (id, unit_id, task_id, action, field, from_val, to_val, at)
      values ('a_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12), new.unit_id, new.id, 'update', 'assigneeId',
              to_jsonb(old.assignee_id)::text, to_jsonb(new.review_from)::text, at_);
    end if;
    new.review_from := '';
  end if;
  return new;
end $$;
drop trigger if exists review_assign on tasks;
create trigger review_assign before update on tasks for each row execute function review_assign();

-- В «готово» — только через ревью (решение заказчика): исполнитель (не CEO и не PM юнита) не может перенести задачу
-- в колонку типа done мимо колонки ревью; из ревью в «готово» переносит ревьюер («Аппрув»). Без колонки ревью — без ограничения.
create or replace function guard_done_review() returns trigger language plpgsql set search_path = public as $$
declare
  st jsonb;
  col text;
  k text;
begin
  if app_system() or new.status is not distinct from old.status or can_manage(new.unit_id) then return new; end if;
  -- разработка: код-ревью нет — «готово» и есть «отдать на тестирование»; тестирование: «готово» от QA = приёмка
  if new.step in ('ios', 'qa') then return new; end if;
  select settings into st from units where id = new.unit_id;
  col := coalesce(st -> 'review' ->> 'column', '');
  if col = '' then return new; end if;
  select x ->> 'kind' into k from jsonb_array_elements(st -> 'columns') x where x ->> 'id' = new.status limit 1;
  if coalesce(k, '') = 'done' and old.status <> col then
    raise exception 'Готово — только через ревью: отправьте задачу на ревью' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists guard_done_review on tasks;
create trigger guard_done_review before update on tasks for each row execute function guard_done_review();

-- Разработчик не отдаёт этап iOS на ревью и не закрывает его без опросника (CEO и PM — без ограничения).
-- Текст с префиксом DEV_FORM: — интерфейс по нему открывает опросник этого этапа.
create or replace function guard_dev_form() returns trigger language plpgsql set search_path = public as $$
declare
  st jsonb;
  k text;
begin
  -- кто заполняет опросник (dev_form.need: этап iOS — да, если не false; интеграция — только если true) решают PM и CEO
  if (new.dev_form -> 'need') is distinct from (old.dev_form -> 'need') and not (app_system() or can_manage(new.unit_id)) then
    raise exception 'Кто заполняет опросник, решает PM' using errcode = '42501';
  end if;
  if app_system() or new.step not in ('ios', 'integr') or new.status is not distinct from old.status or can_manage(new.unit_id) then return new; end if;
  if new.step = 'ios' and coalesce(new.dev_form ->> 'need', '') = 'false' then return new; end if;
  if new.step = 'integr' and coalesce(new.dev_form ->> 'need', '') <> 'true' then return new; end if;
  if coalesce(new.dev_form ->> 'at', '') <> '' then return new; end if;
  select settings into st from units where id = new.unit_id;
  select x ->> 'kind' into k from jsonb_array_elements(st -> 'columns') x where x ->> 'id' = new.status limit 1;
  if coalesce(k, '') = 'done' or new.status = coalesce(st -> 'review' ->> 'column', '') then
    raise exception 'DEV_FORM:%', new.id using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists guard_dev_form on tasks;
create trigger guard_dev_form before update on tasks for each row execute function guard_dev_form();

-- Прежняя передача вниз (юнит приложений → Managers) — убрана вместе с иерархией юнитов.
drop trigger if exists handoff_task on tasks;
drop function if exists handoff_task();
drop function if exists do_handoff(text);
drop function if exists handoff_copy(text);

-- Дублировать задачу (администраторы): копия в том же юните и колонке — поля, чеклист, связи; без ревью.
-- Копия, а не новая задача, поэтому «нужно при создании» не проверяется (значения берутся из оригинала).
create or replace function duplicate_task(p_task text, p_id text, p_title text, p_ord double precision, p_at text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from tasks where id = p_task) then raise exception 'Задача не найдена' using errcode = 'P0001'; end if;
  if not app_system() and not exists (select 1 from tasks where id = p_task and can_manage(unit_id)) then
    raise exception 'Недостаточно прав для этого действия' using errcode = '42501';
  end if;
  perform set_config('app.system', 'on', true);
  insert into tasks (id, unit_id, num, title, description, status, assignee_id, department_id, due_date, ord,
                     fields, checklist, archived, done_at, created_by, created_at, updated_at, parent_id, kind, team_id)
  select p_id, unit_id, next_task_num(unit_id), p_title, description, status, assignee_id, department_id, due_date, p_ord,
         fields, checklist, false, case when done_at <> '' then p_at else '' end, coalesce(my_person_id(), ''), p_at, p_at, parent_id, kind, team_id
    from tasks where id = p_task;
  perform set_config('app.system', 'off', true);
end $$;

-- «Забрать из ревью»: тот, кто отправил задачу на ревью, возвращает её себе в колонку перед ревью
-- (что-то забыл). Исполнителем снова становится он — это делает review_assign при выходе из колонки ревью.
create or replace function recall_review(p_task text) returns void
language plpgsql security definer set search_path = public as $$
declare
  t tasks;
  rv jsonb;
  cols jsonb;
  i int;
  target text := '';
begin
  select * into t from tasks where id = p_task;
  if t.id is null then raise exception 'Задача не найдена' using errcode = 'P0001'; end if;
  select settings -> 'review', settings -> 'columns' into rv, cols from units where id = t.unit_id;
  if coalesce(rv ->> 'column', '') = '' or t.status <> rv ->> 'column' then
    raise exception 'Задача уже не на ревью' using errcode = 'P0001';
  end if;
  if t.review_from = '' or t.review_from is distinct from my_person_id() then
    raise exception 'Забрать из ревью может только тот, кто её отправил' using errcode = '42501';
  end if;
  -- колонка перед ревью (не «готово»); если такой нет — первая
  for i in reverse jsonb_array_length(cols) - 1 .. 0 loop
    if cols -> i ->> 'id' = t.status then
      for j in reverse i - 1 .. 0 loop
        if coalesce(cols -> j ->> 'kind', '') <> 'done' then target := cols -> j ->> 'id'; exit; end if;
      end loop;
      exit;
    end if;
  end loop;
  if target = '' then target := cols -> 0 ->> 'id'; end if;
  update tasks set status = target, done_at = '', updated_at = to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
   where id = t.id;
  insert into activity (id, unit_id, task_id, action, field, from_val, to_val, at)
  values ('a_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12), t.unit_id, t.id, 'update', 'status',
          to_jsonb(t.status)::text, to_jsonb(target)::text, to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;

-- Назначили задачу — уведомление новому исполнителю (кроме случая, когда назначил сам себя);
-- у прежнего исполнителя непрочитанное уведомление по этой задаче снимается.
-- Автоназначение ревью (kind 'review'), возврат с ревью ('returned') и закрытие по ревью ('approved') —
-- тоже уведомления исполнителю; на ревью уведомляют всегда, даже если перенёс сам.
-- Уведомления по тестовым задачам (демо, шорткаты разработчика): только разработчику и людям без входа (демо-люди) —
-- реальных сотрудников не беспокоим. Обычные задачи — всем.
create or replace function notify_test_ok(p_is_test boolean, p_person text) returns boolean
language sql stable security definer set search_path = public as $$
  select not coalesce(p_is_test, false) or exists (select 1 from people where id = p_person and (is_dev or user_id is null));
$$;

create or replace function notify_assignee() returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor text := coalesce(my_person_id(), '');
  v_old text := case when tg_op = 'UPDATE' then old.assignee_id else '' end;
  v_kind text := 'assigned';
begin
  if new.assignee_id is not distinct from v_old then return new; end if;
  -- этап ещё ждёт предыдущих — исполнитель его пока не видит; когда откроется, придёт «Можно начинать»
  if new.depends_on <> '[]'::jsonb and open_deps(new.depends_on) is not null then return new; end if;
  -- тестовые задачи (шорткаты разработчика) не беспокоят реальных людей
  if not notify_test_ok(new.is_test, new.assignee_id) then return new; end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.review_from <> '' and old.review_from = '' then v_kind := 'review';
    elsif old.review_from <> '' and new.review_from = '' and new.assignee_id = old.review_from then
      -- ревьюер принял работу (перенёс в «готово») — «закрыта по ревью», иначе — «вернули»
      v_kind := case when exists (select 1 from units u, jsonb_array_elements(u.settings -> 'columns') c
                                   where u.id = new.unit_id and c ->> 'id' = new.status and c ->> 'kind' = 'done')
                     then 'approved' else 'returned' end;
    end if;
  end if;
  if v_old <> '' then delete from notifications where task_id = new.id and person_id = v_old and read_at = ''; end if;
  if new.assignee_id <> '' and (new.assignee_id <> v_actor or v_kind = 'review') then
    delete from notifications where task_id = new.id and person_id = new.assignee_id and read_at = '';
    insert into notifications (id, person_id, task_id, kind, actor_id, at)
    values ('n_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12), new.assignee_id, new.id, v_kind, v_actor,
            to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  end if;
  return new;
end $$;
drop trigger if exists notify_assignee on tasks;
create trigger notify_assignee after insert or update on tasks for each row execute function notify_assignee();

-- Этап разблокировался: задача закрылась — исполнителям этапов, которые ждали только её, уведомление «Можно начинать»
-- (kind 'unblocked'). Тестовые задачи — только разработчику.
create or replace function notify_unblocked() returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor text := coalesce(my_person_id(), '');
  at_ text := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if new.status is not distinct from old.status or not task_done(new.id) then return new; end if;
  insert into notifications (id, person_id, task_id, kind, actor_id, at)
  select 'n_' || substr(md5(random()::text || clock_timestamp()::text || d.id), 1, 12), d.assignee_id, d.id, 'unblocked', v_actor, at_
    from tasks d
   where d.depends_on ? new.id and d.assignee_id <> '' and not d.archived and not task_done(d.id)
     and open_deps(d.depends_on) is null
     and notify_test_ok(d.is_test, d.assignee_id)
     -- не дублируем, пока прежнее не прочитано; после возврата QA и повторной сдачи — снова «можно начинать»
     and not exists (select 1 from notifications n where n.task_id = d.id and n.person_id = d.assignee_id and n.kind = 'unblocked' and n.read_at = '');
  return new;
end $$;
-- Задача закрыта: сообщаем тому, кто её поставил, и ревьюеру (себе не пишем)
create or replace function notify_done() returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor text := coalesce(my_person_id(), '');
  v_who text;
begin
  if new.status is not distinct from old.status then return new; end if;
  if not exists (select 1 from units u, jsonb_array_elements(u.settings -> 'columns') c
                  where u.id = new.unit_id and c ->> 'id' = new.status and c ->> 'kind' = 'done') then return new; end if;
  if exists (select 1 from units u, jsonb_array_elements(u.settings -> 'columns') c
              where u.id = new.unit_id and c ->> 'id' = old.status and c ->> 'kind' = 'done') then return new; end if;
  for v_who in select distinct x from unnest(array[new.created_by, new.reviewer_id]) x where x <> '' and x <> v_actor and exists (select 1 from people where id = x and active) and notify_test_ok(new.is_test, x) loop
    insert into notifications (id, person_id, task_id, kind, actor_id, at)
    values ('n_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12), v_who, new.id, 'task_done', v_actor,
            to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  end loop;
  return new;
end $$;
drop trigger if exists notify_done on tasks;
create trigger notify_done after update of status on tasks for each row execute function notify_done();
drop trigger if exists notify_unblocked on tasks;
create trigger notify_unblocked after update of status on tasks for each row execute function notify_unblocked();

-- Лид передаёт свой этап сотруднику своей позиции в этом юните (менять исполнителя участнику нельзя — делает функция).
create or replace function lead_handover(p_task text, p_person text) returns void
language plpgsql security definer set search_path = public as $$
declare
  t tasks;
  v_me text := my_person_id();
  at_ text := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select * into t from tasks where id = p_task;
  if t.id is null then raise exception 'Задача не найдена' using errcode = 'P0001'; end if;
  -- лид — свою задачу; CEO и PM юнита — за лида (как «Раздать»; в том числе из «смотреть как»)
  if not (can_manage(t.unit_id) or (my_access() = 'lead' and t.assignee_id = v_me)) then
    raise exception 'Недостаточно прав: передать может лид — свою задачу (или PM юнита)' using errcode = '42501';
  end if;
  if task_done(t.id) then raise exception 'Задача уже готова' using errcode = 'P0001'; end if;
  if not exists (select 1 from people p join unit_members m on m.person_id = p.id and m.unit_id = t.unit_id
                  where p.id = p_person and p.active and p.id <> t.assignee_id
                    and (t.department_id = '' or t.department_id = p.position_id or p.extra_positions ? t.department_id
                         or exists (select 1 from lead_people lp where lp.lead_id = t.assignee_id and lp.person_id = p.id))) then
    raise exception 'Передать можно сотруднику этой позиции или из вашей зоны' using errcode = 'P0001';
  end if;
  perform set_config('app.system', 'on', true);
  update tasks set assignee_id = p_person, updated_at = at_ where id = t.id;
  insert into activity (id, unit_id, task_id, action, field, from_val, to_val, actor_id, at)
  values ('a_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12), t.unit_id, t.id, 'update', 'assigneeId',
          to_jsonb(t.assignee_id)::text, to_jsonb(p_person)::text, coalesce(v_me, ''), at_);
  perform set_config('app.system', 'off', true);
end $$;

-- «Раздать» (лид): свой этап — на подзадачи сотрудникам своей позиции в юните. p_items: [{ title, assigneeId, dueDate, checklist: [text] }].
-- Подзадачи (step = 'part') наследуют ТЗ, описание, ссылки, приложение и приоритет; лид остаётся исполнителем этапа (ревьюер).
-- Возвращает id созданных задач. Этап закрывается сам, когда закрыты все его подзадачи (close_split_parent).
create or replace function lead_split(p_task text, p_items jsonb) returns setof text
language plpgsql security definer set search_path = public as $$
declare
  t tasks;
  v_me text := my_person_id();
  at_ text := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  it jsonb;
  v_id text;
  v_who text;
  v_first text;
  v_n int := 0;
begin
  select * into t from tasks where id = p_task;
  if t.id is null then raise exception 'Задача не найдена' using errcode = 'P0001'; end if;
  if not (can_manage(t.unit_id) or (my_access() = 'lead' and t.assignee_id = v_me)) then
    raise exception 'Раздать может лид — свою задачу (или PM юнита)' using errcode = '42501';
  end if;
  if task_done(t.id) then raise exception 'Задача уже готова' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Добавьте хотя бы одну подзадачу' using errcode = 'P0001'; end if;
  select c ->> 'id' into v_first from units u, jsonb_array_elements(u.settings -> 'columns') c where u.id = t.unit_id limit 1;
  perform set_config('app.system', 'on', true);
  for it in select * from jsonb_array_elements(p_items) loop
    v_who := coalesce(it ->> 'assigneeId', '');
    if btrim(coalesce(it ->> 'title', '')) = '' then continue; end if;
    if v_who <> '' and not exists (select 1 from people p join unit_members m on m.person_id = p.id and m.unit_id = t.unit_id
                    where p.id = v_who and p.active and (t.department_id = '' or t.department_id = p.position_id or p.extra_positions ? t.department_id)) then
      perform set_config('app.system', 'off', true);
      raise exception 'Раздать можно людям этой позиции в юните' using errcode = 'P0001';
    end if;
    v_id := 't_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
    insert into tasks (id, unit_id, num, title, description, status, assignee_id, department_id, due_date, ord, fields, checklist,
                       archived, done_at, created_by, created_at, updated_at, parent_id, kind, app_id, step, is_test, spec_url, started_at, reviewer_id)
    values (v_id, t.unit_id, next_task_num(t.unit_id), left(btrim(it ->> 'title'), 500), t.description, coalesce(v_first, t.status), v_who,
            t.department_id, coalesce(nullif(it ->> 'dueDate', ''), t.due_date), v_n, t.fields - '__none',
            coalesce((select jsonb_agg(jsonb_build_object('id', 'k_' || substr(md5(random()::text || x), 1, 10), 'text', left(x, 300), 'done', false))
                        from jsonb_array_elements_text(coalesce(it -> 'checklist', '[]'::jsonb)) x where btrim(x) <> ''), '[]'::jsonb),
            false, '', v_me, at_, at_, t.id, '', t.app_id, 'part', t.is_test, coalesce(t.spec_url, ''), '',
            ''); -- ревьюер назначается только настройками юнита
    insert into task_links (task_id, field_id, unit_id, url, updated_at)
      select v_id, l.field_id, t.unit_id, l.url, at_ from task_links l where l.task_id = t.id;
    insert into activity (id, unit_id, task_id, action, field, from_val, to_val, actor_id, at)
    values ('a_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12), t.unit_id, v_id, 'create', '', '', to_jsonb(left(btrim(it ->> 'title'), 500))::text, coalesce(v_me, ''), at_);
    v_n := v_n + 1;
    return next v_id;
  end loop;
  perform set_config('app.system', 'off', true);
end $$;

-- QA нашёл баги: «Вернуть в разработку» — закрытые этапы, от которых зависит тестирование (обычно iOS), снова в работе
-- у их исполнителей; список багов — комментарием к этим этапам и уведомление «вернули»; этап QA — снова «не начат» и ждёт.
drop function if exists qa_return(text, text);
-- QA вернул в разработку: баг-репорт №N (дата, кто, ссылка, текст) — в карточку QA и в карточки возвращённых этапов.
create or replace function qa_return(p_task text, p_text text, p_url text default '') returns integer
language plpgsql security definer set search_path = public as $$
declare
  t tasks;
  d tasks;
  v_me text := my_person_id();
  v_bug jsonb;
  v_head text;
  at_ text := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_todo text;
  v_prog text;
  n int := 0;
begin
  select * into t from tasks where id = p_task;
  if t.id is null then raise exception 'Задача не найдена' using errcode = 'P0001'; end if;
  if not (can_manage(t.unit_id) or t.assignee_id = v_me) then
    raise exception 'Вернуть в разработку может исполнитель тестирования (или PM)' using errcode = '42501';
  end if;
  if btrim(coalesce(p_text, '')) = '' and btrim(coalesce(p_url, '')) = '' then
    raise exception 'Добавьте ссылку на баг-репорт или опишите баги' using errcode = 'P0001';
  end if;
  v_bug := jsonb_build_object('n', jsonb_array_length(coalesce(t.bugs, '[]'::jsonb)) + 1, 'at', at_, 'by', coalesce(v_me, ''),
                              'url', btrim(coalesce(p_url, '')), 'text', left(btrim(coalesce(p_text, '')), 5000), 'qaTask', t.id, 'closedAt', '');
  v_head := 'Баг-репорт №' || (v_bug ->> 'n') || ' от QA';
  perform set_config('app.system', 'on', true);
  for d in select * from tasks where id in (select jsonb_array_elements_text(t.depends_on)) and task_done(id) loop
    -- обязательная колонка «Доработка» (id rework или по названию), иначе первая «в работе»
    select c ->> 'id' into v_prog from units u, jsonb_array_elements(u.settings -> 'columns') c
     where u.id = d.unit_id and c ->> 'kind' = 'progress'
     order by (c ->> 'id' = 'rework' or lower(btrim(c ->> 'name')) like 'доработ%') desc limit 1;
    update tasks set status = coalesce(v_prog, status), done_at = '', updated_at = at_, bugs = coalesce(bugs, '[]'::jsonb) || jsonb_build_array(v_bug) where id = d.id;
    insert into comments (id, task_id, text, author_id, at)
    values ('c_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12), d.id,
            left(v_head || case when v_bug ->> 'url' <> '' then ': ' || (v_bug ->> 'url') else '' end
                 || case when v_bug ->> 'text' <> '' then chr(10) || (v_bug ->> 'text') else '' end, 5000), coalesce(v_me, ''), at_);
    insert into activity (id, unit_id, task_id, action, field, from_val, to_val, actor_id, at)
    values ('a_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12), d.unit_id, d.id, 'update', 'status', to_jsonb(d.status)::text, to_jsonb(coalesce(v_prog, d.status))::text, coalesce(v_me, ''), at_);
    if d.assignee_id <> '' and notify_test_ok(d.is_test, d.assignee_id) then
      delete from notifications where task_id = d.id and person_id = d.assignee_id and read_at = '';
      insert into notifications (id, person_id, task_id, kind, actor_id, at)
      values ('n_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12), d.assignee_id, d.id, 'returned', coalesce(v_me, ''), at_);
    end if;
    n := n + 1;
  end loop;
  if n = 0 then
    perform set_config('app.system', 'off', true);
    raise exception 'Возвращать нечего: этапы до тестирования ещё не закрыты' using errcode = 'P0001';
  end if;
  select c ->> 'id' into v_todo from units u, jsonb_array_elements(u.settings -> 'columns') c where u.id = t.unit_id and c ->> 'kind' = 'todo' limit 1;
  update tasks set status = coalesce(v_todo, status), done_at = '', updated_at = at_, bugs = coalesce(bugs, '[]'::jsonb) || jsonb_build_array(v_bug) where id = t.id;
  insert into activity (id, unit_id, task_id, action, field, from_val, to_val, actor_id, at)
  values ('a_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12), t.unit_id, t.id, 'comment', '', '', to_jsonb(left('Вернул в разработку: ' || v_head || case when v_bug ->> 'text' <> '' then '. ' || (v_bug ->> 'text') else '' end, 200))::text, coalesce(v_me, ''), at_);
  perform set_config('app.system', 'off', true);
  return n;
end $$;

-- Этап, розданный на подзадачи (step = 'part'), закрывается сам, когда закрыты все его подзадачи.
create or replace function close_split_parent() returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_done text;
  at_ text := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  p tasks;
begin
  if new.step <> 'part' or new.parent_id = '' or new.status is not distinct from old.status or not task_done(new.id) then return new; end if;
  if exists (select 1 from tasks c where c.parent_id = new.parent_id and c.step = 'part' and not c.archived and c.id <> new.id and not task_done(c.id)) then return new; end if;
  select * into p from tasks where id = new.parent_id;
  if p.id is null or task_done(p.id) then return new; end if;
  select c ->> 'id' into v_done from units u, jsonb_array_elements(u.settings -> 'columns') c where u.id = p.unit_id and c ->> 'kind' = 'done' limit 1;
  if v_done is null then return new; end if;
  perform set_config('app.system', 'on', true);
  update tasks set status = v_done, done_at = at_, updated_at = at_ where id = p.id;
  insert into activity (id, unit_id, task_id, action, field, from_val, to_val, actor_id, at)
  values ('a_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12), p.unit_id, p.id, 'update', 'status', to_jsonb(p.status)::text, to_jsonb(v_done)::text, '', at_);
  perform set_config('app.system', 'off', true);
  return new;
end $$;
drop trigger if exists close_split_parent on tasks;
create trigger close_split_parent after update on tasks for each row execute function close_split_parent();

-- Сроки своих задач: просрочено (kind 'overdue') и срок сегодня/завтра ('due_soon'). Зовёт приложение вошедшего
-- (пульс и загрузка уведомлений) с его сегодняшней датой — без крона. На каждый срок — одно уведомление.
create or replace function scan_due(p_today text) returns void language plpgsql security definer set search_path = public as $$
declare
  v_me text := my_person_id();
  v_at text := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_tomorrow text;
begin
  perform set_config('app.system', 'on', true);  -- напоминания пишет база (и в режиме «Смотреть как»)
  if v_me is null or p_today !~ '^\d{4}-\d{2}-\d{2}$' then return; end if;
  v_tomorrow := to_char(p_today::date + 1, 'YYYY-MM-DD');
  with due as (
    select t.id, t.due_date, case when t.due_date < p_today then 'overdue' else 'due_soon' end as kind
      from tasks t join units u on u.id = t.unit_id
     where t.assignee_id = v_me and not t.archived and not u.archived and t.due_date <> '' and t.due_date <= v_tomorrow
       and (not t.is_test or is_dev())
       and not exists (select 1 from jsonb_array_elements(u.settings -> 'columns') c
                        where c ->> 'id' = t.status and c ->> 'kind' = 'done')
  ), fresh as (
    select d.* from due d
     where not exists (select 1 from notifications n
                        where n.person_id = v_me and n.task_id = d.id and n.kind = d.kind and n.ref = d.due_date)
  ), cleared as (
    -- просрочка заменяет непрочитанное «срок скоро» по той же задаче
    delete from notifications n using fresh f
     where f.kind = 'overdue' and n.person_id = v_me and n.task_id = f.id and n.kind = 'due_soon' and n.read_at = ''
  )
  insert into notifications (id, person_id, task_id, kind, actor_id, at, ref)
  select 'n_' || substr(md5(random()::text || clock_timestamp()::text || f.id), 1, 12), v_me, f.id, f.kind, '', v_at, f.due_date
    from fresh f;
end $$;

-- Отметка «был в приложении» — только себе.
create or replace function touch_presence() returns void language sql security definer set search_path = public as $$
  update people set last_seen_at = to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
   where user_id = auth.uid() and active;
$$;

-- Автор комментария и записи в истории — всегда вошедший пользователь, а не то, что прислал браузер.
create or replace function guard_author() returns trigger language plpgsql set search_path = public as $$
begin
  if app_system() then return new; end if;
  if tg_table_name = 'comments' then
    if tg_op = 'INSERT' then new.author_id := coalesce(my_person_id(), '');
    elsif new.author_id is distinct from old.author_id or new.task_id is distinct from old.task_id then
      raise exception 'Нельзя менять автора комментария' using errcode = '42501';
    end if;
  else
    new.actor_id := coalesce(my_person_id(), '');
  end if;
  return new;
end $$;
drop trigger if exists guard_author on comments;
create trigger guard_author before insert or update on comments for each row execute function guard_author();
drop trigger if exists guard_author on activity;
create trigger guard_author before insert on activity for each row execute function guard_author();

create or replace function guard_people() returns trigger language plpgsql set search_path = public as $$
begin
  -- позиция обязательна; дополнительные — без основной и без повторов
  if coalesce(new.position_id, '') = '' then new.position_id := 'd_other'; end if;
  new.extra_positions := coalesce((select jsonb_agg(distinct x) from jsonb_array_elements_text(new.extra_positions) x
                                    where x <> new.position_id and x <> ''), '[]'::jsonb);
  new.team_ids := coalesce((select jsonb_agg(distinct x) from jsonb_array_elements_text(new.team_ids) x where x <> ''), '[]'::jsonb);
  if app_system() then return new; end if;
  if tg_op = 'INSERT' then
    if new.access <> 'member' and not is_superadmin() then
      raise exception 'Роли PM, RM, Lead и CEO назначает только CEO' using errcode = '42501';
    end if;
    new.user_id := null;  -- привязку к аккаунту делает только система
    new.is_dev := false;  -- режим разработчика включает только система
    return new;
  end if;
  if new.is_dev is distinct from old.is_dev then
    raise exception 'Режим разработчика включает только система' using errcode = '42501';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'Привязку к аккаунту меняет только система' using errcode = '42501';
  end if;
  if new.access is distinct from old.access and not is_superadmin() then
    raise exception 'Роли меняет только CEO' using errcode = '42501';
  end if;
  if not is_superadmin() and (new.email is distinct from old.email or new.position_id is distinct from old.position_id
                         or new.extra_positions is distinct from old.extra_positions or new.team_ids is distinct from old.team_ids
                         or new.active is distinct from old.active) then
    raise exception 'Email, позицию и доступ меняет администратор' using errcode = '42501';
  end if;
  if old.access = 'superadmin' and not is_superadmin() then
    raise exception 'Профиль CEO меняет только CEO' using errcode = '42501';
  end if;
  if old.access = 'superadmin' and old.active and (new.access <> 'superadmin' or not new.active)
     and not exists (select 1 from people where access = 'superadmin' and active and id <> old.id) then
    raise exception 'Нельзя убрать последнего CEO' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists guard_people on people;
create trigger guard_people before insert or update on people for each row execute function guard_people();

-- ---------- удаления (только администраторы) ----------

-- Удалить юнит: задачи, поля, комментарии и состав уходят каскадом, историю чистим отдельно.
create or replace function delete_unit(p_unit text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app_system() and not can_manage(p_unit) then raise exception 'Недостаточно прав' using errcode = '42501'; end if;
  delete from activity
   where task_id in (select id from tasks where unit_id = p_unit)
      or (unit_id = p_unit and task_id not in (select id from tasks));
  delete from units where id = p_unit;
end $$;

-- Автоудаление юнитов из корзины: срок в днях — app_settings.unitRetentionDays (0 или нет — не удалять).
-- Вызывается приложением при открытии главной/панели админа. Возвращает число удалённых юнитов.
create or replace function purge_archived_units() returns integer
language plpgsql security definer set search_path = public as $$
declare
  days integer;
  cutoff text;
  n integer := 0;
  u record;
begin
  if not app_system() and not is_superadmin() then return 0; end if;
  select coalesce((value #>> '{}')::integer, 0) into days from app_settings where key = 'unitRetentionDays';
  if coalesce(days, 0) <= 0 then return 0; end if;
  cutoff := to_char((now() - make_interval(days => days)) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  for u in select id from units where archived and archived_at <> '' and archived_at < cutoff loop
    delete from activity
     where task_id in (select id from tasks where unit_id = u.id)
        or (unit_id = u.id and task_id not in (select id from tasks));
    delete from units where id = u.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Удалить человека из системы (только супер-админ): его задачи остаются без исполнителя, состав и уведомления — каскадом.
-- История и комментарии сохраняются (автор показывается как удалённый сотрудник).
create or replace function delete_person(p_person text) returns void
language plpgsql security definer set search_path = public as $$
declare v people;
begin
  if not app_system() and not is_superadmin() then raise exception 'Удалять людей может только CEO' using errcode = '42501'; end if;
  select * into v from people where id = p_person;
  if v.id is null then raise exception 'Человек не найден' using errcode = 'P0001'; end if;
  if v.id = my_person_id() then raise exception 'Нельзя удалить самого себя' using errcode = 'P0001'; end if;
  if v.access = 'superadmin' and v.active
     and not exists (select 1 from people where access = 'superadmin' and active and id <> v.id) then
    raise exception 'Нельзя удалить последнего CEO' using errcode = 'P0001';
  end if;
  perform set_config('app.system', 'on', true);
  update tasks set assignee_id = '' where assignee_id = v.id;
  delete from people where id = v.id;
  perform set_config('app.system', 'off', true);
end $$;

-- Удалить поле навсегда вместе с его значениями в задачах.
create or replace function delete_field(p_field text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app_system() and not is_staff() then raise exception 'Недостаточно прав' using errcode = '42501'; end if;
  perform set_config('app.system', 'on', true);
  update tasks set fields = fields - p_field where fields ? p_field;
  delete from fields where id = p_field;
  perform set_config('app.system', 'off', true);
end $$;

-- Удалить позицию (отдел): задачи и люди остаются, но без позиции.
create or replace function delete_department(p_dept text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app_system() and not is_superadmin() then raise exception 'Недостаточно прав' using errcode = '42501'; end if;
  perform set_config('app.system', 'on', true);
  update tasks set department_id = '' where department_id = p_dept;
  update unit_members set department_id = '' where department_id = p_dept;
  if p_dept = 'd_other' then raise exception 'Позицию Other удалить нельзя: она нужна людям без другой позиции' using errcode = 'P0001'; end if;
  update people set position_id = 'd_other' where position_id = p_dept;
  update people set extra_positions = extra_positions - p_dept where extra_positions ? p_dept;
  delete from departments where id = p_dept;
  perform set_config('app.system', 'off', true);
end $$;

alter function next_task_num(text) set search_path = public;
alter function comment_counts(text) set search_path = public;

-- Личная доска: у команды — стартовый шаблон этапов (колонки с типом todo / progress / done),
-- человек получает его на свою доску и дальше меняет под себя (people.prefs.myBoard).
alter table teams add column if not exists board_template jsonb not null default '[]';
update teams set board_template = '[{"id": "s1", "name": "Идеи", "kind": "todo", "color": ""}, {"id": "s2", "name": "Проработка", "kind": "progress", "color": ""}, {"id": "s3", "name": "ТЗ", "kind": "progress", "color": ""}, {"id": "s4", "name": "На контроле", "kind": "progress", "color": ""}, {"id": "s5", "name": "Готово", "kind": "done", "color": ""}]'::jsonb where id = 't_product' and board_template = '[]'::jsonb;
update teams set board_template = '[{"id": "s1", "name": "To do", "kind": "todo", "color": ""}, {"id": "s2", "name": "Design in Progress", "kind": "progress", "color": ""}, {"id": "s3", "name": "Review", "kind": "progress", "color": ""}, {"id": "s4", "name": "Text", "kind": "progress", "color": ""}, {"id": "s5", "name": "Google Drive", "kind": "progress", "color": ""}, {"id": "s6", "name": "Done", "kind": "done", "color": ""}]'::jsonb where id = 't_design' and board_template = '[]'::jsonb;
update teams set board_template = '[{"id": "s1", "name": "Бэклог", "kind": "todo", "color": ""}, {"id": "s2", "name": "В разработке", "kind": "progress", "color": ""}, {"id": "s3", "name": "Код-ревью", "kind": "progress", "color": ""}, {"id": "s4", "name": "На тесте", "kind": "progress", "color": ""}, {"id": "s5", "name": "Готово", "kind": "done", "color": ""}]'::jsonb where id = 't_ios' and board_template = '[]'::jsonb;
update teams set board_template = '[{"id": "s1", "name": "Очередь", "kind": "todo", "color": ""}, {"id": "s2", "name": "Тест-план", "kind": "progress", "color": ""}, {"id": "s3", "name": "Тестирую", "kind": "progress", "color": ""}, {"id": "s4", "name": "Баги", "kind": "progress", "color": ""}, {"id": "s5", "name": "Проверено", "kind": "done", "color": ""}]'::jsonb where id = 't_qa' and board_template = '[]'::jsonb;
update teams set board_template = '[{"id": "s1", "name": "To Do", "kind": "todo", "color": ""}, {"id": "s2", "name": "Default info", "kind": "progress", "color": ""}, {"id": "s3", "name": "Send to Apple", "kind": "progress", "color": ""}, {"id": "s4", "name": "Rejected", "kind": "progress", "color": ""}, {"id": "s5", "name": "App Store", "kind": "done", "color": ""}]'::jsonb where id = 't_release' and board_template = '[]'::jsonb;
update teams set board_template = '[{"id": "s1", "name": "Нужно сделать", "kind": "todo", "color": ""}, {"id": "s2", "name": "В работе", "kind": "progress", "color": ""}, {"id": "s3", "name": "Готово", "kind": "done", "color": ""}]'::jsonb where id = 't_aso' and board_template = '[]'::jsonb;
update teams set board_template = '[{"id": "s1", "name": "Нужно сделать", "kind": "todo", "color": ""}, {"id": "s2", "name": "В работе", "kind": "progress", "color": ""}, {"id": "s3", "name": "Готово", "kind": "done", "color": ""}]'::jsonb where id = 't_other' and board_template = '[]'::jsonb;

-- Где лежит задача на личной доске человека (этап и порядок). Видно и меняется только им самим.
create table if not exists my_board (
  person_id text not null references people(id) on delete cascade,
  task_id   text not null references tasks(id) on delete cascade,
  stage     text not null default '',
  ord       double precision not null default 0,
  primary key (person_id, task_id)
);

-- Приложение: переносит между юнитами только CEO; тестовые — только режим разработчика.
create or replace function guard_apps() returns trigger language plpgsql set search_path = public as $$
begin
  if app_system() then return new; end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(my_person_id(), '');
    if new.is_test and not is_dev() then raise exception 'Тестовые данные создаёт только режим разработчика' using errcode = '42501'; end if;
    return new;
  end if;
  if new.unit_id is distinct from old.unit_id and not is_superadmin() then
    raise exception 'Переносить приложение между юнитами может только CEO' using errcode = '42501';
  end if;
  if new.is_test is distinct from old.is_test and not is_dev() then
    raise exception 'Тестовые данные меняет только режим разработчика' using errcode = '42501';
  end if;
  if (new.shelf is distinct from old.shelf or new.archived is distinct from old.archived) and not is_superadmin() then
    raise exception 'Убирать приложение в Design Spam или удалённые может только CEO' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists guard_apps on apps;
create trigger guard_apps before insert or update on apps for each row execute function guard_apps();

-- Удалить всё, что создали шорткаты разработчика (задачи и приложения с is_test). Возвращает число задач.
-- Удалить все тестовые данные: задачи и приложения шорткатов, демо-юниты (is_test или старый DEMO) целиком,
-- демо-людей (is_test или старое «Демо · …») — только без входа в систему и не разработчиков. Реальные люди не трогаются.
drop function if exists delete_test_data();
create or replace function delete_test_data() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  n_tasks integer; n_apps integer; n_units integer; n_people integer;
  v_units text[];
  v_prev text := coalesce(current_setting('app.system', true), '');
begin
  if not app_system() and not is_dev() then raise exception 'Только для режима разработчика' using errcode = '42501'; end if;
  perform set_config('app.system', 'on', true);
  -- без временных таблиц и DELETE без WHERE: в Supabase это запрещено (safeupdate)
  v_units := array(select id from units where is_test or key = 'DEMO');
  delete from activity where task_id in (select id from tasks where is_test or unit_id = any(v_units));
  delete from activity where unit_id = any(v_units);
  delete from tasks where is_test or unit_id = any(v_units);
  get diagnostics n_tasks = row_count;
  delete from apps where is_test or unit_id = any(v_units);
  get diagnostics n_apps = row_count;
  delete from units where id = any(v_units);
  get diagnostics n_units = row_count;
  update tasks set assignee_id = '' where assignee_id in
    (select id from people where (is_test or name like 'Демо · %') and user_id is null and not is_dev);
  delete from people where (is_test or name like 'Демо · %') and user_id is null and not is_dev;
  get diagnostics n_people = row_count;
  perform set_config('app.system', v_prev, true);
  return jsonb_build_object('tasks', n_tasks, 'apps', n_apps, 'units', n_units, 'people', n_people);
end $$;

-- Шаги релиза (этап «Релиз», кнопки RM): submit — отправил в Apple (нужны обязательные релизные поля и закрытый чеклист;
-- приложение → «Ревью Apple»); live — вышло в стор (этап и запрос CEO — «готово», приложение → «В сторе»);
-- reject — реджект (приложение → «Реджект», PM юнита получает запрос «Реджект: причина», релиз ждёт у RM);
-- resubmit — отправил снова после исправления. Делает: исполнитель этапа (RM), CEO и PM юнита.
-- Итог Apple по релизу (kind store_live / store_reject) — уведомление PM и лидам юнита и всем CEO (кроме того, кто нажал).
create or replace function notify_release(p_task text, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare
  t tasks;
  v_me text := coalesce(my_person_id(), '');
  at_ text := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select * into t from tasks where id = p_task;
  if t.id is null then return; end if;
  -- вышло в стор: непрочитанный реджект по этому релизу устарел и не должен перекрывать «вышло»
  if p_kind = 'store_live' then
    delete from notifications n where n.kind = 'store_reject' and n.read_at = ''
       and (n.task_id = t.id or (t.parent_id <> '' and n.task_id in (select id from tasks where parent_id = t.parent_id)));
  end if;
  -- CEO и PM юнита — на сам релиз
  insert into notifications (id, person_id, task_id, kind, actor_id, at)
  select 'n_' || substr(md5(random()::text || clock_timestamp()::text || p.id), 1, 12), p.id, t.id, p_kind, v_me, at_
    from people p
   where p.active and p.id <> v_me and notify_test_ok(t.is_test, p.id)
     and (p.access = 'superadmin'
          or (p.access = 'moderator' and exists (select 1 from unit_members m where m.unit_id = t.unit_id and m.person_id = p.id)));
  -- «вышло в стор» — только CEO и PM (решение заказчика); о реджекте — ещё лидам, на этап их позиции (релиз им не виден)
  if p_kind = 'store_live' then return; end if;
  insert into notifications (id, person_id, task_id, kind, actor_id, at)
  select distinct on (p.id) 'n_' || substr(md5(random()::text || clock_timestamp()::text || p.id), 1, 12), p.id, s.id, p_kind, v_me, at_
    from people p
    join unit_members m on m.unit_id = t.unit_id and m.person_id = p.id
    join tasks s on s.parent_id = t.parent_id and t.parent_id <> '' and s.id <> t.id
                and (s.department_id = p.position_id or p.extra_positions ? s.department_id)
   where p.active and p.id <> v_me and p.access = 'lead' and notify_test_ok(t.is_test, p.id)
   order by p.id, s.created_at;
end $$;

-- Отметки «@» в комментарии или описании: уведомление отмеченным (люди юнита, CEO и RM), кроме себя.
-- p_people — id людей, p_where — 'comment' или 'description'.
create or replace function notify_mention(p_task text, p_people jsonb, p_where text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  t tasks;
  v_me text := coalesce(my_person_id(), '');
  at_ text := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  n int;
begin
  select * into t from tasks where id = p_task;
  if t.id is null then raise exception 'Задача не найдена' using errcode = 'P0001'; end if;
  if not (can_manage(t.unit_id) or is_unit_member(t.unit_id)) then
    raise exception 'Недостаточно прав для этого действия' using errcode = '42501';
  end if;
  delete from notifications where task_id = t.id and kind = 'mention' and read_at = ''
     and person_id in (select jsonb_array_elements_text(coalesce(p_people, '[]'::jsonb)));
  insert into notifications (id, person_id, task_id, kind, actor_id, at, ref)
  select 'n_' || substr(md5(random()::text || clock_timestamp()::text || p.id), 1, 12), p.id, t.id, 'mention', v_me, at_, left(coalesce(p_where, ''), 20)
    from people p
   where p.id in (select jsonb_array_elements_text(coalesce(p_people, '[]'::jsonb))) and p.active and p.id <> v_me
     and (p.access in ('superadmin', 'rm') or exists (select 1 from unit_members m where m.unit_id = t.unit_id and m.person_id = p.id));
  get diagnostics n = row_count;
  return n;
end $$;

-- Личные настройки: слить ключи одной командой (без «прочитать — записать», иначе две записи подряд затирают друг друга).
-- Права — обычные правила people (своя строка или администратор).
create or replace function merge_prefs(p_person text, p_prefs jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare r jsonb;
begin
  update people set prefs = coalesce(prefs, '{}'::jsonb) || coalesce(p_prefs, '{}'::jsonb) where id = p_person returning prefs into r;
  if r is null and exists (select 1 from people where id = p_person) then
    raise exception 'Недостаточно прав для этого действия' using errcode = '42501';
  end if;
  if r is null then raise exception 'Человек не найден' using errcode = 'P0001'; end if;
  if length(r::text) > 20000 then raise exception 'Слишком большие настройки' using errcode = 'P0001'; end if;
  return r;
end $$;

-- Итог проверки App Store: p_items [{ id, ok, storeName, iconUrl }]. Только эти поля, «Обновлено» не трогает.
-- Обновляют все, кто видит «Приложения» (CEO, PM юнита, RM и лиды юнита) — RM приложения сам не правит, а проверка — не правка.
create or replace function save_store_check(p_items jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  at_ text := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  x jsonb;
  ok boolean;
  n int := 0;
  k int;
begin
  for x in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) limit 2000 loop
    ok := coalesce((x->>'ok')::boolean, false);
    update apps a set store_ok = ok, store_checked_at = at_,
           store_name = case when ok and coalesce(x->>'storeName', '') <> '' then left(x->>'storeName', 200) else a.store_name end,
           icon_url = case when ok and coalesce(x->>'iconUrl', '') ~ '^https://[A-Za-z0-9.-]+\.mzstatic\.com/' then left(x->>'iconUrl', 500) else a.icon_url end
     where a.id = coalesce(x->>'id', '') and (not a.is_test or is_dev())
       and (can_manage(a.unit_id) or (my_access() in ('rm', 'lead') and is_unit_member(a.unit_id)));
    get diagnostics k = row_count;
    n := n + k;
  end loop;
  return n;
end $$;

-- Шаги релиза (RM). Фаза: '' — очередь, submitted — на ревью Apple, rejected — реджект (исправляет PM), live — в сторе.
-- Статус этапа «Релиз» на доске следует за фазой (очередь — в работе, ревью Apple — колонка ревью, в сторе — готово).
-- rel.history — попытки: [{ n, submittedAt, result: live | reject, at, reason, shot, rejectNo }]; номер реджекта — по приложению.
drop function if exists release_step(text, text, text);
drop function if exists release_step(text, text, text, text);
-- p_self (реджект): RM закрывает его сам — реджект записан (№, история, уведомление CEO и PM), но задачи PM нет, релиз снова в очереди.
create or replace function release_step(p_task text, p_action text, p_reason text default '', p_shot text default '', p_self boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare
  t tasks;
  u units;
  a apps;
  rel jsonb;
  hist jsonb;
  last jsonb;
  missing text;
  st jsonb;
  v_status text;
  col text;
  pm text;
  v_id text;
  v_no int;
  v_actor text := coalesce(my_person_id(), '');
  at_ text := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select * into t from tasks where id = p_task;
  if t.id is null or t.step <> 'release' then raise exception 'Это не этап «Релиз»' using errcode = 'P0001'; end if;
  if not app_system() and t.assignee_id is distinct from v_actor and not can_manage(t.unit_id) then
    raise exception 'Недостаточно прав: релиз ведёт его RM' using errcode = '42501';
  end if;
  if t.assignee_id = '' then raise exception 'Релиз ещё не передан RM' using errcode = 'P0001'; end if;
  select * into u from units where id = t.unit_id;
  select * into a from apps where id = t.app_id;
  rel := coalesce(t.release, '{}'::jsonb);
  hist := coalesce(rel -> 'history', '[]'::jsonb);
  select value into st from app_settings where key = 'appStatuses';
  perform set_config('app.system', 'on', true);
  if p_action in ('submit', 'resubmit') then
    if coalesce(rel ->> 'phase', '') not in ('', 'rejected') then raise exception 'Релиз уже отправлен' using errcode = 'P0001'; end if;
    select string_agg(f ->> 'name', ', ') into missing from app_settings s, jsonb_array_elements(s.value) f
     where s.key = 'releaseFields' and coalesce((f ->> 'required')::boolean, false)
       and coalesce(rel -> 'values' ->> (f ->> 'id'), '') = '';
    if missing is not null then raise exception 'Заполните релизные поля: %', missing using errcode = 'P0001'; end if;
    if exists (select 1 from jsonb_array_elements(t.checklist) i where not coalesce((i ->> 'done')::boolean, false)) then
      raise exception 'Сначала закройте чеклист релиза' using errcode = 'P0001';
    end if;
    hist := hist || jsonb_build_array(jsonb_build_object('n', jsonb_array_length(hist) + 1, 'submittedAt', at_));
    rel := (rel || jsonb_build_object('phase', 'submitted', 'submittedAt', at_, 'reason', '', 'history', hist)) - 'fixedAt';
    -- на доске — колонка ревью юнита (или «в работе»)
    col := coalesce(nullif(u.settings -> 'review' ->> 'column', ''),
                    (select c ->> 'id' from jsonb_array_elements(u.settings -> 'columns') c where c ->> 'kind' = 'progress' limit 1));
    update tasks set release = rel, updated_at = at_, status = coalesce(col, status), done_at = '',
      started_at = case when started_at = '' then at_ else started_at end
     where id = t.id;
    -- отправили снова, не дожидаясь PM: его задача «Реджект №N» больше не нужна — закрываем (после смены фазы, иначе release_fixed сработает ещё раз)
    if coalesce(t.release ->> 'phase', '') = 'rejected' and coalesce(t.release ->> 'rejectRequestId', '') <> '' then
      select c ->> 'id' into col from jsonb_array_elements(u.settings -> 'columns') c where c ->> 'kind' = 'done' limit 1;
      update tasks set status = coalesce(col, status), done_at = at_, updated_at = at_
       where id = t.release ->> 'rejectRequestId' and done_at = '';
    end if;
    select x ->> 'id' into v_status from jsonb_array_elements(st) x where x ->> 'kind' = 'review' limit 1;
  elsif p_action = 'reject' then
    if coalesce(rel ->> 'phase', '') <> 'submitted' then raise exception 'Реджект — после отправки в Apple' using errcode = 'P0001'; end if;
    if coalesce(trim(p_reason), '') = '' then raise exception 'Опишите реджект' using errcode = 'P0001'; end if;
    -- номер реджекта — по приложению (все релизы)
    select count(*) + 1 into v_no from tasks r, jsonb_array_elements(coalesce(r.release -> 'history', '[]'::jsonb)) h
     where r.app_id = t.app_id and r.step = 'release' and h ->> 'result' = 'reject';
    pm := unit_pm(t.unit_id);
    v_id := 't_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
    insert into tasks (id, unit_id, num, title, description, status, assignee_id, department_id, due_date, ord, fields, checklist,
                       archived, done_at, created_by, created_at, updated_at, parent_id, kind, request_type, app_id, is_test, spec_url)
    values (v_id, t.unit_id, next_task_num(t.unit_id), left('Реджект №' || v_no || ': ' || trim(p_reason), 500),
            'Apple отклонил релиз «' || coalesce(a.name, '') || '» (реджект №' || v_no || ').' || chr(10) || trim(p_reason)
              || case when coalesce(trim(p_shot), '') <> '' then chr(10) || 'Скрин: ' || trim(p_shot) else '' end,
            u.settings -> 'columns' -> 0 ->> 'id', case when p_self then v_actor else coalesce(pm, '') end, '', '', 0,
            case when coalesce(a.priority, '') <> '' then jsonb_build_object('f_priority', a.priority) else '{}'::jsonb end, '[]'::jsonb,
            false, '', v_actor, at_, at_, '', 'request', 'other', t.app_id, t.is_test, coalesce(trim(p_shot), ''));
    last := coalesce(hist -> -1, '{}'::jsonb) || jsonb_build_object('result', 'reject', 'at', at_, 'reason', trim(p_reason), 'shot', coalesce(trim(p_shot), ''), 'rejectNo', v_no, 'requestId', v_id, 'self', p_self);
    hist := case when jsonb_array_length(hist) > 0 then jsonb_set(hist, array[(jsonb_array_length(hist) - 1)::text], last) else jsonb_build_array(last) end;
    rel := rel || jsonb_build_object('phase', 'rejected', 'rejectedAt', at_, 'reason', trim(p_reason), 'shot', coalesce(trim(p_shot), ''),
                                     'rejectNo', v_no, 'rejectRequestId', v_id, 'pmId', coalesce(pm, ''), 'history', hist);
    select c ->> 'id' into col from jsonb_array_elements(u.settings -> 'columns') c where c ->> 'kind' = 'progress' limit 1;
    update tasks set release = rel, updated_at = at_, status = coalesce(col, status), done_at = '' where id = t.id;
    select x ->> 'id' into v_status from jsonb_array_elements(st) x where x ->> 'kind' = 'reject' limit 1;
    if p_self then
      -- как close_reject: сначала фаза (иначе сработает release_fixed), потом задача реджекта — готово
      select c ->> 'id' into col from jsonb_array_elements(u.settings -> 'columns') c where c ->> 'kind' = 'done' limit 1;
      rel := rel || jsonb_build_object('phase', '', 'fixedAt', at_, 'closedBy', v_actor, 'selfClosed', true);
      update tasks set release = rel, updated_at = at_ where id = t.id;
      update tasks set status = coalesce(col, status), done_at = at_, updated_at = at_ where id = v_id;
    end if;
  elsif p_action = 'live' then
    if coalesce(rel ->> 'phase', '') <> 'submitted' then raise exception 'В стор — после отправки в Apple' using errcode = 'P0001'; end if;
    last := coalesce(hist -> -1, '{}'::jsonb) || jsonb_build_object('result', 'live', 'at', at_);
    hist := case when jsonb_array_length(hist) > 0 then jsonb_set(hist, array[(jsonb_array_length(hist) - 1)::text], last) else jsonb_build_array(last) end;
    rel := rel || jsonb_build_object('phase', 'live', 'liveAt', at_, 'history', hist);
    select c ->> 'id' into col from jsonb_array_elements(u.settings -> 'columns') c where c ->> 'kind' = 'done' limit 1;
    update tasks set release = rel, updated_at = at_, status = coalesce(col, status), done_at = at_ where id = t.id;
    if t.parent_id <> '' then
      update tasks set status = coalesce(col, status), done_at = at_, updated_at = at_ where id = t.parent_id;
    end if;
    select x ->> 'id' into v_status from jsonb_array_elements(st) x where x ->> 'kind' = 'live' limit 1;
  elsif p_action = 'close_reject' then
    -- RM закрывает реджект сам: задача «Реджект №N» — готово, релиз в очереди. Сначала фаза, иначе release_fixed сработает ещё раз.
    if coalesce(rel ->> 'phase', '') <> 'rejected' then raise exception 'Закрыть можно только реджект' using errcode = 'P0001'; end if;
    select c ->> 'id' into col from jsonb_array_elements(u.settings -> 'columns') c where c ->> 'kind' = 'done' limit 1;
    v_id := rel ->> 'rejectRequestId';
    rel := rel || jsonb_build_object('phase', '', 'fixedAt', at_, 'closedBy', v_actor);
    update tasks set release = rel, updated_at = at_ where id = t.id;
    update tasks set status = coalesce(col, status), done_at = at_, updated_at = at_ where id = v_id and done_at = '';
  else
    raise exception 'Неизвестный шаг релиза' using errcode = 'P0001';
  end if;
  if a.id is not null and v_status is not null then
    update apps set status = v_status, status_at = at_, updated_at = at_ where id = a.id;
  end if;
  insert into activity (id, unit_id, task_id, action, field, from_val, to_val, actor_id, at)
  values ('a_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12), t.unit_id, t.id, 'update', 'release',
          to_jsonb(coalesce(t.release ->> 'phase', ''))::text, to_jsonb(rel ->> 'phase')::text, v_actor, at_);
  perform set_config('app.system', 'off', true);
  -- вышло в стор или реджект — сообщить PM и лидам юнита и CEO
  if p_action in ('live', 'reject') then perform notify_release(t.id, case when p_action = 'live' then 'store_live' else 'store_reject' end); end if;
  return coalesce(v_id, t.id);
end $$;

-- Приложение на ревью Apple без релиза в трекере (добавлено сразу со статусом «Ревью Apple»): RM отмечает итог —
-- «Вышло в стор» или «Реджект» (статус приложения по типу live / reject). Могут RM, CEO и PM юнита.
create or replace function rm_app_status(p_app text, p_result text) returns text
language plpgsql security definer set search_path = public as $$
declare
  a apps;
  st jsonb;
  cur text;
  v_status text;
  at_ text := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select * into a from apps where id = p_app;
  if a.id is null then raise exception 'Приложение не найдено' using errcode = 'P0001'; end if;
  if not (can_manage(a.unit_id) or my_access() = 'rm') then raise exception 'Недостаточно прав для этого действия' using errcode = '42501'; end if;
  if p_result not in ('live', 'reject') then raise exception 'Неизвестный шаг' using errcode = 'P0001'; end if;
  select value into st from app_settings where key = 'appStatuses';
  select x ->> 'kind' into cur from jsonb_array_elements(coalesce(st, '[]'::jsonb)) x where x ->> 'id' = a.status limit 1;
  if coalesce(cur, '') <> 'review' then raise exception 'Приложение уже не на ревью Apple' using errcode = 'P0001'; end if;
  select x ->> 'id' into v_status from jsonb_array_elements(st) x where x ->> 'kind' = p_result limit 1;
  if v_status is null then raise exception 'В статусах приложения нет статуса для этого шага' using errcode = 'P0001'; end if;
  update apps set status = v_status, status_at = at_, updated_at = at_ where id = a.id;
  return v_status;
end $$;

-- Реджект исправили (задача «Реджект №N» у PM закрыта) — релиз возвращается RM в очередь на отправку (fixedAt).
create or replace function release_fixed() returns trigger language plpgsql security definer set search_path = public as $$
declare
  r tasks;
  at_ text := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if new.kind <> 'request' or new.status is not distinct from old.status or not task_done(new.id) then return new; end if;
  select * into r from tasks where step = 'release' and release ->> 'rejectRequestId' = new.id and release ->> 'phase' = 'rejected' limit 1;
  if r.id is null then return new; end if;
  perform set_config('app.system', 'on', true);
  update tasks set release = release || jsonb_build_object('phase', '', 'fixedAt', at_), updated_at = at_ where id = r.id;
  if r.assignee_id <> '' then
    insert into notifications (id, person_id, task_id, kind, actor_id, at)
    values ('n_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12), r.assignee_id, r.id, 'unblocked', coalesce(my_person_id(), ''), at_);
  end if;
  perform set_config('app.system', 'off', true);
  return new;
end $$;
drop trigger if exists release_fixed on tasks;
create trigger release_fixed after update on tasks for each row execute function release_fixed();

-- Ссылки этапов запроса для карточки релиза: RM видит только свой этап, а ему нужны макеты, сборка, метаданные.
-- Опросник разработчика для карточки релиза: RM не видит этап iOS, ответы отдаёт база (последний заполненный этап запроса).
create or replace function release_dev_form(p_task text) returns jsonb
language sql stable security definer set search_path = public as $$
  select s.dev_form
    from tasks r join tasks s on s.parent_id = r.parent_id and s.step in ('ios', 'integr') and r.parent_id <> '' and not s.archived
   where r.id = p_task and r.step = 'release'
     and (r.assignee_id = my_person_id() or can_manage(r.unit_id))
   order by case when s.step = 'integr' and s.dev_form ->> 'need' = 'true' then 0
                 when s.step = 'ios' and coalesce(s.dev_form ->> 'need', '') <> 'false' then 1 else 2 end,
            s.dev_form ->> 'at' desc nulls last limit 1;
$$;

create or replace function release_links(p_task text) returns table (task_id text, step text, title text, field_id text, url text)
language sql stable security definer set search_path = public as $$
  select s.id, s.step, s.title, l.field_id, l.url
    from tasks r join tasks s on s.parent_id = r.parent_id and s.id <> r.id and r.parent_id <> ''
    join task_links l on l.task_id = s.id
   where r.id = p_task and r.step = 'release'
     and (r.assignee_id = my_person_id() or can_manage(r.unit_id))
   order by s.created_at, l.field_id;
$$;

-- Команда релиза для RM (решение заказчика): PM запроса и исполнители этапов дизайна, разработки и тестирования
-- (если этап роздан на подзадачи — их исполнители). RM этих задач не видит — функция с правами владельца.
create or replace function release_team(p_task text) returns table (step text, person_id text)
language sql stable security definer set search_path = public as $$
  with r as (select * from tasks where id = p_task and step = 'release' and (assignee_id = my_person_id() or can_manage(unit_id)))
  select 'pm', q.assignee_id from r join tasks q on q.id = r.parent_id where q.assignee_id <> ''
  union all
  select s.step, coalesce(nullif(p.review_from, ''), p.assignee_id)
    from r join tasks s on s.parent_id = r.parent_id and s.step in ('design', 'art', 'ios', 'qa', 'integr', 'meta', 'store', 'retext', 'l10n') and r.parent_id <> ''
    join tasks p on p.parent_id = s.id and p.step = 'part' and not p.archived
  union all
  select s.step, coalesce(nullif(s.review_from, ''), s.assignee_id)
    from r join tasks s on s.parent_id = r.parent_id and s.step in ('design', 'art', 'ios', 'qa', 'integr', 'meta', 'store', 'retext', 'l10n') and r.parent_id <> ''
   where s.assignee_id <> '' and not exists (select 1 from tasks p where p.parent_id = s.id and p.step = 'part' and not p.archived);
$$;

-- ---------- правила доступа (RLS) ----------
-- Без входа — ничего. Регистрация закрыта в Supabase Auth; людей добавляет администратор.

do $$
declare t text;
begin
  foreach t in array array['teams', 'units', 'fields', 'people', 'departments', 'unit_members', 'tasks', 'comments', 'activity', 'link_fields', 'task_links', 'notifications', 'task_templates', 'my_board', 'apps'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists team_all on %I', t);
  end loop;
end $$;

alter table app_settings enable row level security;
drop policy if exists settings_read on app_settings;
create policy settings_read on app_settings for select to authenticated using (true);
drop policy if exists settings_write on app_settings;
create policy settings_write on app_settings for all to authenticated
  using (is_superadmin() or (my_access() = 'rm' and key in ('releaseFields', 'releaseChecklist', 'devQuestions')) or (my_access() = 'moderator' and key = 'devQuestions'))
  with check (is_superadmin() or (my_access() = 'rm' and key in ('releaseFields', 'releaseChecklist', 'devQuestions')) or (my_access() = 'moderator' and key = 'devQuestions'));

-- Юниты, поля, состав: видят администраторы и участники юнита; меняют администраторы.
drop policy if exists units_read on units;
create policy units_read on units for select to authenticated using (is_superadmin() or is_unit_member(id));
drop policy if exists units_write on units;
drop policy if exists units_insert on units;
create policy units_insert on units for insert to authenticated with check (is_superadmin());
drop policy if exists units_update on units;
create policy units_update on units for update to authenticated using (can_manage(id)) with check (can_manage(id));
drop policy if exists units_delete on units;
create policy units_delete on units for delete to authenticated using (can_manage(id));

drop policy if exists fields_read on fields;
create policy fields_read on fields for select to authenticated using (is_superadmin() or unit_id is null or is_unit_member(unit_id));
drop policy if exists fields_write on fields;
create policy fields_write on fields for all to authenticated
  using (case when unit_id is null then is_superadmin() else can_manage(unit_id) end)
  with check (case when unit_id is null then is_superadmin() else can_manage(unit_id) end);

drop policy if exists members_read on unit_members;
create policy members_read on unit_members for select to authenticated using (is_superadmin() or is_unit_member(unit_id));
drop policy if exists members_write on unit_members;
-- Состав юнита: CEO — любой; PM — своего юнита (добавляет и убирает сотрудников, лидов, RM), но не PM и не CEO.
create policy members_write on unit_members for all to authenticated
  using (is_superadmin() or (can_manage(unit_id) and not exists (select 1 from people p where p.id = unit_members.person_id and p.access in ('moderator', 'superadmin'))))
  with check (is_superadmin() or (can_manage(unit_id) and not exists (select 1 from people p where p.id = unit_members.person_id and p.access in ('moderator', 'superadmin'))));

-- Позиции и люди видны всем вошедшим (имена исполнителей, авторов); меняют администраторы, свой профиль — сам человек.
drop policy if exists departments_read on departments;
create policy departments_read on departments for select to authenticated using (true);
drop policy if exists departments_write on departments;
create policy departments_write on departments for all to authenticated using (is_superadmin()) with check (is_superadmin());

drop policy if exists people_read on people;
create policy people_read on people for select to authenticated using (true);
drop policy if exists people_insert on people;
create policy people_insert on people for insert to authenticated with check (is_superadmin());
drop policy if exists people_update on people;
create policy people_update on people for update to authenticated
  using (is_superadmin() or user_id = auth.uid()) with check (is_superadmin() or user_id = auth.uid());

-- Задачи: администраторы — все; участник — задачи своей позиции в своих юнитах и свои задачи.
drop policy if exists tasks_read on tasks;
-- Сотрудник — только свои задачи (исполнитель, ревью); Lead — задачи своей зоны (позиции + выданные люди); RM — задачи своей позиции и команд; PM — задачи своих юнитов (и только по своим приложениям); тестовые задачи видит только режим разработчика.
create policy tasks_read on tasks for select to authenticated using ((not is_test or is_dev())
  -- PM не видит задачи по приложениям вне своего списка 
  and (app_id = '' or my_access() <> 'moderator' or pm_sees_app(app_id)) and (
  can_manage(unit_id) or assignee_id = my_person_id() or review_from = my_person_id() or reviewer_id = my_person_id()
  or (my_access() = 'lead' and in_lead_zone(unit_id, department_id, assignee_id))
  or (my_access() = 'rm' and is_unit_member(unit_id) and ((department_id <> '' and department_id = any(my_positions()))
                                     or (team_id <> '' and team_id = any(my_teams()))))));
drop policy if exists tasks_insert on tasks;
create policy tasks_insert on tasks for insert to authenticated with check (can_manage(unit_id));
drop policy if exists tasks_delete on tasks;
-- запрос CEO и этапы приложения удаляет только CEO (PM убирает лишний этап через «Изменить этапы» — в архив)
create policy tasks_delete on tasks for delete to authenticated using (can_manage(unit_id) and (coalesce(kind, '') not in ('request', 'stage') or is_superadmin()));
drop policy if exists tasks_update on tasks;
-- После переноса в ревью/из ревью исполнитель меняется триггером — строка остаётся «своей» через review_from / reviewer_id
create policy tasks_update on tasks for update to authenticated
  using (can_manage(unit_id) or assignee_id = my_person_id() or in_lead_zone(unit_id, department_id, assignee_id))
  with check (can_manage(unit_id) or assignee_id = my_person_id() or review_from = my_person_id() or reviewer_id = my_person_id()
              or in_lead_zone(unit_id, department_id, assignee_id));

-- Поля-ссылки: названия видны всем (без значений), меняет набор только супер-админ.
drop policy if exists link_fields_read on link_fields;
create policy link_fields_read on link_fields for select to authenticated using (true);
drop policy if exists link_fields_write on link_fields;
create policy link_fields_write on link_fields for all to authenticated using (is_superadmin()) with check (is_superadmin());

-- Ссылки задачи: видны, если видна задача и поле разрешено позиции; менять — администраторы и исполнитель.
drop policy if exists task_links_read on task_links;
create policy task_links_read on task_links for select to authenticated
  using (can_see_link(field_id) and exists (select 1 from tasks t where t.id = task_id));
drop policy if exists task_links_write on task_links;
create policy task_links_write on task_links for all to authenticated
  using (can_see_link(field_id) and exists (select 1 from tasks t where t.id = task_id and (can_manage(t.unit_id) or t.assignee_id = my_person_id())))
  with check (can_see_link(field_id) and exists (select 1 from tasks t where t.id = task_id and t.unit_id = task_links.unit_id
    and (can_manage(t.unit_id) or t.assignee_id = my_person_id())));

-- Команды: видят все, ведут администраторы и модераторы (как позиции).
drop policy if exists teams_read on teams;
create policy teams_read on teams for select to authenticated using (true);
drop policy if exists teams_write on teams;
create policy teams_write on teams for all to authenticated using (is_superadmin()) with check (is_superadmin());

-- Удалить команду: у людей и задач она просто пропадает.
create or replace function delete_team(p_team text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app_system() and not is_staff() then raise exception 'Недостаточно прав' using errcode = '42501'; end if;
  perform set_config('app.system', 'on', true);
  update people set team_ids = team_ids - p_team where team_ids ? p_team;
  update tasks set team_id = '' where team_id = p_team;
  update task_templates set team_id = '' where team_id = p_team;
  delete from teams where id = p_team;
  perform set_config('app.system', 'off', true);
end $$;

-- Шаблоны: видят все вошедшие, ведут администраторы и модераторы.
drop policy if exists templates_read on task_templates;
create policy templates_read on task_templates for select to authenticated using (true);
drop policy if exists templates_write on task_templates;
create policy templates_write on task_templates for all to authenticated using (is_staff()) with check (is_staff());

-- Личная доска: только своя.
drop policy if exists my_board_own on my_board;
create policy my_board_own on my_board for all to authenticated
  using (person_id = my_person_id()) with check (person_id = my_person_id());

-- Уведомления: только свои; создаёт их триггер.
drop policy if exists notifications_own on notifications;
create policy notifications_own on notifications for select to authenticated using (person_id = my_person_id());
drop policy if exists notifications_read on notifications;
create policy notifications_read on notifications for update to authenticated
  using (person_id = my_person_id()) with check (person_id = my_person_id());

-- Приложения: CEO — все; остальные — приложения своих юнитов. Создаёт и удаляет CEO, правит — CEO и PM юнита.
alter table app_notes enable row level security;
drop policy if exists app_notes_read on app_notes;
-- заметки к приложению — рабочие, для CEO, PM и RM; Lead и сотрудник их не видят (как и раздел «Приложения»)
create policy app_notes_read on app_notes for select to authenticated using (app_system() or (my_access() in ('superadmin', 'moderator', 'rm') and exists (select 1 from apps a where a.id = app_id)));
drop policy if exists app_notes_insert on app_notes;
create policy app_notes_insert on app_notes for insert to authenticated
  with check (author_id = my_person_id() and my_access() <> 'member' and exists (select 1 from apps a where a.id = app_id));
drop policy if exists app_notes_delete on app_notes;
create policy app_notes_delete on app_notes for delete to authenticated using (author_id = my_person_id() or is_superadmin());
-- История статусов приложения (блок «Недавнее» на дашборде CEO): пишет только триггер — при любой смене статуса,
-- кнопкой, переносом в релиз или шагом RM; видит тот, кто видит приложение
create table if not exists app_status_log (
  id          text primary key default gen_random_uuid()::text,
  app_id      text not null references apps(id) on delete cascade,
  from_status text not null default '',
  to_status   text not null,
  by_id       text not null default '',
  at          text not null
);
create index if not exists app_status_log_app on app_status_log(app_id);
create index if not exists app_status_log_at on app_status_log(at);
create or replace function log_app_status() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    insert into app_status_log (app_id, from_status, to_status, by_id, at)
    values (new.id, coalesce(old.status, ''), new.status, coalesce(my_person_id(), ''), coalesce(nullif(new.status_at, ''), to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  end if;
  return new;
end $$;
drop trigger if exists log_app_status on apps;
create trigger log_app_status after update on apps for each row execute function log_app_status();
alter table app_status_log enable row level security;
drop policy if exists app_status_log_read on app_status_log;
create policy app_status_log_read on app_status_log for select to authenticated using (exists (select 1 from apps a where a.id = app_id));
-- запрос по приложению, поставленный на PM, открывает ему это приложение (иначе «Разложить» нечего раскладывать)
create or replace function grant_app_on_request() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'request' and new.app_id <> '' and new.assignee_id <> ''
     and exists (select 1 from people where id = new.assignee_id and access = 'moderator') then
    insert into pm_apps (person_id, app_id) values (new.assignee_id, new.app_id) on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists grant_app_on_request on tasks;
create trigger grant_app_on_request after insert or update of assignee_id on tasks for each row execute function grant_app_on_request();
drop policy if exists apps_read on apps;
-- приложения видят CEO, RM своих юнитов и PM — только из своего списка (pm_apps): Lead и сотрудник работают с задачами
create policy apps_read on apps for select to authenticated
  using ((not is_test or is_dev()) and (is_superadmin() or (is_unit_member(unit_id) and (
    my_access() = 'rm' or (my_access() = 'moderator' and pm_sees_app(id))))));
drop policy if exists apps_insert on apps;
create policy apps_insert on apps for insert to authenticated with check (is_superadmin());
drop policy if exists apps_update on apps;
create policy apps_update on apps for update to authenticated using (can_manage(unit_id)) with check (can_manage(unit_id));
drop policy if exists apps_delete on apps;
create policy apps_delete on apps for delete to authenticated using (is_superadmin());

-- Комментарии: видны вместе с задачей; писать — администраторы и исполнитель; править/удалять — автор или администратор.
drop policy if exists comments_read on comments;
create policy comments_read on comments for select to authenticated using (exists (select 1 from tasks t where t.id = task_id));
drop policy if exists comments_insert on comments;
create policy comments_insert on comments for insert to authenticated
  with check (exists (select 1 from tasks t where t.id = task_id and (can_manage(t.unit_id) or t.assignee_id = my_person_id()
                                                                     or in_lead_zone(t.unit_id, t.department_id, t.assignee_id))));
drop policy if exists comments_change on comments;
create policy comments_change on comments for update to authenticated
  using (author_id = my_person_id() or exists (select 1 from tasks t where t.id = task_id and can_manage(t.unit_id)))
  with check (author_id = my_person_id() or exists (select 1 from tasks t where t.id = task_id and can_manage(t.unit_id)));
drop policy if exists comments_delete on comments;
create policy comments_delete on comments for delete to authenticated
  using (author_id = my_person_id() or exists (select 1 from tasks t where t.id = task_id and can_manage(t.unit_id)));

-- История: только чтение и добавление; удаляется только вместе с юнитом.
drop policy if exists activity_read on activity;
create policy activity_read on activity for select to authenticated
  using (is_superadmin() or (task_id = '' and can_manage(unit_id)) or exists (select 1 from tasks t where t.id = task_id));
drop policy if exists activity_insert on activity;
-- Записать в историю можно только про задачу, с которой человек работает (исполнитель, отправивший на ревью, ревьюер);
-- записи без задачи и про чужие задачи — только администраторы.
create policy activity_insert on activity for insert to authenticated with check (
  is_superadmin() or (task_id = '' and can_manage(unit_id))
  or (task_id <> '' and exists (select 1 from tasks t where t.id = task_id and t.unit_id = activity.unit_id
    and (can_manage(t.unit_id) or my_person_id() in (t.assignee_id, t.review_from, t.reviewer_id)
         or in_lead_zone(t.unit_id, t.department_id, t.assignee_id)))));

-- Замещение на период (болезнь, отпуск): ставит только CEO. Пока действует — ревью и задачи PM юнита идут заместителю.
create table if not exists deputies (
  id         text primary key,
  person_id  text not null references people(id) on delete cascade,
  deputy_id  text not null references people(id) on delete cascade,
  date_from  text not null,
  date_to    text not null,
  note       text not null default '',
  created_at text not null
);
alter table deputies enable row level security;
drop policy if exists deputies_read on deputies;
create policy deputies_read on deputies for select to authenticated using (true);
drop policy if exists deputies_write on deputies;
create policy deputies_write on deputies for all to authenticated using (is_superadmin()) with check (is_superadmin());
-- Кто сейчас за человека: заместитель на сегодня (активный), иначе он сам.
create or replace function deputy_for(p_person text) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select d.deputy_id from deputies d join people p on p.id = d.deputy_id and p.active
                    where d.person_id = p_person and to_char((now() at time zone 'utc')::date, 'YYYY-MM-DD') between d.date_from and d.date_to
                    order by d.date_from desc, d.created_at desc limit 1), p_person);
$$;

-- Ответственный за юнит (роль PM): PM или CEO. Пусто — первый PM из состава. Менять может только CEO.
alter table units add column if not exists pm_id text not null default '';
create or replace function unit_pm(p_unit text) returns text language sql stable set search_path = public as $$
  select case when x = '' then '' else deputy_for(x) end from (select coalesce(
    (select u.pm_id from units u join people p on p.id = u.pm_id and p.active where u.id = p_unit and u.pm_id <> ''),
    (select m.person_id from unit_members m join people p on p.id = m.person_id
      where m.unit_id = p_unit and p.access = 'moderator' and p.active order by m.created_at limit 1),
    '') as x) s;
$$;
create or replace function guard_unit_pm() returns trigger language plpgsql set search_path = public as $$
begin
  if new.pm_id is distinct from old.pm_id and not (is_superadmin() or app_system()) then
    raise exception 'Ответственного за юнит меняет только CEO' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists units_guard_pm on units;
create trigger units_guard_pm before update of pm_id on units for each row execute function guard_unit_pm();

-- Баг-репорты QA на задаче (пишет только система: qa_return). Когда QA закрыл тестирование — все его открытые репорты закрыты.
alter table tasks add column if not exists bugs jsonb not null default '[]';
create or replace function task_bugs_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_prev text := coalesce(current_setting('app.system', true), '');
begin
  if new.bugs is distinct from old.bugs and not app_system() then
    raise exception 'Баг-репорты добавляет только QA кнопкой «Вернуть в разработку»' using errcode = '42501';
  end if;
  -- разработчик сдал исправления (этап снова готов) — открытые баг-репорты: «исправлен, на проверке» (и у QA)
  if new.step in ('ios', 'integr') and coalesce(new.done_at, '') <> '' and coalesce(old.done_at, '') = ''
     and exists (select 1 from jsonb_array_elements(new.bugs) b where coalesce(b ->> 'closedAt', '') = '' and coalesce(b ->> 'fixedAt', '') = '') then
    new.bugs := (select jsonb_agg(case when coalesce(b ->> 'closedAt', '') = '' and coalesce(b ->> 'fixedAt', '') = ''
                                       then b || jsonb_build_object('fixedAt', new.done_at) else b end) from jsonb_array_elements(new.bugs) b);
    perform set_config('app.system', 'on', true);
    update tasks q set bugs = (select jsonb_agg(case when coalesce(b ->> 'closedAt', '') = '' and coalesce(b ->> 'fixedAt', '') = ''
                                                    then b || jsonb_build_object('fixedAt', new.done_at) else b end) from jsonb_array_elements(q.bugs) b)
     where q.step = 'qa' and q.depends_on ? new.id and jsonb_array_length(q.bugs) > 0;
    perform set_config('app.system', v_prev, true);
  end if;
  if new.step = 'qa' and coalesce(new.done_at, '') <> '' and coalesce(old.done_at, '') = ''
     and exists (select 1 from jsonb_array_elements(new.bugs) b where coalesce(b ->> 'closedAt', '') = '') then
    new.bugs := (select jsonb_agg(case when coalesce(b ->> 'closedAt', '') = '' then b || jsonb_build_object('closedAt', new.done_at) else b end)
                   from jsonb_array_elements(new.bugs) b);
    perform set_config('app.system', 'on', true);
    update tasks d set bugs = (select jsonb_agg(case when b ->> 'qaTask' = new.id and coalesce(b ->> 'closedAt', '') = ''
                                                    then b || jsonb_build_object('closedAt', new.done_at) else b end)
                                 from jsonb_array_elements(d.bugs) b)
     where d.id in (select jsonb_array_elements_text(coalesce(new.depends_on, '[]'::jsonb))) and jsonb_array_length(d.bugs) > 0;
    perform set_config('app.system', v_prev, true);
  end if;
  return new;
end $$;
drop trigger if exists tasks_bugs_guard on tasks;
create trigger tasks_bugs_guard before update on tasks for each row execute function task_bugs_guard();

-- Файлы задачи (скриншоты реджекта): сжатая картинка data:image/… прямо в базе — без отдельного хранилища.
-- tag — к чему относится ('reject:3'). Видит тот, кто видит задачу; добавляет её исполнитель, PM/CEO; удаляет автор или CEO.
create table if not exists task_files (
  id         text primary key,
  task_id    text not null references tasks(id) on delete cascade,
  tag        text not null default '',
  name       text not null default '',
  data       text not null,
  created_by text not null default '',
  created_at text not null
);
create index if not exists task_files_task on task_files(task_id, tag);
alter table task_files enable row level security;
drop policy if exists task_files_read on task_files;
create policy task_files_read on task_files for select to authenticated using (exists (select 1 from tasks t where t.id = task_id));
drop policy if exists task_files_insert on task_files;
create policy task_files_insert on task_files for insert to authenticated with check (
  data like 'data:image/%' and length(data) <= 2000000
  and exists (select 1 from tasks t where t.id = task_id and (can_manage(t.unit_id) or t.assignee_id = my_person_id())));
drop policy if exists task_files_delete on task_files;
create policy task_files_delete on task_files for delete to authenticated using (is_superadmin() or created_by = my_person_id());

-- Бэклог (CEO): идеи и ТЗ до старта работ — новое приложение или апдейт. «Запустить» создаёт приложение
-- с запросом New App или запрос «Апдейт»; идея помнит, во что превратилась (request_id).
create table if not exists ideas (
  id          text primary key,
  title       text not null,
  description text not null default '',
  spec_url    text not null default '',
  kind        text not null default 'new_app' check (kind in ('new_app', 'update')),
  app_id      text not null default '',
  status      text not null default 'new' check (status in ('new', 'started', 'dropped')),
  request_id  text not null default '',
  created_by  text not null default '',
  created_at  text not null,
  updated_at  text not null
);
-- юнит идеи: '' — общий бэклог; у апдейта — юнит приложения
alter table ideas add column if not exists unit_id text not null default '';
alter table ideas enable row level security;
drop policy if exists ideas_all on ideas;
create policy ideas_all on ideas for all to authenticated using (is_superadmin()) with check (is_superadmin());

-- RM проверяет опросник разработчика: «Принять» (checked) или «Вернуть с вопросами» — ответы сбрасываются,
-- тому, кто заполнял этап (iOS или интеграция), — комментарий и уведомление. RM этап не видит — функция с правами владельца.
create or replace function dev_form_review(p_task text, p_ok boolean, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r tasks;
  s tasks;
  f jsonb;
  v_me text := coalesce(my_person_id(), '');
  v_prev text := coalesce(current_setting('app.system', true), '');
  at_ text := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select * into r from tasks where id = p_task and step = 'release';
  if r.id is null then raise exception 'Это не этап «Релиз»' using errcode = 'P0001'; end if;
  if not (app_system() or r.assignee_id = v_me or can_manage(r.unit_id)) then
    raise exception 'Опросник проверяет RM релиза' using errcode = '42501';
  end if;
  select * into s from tasks
   where parent_id = r.parent_id and r.parent_id <> '' and step in ('ios', 'integr') and not archived
   order by case when step = 'integr' and dev_form ->> 'need' = 'true' then 0
                 when step = 'ios' and coalesce(dev_form ->> 'need', '') <> 'false' then 1 else 2 end
   limit 1;
  if s.id is null or coalesce(s.dev_form ->> 'at', '') = '' then raise exception 'Опросник ещё не заполнен' using errcode = 'P0001'; end if;
  if p_ok then
    f := (s.dev_form - 'returned') || jsonb_build_object('checked', jsonb_build_object('by', v_me, 'at', at_));
  else
    if btrim(coalesce(p_note, '')) = '' then raise exception 'Напишите, что уточнить в опроснике' using errcode = 'P0001'; end if;
    f := (s.dev_form - 'checked') || jsonb_build_object('at', '', 'returned', jsonb_build_object('by', v_me, 'at', at_, 'note', left(btrim(p_note), 2000)));
  end if;
  perform set_config('app.system', 'on', true);
  update tasks set dev_form = f, updated_at = at_ where id = s.id;
  if not p_ok then
    insert into comments (id, task_id, text, author_id, at)
    values ('c_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12), s.id, left('Опросник вернули с вопросами: ' || btrim(p_note), 5000), v_me, at_);
    if s.assignee_id <> '' and s.assignee_id <> v_me and notify_test_ok(s.is_test, s.assignee_id) then
      insert into notifications (id, person_id, task_id, kind, actor_id, at)
      values ('n_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12), s.assignee_id, s.id, 'returned', v_me, at_);
    end if;
  end if;
  perform set_config('app.system', v_prev, true);
  return f;
end $$;

-- Режим разработчика «смотреть как»: уведомления этого человека — непрочитанные и история с p_since; только посмотреть.
drop function if exists notifications_of(text);
create or replace function notifications_of(p_person text, p_since text default '') returns setof notifications
language sql stable security definer set search_path = public as $$
  select * from notifications
   where is_dev() and person_id = p_person and (read_at = '' or (p_since <> '' and at >= p_since))
   order by at desc limit 150;
$$;

-- Запрос CEO в архив отправляет только CEO (PM его разбирает, но не убирает).
create or replace function guard_request_archive() returns trigger language plpgsql set search_path = public as $$
begin
  if new.kind = 'request' and new.archived and not old.archived and not (app_system() or is_superadmin()) then
    raise exception 'Запрос CEO убрать в архив может только CEO' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists tasks_guard_request_archive on tasks;
create trigger tasks_guard_request_archive before update of archived on tasks for each row execute function guard_request_archive();

-- Метка «тестовое» у юнитов и людей (демо из режима разработчика) — ставит только разработчик; удаляет delete_test_data.
alter table units add column if not exists is_test boolean not null default false;
alter table people add column if not exists is_test boolean not null default false;
create or replace function guard_test_flag() returns trigger language plpgsql set search_path = public as $$
begin
  if new.is_test and (tg_op = 'INSERT' or not old.is_test) and not (app_system() or is_dev()) then
    raise exception 'Тестовые данные создаёт только режим разработчика' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists units_guard_test on units;
create trigger units_guard_test before insert or update of is_test on units for each row execute function guard_test_flag();
drop trigger if exists people_guard_test on people;
create trigger people_guard_test before insert or update of is_test on people for each row execute function guard_test_flag();

-- Мониторинг: ошибки в браузерах пользователей. Пишет само приложение (вошедший — только от своего имени),
-- читают и чистят разработчик и CEO («Режим разработчика → Ошибки у пользователей»). Старше 30 дней удаляются при просмотре.
create table if not exists client_errors (
  id        text primary key default 'e_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
  person_id text not null default '',
  at        text not null default to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  message   text not null check (length(message) between 1 and 1000),
  stack     text not null default '' check (length(stack) <= 4000),
  url       text not null default '' check (length(url) <= 500),
  agent     text not null default '' check (length(agent) <= 300),
  version   text not null default '' check (length(version) <= 60)
);
create index if not exists client_errors_at on client_errors(at);
alter table client_errors enable row level security;
drop policy if exists client_errors_insert on client_errors;
create policy client_errors_insert on client_errors for insert to authenticated with check (person_id = coalesce(my_person_id(), ''));
drop policy if exists client_errors_read on client_errors;
create policy client_errors_read on client_errors for select to authenticated using (is_dev() or is_superadmin());
drop policy if exists client_errors_delete on client_errors;
create policy client_errors_delete on client_errors for delete to authenticated using (is_dev() or is_superadmin());

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;

-- ── Журнал всего: приложения, юниты, люди, общие настройки ─────────────────────────────────────────────
-- Пишут триггеры базы — запись появляется при любом способе изменения (экран, функция, импорт).
-- ref_id / ref_name — о чём запись (приложение, юнит, человек, ключ настройки); имя — снимок, переживает удаление.
alter table activity add column if not exists ref_id text not null default '';
alter table activity add column if not exists ref_name text not null default '';
create index if not exists activity_ref on activity(ref_id);

create or replace function audit_write(p_action text, p_unit text, p_ref text, p_name text, p_field text, p_from text, p_to text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into activity (id, unit_id, task_id, action, field, from_val, to_val, actor_id, at, ref_id, ref_name)
  values ('a_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12), coalesce(p_unit, ''), '', p_action, coalesce(p_field, ''),
          case when p_from is null then '' else to_jsonb(p_from)::text end, case when p_to is null then '' else to_jsonb(p_to)::text end,
          coalesce(my_person_id(), ''), to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), coalesce(p_ref, ''), coalesce(p_name, ''));
end $$;

-- Приложение: создано, переименовано, статус, приоритет, перенос в юнит, убрано на полку / возвращено, удалено навсегда.
create or replace function audit_apps() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not new.is_test then perform audit_write('app_create', new.unit_id, new.id, new.name, '', null, new.name); end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if not old.is_test then perform audit_write('app_delete', old.unit_id, old.id, old.name, '', old.name, null); end if;
    return old;
  end if;
  if new.is_test then return new; end if;
  if new.name is distinct from old.name then perform audit_write('app_update', new.unit_id, new.id, new.name, 'name', old.name, new.name); end if;
  if new.status is distinct from old.status then perform audit_write('app_update', new.unit_id, new.id, new.name, 'status', old.status, new.status); end if;
  if new.priority is distinct from old.priority then perform audit_write('app_update', new.unit_id, new.id, new.name, 'priority', old.priority, new.priority); end if;
  if new.unit_id is distinct from old.unit_id then perform audit_write('app_update', new.unit_id, new.id, new.name, 'unit', old.unit_id, new.unit_id); end if;
  if new.archived and (not old.archived or new.shelf is distinct from old.shelf) then
    perform audit_write('app_shelve', new.unit_id, new.id, new.name, '', case when old.archived then coalesce(nullif(old.shelf, ''), 'deleted') end, coalesce(nullif(new.shelf, ''), 'deleted'));
  elsif old.archived and not new.archived then
    perform audit_write('app_restore', new.unit_id, new.id, new.name, '', coalesce(nullif(old.shelf, ''), 'deleted'), null);
  end if;
  return new;
end $$;
drop trigger if exists audit_apps on apps;
create trigger audit_apps after insert or update or delete on apps for each row execute function audit_apps();

-- Юнит: создан, переименован, настройки (колонки, флоу, ревью…), в корзину / из корзины, удалён навсегда.
create or replace function audit_units() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not new.is_test then perform audit_write('unit_create', new.id, new.id, new.name, '', null, new.name); end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if not old.is_test then perform audit_write('unit_delete', old.id, old.id, old.name, '', old.name, null); end if;
    return old;
  end if;
  if new.is_test then return new; end if;
  if new.name is distinct from old.name then perform audit_write('unit_update', new.id, new.id, new.name, 'name', old.name, new.name); end if;
  if new.settings is distinct from old.settings then perform audit_write('unit_update', new.id, new.id, new.name, 'settings', null, null); end if;
  if new.archived and not old.archived then perform audit_write('unit_archive', new.id, new.id, new.name, '', null, null);
  elsif old.archived and not new.archived then perform audit_write('unit_restore', new.id, new.id, new.name, '', null, null); end if;
  return new;
end $$;
drop trigger if exists audit_units on units;
create trigger audit_units after insert or update or delete on units for each row execute function audit_units();

-- Человек: добавлен, имя, роль, позиция, отключён / включён, удалён. Личные настройки и «был в сети» — не пишем.
create or replace function audit_people() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not new.is_test then perform audit_write('person_create', '', new.id, new.name, '', null, new.name); end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if not old.is_test then perform audit_write('person_delete', '', old.id, old.name, '', old.name, null); end if;
    return old;
  end if;
  if new.is_test then return new; end if;
  if new.name is distinct from old.name then perform audit_write('person_update', '', new.id, new.name, 'name', old.name, new.name); end if;
  if new.access is distinct from old.access then perform audit_write('person_update', '', new.id, new.name, 'access', old.access, new.access); end if;
  if new.position_id is distinct from old.position_id then perform audit_write('person_update', '', new.id, new.name, 'position', old.position_id, new.position_id); end if;
  if new.active is distinct from old.active then perform audit_write('person_update', '', new.id, new.name, 'active', old.active::text, new.active::text); end if;
  return new;
end $$;
drop trigger if exists audit_people on people;
create trigger audit_people after insert or update or delete on people for each row execute function audit_people();

-- Общие настройки студии (статусы и поля приложений, релиз, сроки…): что поменяли — ключ; служебные метки не пишем.
create or replace function audit_settings() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.key like 'migr_%' then return new; end if;
  if tg_op = 'UPDATE' and new.value is not distinct from old.value then return new; end if;
  -- автопроверка App Store сама отмечает начало нового круга — это не действие человека
  if tg_op = 'UPDATE' and new.key = 'storeAutoCheck' and (new.value - 'cycleAt') is not distinct from (old.value - 'cycleAt') then return new; end if;
  perform audit_write('settings_update', '', new.key, new.key, new.key, null, null);
  return new;
end $$;
drop trigger if exists audit_settings on app_settings;
create trigger audit_settings after insert or update on app_settings for each row execute function audit_settings();
-- писать в журнал напрямую нельзя — только триггерами
revoke execute on function audit_write(text, text, text, text, text, text, text) from authenticated, public, anon;

-- ── Автопроверка ссылок App Store (включает CEO: app_settings.storeAutoCheck = { on, cycleAt }) ──────────────
-- Раз в 2 минуты (pg_cron) база проверяет ОДНУ ссылку: случайное приложение из ещё не проверенных в этом круге;
-- запрос в справочник Apple — через pg_net (ответ приходит асинхронно, разбираем на следующем тике).
-- Нет в стране из ссылки — на следующих тиках другие страны; проверены все — новый круг. Один запрос за тик.
do $$ begin
  begin create extension if not exists pg_net; exception when others then null; end;
  begin create extension if not exists pg_cron; exception when others then null; end;
end $$;

create table if not exists store_check_job (
  key        text primary key default 'job',
  app_id     text not null,
  store_id   text not null,
  countries  jsonb not null default '[]',
  idx        int not null default 0,
  request_id bigint,
  at         text not null
);
alter table store_check_job enable row level security;  -- политик нет: только функции базы

create or replace function store_check_tick() returns text language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb;
  j store_check_job;
  r record;
  fid text;
  a apps;
  url text;
  sid text;
  own text;
  ctry jsonb;
  body jsonb;
  cyc text;
  at_ text := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select value into cfg from app_settings where key = 'storeAutoCheck';
  if not coalesce((cfg ->> 'on')::boolean, false) then delete from store_check_job where key = 'job'; return 'off'; end if;

  -- 1) ответ на прошлый запрос
  select * into j from store_check_job where key = 'job';
  if j.key is not null then
    execute 'select id, status_code, content, timed_out from net._http_response where id = $1' into r using j.request_id;
    if r.id is null then
      if j.at > to_char((clock_timestamp() - interval '10 minutes') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') then return 'waiting'; end if;
      delete from store_check_job where key = 'job';  -- ответа так и нет — берём следующее
    elsif coalesce(r.status_code, 0) = 200 and not coalesce(r.timed_out, false) then
      begin body := r.content::jsonb; exception when others then body := null; end;
      if coalesce((body ->> 'resultCount')::int, 0) > 0 then
        update apps set store_ok = true, store_checked_at = at_,
               store_name = coalesce(nullif(left(body -> 'results' -> 0 ->> 'trackName', 200), ''), store_name),
               icon_url = case when coalesce(body -> 'results' -> 0 ->> 'artworkUrl512', '') ~ '^https://[A-Za-z0-9.-]+\.mzstatic\.com/'
                               then left(body -> 'results' -> 0 ->> 'artworkUrl512', 500) else icon_url end
         where id = j.app_id;
        delete from store_check_job where key = 'job';
        return 'ok';
      elsif j.idx + 1 < jsonb_array_length(j.countries) then
        execute 'select net.http_get($1)' into j.request_id
          using 'https://itunes.apple.com/lookup?id=' || j.store_id || '&country=' || (j.countries ->> (j.idx + 1));
        update store_check_job set idx = j.idx + 1, request_id = j.request_id, at = at_ where key = 'job';
        return 'next-country';
      else
        update apps set store_ok = false, store_checked_at = at_ where id = j.app_id;
        delete from store_check_job where key = 'job';
        return 'gone';
      end if;
    else
      -- ошибка или лимит Apple: вердикт не меняем, только отмечаем, что подходили, и идём дальше
      update apps set store_checked_at = at_ where id = j.app_id;
      delete from store_check_job where key = 'job';
      return 'error';
    end if;
  end if;

  -- 2) следующее приложение: случайное из ещё не проверенных в этом круге
  select x ->> 'id' into fid from app_settings s, jsonb_array_elements(s.value) x
   where s.key = 'appFields' and x ->> 'kind' = 'link' and x ->> 'name' ~* 'app ?store' and x ->> 'name' !~* 'connect' limit 1;
  if fid is null then return 'no-field'; end if;
  cyc := coalesce(cfg ->> 'cycleAt', '');
  select * into a from apps where not archived and not is_test and coalesce(info ->> fid, '') ~ 'id[0-9]{5,}'
     and (store_checked_at = '' or store_checked_at < cyc) order by random() limit 1;
  if a.id is null then
    update app_settings set value = cfg || jsonb_build_object('cycleAt', at_) where key = 'storeAutoCheck';
    select * into a from apps where not archived and not is_test and coalesce(info ->> fid, '') ~ 'id[0-9]{5,}' order by random() limit 1;
    if a.id is null then return 'empty'; end if;
  end if;
  url := a.info ->> fid;
  sid := substring(url from 'id([0-9]{5,})');
  own := lower(coalesce(substring(url from 'apple\.com/([A-Za-z]{2})/'), 'us'));
  select jsonb_agg(c order by o) into ctry from (
    select c, min(o) as o from unnest(array[own, 'us', 'gb', 'de', 'ru', 'fr', 'jp', 'br']) with ordinality t(c, o) group by c) z;
  insert into store_check_job (key, app_id, store_id, countries, idx, request_id, at) values ('job', a.id, sid, ctry, 0, null, at_);
  execute 'select net.http_get($1)' into j.request_id using 'https://itunes.apple.com/lookup?id=' || sid || '&country=' || (ctry ->> 0);
  update store_check_job set request_id = j.request_id where key = 'job';
  return 'sent';
end $$;
revoke execute on function store_check_tick() from authenticated, public, anon;

-- расписание: каждые 2 минуты (если расширение pg_cron включено); выключатель — у CEO, функция сама молчит при off
-- ошибка расписания не должна останавливать остальную схему: тогда только предупреждение в выводе SQL Editor
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('store-check', '*/2 * * * *', 'select public.store_check_tick()');
    exception when others then raise notice 'Автопроверка App Store: расписание не создано — %', sqlerrm;
    end;
  else
    raise notice 'Автопроверка App Store: расширение pg_cron не включено (Database → Extensions)';
  end if;
end $$;

-- Что ушло в Apple с релизом: название и тип запроса-родителя (новое приложение / апдейт №N). RM видит только этап
-- «Релиз», а не сам запрос, — отдаём лишь эти два поля и только тем, кто ведёт релизы (CEO, PM, RM).
create or replace function release_parents(p_ids text[]) returns table (id text, title text, request_type text)
language sql stable security definer set search_path = public as $$
  select r.id, r.title, r.request_type from tasks r
   where r.id = any(p_ids) and my_access() in ('superadmin', 'moderator', 'rm')
     and exists (select 1 from tasks t where t.parent_id = r.id and t.step = 'release');
$$;
grant execute on function release_parents(text[]) to authenticated;

-- Позиции команды: доска команды показывает задачи этих позиций у людей команды (пусто — все задачи людей команды)
alter table teams add column if not exists department_ids jsonb not null default '[]';
update teams set department_ids = '["d_po"]'::jsonb where id = 't_product' and department_ids = '[]'::jsonb;
update teams set department_ids = '["d_design"]'::jsonb where id = 't_design' and department_ids = '[]'::jsonb;
update teams set department_ids = '["d_ios"]'::jsonb where id = 't_ios' and department_ids = '[]'::jsonb;
update teams set department_ids = '["d_qa"]'::jsonb where id = 't_qa' and department_ids = '[]'::jsonb;
update teams set department_ids = '["d_release"]'::jsonb where id = 't_release' and department_ids = '[]'::jsonb;
update teams set department_ids = '["d_aso"]'::jsonb where id = 't_aso' and department_ids = '[]'::jsonb;
update teams set department_ids = '["d_other"]'::jsonb where id = 't_other' and department_ids = '[]'::jsonb;

-- Инфо-лист: CEO включает выбранным людям и отмечает каждому поля приложения (Figma, GitHub…).
-- Человек видит приложения своих юнитов только с этими полями — через my_info_list(), сами приложения ему по-прежнему закрыты.
create table if not exists info_lists (
  person_id  text primary key references people(id) on delete cascade,
  field_ids  jsonb not null default '[]',
  updated_at text not null default ''
);
alter table info_lists enable row level security;
grant select, insert, update, delete on info_lists to authenticated;
drop policy if exists info_lists_read on info_lists;
create policy info_lists_read on info_lists for select to authenticated using (is_superadmin() or person_id = my_person_id());
drop policy if exists info_lists_write on info_lists;
create policy info_lists_write on info_lists for all to authenticated using (is_superadmin()) with check (is_superadmin());

create or replace function my_info_list() returns table (id text, name text, icon_url text, color text, unit_id text, vals jsonb)
language sql stable security definer set search_path = public as $$
  select a.id, a.name, a.icon_url, a.color, a.unit_id,
         coalesce((select jsonb_object_agg(k, a.info -> k) from jsonb_array_elements_text(l.field_ids) k
                    where jsonb_typeof(a.info -> k) = 'string'), '{}'::jsonb)
    from info_lists l
    join unit_members m on m.person_id = l.person_id
    join units u on u.id = m.unit_id and not u.archived
    join apps a on a.unit_id = u.id and not a.archived and (not a.is_test or is_dev())
   where l.person_id = my_person_id()
   order by lower(a.name);
$$;
revoke execute on function my_info_list() from public, anon;
grant execute on function my_info_list() to authenticated;

-- PM добавили в юнит — ему открываются все приложения юнита (как и новые); убрали из юнита — приложения этого юнита закрываются.
-- Лишние CEO снимает в «Приложения PM…».
create or replace function pm_apps_on_member() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from people where id = new.person_id and access = 'moderator' and active) then
      insert into pm_apps (person_id, app_id)
        select new.person_id, a.id from apps a where a.unit_id = new.unit_id
        on conflict do nothing;
    end if;
    return new;
  end if;
  delete from pm_apps where person_id = old.person_id and app_id in (select id from apps where unit_id = old.unit_id);
  return old;
end $$;
drop trigger if exists pm_apps_on_member on unit_members;
create trigger pm_apps_on_member after insert or delete on unit_members for each row execute function pm_apps_on_member();

-- Человека сделали PM — открываются приложения его юнитов.
create or replace function pm_apps_on_access() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.access = 'moderator' and new.active and (old.access is distinct from 'moderator' or not old.active) then
    insert into pm_apps (person_id, app_id)
      select new.id, a.id from unit_members m join apps a on a.unit_id = m.unit_id where m.person_id = new.id
      on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists pm_apps_on_access on people;
create trigger pm_apps_on_access after update of access, active on people for each row execute function pm_apps_on_access();

-- Однократно (2026-11-09): PM, которым из их юнита не открыто ни одного приложения, получают все приложения этого юнита.
do $$ begin
  if not exists (select 1 from app_settings where key = 'pmUnitAppsSeeded') then
    insert into pm_apps (person_id, app_id)
      select m.person_id, a.id
        from unit_members m
        join people p on p.id = m.person_id and p.access = 'moderator' and p.active
        join apps a on a.unit_id = m.unit_id
       where not exists (select 1 from pm_apps x join apps y on y.id = x.app_id where x.person_id = m.person_id and y.unit_id = m.unit_id)
      on conflict do nothing;
    insert into app_settings (key, value, updated_at) values ('pmUnitAppsSeeded', 'true'::jsonb, '') on conflict (key) do nothing;
  end if;
end $$;

-- «Смотреть как» (режим разработчика): база считает права от выбранного человека, а не от вошедшего.
-- people.view_as действует, только если вошедший — разработчик. В этом режиме изменения запрещены (только просмотр).
alter table people add column if not exists view_as text not null default '';

-- Кто я для прав: выбранный в «Смотреть как» (если вошедший — разработчик), иначе вошедший.
create or replace function my_person_id() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select v.id from people me join people v on v.id = me.view_as and v.active
      where me.user_id = auth.uid() and me.active and me.is_dev and me.view_as <> '' limit 1),
    (select id from people where user_id = auth.uid() and active limit 1));
$$;
create or replace function my_access() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select access from people where id = my_person_id()), '');
$$;
create or replace function my_position() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select position_id from people where id = my_person_id()), '');
$$;
create or replace function my_teams() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce((select array(select jsonb_array_elements_text(team_ids)) from people where id = my_person_id()), '{}');
$$;
create or replace function my_positions() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce((select array_remove(array[position_id] || array(select jsonb_array_elements_text(extra_positions)), '')
                     from people where id = my_person_id()), '{}');
$$;
create or replace function is_dev() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_dev from people where id = my_person_id()), false);
$$;

-- Идёт просмотр от имени другого?
create or replace function viewing_as() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from people where user_id = auth.uid() and active and is_dev and view_as <> '' and view_as <> id);
$$;

-- Включить/выключить «Смотреть как» (только настоящий разработчик, только себе). '' — вернуться к себе.
create or replace function set_view_as(p_person text) returns text
language plpgsql security definer set search_path = public as $$
declare v_me text;
begin
  select id into v_me from people where user_id = auth.uid() and active and is_dev;
  if v_me is null then raise exception 'Только для режима разработчика' using errcode = '42501'; end if;
  if coalesce(p_person, '') <> '' and not exists (select 1 from people where id = p_person and active) then
    raise exception 'Человек не найден' using errcode = 'P0001';
  end if;
  perform set_config('app.system', 'on', true);
  update people set view_as = case when coalesce(p_person, '') = v_me then '' else coalesce(p_person, '') end where id = v_me;
  return (select view_as from people where id = v_me);
end $$;
revoke execute on function set_view_as(text) from public, anon;
grant execute on function set_view_as(text) to authenticated;

-- «Я в сети» — всегда настоящий вошедший, и в режиме просмотра тоже.
create or replace function touch_presence() returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.system', 'on', true);
  update people set last_seen_at = to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
   where user_id = auth.uid() and active;
end $$;

-- В режиме просмотра любые изменения из интерфейса запрещены (служебные операции базы — можно).
create or replace function block_view_as_writes() returns trigger language plpgsql set search_path = public as $$
begin
  if not app_system() and viewing_as() then
    raise exception 'Режим «Смотреть как»: только просмотр — изменения не сохраняются' using errcode = 'P0001';
  end if;
  return null;
end $$;
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('drop trigger if exists block_view_as_writes on public.%I', t.tablename);
    execute format('create trigger block_view_as_writes before insert or update or delete on public.%I for each statement execute function block_view_as_writes()', t.tablename);
  end loop;
end $$;

-- Обратная связь: любой человек пишет предложение по улучшению; читает и разбирает — режим разработчика.
create table if not exists feedback (
  id         text primary key,
  person_id  text not null default '',
  kind       text not null default 'idea',
  text       text not null,
  status     text not null default 'new',
  created_at text not null,
  done_at    text not null default ''
);
create index if not exists feedback_at on feedback(created_at);
alter table feedback enable row level security;
grant select, insert, update, delete on feedback to authenticated;
drop policy if exists feedback_insert on feedback;
create policy feedback_insert on feedback for insert to authenticated with check (person_id = coalesce(my_person_id(), '') and person_id <> '');
drop policy if exists feedback_read on feedback;
create policy feedback_read on feedback for select to authenticated using (person_id = my_person_id() or is_dev());
drop policy if exists feedback_update on feedback;
create policy feedback_update on feedback for update to authenticated using (is_dev()) with check (is_dev());
drop policy if exists feedback_delete on feedback;
create policy feedback_delete on feedback for delete to authenticated using (is_dev());
drop trigger if exists block_view_as_writes on feedback;
create trigger block_view_as_writes before insert or update or delete on feedback for each statement execute function block_view_as_writes();

-- Приложение добавили уже в работе: разложенный запрос «перематывается» на текущий этап.
-- p_done — шаги флоу, которые уже пройдены («Готово», чеклист закрыт), p_progress — текущий шаг («В работе»).
-- Уведомления о пройденных этапах и о самом запросе убираются — людям приходит только то, что сейчас на них.
-- Только CEO. Проверки этапов (чеклист, опросник разработчика) для пройденного не нужны — служебный режим.
create or replace function fast_forward_request(p_request text, p_done text[], p_progress text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record; st jsonb; c_done text; c_prog text; at_ text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  n integer := 0;
begin
  if not is_superadmin() then raise exception 'Недостаточно прав: разносить приложения по этапам может CEO' using errcode = '42501'; end if;
  select * into r from tasks where id = p_request and kind = 'request';
  if r.id is null then raise exception 'Запрос не найден' using errcode = 'P0001'; end if;
  select settings into st from units where id = r.unit_id;
  select x ->> 'id' into c_done from jsonb_array_elements(st -> 'columns') x where x ->> 'kind' = 'done' limit 1;
  select x ->> 'id' into c_prog from jsonb_array_elements(st -> 'columns') x where x ->> 'kind' = 'progress' limit 1;
  perform set_config('app.system', 'on', true);
  update tasks set status = c_done, done_at = at_, started_at = case when started_at = '' then at_ else started_at end, updated_at = at_,
         checklist = coalesce((select jsonb_agg(i || jsonb_build_object('done', true)) from jsonb_array_elements(checklist) i), '[]'::jsonb)
   where parent_id = p_request and kind = 'stage' and not archived and step = any(coalesce(p_done, '{}')) and c_done is not null;
  get diagnostics n = row_count;
  if coalesce(p_progress, '') <> '' and c_prog is not null then
    update tasks set status = c_prog, started_at = case when started_at = '' then at_ else started_at end, updated_at = at_
     where parent_id = p_request and kind = 'stage' and not archived and step = p_progress;
  end if;
  delete from notifications where read_at = '' and (task_id = p_request
    or task_id in (select id from tasks where parent_id = p_request and step = any(coalesce(p_done, '{}'))));
  return n;
end $$;
revoke execute on function fast_forward_request(text, text[], text) from public, anon;
grant execute on function fast_forward_request(text, text[], text) to authenticated;

-- Цифры по юнитам для меню и карточек (вместо выгрузки всех задач в браузер): по колонкам, просрочено, на ревью, закрыто за неделю.
-- Права — как на доске (RLS): сотрудник считает только видимое ему; этапы, которые ждут предыдущих, у не-администраторов не считаются.
-- Незакрытые среди переданных задач (одним запросом — для подсчёта «ждущих» этапов сразу у всех).
create or replace function open_task_ids(p_ids text[]) returns setof text
language sql stable security definer set search_path = public as $$
  select t.id from tasks t join units u on u.id = t.unit_id
   where t.id = any(coalesce(p_ids, '{}'))
     and not exists (select 1 from jsonb_array_elements(u.settings -> 'columns') c where c ->> 'id' = t.status and c ->> 'kind' = 'done');
$$;
grant execute on function open_task_ids(text[]) to authenticated;

create or replace function unit_task_counts(p_day text, p_week text) returns table (unit_id text, todo int, in_progress int, done int, overdue int, review int, done_week int)
language sql stable set search_path = public as $$
  with st as (select is_staff() as staff),
  base as (
    select t.id, t.unit_id, t.status, t.due_date, t.done_at, t.depends_on, u.settings
      from tasks t join units u on u.id = t.unit_id
     where not t.archived
  ),
  -- этапы, которые ждут незакрытых предыдущих, у не-администраторов не считаются (как на доске); зависимости проверяем разом
  od as (
    select id from open_task_ids(case when (select staff from st) then '{}'::text[]
      else array(select distinct d from base, jsonb_array_elements_text(base.depends_on) d where base.depends_on <> '[]'::jsonb) end) id
  ),
  blocked as (
    select distinct b.id from base b, jsonb_array_elements_text(b.depends_on) d where d in (select id from od)
  ),
  t as (
    select b.unit_id, b.status, b.due_date, b.done_at,
           coalesce((select c ->> 'kind' from jsonb_array_elements(b.settings -> 'columns') c where c ->> 'id' = b.status limit 1),
                    b.settings -> 'columns' -> 0 ->> 'kind',
                    case b.status when 'todo' then 'todo' when 'done' then 'done' else 'progress' end) as kind,
           b.settings -> 'review' ->> 'column' as rcol
      from base b
     where b.id not in (select id from blocked)
  )
  select unit_id,
         count(*) filter (where kind = 'todo')::int,
         count(*) filter (where kind = 'progress')::int,
         count(*) filter (where kind = 'done')::int,
         count(*) filter (where kind <> 'done' and due_date <> '' and due_date < p_day)::int,
         count(*) filter (where rcol is not null and status = rcol)::int,
         count(*) filter (where kind = 'done' and coalesce(p_week, '') <> '' and done_at >= p_week)::int
    from t group by unit_id;
$$;
grant execute on function unit_task_counts(text, text) to authenticated;

-- Уведомление о новом предложении (обратная связь): разработчикам, кроме автора. У такого уведомления нет задачи —
-- task_id пустой (null), ref — id предложения.
alter table notifications alter column task_id drop not null;
create or replace function notify_feedback() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (id, person_id, task_id, kind, actor_id, at, ref)
  select 'n_' || substr(md5(random()::text || clock_timestamp()::text || p.id), 1, 12), p.id, null, 'feedback', new.person_id,
         to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), new.id
    from people p where p.is_dev and p.active and p.id <> new.person_id;
  return new;
end $$;
drop trigger if exists notify_feedback on feedback;
create trigger notify_feedback after insert on feedback for each row execute function notify_feedback();

-- Скорость: правило чтения задач считало права на каждую строку (my_person_id → my_access → can_manage по нескольку раз),
-- на тысячах задач это секунды и таймауты. Теперь права — один раз на запрос: (select …) превращается в initPlan,
-- членство в юнитах и приложения PM — массивами. Логика та же.
create or replace function my_unit_ids() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array(select unit_id from unit_members where person_id = my_person_id()), '{}');
$$;
grant execute on function my_unit_ids() to authenticated;
create or replace function my_pm_app_ids() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array(select app_id from pm_apps where person_id = my_person_id()), '{}');
$$;
grant execute on function my_pm_app_ids() to authenticated;

drop policy if exists tasks_read on tasks;
create policy tasks_read on tasks for select to authenticated using (
  (not is_test or (select is_dev()))
  and (app_id = '' or (select my_access()) <> 'moderator' or app_id = any(coalesce((select my_pm_app_ids()), '{}')))
  and (
    (select is_superadmin())
    or ((select my_access()) = 'moderator' and unit_id = any(coalesce((select my_unit_ids()), '{}')))
    or assignee_id = (select my_person_id()) or review_from = (select my_person_id()) or reviewer_id = (select my_person_id())
    or ((select my_access()) = 'lead' and in_lead_zone(unit_id, department_id, assignee_id))
    or ((select my_access()) = 'rm' and unit_id = any(coalesce((select my_unit_ids()), '{}'))
        and ((department_id <> '' and department_id = any(coalesce((select my_positions()), '{}')))
             or (team_id <> '' and team_id = any(coalesce((select my_teams()), '{}')))))));

drop policy if exists tasks_update on tasks;
create policy tasks_update on tasks for update to authenticated
  using ((select is_superadmin()) or ((select my_access()) = 'moderator' and unit_id = any(coalesce((select my_unit_ids()), '{}')))
         or assignee_id = (select my_person_id())
         or ((select my_access()) = 'lead' and in_lead_zone(unit_id, department_id, assignee_id)))
  with check ((select is_superadmin()) or ((select my_access()) = 'moderator' and unit_id = any(coalesce((select my_unit_ids()), '{}')))
              or assignee_id = (select my_person_id()) or review_from = (select my_person_id()) or reviewer_id = (select my_person_id())
              or ((select my_access()) = 'lead' and in_lead_zone(unit_id, department_id, assignee_id)));
