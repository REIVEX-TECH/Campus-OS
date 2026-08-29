# Contributing to Campus OS

Thanks for helping build an open campus platform. This document covers the
mechanics; the architectural rules live in [CLAUDE.md](CLAUDE.md) and apply to
every change (human or AI-authored).

## Ground rules

- **No paid services required.** Any dependency or hosted service must have a
  production-sufficient free tier or a self-hosted equivalent.
- **Licence discipline.** Runtime dependencies must be MIT / Apache-2.0 / BSD /
  ISC. Weak-copyleft (e.g. MPL-2.0) is allowed **only** for build/dev tooling
  that is not distributed with the product. Flag anything else before adding it.
- **Never hardcode a tenant** in shared code. Tenant-specific behaviour lives in
  `tenants/*` config or a tenant adapter package.
- **Never commit secrets.** Document every variable in `.env.example`.

## Workflow

1. Branch off `main`: `feat/…`, `fix/…`, `chore/…`, or `docs/…`. Never commit to
   `main`.
2. Make one logical change per commit. Use
   [Conventional Commits](https://www.conventionalcommits.org/); the scope is the
   module or package name, e.g. `feat(timetable): add ICS feed for sections`.
   Commit messages are linted by commitlint.
3. Keep the gates green (`pnpm typecheck lint format:check build test`). A
   pre-commit hook formats and lints staged files automatically.
4. Every bug fix starts with a failing test.
5. Update `README`, `docs/`, and `.env.example` in the same change as the code.

## Commit sign-off & attribution

This project is presented as human-authored open source. Do not add
`Co-Authored-By` trailers, "Generated with" lines, or any AI-attribution to
commits, PRs, or code comments.

## Pull requests

Fill in the PR template: what, why, how to test, screenshots for UI, migration
notes, and breaking changes. CI must pass before review.

## Reporting security issues

Do **not** open a public issue for vulnerabilities. See [SECURITY.md](SECURITY.md).
