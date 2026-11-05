# Бэкап базы

Каждый день в 06:00 (МСК) GitHub Actions выгружает базу Supabase, шифрует и хранит 30 дней:
**GitHub → репозиторий → Actions → «Бэкап базы» → нужный запуск → Artifacts**.
Что внутри: схема `public` целиком (таблицы, функции, права, все данные Tasks) и учётки входа (`auth.users`, `auth.identities`).
Бэкап зашифрован (AES-256): без пароля `BACKUP_PASSPHRASE` его не открыть — даже если кто-то скачает файл.

## Настройка (один раз, ~5 минут)

1. **Строка подключения к базе.** Supabase → проект → кнопка **Connect** (вверху) → **Session pooler** → скопировать URI вида
   `postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-…pooler.supabase.com:5432/postgres` и вставить вместо `[YOUR-PASSWORD]` пароль базы.
   Пароль базы забыт — **Project Settings → Database → Reset database password** (сайт это не сломает: он ходит в базу по ключу, не по паролю).
2. **Пароль шифрования** — придумать длинный (20+ символов) и сохранить в менеджере паролей. Без него бэкап не открыть.
3. GitHub → репозиторий → **Settings → Secrets and variables → Actions → New repository secret**:
   - `SUPABASE_DB_URL` — строка из п. 1;
   - `BACKUP_PASSPHRASE` — пароль из п. 2.
4. Проверить: **Actions → «Бэкап базы» → Run workflow**. Через 1–2 минуты — зелёный запуск и файл `tasks-backup-ГГГГ-ММ-ДД` в Artifacts.

Бесплатных минут GitHub Actions (2000 в месяц для приватного репозитория) хватает с запасом: бэкап — около минуты в день.

## Восстановление

Нужны: файл бэкапа, `BACKUP_PASSPHRASE`, строка подключения к базе, куда восстанавливаем, и `pg_restore` 17 (или Docker).

```bash
# 1. Расшифровать и распаковать
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass pass:'ПАРОЛЬ' -in tasks-backup-2026-11-05.tar.gz.enc | tar -xzf - -C ./restore

# 2. Данные Tasks (таблицы, функции, права) — в базу (старые объекты public заменяются)
pg_restore --clean --if-exists --no-owner --no-privileges -d "СТРОКА_ПОДКЛЮЧЕНИЯ" ./restore/public.dump

# 3. Только если восстанавливаете в НОВЫЙ проект Supabase — учётки входа
psql "СТРОКА_ПОДКЛЮЧЕНИЯ" -f ./restore/auth-users.sql
```

Перед восстановлением в рабочую базу — сначала сделайте свежий бэкап (Run workflow), чтобы было куда откатиться.
Восстановить одну таблицу: `pg_restore --data-only --table=tasks …` (подробнее — `pg_restore --help`).
Если что-то из этого непонятно — восстановление делается вместе с разработчиком.
