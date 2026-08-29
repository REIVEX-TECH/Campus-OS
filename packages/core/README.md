# @campusos/core

The domain heart of Campus OS: shared types, interfaces, the module registry,
the `Result` type, tenant config contracts, and the generic ingestion pipeline.

Core depends only on `@campusos/db` (for persistence types) and nothing above
it. It must contain **no tenant-specific logic** — no `if (tenant === 'lgu')`,
ever. Tenant specifics live in `tenants/*` or an adapter.

## What lives here

- `result.ts` — `Result<T, E>`, `ok`/`err`, guards.
- `tenant/` — the zod tenant-config schema, `TenantConfig` type, and the
  registry/resolver (subdomain and `/u/{slug}` resolution).
- `module/` — the `ModuleManifest` type the platform discovers modules through.
- `ingestion/` — the `TimetableSource` adapter interface, the `IngestionSink`
  port, and `runIngestion` (fetch → normalize → persist → record the run).

## Import surface

```ts
import { ok, err, type Result } from '@campusos/core';
import { tenantConfigSchema, resolveByHost } from '@campusos/core/tenant';
import { runIngestion, type TimetableSource } from '@campusos/core/ingestion';
```
