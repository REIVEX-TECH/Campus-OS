import base from '@campusos/config/eslint';

/** Root ESLint flat config. Package-specific configs live in each package. */
export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/drizzle/**',
    ],
  },
  ...base,
];
