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
do $$ begin
  alter table people add constraint people_access_check check (access in ('superadmin', 'moderator', 'member'));
exception when duplicate_object then null; end $$;
create unique index if not exists people_user_id on people(user_id) where user_id is not null;

-- Позиции = справочник departments (ASO, Design, iOS…) + недостающие
insert into departments (id, name, color, ord) values
  ('d_qa', 'Тестировщик', '#14b8a6', 5), ('d_release', 'Релиз-менеджер', '#8b5cf6', 6)
on conflict (id) do nothing;

-- Позиция по умолчанию — первый «отдел в команде» человека (однократно, если позиции ещё нет)
update people p set position_id = m.department_id
  from (select distinct on (person_id) person_id, department_id from unit_members
        where department_id <> '' order by person_id, created_at) m
 where p.id = m.person_id and p.position_id = '';

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

-- ---------- проверки на уровне строк ----------

create or replace function guard_tasks() returns trigger language plpgsql set search_path = public as $$
declare missing text;
begin
  if app_system() then return new; end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(my_person_id(), '');
    return new;
  end if;
  if not is_staff() then
    if new.title is distinct from old.title or new.assignee_id is distinct from old.assignee_id
       or new.due_date is distinct from old.due_date or new.unit_id is distinct from old.unit_id
       or new.department_id is distinct from old.department_id or new.archived is distinct from old.archived
       or new.num is distinct from old.num or new.created_by is distinct from old.created_by then
      raise exception 'Недостаточно прав: участник меняет только статус, описание, поля и чеклист своей задачи' using errcode = '42501';
    end if;
    if new.status is distinct from old.status then
      select string_agg(f.name, ', ' order by f.ord) into missing from fields f
       where f.unit_id = new.unit_id and f.required and not f.archived
         and coalesce(new.fields -> f.id, 'null'::jsonb) in ('null'::jsonb, '""'::jsonb, '[]'::jsonb, 'false'::jsonb);
      if missing is not null then
        raise exception 'Сначала заполните обязательные поля: %', missing using errcode = 'P0001';
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_tasks on tasks;
create trigger guard_tasks before insert or update on tasks for each row execute function guard_tasks();

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

-- Удалить поле навсегда вместе с его значениями в задачах.
create or replace function delete_field(p_field text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app_system() and not is_staff() then raise exception 'Недостаточно прав' using errcode = '42501'; end if;
  perform set_config('app.system', 'on', true);
  update tasks set fields = fields - p_field
   where unit_id = (select unit_id from fields where id = p_field) and fields ? p_field;
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
  update people set position_id = '' where position_id = p_dept;
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
  foreach t in array array['units', 'fields', 'people', 'departments', 'unit_members', 'tasks', 'comments', 'activity'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists team_all on %I', t);
  end loop;
end $$;

-- Юниты, поля, состав: видят администраторы и участники юнита; меняют администраторы.
drop policy if exists units_read on units;
create policy units_read on units for select to authenticated using (is_staff() or is_unit_member(id));
drop policy if exists units_write on units;
create policy units_write on units for all to authenticated using (is_staff()) with check (is_staff());

drop policy if exists fields_read on fields;
create policy fields_read on fields for select to authenticated using (is_staff() or is_unit_member(unit_id));
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
  is_staff() or assignee_id = my_person_id()
  or (is_unit_member(unit_id) and department_id <> '' and department_id = my_position()));
drop policy if exists tasks_insert on tasks;
create policy tasks_insert on tasks for insert to authenticated with check (is_staff());
drop policy if exists tasks_delete on tasks;
create policy tasks_delete on tasks for delete to authenticated using (is_staff());
drop policy if exists tasks_update on tasks;
create policy tasks_update on tasks for update to authenticated
  using (is_staff() or assignee_id = my_person_id()) with check (is_staff() or assignee_id = my_person_id());

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
