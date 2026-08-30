# @campusos/config

Shared tooling configuration: the single source of truth for ESLint, Prettier,
and TypeScript across the monorepo. Packages consume these instead of
redefining their own, so a change here propagates everywhere.

## Exports

| Import                                         | What it is                                  |
| ---------------------------------------------- | ------------------------------------------- |
| `@campusos/config/eslint`                      | Flat ESLint config for Node/TS packages     |
| `@campusos/config/eslint/react`                | ESLint config with browser globals (UI/web) |
| `@campusos/config/prettier`                    | Prettier config object                      |
| `@campusos/config/tsconfig/base.json`          | Base TS compiler options (strict)           |
| `@campusos/config/tsconfig/react-library.json` | Base for React libraries (`packages/ui`)    |
| `@campusos/config/tsconfig/nextjs.json`        | Base for the Next.js app (`apps/web`)       |

## Usage

`eslint.config.mjs`:

```js
import base from '@campusos/config/eslint';
export default [...base];
```

`tsconfig.json`:

```json
{ "extends": "@campusos/config/tsconfig/base.json" }
```

`prettier.config.mjs`:

```js
export { default } from '@campusos/config/prettier';
```

Weak-copyleft build/dev tooling (e.g. Turborepo, MPL-2.0) is permitted because
it is not distributed with the product; runtime dependencies remain
MIT/Apache/BSD/ISC only.
