# Tasks

Простой таск-трекер — упрощённая Jira. Верхний уровень — **юниты**: это кросс-функциональные команды (внутри работают ASO, Design, iOS и т.д.), у каждой своя доска, задачи и набор полей.

Хостинг — **GitHub Pages**, данные — **Supabase** (Postgres + вход по email). Сервер не нужен.

**Возможности**

- Юниты-команды: состав с отделом каждого участника (человек может быть в нескольких командах), настройка, дублирование, архив
- Общий справочник отделов; отдел у задачи подставляется из состава команды при назначении исполнителя
- Доска со своими колонками в каждом юните (добавить, переименовать, цвет, тип «не начато / в работе / готово», порядок, удаление с переносом задач), колонки тянутся на всю ширину
- Дорожки по отделам на доске, вид «Список» с сортировкой, drag & drop
- Задачи: номер вида `DEV-12`, исполнитель, срок, описание, чеклист, комментарии, история изменений
- Настраиваемая карточка: 9 типов полей, обязательные поля, показ на карточке
- Фильтры: поиск, исполнители, отделы, значения полей, просроченные, архив
- Главная со статистикой и лентой событий, «Мои задачи» по всем юнитам
- Глобальный поиск `⌘K`, горячие клавиши (`C` — новая задача, `/` — поиск, `?` — подсказка)
- Вход по ссылке на email, светлая/тёмная тема, мобильная вёрстка

## Запуск в продакшене: Supabase + GitHub Pages

### 1. Supabase (≈5 минут, бесплатный тариф подходит)

1. Создайте проект на [supabase.com](https://supabase.com).
2. **SQL Editor → New query**: вставьте содержимое [`supabase/schema.sql`](supabase/schema.sql) и нажмите **Run**. Скрипт создаёт таблицы, функции и правила доступа; его можно запускать повторно.
3. **Authentication → Sign In / Providers → Email**: оставьте Email включённым. В настройках Auth выключите **Allow new users to sign up** — в команду попадают только приглашённые.
4. **Authentication → URL Configuration**: в **Site URL** и **Redirect URLs** укажите адрес сайта, например `https://norin-web.github.io/Task-boart-hsym/` (и `http://localhost:5177/` для разработки).
5. **Authentication → Users → Invite user** — пригласите себя и коллег по email.
6. **Project Settings → API**: скопируйте **Project URL** и ключ **anon public**.

> Ключ `anon` публичный по замыслу Supabase — его можно класть во фронт. Доступ к данным закрыт правилами RLS: читать и писать могут только вошедшие пользователи.

### 2. GitHub Pages

1. **Settings → Secrets and variables → Actions → Variables** → добавьте:
   - `VITE_SUPABASE_URL` — Project URL
   - `VITE_SUPABASE_ANON_KEY` — ключ anon public
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**. Готовые шаблоны выбирать не нужно — workflow уже в репозитории: [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).
3. Сделайте push в `main` (или **Actions → Deploy to GitHub Pages → Run workflow**). Через минуту сайт появится по адресу из настроек Pages.

При первом входе приложение предложит создать профиль (или выбрать себя, если вас уже добавили в «Люди» без email).

## Локальная разработка

```bash
npm install
cp .env.example .env.local   # вписать ключи Supabase — или пропустить
npm run dev                  # http://localhost:5177
```

**Без ключей** приложение работает в **локальном режиме**: та же схема Postgres (PGlite, WebAssembly) крутится прямо в браузере, данные хранятся только в этом браузере. Удобно для разработки и демо; в интерфейсе видна плашка «Локальный режим».

| Команда | Что делает |
|---|---|
| `npm run dev` | Vite с HMR |
| `npm run build` | Сборка в `dist/` |
| `npm run preview` | Просмотр собранной версии |
| `npm test` | Тесты бизнес-логики на настоящем Postgres (PGlite) с `supabase/schema.sql` |

## Устройство

```
supabase/schema.sql      таблицы, SQL-функции (номера задач, удаления), RLS
web/
  index.html
  src/
    main.js              старт, вход, горячие клавиши
    data.js              выбор хранилища: Supabase или локальный PGlite
    backend.js           вся бизнес-логика (методы API) поверх supabase-js
    pglite-client.js     совместимый с supabase-js клиент над PGlite (локальный режим, тесты)
    api.js               вызов методов с очередью записей
    router.js            маршруты в hash: #/, #/my, #/u/:unit[/list|/settings][?task=:id]
    state.js, ui.js      состояние, хелперы, DOM, модалки, меню
    views/               sidebar, home, my, board, task, settings, units, people, palette
    styles.css
test/backend.test.js
.github/workflows/deploy.yml
```

Изменение схемы — дописать в `supabase/schema.sql` идемпотентные команды (`create … if not exists`, `alter table … add column if not exists`) и выполнить их в SQL Editor.

## Дальше

- Обновления в реальном времени (Supabase Realtime): изменения коллег без перезагрузки
- Telegram-бот: уведомления о назначении и комментариях (журнал `activity` и `people.telegram_chat_id` уже есть)
- Экспорт в CSV, вложения
