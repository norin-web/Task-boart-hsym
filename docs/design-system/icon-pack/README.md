# Пак иконок и лого Tasks DS

- `icons/` — 54 иконки Unicons Line (IconScout, @iconscout/unicons 4.2.0). Имена файлов совпадают с именами в `ICONS` из `web/src/ui.js`. Сетка 24, заливка `currentColor`.
- `logos/color`, `logos/mono` — логотипы сервисов с thesvg.org.
- Лицензия Unicons: IconScout Simple License, коммерческое использование можно, атрибуция не обязательна, перепродавать и выкладывать как отдельный набор нельзя.
- Логотипы остаются знаками правообладателей: только чтобы обозначить сервис.
- На thesvg нет: testflight, appsflyer; нет mono: slack, amplitude.
- `amplitude.svg` — вордмарк, `amplitude-mark.svg` — только знак (обрезан viewBox). `color/apple.svg` — чёрный знак; для тёмной темы задать ему белую заливку.
- Файлы `mono` без явной заливки: в тёмной теме задавать `fill` через CSS.
- `progress.svg` перерисован вручную: круг с заполненной половиной, вариант Unicons нечитаем на 14 px. Статус «Реджект» — `rejected.svg`.
