import globals from 'globals';
import base from './base.js';

/**
 * Flat ESLint config for packages that render React (browser runtime).
 * Extends the base config and adds browser globals.
 */
export default [
  ...base,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
];
