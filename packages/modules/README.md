# packages/modules

Container for feature modules. **One package per module**, e.g.
`packages/modules/timetable` (`@campusos/module-timetable`).

Each module is self-contained and default-exports a manifest
(`{ id, version, routes, navigation, permissions, settingsSchema, migrations,
jobs, apiRoutes, eventHandlers }`). Core discovers and mounts modules from the
registry; a tenant enables modules in its config. A disabled module contributes
zero routes, zero nav items, and zero queries.

Rules:

- Modules depend on `@campusos/core` (and `@campusos/db` for persistence) —
  never on each other. Cross-module needs are a signal that something belongs in
  core.
- Modules own their schema and migrations; those migrations run **after** the
  base `@campusos/db` migrations (see `pnpm db:migrate:all`).
