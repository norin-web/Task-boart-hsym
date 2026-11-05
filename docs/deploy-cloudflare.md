# Деплой на Cloudflare Pages

Tasks — статичный сайт (Vite), база и вход — в Supabase. Cloudflare Pages сам собирает сайт из GitHub на каждый push.

Уже подготовлено в репозитории:
- `.node-version` — Node 22 для сборки;
- `web/public/_headers` — кеш: файлы сборки навсегда, `index.html` всегда свежий (обновления доходят сразу); заголовки безопасности.

Код менять не нужно: пути относительные, адреса страниц через `#`.

## 1. Проект в Cloudflare (один раз, ~5 минут)

1. Войти на dash.cloudflare.com (бесплатный аккаунт).
2. **Workers & Pages → Create → Pages → Connect to Git** → выбрать GitHub, дать доступ к репозиторию `norin-web/Task-boart-hsym`.
3. Настройки сборки:
   - Production branch: `main`
   - Framework preset: `None`
   - Build command: `npm test && npm run build` (тесты не прошли — сайт не обновится)
   - Build output directory: `dist`
4. **Environment variables** (Production и Preview) — те же, что в GitHub (Settings → Secrets and variables → Actions → Variables):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. **Save and Deploy**. Через 1–2 минуты сайт будет на `https://<имя-проекта>.pages.dev`.

## 2. Supabase — новый адрес для входа

Supabase → **Authentication → URL Configuration**:
- **Site URL** — новый адрес (`https://<имя-проекта>.pages.dev` или свой домен);
- **Redirect URLs** — добавить его же (и `https://*.<имя-проекта>.pages.dev` для превью-веток).

Без этого вход «Ссылка на почту» будет вести на старый адрес. Вход по паролю работает и так.

## 3. Свой домен (по желанию)

Pages → проект → **Custom domains → Set up a custom domain** → например `tasks.example.com`. Если домен в Cloudflare — запись добавится сама; если нет — Cloudflare покажет CNAME для регистратора. Потом добавить домен в Supabase (шаг 2).

## 4. Закрыть сайт от посторонних (по желанию)

**Zero Trust → Access → Applications → Add → Self-hosted** → домен сайта → правило «Emails ending in @вашдомен» (или список почт). Бесплатно до 50 человек. Тогда до формы входа Tasks доберутся только свои.

## 5. Что с GitHub Pages

Можно оставить параллельно, пока не убедитесь, что Cloudflare работает. Потом отключить: GitHub → Settings → Pages → Unpublish, и удалить `.github/workflows/deploy.yml` (скажите — уберу).

## Как это работает дальше

- push в `main` → Cloudflare собирает и выкатывает прод;
- push в любую другую ветку → превью на отдельной ссылке `https://<ветка>.<имя-проекта>.pages.dev` (удобно показать правку до прода);
  ⚠️ превью работает с той же базой Supabase, что и прод: всё, что там сделать, попадёт в реальные данные. Для экспериментов — режим разработчика и тестовые данные;
- откат: Pages → Deployments → выбрать прошлый деплой → **Rollback** (в один клик, без git).

Порядок выкатки со схемой базы прежний: сначала `schema.sql` в Supabase, потом push.
