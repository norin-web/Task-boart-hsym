// Проверка кода: npm run lint. Ловит главное — необъявленные переменные (сломанные импорты) и лишний код.
import globals from 'globals';

export default [
  { ignores: ['dist/', 'web/dist/', 'node_modules/', 'design-report/', 'scenario-report/'] },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser, ...globals.node } },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
    },
  },
  {
    // Edge Function Supabase работает в Deno
    files: ['supabase/functions/**'],
    languageOptions: { globals: { Deno: 'readonly' } },
  },
];
