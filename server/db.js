import { DatabaseSync } from 'node:sqlite';

/**
 * Миграции применяются по порядку; номер последней хранится в PRAGMA user_version.
 * Новую миграцию добавлять в конец массива, старые не менять.
 */
const MIGRATIONS = [
  `
  CREATE TABLE units (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    key         TEXT NOT NULL UNIQUE,
    color       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    settings    TEXT NOT NULL DEFAULT '{}',
    next_num    INTEGER NOT NULL DEFAULT 1,
    ord         REAL NOT NULL DEFAULT 0,
    archived    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE fields (
    id           TEXT PRIMARY KEY,
    unit_id      TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    type         TEXT NOT NULL,
    options      TEXT NOT NULL DEFAULT '[]',
    show_on_card INTEGER NOT NULL DEFAULT 0,
    required     INTEGER NOT NULL DEFAULT 0,
    ord          REAL NOT NULL DEFAULT 0,
    archived     INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX fields_unit ON fields(unit_id);

  CREATE TABLE people (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    email            TEXT NOT NULL DEFAULT '',
    telegram_chat_id TEXT NOT NULL DEFAULT '',
    active           INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT NOT NULL
  );

  CREATE TABLE tasks (
    id          TEXT PRIMARY KEY,
    unit_id     TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    num         INTEGER NOT NULL,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL,
    assignee_id TEXT NOT NULL DEFAULT '',
    due_date    TEXT NOT NULL DEFAULT '',
    ord         REAL NOT NULL DEFAULT 0,
    fields      TEXT NOT NULL DEFAULT '{}',
    checklist   TEXT NOT NULL DEFAULT '[]',
    archived    INTEGER NOT NULL DEFAULT 0,
    done_at     TEXT NOT NULL DEFAULT '',
    created_by  TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  CREATE INDEX tasks_unit ON tasks(unit_id);
  CREATE INDEX tasks_assignee ON tasks(assignee_id);

  CREATE TABLE comments (
    id        TEXT PRIMARY KEY,
    task_id   TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    text      TEXT NOT NULL,
    author_id TEXT NOT NULL DEFAULT '',
    at        TEXT NOT NULL,
    edited_at TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX comments_task ON comments(task_id);

  -- Журнал не ссылается на задачи внешним ключом: запись об удалении должна пережить задачу.
  CREATE TABLE activity (
    id       TEXT PRIMARY KEY,
    unit_id  TEXT NOT NULL DEFAULT '',
    task_id  TEXT NOT NULL DEFAULT '',
    action   TEXT NOT NULL,
    field    TEXT NOT NULL DEFAULT '',
    from_val TEXT NOT NULL DEFAULT '',
    to_val   TEXT NOT NULL DEFAULT '',
    actor_id TEXT NOT NULL DEFAULT '',
    at       TEXT NOT NULL
  );
  CREATE INDEX activity_task ON activity(task_id);
  CREATE INDEX activity_at ON activity(at);
  `,
  // 2: профиль — должность и цвет аватара
  `
  ALTER TABLE people ADD COLUMN role TEXT NOT NULL DEFAULT '';
  ALTER TABLE people ADD COLUMN color TEXT NOT NULL DEFAULT '';
  `,
  // 3: юнит = команда. Общий справочник отделов, состав юнитов, отдел у задачи
  `
  CREATE TABLE departments (
    id       TEXT PRIMARY KEY,
    name     TEXT NOT NULL,
    color    TEXT NOT NULL,
    ord      REAL NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO departments (id, name, color, ord) VALUES
    ('d_aso', 'ASO', '#f59e0b', 1), ('d_design', 'Design', '#ec4899', 2),
    ('d_ios', 'iOS', '#6366f1', 3), ('d_other', 'Other', '#64748b', 4);

  CREATE TABLE unit_members (
    unit_id       TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    person_id     TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    department_id TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (unit_id, person_id)
  );
  CREATE INDEX unit_members_person ON unit_members(person_id);

  ALTER TABLE tasks ADD COLUMN department_id TEXT NOT NULL DEFAULT '';
  `,
];

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}
