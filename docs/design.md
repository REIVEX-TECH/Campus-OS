# Campus OS design language

The visual law for every screen. Tokens and components live in `packages/ui`;
this document is the source of intent. Read it before building UI.

## Principles

1. **Minimalist, flat base.** Flat backgrounds, generous whitespace, a tight
   type scale, one accent colour pulled from the tenant's branding config.
   Content first, calm, fast. The reference sensibility is Astro docs: clean,
   quiet, legible.
2. **Neumorphism only on interactive surfaces.** Pressable and tappable elements
   (buttons, selectable picker cards, the ICS subscribe control, form inputs)
   get a subtle soft elevation: gently raised at rest, pressed in on
   `:active`. This is an interaction affordance that says "this is pressable",
   not a page skin.
3. **Static content stays flat and high contrast.** The timetable grid, all
   badges (Unverified, TBA), and any text a low vision student must read are
   flat with strong contrast. Neumorphism never reduces the contrast of readable
   content (see "How neumorphism stays AA" below).
4. **Works in light and dark.** Both palettes are defined; the neumorphic shadow
   pairs differ per mode. Dark mode is live via the system preference.

## Tokens

All tokens are CSS custom properties in `packages/ui/src/styles/globals.css`,
mapped to Tailwind utilities through `@theme inline`. Tailwind v4, CSS first
(there is no `tailwind.config`).

| Token                                        | Role                                        |
| -------------------------------------------- | ------------------------------------------- |
| `--background` / `--foreground`              | Flat page and its primary text              |
| `--muted-foreground`                         | Secondary text (captions, hints)            |
| `--primary` / `--primary-foreground`         | The tenant accent and its readable text     |
| `--surface` / `--surface-foreground`         | Neumorphic interactive surface and its text |
| `--warning` / `--warning-foreground`         | The Unverified / pending badge              |
| `--destructive` / `--destructive-foreground` | Errors and destructive actions              |
| `--shadow-raised` / `--shadow-pressed`       | The neumorphic elevation pair (per mode)    |
| `--radius`, `--radius-{sm,md,lg,xl}`         | Corner rounding scale                       |

### The tenant accent is live

The accent is not a fixed brand colour: it is `tenant.branding.colors.primary`
from the tenant config, injected server side as `--primary` on the tenant layout
wrapper (`apps/web/lib/branding.ts` + `app/u/[slug]/layout.tsx`). This happens
during the server render, so there is no flash of the default. The readable
`--primary-foreground` (near black or white) is derived from the accent's WCAG
relative luminance. It is tenant agnostic: no hardcoded tenant, driven purely by
config. LGU's accent is `#0b5d3b`.

### Type scale and spacing

Body text is 1rem with a 1.6 line height; headings use `tracking-tight`. Use the
Tailwind step scale (`text-xs` 0.75rem to `text-3xl` 1.875rem) and keep headings
modest. Separation between sections is spacing only (see hard rule 2): use the
whitespace scale (`gap-*`, `p-*`, `mt-*`), never a rule.

### Neumorphism: the shadow pairs

`.neu` (raised, presses on `:active`) and `.neu-inset` (permanently recessed,
used by inputs) are the only place soft elevation is defined. The shadows differ
per mode because soft UI depends on a light source:

- **Light:** a soft dark shadow bottom right plus a white highlight top left, on
  the slightly off white `--surface` so both read.
- **Dark:** a deep shadow plus a very faint light highlight, on the raised grey
  `--surface`.

Static content never uses these classes.

## How neumorphism stays AA

The rule that keeps soft UI accessible: **text always sits on a solid token,
never on a shadow.** The neumorphic shadows are decorative elevation around an
element; the element's background is always a solid colour (`--surface`,
`--primary`, `--destructive`), and text uses that colour's paired foreground. So
a shadow can never lower the contrast of readable text.

Every pairing was computed with the WCAG relative luminance formula (OKLCH to
linear sRGB to Y, then `(L1 + 0.05) / (L2 + 0.05)`). WCAG AA is 4.5:1 for normal
text and 3:1 for large text.

| Pairing (light)                       | Ratio | Verdict        |
| ------------------------------------- | ----- | -------------- |
| foreground on background              | 19.79 | AAA            |
| muted-foreground on background        | 7.77  | AAA            |
| surface-foreground on surface (neu)   | 18.04 | AAA            |
| warning-foreground on warning (badge) | 11.69 | AAA            |
| white on destructive                  | 6.47  | AA (AAA large) |
| white on tenant accent `#0b5d3b`      | 7.95  | AAA            |

| Pairing (dark)                        | Ratio | Verdict |
| ------------------------------------- | ----- | ------- |
| foreground on background              | 18.96 | AAA     |
| muted-foreground on background        | 7.98  | AAA     |
| surface-foreground on surface (neu)   | 16.86 | AAA     |
| warning-foreground on warning (badge) | 7.60  | AAA     |
| white on tenant accent `#0b5d3b`      | 7.95  | AAA     |

Every combination clears AA; most clear AAA. The lowest is white on the
destructive red at 6.47:1, still comfortably above the 4.5:1 AA floor. When a
tenant sets a light accent, `--primary-foreground` flips to near black by the
same luminance rule, so accent buttons stay readable for any configured colour.

## Two hard rules

### 1. No dash punctuation in UI copy

No em dash, no en dash, no hyphen used as a connector. Time ranges read
"8:00 to 9:30", not "8:00-9:30". Rewrite with commas, the word "to", or
restructured sentences. The **plain hyphen is allowed**, so compounds
(`multi-tenant`, `open-source`) and identifier codes (`B-204`) survive.

Enforced by two gates:

- `apps/web/test/no-dash.test.ts` (Vitest) is the authoritative gate for the
  i18n copy catalog `messages/*.ts` (bans em dash, en dash, and the spaced
  hyphen connector) and scans `app/` and `lib/` source for em and en dashes.
- `no-restricted-syntax` in `apps/web/eslint.config.mjs` bans all three forms in
  JSX text nodes (real `JSXText`, so it never false positives on arithmetic like
  `a - b`), giving editor and pre-commit feedback.

Together they cover both `messages/*.ts` and JSX text.

### 2. No divider lines

No `<hr>`, no border line used as a separator between sections. Separation is
whitespace and spacing only. The design-system `Table` uses `border-separate`
with spacing (no row rules); the empty state and grid cells are flat filled
surfaces, not outlined boxes. Element outlines that are not separators (focus
rings) are unaffected.

## Components (`packages/ui`)

- **Button** interactive: neumorphic (raised, presses on active). `default` is
  the tenant accent; `secondary` / `outline` are neutral surfaces; `ghost` and
  `link` are flat.
- **Badge** static: flat solid fills, high contrast. `warning` is the Unverified
  badge.
- **Card** container: `flat` (default, a plain filled surface) or `pressable`
  (neumorphic, for selectable items).
- **Table** static: no divider lines; rows separated by spacing.
- **Input / Select** interactive: neumorphic inset (recessed). **Label** and
  **Field** wire accessible, labelled controls.
