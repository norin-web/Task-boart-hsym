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

-- Удалить юнит: задачи, поля, комментарии и состав уходят каскадом, историю чистим отдельно.
create or replace function delete_unit(p_unit text) returns void
language sql as $$
  delete from activity
   where task_id in (select id from tasks where unit_id = p_unit)
      or (unit_id = p_unit and task_id not in (select id from tasks));
  delete from units where id = p_unit;
$$;

-- Удалить поле навсегда вместе с его значениями в задачах.
create or replace function delete_field(p_field text) returns void
language sql as $$
  update tasks set fields = fields - p_field
   where unit_id = (select unit_id from fields where id = p_field) and fields ? p_field;
  delete from fields where id = p_field;
$$;

-- Удалить отдел: задачи и участники остаются, но без отдела.
create or replace function delete_department(p_dept text) returns void
language sql as $$
  update tasks set department_id = '' where department_id = p_dept;
  update unit_members set department_id = '' where department_id = p_dept;
  delete from departments where id = p_dept;
$$;

-- ---------- доступ ----------
-- Работать с данными могут только вошедшие пользователи. Кого пускать — решает Supabase Auth:
-- отключите свободную регистрацию и приглашайте людей (Authentication → Users → Invite).

do $$
declare t text;
begin
  foreach t in array array['units', 'fields', 'people', 'departments', 'unit_members', 'tasks', 'comments', 'activity'] loop
    execute format('alter table %I enable row level security', t);
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'team_all') then
      execute format('create policy team_all on %I for all to authenticated using (true) with check (true)', t);
    end if;
  end loop;
end $$;

revoke execute on function next_task_num(text), comment_counts(text), delete_unit(text), delete_field(text), delete_department(text) from public, anon;
grant execute on function next_task_num(text), comment_counts(text), delete_unit(text), delete_field(text), delete_department(text) to authenticated;
