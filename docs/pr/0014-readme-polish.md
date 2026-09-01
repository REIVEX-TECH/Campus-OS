# docs(readme): explain CampusOS, the live site, and the architecture

Targets `main`. Docs only, no code, no schema change.

## What

Polish the public `README.md` so a first-time reader understands the project:

- **What it is**: an open-source, multi-tenant campus platform, built so a third
  party can add a university or a module without editing core.
- **Live**: `campusos.reivex.io` is the platform home; LGU is the first tenant at
  `lgu.campusos.reivex.io`; the first module is Timetable.
- **Architecture in brief**: Next.js App Router; single Postgres with a shared
  schema and forced Row-Level Security as the isolation boundary; tenants on
  wildcard subdomains resolved in middleware (with a `/u/{slug}` dev fallback);
  autonomous timetable ingestion (anonymous session, polite crawl, `valid_from`
  and `valid_to` versioning); the shared design system.
- **Run locally**: kept the concise setup and pointed deployment at the existing
  runbooks (`docs/DEPLOY-VPS.md`, `docs/DEPLOY.md`) rather than duplicating them.
- **Contribute**: branch conventions, Conventional Commits, green gates, and the
  house copy rules.

Also removed every em dash from the README to match the house no-dash style.

## Data & migration impact

None.

## Tests

None (docs only). `prettier --check README.md` passes; the README contains no em
or en dash and no spaced-hyphen connector.

## Verification steps

Read `README.md`; follow the links (`docs/DEPLOY-VPS.md`, `docs/DEPLOY.md`,
`docs/design.md`, `CONTRIBUTING.md`, `LICENSE`, `NOTICES.md`) all resolve.

## Follow-ups

None.
