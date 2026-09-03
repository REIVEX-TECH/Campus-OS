# tenants

Per-tenant configuration: branding, SEO, locale/timezone, allowed email
domains, and which modules are enabled. This becomes a real workspace package
(`@campusos/tenants`) in the multi-tenancy phase; for now it is a placeholder.

Each tenant is a file-based config validated with zod against the schema in
`@campusos/core/tenant`. Unknown/invalid config fails fast at load.

## Slugs are permanent

A tenant's `slug` is its immutable identity: it is the `tenant_id` on every
scoped row and the RLS key. **Never change a slug** — doing so would orphan all
of that tenant's data and require a data migration. Display names and every
other field are mutable; the slug is not.

## Files and the database

Since platform admin Phase 4 the database is the source of truth: a
`tenant_configs` row holds the same validated shape as a file here, and per slug
a valid row wins. A file is the fallback for a tenant with no row yet, and what a
fresh checkout runs on with no database. New universities are created in the
platform admin (`/admin` on the platform host) and need no file at all;
`pnpm tenants:sync` copies the files that do exist into the database
(`docs/runbooks/tenant-config-to-db.md`).
