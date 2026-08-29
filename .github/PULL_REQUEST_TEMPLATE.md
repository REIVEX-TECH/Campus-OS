<!-- Keep it short and specific. Delete sections that don't apply. -->

## What

<!-- The change, in one or two sentences. -->

## Why

<!-- The problem this solves or the capability it adds. -->

## How to test

<!-- Exact commands and URLs a reviewer runs to verify. -->

## Migration notes

<!-- Schema changes, migration file names, backwards-compatibility, rollback.
     Write "no schema change" if none. -->

## Screenshots

<!-- Required for any UI change (light + dark, and mobile if relevant). -->

## Breaking changes

<!-- APIs, config, or behaviour that changes for existing consumers. -->

## Checklist

- [ ] Branch is `feat/…`, `fix/…`, `chore/…`, or `docs/…` off `main`
- [ ] Conventional Commit messages, scoped to the package/module
- [ ] `pnpm typecheck lint format:check build test` all green
- [ ] Tests added/updated (a bug fix starts with a failing test)
- [ ] `README` / `docs/` / `.env.example` updated in this PR
- [ ] No secrets, no PII in logs/URLs, no AI attribution
