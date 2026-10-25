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

-- Корзина юнитов: когда юнит отправили в архив (для автоудаления)
alter table units add column if not exists archived_at text not null default '';

-- Общие настройки приложения (ключ → значение)
create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at text not null default ''
);

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
  ('lf_drive', 'Google Drive', 'drive', 3), ('lf_meta', 'Metadata', 'meta', 4)
on conflict (id) do nothing;

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

-- Уведомления человеку (пока одно: «на вас назначили задачу»). Пишет только триггер; читает и отмечает — сам человек.
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
      when 'd_qa' then 't_qa' when 'd_release' then 't_release' else 't_other' end);
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

-- Однократно: общий «Приоритет» на все юниты; старые приоритеты юнитов сливаются в него.
do $$
declare
  g text := 'f_priority';
  opts jsonb := '[{"id":"o_low","name":"Low","color":"#64748b"},{"id":"o_medium","name":"Medium","color":"#f59e0b"},{"id":"o_high","name":"High","color":"#ef4444"},{"id":"o_critical","name":"Critical","color":"#b91c1c"}]';
begin
  if not exists (select 1 from fields where unit_id is null and role = 'priority') then
    perform set_config('app.system', 'on', true);
    insert into fields (id, unit_id, name, type, options, show_on_card, required, ord, archived, staff_only, role)
    values (g, null, 'Приоритет', 'select', opts, true, false, 0, false, true, 'priority')
    on conflict (id) do nothing;
    -- значения старых приоритетов юнитов → общий: по названию варианта, иначе по тому же id
    update tasks t set fields = (t.fields - f.id) || jsonb_strip_nulls(jsonb_build_object(g, coalesce(
        (select n ->> 'id' from jsonb_array_elements(opts) n
          where lower(n ->> 'name') = lower((select o ->> 'name' from jsonb_array_elements(f.options) o where o ->> 'id' = t.fields ->> f.id))),
        (select n ->> 'id' from jsonb_array_elements(opts) n where n ->> 'id' = t.fields ->> f.id))))
      from fields f
     where f.unit_id = t.unit_id and f.role = 'priority' and t.fields ? f.id;
    delete from fields where unit_id is not null and role = 'priority';
    perform set_config('app.system', 'off', true);
  end if;
end $$;

-- ---------- проверки на уровне строк ----------

create or replace function guard_tasks() returns trigger language plpgsql set search_path = public as $$
declare missing text;
begin
  if app_system() then return new; end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(my_person_id(), '');
    select string_agg(f.name, ', ' order by f.ord) into missing from fields f
     where (f.unit_id = new.unit_id or f.unit_id is null) and f.required_on_create and not f.archived
       and coalesce(new.fields -> f.id, 'null'::jsonb) in ('null'::jsonb, '""'::jsonb, '[]'::jsonb, 'false'::jsonb);
    if missing is not null then
      raise exception 'Заполните при создании: %', missing using errcode = 'P0001';
    end if;
    return new;
  end if;
  if not is_staff() then
    if new.title is distinct from old.title or new.assignee_id is distinct from old.assignee_id
       or new.due_date is distinct from old.due_date or new.unit_id is distinct from old.unit_id
       or new.department_id is distinct from old.department_id or new.archived is distinct from old.archived
       or new.num is distinct from old.num or new.created_by is distinct from old.created_by
       or new.team_id is distinct from old.team_id then
      raise exception 'Недостаточно прав: участник меняет только статус, описание, поля и чеклист своей задачи' using errcode = '42501';
    end if;
    select string_agg(f.name, ', ') into missing from fields f
     where (f.unit_id = new.unit_id or f.unit_id is null) and f.staff_only and (new.fields -> f.id) is distinct from (old.fields -> f.id);
    if missing is not null then
      raise exception 'Недостаточно прав: «%» меняют только администратор и модератор', missing using errcode = '42501';
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
                  and array_position(array['todo', 'progress', 'done'], (select kind from cols where id = new.status))
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
  select settings -> 'review' into rv from units where id = new.unit_id;
  col := coalesce(rv ->> 'column', '');
  if col = '' then return new; end if;
  if new.status = col then
    who := coalesce(nullif(rv -> 'byPosition' ->> new.department_id, ''), rv ->> 'default', '');
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
create or replace function notify_assignee() returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor text := coalesce(my_person_id(), '');
  v_old text := case when tg_op = 'UPDATE' then old.assignee_id else '' end;
  v_kind text := 'assigned';
begin
  if new.assignee_id is not distinct from v_old then return new; end if;
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

-- Сроки своих задач: просрочено (kind 'overdue') и срок сегодня/завтра ('due_soon'). Зовёт приложение вошедшего
-- (пульс и загрузка уведомлений) с его сегодняшней датой — без крона. На каждый срок — одно уведомление.
create or replace function scan_due(p_today text) returns void language plpgsql security definer set search_path = public as $$
declare
  v_me text := my_person_id();
  v_at text := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_tomorrow text;
begin
  if v_me is null or p_today !~ '^\d{4}-\d{2}-\d{2}$' then return; end if;
  v_tomorrow := to_char(p_today::date + 1, 'YYYY-MM-DD');
  with due as (
    select t.id, t.due_date, case when t.due_date < p_today then 'overdue' else 'due_soon' end as kind
      from tasks t join units u on u.id = t.unit_id
     where t.assignee_id = v_me and not t.archived and not u.archived and t.due_date <> '' and t.due_date <= v_tomorrow
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
      raise exception 'Роль модератора или супер-админа назначает только супер-админ' using errcode = '42501';
    end if;
    new.user_id := null;  -- привязку к аккаунту делает только система
    return new;
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'Привязку к аккаунту меняет только система' using errcode = '42501';
  end if;
  if new.access is distinct from old.access and not is_superadmin() then
    raise exception 'Роли меняет только супер-админ' using errcode = '42501';
  end if;
  if not is_staff() and (new.email is distinct from old.email or new.position_id is distinct from old.position_id
                         or new.extra_positions is distinct from old.extra_positions or new.team_ids is distinct from old.team_ids
                         or new.active is distinct from old.active) then
    raise exception 'Email, позицию и доступ меняет администратор' using errcode = '42501';
  end if;
  if old.access = 'superadmin' and not is_superadmin() then
    raise exception 'Профиль супер-админа меняет только супер-админ' using errcode = '42501';
  end if;
  if old.access = 'superadmin' and old.active and (new.access <> 'superadmin' or not new.active)
     and not exists (select 1 from people where access = 'superadmin' and active and id <> old.id) then
    raise exception 'Нельзя убрать последнего супер-админа' using errcode = 'P0001';
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
  if not app_system() and not is_staff() then raise exception 'Недостаточно прав' using errcode = '42501'; end if;
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
  if not app_system() and not is_staff() then return 0; end if;
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
  if not app_system() and not is_superadmin() then raise exception 'Удалять людей может только супер-админ' using errcode = '42501'; end if;
  select * into v from people where id = p_person;
  if v.id is null then raise exception 'Человек не найден' using errcode = 'P0001'; end if;
  if v.id = my_person_id() then raise exception 'Нельзя удалить самого себя' using errcode = 'P0001'; end if;
  if v.access = 'superadmin' and v.active
     and not exists (select 1 from people where access = 'superadmin' and active and id <> v.id) then
    raise exception 'Нельзя удалить последнего супер-админа' using errcode = 'P0001';
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
  if not app_system() and not is_staff() then raise exception 'Недостаточно прав' using errcode = '42501'; end if;
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

-- ---------- правила доступа (RLS) ----------
-- Без входа — ничего. Регистрация закрыта в Supabase Auth; людей добавляет администратор.

do $$
declare t text;
begin
  foreach t in array array['teams', 'units', 'fields', 'people', 'departments', 'unit_members', 'tasks', 'comments', 'activity', 'link_fields', 'task_links', 'notifications', 'task_templates'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists team_all on %I', t);
  end loop;
end $$;

alter table app_settings enable row level security;
drop policy if exists settings_read on app_settings;
create policy settings_read on app_settings for select to authenticated using (true);
drop policy if exists settings_write on app_settings;
create policy settings_write on app_settings for all to authenticated using (is_superadmin()) with check (is_superadmin());

-- Юниты, поля, состав: видят администраторы и участники юнита; меняют администраторы.
drop policy if exists units_read on units;
create policy units_read on units for select to authenticated using (is_staff() or is_unit_member(id));
drop policy if exists units_write on units;
create policy units_write on units for all to authenticated using (is_staff()) with check (is_staff());

drop policy if exists fields_read on fields;
create policy fields_read on fields for select to authenticated using (is_staff() or unit_id is null or is_unit_member(unit_id));
drop policy if exists fields_write on fields;
create policy fields_write on fields for all to authenticated using (is_staff()) with check (is_staff());

drop policy if exists members_read on unit_members;
create policy members_read on unit_members for select to authenticated using (is_staff() or is_unit_member(unit_id));
drop policy if exists members_write on unit_members;
create policy members_write on unit_members for all to authenticated using (is_staff()) with check (is_staff());

-- Позиции и люди видны всем вошедшим (имена исполнителей, авторов); меняют администраторы, свой профиль — сам человек.
drop policy if exists departments_read on departments;
create policy departments_read on departments for select to authenticated using (true);
drop policy if exists departments_write on departments;
create policy departments_write on departments for all to authenticated using (is_staff()) with check (is_staff());

drop policy if exists people_read on people;
create policy people_read on people for select to authenticated using (true);
drop policy if exists people_insert on people;
create policy people_insert on people for insert to authenticated with check (is_staff());
drop policy if exists people_update on people;
create policy people_update on people for update to authenticated
  using (is_staff() or user_id = auth.uid()) with check (is_staff() or user_id = auth.uid());

-- Задачи: администраторы — все; участник — задачи своей позиции в своих юнитах и свои задачи.
drop policy if exists tasks_read on tasks;
create policy tasks_read on tasks for select to authenticated using (
  is_staff() or assignee_id = my_person_id() or review_from = my_person_id() or reviewer_id = my_person_id()
  or (is_unit_member(unit_id) and ((department_id <> '' and department_id = any(my_positions()))
                                     or (team_id <> '' and team_id = any(my_teams())))));
drop policy if exists tasks_insert on tasks;
create policy tasks_insert on tasks for insert to authenticated with check (is_staff());
drop policy if exists tasks_delete on tasks;
create policy tasks_delete on tasks for delete to authenticated using (is_staff());
drop policy if exists tasks_update on tasks;
-- После переноса в ревью/из ревью исполнитель меняется триггером — строка остаётся «своей» через review_from / reviewer_id
create policy tasks_update on tasks for update to authenticated
  using (is_staff() or assignee_id = my_person_id())
  with check (is_staff() or assignee_id = my_person_id() or review_from = my_person_id() or reviewer_id = my_person_id());

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
  using (can_see_link(field_id) and exists (select 1 from tasks t where t.id = task_id and (is_staff() or t.assignee_id = my_person_id())))
  with check (can_see_link(field_id) and exists (select 1 from tasks t where t.id = task_id and t.unit_id = task_links.unit_id
    and (is_staff() or t.assignee_id = my_person_id())));

-- Команды: видят все, ведут администраторы и модераторы (как позиции).
drop policy if exists teams_read on teams;
create policy teams_read on teams for select to authenticated using (true);
drop policy if exists teams_write on teams;
create policy teams_write on teams for all to authenticated using (is_staff()) with check (is_staff());

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

-- Уведомления: только свои; создаёт их триггер.
drop policy if exists notifications_own on notifications;
create policy notifications_own on notifications for select to authenticated using (person_id = my_person_id());
drop policy if exists notifications_read on notifications;
create policy notifications_read on notifications for update to authenticated
  using (person_id = my_person_id()) with check (person_id = my_person_id());

-- Комментарии: видны вместе с задачей; писать — администраторы и исполнитель; править/удалять — автор или администратор.
drop policy if exists comments_read on comments;
create policy comments_read on comments for select to authenticated using (exists (select 1 from tasks t where t.id = task_id));
drop policy if exists comments_insert on comments;
create policy comments_insert on comments for insert to authenticated
  with check (exists (select 1 from tasks t where t.id = task_id and (is_staff() or t.assignee_id = my_person_id())));
drop policy if exists comments_change on comments;
create policy comments_change on comments for update to authenticated
  using (is_staff() or author_id = my_person_id()) with check (is_staff() or author_id = my_person_id());
drop policy if exists comments_delete on comments;
create policy comments_delete on comments for delete to authenticated using (is_staff() or author_id = my_person_id());

-- История: только чтение и добавление; удаляется только вместе с юнитом.
drop policy if exists activity_read on activity;
create policy activity_read on activity for select to authenticated
  using (is_staff() or exists (select 1 from tasks t where t.id = task_id));
drop policy if exists activity_insert on activity;
create policy activity_insert on activity for insert to authenticated with check (true);

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
