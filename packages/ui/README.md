# @campusos/ui

The Campus OS design system: Tailwind v4 tokens and shadcn/ui components shared
across the app. Consumers import components from here rather than copying them.

- `@campusos/ui` — components and helpers (`Button`, `cn`, …)
- `@campusos/ui/styles/globals.css` — design tokens + base layer (import once,
  after `@import 'tailwindcss'`)

shadcn/ui is initialised here (`components.json`, `new-york` style, neutral base,
CSS variables). Add new components with the shadcn CLI targeting this package, or
by hand following `src/components/button.tsx`.

Colours are CSS variables (`--primary`, `--background`, …) so a tenant's branding
can override them at runtime without rebuilding.
