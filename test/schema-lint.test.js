// Проверки schema.sql на то, что локальная PGlite пропускает, а Supabase — нет.
// safeupdate: в Supabase UPDATE и DELETE без WHERE падают («DELETE requires a WHERE clause»).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SQL = fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');

/** Операторы без комментариев и строк-литералов (чтобы «;» и слова внутри строк не мешали). */
function statements(sql) {
  const clean = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''");
  return clean.split(';').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

test('schema.sql: нет UPDATE и DELETE без WHERE (в Supabase их запрещает safeupdate)', () => {
  const bad = [];
  for (const st of statements(SQL)) {
    for (const m of st.matchAll(/\b(delete\s+from|update)\s+[a-z_."]+/gi)) {
      const rest = st.slice(m.index);
      const before = st.slice(Math.max(0, m.index - 14), m.index).toLowerCase();
      if (/^update/i.test(m[0])) {
        if (/(on|for|before|after|or|of)\s*$/.test(before)) continue; // триггеры: «after update», «for update»
        if (!/^update\s+[a-z_."]+(\s+(as\s+)?[a-z_]+)?\s+set\b/i.test(rest)) continue; // не оператор UPDATE
      }
      if (!/\bwhere\b/i.test(rest)) bad.push(rest.slice(0, 140));
    }
  }
  assert.deepEqual(bad, [], 'Добавьте WHERE (если нужно «все строки» — where true):\n' + bad.join('\n'));
});

test('schema.sql: не создаёт временных таблиц в функциях (в Supabase это ломается на повторных вызовах и пулере)', () => {
  assert.ok(!/create\s+temp(orary)?\s+table/i.test(SQL.replace(/--[^\n]*/g, '')), 'Используйте массивы или CTE вместо временных таблиц');
});
