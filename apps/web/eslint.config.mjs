import react from '@campusos/config/eslint/react';

export default [
  { ignores: ['.next/**', 'next-env.d.ts'] },
  ...react,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@campusos/db/client',
              message:
                'Do not import the raw db client in app code. Use a repository from @campusos/db — it sets the tenant context so RLS applies.',
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
          ],
        },
      ],
    },
  },
];
