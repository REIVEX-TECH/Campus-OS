import react from '@campusos/config/eslint/react';

export default [
  { ignores: ['.next/**', 'next-env.d.ts'] },
  ...react,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // Hard rule 1 (docs/design.md): no dash punctuation in UI copy. Catch em
      // and en dashes and the spaced-hyphen connector in JSX text nodes (real
      // JSXText, so no false positives on arithmetic). The messages/*.ts catalog
      // is additionally covered by test/no-dash.test.ts.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXText[value=/[\\u2013\\u2014]/]',
          message: 'No em or en dash in UI copy. Use words or restructure (see docs/design.md).',
        },
        {
          selector: 'JSXText[value=/ - /]',
          message: 'No spaced hyphen connector in UI copy. Use a comma or the word "to".',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@campusos/db/client',
              message:
                'Do not import the raw db client in app code. Use a repository from @campusos/db — it sets the tenant context so RLS applies.',
            },
            {
              name: '@campusos/adapter-timetable-lgu',
              message:
                'The app must not import data-source adapters. Adapters are ingestion-only; the UI reads @campusos/db and @campusos/module-timetable.',
            },
          ],
          patterns: [
            {
              group: [
                '@campusos/db/client',
                '**/packages/db/src/client',
                '**/packages/db/src/client.*',
              ],
              message:
                'The raw db client is off-limits in app code. Use a repository from @campusos/db.',
            },
            {
              group: ['@campusos/adapter-*', '**/packages/adapters/**'],
              message:
                'The app must not import data-source adapters (ingestion-only). Use @campusos/module-timetable.',
            },
          ],
        },
      ],
    },
  },
];
